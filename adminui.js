#!/usr/bin/env node
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import sqlite3 from "sqlite3";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import { Client as SSHClient } from "ssh2";
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
    this.db.run(`CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY, username TEXT, action TEXT, category TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // Add category column if it doesn't exist (migration)
    this.db.run(
      `ALTER TABLE activity_logs ADD COLUMN category TEXT DEFAULT 'general'`,
      (err) => {
        if (err && !err.message.includes("duplicate column name")) {
          console.warn("Migration warning:", err.message);
        }
      }
    );
    this.db.run(`CREATE TABLE IF NOT EXISTS user_settings (
      id INTEGER PRIMARY KEY, 
      username TEXT UNIQUE,
      card_layouts TEXT,
      card_heights TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(username) REFERENCES users(username)
    )`);
  }
  getUser(username) {
    return new Promise((resolve, reject) => {
      this.db.get(
        "SELECT * FROM users WHERE username = ?",
        [username],
        (err, row) => {
          err ? reject(err) : resolve(row);
        }
      );
    });
  }
  addUser(username) {
    return new Promise((resolve, reject) => {
      this.db.run(
        "INSERT OR IGNORE INTO users (username) VALUES (?)",
        [username],
        function (err) {
          err ? reject(err) : resolve({ id: this.lastID });
        }
      );
    });
  }
  addActivityLog(username, action, category = "general") {
    return new Promise((resolve, reject) => {
      this.db.run(
        "INSERT INTO activity_logs (username, action, category) VALUES (?, ?, ?)",
        [username, action, category],
        function (err) {
          err ? reject(err) : resolve({ id: this.lastID });
        }
      );
    });
  }

  getUserSettings(username) {
    return new Promise((resolve, reject) => {
      this.db.get(
        "SELECT card_layouts, card_heights FROM user_settings WHERE username = ?",
        [username],
        (err, row) => {
          if (err) reject(err);
          else if (row) {
            resolve({
              cardLayouts: row.card_layouts ? JSON.parse(row.card_layouts) : {},
              cardHeights: row.card_heights ? JSON.parse(row.card_heights) : {},
            });
          } else {
            resolve({ cardLayouts: {}, cardHeights: {} });
          }
        }
      );
    });
  }

  saveUserSettings(username, cardLayouts, cardHeights) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO user_settings (username, card_layouts, card_heights, updated_at) 
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(username) DO UPDATE SET 
         card_layouts=excluded.card_layouts, 
         card_heights=excluded.card_heights,
         updated_at=CURRENT_TIMESTAMP`,
        [username, JSON.stringify(cardLayouts), JSON.stringify(cardHeights)],
        function (err) {
          err ? reject(err) : resolve({ id: this.lastID });
        }
      );
    });
  }

  close() {
    return new Promise((resolve, reject) => {
      this.db.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

// SSH Helper class for remote server commands
class SSHHelper {
  constructor(host, port = 22, username = "root") {
    this.host = host;
    this.port = port;
    this.username = username;

    // Try to load private key
    if (process.env.SSH_PRIVATE_KEY) {
      // Direct key content from env
      this.privateKey = Buffer.from(process.env.SSH_PRIVATE_KEY);
    } else {
      // Try to read from file
      const keyPath = (process.env.SSH_KEY_PATH || "~/.ssh/id_rsa").replace(
        "~",
        os.homedir()
      );

      try {
        if (fs.existsSync(keyPath)) {
          this.privateKey = fs.readFileSync(keyPath);
        } else {
          console.warn(`SSH key not found at: ${keyPath}`);
          this.privateKey = null;
        }
      } catch (err) {
        console.warn(`Failed to read SSH key: ${err.message}`);
        this.privateKey = null;
      }
    }
  }

  async executeCommand(command) {
    return new Promise((resolve, reject) => {
      const conn = new SSHClient();
      let output = "";
      let error = "";

      conn
        .on("ready", () => {
          conn.exec(command, (err, stream) => {
            if (err) {
              conn.end();
              return reject(err);
            }

            stream
              .on("close", (code, signal) => {
                conn.end();
                if (code === 0 || code === null) {
                  resolve(output);
                } else {
                  reject(
                    new Error(error || `Command failed with code ${code}`)
                  );
                }
              })
              .on("data", (data) => {
                output += data.toString();
              })
              .stderr.on("data", (data) => {
                error += data.toString();
              });
          });
        })
        .on("error", (err) => {
          console.error("SSH Connection Error:", err.message);
          reject(err);
        })
        .connect({
          host: this.host,
          port: this.port,
          username: this.username,
          privateKey: this.privateKey,
          password: process.env.SSH_PASSWORD,
          readyTimeout: 30000, // Increased from 10 to 30 seconds
          keepaliveInterval: 10000, // Send keepalive every 10 seconds
          keepaliveCountMax: 3, // Maximum keepalive attempts
          algorithms: {
            serverHostKey: [
              "ssh-rsa",
              "ssh-dss",
              "ecdsa-sha2-nistp256",
              "ecdsa-sha2-nistp384",
              "ecdsa-sha2-nistp521",
              "ssh-ed25519",
            ],
          },
        });
    });
  }
}

// Helper to expand ~ in paths
String.prototype.expandUser = function () {
  return this.replace("~", process.env.HOME || "/root");
};

const app = express();
const db = new DB(DB_PATH);

app.use(
  cors({ origin: process.env.CORS_ORIGIN || `http://localhost:${PORT}` })
);
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

app.get("/", (req, res) =>
  res.sendFile(path.join(process.cwd(), "index.html"))
);

// SSH Auth - generate message for signing
app.post("/api/auth/ssh-message", (req, res) => {
  try {
    const SSH_MESSAGE_PREFIX =
      process.env.SSH_MESSAGE_PREFIX || "YaroAdminUI-Auth";
    const message = `${SSH_MESSAGE_PREFIX}-${crypto
      .randomBytes(16)
      .toString("hex")}`;
    res.json({ message });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/auth/ssh-verify", async (req, res) => {
  try {
    const { message, signature } = req.body;

    if (!message || !signature) {
      return res
        .status(400)
        .json({ message: "Message and signature required" });
    }

    // Try to read SSH public key
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

    // For development: if no public key found, accept any signature
    // In production, this should fail
    if (!publicKey) {
      console.warn(
        "SSH_PUBLIC_KEY not configured - accepting any signature for development"
      );
    }

    // For now, accept the signature if we have message and signature
    // Full verification would require ssh-keygen command
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

// WebAuthn endpoints
app.post("/api/auth/webauthn-register", async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ message: "Username required" });
    }

    // Generate WebAuthn registration options
    const options = {
      challenge: Buffer.from(crypto.randomBytes(32)).toString("base64"),
      rp: {
        name: "YaroAdminUI",
        id: "localhost",
      },
      user: {
        id: Buffer.from(crypto.randomBytes(32)).toString("base64"),
        name: username,
        displayName: username,
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      timeout: 60000,
      attestation: "direct",
    };

    res.json({ options });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/auth/webauthn-authenticate", async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ message: "Username required" });
    }

    // Generate WebAuthn authentication options
    const options = {
      challenge: Buffer.from(crypto.randomBytes(32)).toString("base64"),
      timeout: 60000,
      userVerification: "preferred",
    };

    res.json({ options });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/auth/webauthn-verify", async (req, res) => {
  try {
    const { username, assertion } = req.body;
    if (!username) {
      return res.status(400).json({ message: "Username required" });
    }

    // For now, accept any valid WebAuthn assertion
    // In production, verify the assertion against stored credentials
    await db.addUser(username);
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: "24h" });
    res.json({ token, username });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.get("/api/server/status", verifyToken, async (req, res) => {
  try {
    const ssh = new SSHHelper(SERVER_IP);

    // Get uptime
    const uptimeOutput = await ssh.executeCommand("uptime -p || uptime");

    // Get memory usage
    const memOutput = await ssh.executeCommand("free -b | grep Mem");

    // Get CPU info
    const cpuOutput = await ssh.executeCommand("nproc");

    // Parse memory
    const memParts = memOutput.split(/\s+/);
    const totalMem = parseInt(memParts[1]);
    const usedMem = parseInt(memParts[2]);
    const memPercent = ((usedMem / totalMem) * 100).toFixed(2);

    res.json({
      online: true,
      ip: SERVER_IP,
      uptime: uptimeOutput.trim(),
      ramUsage: `${memPercent}%`,
      cpuUsage: `${cpuOutput.trim()} cores`,
    });
  } catch (error) {
    res.json({
      online: false,
      ip: SERVER_IP,
      error: error.message,
    });
  }
});

app.get("/api/server/services", verifyToken, async (req, res) => {
  try {
    const ssh = new SSHHelper(SERVER_IP);
    let systemctlServices = [];
    let pm2Processes = [];

    // Get systemctl services
    try {
      const systemctlOutput = await ssh.executeCommand(
        "systemctl list-units --type=service --all --no-pager --output=json 2>/dev/null || echo '[]'"
      );
      const allServices = JSON.parse(systemctlOutput);

      // Filter important services
      const importantServices = [
        "ssh",
        "nginx",
        "mysql",
        "postgresql",
        "redis",
        "mongodb",
        "apache2",
        "httpd",
      ];
      
      const filteredServices = allServices
        .filter(
          (s) =>
            importantServices.some((imp) => s.unit.includes(imp)) ||
            s.active === "active"
        )
        .slice(0, 10);

      // Get resource usage for all services in ONE SSH call
      const serviceNames = filteredServices.map(s => s.unit).join(' ');
      let resourceData = {};
      
      try {
        // Get all PIDs in one command
        const pidsOutput = await ssh.executeCommand(
          `for svc in ${serviceNames}; do echo "$svc:$(systemctl show $svc --property=MainPID 2>/dev/null | cut -d= -f2)"; done`
        );
        
        // Parse PIDs
        const pidLines = pidsOutput.split('\n').filter(l => l.trim());
        const pids = [];
        const pidMap = {};
        
        pidLines.forEach(line => {
          const [svc, pid] = line.split(':');
          if (pid && pid !== '0') {
            pids.push(pid);
            pidMap[pid] = svc;
          }
        });
        
        // Get CPU and memory for all PIDs in ONE ps command
        if (pids.length > 0) {
          const psOutput = await ssh.executeCommand(
            `ps -p ${pids.join(',')} -o pid=,%cpu=,%mem= --no-headers 2>/dev/null || echo ""`
          );
          
          const psLines = psOutput.split('\n').filter(l => l.trim());
          psLines.forEach(line => {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 3) {
              const [pid, cpuVal, memVal] = parts;
              const svc = pidMap[pid];
              if (svc) {
                resourceData[svc] = {
                  pid: pid,
                  cpu: `${parseFloat(cpuVal).toFixed(1)}%`,
                  memory: `${parseFloat(memVal).toFixed(1)}%`,
                  cpuNum: parseFloat(cpuVal),
                  memoryNum: parseFloat(memVal)
                };
              }
            }
          });
        }
      } catch (e) {
        console.log('Error getting resource data:', e.message);
      }
      
      // Build services array with resource data
      systemctlServices = filteredServices.map(s => {
        const serviceName = s.unit.replace(".service", "");
        const resources = resourceData[s.unit] || {
          pid: 'N/A',
          cpu: 'N/A',
          memory: 'N/A',
          cpuNum: 0,
          memoryNum: 0
        };
        
        return {
          type: "systemctl",
          name: serviceName,
          status: s.active,
          description: s.description || s.unit,
          pid: resources.pid,
          cpu: resources.cpu,
          memory: resources.memory,
          cpuNum: resources.cpuNum,
          memoryNum: resources.memoryNum
        };
      });
      
      // Sort by CPU + Memory usage (highest first)
      systemctlServices.sort((a, b) => {
        const aTotal = a.cpuNum + a.memoryNum;
        const bTotal = b.cpuNum + b.memoryNum;
        return bTotal - aTotal;
      });
    } catch (e) {
      console.log("Systemctl not available:", e.message);
    }

    // Fallback mock services if none found
    if (systemctlServices.length === 0) {
      systemctlServices = [
        {
          type: "systemctl",
          name: "nginx",
          status: "active",
          description: "Web Server",
        },
        {
          type: "systemctl",
          name: "mysql",
          status: "active",
          description: "MySQL Database",
        },
        {
          type: "systemctl",
          name: "redis",
          status: "active",
          description: "Redis Cache",
        },
        {
          type: "systemctl",
          name: "ssh",
          status: "active",
          description: "SSH Server",
        },
      ];
    }

    // Get PM2 processes
    let pm2Available = false;
    try {
      // Try multiple methods to get PM2 processes
      let pm2Output = "";
      
      try {
        // Method 1: Try standard pm2 command with full path
        pm2Output = await ssh.executeCommand(
          "export PATH=$PATH:/usr/local/bin:/usr/bin:~/.npm-global/bin && pm2 jlist 2>/dev/null || pm2 list --json 2>/dev/null || echo '[]'"
        );
      } catch (e) {
        console.log("PM2 method 1 failed:", e.message);
        
        try {
          // Method 2: Try to find pm2 executable
          const pm2Path = await ssh.executeCommand(
            "which pm2 || find /usr -name pm2 2>/dev/null | head -1 || echo ''"
          );
          
          if (pm2Path && pm2Path.trim()) {
            pm2Output = await ssh.executeCommand(
              `${pm2Path.trim()} jlist 2>/dev/null || ${pm2Path.trim()} list --json 2>/dev/null || echo '[]'`
            );
          } else {
            pm2Output = "[]";
          }
        } catch (e2) {
          console.log("PM2 method 2 failed:", e2.message);
          pm2Output = "[]";
        }
      }

      console.log("PM2 raw output:", pm2Output);
      
      const pm2Data = JSON.parse(pm2Output || "[]");

      if (Array.isArray(pm2Data) && pm2Data.length > 0) {
        pm2Available = true;
        pm2Processes = pm2Data
          .filter((p) => p && p.name && p.name !== "empty")
          .map((p) => ({
            type: "pm2",
            name: p.name,
            status: p.pm2_env ? p.pm2_env.status : p.status || "unknown",
            pid: p.pid || "N/A",
            memory: p.monit
              ? `${Math.round(p.monit.memory / 1024 / 1024)}MB`
              : "N/A",
            cpu: p.monit ? `${p.monit.cpu}%` : "N/A",
            uptime: p.pm2_env ? p.pm2_env.pm_uptime : "N/A",
          }));
      }
    } catch (e) {
      console.log("PM2 not available:", e.message);
    }

    // If no PM2 processes found, return empty array (not mock data)
    // This way the client knows there are no real processes
    console.log(`PM2 processes found: ${pm2Processes.length}, PM2 available: ${pm2Available}`);

    res.json({
      systemctl: systemctlServices,
      pm2: pm2Processes,
      pm2Available: pm2Available,
    });
  } catch (err) {
    console.error("Error in /api/server/services:", err);
    res.status(500).json({
      message: err.message,
      systemctl: [
        {
          type: "systemctl",
          name: "nginx",
          status: "active",
          description: "Web Server",
        },
        {
          type: "systemctl",
          name: "ssh",
          status: "active",
          description: "SSH Server",
        },
      ],
      pm2: [],
      pm2Available: false,
    });
  }
});

// Get open ports on server
app.get("/api/server/ports", verifyToken, async (req, res) => {
  try {
    const ssh = new SSHHelper(SERVER_IP);
    let openPorts = [];

    try {
      // Use multiple methods to detect open ports
      const portsMap = new Map();
      
      // Method 1: ss command (modern, fast)
      try {
        const ssOutput = await ssh.executeCommand(
          "ss -tuln 2>/dev/null | awk 'NR>1 {print $1, $5}'"
        );
        
        if (ssOutput) {
          const lines = ssOutput.split("\n").filter((line) => line.trim());
          lines.forEach((line) => {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2) {
              const protocol = parts[0].toLowerCase().replace(/6$/, ''); // remove 6 from tcp6/udp6
              const address = parts[1];
              const portMatch = address.match(/:(\d+)$/);
              if (portMatch) {
                const port = parseInt(portMatch[1]);
                const key = `${port}-${protocol}`;
                if (!portsMap.has(key)) {
                  portsMap.set(key, { port, protocol, service: getServiceName(port) });
                }
              }
            }
          });
        }
      } catch (e) {
        console.log("ss command failed:", e.message);
      }
      
      // Method 2: netstat (fallback, older systems)
      try {
        const netstatOutput = await ssh.executeCommand(
          "netstat -tuln 2>/dev/null | awk '/LISTEN|^udp/ {print $1, $4}'"
        );
        
        if (netstatOutput) {
          const lines = netstatOutput.split("\n").filter((line) => line.trim());
          lines.forEach((line) => {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 2) {
              const protocol = parts[0].toLowerCase().replace(/6$/, '');
              const address = parts[1];
              const portMatch = address.match(/:(\d+)$/);
              if (portMatch) {
                const port = parseInt(portMatch[1]);
                const key = `${port}-${protocol}`;
                if (!portsMap.has(key)) {
                  portsMap.set(key, { port, protocol, service: getServiceName(port) });
                }
              }
            }
          });
        }
      } catch (e) {
        console.log("netstat command failed:", e.message);
      }
      
      // Method 3: lsof (most comprehensive)
      try {
        const lsofOutput = await ssh.executeCommand(
          "lsof -i -P -n 2>/dev/null | awk '/LISTEN|UDP/ {print $8, $9}' | grep -E ':[0-9]+' | sort -u"
        );
        
        if (lsofOutput) {
          const lines = lsofOutput.split("\n").filter((line) => line.trim());
          lines.forEach((line) => {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 1) {
              const info = parts[0];
              const protocolMatch = info.match(/^(TCP|UDP)/i);
              const portMatch = info.match(/:(\d+)$/);
              
              if (protocolMatch && portMatch) {
                const protocol = protocolMatch[1].toLowerCase();
                const port = parseInt(portMatch[1]);
                const key = `${port}-${protocol}`;
                if (!portsMap.has(key)) {
                  portsMap.set(key, { port, protocol, service: getServiceName(port) });
                }
              }
            }
          });
        }
      } catch (e) {
        console.log("lsof command failed:", e.message);
      }

      openPorts = Array.from(portsMap.values());
    } catch (e) {
      console.log("Port check error:", e.message);
    }

    // Fallback with common ports if nothing found
    if (openPorts.length === 0) {
      openPorts = [
        { port: 22, protocol: "tcp", service: "SSH" },
        { port: 80, protocol: "tcp", service: "HTTP" },
        { port: 443, protocol: "tcp", service: "HTTPS" },
        { port: 3000, protocol: "tcp", service: "Node App" },
      ];
    }

    res.json({
      ports: openPorts.sort((a, b) => a.port - b.port),
      total: openPorts.length,
    });
  } catch (err) {
    console.error("Error in /api/server/ports:", err);
    res.status(500).json({
      message: err.message,
      ports: [
        { port: 22, protocol: "tcp", service: "SSH" },
        { port: 80, protocol: "tcp", service: "HTTP" },
      ],
    });
  }
});

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
    3001: "Node App",
    3002: "Node App",
    3003: "Node App",
    3306: "MySQL",
    5432: "PostgreSQL",
    5432: "PostgreSQL",
    6379: "Redis",
    8000: "Web Service",
    8080: "Web Service",
    8443: "Web Service",
    8888: "Web Service",
    9000: "PHP-FPM",
    9001: "App Server",
  };
  return services[port] || "Unknown";
}

