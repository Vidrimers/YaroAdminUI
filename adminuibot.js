#!/usr/bin/env node
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import sqlite3 from "sqlite3";

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

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (text === "/start") {
    bot.sendMessage(
      chatId,
      "Welcome to YaroAdminUI Bot!\\n\\nCommands:\\n/status - Server status\\n/help - Help"
    );
  } else if (text === "/status") {
    bot.sendMessage(chatId, "Server Status\\nOnline: Yes\\nUptime: 24d");
  } else if (text === "/help") {
    bot.sendMessage(chatId, "Available commands:\\n/start\\n/status\\n/help");
  }
});

console.log("\ní³± YaroAdminUI Telegram Bot Started\n");

process.on("SIGTERM", async () => {
  console.log("Shutting down bot...");
  await db.close();
  process.exit(0);
});
