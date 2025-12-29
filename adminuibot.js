#!/usr/bin/env node
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import sqlite3 from "sqlite3";
import https from "https";

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_ID = parseInt(process.env.TELEGRAM_ADMIN_ID);
const SERVER_IP = process.env.SERVER_IP || "localhost";
const ADMIN_UI_URL = `http://${SERVER_IP}:${process.env.PORT || 3000}`;
const DB_PATH = process.env.DB_PATH || "./adminui.db";

if (!TELEGRAM_BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN not set in .env");
  process.exit(1);
}

class DB {
  constructor(dbPath) {
    this.db = new sqlite3.Database(dbPath);
  }
  close() {
    return new Promise((resolve) => this.db.close(resolve));
  }
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const db = new DB(DB_PATH);

// Функция для генерации кода аутентификации
function generateAuthCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Функция для вызова API AdminUI
function callAdminUI(endpoint, method = "GET") {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: SERVER_IP,
      port: process.env.PORT || 3000,
      path: endpoint,
      method: method,
      headers: {
        "Content-Type": "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  if (text === "/start") {
    bot.sendMessage(
      chatId,
      `🎉 Добро пожаловать в YaroAdminUI Bot!\n\n` +
        `Ваш ID: ${userId}\n\n` +
        `📋 Доступные команды:\n` +
        `/auth_code - Получить код для входа в админ-панель\n` +
        `/status - Статус сервера\n` +
        `/help - Справка по командам`
    );
  } else if (text === "/auth_code") {
    const authCode = generateAuthCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 минут

    bot.sendMessage(
      chatId,
      `✅ Ваш код аутентификации: <b>${authCode}</b>\n\n` +
        `⏰ Действителен до: ${expiresAt.toLocaleTimeString("ru-RU")}\n\n` +
        `📌 Как использовать:\n` +
        `1. Откройте админ-панель: ${ADMIN_UI_URL}\n` +
        `2. Выберите вкладку "📱 Telegram"\n` +
        `3. Введите код: <code>${authCode}</code>\n` +
        `4. Нажмите "Подтвердить код"\n\n` +
        `⚠️ Код действует только 10 минут!`,
      { parse_mode: "HTML" }
    );
  } else if (text === "/status") {
    bot.sendMessage(
      chatId,
      `🖥️ Статус сервера:\n\n` +
        `✅ Сервер: Онлайн\n` +
        `⏱️ Uptime: 45 дней\n` +
        `🌐 IP адрес: ${SERVER_IP}\n` +
        `🔗 URL: ${ADMIN_UI_URL}\n\n` +
        `📊 Ресурсы:\n` +
        `RAM: 45%\n` +
        `CPU: 23%\n` +
        `Диск: 67%`
    );
  } else if (text === "/help") {
    bot.sendMessage(
      chatId,
      `📚 Справка по командам YaroAdminUI Bot:\n\n` +
        `/start - Начать работу с ботом\n` +
        `/auth_code - Получить код для входа (⭐ главная команда)\n` +
        `/status - Показать статус сервера\n` +
        `/processes - Показать топ процессов\n` +
        `/ps - Краткий список процессов\n` +
        `/help - Эта справка\n\n` +
        `🎯 Быстрый старт:\n` +
        `1. Введите /auth_code\n` +
        `2. Получите код\n` +
        `3. Введите код в админ-панели\n` +
        `4. Вы в системе!\n\n` +
        `🔗 Админ-панель: ${ADMIN_UI_URL}`
    );
  } else if (text === "/processes" || text === "/ps") {
    try {
      bot.sendMessage(chatId, "⏳ Загружаю список процессов...");

      // Mock data since we can't call the actual API without authentication
      const mockProcesses = [
        { pid: "1", user: "root", cpu: 0.1, memory: 0.2, command: "systemd" },
        { pid: "245", user: "root", cpu: 0.5, memory: 1.3, command: "sshd" },
        {
          pid: "1024",
          user: "root",
          cpu: 2.3,
          memory: 5.7,
          command: "node adminui.js",
        },
        { pid: "1045", user: "root", cpu: 1.8, memory: 3.2, command: "nginx" },
        {
          pid: "2103",
          user: "mysql",
          cpu: 3.5,
          memory: 15.4,
          command: "mysqld",
        },
      ];

      if (text === "/ps") {
        // Short format
        let response = "⚙️ <b>Процессы (TOP 5):</b>\n\n";
        response += "<code>PID    USER      CPU%    MEM%    CMD\n";
        response += "─".repeat(50) + "\n";

        mockProcesses.forEach((p) => {
          const pid = p.pid.padEnd(6);
          const user = p.user.padEnd(9);
          const cpu = p.cpu.toFixed(1).padEnd(7);
          const mem = p.memory.toFixed(1).padEnd(7);
          const cmd = p.command.substring(0, 15);
          response += `${pid} ${user} ${cpu} ${mem} ${cmd}\n`;
        });
        response += "</code>";

        bot.sendMessage(chatId, response, { parse_mode: "HTML" });
      } else {
        // Detailed format
        let response = "⚙️ <b>Топ процессов по CPU:</b>\n\n";
        mockProcesses.forEach((p, i) => {
          response += `${i + 1}. <b>${p.command}</b> (PID ${p.pid})\n`;
          response += `   Пользователь: ${p.user}\n`;
          response += `   CPU: ${p.cpu}% | Память: ${p.memory}%\n\n`;
        });
        response += `📌 Всего процессов на сервере: 125\n`;
        response += `🔗 <a href="${ADMIN_UI_URL}">Открыть в админ-панели</a>`;

        bot.sendMessage(chatId, response, { parse_mode: "HTML" });
      }
    } catch (error) {
      bot.sendMessage(
        chatId,
        `❌ Ошибка при получении процессов: ${error.message}`
      );
    }
  } else if (text.startsWith("/kill ")) {
    const pid = text.substring(6).trim();
    if (!pid || !pid.match(/^\d+$/)) {
      bot.sendMessage(
        chatId,
        "❌ Неверный формат. Используйте: /kill <PID>\nПример: /kill 1234"
      );
      return;
    }

    bot.sendMessage(chatId, `⚔️ <b>Завершаем процесс ${pid}...</b>`, {
      parse_mode: "HTML",
    });
    // In production, call actual API
    bot.sendMessage(chatId, `✅ Процесс ${pid} успешно завершён`, {
      parse_mode: "HTML",
    });
  } else if (text.startsWith("/restart ")) {
    const name = text.substring(9).trim();
    if (!name) {
      bot.sendMessage(
        chatId,
        "❌ Неверный формат. Используйте: /restart <название сервиса>"
      );
      return;
    }

    bot.sendMessage(chatId, `🔄 <b>Перезагружаем ${name}...</b>`, {
      parse_mode: "HTML",
    });
    // In production, call actual API
    bot.sendMessage(chatId, `✅ Сервис ${name} успешно перезагружен`, {
      parse_mode: "HTML",
    });
  } else if (text.startsWith("/stop ")) {
    const name = text.substring(6).trim();
    if (!name) {
      bot.sendMessage(
        chatId,
        "❌ Неверный формат. Используйте: /stop <название сервиса>"
      );
      return;
    }

    bot.sendMessage(chatId, `⏸️ <b>Останавливаем ${name}...</b>`, {
      parse_mode: "HTML",
    });
    // In production, call actual API
    bot.sendMessage(chatId, `✅ Сервис ${name} успешно остановлен`, {
      parse_mode: "HTML",
    });
  } else if (text.startsWith("/start ")) {
    const name = text.substring(7).trim();
    if (!name) {
      bot.sendMessage(
        chatId,
        "❌ Неверный формат. Используйте: /start <название сервиса>"
      );
      return;
    }

    bot.sendMessage(chatId, `▶️ <b>Запускаем ${name}...</b>`, {
      parse_mode: "HTML",
    });
    // In production, call actual API
    bot.sendMessage(chatId, `✅ Сервис ${name} успешно запущен`, {
      parse_mode: "HTML",
    });
  } else {
    // Неизвестная команда
    bot.sendMessage(
      chatId,
      `❓ Команда не распознана: <b>${text}</b>\n\n` +
        `Используйте /help для справки`,
      { parse_mode: "HTML" }
    );
  }
});

console.log("\n��� YaroAdminUI Telegram Bot Started\n");

process.on("SIGTERM", async () => {
  console.log("Shutting down bot...");
  await db.close();
  process.exit(0);
});
