# 🚀 Quick Start Guide - YaroAdminUI

Быстрая инструкция для запуска админ-панели за 5 минут.

## ⚡ Минимальная установка

### 1. Установите зависимости

```bash
npm install
```

### 2. Отредактируйте .env

```bash
# Если .env ещё не создан
cp .env.example .env

# Отредактируйте .env (минимум):
nano .env
```

**Основные переменные:**

```env
PORT=3000
TELEGRAM_BOT_TOKEN=your_token_here  # Получить у @BotFather
TELEGRAM_ADMIN_ID=your_id_here       # Ваш Telegram ID
JWT_SECRET=change-me-to-random-string
```

### 3. Запустите

```bash
# Только веб-сервер
npm start

# Или с автоматической перезагрузкой
npm install -g nodemon
nodemon adminui.js

# Или запустите Telegram бот параллельно
npm run bot   # В другом терминале
```

Откройте: **http://localhost:3000**

## 🔐 Первый вход - SSH (Рекомендуется)

### На вашем компьютере (Linux/macOS):

```bash
# 1. Создайте SSH ключ (если нет)
ssh-keygen -t ed25519 -C "admin@server"

# 2. Откройте админ-панель
# http://localhost:3000

# 3. Выберите вкладку "SSH Ключ"

# 4. Нажмите "Сгенерировать"
# Скопируйте сообщение

# 5. Подпишите сообщение
echo -n "СООБЩЕНИЕ_ОТСЮДА" | \
  ssh-keygen -Y sign \
    -f ~/.ssh/id_ed25519 \
    -n YaroAdminUI-Auth

# 6. Вставьте подпись в base64
cat YaroAdminUI-Auth.sig | base64

# 7. Вставьте в форму и нажмите "Вход"
```

> Смотрите [SSH_AUTH_GUIDE.md](./SSH_AUTH_GUIDE.md) для полного руководства

## 💬 Первый вход - Telegram

### Проще всего!

```bash
# 1. Напишите боту
/start

# 2. Нажмите кнопку "Получить код входа"

# 3. Скопируйте код

# 4. На странице входа вставьте код

# 5. Отправьте боту
/auth_code CODE_ОТСЮДА

# 6. Вы вошли!
```

## 🐛 Основные команды

```bash
# Запустить сервер
npm start

# Запустить бота
npm run bot

# Запустить оба одновременно
npm run both

# Проверить статус базы данных
ls -la adminui.db

# Посмотреть логи
tail -f /path/to/logs
```

## 📝 Файлы проекта

| Файл                | Описание                              |
| ------------------- | ------------------------------------- |
| `index.html`        | Веб-интерфейс                         |
| `adminui_client.js` | Фронтенд логика                       |
| `style.css`         | Стили (тёмная тема)                   |
| `adminui.js`        | Сервер Express + API                  |
| `adminuibot.js`     | Telegram бот                          |
| `.env`              | Конфигурация (не коммитить!)          |
| `adminui.db`        | SQLite база (создаётся автоматически) |

## 🔧 Конфигурация

### Основные переменные .env

```env
# Сервер
PORT=3000                          # Порт запуска
SERVER_IP=localhost                # IP адрес сервера
HOST=localhost                     # На каком адресе слушать

# Telegram
TELEGRAM_BOT_TOKEN=...             # Получить у @BotFather
TELEGRAM_ADMIN_ID=...              # Ваш Telegram ID

# SSH
SSH_KEY_PATH=~/.ssh/id_rsa.pub    # Путь к публичному ключу
SSH_MESSAGE_PREFIX=YaroAdminUI     # Префикс для подписей

# Безопасность
JWT_SECRET=your-secret-key         # Менять в продакшене!
SESSION_TIMEOUT=3600000            # Таймаут сессии (мс)

# База данных
DB_PATH=./adminui.db               # Путь к SQLite БД
```

## 📊 Структура БД

Автоматически создаётся при первом запуске. Таблицы:

- `users` - пользователи
- `ssh_keys` - SSH ключи
- `activity_logs` - логи действий
- `telegram_codes` - коды входа
- `auth_sessions` - сессии

## 🌐 API примеры

### Получить статус сервера

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/server/status
```

### Добавить SSH ключ

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key": "ssh-ed25519 AAAA..."}' \
  http://localhost:3000/api/server/ssh-keys
```

### Получить логи

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/server/logs
```

## 🚀 Развёртывание на сервер

### Локально (разработка)

```bash
npm start
# http://localhost:3000
```

### На сервер (production)

```bash
# На сервере
git clone <repo> /opt/yaroadminui
cd /opt/yaroadminui
npm install --production

# Создайте systemd сервис
sudo nano /etc/systemd/system/yaroadminui.service
```

Содержимое systemd сервиса:

```ini
[Unit]
Description=YaroAdminUI
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/yaroadminui
ExecStart=/usr/bin/node /opt/yaroadminui/adminui.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Запустите:

```bash
sudo systemctl daemon-reload
sudo systemctl enable yaroadminui
sudo systemctl start yaroadminui
sudo systemctl status yaroadminui
```

## 🐛 Решение проблем

### "Cannot find module 'express'"

```bash
npm install
```

### "Port 3000 already in use"

```bash
# Измените PORT в .env
# Или убейте процесс:
lsof -i :3000
kill -9 PID
```

### "Bot token invalid"

```bash
# Убедитесь в .env
echo $TELEGRAM_BOT_TOKEN

# Получите новый токен у @BotFather в Telegram
```

### "SSH verification failed"

```bash
# Проверьте OpenSSH версию
ssh -V

# Убедитесь в .env правильный путь
grep SSH_KEY_PATH .env

# Убедитесь в правильности подписи
cat YaroAdminUI-Auth.sig | base64
```

## 📚 Дополнительно

- [SSH Authentication Guide](./SSH_AUTH_GUIDE.md) - Полное руководство SSH
- [README.md](./README.MD) - Полная документация
- [GitHub Issues](https://github.com/Vidrimers/YaroAdminUI/issues) - Поддержка

## 🆘 Получить помощь

1. Проверьте логи:

   ```bash
   tail -f logs.txt  # если есть
   ```

2. Проверьте .env:

   ```bash
   cat .env | grep -v "^#"
   ```

3. Создайте Issue с ошибкой и логом

---

**Готово!** 🎉

Теперь вы можете управлять сервером через веб-интерфейс YaroAdminUI!
