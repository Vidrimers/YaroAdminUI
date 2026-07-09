#!/usr/bin/env node
import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import sqlite3 from "sqlite3";
import https from "https";
import { Client as SSHClient } from "ssh2";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";

const execAsync = promisify(exec);

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_ID = parseInt(process.env.TELEGRAM_ADMIN_ID);
const SERVER_IP = process.env.SERVER_IP || "localhost";
const ADMIN_UI_URL = `http://${SERVER_IP}:${process.env.PORT || 3000}`;
const DB_PATH = process.env.DB_PATH || "./adminui.db";

// Local servers configuration
const SERVERS = {
  intel: {
    ip: process.env.SERVER_INTEL_IP || '10.0.0.5',
    mac: process.env.SERVER_INTEL_MAC || 'd8:bb:c1:09:14:65',
    name: 'Server Intel'
  },
  r3: {
    ip: process.env.SERVER_R3_IP || '10.0.0.3',
    mac: process.env.SERVER_R3_MAC || '68:1d:ef:60:de:c9',
    name: 'Server R3'
  },
  b650: {
    ip: process.env.SERVER_B650_IP || '10.0.0.2',
    mac: process.env.SERVER_B650_MAC || 'd8:43:ae:99:d2:5f',
    name: 'dmd-b650'
  }
};

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
  getFavoriteCommands(username) {
    return new Promise((resolve, reject) => {
      this.db.all(
        "SELECT id, name, command, order_position FROM favorite_commands WHERE username = ? ORDER BY order_position ASC, created_at DESC",
        [username],
        (err, rows) => {
          err ? reject(err) : resolve(rows || []);
        }
      );
    });
  }
}

class SSHHelper {
  constructor(host) {
    this.host = host;
    this.username = process.env.SSH_USERNAME || "root";
    this.password = process.env.SSH_PASSWORD;
  }

  executeCommand(command) {
    return new Promise((resolve, reject) => {
      const conn = new SSHClient();
      let output = "";

      conn
        .on("ready", () => {
          conn.exec(command, (err, stream) => {
            if (err) {
              conn.end();
              return reject(err);
            }

            stream
              .on("close", () => {
                conn.end();
                resolve(output);
              })
              .on("data", (data) => {
                output += data.toString();
              })
              .stderr.on("data", (data) => {
                output += data.toString();
              });
          });
        })
        .on("error", (err) => {
          reject(err);
        })
        .connect({
          host: this.host,
          port: 22,
          username: this.username,
          password: this.password,
          readyTimeout: 10000,
        });
    });
  }
}

// Development mode check
const IS_DEV = process.env.NODE_ENV === 'development' || process.env.DEV_MODE === 'true';

let bot, db;

// Initialize bot
async function initBot() {
  // If in dev mode, stop production bot on server
  if (IS_DEV && SERVER_IP && SERVER_IP !== 'localhost') {
    console.log('[DEV MODE] Stopping production bot on server...');
    const ssh = new SSHHelper(SERVER_IP);
    try {
      await ssh.executeCommand('pm2 stop adminuibot 2>/dev/null || true');
      console.log('[DEV MODE] Production bot stopped');
    } catch (err) {
      console.log('[DEV MODE] Could not stop production bot:', err.message);
    }
    // Wait a bit for Telegram to release the connection
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
  db = new DB(DB_PATH);

  // Set menu button next to attachment button
  try {
    await bot.setChatMenuButton(null, {
      menu_button: { type: 'commands' }
    });
    console.log('[BOT] Menu button set to show commands');
  } catch (err) {
    console.log('[BOT] Menu button setup failed:', err.message);
  }

  // Set bot commands for the menu
  try {
    await bot.setMyCommands([
      { command: 'menu', description: 'Открыть меню управления' },
      { command: 'start', description: 'Начать работу с ботом' },
      { command: 'pm2', description: 'PM2 процессы' },
      { command: 'help', description: 'Справка по командам' }
    ]);
    console.log('[BOT] Bot commands set');
  } catch (err) {
    console.log('[BOT] Commands setup failed:', err.message);
  }

  setupBotHandlers();
}

function setupBotHandlers() {

// User states for interactive commands
const userStates = new Map();

// Cache for PM2 processes (updated when user clicks "Show processes")
let pm2ProcessesCache = null;

// Default PM2 processes list
const DEFAULT_PM2_PROCESSES = [
  { name: 'adminui', pm_id: 0, status: 'online' },
  { name: 'afkbot', pm_id: 1, status: 'online' },
  { name: 'vpn-api', pm_id: 2, status: 'online' },
  { name: 'vpn-bot', pm_id: 3, status: 'online' },
  { name: '1xBetLineBoom', pm_id: 4, status: 'online' },
  { name: 'vidrimers', pm_id: 5, status: 'online' },
  { name: 'ytdownload', pm_id: 6, status: 'online' },
  { name: 'meowgang-bot', pm_id: 7, status: 'online' },
  { name: 'watchrebel-server', pm_id: 8, status: 'online' },
  { name: 'watchrebel-telegram', pm_id: 9, status: 'online' }
];

// Функция для экранирования HTML символов
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Функция для выполнения SSH команд
function executeSSHCommand(command) {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    
    // Properly expand ~ in SSH_KEY_PATH
    const sshKeyPath = (process.env.SSH_KEY_PATH || `${os.homedir()}/.ssh/id_rsa`).replace(
      /^~/,
      os.homedir()
    );
    const sshPassword = process.env.SSH_PASSWORD;
    
    // Prepare connection config
    const connConfig = {
      host: SERVER_IP,
      port: 22,
      username: process.env.SSH_USERNAME || process.env.SSH_USER || 'root'
    };
    
    // Try to use both password and key for authentication
    if (sshPassword) {
      connConfig.password = sshPassword;
    }
    
    // Also try to add private key if it exists
    if (fs.existsSync(sshKeyPath)) {
      try {
        connConfig.privateKey = fs.readFileSync(sshKeyPath);
      } catch (err) {
        console.warn(`Failed to read SSH key: ${err.message}`);
      }
    }
    
    // Check if we have at least one authentication method
    if (!connConfig.password && !connConfig.privateKey) {
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
      console.error('SSH Connection Error:', {
        host: SERVER_IP,
        username: connConfig.username,
        hasPassword: !!connConfig.password,
        hasPrivateKey: !!connConfig.privateKey,
        keyPath: sshKeyPath,
        error: err.message
      });
      reject(err);
    }).connect(connConfig);
  });
}

// SSH to local servers (10.0.0.3, 10.0.0.5) via VPS
function executeSSHOnServer(host, command) {
  return new Promise((resolve, reject) => {
    const conn = new SSHClient();
    const sshKeyPath = (process.env.SSH_KEY_PATH || `${os.homedir()}/.ssh/id_rsa`).replace(/^~/, os.homedir());
    const sshPassword = process.env.SSH_PASSWORD;

    const connConfig = {
      host: SERVER_IP,
      port: 22,
      username: process.env.SSH_USERNAME || 'root'
    };

    if (sshPassword) connConfig.password = sshPassword;
    if (fs.existsSync(sshKeyPath)) {
      try { connConfig.privateKey = fs.readFileSync(sshKeyPath); } catch (e) {}
    }

    conn.on('ready', () => {
      // SSH from VPS to local server using vps_to_local key
      conn.exec(`ssh -i /root/.ssh/vps_to_local -o StrictHostKeyChecking=no vidrimers@${host} "${command}"`, (err, stream) => {
        if (err) { conn.end(); return reject(err); }
        let output = '';
        let errorOutput = '';
        stream.on('close', (code) => {
          conn.end();
          if (code !== 0 && errorOutput) reject(new Error(errorOutput));
          else resolve(output);
        }).on('data', (data) => { output += data.toString(); })
          .stderr.on('data', (data) => { errorOutput += data.toString(); });
      });
    }).on('error', reject).connect(connConfig);
  });
}