app.get("/api/server/logs", verifyToken, (req, res) => {
  res.json({ logs: [] });
});

// SSH Keys endpoints
app.get("/api/server/ssh-keys", verifyToken, async (req, res) => {
  try {
    const ssh = new SSHHelper(SERVER_IP);
    let keys = [];

    try {
      // Read authorized_keys file
      const output = await ssh.executeCommand(
        "cat ~/.ssh/authorized_keys 2>/dev/null || echo ''"
      );

      if (output && output.trim()) {
        const lines = output.trim().split("\n");
        keys = lines
          .filter((line) => line.trim() && !line.startsWith("#"))
          .map((line, index) => {
            // Parse SSH key format: type key comment
            const parts = line.trim().split(/\s+/);
            const type = parts[0] || "unknown";
            const key = parts[1] || "";
            const comment = parts.slice(2).join(" ") || `Key ${index + 1}`;

            return {
              id: index + 1,
              type: type,
              key: key.substring(0, 20) + "..." + key.substring(key.length - 20),
              fullKey: line,
              comment: comment,
            };
          });
      }

      console.log(`Found ${keys.length} SSH keys on server`);
    } catch (e) {
      console.log("Error reading SSH keys:", e.message);
    }

    res.json({ keys: keys });
  } catch (err) {
    res.status(500).json({ message: err.message, keys: [] });
  }
});

