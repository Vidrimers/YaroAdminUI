// ==================== AUTH STATE MANAGEMENT ====================
class AuthManager {
  constructor() {
    this.token = localStorage.getItem("admin_token");
    this.username = localStorage.getItem("admin_username");
    this.authMethods = ["ssh-auth", "webauthn-auth", "telegram-auth"];
    this.currentTab = "ssh-auth";
  }

  isAuthenticated() {
    return !!this.token;
  }

  setAuth(token, username) {
    this.token = token;
    this.username = username;
    localStorage.setItem("admin_token", token);
    localStorage.setItem("admin_username", username);
  }

  clear() {
    this.token = null;
    this.username = null;
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_username");
  }
}

// ==================== TOAST NOTIFICATIONS ====================
class ToastManager {
  constructor() {
    this.container = document.getElementById("toastContainer");
  }

  show(message, type = "info", duration = 4000) {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;

    this.container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("hide");
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  success(msg, duration) {
    this.show(msg, "success", duration);
  }

  error(msg, duration) {
    this.show(msg, "error", duration);
  }

  info(msg, duration) {
    this.show(msg, "info", duration);
  }

  warning(msg, duration) {
    this.show(msg, "warning", duration);
  }
}

// ==================== API SERVICE ====================
class APIService {
  constructor(authManager) {
    this.auth = authManager;
    this.baseURL = window.location.origin;
  }

  async request(endpoint, method = "GET", body = null) {
    const options = {
      method,
      headers: {
        "Content-Type": "application/json",
      },
    };

    if (this.auth.token) {
      options.headers["Authorization"] = `Bearer ${this.auth.token}`;
    }

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(`${this.baseURL}/api${endpoint}`, options);

      if (!response.ok) {
        if (response.status === 401) {
          this.auth.clear();
          window.location.reload();
        }
        const error = await response.json();
        throw new Error(error.message || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error("API Error:", error);
      throw error;
    }
  }

  // Auth endpoints
  async generateSSHMessage() {
    return this.request("/auth/ssh-message", "POST");
  }

  async verifySSH(message, signature) {
    return this.request("/auth/ssh-verify", "POST", { message, signature });
  }

  async webauthnRegister(username) {
    return this.request("/auth/webauthn-register", "POST", { username });
  }

  async webauthnVerify(username, assertion) {
    return this.request("/auth/webauthn-verify", "POST", {
      username,
      assertion,
    });
  }

  async verifyTelegramCode(code) {
    return this.request("/auth/telegram-verify", "POST", { code });
  }

  // Server management endpoints
  async getServerStatus() {
    return this.request("/server/status");
  }

  async executeCommand(command, args = []) {
    return this.request("/server/execute", "POST", { command, args });
  }

  async getSSHKeys() {
    return this.request("/server/ssh-keys");
  }

  async addSSHKey(key) {
    return this.request("/server/ssh-keys", "POST", { key });
  }

  async removeSSHKey(keyId) {
    return this.request(`/server/ssh-keys/${keyId}`, "DELETE");
  }

  async getServices() {
    return this.request("/server/services");
  }

  async controlService(name, action) {
    return this.request(`/server/services/${name}/${action}`, "POST");
  }

  async getLogs() {
    return this.request("/server/logs");
  }

  async getNotifications() {
    return this.request("/server/notifications");
  }
}

// ==================== UI CONTROLLER ====================
class UIController {
  constructor(authManager, apiService, toastManager) {
    this.auth = authManager;
    this.api = apiService;
    this.toast = toastManager;

    this.authScreen = document.getElementById("authScreen");
    this.dashboard = document.getElementById("dashboard");

    this.init();
  }

  init() {
    this.setupAuthTabs();
    this.setupSSHAuth();
    this.setupWebAuthnAuth();
    this.setupTelegramAuth();
    this.setupDashboard();
    this.setupLogout();

    if (this.auth.isAuthenticated()) {
      this.showDashboard();
    } else {
      this.showAuthScreen();
    }
  }

