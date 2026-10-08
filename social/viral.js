#!/usr/bin/env node
// social/viral.js — щоденна добірка найобговорюваніших постів Threads (за кількістю коментарів).
//
// Дані бере з Apify (сторонній скрейпер Threads), бо Threads API не дає читати чужі пости.
// Ключ Apify — Network secret середовища Claude (Bearer, сайт api.apify.com) або APIFY_TOKEN.
//
//   node social/viral.js collect [N]      — зібрати пости за останні 24 год, вивести топ-N (JSON)
//   node social/viral.js send <файл.txt>  — надіслати текст у Telegram-канал
//
// Telegram: TELEGRAM_BOT_TOKEN і TELEGRAM_CHAT_ID (наприклад @my_channel) у змінних середовища.
// Налаштування пошуку — social/viral-config.json.

try { require('dotenv').config(); } catch { /* без dotenv */ }
const fs = require('fs');
const path = require('path');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'viral-config.json'), 'utf8'));

// Різні скрейпери називають поля по-різному — беремо перше, що знайдеться.
const pick = (obj, paths) => {
  for (const p of paths) {
    const v = p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};

function normalize(item) {
  const ts = pick(item, ['timestamp', 'taken_at', 'takenAt', 'createdAt', 'created_at', 'publishedAt', 'date', 'post.taken_at']);
  const date = typeof ts === 'number' ? new Date(ts < 1e12 ? ts * 1000 : ts) : ts ? new Date(ts) : null;
  const username = pick(item, ['username', 'user.username', 'author.username', 'owner.username', 'ownerUsername', 'authorUsername', 'post.user.username']);
  const code = pick(item, ['code', 'shortcode', 'post.code']);
  return {
    username,
    text: String(pick(item, ['text', 'caption.text', 'caption', 'content', 'post.caption.text']) || '').trim(),
    replies: Number(pick(item, ['reply_count', 'replyCount', 'replies_count', 'repliesCount', 'comments', 'commentCount',
      'text_post_app_info.direct_reply_count', 'post.text_post_app_info.direct_reply_count', 'stats.replies']) || 0),
    likes: Number(pick(item, ['like_count', 'likeCount', 'likes', 'stats.likes', 'post.like_count']) || 0),
    reposts: Number(pick(item, ['repost_count', 'repostCount', 'reposts', 'text_post_app_info.repost_count']) || 0),
    url: pick(item, ['url', 'permalink', 'postUrl', 'link']) || (username && code ? `https://www.threads.com/@${username}/post/${code}` : undefined),
    date: date && !isNaN(date) ? date.toISOString() : null,
  };
}

async function runActor(input) {
  const url = `https://api.apify.com/v2/acts/${config.actor.replace('/', '~')}/run-sync-get-dataset-items?timeout=240`;
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.APIFY_TOKEN) headers.Authorization = `Bearer ${process.env.APIFY_TOKEN}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(input) });
  const data = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(data)) {
    throw new Error(`Apify ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

async function collect(limit = 10) {
  const since = Date.now() - (config.hours || 24) * 3600 * 1000;
  const seen = new Map();
  const errors = [];
  for (const query of config.queries) {
    try {
      const items = await runActor({ ...config.input, [config.queryField]: config.queryAsArray ? [query] : query });
      for (const raw of items) {
        const post = normalize(raw);
        if (!post.url || !post.text) continue;
        if (post.date && Date.parse(post.date) < since) continue;
        if (!seen.has(post.url) || seen.get(post.url).replies < post.replies) seen.set(post.url, { ...post, query });
      }
    } catch (err) {
      errors.push(`${query}: ${err.message}`);
    }
  }
  const top = [...seen.values()].sort((a, b) => b.replies - a.replies || b.likes - a.likes).slice(0, Number(limit));
  return { collected: seen.size, errors, top };
}

async function send(file) {
  const tokenBot = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!tokenBot || !chat) throw new Error('Потрібні TELEGRAM_BOT_TOKEN і TELEGRAM_CHAT_ID');
  const text = fs.readFileSync(file, 'utf8');
  // Ліміт Telegram — 4096 символів на повідомлення; ріжемо по абзацах.
  const parts = [];
  let cur = '';
  for (const block of text.split(/\n\n+/)) {
    if ((cur + '\n\n' + block).length > 4000 && cur) { parts.push(cur); cur = block; } else cur = cur ? `${cur}\n\n${block}` : block;
  }
  if (cur) parts.push(cur);
  for (const part of parts) {
    const res = await fetch(`https://api.telegram.org/bot${tokenBot}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: part, disable_web_page_preview: true }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`Telegram: ${data.description}`);
  }
  return { sent: parts.length };
}

const commands = { collect, send };

(async () => {
  const [cmd, ...args] = process.argv.slice(2);
  if (!commands[cmd]) {
    console.error('Команди: collect [N], send <файл.txt>');
    process.exit(1);
  }
  console.log(JSON.stringify(await commands[cmd](...args), null, 2));
})().catch((err) => {
  console.error('Помилка:', err.message);
  process.exit(1);
});
