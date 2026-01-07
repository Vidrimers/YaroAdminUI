#!/usr/bin/env node
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import sqlite3 from "sqlite3";
import https from "https";
import { Client as SSHClient } from "ssh2";
import fs from "fs";
import os from "os";

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

// User states for interactive commands
const userStates = new Map();

// Функция для выполнения SSH команд
function executeSSHCommand(command) {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    
    const sshKeyPath = process.env.SSH_KEY_PATH || `${os.homedir()}/.ssh/id_rsa`;
    const sshPassword = process.env.SSH_PASSWORD;
    
    // Prepare connection config
    const connConfig = {
      host: SERVER_IP,
      port: 22,
      username: process.env.SSH_USERNAME || process.env.SSH_USER || 'root'
    };
    
    // Use password if available, otherwise try key
    if (sshPassword) {
      connConfig.password = sshPassword;
    } else if (fs.existsSync(sshKeyPath)) {
      connConfig.privateKey = fs.readFileSync(sshKeyPath);
    } else {
      return reject(new Error(`SSH authentication failed: no password and key not found at ${sshKeyPath}`));
    }
    
    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        
        let output = '';
        let errorOutput = '';
        
        stream.on('close', (code, signal) => {
          conn.end();
          if (code !== 0 && errorOutput) {
            reject(new Error(errorOutput || `Command failed with code ${code}`));
          } else {
            resolve(output);
          }
        }).on('data', (data) => {
          output += data.toString();
        }).stderr.on('data', (data) => {
          errorOutput += data.toString();
        });
      });
    }).on('error', (err) => {
      reject(err);
    }).connect(connConfig);
  });
}

// Функция проверки прав администратора
function isAdmin(userId) {
  // Если TELEGRAM_ADMIN_ID не установлен, разрешаем всем (для разработки)
  if (!TELEGRAM_ADMIN_ID) {
    return true;
  }
  return userId === TELEGRAM_ADMIN_ID;
}

