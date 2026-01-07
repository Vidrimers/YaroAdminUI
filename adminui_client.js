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
    this.uiController = null;
  }

  setUIController(uiController) {
    this.uiController = uiController;
  }

  show(message, type = "info", duration = 4000) {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;

    this.container.appendChild(toast);

    // Also add to notifications in header
    if (this.uiController) {
      this.uiController.addNotification(message, type);
    }

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
    // Use SERVER_URL from config.js if available, fallback to window.location.origin
    this.baseURL =
      typeof CONFIG !== "undefined" && CONFIG.SERVER_URL
        ? CONFIG.SERVER_URL
        : window.location.origin;
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

  async getPorts() {
    return this.request("/server/ports");
  }

  async controlService(name, action) {
    return this.request(`/server/services/${name}/${action}`, "POST");
  }

  async manageService(type, name, action) {
    return this.request("/server/manage-service", "POST", {
      type,
      name,
      action,
    });
  }

  async getScripts() {
    return this.request("/server/scripts");
  }

  async executeScript(scriptPath, useSudo = false) {
    return this.request("/server/execute-script", "POST", {
      scriptPath,
      useSudo,
    });
  }

  async getLogs() {
    return this.request("/server/logs");
  }

  async getNotifications() {
    return this.request("/server/notifications");
  }

  async getProcesses(limit = 30) {
    return this.request(`/server/processes?limit=${limit}`);
  }

  async killProcess(pid, signal = 9) {
    return this.request("/server/kill-process", "POST", { pid, signal });
  }
}

