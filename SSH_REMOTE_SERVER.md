# 🔌 SSH Remote Server Management

## Overview

The AdminUI system has been **completely refactored** to manage a **remote server** (144.124.237.222) via SSH, not the local machine!

## What Changed

### ❌ Before

- Used `os.platform()` - checked local Windows/Linux
- Used `execSync()` - ran commands locally
- Operations affected the development machine
- No actual server management

### ✅ After

- Uses **SSH2 client** - connects to remote server
- All commands execute **on remote server** (144.124.237.222)
- Development machine only runs the web UI
- Proper server management via SSH

## SSH Configuration

### Required Setup

1. **Add SSH Private Key** to `.env`:

```bash
SSH_KEY_PATH=~/.ssh/id_rsa           # Path to private key
SSH_PORT=22                           # Remote server SSH port
SSH_USERNAME=root                     # Remote server username
SSH_PASSWORD=                         # Optional: password authentication
```

Or directly with key content (for Docker):

```bash
SSH_PRIVATE_KEY=-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----
```

2. **Ensure SSH Access**:

```bash
ssh -i ~/.ssh/id_rsa root@144.124.237.222
```

## Endpoints Now Using SSH

All these endpoints now execute commands **on the remote server**:

### 1. GET /api/server/status

- Gets uptime, memory usage, CPU cores from **remote server**
- Commands: `uptime -p`, `free -b`, `nproc`

### 2. GET /api/server/services

- Lists systemctl services on **remote server**
- Lists PM2 processes on **remote server**
- Commands: `systemctl list-units --json`, `pm2 list --json`

### 3. POST /api/server/manage-service

- Restart/start/stop services on **remote server**
- Examples: `systemctl restart nginx`, `pm2 restart app-name`

### 4. POST /api/server/execute

- Execute whitelisted commands on **remote server**
- Allowed commands:
  - `restart-ssh` - Restart SSH service
  - `check-disk` - Disk usage check
  - `restart-service` - Restart nginx
  - `firewall` - Manage UFW firewall rules
  - `restart-app` - Restart AdminUI app
  - `reboot` - System reboot

### 5. GET /api/server/scripts

- Find `.sh` scripts on **remote server**
- Searches: `/home/*/scripts`, `/opt/scripts`, `/root/scripts`

### 6. POST /api/server/execute-script

- Execute `.sh` scripts on **remote server**
- Security: Only from allowed directories

## SSH Helper Class

```javascript
class SSHHelper {
  async executeCommand(command) {
    // Connects to remote server
    // Executes command
    // Returns stdout
  }
}
```

### Usage

```javascript
const ssh = new SSHHelper(SERVER_IP);
const output = await ssh.executeCommand("df -h");
console.log(output);
```

## Error Handling

If SSH connection fails:

- **Service status endpoint** returns mock data with `online: false`
- **Commands** return error message
- **Scripts** list returns empty array
- Errors are logged to console

## Security Notes

✅ **What's Protected**:

- Commands are whitelisted (not all commands allowed)
- Script paths validated (only allowed directories)
- Path traversal prevented (`..` not allowed)
- All actions logged to database
- JWT authentication required for all endpoints

⚠️ **What to Configure**:

- Ensure SSH key has proper permissions: `chmod 600 ~/.ssh/id_rsa`
- Keep `SSH_PRIVATE_KEY` secret (never commit to git!)
- Test SSH connection before deployment
- Consider using SSH key with passphrase + `SSH_AGENT`

## Testing SSH Connection

```bash
# Test direct SSH access
ssh -i ~/.ssh/id_rsa root@144.124.237.222 "uptime"

# If it works, AdminUI will also work!
```

## Database Logging

All actions are logged to `activity_logs` table:

- Username who performed action
- Action description
- Category (command, service, script, etc.)
- Timestamp

```sql
SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT 10;
```

## What Commands Can I Run?

Whitelisted commands available via `/api/server/execute`:

| Command           | Purpose                   | Requires Root |
| ----------------- | ------------------------- | ------------- |
| `restart-ssh`     | Restart SSH daemon        | Yes           |
| `check-disk`      | Show disk usage           | No            |
| `restart-service` | Restart nginx             | Yes           |
| `firewall`        | Open/close ports with UFW | Yes           |
| `restart-app`     | Restart AdminUI app       | Yes           |
| `reboot`          | Reboot system             | Yes           |

To add more commands, update `allowedCommands` object in `/api/server/execute` endpoint.

## Troubleshooting

### "Command not allowed"

- Check if command is in whitelist
- Verify SSH connection works

### SSH Connection Timeout

- Check server IP: `144.124.237.222`
- Check SSH port: `22`
- Verify firewall allows SSH

### Permission Denied

- Check SSH key permissions: `chmod 600 ~/.ssh/id_rsa`
- Verify key is installed on server: `~/.ssh/authorized_keys`
- Check username is correct in `.env`

## Next Steps

1. ✅ Add SSH private key to `.env`
2. ✅ Test SSH connection manually
3. ✅ Restart AdminUI server
4. ✅ Try managing services via web UI
5. ✅ Check activity logs for what happened

---

**Status**: ✅ Ready for remote server management via SSH!
