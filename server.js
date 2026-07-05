// server.js — єдина точка входу.
// Роздає статичний сайт (public/index.html), надає API /api/generate
// для сайту, і паралельно запускає Telegram-бота (якщо є BOT_TOKEN).

const express = require('express');
const path = require('path');
const { generateContent } = require('./content');
const { startBot } = require('./bot');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/generate', async (req, res) => {
  try {
    const { cardIndex, niche, audience, offer } = req.body || {};
    if (typeof cardIndex !== 'number') {
      return res.status(400).json({ error: 'cardIndex обов\'язковий і має бути числом (0-7)' });
    }
    const text = await generateContent(cardIndex, { niche, audience, offer });
    res.json({ text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Сталася помилка генерації. Спробуй ще раз.' });
  }
});

app.listen(PORT, () => {
  console.log(`Сайт і API запущені на порту ${PORT}`);
  startBot(); // запускає Telegram-бота, якщо BOT_TOKEN заданий у змінних середовища
});