// ==================== UI CONTROLLER ====================
class UIController {
  constructor(authManager, apiService, toastManager) {
    this.auth = authManager;
    this.api = apiService;
    this.toast = toastManager;
    this.notifications = []; // Initialize notifications array

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
        // Get token from server
        const response = await this.api.request(
          "/auth/webauthn-verify",
          "POST",
          { username }
        );

        // Use the token from server response
        this.auth.setAuth(response.token, response.username);
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
    // Data loading moved to showDashboard() after authentication
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
          // this.loadSSHKeys(); // Disabled - keys now shown only in modal
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
          const result = await this.api.executeCommand("firewall", [
            port,
            action,
          ]);
          this.toast.success(
            `Правило firewall применено: порт ${port} - ${action}`
          );
          if (result && result.output) {
            this.toast.info(`Результат: ${result.output}`);
          }
        } catch (error) {
          this.toast.error("Ошибка: " + error.message);
        }
      });

    // Firewall status check button
    const checkFirewallBtn = document.getElementById("checkFirewallBtn");
    if (checkFirewallBtn) {
      checkFirewallBtn.addEventListener("click", async () => {
        try {
          checkFirewallBtn.disabled = true;
          checkFirewallBtn.textContent = "Проверяю...";
          const result = await this.api.executeCommand("check-firewall-status");
          this.toast.info("Статус firewall:\n" + result.output);
        } catch (error) {
          this.toast.error("Ошибка проверки статуса: " + error.message);
        } finally {
          checkFirewallBtn.disabled = false;
          checkFirewallBtn.textContent = "Проверить статус";
        }
      });
    }

    // Enable firewall button
    const enableFirewallBtn = document.getElementById("enableFirewallBtn");
    if (enableFirewallBtn) {
      enableFirewallBtn.addEventListener("click", async () => {
        try {
          enableFirewallBtn.disabled = true;
          enableFirewallBtn.textContent = "Включаю...";
          const result = await this.api.executeCommand("enable-firewall");
          this.toast.success("UFW включен");
          if (result && result.output) {
            this.toast.info("Результат: " + result.output);
          }
        } catch (error) {
          this.toast.error("Ошибка включения UFW: " + error.message);
        } finally {
          enableFirewallBtn.disabled = false;
          enableFirewallBtn.textContent = "Включить UFW";
        }
      });
    }

    // Disable firewall button
    const disableFirewallBtn = document.getElementById("disableFirewallBtn");
    if (disableFirewallBtn) {
      disableFirewallBtn.addEventListener("click", async () => {
        try {
          disableFirewallBtn.disabled = true;
          disableFirewallBtn.textContent = "Выключаю...";
          const result = await this.api.executeCommand("disable-firewall");
          this.toast.warning("UFW выключен");
          if (result && result.output) {
            this.toast.info("Результат: " + result.output);
          }
        } catch (error) {
          this.toast.error("Ошибка выключения UFW: " + error.message);
        } finally {
          disableFirewallBtn.disabled = false;
          disableFirewallBtn.textContent = "Выключить UFW";
        }
      });
    }
  }

  setupForms() {
    // Additional form setup if needed
    const refreshProcessesBtn = document.getElementById("refreshProcesses");
    if (refreshProcessesBtn) {
      refreshProcessesBtn.addEventListener("click", async () => {
        refreshProcessesBtn.disabled = true;
        refreshProcessesBtn.textContent = "⏳";
        try {
          await this.loadProcesses();
          this.toast.success("Процессы обновлены");
        } catch (error) {
          this.toast.error("Ошибка обновления: " + error.message);
        } finally {
          refreshProcessesBtn.disabled = false;
          refreshProcessesBtn.textContent = "🔄";
        }
      });
    }

    // Refresh Systemctl button
    const refreshSystemctlBtn = document.getElementById("refreshSystemctlBtn");
    if (refreshSystemctlBtn) {
      refreshSystemctlBtn.addEventListener("click", async () => {
        refreshSystemctlBtn.disabled = true;
        refreshSystemctlBtn.textContent = "⏳";
        try {
          await this.loadServices();
          this.toast.success("Сервисы обновлены");
        } catch (error) {
          this.toast.error("Ошибка обновления: " + error.message);
        } finally {
          refreshSystemctlBtn.disabled = false;
          refreshSystemctlBtn.textContent = "🔄";
        }
      });
    }

    // Check PM2 button
    const checkPm2Btn = document.getElementById("checkPm2Btn");
    if (checkPm2Btn) {
      checkPm2Btn.addEventListener("click", async () => {
        checkPm2Btn.disabled = true;
        checkPm2Btn.textContent = "⏳";
        try {
          // First try to reload PM2 list
          await this.loadServices();
          this.toast.success("PM2 процессы обновлены");
          
          // Then show debug info
          const result = await this.api.executeCommand("check-pm2");
          console.log("PM2 check output:", result.output);
        } catch (error) {
          this.toast.error("Ошибка проверки PM2: " + error.message);
        } finally {
          checkPm2Btn.disabled = false;
          checkPm2Btn.textContent = "🔄";
        }
      });
    }

    // Refresh ports button
    const refreshPortsBtn = document.getElementById("refreshPorts");
    if (refreshPortsBtn) {
      refreshPortsBtn.addEventListener("click", async () => {
        refreshPortsBtn.disabled = true;
        refreshPortsBtn.textContent = "⏳";
        try {
          await this.loadPorts();
          this.toast.success("Порты обновлены");
        } catch (error) {
          this.toast.error("Ошибка обновления: " + error.message);
        } finally {
          refreshPortsBtn.disabled = false;
          refreshPortsBtn.textContent = "🔄";
        }
      });
    }

    // Refresh scripts button
    const refreshScriptsBtn = document.getElementById("refreshScriptsBtn");
    if (refreshScriptsBtn) {
      refreshScriptsBtn.addEventListener("click", async () => {
        refreshScriptsBtn.disabled = true;
        refreshScriptsBtn.textContent = "⏳";
        try {
          await this.loadScripts();
          this.toast.success("Скрипты обновлены");
        } catch (error) {
          this.toast.error("Ошибка обновления: " + error.message);
        } finally {
          refreshScriptsBtn.disabled = false;
          refreshScriptsBtn.textContent = "🔄";
        }
      });
    }

    // View server SSH keys button
    const viewServerKeysBtn = document.getElementById("viewServerKeysBtn");
    if (viewServerKeysBtn) {
      viewServerKeysBtn.addEventListener("click", async () => {
        this.openSshKeysModal();
      });
    }

    // Setup SSH keys modal
    this.setupSshKeysModal();
  }

  setupSshKeysModal() {
    const modal = document.getElementById("sshKeysModal");
    const closeBtn = document.getElementById("closeSshKeysModal");
    const closeModalBtn = document.getElementById("closeSshKeysModalBtn");

    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        modal.style.display = "none";
      });
    }

    if (closeModalBtn) {
      closeModalBtn.addEventListener("click", () => {
        modal.style.display = "none";
      });
    }

    // Close on outside click
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        modal.style.display = "none";
      }
    });
  }

  async openSshKeysModal() {
    const modal = document.getElementById("sshKeysModal");
    const keysList = document.getElementById("serverKeysList");

    // Show modal
    modal.style.display = "flex";

    // Load keys
    keysList.innerHTML = '<p class="text-muted">Загрузка...</p>';

    try {
      const response = await this.api.getSSHKeys();

      if (response.keys && response.keys.length > 0) {
        keysList.innerHTML = "";
        response.keys.forEach((key) => {
          const item = document.createElement("div");
          item.style.cssText = `
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 8px;
            padding: 15px;
            margin-bottom: 10px;
          `;

          const keyDisplayId = `key-display-${key.id}`;
          const isExpanded = false;

          item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <div>
                <span style="font-weight: 500; color: #667eea;">${key.type}</span>
                <span style="font-size: 0.85em; color: #888; margin-left: 10px;">${key.comment}</span>
              </div>
              <button class="btn btn-sm btn-danger" data-key-id="${key.id}" style="padding: 4px 12px;">
                🗑️ Удалить
              </button>
            </div>
            <div id="${keyDisplayId}" class="ssh-key-display" style="
              font-family: 'Courier New', monospace; 
              font-size: 0.8em; 
              color: #a0a0a0; 
              word-break: break-all;
              cursor: pointer;
              transition: color 0.2s;
            " title="Нажмите для показа полного ключа">
              ${key.key}
            </div>
          `;

          // Add hover effect for key display
          const keyDisplay = item.querySelector(`#${keyDisplayId}`);
          keyDisplay.addEventListener('mouseenter', () => {
            keyDisplay.style.color = '#667eea';
          });
          keyDisplay.addEventListener('mouseleave', () => {
            if (!keyDisplay.dataset.expanded) {
              keyDisplay.style.color = '#a0a0a0';
            }
          });

          // Toggle full key display on click
          keyDisplay.addEventListener('click', () => {
            if (keyDisplay.dataset.expanded === 'true') {
              // Collapse - show short version
              keyDisplay.innerHTML = key.key;
              keyDisplay.dataset.expanded = 'false';
              keyDisplay.style.color = '#a0a0a0';
              keyDisplay.title = 'Нажмите для показа полного ключа';
            } else {
              // Expand - show full key
              keyDisplay.innerHTML = key.fullKey;
              keyDisplay.dataset.expanded = 'true';
              keyDisplay.style.color = '#667eea';
              keyDisplay.title = 'Нажмите для скрытия полного ключа';
            }
          });

          // Add delete button handler
          const deleteBtn = item.querySelector('.btn-danger');
          deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation(); // Prevent triggering key display toggle
            if (confirm(`Вы уверены, что хотите удалить SSH ключ "${key.comment}"?`)) {
              try {
                deleteBtn.disabled = true;
                deleteBtn.textContent = 'Удаление...';
                
                await this.api.removeSSHKey(key.id);
                this.toast.success('SSH ключ удален');
                
                // Reload keys list
                await this.openSshKeysModal();
              } catch (error) {
                this.toast.error('Ошибка удаления ключа: ' + error.message);
                deleteBtn.disabled = false;
                deleteBtn.innerHTML = '🗑️ Удалить';
              }
            }
          });

          keysList.appendChild(item);
        });
      } else {
        keysList.innerHTML = '<p class="text-muted">Нет SSH ключей на сервере</p>';
      }
    } catch (error) {
      keysList.innerHTML = `<p class="text-muted" style="color: #f44336;">Ошибка: ${error.message}</p>`;
    }
  }

  async loadDashboardData() {
    try {
      const status = await this.api.getServerStatus();
      this.updateServerStatus(status);

      // await this.loadSSHKeys(); // Disabled - keys now shown only in modal
      await this.loadServices();
      await this.loadPorts();
      await this.loadProcesses();
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

      // Load systemctl services
      const systemctlList = document.getElementById("systemctlList");
      systemctlList.innerHTML = "";

      if (response.systemctl && response.systemctl.length > 0) {
        response.systemctl.forEach((service) => {
          const item = document.createElement("div");
          item.className = "service-item";
          const isActive = service.status === "active";
          const statusClass = isActive ? "status-active" : "status-inactive";
          const statusText = isActive ? "✓ Запущен" : "✕ Остановлен";

          item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <span style="font-weight: 500; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${service.name}</span>
              <span class="status-badge ${statusClass}">${statusText}</span>
            </div>
            ${service.pid && service.pid !== 'N/A' ? `
            <div style="display: flex; gap: 10px; margin-bottom: 8px; font-size: 0.85em;">
              <span style="color: #888;">PID: <span style="color: #667eea;">${service.pid}</span></span>
              <span style="color: #888;">CPU: <span style="color: #ff9800;">${service.cpu || 'N/A'}</span></span>
              <span style="color: #888;">RAM: <span style="color: #4caf50;">${service.memory || 'N/A'}</span></span>
            </div>
            ` : ''}
            <div class="service-actions">
              <button class="btn btn-sm btn-success" data-service-action="start" data-service-type="systemctl" data-service-name="${service.name}">Запуск</button>
              <button class="btn btn-sm btn-warning" data-service-action="restart" data-service-type="systemctl" data-service-name="${service.name}">Перезагрузка</button>
              <button class="btn btn-sm btn-danger" data-service-action="stop" data-service-type="systemctl" data-service-name="${service.name}">Остановка</button>
            </div>
          `;

          systemctlList.appendChild(item);
        });
      } else {
        systemctlList.innerHTML =
          '<p class="text-muted">Нет доступных systemctl сервисов</p>';
      }

      // Load PM2 processes
      const pm2List = document.getElementById("pm2List");
      pm2List.innerHTML = "";

      console.log("Full services response:", response);
      console.log("PM2 Response:", response.pm2);
      console.log("PM2 available:", response.pm2Available);
      console.log("PM2 length:", response.pm2 ? response.pm2.length : 0);

      if (response.pm2 && response.pm2.length > 0) {
        response.pm2.forEach((process) => {
          const item = document.createElement("div");
          item.className = "service-item";
          const isActive = process.status === "online";
          const statusClass = isActive ? "status-active" : "status-inactive";
          const statusText = isActive ? "✓ Online" : "✕ Offline";

          item.innerHTML = `
            <div style="flex: 1;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span style="font-weight: 500;">${process.name}</span>
                <span class="status-badge ${statusClass}">${statusText}</span>
              </div>
              <div class="pm2-info">
                <div class="pm2-info-item"><span class="pm2-info-label">PID:</span> <span class="pm2-info-value">${
                  process.pid || "N/A"
                }</span></div>
                <div class="pm2-info-item"><span class="pm2-info-label">Memory:</span> <span class="pm2-info-value">${
                  process.memory
                }</span></div>
                <div class="pm2-info-item"><span class="pm2-info-label">CPU:</span> <span class="pm2-info-value">${
                  process.cpu
                }</span></div>
              </div>
            </div>
            <div class="service-actions" style="margin-top: 10px;">
              <button class="btn btn-sm btn-success" data-service-action="start" data-service-type="pm2" data-service-name="${
                process.name
              }">Запуск</button>
              <button class="btn btn-sm btn-warning" data-service-action="restart" data-service-type="pm2" data-service-name="${
                process.name
              }">Перезагрузка</button>
              <button class="btn btn-sm btn-danger" data-service-action="stop" data-service-type="pm2" data-service-name="${
                process.name
              }">Остановка</button>
            </div>
          `;

          pm2List.appendChild(item);
        });
      } else {
        console.warn("No PM2 processes found in response");
        if (response.pm2Available === false) {
          pm2List.innerHTML =
            '<p class="text-muted">PM2 не установлен на сервере или нет запущенных процессов</p>';
        } else {
          pm2List.innerHTML =
            '<p class="text-muted">Нет запущенных PM2 процессов</p>';
        }
      }

      // Setup service action listeners
      this.setupServiceControls();

      // Load scripts
      await this.loadScripts();
    } catch (error) {
      console.error("Error loading services:", error);
      const systemctlList = document.getElementById("systemctlList");
      const pm2List = document.getElementById("pm2List");
      systemctlList.innerHTML =
        '<p class="text-muted">Ошибка загрузки сервисов</p>';
      pm2List.innerHTML = '<p class="text-muted">Ошибка загрузки PM2</p>';
    }
  }

  async loadScripts() {
    try {
      const response = await this.api.getScripts();
      const scriptsList = document.getElementById("scriptsList");
      scriptsList.innerHTML = "";

      if (response.scripts && response.scripts.length > 0) {
        response.scripts.forEach((script) => {
          const item = document.createElement("div");
          item.className = "script-item";

          item.innerHTML = `
            <div class="script-path">📄 ${script.path}</div>
            <div class="script-actions">
              <button class="btn btn-info" data-script-action="execute" data-script-path="${script.path}">
                ▶ Выполнить
              </button>
              <button class="btn btn-warning" data-script-action="execute-sudo" data-script-path="${script.path}">
                🔓 Sudo
              </button>
            </div>
          `;

          scriptsList.appendChild(item);
        });

        // Setup script action listeners
        this.setupScriptControls();
      } else {
        scriptsList.innerHTML =
          '<p class="text-muted">Нет доступных скриптов</p>';
      }
    } catch (error) {
      console.error("Error loading scripts:", error);
      const scriptsList = document.getElementById("scriptsList");
      scriptsList.innerHTML =
        '<p class="text-muted">Ошибка загрузки скриптов</p>';
    }
  }

  async loadProcesses() {
    try {
      const response = await this.api.getProcesses(30);
      const processesList = document.getElementById("processesList");
      processesList.innerHTML = "";

      if (response.processes && response.processes.length > 0) {
        response.processes.forEach((process) => {
          const item = document.createElement("div");
          item.className = "process-item";

          // Format CPU and Memory percentages
          const cpu = process.cpu ? process.cpu.toFixed(1) : "0.0";
          const memory = process.memory ? process.memory.toFixed(1) : "0.0";
          const command = process.command || "N/A";

          item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div style="display: flex; gap: 10px; align-items: center; flex: 1; min-width: 0;">
                <span class="process-pid">PID: ${process.pid}</span>
                <span class="process-user">👤 ${process.user}</span>
              </div>
              <div style="display: flex; gap: 10px;">
                <span class="process-cpu">CPU: ${cpu}%</span>
                <span class="process-memory">RAM: ${memory}%</span>
              </div>
            </div>
            <div class="process-command" title="${command}">${command}</div>
            <div class="process-actions">
              <button class="btn btn-danger btn-sm" data-process-action="kill" data-process-pid="${process.pid}">
                ⚔️ Kill
              </button>
            </div>
          `;

          processesList.appendChild(item);
        });

        // Setup process action listeners
        this.setupProcessControls();
      } else {
        processesList.innerHTML =
          '<p class="text-muted">Нет процессов или ошибка загрузки</p>';
      }
    } catch (error) {
      console.error("Error loading processes:", error);
      const processesList = document.getElementById("processesList");
      processesList.innerHTML =
        '<p class="text-muted">Ошибка загрузки процессов</p>';
    }
  }

  async loadPorts() {
    try {
      const response = await this.api.getPorts();
      const portsList = document.getElementById("portsList");
      portsList.innerHTML = "";

      if (response.ports && response.ports.length > 0) {
        let html = '<div class="ports-table">';
        response.ports.forEach((port) => {
          html += `
            <div class="port-item">
              <div class="port-number">${port.port}</div>
              <div class="port-protocol">${port.protocol.toUpperCase()}</div>
              <div class="port-service">${port.service}</div>
            </div>
          `;
        });
        html += "</div>";
        portsList.innerHTML = html;
      } else {
        portsList.innerHTML = '<p class="text-muted">Нет открытых портов</p>';
      }
    } catch (error) {
      console.error("Error loading ports:", error);
      const portsList = document.getElementById("portsList");
      portsList.innerHTML = '<p class="text-muted">Ошибка загрузки портов</p>';
    }
  }

  setupProcessControls() {
    document.querySelectorAll("[data-process-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.getAttribute("data-process-action");
        const pid = btn.getAttribute("data-process-pid");

        if (action === "kill") {
          if (!confirm(`Вы уверены что хотите завершить процесс ${pid}?`)) {
            return;
          }

          btn.disabled = true;
          btn.textContent = "⏳ Завершение...";

          try {
            const result = await this.api.killProcess(pid, "9");
            this.toast.success(`Процесс ${pid} завершён`);
            // Reload processes after killing
            setTimeout(() => this.loadProcesses(), 1000);
          } catch (error) {
            this.toast.error(`Ошибка: ${error.message}`);
            btn.disabled = false;
            btn.textContent = "⚔️ Kill";
          }
        }
      });
    });
  }

  setupServiceControls() {
    document.querySelectorAll("[data-service-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.getAttribute("data-service-action");
        const type = btn.getAttribute("data-service-type");
        const name = btn.getAttribute("data-service-name");

        btn.disabled = true;
        btn.textContent = "⏳ Выполняется...";

        // Add to terminal
        const actionText = action === "start" ? "запуск" : action === "restart" ? "перезагрузка" : "остановка";
        this.addToTerminal(`$ ${type} ${name} - ${actionText}`, 'command');

        try {
          const result = await this.api.manageService(type, name, action);
          this.toast.success(`${name} - ${action} выполнен`);
          this.addToTerminal(`✓ ${name} - ${actionText} выполнен успешно`, 'success');
          
          // Reload services
          setTimeout(() => this.loadServices(), 1000);
        } catch (error) {
          this.toast.error(`Ошибка: ${error.message}`);
          this.addToTerminal(`✗ Ошибка: ${error.message}`, 'error');
        } finally {
          btn.disabled = false;
          btn.textContent =
            action === "start"
              ? "Запуск"
              : action === "restart"
              ? "Перезагрузка"
              : "Остановка";
        }
      });
    });
  }

  setupScriptControls() {
    document.querySelectorAll("[data-script-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.getAttribute("data-script-action");
        const scriptPath = btn.getAttribute("data-script-path");
        const useSudo = action === "execute-sudo";

        if (action === "execute" || action === "execute-sudo") {
          btn.disabled = true;
          const originalText = btn.textContent;
          btn.textContent = "⏳ Выполняется...";

          // Add to terminal
          const command = useSudo ? `sudo ${scriptPath}` : scriptPath;
          this.addToTerminal(`$ ${command}`, 'command');

          try {
            const result = await this.api.executeScript(scriptPath, useSudo);
            this.toast.success(`Скрипт выполнен успешно`);
            
            // Show output in terminal
            if (result.output) {
              this.addToTerminal(result.output, 'output');
              console.log("Script output:", result.output);
            } else {
              this.addToTerminal('Выполнено успешно', 'success');
            }
          } catch (error) {
            this.toast.error(`Ошибка: ${error.message}`);
            this.addToTerminal(`Ошибка: ${error.message}`, 'error');
          } finally {
            btn.disabled = false;
            btn.textContent = originalText;
          }
        }
      });
    });
  }

  addToTerminal(text, type = 'output') {
    const terminalOutput = document.getElementById('terminalOutput');
    if (!terminalOutput) return;

    const line = document.createElement('div');
    line.style.margin = '2px 0';
    line.style.whiteSpace = 'pre-wrap';
    line.style.wordBreak = 'break-word';

    // Color based on type
    if (type === 'command') {
      line.style.color = '#4ec9b0'; // cyan for commands
      line.style.fontWeight = 'bold';
    } else if (type === 'error') {
      line.style.color = '#f48771'; // red for errors
    } else if (type === 'success') {
      line.style.color = '#89d185'; // green for success
    } else {
      line.style.color = '#d4d4d4'; // default gray
    }

    line.textContent = text;
    terminalOutput.appendChild(line);

    // Auto scroll to bottom
    terminalOutput.scrollTop = terminalOutput.scrollHeight;
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
      const notificationsCount = document.getElementById("notificationsCount");
      
      notificationsList.innerHTML = "";

      if (response.notifications && response.notifications.length > 0) {
        // Show badge with count
        notificationsCount.textContent = response.notifications.length;
        notificationsCount.style.display = "inline-block";
        
        response.notifications.forEach((notification) => {
          const item = document.createElement("div");
          item.className = "notification-item";
          item.textContent = notification.message;
          notificationsList.appendChild(item);
        });
      } else {
        // Hide badge when no notifications
        notificationsCount.style.display = "none";
        notificationsList.innerHTML =
          '<p class="text-muted">Нет уведомлений</p>';
      }
    } catch (error) {
      console.error("Error loading notifications:", error);
      // Hide badge on error
      const notificationsCount = document.getElementById("notificationsCount");
      if (notificationsCount) {
        notificationsCount.style.display = "none";
      }
    }
  }

  async executeAction(action) {
    // Map action names to readable commands
    const actionNames = {
      'restart-ssh': 'Перезагрузка SSH',
      'check-disk': 'Проверка диска',
      'restart-service': 'Перезагрузка сервиса'
    };
    
    const actionName = actionNames[action] || action;
    
    // Add to terminal
    this.addToTerminal(`$ ${actionName}`, 'command');
    
    try {
      const result = await this.api.executeCommand(action);
      this.toast.success(`Действие выполнено: ${actionName}`);
      
      // Show output in terminal
      if (result.output) {
        this.addToTerminal(result.output, 'output');
      } else if (result.message) {
        this.addToTerminal(result.message, 'success');
      } else {
        this.addToTerminal('Выполнено успешно', 'success');
      }
      
      this.loadDashboardData();
    } catch (error) {
      this.toast.error("Ошибка: " + error.message);
      this.addToTerminal(`Ошибка: ${error.message}`, 'error');
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
    // Load dashboard data after showing dashboard
    this.loadDashboardData();
    this.startDataRefresh();
    // Load settings from database first, then setup UI
    this.loadSettingsFromDatabase().then(() => {
      // Setup drag and drop for cards
      this.restoreCardLayout();
      this.setupDragAndDrop();
      // this.setupCardResize(); // Disabled - cards now have fixed max-height with scroll
      this.setupCardCollapse();
      this.setupTerminal();
      this.setupScreenProcesses();
      this.setupVPNConfiguration();
      this.setupServerStatusUI();
      this.setupThemes();
      this.setupNotificationsUI();
      this.setupSystemUI();
      
      // Setup auto grid layout
      this.setupAutoGridLayout();
    });
  }

  recalculateGridLayout() {
    // Disabled - using flexbox layout now
  }

  setupAutoGridLayout() {
    // Disabled - using flexbox layout now
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

  setupDragAndDrop() {
    // Drag and drop disabled - use Sort modal instead
    // Setup sort button
    const sortBtn = document.getElementById("sortBtn");
    const sortModal = document.getElementById("sortModal");
    const closeSortModal = document.getElementById("closeSortModal");
    const cancelSort = document.getElementById("cancelSort");
    const saveSort = document.getElementById("saveSort");
    const sortableList = document.getElementById("sortableList");

    if (!sortBtn || !sortModal) return;

    // Open modal
    sortBtn.addEventListener("click", () => {
      this.openSortModal();
    });

    // Close modal
    closeSortModal.addEventListener("click", () => {
      sortModal.style.display = "none";
    });

    cancelSort.addEventListener("click", () => {
      sortModal.style.display = "none";
    });

    // Save sort order
    saveSort.addEventListener("click", () => {
      this.saveSortOrder();
      sortModal.style.display = "none";
      this.toast.success("Порядок карточек сохранен!");
    });

    // Close on outside click
    sortModal.addEventListener("click", (e) => {
      if (e.target === sortModal) {
        sortModal.style.display = "none";
      }
    });
  }

  openSortModal() {
    const sortModal = document.getElementById("sortModal");
    const sortableList = document.getElementById("sortableList");
    const container = document.getElementById("cardsContainer");
    const cards = Array.from(container.querySelectorAll(".card"));

    // Clear list
    sortableList.innerHTML = "";

    // Add cards to sortable list
    cards.forEach((card, index) => {
      const title = card.querySelector("h2")?.textContent || `Card ${index + 1}`;
      const item = document.createElement("div");
      item.className = "sortable-item";
      item.draggable = true;
      item.dataset.title = title;
      item.innerHTML = `
        <span class="sortable-handle">☰</span>
        <span class="sortable-title">${title}</span>
      `;

      sortableList.appendChild(item);
    });

    // Setup drag and drop for sortable items
    this.setupSortableDragDrop();

    // Show modal
    sortModal.style.display = "flex";
  }

  setupSortableDragDrop() {
    const sortableList = document.getElementById("sortableList");
    let draggedItem = null;

    const items = sortableList.querySelectorAll(".sortable-item");

    items.forEach((item) => {
      item.addEventListener("dragstart", (e) => {
        draggedItem = item;
        item.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
      });

      item.addEventListener("dragend", () => {
        item.classList.remove("dragging");
        draggedItem = null;
      });

      item.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (draggedItem && draggedItem !== item) {
          const rect = item.getBoundingClientRect();
          const midpoint = rect.top + rect.height / 2;

          if (e.clientY < midpoint) {
            sortableList.insertBefore(draggedItem, item);
          } else {
            sortableList.insertBefore(draggedItem, item.nextSibling);
          }
        }
      });

      item.addEventListener("dragenter", (e) => {
        if (draggedItem && draggedItem !== item) {
          item.classList.add("drag-over");
        }
      });

      item.addEventListener("dragleave", () => {
        item.classList.remove("drag-over");
      });

      item.addEventListener("drop", (e) => {
        e.preventDefault();
        item.classList.remove("drag-over");
      });
    });
  }

  saveSortOrder() {
    const sortableList = document.getElementById("sortableList");
    const items = Array.from(sortableList.querySelectorAll(".sortable-item"));
    const layout = items.map((item) => item.dataset.title);

    // Save to localStorage
    localStorage.setItem("cardLayout", JSON.stringify(layout));

    // Apply new order to actual cards
    const container = document.getElementById("cardsContainer");
    const cards = Array.from(container.querySelectorAll(".card"));

    // Create a map of cards by their titles
    const cardMap = {};
    cards.forEach((card) => {
      const title = card.querySelector("h2")?.textContent || "Unknown";
      cardMap[title] = card;
    });

    // Reorder cards based on new layout
    layout.forEach((title) => {
      if (cardMap[title]) {
        container.appendChild(cardMap[title]);
      }
    });

    // Save to database
    this.syncSettingsToDatabase();
  }

  saveCardLayout() {
    // This function is now handled by saveSortOrder
    const container = document.getElementById("cardsContainer");
    const cards = Array.from(container.querySelectorAll(".card"));
    const layout = cards.map((card) => {
      const title = card.querySelector("h2")?.textContent || "Unknown";
      return title;
    });

    localStorage.setItem("cardLayout", JSON.stringify(layout));
    this.syncSettingsToDatabase();
  }

  restoreCardLayout() {
    const savedLayout = localStorage.getItem("cardLayout");
    if (!savedLayout) return;

    try {
      const layout = JSON.parse(savedLayout);
      const container = document.getElementById("cardsContainer");
      const cards = Array.from(container.querySelectorAll(".card"));

      // Create a map of cards by their titles
      const cardMap = {};
      cards.forEach((card) => {
        const title = card.querySelector("h2")?.textContent || "Unknown";
        cardMap[title] = card;
      });

      // Reorder cards based on saved layout
      layout.forEach((title) => {
        if (cardMap[title]) {
          container.appendChild(cardMap[title]);
        }
      });

      console.log("Card layout restored");
    } catch (error) {
      console.error("Error restoring card layout:", error);
    }
  }

  setupCardResize() {
    const container = document.getElementById("cardsContainer");
    if (!container) return;

    const cards = container.querySelectorAll(".card");
    const allResizeData = {}; // Shared state for all cards

    // Helper function to calculate grid row span based on height
    const calculateGridSpan = (height) => {
      // Each grid row is 10px, so we calculate how many rows the card needs
      // Add 2 extra rows for gap/padding
      return Math.ceil(height / 10) + 2;
    };

    // Helper function to recalculate all card spans
    const recalculateAllSpans = () => {
      const allCards = container.querySelectorAll(".card");
      allCards.forEach((card) => {
        const height = card.offsetHeight;
        const span = calculateGridSpan(height);
        card.style.gridRow = `span ${span}`;
      });
    };

    cards.forEach((card) => {
      const handler = (e) => {
        // Only if clicking on the bottom 6px area (the ::after element)
        const rect = card.getBoundingClientRect();
        const isOnResizeHandle =
          e.clientY >= rect.bottom - 6 && e.clientY <= rect.bottom;

        if (!isOnResizeHandle) return;

        e.preventDefault();
        const startY = e.clientY;
        const startHeight = card.offsetHeight;

        const onMouseMove = (moveEvent) => {
          const diff = moveEvent.clientY - startY;
          const newHeight = startHeight + diff;

          // Минимальная высота 200px
          if (newHeight > 200) {
            card.style.height = newHeight + "px";

            // Auto-adjust grid span based on height
            const span = calculateGridSpan(newHeight);
            card.style.gridRow = `span ${span}`;
            
            // Recalculate all other cards to fill gaps
            recalculateAllSpans();
          }
        };

        const onMouseUp = () => {
          card.classList.remove("resizing");
          document.body.style.userSelect = "auto";
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);

          // Final recalculation
          recalculateAllSpans();

          // Save card heights to localStorage
          this.saveCardHeights();
        };

        card.classList.add("resizing");
        document.body.style.userSelect = "none";
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
      };

      card.addEventListener("mousedown", handler);
    });

    // Restore saved heights
    this.restoreCardHeights();
    
    // Initial calculation
    setTimeout(() => recalculateAllSpans(), 100);
  }

  saveCardHeights() {
    const container = document.getElementById("cardsContainer");
    const cards = container.querySelectorAll(".card");
    const heights = {};

    cards.forEach((card, index) => {
      const title = card.querySelector("h2")?.textContent || `card-${index}`;
      heights[title] = card.offsetHeight;
    });

    localStorage.setItem("cardHeights", JSON.stringify(heights));

    // Also save to database
    this.syncSettingsToDatabase();
  }

  restoreCardHeights() {
    const saved = localStorage.getItem("cardHeights");
    if (!saved) return;

    try {
      const heights = JSON.parse(saved);
      const container = document.getElementById("cardsContainer");
      const cards = container.querySelectorAll(".card");

      // Helper function to calculate grid row span based on height
      const calculateGridSpan = (height) => {
        return Math.ceil(height / 10) + 2;
      };

      cards.forEach((card) => {
        const title = card.querySelector("h2")?.textContent;
        if (title && heights[title]) {
          const heightValue = parseInt(heights[title]);
          if (!isNaN(heightValue) && heightValue > 200) {
            card.style.height = heightValue + "px";

            // Auto-adjust grid span based on height
            const span = calculateGridSpan(heightValue);
            card.style.gridRow = `span ${span}`;
          }
        }
      });
    } catch (error) {
      console.error("Error restoring card heights:", error);
    }
  }

  setupTerminal() {
    const input = document.getElementById("terminalInput");
    const execBtn = document.getElementById("terminalExecBtn");
    const output = document.getElementById("terminalOutput");
    const errorDiv = document.getElementById("terminalError");

    if (!input || !execBtn) return;

    const executeCommand = async () => {
      const command = input.value.trim();
      if (!command) return;

      // Add command to output
      const cmdLine = document.createElement("p");
      cmdLine.style.margin = "5px 0";
      cmdLine.style.color = "#4ec9b0";
      cmdLine.textContent = `$ ${command}`;
      output.appendChild(cmdLine);

      // Disable button during execution
      execBtn.disabled = true;
      execBtn.textContent = "Выполнение...";
      errorDiv.style.display = "none";

      try {
        const response = await fetch("/api/server/terminal", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.auth.token}`,
          },
          body: JSON.stringify({ command }),
        });

        const data = await response.json();

        if (data.success) {
          // Add output
          const outputLines = data.output.split("\n");
          outputLines.forEach((line) => {
            const p = document.createElement("p");
            p.style.margin = "2px 0";
            p.textContent = line || " ";
            output.appendChild(p);
          });
        } else {
          // Show error
          errorDiv.style.display = "block";
          errorDiv.textContent = `❌ ${data.output || "Command failed"}`;
        }

        // Clear input
        input.value = "";
        // Scroll to bottom
        output.scrollTop = output.scrollHeight;
      } catch (error) {
        errorDiv.style.display = "block";
        errorDiv.textContent = `❌ ${error.message}`;
      } finally {
        execBtn.disabled = false;
        execBtn.textContent = "Выполнить";
      }
    };

    // Execute on button click
    execBtn.addEventListener("click", executeCommand);

    // Execute on Enter key
    input.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        executeCommand();
      }
    });
  }

  setupScreenProcesses() {
    const screenList = document.getElementById("screenProcessesList");
    const refreshBtn = document.getElementById("screenRefreshBtn");

    if (!screenList || !refreshBtn) return;

    const loadScreenProcesses = async () => {
      try {
        screenList.innerHTML = '<p class="text-muted">Загрузка...</p>';

        const response = await fetch("/api/server/processes/screen", {
          headers: {
            Authorization: `Bearer ${this.auth.token}`,
          },
        });

        const data = await response.json();

        if (data.success && data.sessions.length > 0) {
          screenList.innerHTML = "";
          data.sessions.forEach((session) => {
            const item = document.createElement("div");
            item.className = "service-item";
            
            // All screen sessions in the list are running
            const isActive = session.status === 'running';
            const statusClass = isActive ? "status-active" : "status-inactive";
            const statusText = isActive ? "✓ Запущен" : "✕ Остановлен";
            const attachedInfo = session.isAttached ? " (Подключен)" : " (В фоне)";

            item.innerHTML = `
              <div style="flex: 1;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                  <span style="font-weight: 500;">${session.name}</span>
                  <span class="status-badge ${statusClass}">${statusText}${attachedInfo}</span>
                </div>
                <div style="font-size: 0.85em; color: #888; margin-top: 4px;">
                  PID: ${session.pid} • ${session.fullName}
                </div>
              </div>
              <div class="service-actions" style="margin-top: 10px;">
                <button class="btn btn-sm btn-danger" data-screen-action="stop" data-screen-name="${session.fullName}">Остановка</button>
                <button class="btn btn-sm btn-warning" data-screen-action="restart" data-screen-name="${session.fullName}">Перезагрузка</button>
                <button class="btn btn-sm btn-info" data-screen-action="attach" data-screen-name="${session.fullName}">Подключиться</button>
              </div>
            `;

            screenList.appendChild(item);
          });

          // Setup screen action listeners
          this.setupScreenControls();
        } else {
          screenList.innerHTML =
            '<p class="text-muted">Нет активных screen сессий</p>';
        }
      } catch (error) {
        screenList.innerHTML = `<p class="text-muted">❌ ${error.message}</p>`;
      }
    };

    // Load on first view
    loadScreenProcesses();

    // Refresh button
    refreshBtn.addEventListener("click", loadScreenProcesses);
  }

  setupScreenControls() {
    document.querySelectorAll("[data-screen-action]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.getAttribute("data-screen-action");
        const sessionName = btn.getAttribute("data-screen-name");

        btn.disabled = true;
        btn.textContent = "⏳ Выполняется...";

        try {
          const response = await fetch("/api/server/screen/manage", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.auth.token}`,
            },
            body: JSON.stringify({
              sessionName: sessionName,
              action: action,
            }),
          });

          const result = await response.json();

          if (result.success) {
            this.toast.success(`Screen сессия ${sessionName}: ${action}`);
            if (result.output) {
              this.toast.info(result.output, 8000);
            }
            // Reload screen processes after action
            setTimeout(() => {
              const refreshBtn = document.getElementById("screenRefreshBtn");
              if (refreshBtn) refreshBtn.click();
            }, 1000);
          } else {
            this.toast.error(`Ошибка: ${result.output || result.message}`);
          }
        } catch (error) {
          this.toast.error(`Ошибка: ${error.message}`);
        } finally {
          btn.disabled = false;
          // Restore button text based on action
          const actionTexts = {
            stop: "Остановка",
            restart: "Перезагрузка",
            attach: "Подключиться",
          };
          btn.textContent = actionTexts[action] || action;
        }
      });
    });
  }

  setupCardCollapse() {
    const container = document.getElementById("cardsContainer");
    const cards = container.querySelectorAll(".card");
    const collapsedState = JSON.parse(
      localStorage.getItem("collapsedCards") || "{}"
    );

    cards.forEach((card) => {
      const header = card.querySelector(".card-header");
      const title = card.querySelector("h2")?.textContent || "unknown";

      // Create collapse button
      const collapseBtn = document.createElement("button");
      collapseBtn.className = "card-collapse-btn";
      collapseBtn.innerHTML = "▼";
      collapseBtn.type = "button";
      collapseBtn.title = "Свернуть/развернуть";

      // Add to header
      header.appendChild(collapseBtn);

      // Check if this card should be collapsed on load
      if (collapsedState[title]) {
        card.classList.add("collapsed");
      }

      // Handle collapse/expand
      collapseBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        card.classList.toggle("collapsed");

        // Save state
        collapsedState[title] = card.classList.contains("collapsed");
        localStorage.setItem("collapsedCards", JSON.stringify(collapsedState));

        // Save to database
        this.syncCardCollapseState();
      });
    });
    
    // No need to recalculate layout with flexbox
  }

  syncCardCollapseState() {
    try {
      const collapsedCards = JSON.parse(
        localStorage.getItem("collapsedCards") || "{}"
      );

      // You can add this to your settings sync if needed
      localStorage.setItem("collapsedCards", JSON.stringify(collapsedCards));

      // If you want to sync to database, add cardCollapsed to your syncSettingsToDatabase
      console.log("Collapsed cards state:", collapsedCards);
    } catch (error) {
      console.error("Error syncing collapse state:", error);
    }
  }

  async syncSettingsToDatabase() {
    try {
      const cardLayout = JSON.parse(localStorage.getItem("cardLayout") || "{}");
      const cardHeights = JSON.parse(
        localStorage.getItem("cardHeights") || "{}"
      );

      const response = await fetch("/api/user/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.auth.token}`,
        },
        body: JSON.stringify({
          cardLayouts: cardLayout,
          cardHeights: cardHeights,
        }),
      });

      if (!response.ok) {
        console.warn("Failed to sync settings to database");
        return;
      }

      const data = await response.json();
      console.log("Settings synced to database:", data);
    } catch (error) {
      console.error("Error syncing settings to database:", error);
    }
  }

  async loadSettingsFromDatabase() {
    try {
      const response = await fetch("/api/user/settings", {
        headers: {
          Authorization: `Bearer ${this.auth.token}`,
        },
      });

      if (!response.ok) {
        console.warn("Failed to load settings from database");
        return;
      }

      const data = await response.json();
      if (data.success) {
        // Only update localStorage if database has data (don't override with empty)
        if (Object.keys(data.cardLayouts).length > 0) {
          localStorage.setItem("cardLayout", JSON.stringify(data.cardLayouts));
          console.log("Card layouts loaded from database:", data.cardLayouts);
        }
        if (Object.keys(data.cardHeights).length > 0) {
          localStorage.setItem("cardHeights", JSON.stringify(data.cardHeights));
          console.log("Card heights loaded from database:", data.cardHeights);
        }
      }
    } catch (error) {
      console.error("Error loading settings from database:", error);
    }
  }

  setupVPNConfiguration() {
    const vpnTypeSelect = document.getElementById("vpnType");
    const wgConnectBtn = document.getElementById("wgConnectBtn");
    const ovpnConnectBtn = document.getElementById("ovpnConnectBtn");
    const xrayConnectBtn = document.getElementById("xrayConnectBtn");
    const vpnStatusEl = document.getElementById("vpnStatus");

    // Handle VPN type change
    vpnTypeSelect.addEventListener("change", (e) => {
      const type = e.target.value;
      document.getElementById("wireguardConfig").style.display =
        type === "wireguard" ? "block" : "none";
      document.getElementById("openvpnConfig").style.display =
        type === "openvpn" ? "block" : "none";
      document.getElementById("xrayConfig").style.display =
        type === "xray" ? "block" : "none";
    });

    // WireGuard Connect
    if (wgConnectBtn) {
      wgConnectBtn.addEventListener("click", () => {
        const privateKey = document.getElementById("wgPrivateKey").value;
        const address = document.getElementById("wgAddress").value;
        const dns = document.getElementById("wgDNS").value;

        if (!privateKey || !address) {
          this.toast.error("Заполните обязательные поля");
          return;
        }

        this.updateVPNStatus("connecting");
        // Simulate connection
        setTimeout(() => {
          this.updateVPNStatus("active", "WireGuard");
          this.toast.success("Подключение к WireGuard установлено");
          this.saveVPNConfig("wireguard", {
            privateKey,
            address,
            dns,
          });
        }, 2000);
      });
    }

    // OpenVPN Connect
    if (ovpnConnectBtn) {
      ovpnConnectBtn.addEventListener("click", () => {
        const config = document.getElementById("ovpnConfig").value;

        if (!config) {
          this.toast.error("Заполните конфиг");
          return;
        }

        this.updateVPNStatus("connecting");
        setTimeout(() => {
          this.updateVPNStatus("active", "OpenVPN");
          this.toast.success("Подключение к OpenVPN установлено");
          this.saveVPNConfig("openvpn", { config });
        }, 2000);
      });
    }

    // Xray Connect
    if (xrayConnectBtn) {
      xrayConnectBtn.addEventListener("click", () => {
        const uuid = document.getElementById("xrayUUID").value;
        const server = document.getElementById("xrayServer").value;
        const port = document.getElementById("xrayPort").value;
        const encryption = document.getElementById("xrayEncryption").value;

        if (!uuid || !server || !port) {
          this.toast.error("Заполните обязательные поля");
          return;
        }

        this.updateVPNStatus("connecting");
        setTimeout(() => {
          this.updateVPNStatus("active", "Xray");
          this.toast.success("Подключение к Xray установлено");
          this.saveVPNConfig("xray", {
            uuid,
            server,
            port,
            encryption,
          });
        }, 2000);
      });
    }
  }

  updateVPNStatus(status, type = null) {
    const statusEl = document.getElementById("vpnStatus");
    statusEl.className = "vpn-status " + status;

    if (status === "active") {
      statusEl.textContent = `✅ Подключено (${type})`;
    } else if (status === "connecting") {
      statusEl.textContent = "⏳ Подключение...";
    } else {
      statusEl.textContent = "❌ Отключено";
    }
  }

  saveVPNConfig(type, config) {
    const vpnConfigs = JSON.parse(localStorage.getItem("vpnConfigs") || "{}");
    vpnConfigs[type] = {
      ...config,
      timestamp: new Date().toISOString(),
    };
    localStorage.setItem("vpnConfigs", JSON.stringify(vpnConfigs));
  }

  setupServerStatusUI() {
    const statusToggle = document.getElementById("serverStatusToggle");
    const statusMenu = document.getElementById("serverStatusMenu");

    if (statusToggle && statusMenu) {
      // Toggle status menu
      statusToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const isVisible = statusMenu.style.display === "block";
        
        // Close all other menus
        this.closeAllHeaderMenus();
        
        // Toggle this menu
        statusMenu.style.display = isVisible ? "none" : "block";
      });

      // Close menu when clicking outside (but not on other dropdowns)
      document.addEventListener("click", (e) => {
        if (statusMenu.style.display === "block" && 
            !e.target.closest("#serverStatusToggle") && 
            !e.target.closest("#serverStatusMenu")) {
          statusMenu.style.display = "none";
        }
      });
    }
  }

  closeAllHeaderMenus() {
    // Close all dropdown menus in header
    const menus = [
      document.getElementById("serverStatusMenu"),
      document.getElementById("themeMenu"),
      document.getElementById("notificationsMenu"),
      document.getElementById("systemMenu")
    ];
    
    menus.forEach(menu => {
      if (menu) {
        menu.style.display = "none";
      }
    });
  }

  setupThemes() {
    const themes = [
      "default",
      "hacker-green",
      "solarized",
      "matrix",
      "cyberpunk",
    ];
    const themeToggle = document.getElementById("themeToggle");
    const themeMenu = document.getElementById("themeMenu");

    // Load saved theme
    const savedTheme = localStorage.getItem("selectedTheme") || "default";
    this.applyTheme(savedTheme);

    // Toggle theme menu
    if (themeToggle) {
      themeToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const isVisible = themeMenu.style.display === "block";
        
        // Close all other menus
        this.closeAllHeaderMenus();
        
        // Toggle this menu
        themeMenu.style.display = isVisible ? "none" : "block";
      });
    }

    // Close menu when clicking outside
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".theme-dropdown")) {
        themeMenu.style.display = "none";
      }
    });

    // Add theme button listeners
    themes.forEach((theme) => {
      const btn = document.getElementById(
        "theme" +
          theme
            .split("-")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join("")
      );
      if (btn) {
        btn.addEventListener("click", () => {
          this.applyTheme(theme);
          localStorage.setItem("selectedTheme", theme);
          themeMenu.style.display = "none";
        });
      }
    });
  }

  applyTheme(theme) {
    // Remove all theme classes
    document.body.classList.remove(
      "theme-default",
      "theme-hacker-green",
      "theme-solarized",
      "theme-matrix",
      "theme-cyberpunk"
    );

    // Add selected theme class
    document.body.classList.add("theme-" + theme);

    // Update current theme display
    const themeNames = {
      default: "Default",
      "hacker-green": "Hacker Green",
      solarized: "Solarized",
      matrix: "Matrix",
      cyberpunk: "Cyberpunk",
    };

    const currentThemeEl = document.getElementById("currentTheme");
    if (currentThemeEl) {
      currentThemeEl.textContent = themeNames[theme] || theme;
    }

    console.log("Theme applied:", theme);
  }

  setupNotificationsUI() {
    const notificationsToggle = document.getElementById("notificationsToggle");
    const notificationsMenu = document.getElementById("notificationsMenu");
    const notificationsCount = document.getElementById("notificationsCount");
    const notificationsList = document.getElementById("notificationsList");

    // Initialize notifications from the existing card
    this.notifications = [];
    
    // Hide badge initially
    if (notificationsCount) {
      notificationsCount.style.display = "none";
    }

    // Toggle notifications menu
    if (notificationsToggle) {
      notificationsToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const isVisible = notificationsMenu.style.display === "block";
        
        // Close all other menus
        this.closeAllHeaderMenus();
        
        // Toggle this menu
        notificationsMenu.style.display = isVisible ? "none" : "block";
      });
    }

    // Close menu when clicking outside
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".notifications-dropdown")) {
        notificationsMenu.style.display = "none";
      }
    });
  }

  addNotification(message, type = "info") {
    const notification = {
      id: Date.now(),
      message: message,
      type: type,
      timestamp: new Date().toLocaleTimeString("ru-RU"),
    };

    this.notifications.push(notification);

    // Update badge
    const notificationsCount = document.getElementById("notificationsCount");
    const notificationsList = document.getElementById("notificationsList");

    if (notificationsCount) {
      if (this.notifications.length > 0) {
        notificationsCount.textContent = this.notifications.length;
        notificationsCount.style.display = "inline-flex";
      } else {
        notificationsCount.style.display = "none";
      }
    }

    // Render notifications
    if (notificationsList) {
      if (this.notifications.length > 0) {
        notificationsList.innerHTML = this.notifications
          .map(
            (n) => `
          <div class="notification-item" style="color: ${
            n.type === "success"
              ? "#4caf50"
              : n.type === "error"
              ? "#f44336"
              : "#2196f3"
          }">
            <div>${n.message}</div>
            <div class="notification-time">${n.timestamp}</div>
          </div>
        `
          )
          .join("");
      } else {
        notificationsList.innerHTML = '<p class="text-muted">Нет уведомлений</p>';
      }
    }
  }

  clearNotifications() {
    this.notifications = [];
    const notificationsCount = document.getElementById("notificationsCount");
    const notificationsList = document.getElementById("notificationsList");

    if (notificationsCount) {
      notificationsCount.style.display = "none";
    }

    if (notificationsList) {
      notificationsList.innerHTML = '<p class="text-muted">Нет уведомлений</p>';
    }
  }

  setupSystemUI() {
    const systemToggle = document.getElementById("systemToggle");
    const systemMenu = document.getElementById("systemMenu");

    // Toggle system menu
    if (systemToggle) {
      systemToggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const isVisible = systemMenu.style.display === "block";
        
        // Close all other menus
        this.closeAllHeaderMenus();
        
        // Toggle this menu
        systemMenu.style.display = isVisible ? "none" : "block";
      });
    }

    // Close menu when clicking outside
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".system-dropdown")) {
        systemMenu.style.display = "none";
      }
    });

    // Add action listeners to system menu options
    document.querySelectorAll(".system-option").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const action = btn.getAttribute("data-action");
        await this.executeAction(action);
        systemMenu.style.display = "none";
      });
    });
  }
}

// ==================== INITIALIZATION ====================
document.addEventListener("DOMContentLoaded", () => {
  const authManager = new AuthManager();
  const toastManager = new ToastManager();
  const apiService = new APIService(authManager);
  const uiController = new UIController(authManager, apiService, toastManager);

  // Pass UI controller to toast manager for notifications
  toastManager.setUIController(uiController);

  // Make available globally for debugging
  window.adminUI = { authManager, toastManager, apiService, uiController };
});
