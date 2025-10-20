require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { message } = require('telegraf/filters');
const { OpenAI } = require('openai');
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'gpt-4o-mini';
const openai = OPENROUTER_API_KEY
  ? new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: OPENROUTER_API_KEY,
    })
  : null;

// In-memory per-user state (no database)
const userIdToState = new Map();

function getOrCreateUserState(userId) {
  let state = userIdToState.get(userId);
  if (!state) {
    state = {
      mode: 'default', // default | collect_student | collect_it | collect_contacts | chatgpt
      step: 0,
      student: null, // { surname, group }
      it: null, // { technologies }
      contacts: null, // { phone, email }
      chatHistory: [], // [{ role: 'user'|'assistant'|'system', content }]
    };
    userIdToState.set(userId, state);
  }
  return state;
}

const LABEL_STUDENT = 'Студент';
const LABEL_IT = 'IT-технології';
const LABEL_CONTACTS = 'Контакти';
const LABEL_GPT = 'Prompt ChatGPT';
const LABEL_BACK = '🔙 До меню';

const mainMenu = Markup.keyboard([
  [LABEL_STUDENT, LABEL_IT],
  [LABEL_CONTACTS, LABEL_GPT],
]).resize();

const backOnlyMenu = Markup.keyboard([[LABEL_BACK]]).resize();

function showMainMenu(ctx, text = 'Оберіть пункт меню:') {
  return ctx.reply(text, mainMenu);
}

function formatStudentData(student) {
  return `Ваші дані студента:\n- Прізвище: ${student.surname}\n- Група: ${student.group}`;
}

function formatItData(it) {
  return `Ваші IT-технології:\n${it.technologies}`;
}

function formatContactsData(contacts) {
  return `Ваші контакти:\n- Телефон: ${contacts.phone}\n- E-mail: ${contacts.email}`;
}

async function callOpenAIChat(messages) {
  if (!openai) {
    throw new Error('OPENAI_API_KEY не налаштований. Додайте ключ у файл .env');
  }
  const completion = await openai.chat.completions.create({
    model: OPENROUTER_MODEL,
    messages,
  });
  const content = completion.choices?.[0]?.message?.content;
  return (content || '').trim() || 'Немає відповіді.';
}

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
  showMainMenu(
    ctx,
    `Привіт, ${ctx.from.first_name || 'друже'}! Я готовий допомогти.`
  );
});

bot.help((ctx) => {
  ctx.reply(
    'Доступні команди:\n/start — показати головне меню\n/help — ця підказка'
  );
});

bot.on(message('text'), async (ctx) => {
  const userId = ctx.from.id;
  const state = getOrCreateUserState(userId);
  const text = ctx.message.text.trim();

  // Global navigation
  if (text === LABEL_BACK) {
    if (state.mode === 'chatgpt') {
      state.chatHistory = [];
    }
    state.mode = 'default';
    state.step = 0;
    return showMainMenu(ctx);
  }

  // Top-level menu selections
  if (text === LABEL_STUDENT) {
    if (state.mode === 'chatgpt') {
      state.chatHistory = [];
    }
    if (state.student) {
      await ctx.reply(formatStudentData(state.student), mainMenu);
    } else {
      state.mode = 'collect_student';
      state.step = 0;
      await ctx.reply('Введіть, будь ласка, ваше прізвище:', backOnlyMenu);
    }
    return;
  }
  if (text === LABEL_IT) {
    if (state.mode === 'chatgpt') {
      state.chatHistory = [];
    }
    if (state.it) {
      await ctx.reply(formatItData(state.it), mainMenu);
    } else {
      state.mode = 'collect_it';
      state.step = 0;
      await ctx.reply(
        'Вкажіть ваші IT-технології (через кому або довільний текст):',
        backOnlyMenu
      );
    }
    return;
  }
  if (text === LABEL_CONTACTS) {
    if (state.mode === 'chatgpt') {
      state.chatHistory = [];
    }
    if (state.contacts) {
      await ctx.reply(formatContactsData(state.contacts), mainMenu);
    } else {
      state.mode = 'collect_contacts';
      state.step = 0;
      await ctx.reply('Введіть номер телефону:', backOnlyMenu);
    }
    return;
  }
  if (text === LABEL_GPT) {
    state.chatHistory = [];
    state.mode = 'chatgpt';
    state.step = 0;
    if (!openai) {
      return ctx.reply(
        'Режим ChatGPT: не вказано OPENAI_API_KEY у .env. Додайте ключ і перезапустіть бота.',
        backOnlyMenu
      );
    }
    await ctx.reply(
      'Режим ChatGPT активовано. Напишіть ваш запит або натисніть «🔙 До меню».',
      backOnlyMenu
    );
    return;
  }

  // Mode-specific handling
  if (state.mode === 'collect_student') {
    if (state.step === 0) {
      state.student = { surname: text, group: '' };
      state.step = 1;
      return ctx.reply('Введіть назву вашої групи:', backOnlyMenu);
    }
    if (state.step === 1) {
      state.student.group = text;
      state.mode = 'default';
      state.step = 0;
      await ctx.reply('Дякую! Зберіг дані студента.');
      return showMainMenu(ctx, formatStudentData(state.student));
    }
  }

  if (state.mode === 'collect_it') {
    state.it = { technologies: text };
    state.mode = 'default';
    state.step = 0;
    await ctx.reply('Дякую! Зберіг ваші IT-технології.');
    return showMainMenu(ctx, formatItData(state.it));
  }

  if (state.mode === 'collect_contacts') {
    if (state.step === 0) {
      state.contacts = { phone: text, email: '' };
      state.step = 1;
      return ctx.reply('Введіть ваш e-mail:', backOnlyMenu);
    }
    if (state.step === 1) {
      state.contacts.email = text;
      state.mode = 'default';
      state.step = 0;
      await ctx.reply('Дякую! Зберіг ваші контакти.');
      return showMainMenu(ctx, formatContactsData(state.contacts));
    }
  }

  if (state.mode === 'chatgpt') {
    try {
      const limitedHistory = state.chatHistory.slice(-10);
      const messages = [
        { role: 'system', content: 'Ти корисний україномовний асистент.' },
        ...limitedHistory,
        { role: 'user', content: text },
      ];
      const answer = await callOpenAIChat(messages);
      state.chatHistory.push({ role: 'user', content: text });
      state.chatHistory.push({ role: 'assistant', content: answer });
      return ctx.reply(answer, backOnlyMenu);
    } catch (err) {
      const msg =
        err && err.message
          ? err.message
          : 'Сталася помилка при зверненні до ChatGPT.';
      return ctx.reply(`Помилка: ${msg}`, backOnlyMenu);
    }
  }

  // Default fallback when not in any specific mode
  return showMainMenu(
    ctx,
    'Будь ласка, оберіть пункт меню на клавіатурі нижче.'
  );
});

bot
  .launch()
  .then(() => console.log('Бот запущено (polling)'))
  .catch(console.error);

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
