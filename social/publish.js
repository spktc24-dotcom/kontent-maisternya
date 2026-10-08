#!/usr/bin/env node
// social/publish.js — пряма публікація в Instagram і Threads через офіційні API Meta
// (без Metricool). Токени — двома способами:
//   1) змінні середовища IG_TOKEN_1 / THREADS_TOKEN_1 (локально, Render тощо);
//   2) Network secrets хмарного середовища Claude, тип "Body parameter", назва access_token:
//      проксі сам підставляє токен у тіло запитів на graph.instagram.com / graph.threads.net,
//      тоді змінні не потрібні, а скрипт не бачить токена взагалі.
// У хмарі Claude запускати з NODE_USE_ENV_PROXY=1 (npm run social це вже робить).
//
// Приклади:
//   node social/publish.js check
//   node social/publish.js ig-photo    https://site/foto.jpg "Підпис #хештег"
//   node social/publish.js ig-carousel https://site/1.jpg,https://site/2.jpg "Підпис"
//   node social/publish.js ig-reel     https://site/video.mp4 "Підпис"
//   node social/publish.js ig-story    https://site/foto.jpg
//   node social/publish.js threads-text  "Текст поста"
//   node social/publish.js threads-image https://site/foto.jpg "Текст"
//   node social/publish.js threads-chain "Перший пост" "Другий" "Третій"
//   node social/publish.js refresh   — продовжує обидва токени ще на 60 днів (друкує нові)

try { require('dotenv').config(); } catch { /* без dotenv — беремо змінні середовища як є */ }

const IG_BASE = `https://graph.instagram.com/${process.env.IG_API_VERSION || 'v23.0'}`;
const TH_BASE = `https://graph.threads.net/${process.env.THREADS_API_VERSION || 'v1.0'}`;

// Порожній токен = покладаємось на Network secret, який додає проксі.
function token(name) {
  return process.env[name] || '';
}

// Усі запити йдуть як POST з form-тілом: Network secret типу "Body parameter" вміє
// підставляти access_token лише в тіло. Читання — через стандартний для Graph API
// перемикач method=GET.
async function call(method, url, params, accessToken) {
  const body = new URLSearchParams({
    ...params,
    ...(method === 'GET' && { method: 'GET' }),
    ...(accessToken && { access_token: accessToken }),
  });
  const res = await fetch(url, { method: 'POST', body });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const msg = data.error ? `${data.error.message} (код ${data.error.code})` : `HTTP ${res.status}`;
    throw new Error(`${method} ${url}: ${msg}`);
  }
  // Посилання пагінації Meta містять access_token відкритим текстом — не показуємо їх.
  if (data.paging) { delete data.paging.next; delete data.paging.previous; }
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Медіа-контейнер (особливо відео) обробляється на стороні Meta — чекаємо FINISHED.
async function waitReady(base, id, accessToken, field) {
  for (let i = 0; i < 60; i++) {
    const data = await call('GET', `${base}/${id}`, { fields: field }, accessToken);
    const status = data[field];
    if (status === 'FINISHED' || status === 'PUBLISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED') throw new Error(`Контейнер ${id}: ${status}`);
    await sleep(5000);
  }
  throw new Error(`Контейнер ${id} не обробився за 5 хвилин`);
}

// ---------- Instagram ----------

async function igUser() {
  return call('GET', `${IG_BASE}/me`, { fields: 'user_id,username' }, token('IG_TOKEN_1'));
}

async function igPublish(params) {
  const t = token('IG_TOKEN_1');
  const { user_id } = await igUser();
  const { id } = await call('POST', `${IG_BASE}/${user_id}/media`, params, t);
  await waitReady(IG_BASE, id, t, 'status_code');
  const post = await call('POST', `${IG_BASE}/${user_id}/media_publish`, { creation_id: id }, t);
  return call('GET', `${IG_BASE}/${post.id}`, { fields: 'id,permalink' }, t);
}

async function igCarousel(urls, caption) {
  const t = token('IG_TOKEN_1');
  const { user_id } = await igUser();
  const children = [];
  for (const url of urls) {
    const isVideo = /\.(mp4|mov)(\?|$)/i.test(url);
    const item = isVideo ? { media_type: 'VIDEO', video_url: url } : { image_url: url };
    const { id } = await call('POST', `${IG_BASE}/${user_id}/media`, { ...item, is_carousel_item: 'true' }, t);
    await waitReady(IG_BASE, id, t, 'status_code');
    children.push(id);
  }
  return igPublish({ media_type: 'CAROUSEL', children: children.join(','), caption });
}

// ---------- Threads ----------

async function thPublish(params) {
  const t = token('THREADS_TOKEN_1');
  const { id } = await call('POST', `${TH_BASE}/me/threads`, params, t);
  await waitReady(TH_BASE, id, t, 'status');
  const post = await call('POST', `${TH_BASE}/me/threads_publish`, { creation_id: id }, t);
  return call('GET', `${TH_BASE}/${post.id}`, { fields: 'id,permalink' }, t);
}

async function thChain(texts) {
  const results = [];
  let replyTo;
  for (const text of texts) {
    const post = await thPublish({ media_type: 'TEXT', text, ...(replyTo && { reply_to_id: replyTo }) });
    results.push(post);
    replyTo = post.id;
  }
  return results;
}

// ---------- Токени ----------

async function refresh() {
  const ig = await call('GET', 'https://graph.instagram.com/refresh_access_token',
    { grant_type: 'ig_refresh_token' }, token('IG_TOKEN_1'));
  const th = await call('GET', 'https://graph.threads.net/refresh_access_token',
    { grant_type: 'th_refresh_token' }, token('THREADS_TOKEN_1'));
  return {
    IG_TOKEN_1: { expires_in_days: Math.round(ig.expires_in / 86400), access_token: ig.access_token },
    THREADS_TOKEN_1: { expires_in_days: Math.round(th.expires_in / 86400), access_token: th.access_token },
  };
}

async function check() {
  const out = {};
  for (const [name, fn] of [
    ['instagram', igUser],
    ['threads', () => call('GET', `${TH_BASE}/me`, { fields: 'id,username' }, token('THREADS_TOKEN_1'))],
  ]) {
    try { out[name] = await fn(); } catch (err) { out[name] = { error: err.message }; }
  }
  return out;
}

const commands = {
  check: () => check(),
  'ig-photo': (url, caption = '') => igPublish({ image_url: url, caption }),
  'ig-carousel': (urls, caption = '') => igCarousel(urls.split(','), caption),
  'ig-reel': (url, caption = '') => igPublish({ media_type: 'REELS', video_url: url, caption }),
  'ig-story': (url) => igPublish(/\.(mp4|mov)(\?|$)/i.test(url)
    ? { media_type: 'STORIES', video_url: url }
    : { media_type: 'STORIES', image_url: url }),
  'threads-text': (text) => thPublish({ media_type: 'TEXT', text }),
  'threads-image': (url, text = '') => thPublish({ media_type: 'IMAGE', image_url: url, text }),
  'threads-chain': (...texts) => thChain(texts),
  refresh: () => refresh(),
};

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const fn = commands[cmd];
  if (!fn) {
    console.error(`Команди: ${Object.keys(commands).join(', ')}\nДив. приклади на початку social/publish.js`);
    process.exit(1);
  }
  console.log(JSON.stringify(await fn(...args), null, 2));
}

main().catch((err) => {
  console.error('Помилка:', err.message);
  process.exit(1);
});