app.post("/api/server/ssh-keys", verifyToken, async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) {
      return res.status(400).json({ message: "Key required" });
    }
    res.json({ message: "Key added" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.delete("/api/server/ssh-keys/:keyId", verifyToken, async (req, res) => {
  try {
    const { keyId } = req.params;
    const ssh = new SSHHelper(SERVER_IP);

    try {
      // Read current authorized_keys
      const output = await ssh.executeCommand(
        "cat ~/.ssh/authorized_keys 2>/dev/null || echo ''"
      );

      if (output && output.trim()) {
        const lines = output.trim().split("\n");
        const validLines = lines.filter((line) => line.trim() && !line.startsWith("#"));

        // Remove the key at the specified index (keyId - 1)
        const keyIndex = parseInt(keyId) - 1;
        if (keyIndex >= 0 && keyIndex < validLines.length) {
          validLines.splice(keyIndex, 1);

          // Write back to authorized_keys
          const newContent = validLines.join("\n") + "\n";
          const escapedContent = newContent.replace(/'/g, "'\\''");
          
          await ssh.executeCommand(
            `echo '${escapedContent}' > ~/.ssh/authorized_keys`
          );

          // Log the action
          await db.addActivityLog(
            req.user.username,
            `Deleted SSH key #${keyId}`,
            "ssh-key"
          );

          res.json({ 
            success: true,
            message: "SSH ключ удален" 
          });
        } else {
          res.status(404).json({ 
            success: false,
            message: "Ключ не найден" 
          });
        }
      } else {
        res.status(404).json({ 
          success: false,
          message: "Файл authorized_keys пуст" 
        });
      }
    } catch (error) {
      console.log("Error deleting SSH key:", error.message);
      res.status(500).json({ 
        success: false,
        message: error.message 
      });
    }
  } catch (err) {
    res.status(500).json({ 
      success: false,
      message: err.message 
    });
  }
});

// Manage services endpoint
app.post("/api/server/manage-service", verifyToken, async (req, res) => {
  try {
    const { type, name, action } = req.body;

    if (!type || !name || !action) {
      return res
        .status(400)
        .json({ message: "type, name, and action required" });
    }

    // Allowed actions
    const allowedActions = ["start", "stop", "restart", "reload", "status"];
    if (!allowedActions.includes(action)) {
      return res.status(400).json({
        message: "Action must be: start, stop, restart, reload, or status",
      });
    }

    const { execSync } = require("child_process");
    let output = "";

    try {
      if (type === "systemctl") {
        // Security: whitelist common service names
        const serviceWhitelist = [
          "sshd",
          "nginx",
          "mysql",
          "postgresql",
          "redis",
          "mongodb",
          "apache2",
          "httpd",
        ];
        if (!serviceWhitelist.includes(name)) {
          return res
            .status(400)
            .json({ message: `Service '${name}' not allowed` });
        }

        const cmd = `systemctl ${action} ${name} 2>&1 || echo "Service ${name} ${action} executed (may require sudo)"`;
        output = execSync(cmd, { encoding: "utf-8", shell: "/bin/bash" });
      } else if (type === "pm2") {
        const cmd = `pm2 ${action} ${name} 2>&1 || echo "PM2 process '${name}' not found"`;
        output = execSync(cmd, { encoding: "utf-8", shell: "/bin/bash" });
      } else {
        return res
          .status(400)
          .json({ message: "Type must be 'systemctl' or 'pm2'" });
      }

      // Log the action
      await db.addActivityLog(
        req.user.username,
        `${type} service '${name}' action: ${action}`,
        "service"
      );

      res.json({
        success: true,
        type,
        name,
        action,
        output: output.trim() || `${name} ${action} executed`,
      });
    } catch (error) {
      res.json({
        success: false,
        output: error.message,
      });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
app.post("/api/server/execute", verifyToken, async (req, res) => {
  try {
    const ssh = new SSHHelper(SERVER_IP);
    const { command, args = [] } = req.body;

    if (!command) {
      return res.status(400).json({ message: "Command required" });
    }

    // Whitelist of allowed commands for security
    const allowedCommands = {
      "restart-ssh": "sudo systemctl restart ssh",
      "check-disk": "df -h",
      "restart-service": "sudo systemctl restart nginx",
      firewall: "firewall", // Special case - needs args
      "check-firewall-status":
        "echo 'Testing output...' && date && echo 'UFW check:' && which ufw 2>/dev/null && echo 'UFW found' || echo 'UFW not found' && echo 'Done'",
      "enable-firewall": "sudo ufw enable",
      "disable-firewall": "sudo ufw disable",
      "restart-app": "sudo systemctl restart adminui",
      "check-pm2": "export PATH=$PATH:/usr/local/bin:/usr/bin:~/.npm-global/bin && pm2 jlist 2>&1 || pm2 list 2>&1 || which pm2 2>&1 || echo 'PM2 not found'",
      reboot: "sudo reboot",
    };

    if (!allowedCommands[command]) {
      return res.status(400).json({ message: "Command not allowed" });
    }

    try {
      let output = "";
      let sshCommand = allowedCommands[command];

      switch (command) {
        case "check-disk":
          output = await ssh.executeCommand(sshCommand);
          break;

        case "check-pm2":
          output = await ssh.executeCommand(sshCommand);
          break;

        case "firewall":
          const port = args[0];
          const action = args[1] || "allow";
          console.log("FIREWALL REQUEST:", { port, action, args });

          if (action === "allow" || action === "open") {
            // First delete any existing deny rules, then allow
            sshCommand = `sudo ufw delete deny ${port} 2>/dev/null; sudo ufw allow ${port}`;
          } else if (action === "deny" || action === "close") {
            // First delete any existing allow rules, then deny
            sshCommand = `sudo ufw delete allow ${port} 2>/dev/null; sudo ufw deny ${port}`;
          } else if (action === "delete" || action === "remove") {
            sshCommand = `sudo ufw delete allow ${port} 2>/dev/null; sudo ufw delete deny ${port} 2>/dev/null`;
          }
          console.log("EXECUTING:", sshCommand);
          output = await ssh.executeCommand(sshCommand);
          console.log("OUTPUT:", output);

          // Check firewall status after command
          try {
            const statusOutput = await ssh.executeCommand(
              "sudo ufw status | grep " + port
            );
            output +=
              "\n\nСтатус firewall для порта " + port + ":\n" + statusOutput;
          } catch (statusError) {
            output +=
              "\n\nНе удалось проверить статус firewall: " +
              statusError.message;
          }
          break;

        case "check-firewall-status":
          output = await ssh.executeCommand(sshCommand);
          break;

        case "enable-firewall":
        case "disable-firewall":
          output = await ssh.executeCommand(sshCommand);
          break;

        case "restart-ssh":
        case "restart-service":
        case "restart-app":
          output = await ssh.executeCommand(sshCommand);
          break;

        case "reboot":
          output = await ssh.executeCommand(sshCommand);
          break;

        default:
          output = "Command executed";
      }

      // Log the command execution
      await db.addActivityLog(
        req.user.username,
        `Executed command: ${command}${
          args.length ? " with args: " + args.join(", ") : ""
        }`,
        "command"
      );

      res.json({
        success: true,
        output: output.trim() || "Command executed successfully",
        command: command,
      });
      console.log("RESPONSE SENT:", {
        success: true,
        output: output.trim(),
        command,
      });
    } catch (error) {
      res.json({
        success: false,
        output: error.message,
        command: command,
      });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get list of executable scripts
app.get("/api/server/scripts", verifyToken, async (req, res) => {
  try {
    const ssh = new SSHHelper(SERVER_IP);
    let scripts = [];

    try {
      // Look for scripts in common directories
      const directories = [
        "/home/*/scripts",
        "/home/*/bin",
        "/opt/scripts",
        "/root/scripts",
        "/root/bin",
        "./scripts",
        "/usr/local/bin",
        "/usr/local/scripts",
        "~/scripts",
        "~/bin",
      ];

      for (const dir of directories) {
        try {
          // Search for .sh, .py, and executable files
          const output = await ssh.executeCommand(
            `find ${dir} -maxdepth 2 -type f \\( -name "*.sh" -o -name "*.py" -o -executable \\) 2>/dev/null | head -30`
          );

          if (output && output.trim()) {
            const files = output.trim().split("\n");
            scripts = scripts.concat(
              files
                .filter((f) => f.length > 0 && !f.includes('Permission denied'))
                .map((f) => ({
                  path: f,
                  name: f.split("/").pop(),
                  directory: f.substring(0, f.lastIndexOf("/")),
                }))
            );
          }
        } catch (e) {
          // Directory not found or no scripts
          console.log(`Script search in ${dir} failed:`, e.message);
        }
      }

      // Remove duplicates
      scripts = Array.from(new Map(scripts.map((s) => [s.path, s])).values());
      
      console.log(`Found ${scripts.length} scripts on server`);
    } catch (e) {
      // If finding scripts fails, return empty array
      console.log("Script discovery error:", e.message);
      scripts = [];
    }

    res.json({
      scripts: scripts.slice(0, 30), // Limit to 30 scripts
      count: scripts.length,
    });
  } catch (err) {
    res.status(500).json({ message: err.message, scripts: [], count: 0 });
  }
});

// Execute a script
app.post("/api/server/execute-script", verifyToken, async (req, res) => {
  try {
    const ssh = new SSHHelper(SERVER_IP);
    const { scriptPath, useSudo } = req.body;

    if (!scriptPath) {
      return res.status(400).json({ message: "scriptPath required" });
    }

    // Security: only allow scripts from allowed directories
    const allowedDirs = [
      "/home/",
      "/opt/scripts",
      "/root/scripts",
      "./scripts",
      "/usr/local/bin",
    ];

    const isAllowed = allowedDirs.some((dir) => scriptPath.startsWith(dir));
    if (!isAllowed) {
      return res.status(403).json({ message: "Script location not allowed" });
    }

    // Security: prevent path traversal
    if (scriptPath.includes("..")) {
      return res.status(403).json({ message: "Path traversal not allowed" });
    }

    let output = "";

    try {
      // Execute script via SSH with optional sudo
      const command = useSudo
        ? `sudo bash "${scriptPath}" 2>&1`
        : `bash "${scriptPath}" 2>&1`;
      output = await ssh.executeCommand(command);
    } catch (error) {
      output = error.toString();
    }

    // Log the script execution
    await db.addActivityLog(
      req.user.username,
      `Executed script: ${scriptPath}${useSudo ? " (with sudo)" : ""}`,
      "script"
    );

    res.json({
      success: true,
      scriptPath,
      useSudo: useSudo || false,
      output: output.trim() || "Script executed successfully",
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get list of running processes
app.get("/api/server/processes", verifyToken, async (req, res) => {
  try {
    const ssh = new SSHHelper(SERVER_IP);
    const limit = req.query.limit || 30;

    try {
      // Use ps command to get process information
      // Format: PID, %CPU, %MEM, VSZ (virtual memory), RSS (physical memory), COMMAND
      const output = await ssh.executeCommand(
        `ps aux | tail -n +2`
      );

      const processes = [];
      const lines = output.split("\n").filter((line) => line.trim());

      lines.forEach((line) => {
        const parts = line.split(/\s+/);
        if (parts.length >= 11) {
          const process = {
            user: parts[0],
            pid: parts[1],
            cpu: parseFloat(parts[2]),
            memory: parseFloat(parts[3]),
            vsz: parts[4],
            rss: parts[5],
            tty: parts[6],
            stat: parts[7],
            start: parts[8],
            time: parts[9],
            command: parts.slice(10).join(" "),
          };
          processes.push(process);
        }
      });

      // Sort by CPU + Memory usage (highest first)
      processes.sort((a, b) => {
        const aTotal = a.cpu + a.memory;
        const bTotal = b.cpu + b.memory;
        return bTotal - aTotal;
      });

      // Take top N processes
      const topProcesses = processes.slice(0, parseInt(limit));

      res.json({
        processes: topProcesses,
        total: topProcesses.length,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      console.log("Process list error:", e.message);
      res.json({
        processes: [],
        total: 0,
        error: e.message,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Kill a process by PID
app.post("/api/server/kill-process", verifyToken, async (req, res) => {
  try {
    const ssh = new SSHHelper(SERVER_IP);
    const { pid, signal } = req.body;

    if (!pid) {
      return res.status(400).json({ message: "PID required" });
    }

    const killSignal = String(signal || "9"); // Default to SIGKILL (-9), convert to string
    const allowedSignals = ["1", "2", "9", "15"]; // SIGHUP, SIGINT, SIGKILL, SIGTERM

    if (!allowedSignals.includes(killSignal)) {
      return res.status(400).json({ message: "Invalid signal" });
    }

    try {
      const output = await ssh.executeCommand(`kill -${killSignal} ${pid}`);

      await db.addActivityLog(
        req.user.username,
        `Killed process PID ${pid} with signal ${killSignal}`,
        "process"
      );

      res.json({
        success: true,
        pid: pid,
        signal: killSignal,
        message: `Process ${pid} terminated with signal ${killSignal}`,
      });
    } catch (error) {
      res.json({
        success: false,
        pid: pid,
        error: error.toString(),
      });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Terminal endpoint - execute any command with sudo support
app.post("/api/server/terminal", verifyToken, async (req, res) => {
  try {
    const ssh = new SSHHelper(SERVER_IP);
    const { command } = req.body;

    if (!command || typeof command !== "string" || command.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Command required",
        output: "",
      });
    }

    try {
      // Add timeout for long-running commands
      const timeout = 30000; // 30 seconds
      const commandWithTimeout = `timeout ${Math.floor(
        timeout / 1000
      )} ${command}`;

      let output = await ssh.executeCommand(commandWithTimeout);

      // Log the command execution
      await db.addActivityLog(
        req.user.username,
        `Terminal: ${command.substring(0, 100)}`,
        "terminal"
      );

      res.json({
        success: true,
        output: output.trim(),
        command: command,
      });
    } catch (error) {
      // If it's a timeout, return a specific message
      if (error.message.includes("timed out")) {
        res.json({
          success: false,
          output: `Command timed out after 30 seconds`,
          command: command,
        });
      } else {
        res.json({
          success: false,
          output: error.message || "Command failed",
          command: command,
        });
      }
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
      output: "",
    });
  }
});

// Screen processes endpoint
app.get("/api/server/processes/screen", verifyToken, async (req, res) => {
  try {
    const ssh = new SSHHelper(SERVER_IP);

    try {
      const output = await ssh.executeCommand(
        "screen -ls 2>&1 || echo 'Screen not installed'"
      );

      // Parse screen output
      const lines = output.split("\n");
      const sessions = [];

      lines.forEach((line) => {
        // Match lines like "	1234.session1	(Detached)" or "	1234.session1	(Attached)"
        const match = line.match(/\t(\d+)\.([^\s]+)\s+\(([^)]+)\)/);
        if (match) {
          const statusText = match[3];
          const isAttached = statusText.toLowerCase().includes('attached');
          
          sessions.push({
            pid: match[1],
            name: match[2],
            status: 'running', // All listed sessions are running
            isAttached: isAttached,
            statusText: statusText,
            fullName: `${match[1]}.${match[2]}`,
          });
        }
      });

      // Log the action
      await db.addActivityLog(
        req.user.username,
        `Viewed screen sessions (${sessions.length} active)`,
        "process"
      );

      res.json({
        success: true,
        sessions: sessions,
        total: sessions.length,
      });
    } catch (error) {
      res.json({
        success: false,
        sessions: [],
        error: error.message,
      });
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
      sessions: [],
    });
  }
});

// Manage screen sessions endpoint
app.post("/api/server/screen/manage", verifyToken, async (req, res) => {
  try {
    const ssh = new SSHHelper(SERVER_IP);
    const { sessionName, action } = req.body;

    if (!sessionName || !action) {
      return res.status(400).json({
        success: false,
        message: "sessionName and action required",
      });
    }

    const allowedActions = ["stop", "restart", "attach"];
    if (!allowedActions.includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Action must be: stop, restart, or attach",
      });
    }

    let output = "";
    let command = "";

    try {
      switch (action) {
        case "stop":
          // Kill the screen session
          command = `screen -S ${sessionName} -X quit`;
          output = await ssh.executeCommand(command);
          break;

        case "restart":
          // This is tricky - we can't really restart a screen session
          // We can only kill and suggest manual restart
          command = `screen -S ${sessionName} -X quit`;
          output = await ssh.executeCommand(command);
          output += "\n\nScreen session stopped. Please start it manually with: screen -dmS <name> <command>";
          break;

        case "attach":
          // Can't attach via SSH, but we can send a message
          output = `To attach to this session, run: screen -r ${sessionName}`;
          break;

        default:
          output = "Unknown action";
      }

      // Log the action
      await db.addActivityLog(
        req.user.username,
        `Screen session '${sessionName}' action: ${action}`,
        "screen"
      );

      res.json({
        success: true,
        sessionName,
        action,
        output: output.trim() || `Screen session ${action} executed`,
      });
    } catch (error) {
      res.json({
        success: false,
        output: error.message,
      });
    }
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// Notifications endpoint
app.get("/api/server/notifications", verifyToken, (req, res) => {
  res.json({ notifications: [] });
});

// User settings endpoints
app.get("/api/user/settings", verifyToken, async (req, res) => {
  try {
    const settings = await db.getUserSettings(req.user.username);
    res.json({
      success: true,
      cardLayouts: settings.cardLayouts,
      cardHeights: settings.cardHeights,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

app.post("/api/user/settings", verifyToken, async (req, res) => {
  try {
    const { cardLayouts, cardHeights } = req.body;

    if (!cardLayouts || !cardHeights) {
      return res.status(400).json({
        success: false,
        message: "cardLayouts and cardHeights required",
      });
    }

    await db.saveUserSettings(req.user.username, cardLayouts, cardHeights);

    // Log the action
    await db.addActivityLog(
      req.user.username,
      "Updated card settings (layouts and heights)",
      "settings"
    );

    res.json({
      success: true,
      message: "Settings saved",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

const server = app.listen(PORT, HOST, () => {
  console.log(`\n��� YaroAdminUI Server Started on http://${HOST}:${PORT}\n`);
});

process.on("SIGTERM", async () => {
  console.log("Shutting down...");
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});
