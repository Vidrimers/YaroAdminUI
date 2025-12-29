# ✅ Verification Checklist

Complete this checklist to verify everything is working correctly.

## 🔍 Pre-Flight Checks

### Check 1: SSH Key Exists

```bash
ls -la ~/.ssh/id_rsa
```

**Expected**: File exists  
**If missing**:

```bash
ssh-keygen -t rsa -f ~/.ssh/id_rsa -N ""
```

### Check 2: Can Connect to Server

```bash
ssh -i ~/.ssh/id_rsa root@144.124.237.222 "echo 'SSH Works!'"
```

**Expected**: Outputs "SSH Works!"  
**If fails**: Check IP, port, key permissions

### Check 3: Node.js Version

```bash
node --version
```

**Expected**: v18 or higher  
**If lower**: Update Node.js

### Check 4: npm Packages Installed

```bash
npm list | head -20
```

**Expected**: Shows express, cors, dotenv, sqlite3, ssh2, etc.  
**If missing**: Run `npm install`

## 🚀 Runtime Checks

### Check 5: Server is Running

Open http://localhost:666 in browser

**Expected**:

- See AdminUI login page
- Multiple authentication options visible
- No errors in console (F12)

**If fails**:

```bash
npm run dev
# Should show: ⚡⚡⚡ YaroAdminUI Server Started on http://localhost:666
```

### Check 6: Database Exists

```bash
ls -lh adminUI.db
```

**Expected**: File exists (created on first run)  
**Size**: Should grow as you use it

### Check 7: Database Tables Created

```bash
sqlite3 adminUI.db ".tables"
```

**Expected**: Shows "activity_logs users"  
**If missing**: Database corrupted, delete and restart

## 🔐 Authentication Checks

### Check 8: SSH Authentication Works

1. Open http://localhost:666
2. Click "SSH Key Authentication"
3. Should show message to sign
4. Look for button to authenticate
5. Should create JWT token

**If fails**: Check SSH public key in browser console

### Check 9: WebAuthn Available

1. Go to http://localhost:666
2. Should see "WebAuthn" option
3. Should work on modern browsers

**If fails**: Check browser compatibility (Chrome, Edge, Safari 13+)

### Check 10: Telegram Bot Responds

```bash
# If you have the bot configured:
# Send /start to bot on Telegram
# Should receive welcome message with admin UI URL
```

## 🖥️ Remote Server Checks

### Check 11: Remote Server Status

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:666/api/server/status
```

**Expected**: JSON with server info

```json
{
  "online": true,
  "ip": "144.124.237.222",
  "uptime": "up 45 days, 3 hours",
  "ramUsage": "75%",
  "cpuUsage": "8 cores"
}
```

### Check 12: Get Services List

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:666/api/server/services
```

**Expected**: JSON with systemctl services and PM2 processes

### Check 13: Get Scripts List

```bash
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  http://localhost:666/api/server/scripts
```

**Expected**: JSON with .sh scripts found on server

## 🧪 Functional Tests

### Test 1: Server Status in UI

1. Login to http://localhost:666
2. Find "Server Status" card
3. Should show actual server info:
   - ✓ IP: 144.124.237.222
   - ✓ Uptime: Real value
   - ✓ RAM Usage: Real percentage
   - ✓ CPU Cores: Real count

### Test 2: Services in UI

1. Find "Services" card
2. Click "Load Services"
3. Should show:
   - Systemctl services from remote server
   - PM2 processes from remote server
   - NOT showing your local services

### Test 3: Firewall in UI

1. Find "Firewall Rules" card
2. Enter port number (e.g., 8080)
3. Click "Open Port"
4. Should show success message
5. Verify on server:

```bash
ssh -i ~/.ssh/id_rsa root@144.124.237.222 "sudo ufw status"
```

### Test 4: Activity Logging

1. Perform an action (e.g., restart service)
2. Check database:

```bash
sqlite3 adminUI.db "SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT 1;"
```

**Expected**: Shows your action with timestamp

