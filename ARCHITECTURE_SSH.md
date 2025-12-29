# 🏗️ System Architecture: Remote SSH Management

## High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                       YOUR DEVELOPMENT MACHINE                   │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Web Browser                                             │   │
│  │  http://localhost:666                                    │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │                                                    │  │   │
│  │  │  🚀 Services    | 📜 Scripts  | 🖥️ Status    │  │   │
│  │  │  🔥 Firewall   | 🔑 SSH Keys | 📊 Logs      │  │   │
│  │  │                                                    │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                         │                                        │
│  ┌──────────────────────┴───────────────────────────────────┐   │
│  │  Node.js AdminUI Server (Port 666)                       │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │  Express REST API                                  │  │   │
│  │  │  - /api/server/status                              │  │   │
│  │  │  - /api/server/services                            │  │   │
│  │  │  - /api/server/execute                             │  │   │
│  │  │  - /api/server/scripts                             │  │   │
│  │  │  - /api/server/execute-script                      │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  │                         │                                 │   │
│  │  ┌──────────────────────┴────────────────────────────┐   │   │
│  │  │  SSHHelper Class                                   │   │   │
│  │  │  - Handles SSH2 connection                         │   │   │
│  │  │  - Executes remote commands                        │   │   │
│  │  │  - Parses output                                   │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                         │                                        │
└─────────────────────────┼────────────────────────────────────────┘
                          │
                ╔═════════╩═════════╗
                ║   SSH PORT 22     ║
                ║ Encrypted Tunnel  ║
                ║  TLS/RSA Auth     ║
                ╚═════════╦═════════╝
                          │
┌─────────────────────────┼────────────────────────────────────────┐
│                         │                                        │
│  REMOTE SERVER: 144.124.237.222 (Linux)                         │
│                         ▼                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  SSH Daemon                                              │   │
│  │  - Accept SSH connection                                 │   │
│  │  - Authenticate with RSA key                             │   │
│  │  - Execute commands in shell                             │   │
│  │  ┌────────────────────────────────────────────────────┐  │   │
│  │  │  Commands Executed:                                │  │   │
│  │  │  $ uptime -p                   (Server Status)      │  │   │
│  │  │  $ free -b | grep Mem          (Memory Usage)       │  │   │
│  │  │  $ nproc                       (CPU Cores)          │  │   │
│  │  │  $ systemctl list-units        (Services)           │  │   │
│  │  │  $ pm2 list --json             (PM2 Apps)           │  │   │
│  │  │  $ find /opt/scripts -name "*.sh"  (Scripts)        │  │   │
│  │  │  $ sudo ufw allow 3000         (Firewall Rules)     │  │   │
│  │  │  $ bash script.sh              (Execute Scripts)    │  │   │
│  │  │                                                    │  │   │
│  │  └────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Core Services Running:                                         │
│  ✓ nginx web server                                             │
│  ✓ MySQL/PostgreSQL database                                    │
│  ✓ Redis cache                                                  │
│  ✓ PM2 managed applications                                     │
│  ✓ UFW firewall                                                 │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## Request-Response Flow

### Example: Restart nginx Service

```
1. USER CLICKS "Restart nginx" in Web UI
   ↓
2. BROWSER SENDS HTTP REQUEST
   POST /api/server/manage-service
   {
     "type": "systemctl",
     "name": "nginx",
     "action": "restart"
   }
   ↓
3. NODEJS SERVER RECEIVES REQUEST
   ✓ Verifies JWT token
   ✓ Validates service name
   ✓ Creates SSHHelper instance
   ↓
4. SSH CONNECTION TO REMOTE SERVER
   SSHHelper.executeCommand("sudo systemctl restart nginx")
   ↓
5. REMOTE SERVER EXECUTES COMMAND
   SSH Daemon receives command
   Runs: $ sudo systemctl restart nginx
   nginx service restarts...
   Command completes
   ↓
6. OUTPUT RETURNS TO NODEJS
   SSHHelper captures stdout/stderr
   ↓
7. RESPONSE SENT TO BROWSER
   {
     "success": true,
     "type": "systemctl",
     "name": "nginx",
     "action": "restart",
     "output": "nginx restarted successfully"
   }
   ↓
8. BROWSER SHOWS SUCCESS MESSAGE
   "✓ nginx service restarted!"
   ↓
9. ACTION LOGGED TO DATABASE
   INSERT INTO activity_logs:
   - username: "admin"
   - action: "systemctl service 'nginx' action: restart"
   - category: "service"
   - timestamp: NOW
```

## Data Flow for Server Status

