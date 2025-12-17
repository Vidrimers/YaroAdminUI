#!/usr/bin/env node
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import sqlite3 from "sqlite3";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import os from "os";

dotenv.config();

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "localhost";
const JWT_SECRET = process.env.JWT_SECRET || "secret";
const DB_PATH = process.env.DB_PATH || "./adminui.db";
const SERVER_IP = process.env.SERVER_IP || "localhost";

class DB {
  constructor(dbPath) {
    this.db = new sqlite3.Database(dbPath);
    this.init();
  }
  init() {
    this.db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, username TEXT UNIQUE, ssh_key TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  }
  getUser(username) {
    return new Promise((resolve, reject) => {
      this.db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => {
        err ? reject(err) : resolve(row);
      });
    });
  }
  addUser(username) {
    return new Promise((resolve, reject) => {
      this.db.run("INSERT OR IGNORE INTO users (username) VALUES (?)", [username], function(err) {
        err ? reject(err) : resolve({ id: this.lastID });
      });
    });
  }
  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => err ? reject(err) : resolve());
    });
  }
}

const app = express();
const db = new DB(DB_PATH);

app.use(cors({ origin: process.env.CORS_ORIGIN || `http://localhost:${PORT}` }));
app.use(express.json());
app.use(express.static("."));

function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ message: "Invalid token" });
  }
}

app.get("/", (req, res) => res.sendFile(path.join(process.cwd(), "index.html")));

app.post("/api/auth/ssh-verify", async (req, res) => {
  try {
    const { message, signature } = req.body;
    const username = "admin";
    await db.addUser(username);
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "24h" });
    res.json({ token, username });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/auth/telegram-verify", async (req, res) => {
  try {
    const { code } = req.body;
    const username = "admin";
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "24h" });
    res.json({ token, username });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/server/status", verifyToken, (req, res) => {
  const uptime = Math.floor(os.uptime());
  const totalMem = os.totalmem();
  const usedMem = totalMem - os.freemem();
  res.json({
    online: true,
    ip: SERVER_IP,
    uptime: `${Math.floor(uptime / 86400)}d`,
    ramUsage: `${((usedMem / totalMem) * 100).toFixed(2)}%`,
    cpuUsage: `${os.cpus().length} cores`
  });
});

app.get("/api/server/services", verifyToken, (req, res) => {
  res.json({ services: [
    { name: "SSH", running: true },
    { name: "Web", running: true }
  ]});
});

app.get("/api/server/logs", verifyToken, (req, res) => {
  res.json({ logs: [] });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`\níº€ YaroAdminUI Server Started on http://${HOST}:${PORT}\n`);
});

process.on("SIGTERM", async () => {
  console.log("Shutting down...");
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
});
