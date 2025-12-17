#!/usr/bin/env node

import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import crypto from "crypto";

dotenv.config();

// ==================== CONFIG ====================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_ID = parseInt(process.env.TELEGRAM_ADMIN_ID);
const SERVER_IP = process.env.SERVER_IP || "localhost";
const ADMIN_UI_URL = `http://${SERVER_IP}:${process.env.PORT || 3000}`;
const DB_PATH = process.env.DB_PATH || "./adminui.db";

if (!TELEGRAM_BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN не установлен в .env!");
  process.exit(1);
}

// ==================== DATABASE ====================
class DatabaseManager {
  constructor(dbPath) {
    this.db = new Database(dbPath);
  }

  getOrCreateUser(userId, username) {
    const stmt = this.db.prepare(
      "SELECT * FROM telegram_users WHERE telegram_id = ?"
    );
    let user = stmt.get(userId);

    if (!user) {
      const createTableStmt = this.db.prepare(`
        CREATE TABLE IF NOT EXISTS telegram_users (
          telegram_id INTEGER PRIMARY KEY,
          username TEXT NOT NULL,
          connected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_activity DATETIME
        )
      `);
      createTableStmt.run();

      const insertStmt = this.db.prepare(
        "INSERT INTO telegram_users (telegram_id, username, connected_at) VALUES (?, ?, CURRENT_TIMESTAMP)"
      );
      insertStmt.run(userId, username);
      user = { telegram_id: userId, username };
    }

    return user;
  }

  close() {
    this.db.close();
  }
}

// ==================== TELEGRAM BOT ====================
class YaroAdminUIBot {
  constructor() {
    this.bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
    this.db = new DatabaseManager(DB_PATH);

    this.setupHandlers();
    this.setupErrorHandling();

    console.log("✅ Telegram Bot Started\n");
  }

  setupHandlers() {
    // Start command
    this.bot.onText(/\/start/, (msg) => {
      this.handleStart(msg);
    });

    // Auth code command
    this.bot.onText(/\/auth_code (.+)/, (msg, match) => {
      this.handleAuthCode(msg, match);
    });

    // Admin command
    this.bot.onText(/\/admin/, (msg) => {
      this.handleAdmin(msg);
    });

    // Server status command
    this.bot.onText(/\/status/, (msg) => {
      this.handleStatus(msg);
    });

    // Help command
    this.bot.onText(/\/help/, (msg) => {
      this.handleHelp(msg);
    });

    // Link account command
    this.bot.onText(/\/link/, (msg) => {
      this.handleLink(msg);
    });

    // All other text messages
    this.bot.on("message", (msg) => {
      if (!msg.text || msg.text.startsWith("/")) {
        return;
      }
      this.handleMessage(msg);
    });

    // Callback query handling
    this.bot.on("callback_query", (query) => {
      this.handleCallback(query);
    });
  }

  setupErrorHandling() {
    this.bot.on("polling_error", (error) => {
      console.error("Polling error:", error);
    });
  }

  // ==================== COMMAND HANDLERS ====================

  async handleStart(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;

    // Store user
    this.db.getOrCreateUser(userId, username);

    const startMessage = `
👋 Добро пожаловать в <b>YaroAdminUI Bot</b>!

Этот бот помогает управлять сервером и входить в админ-панель.

📋 Доступные команды:
• /help - Справка по командам
• /link - Связать Telegram с админ-панелью
• /status - Статус сервера
• /admin - Перейти в админ-панель
• /auth_code CODE - Подтвердить код входа

🔐 Для входа в админ-панель:
1. Откройте админ-панель ${ADMIN_UI_URL}
2. Выберите вход через Telegram
3. Скопируйте код
4. Отправьте боту: /auth_code CODE
    `;

    this.bot.sendMessage(chatId, startMessage, { parse_mode: "HTML" });
  }