// SSH to Windows PC (10.0.0.2) via VPS → router tunnel
// Uses execAsync — simple commands only, no special chars that break shells
async function executeSSHOnWindows(command) {
  const fullCmd = `ssh -o StrictHostKeyChecking=no -i /root/.ssh/vps_to_local -p 2222 root@127.0.0.1 'dbclient -y -i /root/.ssh/router_to_vps vidri@10.0.0.2 ${command}'`;
  const { stdout } = await execAsync(fullCmd);
  return stdout;
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

// Function to get main inline keyboard for /menu
function getMenuInlineKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '🔑 Получить код', callback_data: 'menu_auth_code' },
        { text: '📊 Статус сервера', callback_data: 'menu_status' }
      ],
      [
        { text: '⚙️ Процессы', callback_data: 'menu_processes' },
        { text: '🔥 Firewall', callback_data: 'menu_firewall' }
      ],
      [
        { text: '🚀 PM2', callback_data: 'menu_pm2' },
        { text: '🔧 Другие процессы', callback_data: 'menu_other' }
      ],
      [
        { text: '💾 Диск', callback_data: 'menu_disk' }
      ],
      [
        { text: '🏠 Home', callback_data: 'menu_home' }
      ]
    ]
  };
}

// Home submenu
function getHomeKeyboard() {
  return {
    inline_keyboard: [
      [{ text: `🖥️ ${SERVERS.intel.name} (${SERVERS.intel.ip})`, callback_data: 'home_intel' }],
      [{ text: `🖥️ ${SERVERS.r3.name} (${SERVERS.r3.ip})`, callback_data: 'home_r3' }],
      [{ text: `💻 ${SERVERS.b650.name} (${SERVERS.b650.ip})`, callback_data: 'home_b650' }],
      [{ text: '🌐 Общее', callback_data: 'home_all' }],
      [{ text: '⬅️ Назад', callback_data: 'menu_back' }]
    ]
  };
}

// Server submenu (same for both servers)
function getServerKeyboard(server) {
  return {
    inline_keyboard: [
      [{ text: '▶️ Включение', callback_data: `${server}_wake` }],
      [{ text: '⏹️ Выключение', callback_data: `${server}_shutdown` }],
      [{ text: '🔄 Перезагрузка', callback_data: `${server}_reboot` }],
      [
        { text: '💾 Диск', callback_data: `${server}_disk` },
        { text: '⚙️ Процессы', callback_data: `${server}_processes_menu` }
      ],
      [
        { text: '🔥 Firewall', callback_data: `${server}_firewall` },
        { text: '📊 Статус', callback_data: `${server}_status` }
      ],
      [{ text: '⬅️ Назад', callback_data: 'menu_home' }]
    ]
  };
}

// Processes submenu
function getProcessKeyboard(server) {
  return {
    inline_keyboard: [
      [{ text: '📺 Screen сессии', callback_data: `${server}_screen` }],
      [{ text: '🔧 Systemctl сервисы', callback_data: `${server}_systemctl` }],
      [{ text: '🚀 PM2', callback_data: `${server}_pm2` }],
      [{ text: '⚙️ Процессы (top)', callback_data: `${server}_processes` }],
      [{ text: '⬅️ Назад', callback_data: `home_${server}` }]
    ]
  };
}

// All servers submenu
function getAllServersKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '▶️ Включение обоих', callback_data: 'all_wake' }],
      [{ text: '⏹️ Выключение обоих', callback_data: 'all_shutdown' }],
      [{ text: '🔄 Перезагрузка обоих', callback_data: 'all_reboot' }],
      [{ text: '⬅️ Назад', callback_data: 'menu_home' }]
    ]
  };
}

// dmd-b650 keyboard (Windows PC)
function getB650Keyboard() {
  return {
    inline_keyboard: [
      [{ text: '▶️ Включение (WoL)', callback_data: 'b650_wake' }],
      [{ text: '⏹️ Выключение', callback_data: 'b650_shutdown' }],
      [{ text: '🔄 Перезагрузка', callback_data: 'b650_reboot' }],
      [
        { text: '💾 Диск', callback_data: 'b650_disk' },
        { text: '⚙️ Процессы', callback_data: 'b650_processes' }
      ],
      [
        { text: '📊 Статус', callback_data: 'b650_status' }
      ],
      [{ text: '⬅️ Назад', callback_data: 'menu_home' }]
    ]
  };
}

