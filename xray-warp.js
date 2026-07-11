// ==================== XRAY CARD ====================
const xrayCard = {
  clients: [],

  async init() {
    await this.checkStatus();
    await this.loadClients();
  },

  async api(method, path, body) {
    const token = localStorage.getItem("admin_token");
    const opts = {
      method,
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(`/api/xray${path}`, opts);
    if (resp.status === 401) { localStorage.clear(); location.reload(); return null; }
    return resp.json();
  },

  async checkStatus() {
    const badge = document.getElementById("xrayStatusBadge");
    try {
      const data = await this.api("GET", "/status");
      if (data.active) {
        badge.textContent = "🟢 Running";
        badge.style.color = "#4caf50";
      } else {
        badge.textContent = "🔴 " + data.status;
        badge.style.color = "#f44336";
      }
    } catch {
      badge.textContent = "🔴 Error";
      badge.style.color = "#f44336";
    }
  },

  async serviceAction(action) {
    const toast = window.adminUI?.toastManager;
    try {
      await this.api("POST", `/service/${action}`);
      if (toast) toast.success(`Xray: ${action} выполнен`);
      await this.checkStatus();
      if (action !== "stop") await this.loadClients();
    } catch (err) {
      if (toast) toast.error(`Ошибка: ${err.message}`);
    }
  },

  async loadClients() {
    const list = document.getElementById("xrayClientsList");
    try {
      const data = await this.api("GET", "/clients");
      if (!data || !data.success) { list.innerHTML = '<p class="text-muted">Ошибка загрузки</p>'; return; }
      this.clients = data.clients || [];
      if (!this.clients.length) { list.innerHTML = '<p class="text-muted">Нет клиентов</p>'; return; }

      // Load traffic for each client
      const trafficPromises = this.clients.map(c => this.api("GET", `/clients/${c.uuid}/traffic-total`).catch(() => null));
      const trafficResults = await Promise.all(trafficPromises);

      list.innerHTML = this.clients.map((c, i) => {
        const tr = trafficResults[i];
        const usedGB = tr?.traffic_used_gb || 0;
        const limitGB = tr?.traffic_limit_gb || 100;
        const status = tr?.status || c.status || "active";
        const statusIcon = status === "active" ? "🟢" : status === "blocked" ? "🔴" : "🟡";
        const pct = limitGB > 0 ? Math.min((usedGB / limitGB) * 100, 100).toFixed(1) : 0;
        return `
          <div class="xray-client-row" onclick="xrayCard.showClientInfo('${c.uuid}')" style="display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: rgba(255,255,255,0.04); border-radius: 8px; cursor: pointer; transition: background 0.2s">
            <span>${statusIcon}</span>
            <span style="flex: 1; font-weight: 500">${this.esc(c.name || c.email)}</span>
            <span style="font-size: 0.85em; color: #888">${usedGB.toFixed(1)} / ${limitGB} GB (${pct}%)</span>
            <span style="font-size: 1.1em" title="Подробнее">ℹ️</span>
          </div>`;
      }).join("");
    } catch (err) {
      list.innerHTML = `<p class="text-muted">Ошибка: ${err.message}</p>`;
    }
  },

  async showClientInfo(uuid) {
    const modal = document.getElementById("xrayClientModal");
    const body = document.getElementById("xrayClientModalBody");
    const footer = document.getElementById("xrayClientModalFooter");
    const title = document.getElementById("xrayClientModalTitle");
    modal.style.display = "flex";
    body.innerHTML = '<p class="text-muted">Загрузка...</p>';

    try {
      const [clientData, trafficData, subData] = await Promise.all([
        this.api("GET", `/clients/${uuid}`),
        this.api("GET", `/clients/${uuid}/traffic-total`),
        this.api("GET", `/clients/${uuid}/subscription`),
      ]);

      const c = clientData?.client || clientData;
      const tr = trafficData || {};
      const sub = subData || {};

      title.textContent = `ℹ️ ${this.esc(c.name || c.email)}`;

      const usedGB = (tr.traffic_used_gb || 0).toFixed(2);
      const limitGB = tr.traffic_limit_gb || 100;
      const pct = limitGB > 0 ? ((tr.traffic_used_gb || 0) / limitGB * 100).toFixed(1) : 0;
      const status = c.status || "active";
      const statusColor = status === "active" ? "#4caf50" : status === "blocked" ? "#f44336" : "#ff9800";
      const daysLeft = sub.days_remaining ?? "N/A";

      body.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 12px">
          <div class="info-row"><span class="info-label">UUID:</span><span style="font-family: monospace; font-size: 0.85em; word-break: break-all">${this.esc(c.uuid)}</span></div>
          <div class="info-row"><span class="info-label">Email:</span><span>${this.esc(c.email || "N/A")}</span></div>
          <div class="info-row"><span class="info-label">Telegram ID:</span><span>${c.telegram_id || "N/A"}</span></div>
          <div class="info-row"><span class="info-label">Статус:</span><span style="color: ${statusColor}; font-weight: 600">${status}</span></div>
          <div class="info-row"><span class="info-label">Подписка:</span><span>${sub.subscription_start ? new Date(sub.subscription_start).toLocaleDateString("ru-RU") : "N/A"} → ${sub.subscription_end ? new Date(sub.subscription_end).toLocaleDateString("ru-RU") : "N/A"} <span style="color: ${daysLeft < 7 ? '#ff9800' : '#888'}">(${daysLeft} дн.)</span></span></div>
          <div class="info-row"><span class="info-label">Трафик:</span><span>${usedGB} / ${limitGB} GB (${pct}%)</span></div>
          <div style="height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden">
            <div style="height: 100%; width: ${Math.min(pct, 100)}%; background: ${pct > 90 ? '#f44336' : pct > 70 ? '#ff9800' : '#4caf50'}; border-radius: 3px"></div>
          </div>
          <div class="info-row"><span class="info-label">Устройства:</span><span>${c.max_devices || 2}</span></div>
          <div class="info-row"><span class="info-label">Предупреждения:</span><span>${c.warnings_count || 0} / 3</span></div>
        </div>`;

      // Build action buttons
      const btns = [];
      if (status === "blocked") {
        btns.push(`<button class="btn btn-sm btn-success" onclick="xrayCard.clientAction('${uuid}','unblock')">🔓 Разблокировать</button>`);
      } else {
        btns.push(`<button class="btn btn-sm btn-danger" onclick="xrayCard.clientBlock('${uuid}')">🚫 Заблокировать</button>`);
      }
      btns.push(`<button class="btn btn-sm btn-info" onclick="xrayCard.clientShowSub('${uuid}')">📋 Ссылка</button>`);
      btns.push(`<button class="btn btn-sm btn-warning" onclick="xrayCard.clientExtend('${uuid}')">⏰ Продлить</button>`);
      btns.push(`<button class="btn btn-sm btn-secondary" onclick="xrayCard.clientWarn('${uuid}')">⚠️ Предупреждение</button>`);
      btns.push(`<button class="btn btn-sm btn-secondary" onclick="xrayCard.clientAction('${uuid}','reset-warnings')">🔄 Сброс предупр.</button>`);
      btns.push(`<button class="btn btn-sm btn-secondary" onclick="xrayCard.clientResetTraffic('${uuid}')">📊 Сброс трафика</button>`);
      footer.innerHTML = btns.join("") + `<button class="btn btn-secondary" onclick="document.getElementById('xrayClientModal').style.display='none'">Закрыть</button>`;
    } catch (err) {
      body.innerHTML = `<p class="text-muted">Ошибка: ${err.message}</p>`;
    }
  },

  async clientAction(uuid, action, body) {
    const toast = window.adminUI?.toastManager;
    try {
      const data = await this.api("POST", `/clients/${uuid}/${action}`, body || {});
      if (toast) toast.success(data.message || "Выполнено");
      await this.loadClients();
      this.showClientInfo(uuid);
    } catch (err) {
      if (toast) toast.error(err.message);
    }
  },

  async clientBlock(uuid) {
    const reason = prompt("Причина блокировки:");
    if (reason === null) return;
    await this.clientAction(uuid, "block", { reason });
  },

  async clientWarn(uuid) {
    const reason = prompt("Причина предупреждения:");
    if (reason === null) return;
    await this.clientAction(uuid, "warn", { reason });
  },

  async clientExtend(uuid) {
    const days = prompt("Дней для продления (7, 14, 30, 60, 90, 180, 365):", "30");
    if (!days) return;
    await this.clientAction(uuid, "extend", { days: parseInt(days) });
  },

  async clientResetTraffic(uuid) {
    if (!confirm("Сбросить трафик?")) return;
    const toast = window.adminUI?.toastManager;
    try {
      await this.api("POST", `/stats/clients/${uuid}/reset`);
      if (toast) toast.success("Трафик сброшен");
      this.showClientInfo(uuid);
    } catch (err) {
      if (toast) toast.error(err.message);
    }
  },

  async clientShowSub(uuid) {
    const toast = window.adminUI?.toastManager;
    try {
      const data = await fetch(`/api/xray/subscription/${uuid}`, {
        headers: { "Authorization": `Bearer ${localStorage.getItem("admin_token")}` }
      }).then(r => r.json());
      const links = data.links || data.subscription || data;
      const text = typeof links === "string" ? links : JSON.stringify(links, null, 2);
      const body = document.getElementById("xrayClientModalBody");
      body.innerHTML += `
        <div style="margin-top: 15px">
          <label style="font-weight: 500; display: block; margin-bottom: 5px">Ссылка подключения:</label>
          <textarea readonly style="width: 100%; height: 80px; background: rgba(0,0,0,0.3); color: #4caf50; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 10px; font-family: monospace; font-size: 0.8em; resize: vertical">${this.esc(text)}</textarea>
          <button class="btn btn-sm btn-success" style="margin-top: 8px" onclick="navigator.clipboard.writeText(this.previousElementSibling.value); window.adminUI?.toastManager?.success('Скопировано!')">📋 Копировать</button>
        </div>`;
    } catch (err) {
      if (toast) toast.error(err.message);
    }
  },

  // ==================== ADMIN MODAL ====================
  showAdminModal() {
    document.getElementById("xrayAdminModal").style.display = "flex";
    document.getElementById("xrayAdminResult").innerHTML = "";
  },

  adminResult(html) {
    document.getElementById("xrayAdminResult").innerHTML = html;
  },

  async adminAddClient() {
    const name = prompt("Имя клиента:");
    if (!name) return;
    const telegramId = prompt("Telegram ID (или 0):", "0");
    const days = prompt("Дней подписки:", "30");
    const toast = window.adminUI?.toastManager;
    try {
      const data = await this.api("POST", "/clients", {
        name, telegram_id: parseInt(telegramId) || 0, subscription_days: parseInt(days) || 30
      });
      if (toast) toast.success(`Клиент ${name} добавлен`);
      await this.loadClients();
    } catch (err) {
      if (toast) toast.error(err.message);
    }
  },

  async adminRemoveClient() {
    if (!this.clients.length) return alert("Нет клиентов");
    const list = this.clients.map((c, i) => `${i + 1}. ${c.name || c.email}`).join("\n");
    const idx = prompt(`Выберите номер клиента:\n${list}`);
    if (!idx) return;
    const c = this.clients[parseInt(idx) - 1];
    if (!c || !confirm(`Удалить ${c.name || c.email}?`)) return;
    const toast = window.adminUI?.toastManager;
    try {
      await this.api("DELETE", `/clients/${c.uuid}`);
      if (toast) toast.success(`Клиент ${c.name} удалён`);
      await this.loadClients();
    } catch (err) {
      if (toast) toast.error(err.message);
    }
  },

  async adminRenameClient() {
    if (!this.clients.length) return alert("Нет клиентов");
    const list = this.clients.map((c, i) => `${i + 1}. ${c.name || c.email}`).join("\n");
    const idx = prompt(`Выберите номер клиента:\n${list}`);
    if (!idx) return;
    const c = this.clients[parseInt(idx) - 1];
    if (!c) return;
    const newName = prompt(`Новое имя для ${c.name}:`, c.name);
    if (!newName || newName === c.name) return;
    const toast = window.adminUI?.toastManager;
    try {
      await this.api("PUT", `/clients/${c.uuid}`, { name: newName });
      if (toast) toast.success("Переименован");
      await this.loadClients();
    } catch (err) {
      if (toast) toast.error(err.message);
    }
  },

  async adminExtendClient() {
    if (!this.clients.length) return alert("Нет клиентов");
    const list = this.clients.map((c, i) => `${i + 1}. ${c.name || c.email}`).join("\n");
    const idx = prompt(`Выберите номер клиента:\n${list}`);
    if (!idx) return;
    const c = this.clients[parseInt(idx) - 1];
    if (!c) return;
    const days = prompt("Дней для продления:", "30");
    if (!days) return;
    const toast = window.adminUI?.toastManager;
    try {
      await this.api("POST", `/clients/${c.uuid}/extend`, { days: parseInt(days) });
      if (toast) toast.success("Продлено");
    } catch (err) {
      if (toast) toast.error(err.message);
    }
  },

  async adminBansWarnings() {
    const toast = window.adminUI?.toastManager;
    try {
      const data = await this.api("GET", "/clients");
      const blocked = (data.clients || []).filter(c => c.status === "blocked" || c.warnings_count > 0);
      if (!blocked.length) { this.adminResult('<p class="text-muted">Нет заблокированных или предупреждённых клиентов</p>'); return; }
      this.adminResult(blocked.map(c => `
        <div style="padding: 8px; background: rgba(255,255,255,0.04); border-radius: 6px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center">
          <span>${c.status === "blocked" ? "🚫" : "⚠️"} ${this.esc(c.name)} — ${c.status} (${c.warnings_count}/3)</span>
          ${c.status === "blocked" ? `<button class="btn btn-sm btn-success" onclick="xrayCard.clientAction('${c.uuid}','unblock')">Разблокировать</button>` : ""}
        </div>`).join(""));
    } catch (err) {
      if (toast) toast.error(err.message);
    }
  },

  async adminCheckSubscriptions() {
    this.adminResult('<p class="text-muted">Проверка подписок... (выполняется на сервере)</p>');
    // This would need a server-side endpoint to run subscription-checker.js
    this.adminResult('<p class="text-muted">⚠️ Проверка подписок доступна через Telegram бот</p>');
  },

  async adminCheckTraffic() {
    this.adminResult('<p class="text-muted">⚠️ Проверка трафика доступна через Telegram бот</p>');
  },

  async adminCheckDevices() {
    this.adminResult('<p class="text-muted">⚠️ Проверка устройств доступна через Telegram бот</p>');
  },

  async adminCheckTorrents() {
    this.adminResult('<p class="text-muted">⚠️ Проверка торрентов доступна через Telegram бот</p>');
  },

  async adminRequests() {
    const toast = window.adminUI?.toastManager;
    try {
      const data = await this.api("GET", "/extension-requests");
      const requests = data.requests || data || [];
      if (!requests.length) { this.adminResult('<p class="text-muted">Нет запросов</p>'); return; }
      this.adminResult(requests.slice(0, 10).map(r => `
        <div style="padding: 8px; background: rgba(255,255,255,0.04); border-radius: 6px; margin-bottom: 6px">
          <span style="color: ${r.status === 'pending' ? '#ff9800' : r.status === 'approved' ? '#4caf50' : '#f44336'}">[${r.status}]</span>
          UUID: ${r.client_uuid?.slice(0, 8)}... — ${r.requested_days || r.requested_months * 30} дн.
        </div>`).join(""));
    } catch (err) {
      if (toast) toast.error(err.message);
    }
  },

  async showLogs() {
    const modal = document.getElementById("xrayLogsModal");
    const content = document.getElementById("xrayLogsContent");
    modal.style.display = "flex";
    content.textContent = "Загрузка...";
    try {
      const data = await this.api("GET", "/logs");
      content.textContent = data.logs || "Нет логов";
    } catch (err) {
      content.textContent = "Ошибка: " + err.message;
    }
  },

  esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }
};

// ==================== WARP CARD ====================
const warpCard = {
  async init() {
    await this.checkStatus();
    await this.loadDomains();
  },

  async api(method, path, body) {
    const token = localStorage.getItem("admin_token");
    const opts = {
      method,
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(`/api/xray${path}`, opts);
    if (resp.status === 401) { localStorage.clear(); location.reload(); return null; }
    return resp.json();
  },

  async checkStatus() {
    const badge = document.getElementById("warpStatusBadge");
    try {
      const data = await this.api("GET", "/warp-status");
      if (data.connected) {
        badge.textContent = "🟢 Connected";
        badge.style.color = "#4caf50";
      } else {
        badge.textContent = "🔴 Disconnected";
        badge.style.color = "#f44336";
      }
    } catch {
      badge.textContent = "🔴 Error";
      badge.style.color = "#f44336";
    }
  },

  async loadDomains() {
    const list = document.getElementById("warpDomainsList");
    try {
      const data = await this.api("GET", "/warp-domains");
      if (!data || !data.success) { list.innerHTML = '<p class="text-muted">Ошибка загрузки</p>'; return; }
      const domains = (data.domains || []).map(d => d.replace(/^domain:/, ""));
      if (!domains.length) { list.innerHTML = '<p class="text-muted">Нет доменов в WARP</p>'; return; }
      list.innerHTML = domains.map(d => `
        <div style="display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: rgba(255,255,255,0.04); border-radius: 6px">
          <span style="flex: 1">${this.esc(d)}</span>
          <button class="btn btn-sm btn-danger" onclick="warpCard.removeDomain('${this.esc(d)}')">❌</button>
        </div>`).join("");
    } catch (err) {
      list.innerHTML = `<p class="text-muted">Ошибка: ${err.message}</p>`;
    }
  },

  async addDomain() {
    const input = document.getElementById("warpDomainInput");
    const domain = input.value.trim();
    if (!domain) return;
    const toast = window.adminUI?.toastManager;
    try {
      await this.api("POST", "/warp-domains", { domain, action: "add" });
      input.value = "";
      if (toast) toast.success(`Домен ${domain} добавлен`);
      await this.loadDomains();
    } catch (err) {
      if (toast) toast.error(err.message);
    }
  },

  async removeDomain(domain) {
    if (!confirm(`Удалить ${domain} из WARP?`)) return;
    const toast = window.adminUI?.toastManager;
    try {
      await this.api("POST", "/warp-domains", { domain, action: "remove" });
      if (toast) toast.success(`Домен ${domain} удалён`);
      await this.loadDomains();
    } catch (err) {
      if (toast) toast.error(err.message);
    }
  },

  esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }
};

// ==================== INIT ====================
// Hook into the existing dashboard lifecycle
const _origShowDashboard = UIController.prototype.showDashboard;
UIController.prototype.showDashboard = function() {
  _origShowDashboard.call(this);
  // Init Xray and WARP cards after dashboard loads
  setTimeout(() => {
    xrayCard.init();
    warpCard.init();
  }, 500);
};