  async handleAuthCode(msg, match) {
    const chatId = msg.chat.id;
    const code = match[1].toUpperCase();
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;

    try {
      // Store user
      this.db.getOrCreateUser(userId, username);

      // Verify code with main server
      const response = await fetch(`${ADMIN_UI_URL}/api/auth/telegram-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });

      if (!response.ok) {
        const error = await response.json();
        this.bot.sendMessage(
          chatId,
          `❌ Ошибка: ${error.message}\n\nКод может быть невалидным или истекшим.`,
          { parse_mode: "HTML" }
        );
        return;
      }

      const data = await response.json();

      this.bot.sendMessage(
        chatId,
        `✅ <b>Успешный вход!</b>\n\nВы вошли как: <code>${data.username}</code>\n\n🔐 Ваш токен сохранен. Перейдите в админ-панель.`,
        { parse_mode: "HTML" }
      );

      // Notify admin
      if (TELEGRAM_ADMIN_ID && TELEGRAM_ADMIN_ID !== userId) {
        this.bot.sendMessage(
          TELEGRAM_ADMIN_ID,
          `🔐 Новый вход через Telegram\nПользователь: ${username} (ID: ${userId})\nВремя: ${new Date().toLocaleString(
            "ru-RU"
          )}`,
          { parse_mode: "HTML" }
        );
      }
    } catch (error) {
      console.error("Auth code error:", error);
      this.bot.sendMessage(
        chatId,
        `❌ Ошибка соединения с сервером.\n\nПожалуйста, попробуйте позже.`,
        { parse_mode: "HTML" }
      );
    }
  }

  async handleAdmin(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;

    // Store user
    this.db.getOrCreateUser(userId, username);

    const keyboard = {
      inline_keyboard: [
        [
          { text: "🌐 Открыть админ-панель", url: ADMIN_UI_URL },
          { text: "📱 Получить код входа", callback_data: "get_auth_code" },
        ],
        [{ text: "📊 Статус сервера", callback_data: "server_status" }],
      ],
    };

    this.bot.sendMessage(
      chatId,
      "🔧 <b>Управление админ-панелью</b>\n\nВыберите действие:",
      { parse_mode: "HTML", reply_markup: keyboard }
    );
  }

  async handleStatus(msg) {
    const chatId = msg.chat.id;

    try {
      const response = await fetch(`${ADMIN_UI_URL}/api/server/status`);

      if (!response.ok) {
        this.bot.sendMessage(
          chatId,
          "❌ Сервер недоступен или возникла ошибка.",
          { parse_mode: "HTML" }
        );
        return;
      }

      const status = await response.json();

      const statusMessage = `
🖥️ <b>Статус сервера</b>

📍 IP: <code>${status.ip}</code>
🟢 Статус: ${status.online ? "✅ Online" : "❌ Offline"}
⏱️ Uptime: ${status.uptime}
💾 RAM: ${status.ramUsage}
⚙️ CPU: ${status.cpuUsage}
      `;

      this.bot.sendMessage(chatId, statusMessage, { parse_mode: "HTML" });
    } catch (error) {
      console.error("Status check error:", error);
      this.bot.sendMessage(chatId, "❌ Ошибка получения статуса сервера.", {
        parse_mode: "HTML",
      });
    }
  }

  async handleHelp(msg) {
    const chatId = msg.chat.id;

    const helpMessage = `
📚 <b>Справка YaroAdminUI Bot</b>

<b>Основные команды:</b>
• /start - Приветствие и основная информация
• /help - Эта справка
• /admin - Управление админ-панелью
• /status - Проверить статус сервера
• /link - Связать Telegram с админ-панелью

<b>Аутентификация:</b>
• /auth_code CODE - Подтвердить код входа

<b>Доступные методы входа в админ-панель:</b>
1️⃣ SSH ключ - самый безопасный способ
2️⃣ WebAuthn - использует биометрию или ключ
3️⃣ Telegram - через этот бот

<b>Требования:</b>
• OpenSSH ≥ 8.2 для SSH верификации
• Браузер с поддержкой WebAuthn

❓ Для получения кода входа выберите "Telegram" на странице входа.
    `;

    this.bot.sendMessage(chatId, helpMessage, { parse_mode: "HTML" });
  }

  async handleLink(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || msg.from.first_name;

    // Store user
    this.db.getOrCreateUser(userId, username);

    const linkMessage = `
🔗 <b>Связывание аккаунта с админ-панелью</b>

Ваш Telegram ID: <code>${userId}</code>
Имя пользователя: <code>${username}</code>

Чтобы войти в админ-панель через Telegram:
1. Откройте админ-панель: ${ADMIN_UI_URL}
2. Выберите вкладку "Telegram"
3. Вставьте код, который вы получили
4. Отправьте команду: /auth_code CODE

Подробнее: /help
    `;

    this.bot.sendMessage(chatId, linkMessage, { parse_mode: "HTML" });
  }

  handleMessage(msg) {
    const chatId = msg.chat.id;

    this.bot.sendMessage(
      chatId,
      "ℹ️ Я не понимаю эту команду.\n\nДоступные команды: /help",
      { parse_mode: "HTML" }
    );
  }

  // ==================== CALLBACK HANDLERS ====================

  async handleCallback(query) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const username = query.from.username || query.from.first_name;

    switch (query.data) {
      case "get_auth_code":
        await this.handleGetAuthCode(query);
        break;

      case "server_status":
        await this.handleStatus({ chat: { id: chatId }, from: { id: userId } });
        break;

      default:
        this.bot.answerCallbackQuery(query.id, "Неизвестная команда");
    }
  }

  async handleGetAuthCode(query) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const username = query.from.username || query.from.first_name;

    try {
      // Request auth code from main server
      const response = await fetch(
        `${ADMIN_UI_URL}/api/auth/telegram-request-code`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telegram_id: userId, username }),
        }
      );

      if (!response.ok) {
        this.bot.answerCallbackQuery(query.id, "Ошибка получения кода", true);
        return;
      }

      const data = await response.json();

      this.bot.editMessageText(
        `🔐 <b>Код входа</b>\n\nВаш код входа:\n\n<code>${data.code}</code>\n\nКопируйте и отправьте боту:\n/auth_code ${data.code}\n\n⏱️ Действителен 10 минут`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: "HTML",
        }
      );

      this.bot.answerCallbackQuery(query.id, "✅ Код создан");
    } catch (error) {
      console.error("Get auth code error:", error);
      this.bot.answerCallbackQuery(query.id, "Ошибка соединения", true);
    }
  }

  // ==================== UTILITY METHODS ====================

  async sendNotification(message, userId = null) {
    const chatId = userId || TELEGRAM_ADMIN_ID;

    if (chatId) {
      this.bot.sendMessage(chatId, message, { parse_mode: "HTML" });
    }
  }

  close() {
    this.db.close();
    this.bot.stopPolling();
    console.log("\n👋 Telegram Bot Stopped");
  }
}

// ==================== INITIALIZATION ====================

// Create bot instance
const bot = new YaroAdminUIBot();

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("\nSIGTERM received, shutting down gracefully...");
  bot.close();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  bot.close();
  process.exit(0);
});

console.log(`
╔════════════════════════════════════════════╗
║   📱 YaroAdminUI Telegram Bot Started      ║
╠════════════════════════════════════════════╣
║ Token:  *${TELEGRAM_BOT_TOKEN.slice(-10).padEnd(36)}║
║ Admin:  ${TELEGRAM_ADMIN_ID.toString().padEnd(41)}║
║ UI URL: ${ADMIN_UI_URL.padEnd(41)}║
╚════════════════════════════════════════════╝
`);

export default bot;