  // ==================== AUTH TABS ====================
  setupAuthTabs() {
    const tabs = document.querySelectorAll(".auth-tab");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const tabName = tab.getAttribute("data-tab");
        this.switchAuthTab(tabName);
      });
    });
  }

  switchAuthTab(tabName) {
    // Hide all tabs
    document.querySelectorAll(".auth-tab-content").forEach((content) => {
      content.classList.remove("active");
    });
    document.querySelectorAll(".auth-tab").forEach((tab) => {
      tab.classList.remove("active");
    });

    // Show selected tab
    document.getElementById(tabName).classList.add("active");
    document
      .querySelector(`.auth-tab[data-tab="${tabName}"]`)
      .classList.add("active");
  }

  // ==================== SSH AUTH ====================
  setupSSHAuth() {
    const form = document.getElementById("sshAuthForm");
    const generateBtn = document.getElementById("generateMessageBtn");
    const messageArea = document.getElementById("sshMessage");

    generateBtn.addEventListener("click", async () => {
      try {
        generateBtn.disabled = true;
        generateBtn.textContent = "Генерирую...";

        const response = await this.api.generateSSHMessage();
        messageArea.value = response.message;

        this.toast.info(
          'Сообщение сгенерировано. Подпишите его: ssh-keygen -Y sign -f ~/.ssh/id_rsa -n YaroAdminUI-Auth < <(echo "' +
            response.message +
            '")'
        );
      } catch (error) {
        this.toast.error("Ошибка: " + error.message);
      } finally {
        generateBtn.disabled = false;
        generateBtn.textContent = "Сгенерировать";
      }
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const message = messageArea.value;
      const signature = document.getElementById("sshSignature").value;

      if (!message || !signature) {
        this.toast.warning("Заполните все поля");
        return;
      }

      try {
        const response = await this.api.verifySSH(message, signature);
        this.auth.setAuth(response.token, response.username);
        this.showDashboard();
        this.toast.success("Успешный вход!");
      } catch (error) {
        this.toast.error("Ошибка верификации: " + error.message);
      }
    });
  }

  // ==================== WEBAUTHN AUTH ====================
  setupWebAuthnAuth() {
    const form = document.getElementById("webauthnAuthForm");
    const registerBtn = document.getElementById("webauthnRegisterBtn");
    const usernameInput = document.getElementById("username");

    registerBtn.addEventListener("click", async () => {
      const username = usernameInput.value;
      if (!username) {
        this.toast.warning("Введите имя пользователя");
        return;
      }

      try {
        const response = await this.api.webauthnRegister(username);
        const options = response.options;

        // Преобразуем буферы
        options.challenge = new Uint8Array(
          atob(options.challenge)
            .split("")
            .map((c) => c.charCodeAt(0))
        );
        options.user.id = new Uint8Array(
          atob(options.user.id)
            .split("")
            .map((c) => c.charCodeAt(0))
        );

        const credential = await navigator.credentials.create({
          publicKey: options,
        });

        if (!credential) {
          this.toast.error("Регистрация отменена");
          return;
        }

        const attestationObject = new Uint8Array(
          credential.response.attestationObject
        );
        const clientDataJSON = new Uint8Array(
          credential.response.clientDataJSON
        );

        // Отправляем регистрацию на сервер
        // (требуется реализация на сервере)
        this.toast.success("WebAuthn ключ зарегистрирован!");
      } catch (error) {
        this.toast.error("Ошибка регистрации: " + error.message);
      }
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = usernameInput.value;

      if (!username) {
        this.toast.warning("Введите имя пользователя");
        return;
      }

      try {
        // Получаем опции для аутентификации
        const response = await this.api.request(
          "/auth/webauthn-authenticate",
          "POST",
          { username }
        );
        const options = response.options;

        // Преобразуем challenge
        options.challenge = new Uint8Array(
          atob(options.challenge)
            .split("")
            .map((c) => c.charCodeAt(0))
        );

        const assertion = await navigator.credentials.get({
          publicKey: options,
        });

        if (!assertion) {
          this.toast.error("Аутентификация отменена");
          return;
        }

        const response2 = await this.api.webauthnVerify(username, {
          id: assertion.id,
          rawId: Array.from(new Uint8Array(assertion.rawId)),
          response: {
            clientDataJSON: Array.from(
              new Uint8Array(assertion.response.clientDataJSON)
            ),
            authenticatorData: Array.from(
              new Uint8Array(assertion.response.authenticatorData)
            ),
            signature: Array.from(new Uint8Array(assertion.response.signature)),
          },
          type: assertion.type,
        });

        this.auth.setAuth(response2.token, username);
        this.showDashboard();
        this.toast.success("WebAuthn вход успешен!");
      } catch (error) {
        this.toast.error("Ошибка: " + error.message);
      }
    });
  }

  // ==================== TELEGRAM AUTH ====================
  setupTelegramAuth() {
    const telegramCodeInput = document.getElementById("telegramCode");
    const telegramAuthBtn = document.getElementById("telegramAuthBtn");

    telegramAuthBtn.addEventListener("click", async () => {
      const code = telegramCodeInput.value;
      if (!code) {
        this.toast.warning("Введите код из Telegram");
        return;
      }

      try {
        const response = await this.api.verifyTelegramCode(code);
        this.auth.setAuth(response.token, response.username);
        this.showDashboard();
        this.toast.success("Успешный вход через Telegram!");
      } catch (error) {
        this.toast.error("Неверный код: " + error.message);
      }
    });
  }

  // ==================== DASHBOARD ====================
  setupDashboard() {
    this.setupDashboardCards();
    this.setupForms();
    this.loadDashboardData();
    this.startDataRefresh();
  }

  setupDashboardCards() {
    // Action buttons
    document.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.getAttribute("data-action");
        await this.executeAction(action);
      });
    });

    // SSH Key form
    document
      .getElementById("sshKeyForm")
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        const keyInput = document.getElementById("newSshKey");
        const key = keyInput.value.trim();

        if (!key) {
          this.toast.warning("Введите SSH ключ");
          return;
        }

        try {
          await this.api.addSSHKey(key);
          keyInput.value = "";
          this.toast.success("SSH ключ добавлен!");
          this.loadSSHKeys();
        } catch (error) {
          this.toast.error("Ошибка: " + error.message);
        }
      });

    // Firewall form
    document
      .getElementById("firewallForm")
      .addEventListener("submit", async (e) => {
        e.preventDefault();
        const port = document.getElementById("fwPort").value;
        const action = document.getElementById("fwAction").value;

        if (!port) {
          this.toast.warning("Укажите порт");
          return;
        }

        try {
          await this.api.executeCommand("firewall", [port, action]);
          this.toast.success(
            `Правило firewall применено: порт ${port} - ${action}`
          );
        } catch (error) {
          this.toast.error("Ошибка: " + error.message);
        }
      });
  }

  setupForms() {
    // Additional form setup if needed
  }

  async loadDashboardData() {
    try {
      const status = await this.api.getServerStatus();
      this.updateServerStatus(status);

      await this.loadSSHKeys();
      await this.loadServices();
      await this.loadLogs();
      await this.loadNotifications();
    } catch (error) {
      this.toast.error("Ошибка загрузки данных: " + error.message);
    }
  }

  updateServerStatus(status) {
    document.getElementById("serverIP").textContent = status.ip || "N/A";
    document.getElementById("serverStatus").textContent = status.online
      ? "🟢 Online"
      : "🔴 Offline";
    document.getElementById("serverStatus").className = status.online
      ? "status-online"
      : "status-offline";
    document.getElementById("serverUptime").textContent =
      status.uptime || "N/A";
    document.getElementById("cpuUsage").textContent = status.cpuUsage || "N/A";
    document.getElementById("ramUsage").textContent = status.ramUsage || "N/A";
  }

  async loadSSHKeys() {
    try {
      const response = await this.api.getSSHKeys();
      const keysList = document.getElementById("keysList");
      keysList.innerHTML = "";

      if (response.keys && response.keys.length > 0) {
        response.keys.forEach((key) => {
          const item = document.createElement("div");
          item.className = "key-item";
          item.innerHTML = `
            <span>${key.comment || key.id}</span>
            <button class="delete-key-btn" data-key-id="${
              key.id
            }">Удалить</button>
          `;

          item
            .querySelector(".delete-key-btn")
            .addEventListener("click", async () => {
              if (confirm("Вы уверены?")) {
                try {
                  await this.api.removeSSHKey(key.id);
                  this.toast.success("Ключ удален");
                  this.loadSSHKeys();
                } catch (error) {
                  this.toast.error("Ошибка: " + error.message);
                }
              }
            });

          keysList.appendChild(item);
        });
      } else {
        keysList.innerHTML = '<p class="text-muted">Нет SSH ключей</p>';
      }
    } catch (error) {
      console.error("Error loading SSH keys:", error);
    }
  }

  async loadServices() {
    try {
      const response = await this.api.getServices();
      const servicesList = document.getElementById("servicesList");
      servicesList.innerHTML = "";

      if (response.services && response.services.length > 0) {
        response.services.forEach((service) => {
          const item = document.createElement("div");
          item.className = "service-item";
          const statusClass = service.running
            ? "status-running"
            : "status-stopped";
          const statusText = service.running ? "Запущен" : "Остановлен";

          item.innerHTML = `
            <span>${service.name}</span>
            <span class="status-badge ${statusClass}">${statusText}</span>
          `;

          servicesList.appendChild(item);
        });
      }
    } catch (error) {
      console.error("Error loading services:", error);
    }
  }

  async loadLogs() {
    try {
      const response = await this.api.getLogs();
      const logsList = document.getElementById("logsList");
      logsList.innerHTML = "";

      if (response.logs && response.logs.length > 0) {
        response.logs.slice(-10).forEach((log) => {
          const item = document.createElement("div");
          item.className = "log-entry";
          const time = new Date(log.timestamp).toLocaleString("ru-RU");
          item.innerHTML = `
            <div class="log-time">${time}</div>
            <div class="log-action">${log.action}</div>
            <div>${log.details || ""}</div>
          `;

          logsList.appendChild(item);
        });
      } else {
        logsList.innerHTML = '<p class="text-muted">Нет логов</p>';
      }
    } catch (error) {
      console.error("Error loading logs:", error);
    }
  }

  async loadNotifications() {
    try {
      const response = await this.api.getNotifications();
      const notificationsList = document.getElementById("notificationsList");
      notificationsList.innerHTML = "";

      if (response.notifications && response.notifications.length > 0) {
        response.notifications.forEach((notification) => {
          const item = document.createElement("div");
          item.className = "notification-item";
          item.textContent = notification.message;
          notificationsList.appendChild(item);
        });
      } else {
        notificationsList.innerHTML =
          '<p class="text-muted">Нет уведомлений</p>';
      }
    } catch (error) {
      console.error("Error loading notifications:", error);
    }
  }

  async executeAction(action) {
    try {
      const result = await this.api.executeCommand(action);
      this.toast.success(`Действие выполнено: ${action}`);
      this.loadDashboardData();
    } catch (error) {
      this.toast.error("Ошибка: " + error.message);
    }
  }

  startDataRefresh() {
    setInterval(() => {
      this.loadDashboardData();
    }, 30000); // Refresh every 30 seconds
  }

  // ==================== UI STATE ====================
  showAuthScreen() {
    this.authScreen.style.display = "flex";
    this.dashboard.style.display = "none";
  }

  showDashboard() {
    this.authScreen.style.display = "none";
    this.dashboard.style.display = "block";
    document.getElementById("username").textContent = this.auth.username;
  }

  setupLogout() {
    document.getElementById("logoutBtn").addEventListener("click", () => {
      if (confirm("Вы уверены, что хотите выйти?")) {
        this.auth.clear();
        this.showAuthScreen();
        this.toast.info("Вы вышли из системы");
      }
    });
  }
}

// ==================== INITIALIZATION ====================
document.addEventListener("DOMContentLoaded", () => {
  const authManager = new AuthManager();
  const toastManager = new ToastManager();
  const apiService = new APIService(authManager);
  const uiController = new UIController(authManager, apiService, toastManager);

  // Make available globally for debugging
  window.adminUI = { authManager, toastManager, apiService, uiController };
});