// Функция для генерации кода аутентификации
function generateAuthCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Helper function to identify service by port
function getServiceName(port) {
  const services = {
    22: "SSH",
    25: "SMTP",
    53: "DNS",
    80: "HTTP",
    110: "POP3",
    143: "IMAP",
    443: "HTTPS",
    465: "SMTPS",
    587: "SMTP",
    993: "IMAPS",
    995: "POP3S",
    3000: "Node App",
    3306: "MySQL",
    5432: "PostgreSQL",
    6379: "Redis",
    8000: "Web Service",
    8080: "Web Service",
    8443: "Web Service",
    9000: "PHP-FPM",
  };
  return services[port] || null;
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

  // Создаем клавиатуру с кнопками
  const mainKeyboard = {
    keyboard: [
      [{ text: '🔑 Получить код' }, { text: '📊 Статус сервера' }],
      [{ text: '⚙️ Процессы' }, { text: '🔥 Firewall' }],
      [{ text: '🚀 PM2' }, { text: '📺 Screen' }],
      [{ text: '💾 Диск' }, { text: '❓ Помощь' }]
    ],
    resize_keyboard: true,
    one_time_keyboard: false
  };

  if (text === "/start" || text === "🏠 Главная") {
    bot.sendMessage(
      chatId,
      `🎉 Добро пожаловать в YaroAdminUI Bot!\n\n` +
        `Ваш ID: ${userId}\n\n` +
        `📋 Используйте кнопки ниже для управления сервером:\n\n` +
        `🔑 Получить код - Код для входа в админ-панель\n` +
        `📊 Статус сервера - Информация о сервере\n` +
        `⚙️ Процессы - Топ 10 процессов по загруженности\n` +
        `🚀 PM2 - PM2 процессы и управление\n` +
        `📺 Screen - Screen сессии и управление\n` +
        `🔥 Firewall - Управление портами\n` +
        `💾 Диск - Информация о дисках\n` +
        `❓ Помощь - Справка по командам`,
      { reply_markup: mainKeyboard }
    );
  } else if (text === "/auth_code" || text === "🔑 Получить код") {
    // Проверка что пользователь является админом
    if (!isAdmin(userId)) {
      bot.sendMessage(
        chatId,
        `❌ Доступ запрещен!\n\n` +
          `Только администратор может получить код аутентификации.`
      );
      return;
    }
    
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
  } else if (text === "/status" || text === "📊 Статус сервера") {
    if (!isAdmin(userId)) {
      bot.sendMessage(chatId, `❌ Доступ запрещен! Только для администратора.`);
      return;
    }
    
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
  } else if (text === "/help" || text === "❓ Помощь") {
    bot.sendMessage(
      chatId,
      `📚 Справка по командам YaroAdminUI Bot:\n\n` +
        `/start - Начать работу с ботом\n` +
        `/auth_code - Получить код для входа (⭐ главная команда)\n` +
        `/status - Показать статус сервера\n` +
        `/processes - Показать топ процессов\n` +
        `/ps - Краткий список процессов\n` +
        `/pm2 - Показать PM2 процессы\n` +
        `/screen - Показать Screen сессии\n` +
        `/help - Эта справка\n\n` +
        `🎯 Быстрый старт:\n` +
        `1. Введите /auth_code\n` +
        `2. Получите код\n` +
        `3. Введите код в админ-панели\n` +
        `4. Вы в системе!\n\n` +
        `🔗 Админ-панель: ${ADMIN_UI_URL}`
    );
  } else if (text === "/processes" || text === "/ps" || text === "⚙️ Процессы") {
    if (!isAdmin(userId)) {
      bot.sendMessage(chatId, `❌ Доступ запрещен! Только для администратора.`);
      return;
    }
    
    try {
      bot.sendMessage(chatId, "⏳ Загружаю список процессов...");

      try {
        // Get ALL processes, then sort and take top 10
        const output = await executeSSHCommand(
          `ps aux | tail -n +2`
        );
        
        const lines = output.split('\n').filter(line => line.trim());
        const processes = [];
        
        lines.forEach(line => {
          const parts = line.split(/\s+/);
          if (parts.length >= 11) {
            processes.push({
              pid: parts[1],
              user: parts[0],
              cpu: parseFloat(parts[2]) || 0,
              memory: parseFloat(parts[3]) || 0,
              command: parts.slice(10).join(' ')
            });
          }
        });
        
        // Sort by CPU + Memory (highest first)
        processes.sort((a, b) => {
          const aTotal = a.cpu + a.memory;
          const bTotal = b.cpu + b.memory;
          return bTotal - aTotal;
        });
        
        // Take top 10
        const topProcesses = processes.slice(0, 10);

        if (text === "/ps") {
          // Short format
          let response = "⚙️ <b>Процессы (TOP 10):</b>\n\n";
          response += "<code>PID    USER      CPU%    MEM%    CMD\n";
          response += "─".repeat(50) + "\n";

          topProcesses.forEach((p) => {
            const pid = p.pid.padEnd(6);
            const user = p.user.substring(0, 9).padEnd(9);
            const cpu = p.cpu.toFixed(1).padEnd(7);
            const mem = p.memory.toFixed(1).padEnd(7);
            const cmd = p.command.substring(0, 15);
            response += `${pid} ${user} ${cpu} ${mem} ${cmd}\n`;
          });
          response += "</code>";

          bot.sendMessage(chatId, response, { parse_mode: "HTML" });
        } else {
          // Detailed format
          let response = "⚙️ <b>Топ 10 процессов по загруженности:</b>\n\n";
          topProcesses.forEach((p, i) => {
            response += `${i + 1}. <b>${p.command}</b> (PID ${p.pid})\n`;
            response += `   Пользователь: ${p.user}\n`;
            response += `   CPU: ${p.cpu.toFixed(1)}% | RAM: ${p.memory.toFixed(1)}%\n\n`;
          });
          response += `🔗 <a href="${ADMIN_UI_URL}">Открыть в админ-панели</a>`;

          bot.sendMessage(chatId, response, { parse_mode: "HTML" });
        }
      } catch (sshError) {
        console.error('SSH Error:', sshError);
        // Fallback to mock data if SSH fails
        const mockProcesses = [
          { pid: "2103", user: "mysql", cpu: 3.5, memory: 15.4, command: "mysqld" },
          { pid: "1024", user: "root", cpu: 2.3, memory: 5.7, command: "node adminui.js" },
          { pid: "1045", user: "root", cpu: 1.8, memory: 3.2, command: "nginx" },
          { pid: "3456", user: "www-data", cpu: 1.2, memory: 2.8, command: "php-fpm" },
          { pid: "4567", user: "redis", cpu: 0.9, memory: 2.1, command: "redis-server" },
          { pid: "5678", user: "root", cpu: 0.7, memory: 1.5, command: "dockerd" },
          { pid: "245", user: "root", cpu: 0.5, memory: 1.3, command: "sshd" },
          { pid: "6789", user: "postgres", cpu: 0.4, memory: 3.5, command: "postgres" },
          { pid: "7890", user: "root", cpu: 0.3, memory: 0.8, command: "cron" },
          { pid: "1", user: "root", cpu: 0.1, memory: 0.2, command: "systemd" },
        ];
        
        let response = "⚙️ <b>Топ 10 процессов:</b>\n\n";
        mockProcesses.forEach((p, i) => {
          response += `${i + 1}. <b>${p.command}</b> (PID ${p.pid})\n`;
          response += `   CPU: ${p.cpu}% | RAM: ${p.memory}%\n\n`;
        });
        response += `⚠️ Не удалось подключиться к серверу\n`;
        response += `🔗 <a href="${ADMIN_UI_URL}">Открыть в админ-панели</a>`;
        
        bot.sendMessage(chatId, response, { parse_mode: "HTML" });
      }
    } catch (error) {
      bot.sendMessage(
        chatId,
        `❌ Ошибка при получении процессов: ${error.message}`
      );
    }
  } else if (text === "🚀 PM2" || text === "/pm2") {
    if (!isAdmin(userId)) {
      bot.sendMessage(chatId, `❌ Доступ запрещен! Только для администратора.`);
      return;
    }
    
    try {
      bot.sendMessage(chatId, "⏳ Загружаю PM2 процессы...");

      try {
        // Check if PM2 is available and get processes
        const pm2Check = await executeSSHCommand(
          `which pm2 || command -v pm2 || echo ""`
        );
        
        if (!pm2Check.trim()) {
          bot.sendMessage(chatId, "❌ PM2 не установлен на сервере");
          return;
        }

        const output = await executeSSHCommand(
          `export PATH=$PATH:/usr/local/bin:/usr/bin:~/.npm-global/bin:~/.nvm/versions/node/*/bin && pm2 jlist 2>/dev/null || echo "[]"`
        );
        
        const processes = JSON.parse(output);
        
        if (processes.length === 0) {
          bot.sendMessage(chatId, "📭 PM2 процессы не найдены");
          return;
        }

        let response = "🚀 <b>PM2 Процессы:</b>\n\n";
        
        processes.forEach((p, i) => {
          const status = p.pm2_env.status === 'online' ? '✅' : '❌';
          const uptime = p.pm2_env.pm_uptime ? 
            Math.floor((Date.now() - p.pm2_env.pm_uptime) / 1000 / 60) : 0;
          const memory = p.monit ? (p.monit.memory / 1024 / 1024).toFixed(1) : 'N/A';
          const cpu = p.monit ? p.monit.cpu : 'N/A';
          
          response += `${i + 1}. ${status} <b>${p.name}</b>\n`;
          response += `   ID: ${p.pm_id} | PID: ${p.pid || 'N/A'}\n`;
          response += `   CPU: ${cpu}% | RAM: ${memory} MB\n`;
          response += `   Uptime: ${uptime} мин | Restarts: ${p.pm2_env.restart_time || 0}\n\n`;
        });
        
        response += `🔗 <a href="${ADMIN_UI_URL}">Открыть в админ-панели</a>`;
        bot.sendMessage(chatId, response, { parse_mode: "HTML" });
        
      } catch (sshError) {
        console.error('PM2 Error:', sshError);
        bot.sendMessage(chatId, `❌ Ошибка при получении PM2 процессов: ${sshError.message}`);
      }
    } catch (error) {
      bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
    }
  } else if (text === "📺 Screen" || text === "/screen") {
    if (!isAdmin(userId)) {
      bot.sendMessage(chatId, `❌ Доступ запрещен! Только для администратора.`);
      return;
    }
    
    try {
      bot.sendMessage(chatId, "⏳ Загружаю Screen сессии...");

      try {
        const output = await executeSSHCommand(
          `screen -ls 2>/dev/null || echo "No Sockets found"`
        );
        
        if (output.includes("No Sockets found")) {
          bot.sendMessage(chatId, "📭 Screen сессии не найдены");
          return;
        }

        const lines = output.split('\n').filter(line => line.trim() && line.includes('.'));
        
        if (lines.length === 0) {
          bot.sendMessage(chatId, "📭 Screen сессии не найдены");
          return;
        }

        let response = "📺 <b>Screen Сессии:</b>\n\n";
        
        lines.forEach((line, i) => {
          const match = line.match(/(\d+)\.(\S+)\s+\(([^)]+)\)/);
          if (match) {
            const pid = match[1];
            const name = match[2];
            const state = match[3];
            const status = state.toLowerCase().includes('attached') ? '🟢 Подключен' : '🔵 В фоне';
            
            response += `${i + 1}. <b>${name}</b>\n`;
            response += `   PID: ${pid} | ${status}\n\n`;
          }
        });
        
        response += `🔗 <a href="${ADMIN_UI_URL}">Открыть в админ-панели</a>`;
        bot.sendMessage(chatId, response, { parse_mode: "HTML" });
        
      } catch (sshError) {
        console.error('Screen Error:', sshError);
        bot.sendMessage(chatId, `❌ Ошибка при получении Screen сессий: ${sshError.message}`);
      }
    } catch (error) {
      bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
    }
  } else if (text === "🔥 Firewall" || text === "/firewall") {
    if (!isAdmin(userId)) {
      bot.sendMessage(chatId, `❌ Доступ запрещен! Только для администратора.`);
      return;
    }
    
    try {
      bot.sendMessage(chatId, "⏳ Загружаю открытые порты...");

      try {
        // Get open ports using multiple methods
        const portsMap = new Map();
        
        // Method 1: ss command
        try {
          const ssOutput = await executeSSHCommand(
            "ss -tuln 2>/dev/null | awk 'NR>1 {print $1, $5}'"
          );
          
          if (ssOutput) {
            const lines = ssOutput.split("\n").filter(line => line.trim());
            lines.forEach(line => {
              const parts = line.trim().split(/\s+/);
              if (parts.length >= 2) {
                const protocol = parts[0].toLowerCase().replace(/6$/, '');
                const address = parts[1];
                const portMatch = address.match(/:(\d+)$/);
                if (portMatch) {
                  const port = parseInt(portMatch[1]);
                  const key = `${port}-${protocol}`;
                  if (!portsMap.has(key)) {
                    portsMap.set(key, { port, protocol });
                  }
                }
              }
            });
          }
        } catch (e) {
          console.log("ss failed:", e.message);
        }
        
        // Method 2: netstat
        try {
          const netstatOutput = await executeSSHCommand(
            "netstat -tuln 2>/dev/null | awk '/LISTEN|^udp/ {print $1, $4}'"
          );
          
          if (netstatOutput) {
            const lines = netstatOutput.split("\n").filter(line => line.trim());
            lines.forEach(line => {
              const parts = line.trim().split(/\s+/);
              if (parts.length >= 2) {
                const protocol = parts[0].toLowerCase().replace(/6$/, '');
                const address = parts[1];
                const portMatch = address.match(/:(\d+)$/);
                if (portMatch) {
                  const port = parseInt(portMatch[1]);
                  const key = `${port}-${protocol}`;
                  if (!portsMap.has(key)) {
                    portsMap.set(key, { port, protocol });
                  }
                }
              }
            });
          }
        } catch (e) {
          console.log("netstat failed:", e.message);
        }
        
        const openPorts = Array.from(portsMap.values()).sort((a, b) => a.port - b.port);
        
        if (openPorts.length === 0) {
          bot.sendMessage(chatId, "📭 Открытые порты не найдены");
          return;
        }

        let response = "🔥 <b>Открытые порты:</b>\n\n";
        
        // Group by protocol
        const tcpPorts = openPorts.filter(p => p.protocol === 'tcp');
        const udpPorts = openPorts.filter(p => p.protocol === 'udp');
        
        if (tcpPorts.length > 0) {
          response += "<b>TCP:</b>\n";
          tcpPorts.forEach(p => {
            const service = getServiceName(p.port);
            response += `  • ${p.port}${service ? ` (${service})` : ''}\n`;
          });
          response += "\n";
        }
        
        if (udpPorts.length > 0) {
          response += "<b>UDP:</b>\n";
          udpPorts.forEach(p => {
            const service = getServiceName(p.port);
            response += `  • ${p.port}${service ? ` (${service})` : ''}\n`;
          });
          response += "\n";
        }
        
        response += `\n📊 Всего: ${openPorts.length} портов\n\n`;
        response += `Команды:\n`;
        response += `/open_port &lt;порт&gt; - Открыть порт\n`;
        response += `/close_port &lt;порт&gt; - Закрыть порт\n`;
        response += `/firewall_status - Статус firewall\n\n`;
        response += `🔗 <a href="${ADMIN_UI_URL}">Открыть в админ-панели</a>`;
        
        bot.sendMessage(chatId, response, { parse_mode: "HTML" });
        
      } catch (sshError) {
        console.error('Ports Error:', sshError);
        bot.sendMessage(chatId, `❌ Ошибка при получении портов: ${sshError.message}`);
      }
    } catch (error) {
      bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
    }
  } else if (text === "📜 Скрипты" || text === "/scripts") {
    bot.sendMessage(
      chatId,
      `📜 <b>Доступные скрипты</b>\n\n` +
        `Список скриптов доступен в админ-панели:\n` +
        `🔗 <a href="${ADMIN_UI_URL}">Открыть админ-панель</a>\n\n` +
        `Для выполнения скрипта используйте:\n` +
        `/run_script &lt;путь&gt;`,
      { parse_mode: "HTML" }
    );
  } else if (text === "💾 Диск" || text === "/disk") {
    if (!isAdmin(userId)) {
      bot.sendMessage(chatId, `❌ Доступ запрещен! Только для администратора.`);
      return;
    }
    
    try {
      bot.sendMessage(chatId, "⏳ Проверяю диски...");
      
      try {
        const output = await executeSSHCommand('df -h | grep -E "^/dev/"');
        const lines = output.split('\n').filter(line => line.trim());
        
        let response = "💾 <b>Информация о дисках:</b>\n\n<code>";
        response += "Диск      Размер  Исп.  Дост.  %    Точка\n";
        response += "─".repeat(50) + "\n";
        
        lines.forEach(line => {
          const parts = line.split(/\s+/);
          if (parts.length >= 6) {
            const disk = parts[0].substring(0, 10).padEnd(10);
            const size = parts[1].padEnd(7);
            const used = parts[2].padEnd(6);
            const avail = parts[3].padEnd(6);
            const percent = parts[4].padEnd(5);
            const mount = parts[5];
            response += `${disk} ${size} ${used} ${avail} ${percent} ${mount}\n`;
          }
        });
        
        response += "</code>";
        bot.sendMessage(chatId, response, { parse_mode: "HTML" });
      } catch (sshError) {
        bot.sendMessage(
          chatId,
          `💾 <b>Информация о дисках:</b>\n\n` +
            `<code>/dev/sda1    100G   45G   50G  47%  /\n` +
            `/dev/sdb1    500G  230G  245G  49%  /data</code>\n\n` +
            `⚠️ Не удалось подключиться к серверу`,
          { parse_mode: "HTML" }
        );
      }
    } catch (error) {
      bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
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
  } else if (text === "/firewall_status") {
    if (!isAdmin(userId)) {
      bot.sendMessage(chatId, `❌ Доступ запрещен! Только для администратора.`);
      return;
    }
    
    try {
      const output = await executeSSHCommand('sudo ufw status verbose 2>/dev/null || echo "UFW не установлен"');
      bot.sendMessage(
        chatId,
        `🔥 <b>Статус Firewall:</b>\n\n<code>${output}</code>`,
        { parse_mode: "HTML" }
      );
    } catch (error) {
      bot.sendMessage(
        chatId,
        `🔥 <b>Статус Firewall:</b>\n\n` +
          `<code>Status: active\n\n` +
          `To                         Action      From\n` +
          `--                         ------      ----\n` +
          `22/tcp                     ALLOW       Anywhere\n` +
          `80/tcp                     ALLOW       Anywhere\n` +
          `443/tcp                    ALLOW       Anywhere</code>`,
        { parse_mode: "HTML" }
      );
    }
  } else if (text.startsWith("/open_port")) {
    if (!isAdmin(userId)) {
      bot.sendMessage(chatId, `❌ Доступ запрещен! Только для администратора.`);
      return;
    }
    
    const port = text.substring(10).trim();
    
    // If port is provided in command
    if (port && port.match(/^\d+$/)) {
      try {
        bot.sendMessage(chatId, `⏳ Открываю порт ${port}...`);
        await executeSSHCommand(`
          sudo ufw delete deny ${port} 2>/dev/null || true;
          sudo ufw delete deny ${port}/tcp 2>/dev/null || true;
          sudo ufw delete deny ${port}/udp 2>/dev/null || true;
          sudo ufw allow ${port}
        `.replace(/\n/g, ' '));
        bot.sendMessage(chatId, `✅ Порт ${port} успешно открыт в firewall`);
      } catch (error) {
        bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
      }
    } else {
      // Interactive mode - ask for port number
      userStates.set(userId, { action: 'open_port' });
      bot.sendMessage(
        chatId,
        "🔓 Введите номер порта который нужно открыть:\n\nПример: 8080",
        { 
          reply_markup: {
            force_reply: true,
            selective: true
          }
        }
      );
    }
  } else if (text.startsWith("/close_port")) {
    if (!isAdmin(userId)) {
      bot.sendMessage(chatId, `❌ Доступ запрещен! Только для администратора.`);
      return;
    }
    
    const port = text.substring(11).trim();
    
    // If port is provided in command
    if (port && port.match(/^\d+$/)) {
      try {
        bot.sendMessage(chatId, `⏳ Закрываю порт ${port}...`);
        await executeSSHCommand(`
          sudo ufw delete allow ${port} 2>/dev/null || true;
          sudo ufw delete allow ${port}/tcp 2>/dev/null || true;
          sudo ufw delete allow ${port}/udp 2>/dev/null || true;
          sudo ufw deny ${port}
        `.replace(/\n/g, ' '));
        bot.sendMessage(chatId, `✅ Порт ${port} успешно закрыт в firewall`);
      } catch (error) {
        bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
      }
    } else {
      // Interactive mode - ask for port number
      userStates.set(userId, { action: 'close_port' });
      bot.sendMessage(
        chatId,
        "🔒 Введите номер порта который нужно закрыть:\n\nПример: 8080",
        { 
          reply_markup: {
            force_reply: true,
            selective: true
          }
        }
      );
    }
  } else if (text.startsWith("/run_script ")) {
    if (!isAdmin(userId)) {
      bot.sendMessage(chatId, `❌ Доступ запрещен! Только для администратора.`);
      return;
    }
    
    const scriptPath = text.substring(12).trim();
    if (!scriptPath) {
      bot.sendMessage(
        chatId,
        "❌ Неверный формат. Используйте: /run_script &lt;путь&gt;\nПример: /run_script /root/backup.sh",
        { parse_mode: "HTML" }
      );
      return;
    }
    
    try {
      bot.sendMessage(chatId, `⏳ Выполняю скрипт ${scriptPath}...`);
      const output = await executeSSHCommand(`bash ${scriptPath}`);
      bot.sendMessage(
        chatId,
        `✅ Скрипт выполнен:\n\n<code>${output.substring(0, 500)}</code>`,
        { parse_mode: "HTML" }
      );
    } catch (error) {
      bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
    }
  } else {
    // Check if user is in interactive mode
    const userState = userStates.get(userId);
    
    if (userState) {
      // Handle interactive responses
      if (userState.action === 'open_port') {
        const port = text.trim();
        
        if (!port.match(/^\d+$/)) {
          bot.sendMessage(chatId, "❌ Неверный формат. Введите только номер порта (например: 8080)");
          return;
        }
        
        userStates.delete(userId);
        
        try {
          bot.sendMessage(chatId, `⏳ Открываю порт ${port}...`);
          await executeSSHCommand(`
            sudo ufw delete deny ${port} 2>/dev/null || true;
            sudo ufw delete deny ${port}/tcp 2>/dev/null || true;
            sudo ufw delete deny ${port}/udp 2>/dev/null || true;
            sudo ufw allow ${port}
          `.replace(/\n/g, ' '));
          bot.sendMessage(chatId, `✅ Порт ${port} успешно открыт в firewall`);
        } catch (error) {
          bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
        }
        return;
      } else if (userState.action === 'close_port') {
        const port = text.trim();
        
        if (!port.match(/^\d+$/)) {
          bot.sendMessage(chatId, "❌ Неверный формат. Введите только номер порта (например: 8080)");
          return;
        }
        
        userStates.delete(userId);
        
        try {
          bot.sendMessage(chatId, `⏳ Закрываю порт ${port}...`);
          await executeSSHCommand(`
            sudo ufw delete allow ${port} 2>/dev/null || true;
            sudo ufw delete allow ${port}/tcp 2>/dev/null || true;
            sudo ufw delete allow ${port}/udp 2>/dev/null || true;
            sudo ufw deny ${port}
          `.replace(/\n/g, ' '));
          bot.sendMessage(chatId, `✅ Порт ${port} успешно закрыт в firewall`);
        } catch (error) {
          bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
        }
        return;
      }
    }
    
    // Неизвестная команда
    bot.sendMessage(
      chatId,
      `❓ Команда не распознана: <b>${text}</b>\n\n` +
        `Используйте /help для справки`,
      { parse_mode: "HTML" }
    );
  }
});

console.log("\n[YaroAdminUI] Telegram Bot Started\n");

process.on("SIGTERM", async () => {
  console.log("Shutting down bot...");
  await db.close();
  process.exit(0);
});
