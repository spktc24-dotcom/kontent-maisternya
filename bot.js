// bot.js — логіка Telegram-бота. Використовує спільний content.js,
// тому картки й промпти завжди однакові з сайтом.

const TelegramBot = require('node-telegram-bot-api');
const { cards, generateContent } = require('./content');

function startBot() {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN) {
    console.log('BOT_TOKEN не заданий — Telegram-бот не запущено (працює тільки сайт/API).');
    return null;
  }

  const bot = new TelegramBot(BOT_TOKEN, { polling: true });
  const userState = new Map();

  function getState(chatId) {
    if (!userState.has(chatId)) {
      userState.set(chatId, { step: 'idle', niche: '', audience: '', offer: '', history: {} });
    }
    return userState.get(chatId);
  }

  function mainMenuKeyboard() {
    return {
      inline_keyboard: cards.reduce((rows, c, i) => {
        const btn = { text: `${c.n} · ${c.title}`, callback_data: `card:${i}` };
        if (i % 2 === 0) rows.push([btn]); else rows[rows.length - 1].push(btn);
        return rows;
      }, []).concat([[{ text: '✏️ Змінити контекст', callback_data: 'edit_context' }]])
    };
  }

  function contextSummary(state) {
    return `📌 *Твій контекст:*\nНіша: ${state.niche || '—'}\nАудиторія: ${state.audience || '—'}\nПродукт: ${state.offer || '—'}\n\nОбери картку 👇`;
  }

  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    console.log(`Chat ID для ADMIN_CHAT_ID: ${chatId}`);
    userState.set(chatId, { step: 'ask_niche', niche: '', audience: '', offer: '', history: {} });
    bot.sendMessage(chatId,
      '👋 Вітаю в *Контент-майстерні*!\n\nЦе безкоштовний генератор контенту й реклами для блогу: 8 готових гілок — від оферу до запуску таргету.\n\nСпочатку заповнимо контекст. Напиши свою *нішу/тему* блогу:',
      { parse_mode: 'Markdown' });
  });

  bot.onText(/\/reset/, (msg) => {
    const chatId = msg.chat.id;
    userState.set(chatId, { step: 'ask_niche', niche: '', audience: '', offer: '', history: {} });
    bot.sendMessage(chatId, 'Контекст скинуто. Напиши свою нішу/тему блогу:');
  });

  bot.on('message', (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;
    const chatId = msg.chat.id;
    const state = getState(chatId);

    if (state.step === 'ask_niche') {
      state.niche = msg.text.trim();
      state.step = 'ask_audience';
      bot.sendMessage(chatId, 'Добре! Тепер напиши свою *цільову аудиторію*:', { parse_mode: 'Markdown' });
    } else if (state.step === 'ask_audience') {
      state.audience = msg.text.trim();
      state.step = 'ask_offer';
      bot.sendMessage(chatId, 'І останнє: що продаєш або яку проблему вирішуєш? (можна написати "-", якщо пропустити)');
    } else if (state.step === 'ask_offer') {
      state.offer = msg.text.trim() === '-' ? '' : msg.text.trim();
      state.step = 'menu';
      bot.sendMessage(chatId, contextSummary(state), { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() });
    } else if (state.step === 'menu') {
      bot.sendMessage(chatId, contextSummary(state), { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() });
    } else {
      bot.sendMessage(chatId, 'Напиши /start, щоб почати.');
    }
  });

  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const state = getState(chatId);

    if (query.data === 'edit_context') {
      userState.set(chatId, { step: 'ask_niche', niche: '', audience: '', offer: '', history: {} });
      bot.answerCallbackQuery(query.id);
      return bot.sendMessage(chatId, 'Напиши свою нішу/тему блогу:');
    }

    if (query.data.startsWith('card:')) {
      const idx = parseInt(query.data.split(':')[1], 10);
      const card = cards[idx];
      bot.answerCallbackQuery(query.id, { text: `Генерую: ${card.title}...` });
      const waitMsg = await bot.sendMessage(chatId, `⏳ Генерую *${card.n}. ${card.title}*...`, { parse_mode: 'Markdown' });

      try {
        const prevForCard = state.history[idx] || [];
        const result = await generateContent(idx, state, prevForCard);
        state.history[idx] = [...prevForCard, result];
        await bot.editMessageText(`✅ *${card.n}. ${card.title}*\n\n${result}`, {
          chat_id: chatId,
          message_id: waitMsg.message_id,
          parse_mode: 'Markdown'
        });
        await bot.sendMessage(chatId, 'Обери наступну картку 👇 (та сама картка дасть новий варіант, не повтор)', { reply_markup: mainMenuKeyboard() });
      } catch (err) {
        console.error(err);
        await bot.editMessageText('❌ Сталася помилка генерації. Спробуй ще раз трохи пізніше.', {
          chat_id: chatId, message_id: waitMsg.message_id
        });
      }
    }
  });

  console.log('Telegram-бот "Контент-майстерня" запущено.');
  return bot;
}

module.exports = { startBot };
