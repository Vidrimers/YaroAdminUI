// ==================== CUSTOM MODAL SYSTEM ====================
const XrayModal = {
  _nextId: 0,

  _esc(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  },

  // Generic modal: returns promise that resolves to button index clicked
  show(title, bodyHtml, buttons = [{ text: "Закрыть", class: "btn-secondary" }]) {
    return new Promise(resolve => {
      const id = "xray-modal-" + (++this._nextId);
      const existing = document.getElementById(id);
      if (existing) existing.remove();

      const overlay = document.createElement("div");
      overlay.id = id;
      overlay.className = "modal";
      overlay.style.display = "flex";
      overlay.innerHTML = `
        <div class="modal-content" style="max-width: 500px">
          <div class="modal-header">
            <h2>${title}</h2>
            <button class="modal-close" data-action="-1">&times;</button>
          </div>
          <div class="modal-body">${bodyHtml}</div>
          <div class="modal-footer" style="flex-wrap: wrap; gap: 8px">
            ${buttons.map((b, i) => `<button class="btn btn-sm ${b.class || 'btn-secondary'}" data-action="${i}">${b.text}</button>`).join("")}
          </div>
        </div>`;

      document.body.appendChild(overlay);

      const close = (actionIdx) => {
        overlay.remove();
        resolve(actionIdx);
      };

      overlay.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-action]");
        if (btn) close(parseInt(btn.dataset.action));
        else if (e.target === overlay) close(-1);
      });
    });
  },

  // Prompt: returns promise with input value or null
  prompt(title, placeholder = "", defaultValue = "") {
    return new Promise(resolve => {
      const id = "xray-modal-" + (++this._nextId);
      const existing = document.getElementById(id);
      if (existing) existing.remove();

      const overlay = document.createElement("div");
      overlay.id = id;
      overlay.className = "modal";
      overlay.style.display = "flex";
      overlay.innerHTML = `
        <div class="modal-content" style="max-width: 420px">
          <div class="modal-header">
            <h2>${this._esc(title)}</h2>
            <button class="modal-close" data-action="cancel">&times;</button>
          </div>
          <div class="modal-body">
            <input type="text" id="${id}-input" value="${this._esc(defaultValue)}" placeholder="${this._esc(placeholder)}"
              style="width: 100%; padding: 10px 14px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: #e0e0e0; font-size: 0.95em; box-sizing: border-box">
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary btn-sm" data-action="cancel">Отмена</button>
            <button class="btn btn-success btn-sm" data-action="ok">OK</button>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      const input = document.getElementById(`${id}-input`);
      input.focus();
      input.select();

      const close = (val) => {
        overlay.remove();
        resolve(val);
      };

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") close(input.value);
        if (e.key === "Escape") close(null);
      });

      overlay.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-action]");
        if (btn) {
          if (btn.dataset.action === "ok") close(input.value);
          else close(null);
        } else if (e.target === overlay) close(null);
      });
    });
  },

  // Confirm: returns promise with boolean
  confirm(title, message = "") {
    return this.show(title, message ? `<p>${this._esc(message)}</p>` : "", [
      { text: "Отмена", class: "btn-secondary" },
      { text: "Да", class: "btn-danger" },
    ]).then(idx => idx === 1);
  },

  // Client picker with search: returns promise with client object or null
  clientPicker(title, clients, extraAction = null) {
    // extraAction: { text: "Продлить", callback: (client) => ... }
    return new Promise(resolve => {
      const id = "xray-modal-" + (++this._nextId);
      const existing = document.getElementById(id);
      if (existing) existing.remove();

      const renderList = (filter = "") => {
        const filtered = filter
          ? clients.filter(c => (c.name || c.email || "").toLowerCase().includes(filter.toLowerCase()))
          : clients;
        if (!filtered.length) return '<p class="text-muted" style="padding: 10px 0">Нет результатов</p>';
        return filtered.map(c => `
          <div class="xray-picker-item" data-uuid="${c.uuid}" style="display: flex; align-items: center; gap: 10px; padding: 10px 12px; background: rgba(255,255,255,0.04); border-radius: 6px; cursor: pointer; transition: background 0.15s">
            <span style="flex: 1; font-weight: 500">${this._esc(c.name || c.email)}</span>
            ${c.status === "blocked" ? '<span style="color: #f44336; font-size: 0.8em">🚫 blocked</span>' : ""}
          </div>`).join("");
      };

      const overlay = document.createElement("div");
      overlay.id = id;
      overlay.className = "modal";
      overlay.style.display = "flex";
      overlay.innerHTML = `
        <div class="modal-content" style="max-width: 450px">
          <div class="modal-header">
            <h2>${this._esc(title)}</h2>
            <button class="modal-close" data-action="close">&times;</button>
          </div>
          <div class="modal-body">
            <input type="text" id="${id}-search" placeholder="Поиск..."
              style="width: 100%; padding: 10px 14px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; color: #e0e0e0; font-size: 0.95em; margin-bottom: 12px; box-sizing: border-box">
            <div id="${id}-list" style="max-height: 350px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px">
              ${renderList()}
            </div>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      const searchInput = document.getElementById(`${id}-search`);
      const listEl = document.getElementById(`${id}-list`);
      searchInput.focus();

      searchInput.addEventListener("input", () => {
        listEl.innerHTML = renderList(searchInput.value);
      });

      const close = (val) => {
        overlay.remove();
        resolve(val);
      };

      overlay.addEventListener("click", (e) => {
        if (e.target.closest("[data-action='close']") || e.target === overlay) {
          close(null);
          return;
        }
        const item = e.target.closest(".xray-picker-item");
        if (item) {
          const uuid = item.dataset.uuid;
          const client = clients.find(c => c.uuid === uuid);
          close(client);
        }
      });

      searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") close(null);
        if (e.key === "Enter") {
          const firstItem = listEl.querySelector(".xray-picker-item");
          if (firstItem) {
            const client = clients.find(c => c.uuid === firstItem.dataset.uuid);
            close(client);
          }
        }
      });
    });
  },
};

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

      list.innerHTML = this.clients.map((c) => {
        const usedGB = c.traffic_used_gb || 0;
        const limitGB = c.traffic_limit_gb || 100;
        const status = c.status || "active";
        const statusIcon = status === "active" ? "🟢" : status === "blocked" ? "🔴" : "🟡";
        const pct = limitGB > 0 ? Math.min((usedGB / limitGB) * 100, 100).toFixed(1) : 0;
        return `
          <div class="xray-client-row" onclick="xrayCard.showClientInfo('${c.uuid}')" style="display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: rgba(255,255,255,0.04); border-radius: 8px; cursor: pointer; transition: background 0.2s">
            <span>${statusIcon}</span>
            <span style="flex: 1; font-weight: 500">${XrayModal._esc(c.name || c.email)}</span>
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
      const [clientData, subData] = await Promise.all([
        this.api("GET", `/clients/${uuid}`),
        this.api("GET", `/clients/${uuid}/subscription`),
      ]);

      const c = clientData?.client || clientData;
      const sub = subData?.subscription || subData || {};

      title.textContent = `ℹ️ ${XrayModal._esc(c.name || c.email)}`;

      const usedGB = (c.traffic_used_gb || 0).toFixed(2);
      const limitGB = c.traffic_limit_gb || 100;
      const pct = limitGB > 0 ? ((c.traffic_used_gb || 0) / limitGB * 100).toFixed(1) : 0;
      const status = c.status || "active";
      const statusColor = status === "active" ? "#4caf50" : status === "blocked" ? "#f44336" : "#ff9800";
      const daysLeft = sub.subscription_days_remaining ?? sub.days_remaining ?? "N/A";
      const subStart = sub.subscription_start || c.subscription_start;
      const subEnd = sub.subscription_end || c.subscription_end;

      body.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 12px">
          <div class="info-row"><span class="info-label">UUID:</span><span style="font-family: monospace; font-size: 0.85em; word-break: break-all">${XrayModal._esc(c.uuid)}</span></div>
          <div class="info-row"><span class="info-label">Email:</span><span>${XrayModal._esc(c.email || "N/A")}</span></div>
          <div class="info-row"><span class="info-label">Telegram ID:</span><span>${c.telegram_id || "N/A"}</span></div>
          <div class="info-row"><span class="info-label">Статус:</span><span style="color: ${statusColor}; font-weight: 600">${status}</span></div>
          <div class="info-row"><span class="info-label">Подписка:</span><span>${subStart ? new Date(subStart).toLocaleDateString("ru-RU") : "N/A"} → ${subEnd ? new Date(subEnd).toLocaleDateString("ru-RU") : "N/A"} <span style="color: ${daysLeft < 7 ? '#ff9800' : '#888'}">(${daysLeft} дн.)</span></span></div>
          <div class="info-row"><span class="info-label">Трафик:</span><span>${usedGB} / ${limitGB} GB (${pct}%)</span></div>
          <div style="height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden">
            <div style="height: 100%; width: ${Math.min(pct, 100)}%; background: ${pct > 90 ? '#f44336' : pct > 70 ? '#ff9800' : '#4caf50'}; border-radius: 3px"></div>
          </div>
          <div class="info-row"><span class="info-label">Устройства:</span><span>${c.max_devices || 2}</span></div>
          <div class="info-row"><span class="info-label">Предупреждения:</span><span>${c.warnings_count || 0} / 3</span></div>
        </div>`;

      const btns = [];
      if (status === "blocked") {
        btns.push(`<button class="btn btn-sm btn-success" onclick="xrayCard.clientAction('${uuid}','unblock')">🔓 Разблокировать</button>`);
      } else {
        btns.push(`<button class="btn btn-sm btn-danger" onclick="xrayCard.clientBlock('${uuid}')">🚫 Заблокировать</button>`);
      }
      btns.push(`<button class="btn btn-sm btn-info" onclick="xrayCard.clientShowSubUrl('${uuid}')">🔗 Подписка</button>`);
      btns.push(`<button class="btn btn-sm btn-info" onclick="xrayCard.clientShowSub('${uuid}')">📋 Ссылки</button>`);
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
    const reason = await XrayModal.prompt("Причина блокировки", "Введите причину");
    if (reason === null) return;
    await this.clientAction(uuid, "block", { reason });
  },

  async clientWarn(uuid) {
    const reason = await XrayModal.prompt("Причина предупреждения", "Введите причину");
    if (reason === null) return;
    await this.clientAction(uuid, "warn", { reason });
  },

  async clientExtend(uuid) {
    const days = await XrayModal.prompt("Дней для продления", "7, 14, 30, 60, 90, 180, 365", "30");
    if (!days) return;
    await this.clientAction(uuid, "extend", { days: parseInt(days) });
  },

  async clientResetTraffic(uuid) {
    if (!await XrayModal.confirm("Сбросить трафик?", "Трафик будет обнулён для этого клиента.")) return;
    const toast = window.adminUI?.toastManager;
    try {
      await this.api("POST", `/stats/clients/${uuid}/reset`);
      if (toast) toast.success("Трафик сброшен");
      this.showClientInfo(uuid);
    } catch (err) {
      if (toast) toast.error(err.message);
    }
  },

  async clientShowSubUrl(uuid) {
    const url = `https://1xbetlineboom.xyz/subscription/${uuid}`;
    const body = document.getElementById("xrayClientModalBody");
    // Remove existing sub sections
    body.querySelectorAll(".sub-section").forEach(el => el.remove());
    const div = document.createElement("div");
    div.className = "sub-section";
    div.style.cssText = "margin-top: 15px";
    div.innerHTML = `
      <label style="font-weight: 500; display: block; margin-bottom: 5px">🔗 Ссылка подписки:</label>
      <input readonly value="${XrayModal._esc(url)}" style="width: 100%; padding: 10px; background: rgba(0,0,0,0.3); color: #4caf50; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; font-family: monospace; font-size: 0.85em; box-sizing: border-box">
      <button class="btn btn-sm btn-success" style="margin-top: 8px" onclick="navigator.clipboard.writeText(this.previousElementSibling.value); window.adminUI?.toastManager?.success('Скопировано!')">📋 Копировать</button>`;
    body.appendChild(div);
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
      body.querySelectorAll(".sub-section").forEach(el => el.remove());
      const div = document.createElement("div");
      div.className = "sub-section";
      div.style.cssText = "margin-top: 15px";
      div.innerHTML = `
        <label style="font-weight: 500; display: block; margin-bottom: 5px">📋 Vless ссылки:</label>
        <textarea readonly style="width: 100%; height: 80px; background: rgba(0,0,0,0.3); color: #4caf50; border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 10px; font-family: monospace; font-size: 0.8em; resize: vertical">${XrayModal._esc(text)}</textarea>
        <button class="btn btn-sm btn-success" style="margin-top: 8px" onclick="navigator.clipboard.writeText(this.previousElementSibling.value); window.adminUI?.toastManager?.success('Скопировано!')">📋 Копировать</button>`;
      body.appendChild(div);
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
    const name = await XrayModal.prompt("Имя клиента", "Введите имя");
    if (!name) return;
    const telegramId = await XrayModal.prompt("Telegram ID", "0 или ID пользователя", "0");
    if (telegramId === null) return;
    const days = await XrayModal.prompt("Дней подписки", "Количество дней", "30");
    if (!days) return;
    const toast = window.adminUI?.toastManager;
    try {
      await this.api("POST", "/clients", {
        name, telegram_id: parseInt(telegramId) || 0, subscription_days: parseInt(days) || 30
      });
      if (toast) toast.success(`Клиент ${name} добавлен`);
      await this.loadClients();
    } catch (err) {
      if (toast) toast.error(err.message);
    }
  },

  async adminRemoveClient() {
    if (!this.clients.length) { XrayModal.show("Удаление клиента", '<p class="text-muted">Нет клиентов</p>'); return; }
    const client = await XrayModal.clientPicker("Выберите клиента для удаления", this.clients);
    if (!client) return;
    if (!await XrayModal.confirm("Удалить клиента?", `${client.name || client.email} будет удалён навсегда.`)) return;
    const toast = window.adminUI?.toastManager;
    try {
      await this.api("DELETE", `/clients/${client.uuid}`);
      if (toast) toast.success(`Клиент ${client.name} удалён`);
      await this.loadClients();
    } catch (err) {
      if (toast) toast.error(err.message);
    }
  },

  async adminRenameClient() {
    if (!this.clients.length) { XrayModal.show("Переименование", '<p class="text-muted">Нет клиентов</p>'); return; }
    const client = await XrayModal.clientPicker("Выберите клиента для переименования", this.clients);
    if (!client) return;
    const newName = await XrayModal.prompt("Новое имя", "", client.name || "");
    if (!newName || newName === client.name) return;
    const toast = window.adminUI?.toastManager;
    try {
      await this.api("PUT", `/clients/${client.uuid}`, { name: newName });
      if (toast) toast.success("Переименован");
      await this.loadClients();
    } catch (err) {
      if (toast) toast.error(err.message);
    }
  },

  async adminExtendClient() {
    if (!this.clients.length) { XrayModal.show("Продление", '<p class="text-muted">Нет клиентов</p>'); return; }
    const client = await XrayModal.clientPicker("Выберите клиента для продления", this.clients);
    if (!client) return;
    const days = await XrayModal.prompt("Дней для продления", "Количество дней", "30");
    if (!days) return;
    const toast = window.adminUI?.toastManager;
    try {
      await this.api("POST", `/clients/${client.uuid}/extend`, { days: parseInt(days) });
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
          <span>${c.status === "blocked" ? "🚫" : "⚠️"} ${XrayModal._esc(c.name)} — ${c.status} (${c.warnings_count}/3)</span>
          ${c.status === "blocked" ? `<button class="btn btn-sm btn-success" onclick="xrayCard.clientAction('${c.uuid}','unblock')">Разблокировать</button>` : ""}
        </div>`).join(""));
    } catch (err) {
      if (toast) toast.error(err.message);
    }
  },

  async adminCheckSubscriptions() {
    this.adminResult('<p class="text-muted">⏳ Проверка подписок...</p>');
    try {
      const data = await this.api("POST", "/checkers/subscription-checker");
      this.adminResult(`<pre style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; max-height: 400px; overflow-y: auto; font-size: 0.85em; color: #a0a0a0; white-space: pre-wrap; word-break: break-all">${XrayModal._esc(data.output || "Нет вывода")}</pre>`);
    } catch (err) {
      this.adminResult(`<p class="text-muted">Ошибка: ${err.message}</p>`);
    }
  },

  async adminCheckTraffic() {
    this.adminResult('<p class="text-muted">⏳ Проверка трафика...</p>');
    try {
      const data = await this.api("POST", "/checkers/traffic-checker");
      this.adminResult(`<pre style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; max-height: 400px; overflow-y: auto; font-size: 0.85em; color: #a0a0a0; white-space: pre-wrap; word-break: break-all">${XrayModal._esc(data.output || "Нет вывода")}</pre>`);
    } catch (err) {
      this.adminResult(`<p class="text-muted">Ошибка: ${err.message}</p>`);
    }
  },

  async adminCheckDevices() {
    this.adminResult('<p class="text-muted">⏳ Проверка устройств...</p>');
    try {
      const data = await this.api("POST", "/checkers/device-monitor");
      this.adminResult(`<pre style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; max-height: 400px; overflow-y: auto; font-size: 0.85em; color: #a0a0a0; white-space: pre-wrap; word-break: break-all">${XrayModal._esc(data.output || "Нет вывода")}</pre>`);
    } catch (err) {
      this.adminResult(`<p class="text-muted">Ошибка: ${err.message}</p>`);
    }
  },

  async adminCheckTorrents() {
    this.adminResult('<p class="text-muted">⏳ Проверка торрентов...</p>');
    try {
      const data = await this.api("POST", "/checkers/torrent-detector");
      this.adminResult(`<pre style="background: rgba(0,0,0,0.3); padding: 12px; border-radius: 8px; max-height: 400px; overflow-y: auto; font-size: 0.85em; color: #a0a0a0; white-space: pre-wrap; word-break: break-all">${XrayModal._esc(data.output || "Нет вывода")}</pre>`);
    } catch (err) {
      this.adminResult(`<p class="text-muted">Ошибка: ${err.message}</p>`);
    }
  },

  async adminRequests() {
    const toast = window.adminUI?.toastManager;
    try {
      const data = await this.api("GET", "/extension-requests");
      const requests = data.requests || [];
      const pending = requests.filter(r => r.status === "pending");
      const approved = requests.filter(r => r.status === "approved");
      const denied = requests.filter(r => r.status === "denied");

      let html = `
        <div style="display: flex; gap: 12px; margin-bottom: 15px; flex-wrap: wrap">
          <span style="color: #ff9800; font-weight: 600">⏳ Ожидают: ${pending.length}</span>
          <span style="color: #4caf50">✅ Одобрено: ${approved.length}</span>
          <span style="color: #f44336">❌ Отклонено: ${denied.length}</span>
        </div>`;

      if (pending.length) {
        html += '<h3 style="font-size: 1em; margin-bottom: 10px; color: #ff9800">⏳ Ожидают обработки</h3>';
        html += pending.slice(0, 10).map(r => `
          <div style="padding: 10px; background: rgba(255,152,0,0.08); border: 1px solid rgba(255,152,0,0.2); border-radius: 8px; margin-bottom: 8px">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px">
              <div>
                <strong>${XrayModal._esc(r.client_name || "Unknown")}</strong>
                <span style="color: #888; font-size: 0.85em; margin-left: 8px">${r.requested_days || r.requested_months * 30} дн.</span>
              </div>
              <span style="color: #888; font-size: 0.8em">${new Date(r.created_at).toLocaleDateString("ru-RU")}</span>
            </div>
            <div style="display: flex; gap: 6px">
              <button class="btn btn-sm btn-success" onclick="xrayCard.approveRequest('${r.id}', '${XrayModal._esc(r.client_name)}')">✅ Одобрить</button>
              <button class="btn btn-sm btn-secondary" onclick="xrayCard.approveRequestCustom('${r.id}', '${XrayModal._esc(r.client_name)}')">📅 Свой срок</button>
              <button class="btn btn-sm btn-danger" onclick="xrayCard.denyRequest('${r.id}', '${XrayModal._esc(r.client_name)}')">❌ Отклонить</button>
            </div>
          </div>`).join("");
      } else {
        html += '<p class="text-muted" style="margin-bottom: 15px">Нет ожидающих запросов</p>';
      }

      if (approved.length) {
        html += '<h3 style="font-size: 1em; margin: 15px 0 10px; color: #4caf50">✅ Одобренные (последние 5)</h3>';
        html += approved.slice(0, 5).map(r => `
          <div style="padding: 8px 12px; background: rgba(76,175,80,0.06); border-radius: 6px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center">
            <span>${XrayModal._esc(r.client_name || "Unknown")} — ${r.approved_days || r.requested_days} дн.</span>
            <span style="color: #888; font-size: 0.8em">${new Date(r.processed_at).toLocaleDateString("ru-RU")}</span>
          </div>`).join("");
      }

      if (denied.length) {
        html += '<h3 style="font-size: 1em; margin: 15px 0 10px; color: #f44336">❌ Отклонённые (последние 5)</h3>';
        html += denied.slice(0, 5).map(r => `
          <div style="padding: 8px 12px; background: rgba(244,67,54,0.06); border-radius: 6px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center">
            <span>${XrayModal._esc(r.client_name || "Unknown")} — ${r.denial_reason || "Без причины"}</span>
            <span style="color: #888; font-size: 0.8em">${new Date(r.processed_at).toLocaleDateString("ru-RU")}</span>
          </div>`).join("");
      }

      this.adminResult(html);
    } catch (err) {
      if (toast) toast.error(err.message);
    }
  },

  async approveRequest(id, name) {
    if (!await XrayModal.confirm("Одобрить запрос?", `Запрос от ${name}`)) return;
    const toast = window.adminUI?.toastManager;
    try {
      await this.api("POST", `/extension-requests/${id}/approve`, { admin_telegram_id: 137981675 });
      if (toast) toast.success(`Запрос ${name} одобрен`);
      this.adminRequests();
    } catch (err) {
      if (toast) toast.error(err.message);
    }
  },

  async approveRequestCustom(id, name) {
    const days = await XrayModal.prompt("Сколько дней одобрить?", "Количество дней", "30");
    if (!days) return;
    const toast = window.adminUI?.toastManager;
    try {
      await this.api("POST", `/extension-requests/${id}/approve`, { admin_telegram_id: 137981675, approved_days: parseInt(days) });
      if (toast) toast.success(`Запрос ${name} одобрен (${days} дн.)`);
      this.adminRequests();
    } catch (err) {
      if (toast) toast.error(err.message);
    }
  },

  async denyRequest(id, name) {
    const reason = await XrayModal.prompt("Причина отклонения", "", "Отклонено администратором");
    if (reason === null) return;
    const toast = window.adminUI?.toastManager;
    try {
      await this.api("POST", `/extension-requests/${id}/deny`, { admin_telegram_id: 137981675, reason });
      if (toast) toast.success(`Запрос ${name} отклонён`);
      this.adminRequests();
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
          <span style="flex: 1">${XrayModal._esc(d)}</span>
          <button class="btn btn-sm btn-danger" onclick="warpCard.removeDomain('${XrayModal._esc(d)}')">❌</button>
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
    if (!await XrayModal.confirm("Удалить домен?", `${domain} будет удалён из WARP маршрутизации.`)) return;
    const toast = window.adminUI?.toastManager;
    try {
      await this.api("POST", "/warp-domains", { domain, action: "remove" });
      if (toast) toast.success(`Домен ${domain} удалён`);
      await this.loadDomains();
    } catch (err) {
      if (toast) toast.error(err.message);
    }
  },
};

// ==================== INIT ====================
const _origShowDashboard = UIController.prototype.showDashboard;
UIController.prototype.showDashboard = function() {
  _origShowDashboard.call(this);
  setTimeout(() => {
    xrayCard.init();
    warpCard.init();
  }, 500);
};
