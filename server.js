// server.js — єдина точка входу.
// Роздає статичний сайт (public/index.html), надає API /api/generate
// для сайту, і паралельно запускає Telegram-бота (якщо є BOT_TOKEN).

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { cards, generateContent, notifyTelegram } = require('./content');
const { startBot, getAdminChatId } = require('./bot');

const app = express();
const PORT = process.env.PORT || 3000;

// Пам'ять по кожній сесії браузера: sessionId -> { [cardIndex]: [текст1, текст2, ...] }.
// Живе тільки поки сервер запущений (скидається при перезапуску) — цього достатньо,
// щоб не повторювати одне й те саме в межах одного відвідування сайту.
const sessions = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/generate', async (req, res) => {
  try {
    const { cardIndex, niche, audience, offer, sessionId: incomingSessionId, refine, instruction } = req.body || {};
    if (typeof cardIndex !== 'number') {
      return res.status(400).json({ error: 'cardIndex обов\'язковий і має бути числом (0-7)' });
    }

    const sessionId = incomingSessionId || crypto.randomUUID();
    if (!sessions.has(sessionId)) sessions.set(sessionId, {});
    const sessionHistory = sessions.get(sessionId);
    const history = sessionHistory[cardIndex] || [];

    const text = await generateContent(cardIndex, { niche, audience, offer }, history, refine ? instruction : null);

    if (refine && history.length > 0) {
      // Уточнення замінює останню версію, а не додається як ще один окремий варіант
      sessionHistory[cardIndex] = [...history.slice(0, -1), text];
    } else {
      sessionHistory[cardIndex] = [...history, text];
    }

    const card = cards[cardIndex];
    notifyTelegram(
      `🌐 *Нова генерація з сайту*${refine ? ' (уточнення)' : ''}\n` +
      `Картка: ${card.n}. ${card.title}\n` +
      `Ніша: ${niche || '—'}\nАудиторія: ${audience || '—'}\n` +
      (refine ? `Запит на зміну: ${instruction}\n` : '') +
      `\n${text}`,
      getAdminChatId()
    ); // навмисно без await — не має затримувати відповідь сайту користувачу

    res.json({ text, sessionId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Сталася помилка генерації. Спробуй ще раз.' });
  }
});

app.listen(PORT, () => {
  console.log(`Сайт і API запущені на порту ${PORT}`);
  startBot(); // запускає Telegram-бота, якщо BOT_TOKEN заданий у змінних середовища
});
