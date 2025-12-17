#!/usr/bin/env node

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import crypto from "crypto";
import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import os from "os";

dotenv.config();

// ==================== CONFIG ====================
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "localhost";
const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";
const DB_PATH = process.env.DB_PATH || "./adminui.db";
const SSH_MESSAGE_PREFIX = process.env.SSH_MESSAGE_PREFIX || "YaroAdminUI-Auth";
const SERVER_IP = process.env.SERVER_IP || "localhost";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_ADMIN_ID = process.env.TELEGRAM_ADMIN_ID;

// ==================== DATABASE ====================
class DatabaseManager {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.initializeTables();
  }

  initializeTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        ssh_public_key TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_login DATETIME
      );

      CREATE TABLE IF NOT EXISTS webauthn_credentials (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        credential_data BLOB NOT NULL,
        counter INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (username) REFERENCES users(username)
      );

      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        token TEXT NOT NULL,
        ip_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        FOREIGN KEY (username) REFERENCES users(username)
      );

      CREATE TABLE IF NOT EXISTS ssh_keys (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        public_key TEXT NOT NULL,
        comment TEXT,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (username) REFERENCES users(username)
      );

      CREATE TABLE IF NOT EXISTS activity_logs (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        details TEXT,
        ip_address TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (username) REFERENCES users(username)
      );

      CREATE TABLE IF NOT EXISTS telegram_codes (
        code TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        used INTEGER DEFAULT 0,
        FOREIGN KEY (username) REFERENCES users(username)
      );
    `);
  }

  addUser(username, sshPublicKey = null) {
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO users (username, ssh_public_key) VALUES (?, ?)"
    );
    return stmt.run(username, sshPublicKey);
  }

  getUser(username) {
    const stmt = this.db.prepare("SELECT * FROM users WHERE username = ?");
    return stmt.get(username);
  }

  addSSHKey(username, publicKey, comment = null) {
    const id = crypto.randomUUID();
    const stmt = this.db.prepare(
      "INSERT INTO ssh_keys (id, username, public_key, comment) VALUES (?, ?, ?, ?)"
    );
    return stmt.run(id, username, publicKey, comment);
  }

  getSSHKeys(username) {
    const stmt = this.db.prepare("SELECT * FROM ssh_keys WHERE username = ?");
    return stmt.all(username);
  }

  removeSSHKey(keyId) {
    const stmt = this.db.prepare("DELETE FROM ssh_keys WHERE id = ?");
    return stmt.run(keyId);
  }

  addActivityLog(username, action, details, ipAddress) {
    const id = crypto.randomUUID();
    const stmt = this.db.prepare(
      "INSERT INTO activity_logs (id, username, action, details, ip_address) VALUES (?, ?, ?, ?, ?)"
    );
    return stmt.run(id, username, action, details, ipAddress);
  }

  getActivityLogs(limit = 100) {
    const stmt = this.db.prepare(
      "SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT ?"
    );
    return stmt.all(limit);
  }

  addTelegramCode(username, code, expiresIn = 600) {
    const stmt = this.db.prepare(
      'INSERT INTO telegram_codes (code, username, expires_at) VALUES (?, ?, datetime("now", "+' +
        expiresIn +
        ' seconds"))'
    );
    return stmt.run(code, username);
  }

  verifyTelegramCode(code) {
    const stmt = this.db.prepare(
      'SELECT * FROM telegram_codes WHERE code = ? AND used = 0 AND datetime("now") < expires_at'
    );
    return stmt.get(code);
  }

  markCodeAsUsed(code) {
    const stmt = this.db.prepare(
      "UPDATE telegram_codes SET used = 1 WHERE code = ?"
    );
    return stmt.run(code);
  }

  close() {
    this.db.close();
  }
}

// ==================== SSH VERIFICATION ====================
class SSHVerifier {
  static generateMessage() {
    return `${SSH_MESSAGE_PREFIX}-${crypto.randomBytes(16).toString("hex")}`;
  }

  static verifySignature(message, signature, publicKey) {
    try {
      // Create a temporary file for the message
      const tmpDir = os.tmpdir();
      const msgFile = path.join(tmpDir, `msg-${Date.now()}.txt`);
      const sigFile = path.join(tmpDir, `sig-${Date.now()}.sig`);
      const keyFile = path.join(tmpDir, `key-${Date.now()}.pub`);

      fs.writeFileSync(msgFile, message);
      fs.writeFileSync(sigFile, signature, "base64");
      fs.writeFileSync(keyFile, publicKey);

      try {
        // Verify signature using ssh-keygen (requires OpenSSH >=8.2)
        execSync(
          `ssh-keygen -Y verify -f ${keyFile} -I YaroAdminUI-Auth -n YaroAdminUI-Auth < ${msgFile} > ${sigFile}`,
          {
            encoding: "utf-8",
          }
        );

        return true;
      } catch (error) {
        // If ssh-keygen verify fails, try alternative verification
        console.log("SSH verification method: trying alternative...");
        return false;
      } finally {
        // Clean up temp files
        [msgFile, sigFile, keyFile].forEach((file) => {
          try {
            fs.unlinkSync(file);
          } catch (e) {
            // Ignore cleanup errors
          }
        });
      }
    } catch (error) {
      console.error("SSH verification error:", error);
      return false;
    }
  }
}

// ==================== AUTH SERVICE ====================
class AuthService {
  constructor(dbManager) {
    this.db = dbManager;
  }

  generateSSHMessage() {
    return SSHVerifier.generateMessage();
  }

  verifySSHSignature(message, signature, publicKey) {
    return SSHVerifier.verifySignature(message, signature, publicKey);
  }

  generateToken(username) {
    return jwt.sign({ username }, JWT_SECRET, { expiresIn: "24h" });
  }

  verifyToken(token) {
    try {
      return jwt.verify(token, JWT_SECRET);
    } catch (error) {
      return null;
    }
  }

  authenticateSSH(message, signature, publicKey, ipAddress) {
    if (!this.verifySSHSignature(message, signature, publicKey)) {
      throw new Error("SSH подпись невалидна");
    }

    // Get username from public key comment or generate it
    const match = publicKey.match(/^[^\s]+ [^\s]+(?:\s(.+))?$/);
    const username = match && match[1] ? match[1].split("@")[0] : "admin";

    // Add user if not exists
    let user = this.db.getUser(username);
    if (!user) {
      this.db.addUser(username, publicKey);
    }

    // Update last login
    const stmt = this.db.db.prepare(
      "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE username = ?"
    );
    stmt.run(username);

    // Log activity
    this.db.addActivityLog(
      username,
      "SSH Login",
      `SSH ключ: ${publicKey.substring(0, 50)}...`,
      ipAddress
    );

    // Generate token
    const token = this.generateToken(username);

    return { token, username };
  }

  generateTelegramCode(username) {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    this.db.addTelegramCode(username, code);
    return code;
  }

  verifyTelegramCode(code) {
    const record = this.db.verifyTelegramCode(code);
    if (!record) {
      throw new Error("Неверный или истекший код");
    }

    this.db.markCodeAsUsed(code);
    const token = this.generateToken(record.username);

    return { token, username: record.username };
  }
}

// ==================== SERVER MANAGEMENT ====================
class ServerManager {
  static getServerStatus() {
    try {
      // Simple implementation - can be extended
      const uptime = Math.floor(os.uptime());
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const cpuCount = os.cpus().length;

      return {
        online: true,
        ip: SERVER_IP,
        uptime: `${Math.floor(uptime / 86400)}d ${Math.floor(
          (uptime % 86400) / 3600
        )}h`,
        ramUsage: `${((usedMem / totalMem) * 100).toFixed(2)}% (${(
          usedMem /
          1024 /
          1024 /
          1024
        ).toFixed(2)} GB)`,
        cpuUsage: `${cpuCount} cores`,
      };
    } catch (error) {
      return {
        online: false,
        ip: SERVER_IP,
        uptime: "N/A",
        ramUsage: "N/A",
        cpuUsage: "N/A",
      };
    }
  }

  static getServices() {
    // Mock services - implement based on your actual services
    return {
      services: [
        { name: "SSH", running: true },
        { name: "Nginx", running: true },
        { name: "Database", running: true },
      ],
    };
  }

  static executeCommand(command, args = []) {
    // Whitelist of allowed commands for security
    const allowedCommands = {
      "restart-ssh": ["systemctl", "restart", "sshd"],
      "check-disk": ["df", "-h"],
      "restart-service": ["systemctl", "restart", "nginx"],
    };

    if (!allowedCommands[command]) {
      throw new Error("Команда не разрешена");
    }

    try {
      const result = execSync(allowedCommands[command].join(" "), {
        encoding: "utf-8",
        timeout: 5000,
      });
      return { success: true, output: result };
    } catch (error) {
      return { success: false, output: error.message };
    }
  }
}

// ==================== MIDDLEWARE ====================
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "Токен не найден" });
  }

  const authService = req.app.get("authService");
  const payload = authService.verifyToken(token);

  if (!payload) {
    return res.status(401).json({ message: "Неверный токен" });
  }

  req.user = payload;
  next();
}

// ==================== EXPRESS APP ====================
const app = express();

// Middleware
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || `http://localhost:${PORT}`,
    credentials: true,
  })
);
app.use(express.json());
app.use(express.static("."));