### Test 5: Script Execution (if scripts exist)

1. Find "Scripts" section
2. Load scripts (if any found on server)
3. Execute one
4. Should show output from remote server

## 🐛 Debug Mode

### Enable Verbose Logging

```bash
NODE_DEBUG=* npm run dev
# Shows all internal Node.js messages
```

### Check SSH Connection Details

Add to adminui.js temporarily:

```javascript
console.log("SSH Host:", this.host);
console.log("SSH Port:", this.port);
console.log("SSH Username:", this.username);
console.log("SSH Key:", this.privateKey ? "Loaded" : "Not found");
```

### View All Environment Variables

```bash
# Unix/Linux
env | grep -E "SERVER|SSH|TELEGRAM|JWT"

# Windows
set | findstr "SERVER SSH TELEGRAM JWT"
```

### Test SSH Tunnel Manually

```bash
ssh -v -i ~/.ssh/id_rsa root@144.124.237.222 "uptime"
# -v = verbose, shows connection details
```

## ✅ Final Verification

Run this complete check:

```bash
#!/bin/bash

echo "=== YaroAdminUI Verification ==="

echo "1. SSH Key..."
[ -f ~/.ssh/id_rsa ] && echo "   ✓ Found" || echo "   ✗ Missing"

echo "2. SSH Connection..."
ssh -i ~/.ssh/id_rsa root@144.124.237.222 "uptime" > /dev/null 2>&1 && echo "   ✓ Works" || echo "   ✗ Failed"

echo "3. Node.js..."
node --version | grep -q "v1[89]" && echo "   ✓ v18+" || echo "   ✗ Version too old"

echo "4. npm packages..."
npm list sqlite3 > /dev/null 2>&1 && echo "   ✓ Installed" || echo "   ✗ Missing"

echo "5. Database..."
[ -f adminUI.db ] && echo "   ✓ Exists" || echo "   ✗ Not found"

echo "6. Server port..."
netstat -tuln | grep ":666 " > /dev/null && echo "   ✓ Port 666 open" || echo "   ✗ Port not listening"

echo "=== All Checks Complete ==="
```

## 📋 Verification Results

| Check             | Status | Notes                           |
| ----------------- | ------ | ------------------------------- |
| SSH Key           | ✓/✗    | Required for authentication     |
| Server Connection | ✓/✗    | Must work for remote management |
| Node.js Version   | ✓/✗    | Must be v18+                    |
| npm Packages      | ✓/✗    | Run `npm install` if missing    |
| Database          | ✓/✗    | Auto-created on start           |
| Web Server        | ✓/✗    | Check http://localhost:666      |
| API Endpoints     | ✓/✗    | Test with curl/Postman          |
| Remote Services   | ✓/✗    | Should show real services       |
| Activity Logging  | ✓/✗    | Actions saved to DB             |

## 🎊 All Green?

If all checks pass, you're ready to use YaroAdminUI!

```
┌─────────────────────────────┐
│   ✅ System Verified!       │
├─────────────────────────────┤
│ • SSH connection working    │
│ • Server responding         │
│ • Database active           │
│ • API endpoints functional  │
│ • Remote management ready   │
└─────────────────────────────┘
```

Go to http://localhost:666 and start managing your server!

## ❌ Something Failed?

1. **SSH Connection Fails**

   - Check key: `ssh-keygen -l -f ~/.ssh/id_rsa.pub`
   - Check server: `ping 144.124.237.222`
   - Check credentials in `.env`

2. **Database Issues**

   - Delete: `rm adminUI.db`
   - Restart: `npm run dev`
   - Will recreate

3. **Port Already in Use**

   - Change PORT in `.env`
   - Or kill process: `lsof -i :666`

4. **Module Not Found**

   - Run: `npm install`
   - Check: `npm list` for errors

5. **Still Having Issues**
   - Check: READY_TO_USE.md
   - See: SSH_REMOTE_SERVER.md troubleshooting section
   - Review: console output for error messages

---

**Questions?** Check the documentation files or test commands above.