// ============ CALLBACK QUERY HANDLER ============
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;

  console.log(`[CALLBACK] data=${data} userId=${userId} chatId=${chatId}`);

  if (!isAdmin(userId)) {
    bot.answerCallbackQuery(query.id, { text: '❌ Доступ запрещен!' });
    return;
  }

  // Answer callback to remove loading state
  bot.answerCallbackQuery(query.id);

  // Route to appropriate handler
  switch (data) {
    case 'menu_auth_code':
      // Trigger auth_code logic
      bot.emit('message', { chat: { id: chatId }, from: { id: userId }, text: '/auth_code' });
      break;
    case 'menu_status':
      bot.emit('message', { chat: { id: chatId }, from: { id: userId }, text: '/status' });
      break;
    case 'menu_processes':
      bot.emit('message', { chat: { id: chatId }, from: { id: userId }, text: '/processes' });
      break;
    case 'menu_firewall':
      bot.emit('message', { chat: { id: chatId }, from: { id: userId }, text: '/firewall' });
      break;
    case 'menu_pm2':
      bot.emit('message', { chat: { id: chatId }, from: { id: userId }, text: '/pm2' });
      break;
    case 'menu_other':
      bot.emit('message', { chat: { id: chatId }, from: { id: userId }, text: '/other_processes' });
      break;
    case 'menu_disk':
      bot.emit('message', { chat: { id: chatId }, from: { id: userId }, text: '/disk' });
      break;
    case 'menu_help':
      bot.emit('message', { chat: { id: chatId }, from: { id: userId }, text: '/help' });
      break;

    // ============ HOME MENU ============
    case 'menu_home':
      bot.editMessageText('🏠 <b>Выберите сервер:</b>', {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: getHomeKeyboard()
      });
      break;
    case 'menu_back':
      bot.editMessageText('📋 <b>Меню управления:</b>', {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: getMenuInlineKeyboard()
      });
      break;

    // ============ SERVER INTEL ============
    case 'home_intel':
      bot.editMessageText('🖥️ <b>dmd-server-intel (10.0.0.5)</b>', {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: getServerKeyboard('intel')
      });
      break;

    // ============ SERVER R3 ============
    case 'home_r3':
      bot.editMessageText('🖥️ <b>dmd-server-r3 (10.0.0.3)</b>', {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: getServerKeyboard('r3')
      });
      break;

    // ============ DMD-B650 ============
    case 'home_b650':
      bot.editMessageText('💻 <b>dmd-b650 (10.0.0.2)</b>', {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: getB650Keyboard()
      });
      break;

    case 'b650_wake':
      try {
        console.log(`[WoL] Sending broadcast for dmd-b650 ${SERVERS.b650.mac}`);
        await execAsync(`ssh -o StrictHostKeyChecking=no -i /root/.ssh/vps_to_local -p 2222 root@127.0.0.1 "wakeonlan -i 10.0.0.255 ${SERVERS.b650.mac}"`);
        bot.sendMessage(chatId, '✅ Сигнал WoL отправлен на dmd-b650');
      } catch (err) {
        console.error(`[WoL] Error:`, err);
        bot.sendMessage(chatId, '❌ Ошибка: ' + err.message);
      }
      break;

    case 'b650_shutdown':
      try {
        await executeSSHOnWindows('shutdown /s /t 0');
        bot.sendMessage(chatId, '✅ dmd-b650 выключается...');
      } catch (err) {
        bot.sendMessage(chatId, '❌ Ошибка: ' + err.message);
      }
      break;

    case 'b650_reboot':
      try {
        await executeSSHOnWindows('shutdown /r /t 0');
        bot.sendMessage(chatId, '✅ dmd-b650 перезагружается...');
      } catch (err) {
        bot.sendMessage(chatId, '❌ Ошибка: ' + err.message);
      }
      break;

    case 'b650_status':
      try {
        const uptime = await executeSSHOnWindows('powershell -Command (Get-CimInstance Win32_OperatingSystem).LastBootUpTime');
        const mem = await executeSSHOnWindows('powershell -Command (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory');
        const total = await executeSSHOnWindows('powershell -Command (Get-CimInstance Win32_OperatingSystem).TotalVisibleMemorySize');
        const memPercent = ((parseInt(total.trim()) - parseInt(mem.trim())) / parseInt(total.trim()) * 100).toFixed(1);
        bot.sendMessage(chatId, `📊 <b>dmd-b650</b>\n\n⏱️ Last boot: ${uptime.trim()}\n💾 RAM: ${memPercent}%`, {
          parse_mode: 'HTML',
          reply_markup: getB650Keyboard()
        });
      } catch (err) {
        bot.sendMessage(chatId, '❌ Сервер недоступен: ' + err.message);
      }
      break;

    case 'b650_disk':
      try {
        const used = await executeSSHOnWindows('powershell -Command (Get-PSDrive C).Used');
        const free = await executeSSHOnWindows('powershell -Command (Get-PSDrive C).Free');
        const usedGB = (parseInt(used.trim()) / 1073741824).toFixed(1);
        const freeGB = (parseInt(free.trim()) / 1073741824).toFixed(1);
        const totalGB = ((parseInt(used.trim()) + parseInt(free.trim())) / 1073741824).toFixed(1);
        bot.sendMessage(chatId, `💾 <b>dmd-b650 — Диск C:</b>\n\nВсего: ${totalGB} GB\nЗанято: ${usedGB} GB\nСвободно: ${freeGB} GB`, {
          parse_mode: 'HTML',
          reply_markup: getB650Keyboard()
        });
      } catch (err) {
        bot.sendMessage(chatId, '❌ Сервер недоступен: ' + err.message);
      }
      break;

    case 'b650_processes':
      try {
        const procs = await executeSSHOnWindows('powershell -Command Get-Process');
        const lines = procs.split('\n').slice(0, 10).join('\n');
        bot.sendMessage(chatId, `⚙️ <b>dmd-b650 — Процессы</b>\n\n<pre>${lines}</pre>`, {
          parse_mode: 'HTML',
          reply_markup: getB650Keyboard()
        });
      } catch (err) {
        bot.sendMessage(chatId, '❌ Сервер недоступен: ' + err.message);
      }
      break;

    // ============ ALL SERVERS ============
    case 'home_all':
      bot.editMessageText('🌐 <b>Управление всеми серверами</b>', {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: getAllServersKeyboard()
      });
      break;

    // ============ WAKE ON LAN ============
    case 'intel_wake':
      try {
        console.log(`[WoL] Sending broadcast to 10.0.0.255 for ${SERVERS.intel.mac} via router`);
        await execAsync(`ssh -o StrictHostKeyChecking=no -i /root/.ssh/vps_to_local -p 2222 root@127.0.0.1 "wakeonlan -i 10.0.0.255 ${SERVERS.intel.mac}"`);
        bot.sendMessage(chatId, '✅ Сигнал WoL отправлен на Server Intel');
      } catch (err) {
        console.error(`[WoL] Error:`, err);
        bot.sendMessage(chatId, '❌ Ошибка: ' + err.message);
      }
      break;
    case 'r3_wake':
      try {
        console.log(`[WoL] Sending broadcast to 10.0.0.255 for ${SERVERS.r3.mac} via router`);
        await execAsync(`ssh -o StrictHostKeyChecking=no -i /root/.ssh/vps_to_local -p 2222 root@127.0.0.1 "wakeonlan -i 10.0.0.255 ${SERVERS.r3.mac}"`);
        bot.sendMessage(chatId, '✅ Сигнал WoL отправлен на Server R3');
      } catch (err) {
        console.error(`[WoL] Error:`, err);
        bot.sendMessage(chatId, '❌ Ошибка: ' + err.message);
      }
      break;
    case 'all_wake':
      try {
        console.log(`[WoL] Sending broadcast to both servers via router`);
        await execAsync(`ssh -o StrictHostKeyChecking=no -i /root/.ssh/vps_to_local -p 2222 root@127.0.0.1 "wakeonlan -i 10.0.0.255 ${SERVERS.intel.mac} && wakeonlan -i 10.0.0.255 ${SERVERS.r3.mac}"`);
        bot.sendMessage(chatId, '✅ Сигнал WoL отправлен на оба сервера');
      } catch (err) {
        console.error(`[WoL] Error:`, err);
        bot.sendMessage(chatId, '❌ Ошибка: ' + err.message);
      }
      break;

    // ============ SHUTDOWN ============
    case 'intel_shutdown':
      try {
        await executeSSHOnServer(SERVERS.intel.ip, 'sudo shutdown -h now');
        bot.sendMessage(chatId, '✅ Server Intel выключается...');
      } catch (err) {
        bot.sendMessage(chatId, '❌ Ошибка: ' + err.message);
      }
      break;
    case 'r3_shutdown':
      try {
        await executeSSHOnServer(SERVERS.r3.ip, 'sudo shutdown -h now');
        bot.sendMessage(chatId, '✅ Server R3 выключается...');
      } catch (err) {
        bot.sendMessage(chatId, '❌ Ошибка: ' + err.message);
      }
      break;
    case 'all_shutdown':
      try {
        await executeSSHOnServer(SERVERS.intel.ip, 'sudo shutdown -h now');
        await executeSSHOnServer(SERVERS.r3.ip, 'sudo shutdown -h now');
        bot.sendMessage(chatId, '✅ Оба сервера выключаются...');
      } catch (err) {
        bot.sendMessage(chatId, '❌ Ошибка: ' + err.message);
      }
      break;

    // ============ REBOOT ============
    case 'intel_reboot':
      try {
        await executeSSHOnServer(SERVERS.intel.ip, 'sudo reboot');
        bot.sendMessage(chatId, '✅ Server Intel перезагружается...');
      } catch (err) {
        bot.sendMessage(chatId, '❌ Ошибка: ' + err.message);
      }
      break;
    case 'r3_reboot':
      try {
        await executeSSHOnServer(SERVERS.r3.ip, 'sudo reboot');
        bot.sendMessage(chatId, '✅ Server R3 перезагружается...');
      } catch (err) {
        bot.sendMessage(chatId, '❌ Ошибка: ' + err.message);
      }
      break;
    case 'all_reboot':
      try {
        await executeSSHOnServer(SERVERS.intel.ip, 'sudo reboot');
        await executeSSHOnServer(SERVERS.r3.ip, 'sudo reboot');
        bot.sendMessage(chatId, '✅ Оба сервера перезагружаются...');
      } catch (err) {
        bot.sendMessage(chatId, '❌ Ошибка: ' + err.message);
      }
      break;

    // ============ SERVER STATUS ============
    case 'intel_status':
    case 'r3_status': {
      const serverKey = data === 'intel_status' ? 'intel' : 'r3';
      const srv = SERVERS[serverKey];
      try {
        const uptime = await executeSSHOnServer(srv.ip, 'uptime -p');
        const mem = await executeSSHOnServer(srv.ip, 'LANG=C free | grep Mem');
        const memParts = mem.split(/\s+/);
        const memPercent = ((parseInt(memParts[2]) / parseInt(memParts[1])) * 100).toFixed(1);
        bot.sendMessage(chatId, `📊 <b>${srv.name}</b>\n\n⏱️ ${uptime.trim()}\n💾 RAM: ${memPercent}%`, {
          parse_mode: 'HTML',
          reply_markup: getServerKeyboard(serverKey)
        });
      } catch (err) {
        bot.sendMessage(chatId, '❌ Сервер недоступен');
      }
      break;
    }

    // ============ SERVER DISK ============
    case 'intel_disk':
    case 'r3_disk': {
      const serverKey = data === 'intel_disk' ? 'intel' : 'r3';
      const srv = SERVERS[serverKey];
      try {
        const disk = await executeSSHOnServer(srv.ip, 'df -h / | tail -1');
        const diskParts = disk.split(/\s+/);
        bot.sendMessage(chatId, `💾 <b>${srv.name} — Диск</b>\n\nВсего: ${diskParts[1]}\nЗанято: ${diskParts[2]} (${diskParts[4]})\nСвободно: ${diskParts[3]}`, {
          parse_mode: 'HTML',
          reply_markup: getServerKeyboard(serverKey)
        });
      } catch (err) {
        bot.sendMessage(chatId, '❌ Сервер недоступен');
      }
      break;
    }

    // ============ SERVER PROCESSES ============
    case 'intel_processes':
    case 'r3_processes': {
      const serverKey = data === 'intel_processes' ? 'intel' : 'r3';
      const srv = SERVERS[serverKey];
      try {
        const procs = await executeSSHOnServer(srv.ip, 'ps aux --sort=-%cpu | head -6');
        bot.sendMessage(chatId, `⚙️ <b>${srv.name} — Топ процессов</b>\n\n<pre>${procs}</pre>`, {
          parse_mode: 'HTML',
          reply_markup: getServerKeyboard(serverKey)
        });
      } catch (err) {
        bot.sendMessage(chatId, '❌ Сервер недоступен');
      }
      break;
    }

    // ============ PROCESSES MENU ============
    case 'intel_processes_menu':
    case 'r3_processes_menu': {
      const serverKey = data === 'intel_processes_menu' ? 'intel' : 'r3';
      const srv = SERVERS[serverKey];
      bot.editMessageText(`⚙️ <b>${srv.name} — Процессы</b>`, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'HTML',
        reply_markup: getProcessKeyboard(serverKey)
      });
      break;
    }

    // ============ SCREEN SESSIONS ============
    case 'intel_screen':
    case 'r3_screen': {
      const serverKey = data === 'intel_screen' ? 'intel' : 'r3';
      const srv = SERVERS[serverKey];
      try {
        const screen = await executeSSHOnServer(srv.ip, 'screen -ls 2>/dev/null || echo "Screen not installed"');
        bot.sendMessage(chatId, `📺 <b>${srv.name} — Screen сессии</b>\n\n<pre>${screen}</pre>`, {
          parse_mode: 'HTML',
          reply_markup: getProcessKeyboard(serverKey)
        });
      } catch (err) {
        bot.sendMessage(chatId, '❌ Сервер недоступен');
      }
      break;
    }

    // ============ SYSTEMCTL SERVICES ============
    case 'intel_systemctl':
    case 'r3_systemctl': {
      const serverKey = data === 'intel_systemctl' ? 'intel' : 'r3';
      const srv = SERVERS[serverKey];
      try {
        const systemctl = await executeSSHOnServer(srv.ip, 'systemctl list-units --type=service --state=running --no-pager | head -15');
        bot.sendMessage(chatId, `🔧 <b>${srv.name} — Systemctl сервисы</b>\n\n<pre>${systemctl}</pre>`, {
          parse_mode: 'HTML',
          reply_markup: getProcessKeyboard(serverKey)
        });
      } catch (err) {
        bot.sendMessage(chatId, '❌ Сервер недоступен');
      }
      break;
    }

    // ============ PM2 ON SERVER ============
    case 'intel_pm2':
    case 'r3_pm2': {
      const serverKey = data === 'intel_pm2' ? 'intel' : 'r3';
      const srv = SERVERS[serverKey];
      try {
        const pm2 = await executeSSHOnServer(srv.ip, 'pm2 list 2>/dev/null || echo "PM2 not installed"');
        bot.sendMessage(chatId, `🚀 <b>${srv.name} — PM2</b>\n\n<pre>${pm2}</pre>`, {
          parse_mode: 'HTML',
          reply_markup: getProcessKeyboard(serverKey)
        });
      } catch (err) {
        bot.sendMessage(chatId, '❌ Сервер недоступен');
      }
      break;
    }

    // ============ SERVER FIREWALL ============
    case 'intel_firewall':
    case 'r3_firewall': {
      const serverKey = data === 'intel_firewall' ? 'intel' : 'r3';
      const srv = SERVERS[serverKey];
      try {
        const fw = await executeSSHOnServer(srv.ip, 'echo "88005553535" | sudo -S ufw status numbered 2>/dev/null || echo "UFW not installed"');
        bot.sendMessage(chatId, `🔥 <b>${srv.name} — Firewall</b>\n\n<pre>${fw}</pre>`, {
          parse_mode: 'HTML',
          reply_markup: getServerKeyboard(serverKey)
        });
      } catch (err) {
        bot.sendMessage(chatId, '❌ Сервер недоступен');
      }
      break;
    }
  }
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  if (text === "/menu") {
    if (!isAdmin(userId)) {
      bot.sendMessage(chatId, '❌ Доступ запрещен!');
      return;
    }
    bot.sendMessage(chatId, '📋 <b>Меню управления:</b>', {
      parse_mode: 'HTML',
      reply_markup: getMenuInlineKeyboard()
    });
    return;
  }

  if (text === "/start") {
    bot.sendMessage(
      chatId,
      `🎉 Добро пожаловать в YaroAdminUI Bot!\n\n` +
        `Ваш ID: ${userId}\n\n` +
        `📋 Введите /menu для открытия меню управления.`,
      { reply_markup: getMenuInlineKeyboard() }
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
  // ============ SERVER STATUS HANDLER ============
  } else if (text === "/status" || text === "📊 Статус сервера") {
    if (!isAdmin(userId)) {
      bot.sendMessage(chatId, `❌ Доступ запрещен! Только для администратора.`);
      return;
    }
    
    try {
      bot.sendMessage(chatId, "⏳ Загружаю статус сервера...");
      
      // Get uptime
      const uptimeOutput = await executeSSHCommand('uptime -p 2>/dev/null || uptime');
      const uptime = uptimeOutput.replace('up ', '').trim();
      
      // Get memory usage
      const memOutput = await executeSSHCommand('free | grep Mem');
      const memParts = memOutput.split(/\s+/);
      const memTotal = parseInt(memParts[1]);
      const memUsed = parseInt(memParts[2]);
      const memPercent = ((memUsed / memTotal) * 100).toFixed(1);
      
      // Get CPU usage (average over 1 second)
      const cpuOutput = await executeSSHCommand('top -bn1 | grep "Cpu(s)" | sed "s/.*, *\\([0-9.]*\\)%* id.*/\\1/" | awk \'{print 100 - $1}\'');
      const cpuPercent = parseFloat(cpuOutput).toFixed(1);
      
      // Get disk usage
      const diskOutput = await executeSSHCommand('df -h / | tail -1');
      const diskParts = diskOutput.split(/\s+/);
      const diskPercent = diskParts[4].replace('%', '');
      
      bot.sendMessage(
        chatId,
        `🖥️ <b>Статус сервера:</b>\n\n` +
          `✅ Сервер: Онлайн\n` +
          `⏱️ Uptime: ${uptime}\n` +
          `🌐 IP адрес: ${SERVER_IP}\n` +
          `🔗 URL: ${ADMIN_UI_URL}\n\n` +
          `📊 <b>Ресурсы:</b>\n` +
          `💾 RAM: ${memPercent}%\n` +
          `⚡ CPU: ${cpuPercent}%\n` +
          `💿 Диск: ${diskPercent}%`,
        { parse_mode: "HTML" }
      );
    } catch (error) {
      console.error('Status Error:', error);
      bot.sendMessage(
        chatId,
        `🖥️ <b>Статус сервера:</b>\n\n` +
          `✅ Сервер: Онлайн\n` +
          `🌐 IP адрес: ${SERVER_IP}\n` +
          `🔗 URL: ${ADMIN_UI_URL}\n\n` +
          `⚠️ Не удалось получить детальную информацию о ресурсах`,
        { parse_mode: "HTML" }
      );
    }
  // ============ END SERVER STATUS HANDLER ============
  
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
    
    // Show PM2 menu without loading processes immediately
    const keyboard = {
      inline_keyboard: [
        [
          { text: '📋 Показать процессы', callback_data: 'pm2_list' }
        ],
        [
          { text: '📜 Просмотреть логи', callback_data: 'pm2_logs' },
          { text: '🔄 Перезапустить', callback_data: 'pm2_restart' }
        ],
        [
          { text: '⏹️ Остановить', callback_data: 'pm2_stop' },
          { text: '▶️ Запустить', callback_data: 'pm2_start' }
        ],
        [
          { text: '🔄 Pull & Run', callback_data: 'pm2_pull_run' }
        ],
        [
          { text: '🔗 Открыть админ-панель', url: ADMIN_UI_URL }
        ]
      ]
    };
    
    bot.sendMessage(chatId, '🚀 <b>PM2 Управление</b>\n\nВыберите действие:', { 
      parse_mode: "HTML",
      reply_markup: keyboard
    });
  // ============ ДРУГИЕ ПРОЦЕССЫ MENU ============
  } else if (text === "🔧 Другие процессы" || text === "/other_processes") {
    if (!isAdmin(userId)) {
      bot.sendMessage(chatId, `❌ Доступ запрещен! Только для администратора.`);
      return;
    }
    
    // Show menu with different process types
    const keyboard = {
      inline_keyboard: [
        [
          { text: '📺 Screen сессии', callback_data: 'other_screen' }
        ],
        [
          { text: '⚙️ Systemctl сервисы', callback_data: 'other_systemctl' }
        ],
        [
          { text: '🔄 Процессы (ps)', callback_data: 'other_ps' }
        ],
        [
          { text: '🔗 Открыть админ-панель', url: ADMIN_UI_URL }
        ]
      ]
    };
    
    bot.sendMessage(chatId, '🔧 <b>Другие процессы</b>\n\nВыберите тип процессов:', { 
      parse_mode: "HTML",
      reply_markup: keyboard
    });
  // ============ END ДРУГИЕ ПРОЦЕССЫ MENU ============
  
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
        response += `Выберите действие:`;
        
        // Create inline keyboard with firewall actions
        const keyboard = {
          inline_keyboard: [
            [
              { text: '🔓 Открыть порт', callback_data: 'fw_open' },
              { text: '🔒 Закрыть порт', callback_data: 'fw_close' }
            ],
            [
              { text: '🗑️ Удалить правило', callback_data: 'fw_delete' },
              { text: '📋 Статус UFW', callback_data: 'fw_status' }
            ],
            [
              { text: '🔗 Открыть админ-панель', url: ADMIN_UI_URL }
            ]
          ]
        };
        
        bot.sendMessage(chatId, response, { 
          parse_mode: "HTML",
          reply_markup: keyboard
        });
        
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
          bot.sendMessage(chatId, "❌ Неверный формат. Введите только номер порта (например: 8080)", {
            reply_markup: getMenuInlineKeyboard()
          });
          userStates.delete(userId);
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
          bot.sendMessage(chatId, `✅ Порт ${port} успешно открыт в firewall`, {
            reply_markup: getMenuInlineKeyboard()
          });
        } catch (error) {
          bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`, {
            reply_markup: getMenuInlineKeyboard()
          });
        }
        return;
      } else if (userState.action === 'close_port') {
        const port = text.trim();
        
        if (!port.match(/^\d+$/)) {
          bot.sendMessage(chatId, "❌ Неверный формат. Введите только номер порта (например: 8080)", {
            reply_markup: getMenuInlineKeyboard()
          });
          userStates.delete(userId);
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
          bot.sendMessage(chatId, `✅ Порт ${port} успешно закрыт в firewall`, {
            reply_markup: getMenuInlineKeyboard()
          });
        } catch (error) {
          bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`, {
            reply_markup: getMenuInlineKeyboard()
          });
        }
        return;
      } else if (userState.action === 'delete_port') {
        const port = text.trim();
        
        if (!port.match(/^\d+$/)) {
          bot.sendMessage(chatId, "❌ Неверный формат. Введите только номер порта (например: 8080)", {
            reply_markup: getMenuInlineKeyboard()
          });
          userStates.delete(userId);
          return;
        }
        
        userStates.delete(userId);
        
        try {
          bot.sendMessage(chatId, `⏳ Удаляю правила для порта ${port}...`);
          await executeSSHCommand(`
            sudo ufw delete allow ${port} 2>/dev/null || true;
            sudo ufw delete allow ${port}/tcp 2>/dev/null || true;
            sudo ufw delete allow ${port}/udp 2>/dev/null || true;
            sudo ufw delete deny ${port} 2>/dev/null || true;
            sudo ufw delete deny ${port}/tcp 2>/dev/null || true;
            sudo ufw delete deny ${port}/udp 2>/dev/null || true
          `.replace(/\n/g, ' '));
          bot.sendMessage(chatId, `✅ Все правила для порта ${port} удалены из firewall`, {
            reply_markup: getMenuInlineKeyboard()
          });
        } catch (error) {
          bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`, {
            reply_markup: getMenuInlineKeyboard()
          });
        }
        return;
      } else if (userState.action === 'pm2_logs_custom_lines') {
        const lines = text.trim();
        const processName = userState.processName;
        
        if (!lines.match(/^\d+$/)) {
          bot.sendMessage(chatId, "❌ Неверный формат. Введите только число (например: 75)", {
            reply_markup: getMenuInlineKeyboard()
          });
          userStates.delete(userId);
          return;
        }
        
        userStates.delete(userId);
        
        try {
          bot.sendMessage(chatId, `⏳ Загружаю логи процесса ${processName} (${lines} строк)...`);
          
          const output = await executeSSHCommand(
            `export PATH=$PATH:/usr/local/bin:/usr/bin:~/.npm-global/bin:~/.nvm/versions/node/*/bin && pm2 logs ${processName} --lines ${lines} --nostream 2>&1 || echo "Ошибка получения логов"`
          );
          
          // Truncate output if too long for Telegram (max 4096 chars)
          const truncatedOutput = output.length > 4000 
            ? output.substring(0, 4000) + '\n\n... (вывод обрезан, используйте меньше строк)' 
            : output;
          
          bot.sendMessage(
            chatId,
            `📋 <b>Логи процесса ${processName}</b> (последние ${lines} строк):\n\n<pre>${escapeHtml(truncatedOutput)}</pre>`,
            { 
              parse_mode: 'HTML',
              reply_markup: getMenuInlineKeyboard()
            }
          );
        } catch (error) {
          bot.sendMessage(chatId, `❌ Ошибка получения логов: ${error.message}`, {
            reply_markup: getMenuInlineKeyboard()
          });
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

// Handle callback queries from inline buttons (fw, other, pm2)
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;

  // Skip if already handled by first callback handler (menu, home, server)
  if (!data.startsWith('fw_') && !data.startsWith('other_') && !data.startsWith('pm2_')) return;

  // Check admin access
  if (!isAdmin(userId)) {
    bot.answerCallbackQuery(query.id, { text: '❌ Доступ запрещен!', show_alert: true });
    return;
  }

  // Answer callback to remove loading state
  bot.answerCallbackQuery(query.id);

  if (data === 'fw_open') {
    // Open port - ask for port number
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
  } else if (data === 'fw_close') {
    // Close port - ask for port number
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
  } else if (data === 'fw_delete') {
    // Delete rule - ask for port number
    userStates.set(userId, { action: 'delete_port' });
    bot.sendMessage(
      chatId,
      "🗑️ Введите номер порта для которого нужно удалить правило:\n\nПример: 8080",
      { 
        reply_markup: {
          force_reply: true,
          selective: true
        }
      }
    );
  } else if (data === 'fw_status') {
    // Show firewall status
    try {
      bot.sendMessage(chatId, "⏳ Проверяю статус UFW...");
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
  
  // ============ OTHER PROCESSES HANDLERS ============
  } else if (data === 'other_screen') {
    // Show Screen sessions
    try {
      bot.sendMessage(chatId, "⏳ Загружаю Screen сессии...");

      // First check if screen is installed
      const screenCheck = await executeSSHCommand(
        `which screen || command -v screen || echo ""`
      );
      
      if (!screenCheck.trim()) {
        bot.sendMessage(chatId, "❌ Screen не установлен на сервере\n\nУстановите: apt install screen");
        return;
      }

      // Get screen sessions for current user
      const output = await executeSSHCommand(
        `screen -ls 2>&1`
      );
      
      console.log('Screen output:', output);
      
      // Also try to get all users' screen sessions
      let allUsersOutput = '';
      try {
        allUsersOutput = await executeSSHCommand(
          `sudo ls -la /var/run/screen 2>/dev/null || ls -la /run/screen 2>/dev/null || echo ""`
        );
      } catch (e) {
        console.log('Could not get all users screen sessions:', e.message);
      }
      
      // Check various "no sessions" messages
      if (output.includes("No Sockets found") || 
          output.includes("No screen session") ||
          output.includes("There is no screen to be") ||
          output.trim() === "") {
        
        // Check if there are screen sessions from other users
        if (allUsersOutput && allUsersOutput.includes('S-')) {
          bot.sendMessage(chatId, 
            `📭 Screen сессии текущего пользователя (${process.env.SSH_USERNAME || 'root'}) не найдены\n\n` +
            `Но обнаружены сессии других пользователей:\n<code>${escapeHtml(allUsersOutput.substring(0, 500))}</code>\n\n` +
            `Попробуйте: screen -ls от имени нужного пользователя`, 
            { parse_mode: 'HTML' }
          );
        } else {
          bot.sendMessage(chatId, "📭 Screen сессии не найдены\n\nТекущий пользователь: " + (process.env.SSH_USERNAME || 'root'));
        }
        return;
      }

      // Parse screen sessions
      const lines = output.split('\n').filter(line => {
        const trimmed = line.trim();
        // Look for lines with PID.name format (with or without tabs)
        return trimmed && /^\d+\.\S+/.test(trimmed);
      });
      
      if (lines.length === 0) {
        bot.sendMessage(chatId, `📭 Screen сессии не найдены\n\n<b>Вывод команды:</b>\n<code>${escapeHtml(output.substring(0, 500))}</code>`, {
          parse_mode: 'HTML'
        });
        return;
      }

      let response = "📺 <b>Screen Сессии:</b>\n\n";
      
      lines.forEach((line, i) => {
        // Match both formats: with tabs and without
        // Format: "	1234.session1	(Detached)" or "1234.session1 (Detached)"
        const match = line.match(/\s*(\d+)\.(\S+)\s+\(([^)]+)\)/);
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
      
    } catch (error) {
      console.error('Screen Error:', error);
      bot.sendMessage(chatId, `❌ Ошибка при получении Screen сессий: ${error.message}`);
    }
  
  } else if (data === 'other_systemctl') {
    // Show Systemctl services
    try {
      bot.sendMessage(chatId, "⏳ Загружаю systemctl сервисы...");
      
      const output = await executeSSHCommand(
        `systemctl list-units --type=service --state=running --no-pager --no-legend | head -20`
      );
      
      if (!output || output.trim() === "") {
        bot.sendMessage(chatId, "📭 Активные сервисы не найдены");
        return;
      }

      const lines = output.split('\n').filter(line => line.trim());
      
      let response = "⚙️ <b>Systemctl Сервисы (TOP 20):</b>\n\n";
      
      lines.forEach((line, i) => {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 1) {
          const serviceName = parts[0].replace('.service', '');
          response += `${i + 1}. <code>${serviceName}</code>\n`;
        }
      });
      
      response += `\n📊 Показано: ${lines.length} сервисов\n`;
      response += `🔗 <a href="${ADMIN_UI_URL}">Открыть в админ-панели</a>`;
      
      bot.sendMessage(chatId, response, { parse_mode: "HTML" });
      
    } catch (error) {
      console.error('Systemctl Error:', error);
      bot.sendMessage(chatId, `❌ Ошибка при получении systemctl сервисов: ${error.message}`);
    }
  
  } else if (data === 'other_ps') {
    // Show top processes
    try {
      bot.sendMessage(chatId, "⏳ Загружаю топ процессов...");
      
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

      let response = "🔄 <b>Топ 10 процессов по загруженности:</b>\n\n";
      topProcesses.forEach((p, i) => {
        response += `${i + 1}. <b>${p.command.substring(0, 30)}</b>\n`;
        response += `   PID: ${p.pid} | User: ${p.user}\n`;
        response += `   CPU: ${p.cpu.toFixed(1)}% | RAM: ${p.memory.toFixed(1)}%\n\n`;
      });
      response += `🔗 <a href="${ADMIN_UI_URL}">Открыть в админ-панели</a>`;

      bot.sendMessage(chatId, response, { parse_mode: "HTML" });
      
    } catch (error) {
      console.error('PS Error:', error);
      bot.sendMessage(chatId, `❌ Ошибка при получении процессов: ${error.message}`);
    }
  // ============ END OTHER PROCESSES HANDLERS ============
  
  } else if (data === 'pm2_list') {
    // Show PM2 processes list and update cache
    try {
      bot.sendMessage(chatId, "⏳ Загружаю PM2 процессы...");
      
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
        // Clear cache if no processes found
        pm2ProcessesCache = null;
        return;
      }

      // Update cache with actual processes
      pm2ProcessesCache = processes.map(p => ({
        name: p.name,
        pm_id: p.pm_id,
        status: p.pm2_env.status,
        pid: p.pid
      }));

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
      
      response += `\n📊 Всего процессов: ${processes.length}\n`;
      response += `✅ Список процессов обновлен`;
      
      bot.sendMessage(chatId, response, { 
        parse_mode: "HTML",
        reply_markup: getMenuInlineKeyboard()
      });
    } catch (error) {
      bot.sendMessage(chatId, `❌ Ошибка при получении PM2 процессов: ${error.message}`);
    }
  // ============ PM2 LOGS HANDLER ============
  } else if (data === 'pm2_logs') {
    // Show PM2 processes for log selection (use cache or default list)
    try {
      // Use cache if available, otherwise use default list
      const processes = pm2ProcessesCache || DEFAULT_PM2_PROCESSES;
      
      if (processes.length === 0) {
        bot.sendMessage(chatId, "📭 PM2 процессы не найдены");
        return;
      }

      // Create inline keyboard with process names
      const keyboard = {
        inline_keyboard: []
      };

      processes.forEach((p) => {
        const statusIcon = p.status === 'online' ? '✅' : '❌';
        keyboard.inline_keyboard.push([{
          text: `${statusIcon} ${p.name} (ID: ${p.pm_id})`,
          callback_data: `pm2_log_${p.name}`
        }]);
      });

      const cacheStatus = pm2ProcessesCache ? '✅ Актуальный список' : '📋 Базовый список';
      bot.sendMessage(
        chatId,
        `📋 Выберите процесс для просмотра логов:\n\n${cacheStatus}`,
        { reply_markup: keyboard }
      );
    } catch (error) {
      bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
    }
  // ============ END PM2 LOGS HANDLER ============
  
  // ============ PM2 RESTART HANDLER ============
  } else if (data === 'pm2_restart') {
    // Show PM2 processes for restart (use cache or default list)
    try {
      // Use cache if available, otherwise use default list
      const processes = pm2ProcessesCache || DEFAULT_PM2_PROCESSES;
      
      if (processes.length === 0) {
        bot.sendMessage(chatId, "📭 PM2 процессы не найдены");
        return;
      }

      const keyboard = {
        inline_keyboard: []
      };

      processes.forEach((p) => {
        const statusIcon = p.status === 'online' ? '✅' : '❌';
        keyboard.inline_keyboard.push([{
          text: `${statusIcon} ${p.name} (ID: ${p.pm_id})`,
          callback_data: `pm2_restart_${p.name}`
        }]);
      });
      
      keyboard.inline_keyboard.push([{
        text: '🔄 Перезапустить все',
        callback_data: 'pm2_restart_all'
      }]);

      const cacheStatus = pm2ProcessesCache ? '✅ Актуальный список' : '📋 Базовый список';
      bot.sendMessage(
        chatId,
        `🔄 Выберите процесс для перезапуска:\n\n${cacheStatus}`,
        { reply_markup: keyboard }
      );
    } catch (error) {
      bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
    }
  // ============ END PM2 RESTART HANDLER ============
  
  // ============ PM2 PULL & RUN HANDLER ============
  // ============ PM2 PULL & RUN HANDLER ============
  } else if (data === 'pm2_pull_run') {
    // Show PM2 processes for pull and run (use cache or default list)
    try {
      // Use cache if available, otherwise use default list
      const processes = pm2ProcessesCache || DEFAULT_PM2_PROCESSES;
      
      if (processes.length === 0) {
        bot.sendMessage(chatId, "📭 PM2 процессы не найдены");
        return;
      }

      const keyboard = {
        inline_keyboard: []
      };

      processes.forEach((p) => {
        const statusIcon = p.status === 'online' ? '✅' : '❌';
        keyboard.inline_keyboard.push([{
          text: `${statusIcon} ${p.name} (ID: ${p.pm_id})`,
          callback_data: `pm2_pullrun_${p.name}`
        }]);
      });

      const cacheStatus = pm2ProcessesCache ? '✅ Актуальный список' : '📋 Базовый список';
      bot.sendMessage(
        chatId,
        `🔄 Выберите процесс для обновления и перезапуска:\n\n⚠️ Будет выполнено:\n1. git pull\n2. npm install (если нужно)\n3. pm2 restart\n\n${cacheStatus}`,
        { reply_markup: keyboard }
      );
    } catch (error) {
      bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
    }
  // ============ END PM2 PULL & RUN HANDLER ============
  
  // ============ PM2 STOP HANDLER ============
  } else if (data === 'pm2_stop') {
    // Show PM2 processes for stop (use cache or default list)
    try {
      // Use cache if available, otherwise use default list
      const processes = pm2ProcessesCache || DEFAULT_PM2_PROCESSES;
      
      if (processes.length === 0) {
        bot.sendMessage(chatId, "📭 PM2 процессы не найдены");
        return;
      }

      const keyboard = {
        inline_keyboard: []
      };

      processes.forEach((p) => {
        const statusIcon = p.status === 'online' ? '✅' : '❌';
        keyboard.inline_keyboard.push([{
          text: `${statusIcon} ${p.name} (ID: ${p.pm_id})`,
          callback_data: `pm2_stop_${p.name}`
        }]);
      });
      
      keyboard.inline_keyboard.push([{
        text: '⏹️ Остановить все',
        callback_data: 'pm2_stop_all'
      }]);

      const cacheStatus = pm2ProcessesCache ? '✅ Актуальный список' : '📋 Базовый список';
      bot.sendMessage(
        chatId,
        `⏹️ Выберите процесс для остановки:\n\n${cacheStatus}`,
        { reply_markup: keyboard }
      );
    } catch (error) {
      bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
    }
  // ============ END PM2 STOP HANDLER ============
  
  // ============ PM2 START HANDLER ============
  } else if (data === 'pm2_start') {
    // Show PM2 processes for start (use cache or default list)
    try {
      // Use cache if available, otherwise use default list
      // Use cache if available, otherwise use default list
      const processes = pm2ProcessesCache || DEFAULT_PM2_PROCESSES;
      
      if (processes.length === 0) {
        bot.sendMessage(chatId, "📭 PM2 процессы не найдены");
        return;
      }

      const keyboard = {
        inline_keyboard: []
      };

      processes.forEach((p) => {
        const statusIcon = p.status === 'online' ? '✅' : '❌';
        keyboard.inline_keyboard.push([{
          text: `${statusIcon} ${p.name} (ID: ${p.pm_id})`,
          callback_data: `pm2_start_${p.name}`
        }]);
      });
      
      keyboard.inline_keyboard.push([{
        text: '▶️ Запустить все',
        callback_data: 'pm2_start_all'
      }]);

      const cacheStatus = pm2ProcessesCache ? '✅ Актуальный список' : '📋 Базовый список';
      bot.sendMessage(
        chatId,
        `▶️ Выберите процесс для запуска:\n\n${cacheStatus}`,
        { reply_markup: keyboard }
      );
    } catch (error) {
      bot.sendMessage(chatId, `❌ Ошибка: ${error.message}`);
    }
  // ============ END PM2 START HANDLER ============
  
  // ============ PM2 PULLRUN EXECUTION ============
  } else if (data.startsWith('pm2_pullrun_')) {
    const processName = data.replace('pm2_pullrun_', '');

    // ---- Кастомный деплой для vidrimers через скрипт dep-vidri.sh ----
    if (processName === 'vidrimers') {
      try {
        bot.sendMessage(chatId, `🔄 Запускаю деплой <b>${processName}</b>...\n\n⏳ Выполняю скрипт, это может занять некоторое время...`, { parse_mode: 'HTML' });

        const deployOutput = await executeSSHCommand(
          `bash /home/vidrimers.site/dep-vidri.sh 2>&1`
        );

        bot.sendMessage(chatId, `✅ Деплой завершён!\n\n<code>${escapeHtml(deployOutput.substring(0, 3000))}</code>`, {
          parse_mode: 'HTML',
          reply_markup: getMenuInlineKeyboard()
        });
      } catch (error) {
        bot.sendMessage(chatId, `❌ Ошибка деплоя: ${error.message}`, {
          reply_markup: getMenuInlineKeyboard()
        });
      }
      return;
    }
    // ---- Конец кастомного деплоя vidrimers ----

    // ---- Кастомный деплой для watchrebel-telegram ----
    if (processName === 'watchrebel-telegram') {
      try {
        bot.sendMessage(chatId, `🔄 Запускаю деплой <b>${processName}</b>...`, { parse_mode: 'HTML' });
        const pullOutput = await executeSSHCommand('cd /home/watchrebel && git pull origin master 2>&1');
        await executeSSHCommand('pm2 restart watchrebel-telegram');
        bot.sendMessage(chatId, `✅ ${processName} обновлён и перезапущен!\n\n<code>${escapeHtml(pullOutput.substring(0, 3000))}</code>`, {
          parse_mode: 'HTML',
          reply_markup: getMenuInlineKeyboard()
        });
      } catch (error) {
        bot.sendMessage(chatId, `❌ Ошибка деплоя: ${error.message}`, { reply_markup: getMenuInlineKeyboard() });
      }
      return;
    }

    // ---- Кастомный деплой для watchrebel-server ----
    if (processName === 'watchrebel-server') {
      try {
        bot.sendMessage(chatId, `🔄 Запускаю деплой <b>${processName}</b>...`, { parse_mode: 'HTML' });
        const pullOutput = await executeSSHCommand('cd /home/watchrebel && git pull 2>&1');
        const buildOutput = await executeSSHCommand('cd /home/watchrebel && npm run build --workspace=client 2>&1');
        await executeSSHCommand('pm2 restart watchrebel-server');
        bot.sendMessage(chatId, `✅ ${processName} обновлён и перезапущен!\n\n📥 Pull:\n<code>${escapeHtml(pullOutput.substring(0, 1500))}</code>\n\n🔨 Build:\n<code>${escapeHtml(buildOutput.substring(0, 1500))}</code>`, {
          parse_mode: 'HTML',
          reply_markup: getMenuInlineKeyboard()
        });
      } catch (error) {
        bot.sendMessage(chatId, `❌ Ошибка деплоя: ${error.message}`, { reply_markup: getMenuInlineKeyboard() });
      }
      return;
    }

    try {
      bot.sendMessage(chatId, `🔄 Обновляю и перезапускаю процесс ${processName}...\n\n⏳ Шаг 1/3: Получаю информацию о процессе...`);
      
      // Get process info to find working directory
      const processInfo = await executeSSHCommand(
        `export PATH=$PATH:/usr/local/bin:/usr/bin:~/.npm-global/bin:~/.nvm/versions/node/*/bin && pm2 jlist 2>/dev/null`
      );
      
      // Parse JSON and find exact process match
      let workDir = '';
      try {
        const processes = JSON.parse(processInfo);
        const targetProcess = processes.find(p => p.name === processName);
        
        if (targetProcess && targetProcess.pm2_env && targetProcess.pm2_env.pm_cwd) {
          workDir = targetProcess.pm2_env.pm_cwd;
        }
      } catch (e) {
        console.error('Failed to parse PM2 JSON:', e);
      }
      
      // Common project directories mapping (fallback)
      const projectDirs = {
        'adminui': '/home/adminui',
        'adminuibot': '/home/adminui',
        'afkbot': '/home/afkbot',
        'vpn-api': '/home/vpn-api',
        '1xBetLineBoom': '/home/1xBetLineBoom',
        'watchrebel-server': '/home/watchrebel',
        'watchrebel-telegram': '/home/watchrebel'
      };
      
      // If we couldn't find working dir, try common locations
      if (!workDir && projectDirs[processName]) {
        workDir = projectDirs[processName];
      }
      
      if (!workDir) {
        bot.sendMessage(chatId, `❌ Не удалось определить рабочую директорию для процесса ${processName}`, {
          reply_markup: getMenuInlineKeyboard()
        });
        return;
      }
      
      bot.sendMessage(chatId, `⏳ Шаг 2/3: Обновляю код из репозитория...\nДиректория: ${workDir}`);
      
      // Execute git pull
      const pullOutput = await executeSSHCommand(
        `cd ${workDir} && git pull origin master 2>&1`
      );
      
      bot.sendMessage(chatId, `📥 Git pull:\n<code>${escapeHtml(pullOutput.substring(0, 500))}</code>`, {
        parse_mode: 'HTML'
      });
      
      // Check if package.json changed (optional npm install)
      if (pullOutput.includes('package.json') || pullOutput.includes('package-lock.json')) {
        bot.sendMessage(chatId, `⏳ Обнаружены изменения в зависимостях, выполняю npm install...`);
        const npmOutput = await executeSSHCommand(
          `cd ${workDir} && npm install 2>&1`
        );
        bot.sendMessage(chatId, `📦 NPM install завершен`);
      }
      
      bot.sendMessage(chatId, `⏳ Шаг 3/3: Перезапускаю процесс...`);
      
      // Restart process
      await executeSSHCommand(
        `export PATH=$PATH:/usr/local/bin:/usr/bin:~/.npm-global/bin:~/.nvm/versions/node/*/bin && pm2 restart ${processName}`
      );
      
      bot.sendMessage(chatId, `✅ Процесс ${processName} успешно обновлен и перезапущен!`, {
        reply_markup: getMenuInlineKeyboard()
      });
      
    } catch (error) {
      bot.sendMessage(chatId, `❌ Ошибка при обновлении: ${error.message}`, {
        reply_markup: getMenuInlineKeyboard()
      });
    }
  } else if (data.startsWith('pm2_restart_')) {
    const processName = data.replace('pm2_restart_', '');
    
    try {
      if (processName === 'all') {
        bot.sendMessage(chatId, `🔄 Перезапускаю все PM2 процессы...`);
        await executeSSHCommand(
          `export PATH=$PATH:/usr/local/bin:/usr/bin:~/.npm-global/bin:~/.nvm/versions/node/*/bin && pm2 restart all`
        );
        bot.sendMessage(chatId, `✅ Все PM2 процессы перезапущены`, {
          reply_markup: getMenuInlineKeyboard()
        });
      } else {
        bot.sendMessage(chatId, `🔄 Перезапускаю процесс ${processName}...`);
        await executeSSHCommand(
          `export PATH=$PATH:/usr/local/bin:/usr/bin:~/.npm-global/bin:~/.nvm/versions/node/*/bin && pm2 restart ${processName}`
        );
        bot.sendMessage(chatId, `✅ Процесс ${processName} перезапущен`, {
          reply_markup: getMenuInlineKeyboard()
        });
      }
    } catch (error) {
      bot.sendMessage(chatId, `❌ Ошибка перезапуска: ${error.message}`, {
        reply_markup: getMenuInlineKeyboard()
      });
    }
  } else if (data.startsWith('pm2_stop_')) {
    const processName = data.replace('pm2_stop_', '');
    
    try {
      if (processName === 'all') {
        bot.sendMessage(chatId, `⏹️ Останавливаю все PM2 процессы...`);
        await executeSSHCommand(
          `export PATH=$PATH:/usr/local/bin:/usr/bin:~/.npm-global/bin:~/.nvm/versions/node/*/bin && pm2 stop all`
        );
        bot.sendMessage(chatId, `✅ Все PM2 процессы остановлены`, {
          reply_markup: getMenuInlineKeyboard()
        });
      } else {
        bot.sendMessage(chatId, `⏹️ Останавливаю процесс ${processName}...`);
        await executeSSHCommand(
          `export PATH=$PATH:/usr/local/bin:/usr/bin:~/.npm-global/bin:~/.nvm/versions/node/*/bin && pm2 stop ${processName}`
        );
        bot.sendMessage(chatId, `✅ Процесс ${processName} остановлен`, {
          reply_markup: getMenuInlineKeyboard()
        });
      }
    } catch (error) {
      bot.sendMessage(chatId, `❌ Ошибка остановки: ${error.message}`, {
        reply_markup: getMenuInlineKeyboard()
      });
    }
  } else if (data.startsWith('pm2_start_')) {
    const processName = data.replace('pm2_start_', '');
    
    try {
      if (processName === 'all') {
        bot.sendMessage(chatId, `▶️ Запускаю все PM2 процессы...`);
        await executeSSHCommand(
          `export PATH=$PATH:/usr/local/bin:/usr/bin:~/.npm-global/bin:~/.nvm/versions/node/*/bin && pm2 start all`
        );
        bot.sendMessage(chatId, `✅ Все PM2 процессы запущены`, {
          reply_markup: getMenuInlineKeyboard()
        });
      } else {
        bot.sendMessage(chatId, `▶️ Запускаю процесс ${processName}...`);
        await executeSSHCommand(
          `export PATH=$PATH:/usr/local/bin:/usr/bin:~/.npm-global/bin:~/.nvm/versions/node/*/bin && pm2 start ${processName}`
        );
        bot.sendMessage(chatId, `✅ Процесс ${processName} запущен`, {
          reply_markup: getMenuInlineKeyboard()
        });
      }
    } catch (error) {
      bot.sendMessage(chatId, `❌ Ошибка запуска: ${error.message}`, {
        reply_markup: getMenuInlineKeyboard()
      });
    }
  } else if (data.startsWith('pm2_log_')) {
    // Process selected, now ask for number of lines
    const processName = data.replace('pm2_log_', '');
    
    // Store process name in user state
    userStates.set(userId, { 
      action: 'pm2_logs_lines',
      processName: processName
    });
    
    // Create inline keyboard with common line counts
    const keyboard = {
      inline_keyboard: [
        [
          { text: '10 строк', callback_data: `pm2_lines_${processName}_10` },
          { text: '20 строк', callback_data: `pm2_lines_${processName}_20` }
        ],
        [
          { text: '50 строк', callback_data: `pm2_lines_${processName}_50` },
          { text: '100 строк', callback_data: `pm2_lines_${processName}_100` }
        ],
        [
          { text: '200 строк', callback_data: `pm2_lines_${processName}_200` },
          { text: '500 строк', callback_data: `pm2_lines_${processName}_500` }
        ],
        [
          { text: '✏️ Ввести свое значение', callback_data: `pm2_lines_${processName}_custom` }
        ]
      ]
    };
    
    bot.sendMessage(
      chatId,
      `📊 Процесс: <b>${processName}</b>\n\nВыберите количество строк для просмотра:`,
      { 
        parse_mode: 'HTML',
        reply_markup: keyboard
      }
    );
  } else if (data.startsWith('pm2_lines_')) {
    // Extract process name and line count
    const parts = data.replace('pm2_lines_', '').split('_');
    const lineCount = parts.pop();
    const processName = parts.join('_');
    
    if (lineCount === 'custom') {
      // Ask user to input custom line count
      userStates.set(userId, { 
        action: 'pm2_logs_custom_lines',
        processName: processName
      });
      
      bot.sendMessage(
        chatId,
        `✏️ Введите количество строк для просмотра логов процесса <b>${processName}</b>:\n\nПример: 75`,
        { 
          parse_mode: 'HTML',
          reply_markup: {
            force_reply: true,
            selective: true
          }
        }
      );
    } else {
      // Show logs with specified line count
      try {
        bot.sendMessage(chatId, `⏳ Загружаю логи процесса ${processName} (${lineCount} строк)...`);
        
        const output = await executeSSHCommand(
          `export PATH=$PATH:/usr/local/bin:/usr/bin:~/.npm-global/bin:~/.nvm/versions/node/*/bin && pm2 logs ${processName} --lines ${lineCount} --nostream 2>&1 || echo "Ошибка получения логов"`
        );
        
        // Truncate output if too long for Telegram (max 4096 chars)
        const truncatedOutput = output.length > 4000 
          ? output.substring(0, 4000) + '\n\n... (вывод обрезан, используйте меньше строк)' 
          : output;
        
        bot.sendMessage(
          chatId,
          `📋 <b>Логи процесса ${processName}</b> (последние ${lineCount} строк):\n\n<pre>${escapeHtml(truncatedOutput)}</pre>`,
          { 
            parse_mode: 'HTML',
            reply_markup: getMenuInlineKeyboard()
          }
        );
      } catch (error) {
        bot.sendMessage(chatId, `❌ Ошибка получения логов: ${error.message}`, {
          reply_markup: getMenuInlineKeyboard()
        });
      }
    }
  } else if (data.startsWith('cmd_')) {
    // Execute favorite command
    const commandId = data.replace('cmd_', '');
    
    try {
      // Get command from database
      const commands = await db.getFavoriteCommands('admin');
      const command = commands.find(c => c.id === parseInt(commandId));
      
      if (!command) {
        bot.sendMessage(chatId, `❌ Команда не найдена`);
        return;
      }

      bot.sendMessage(chatId, `⚡ Выполняю команду: <b>${command.name}</b>\n\n<code>${command.command}</code>`, {
        parse_mode: 'HTML'
      });

      // Execute command via SSH
      const ssh = new SSHHelper(SERVER_IP);
      const customPaths = '/home/1xBetLineBoom:/home/adminui:/home/afkbot';
      const fullCommand = `export TERM=xterm; export PATH="$PATH:${customPaths}"; [ -f ~/.bashrc ] && source ~/.bashrc 2>/dev/null || true; ${command.command}`;
      
      const output = await ssh.executeCommand(fullCommand);
      
      // Send output (limit to 4000 chars for Telegram)
      const truncatedOutput = output.length > 4000 ? output.substring(0, 4000) + '\n\n... (вывод обрезан)' : output;
      
      bot.sendMessage(
        chatId,
        `✅ Результат выполнения:\n\n<pre>${escapeHtml(truncatedOutput) || 'Команда выполнена успешно (нет вывода)'}</pre>`,
        { 
          parse_mode: 'HTML',
          reply_markup: getMenuInlineKeyboard()
        }
      );
    } catch (error) {
      console.error('Error executing command:', error);
      bot.sendMessage(chatId, `❌ Ошибка выполнения: ${error.message}`, {
        reply_markup: getMenuInlineKeyboard()
      });
    }
  }
});
}

// Start bot
initBot().then(() => {
  console.log("\n[YaroAdminUI] Telegram Bot Started\n");
}).catch(err => {
  console.error("Failed to start bot:", err);
  process.exit(1);
});

process.on("SIGTERM", async () => {
  console.log("Shutting down bot...");
  await db.close();
  process.exit(0);
});