// Initialize services
const dbManager = new DatabaseManager(DB_PATH);
const authService = new AuthService(dbManager);

app.set("authService", authService);
app.set("dbManager", dbManager);

// ==================== PUBLIC ROUTES ====================

// Static files
app.get("/", (req, res) => {
  res.sendFile(path.join(process.cwd(), "index.html"));
});

app.get("/adminui_client.js", (req, res) => {
  res.sendFile(path.join(process.cwd(), "adminui_client.js"));
});

// ==================== AUTH ROUTES ====================

app.post("/api/auth/ssh-message", (req, res) => {
  try {
    const message = authService.generateSSHMessage();
    res.json({ message });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/auth/ssh-verify", (req, res) => {
  try {
    const { message, signature } = req.body;

    if (!message || !signature) {
      return res.status(400).json({ message: "Отсутствуют обязательные поля" });
    }

    // For testing: use a default public key from /root/.ssh/id_rsa.pub
    let publicKey = process.env.SSH_PUBLIC_KEY;

    if (!publicKey) {
      try {
        const keyPath =
          process.env.SSH_KEY_PATH ||
          path.join(process.env.HOME || "/root", ".ssh", "id_rsa.pub");
        if (fs.existsSync(keyPath)) {
          publicKey = fs.readFileSync(keyPath, "utf-8").trim();
        }
      } catch (error) {
        console.error("Error reading SSH key:", error);
      }
    }

    if (!publicKey) {
      return res
        .status(500)
        .json({ message: "SSH ключ не сконфигурирован на сервере" });
    }

    const result = authService.authenticateSSH(
      message,
      signature,
      publicKey,
      req.ip
    );

    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
});

app.post("/api/auth/telegram-verify", (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ message: "Код не предоставлен" });
    }

    const result = authService.verifyTelegramCode(code);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
});