```
┌─────────────────────────────────┐
│  Browser requests /api/server/   │
│  status                          │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  Express route handler           │
│  - Verify JWT token              │
│  - Create SSHHelper instance     │
└────────────┬────────────────────┘
             │
             ▼
┌─────────────────────────────────┐
│  SSHHelper.executeCommand()      │
│  Multiple parallel commands:     │
│  1. uptime -p                    │
│  2. free -b                      │
│  3. nproc                        │
└────────────┬────────────────────┘
             │
             ▼
    ╔════════════════╗
    ║  SSH TUNNEL    ║
    ║ Encrypted      ║
    ║ Authenticated  ║
    ╚════════════════╝
             │
             ▼
┌──────────────────────────────────┐
│  Remote Server (144.124.237.222) │
│  $ uptime -p                      │
│  → up 45 days, 3 hours           │
│                                   │
│  $ free -b | grep Mem             │
│  → Mem: 16000000000 12000000000  │
│                                   │
│  $ nproc                          │
│  → 8                              │
└──────────────────┬────────────────┘
                   │
                   ▼
         ╔════════════════╗
         ║  SSH TUNNEL    ║
         ║ Return output  ║
         ╚════════════════╝
                   │
                   ▼
┌──────────────────────────────────┐
│  Parse responses:                │
│  uptime: "up 45 days, 3 hours"   │
│  ramUsage: "75%"                 │
│  cpuUsage: "8 cores"             │
└──────────────────┬────────────────┘
                   │
                   ▼
┌──────────────────────────────────┐
│  JSON Response to Browser:        │
│  {                                │
│    "online": true,                │
│    "ip": "144.124.237.222",       │
│    "uptime": "up 45 days...",     │
│    "ramUsage": "75%",             │
│    "cpuUsage": "8 cores"          │
│  }                                │
└──────────────────┬────────────────┘
                   │
                   ▼
┌──────────────────────────────────┐
│  Browser displays:                │
│  🖥️ Server Status:                │
│  IP: 144.124.237.222              │
│  Uptime: 45 days, 3 hours         │
│  RAM: 75%                         │
│  CPU: 8 cores                     │
└──────────────────────────────────┘
```

## Database Schema

```sql
-- Users table (authentication)
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT UNIQUE,
  ssh_key TEXT,
  created_at DATETIME
);

-- Activity logs (all actions)
CREATE TABLE activity_logs (
  id INTEGER PRIMARY KEY,
  username TEXT,          -- Who performed action
  action TEXT,            -- What was done
  category TEXT,          -- service/command/script/firewall
  timestamp DATETIME      -- When it happened
);
```

## Authentication Flow

```
┌────────────────────────────────────┐
│ User Wants to Login                │
└────────┬───────────────────────────┘
         │
         ├─→ SSH Key Sign (RSA/Ed25519)
         │   ├─ Generate message
         │   ├─ User signs with private key
         │   ├─ Server verifies signature
         │   └─ Create JWT token (24h)
         │
         ├─→ WebAuthn (Fingerprint/Face ID)
         │   ├─ Challenge-response
         │   ├─ Device verification
         │   └─ Create JWT token (24h)
         │
         └─→ Telegram Bot
             ├─ /auth_code command
             ├─ Generate 8-char code
             ├─ Expire in 10 minutes
             └─ Create JWT token (24h)
```

## Security Layers

```
LAYER 1: Network Transport
├─ SSH Protocol (RFC 4251)
├─ RSA/ECDSA Key Exchange
└─ AES-128-CTR Encryption

LAYER 2: Authentication
├─ SSH Public Key Authentication
├─ Optional: Password authentication
└─ JWT Token (24-hour expiry)

LAYER 3: API Security
├─ CORS whitelist
├─ JWT verification on every endpoint
└─ Content-Type validation

LAYER 4: Command Security
├─ Whitelist allowed commands
├─ Path traversal prevention
├─ No shell injection possible
└─ Activity logging

LAYER 5: Database Security
├─ SQLite local database
├─ Activity audit trail
└─ User action history
```

## Deployment Scenarios

### Local Development

```
User Machine:
  ├─ AdminUI Server: http://localhost:666
  ├─ Telegram Bot: Connected to 144.124.237.222
  └─ SSH: Via ~/.ssh/id_rsa

Remote Server: 144.124.237.222
  └─ Services to manage
```

### Docker Container

```
Docker Container:
  ├─ AdminUI Server: http://0.0.0.0:666
  ├─ SSH_PRIVATE_KEY from env var
  └─ SSH_KEY_PATH: /app/.ssh/id_rsa

Remote Server: 144.124.237.222
  └─ Services to manage
```

### Cloud Deployment (AWS/Azure/DigitalOcean)

```
Cloud App Server:
  ├─ AdminUI Server: Port 666
  ├─ SSH Key from: /secrets/ssh-key
  └─ Log to: CloudWatch/DataDog

Remote Server: 144.124.237.222
  └─ Services to manage
```

## Performance Characteristics

| Operation         | Latency    | Network | Notes                |
| ----------------- | ---------- | ------- | -------------------- |
| Get Server Status | 200-500ms  | SSH     | 3 parallel commands  |
| List Services     | 100-300ms  | SSH     | systemctl JSON + PM2 |
| Restart Service   | 1-3s       | SSH     | systemctl restart    |
| Execute Script    | 5-60s      | SSH     | Depends on script    |
| Get Scripts List  | 100-200ms  | SSH     | Find command         |
| Firewall Rule     | 500-1000ms | SSH     | UFW apply            |

## Error Handling

```
Request
  │
  ├─→ JWT Token Invalid
  │   └─ Return 401 Unauthorized
  │
  ├─→ Command Not Whitelisted
  │   └─ Return 400 Bad Request
  │
  ├─→ SSH Connection Timeout
  │   └─ Return 500 Server Error
  │
  ├─→ SSH Authentication Failed
  │   └─ Return 500 Server Error
  │
  ├─→ Command Execution Error
  │   └─ Return 200 with error message
  │
  └─→ Success
      └─ Return 200 with output
```

---

**This architecture ensures**:

- ✅ No commands run locally
- ✅ All actions on remote server
- ✅ Secure SSH authentication
- ✅ Encrypted communication
- ✅ Activity logging
- ✅ Error resilience