app.post("/api/auth/webauthn-register", (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res
        .status(400)
        .json({ message: "Имя пользователя не предоставлено" });
    }

    // Mock WebAuthn registration - needs proper implementation
    const options = {
      challenge: crypto.randomBytes(32).toString("base64"),
      rp: {
        name: "YaroAdminUI",
        id: "localhost",
      },
      user: {
        id: crypto.randomBytes(32).toString("base64"),
        name: username,
        displayName: username,
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      timeout: 60000,
      attestation: "direct",
    };

    res.json({ options });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/auth/webauthn-verify", (req, res) => {
  try {
    const { username } = req.body;

    // Mock WebAuthn verification - needs proper implementation
    const token = authService.generateToken(username);
    res.json({ token, username });
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
});

// ==================== PROTECTED ROUTES ====================

app.get("/api/server/status", authenticateToken, (req, res) => {
  try {
    const status = ServerManager.getServerStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/server/services", authenticateToken, (req, res) => {
  try {
    const services = ServerManager.getServices();
    res.json(services);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/server/execute", authenticateToken, (req, res) => {
  try {
    const { command, args } = req.body;

    dbManager.addActivityLog(
      req.user.username,
      `Execute: ${command}`,
      args?.join(" "),
      req.ip
    );

    const result = ServerManager.executeCommand(command, args);
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/server/ssh-keys", authenticateToken, (req, res) => {
  try {
    const keys = dbManager.getSSHKeys(req.user.username);
    res.json({ keys });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/api/server/ssh-keys", authenticateToken, (req, res) => {
  try {
    const { key } = req.body;

    if (!key || !key.trim()) {
      return res.status(400).json({ message: "Ключ не предоставлен" });
    }

    dbManager.addSSHKey(req.user.username, key.trim());
    dbManager.addActivityLog(
      req.user.username,
      "Add SSH Key",
      key.substring(0, 50),
      req.ip
    );

    res.json({ message: "Ключ добавлен" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.delete("/api/server/ssh-keys/:keyId", authenticateToken, (req, res) => {
  try {
    const { keyId } = req.params;

    dbManager.removeSSHKey(keyId);
    dbManager.addActivityLog(
      req.user.username,
      "Remove SSH Key",
      keyId,
      req.ip
    );

    res.json({ message: "Ключ удален" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/server/logs", authenticateToken, (req, res) => {
  try {
    const logs = dbManager.getActivityLogs(50);
    res.json({ logs });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/server/notifications", authenticateToken, (req, res) => {
  try {
    // Mock notifications
    res.json({ notifications: [] });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ==================== ERROR HANDLING ====================
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ message: "Внутренняя ошибка сервера" });
});

// ==================== SERVER START ====================
app.listen(PORT, HOST, () => {
  console.log(`
╔════════════════════════════════════════════╗
║       🚀 YaroAdminUI Server Started        ║
╠════════════════════════════════════════════╣
║ Host:     ${HOST.padEnd(41)}║
║ Port:     ${PORT.toString().padEnd(41)}║
║ DB:       ${DB_PATH.padEnd(41)}║
║ Env:      ${process.env.NODE_ENV?.padEnd(41)}║
╚════════════════════════════════════════════╝
  `);
  console.log(`Open http://${HOST}:${PORT} in your browser`);
  console.log("Use SSH key authentication or Telegram for login\n");
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully...");
  dbManager.close();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  dbManager.close();
  process.exit(0);
});
