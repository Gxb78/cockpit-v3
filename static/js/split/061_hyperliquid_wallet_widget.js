// ---------- Hyperliquid wallets dashboard widget ----------

(function () {
  var POLL_MS = 7000;
  var state = {
    initialized: false,
    loading: false,
    timer: null,
    wallets: [],
    rows: [],
    eventsByWallet: {},
    selectedWalletId: localStorage.getItem("hlWalletWidget:selectedId") || "",
    editingWalletId: "",
    lastError: "",
    liveError: "",
    lastUpdated: 0,
  };

  function $(id) { return document.getElementById(id); }

  function fmtUsd(value) {
    var n = Number(value);
    if (!Number.isFinite(n)) return "--";
    var sign = n > 0 ? "+" : "";
    return sign + "$" + Math.abs(n).toLocaleString("en-US", {
      minimumFractionDigits: Math.abs(n) >= 100 ? 0 : 2,
      maximumFractionDigits: Math.abs(n) >= 100 ? 0 : 2,
    });
  }

  function fmtNum(value, digits) {
    var n = Number(value);
    if (!Number.isFinite(n)) return "--";
    return n.toLocaleString("en-US", { maximumFractionDigits: digits == null ? 4 : digits });
  }

  function shortAddr(address) {
    address = String(address || "");
    if (address.length <= 12) return address;
    return address.slice(0, 6) + "..." + address.slice(-4);
  }

  function normalizeAddressInput(value) {
    var compact = String(value || "").replace(/[\s\u200B-\u200D\uFEFF]/g, "");
    var match = compact.match(/0[xX][a-fA-F0-9]{40}/);
    return match ? match[0].toLowerCase() : "";
  }

  function escape(v) {
    if (typeof escapeHtml === "function") return escapeHtml(v == null ? "" : String(v));
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (ch) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[ch];
    });
  }

  function setStatus(text, mode) {
    var el = $("hlWalletStatus");
    if (!el) return;
    el.textContent = text;
    el.dataset.mode = mode || "";
  }

  async function readJson(url, opts) {
    var res = await fetch(url, opts || {});
    var data = await res.json().catch(function () { return null; });
    if (!res.ok || !data) {
      var detail = data && data.detail ? " - " + data.detail : "";
      throw new Error(((data && (data.error || data.message)) || ("HTTP " + res.status)) + detail);
    }
    return data;
  }

  async function loadWallets(force) {
    if (state.loading) return;
    state.loading = true;
    setStatus("sync...", "loading");
    try {
      var suffix = force ? "?force=1" : "";
      var data = await readJson("/api/hyperliquid/wallets/state" + suffix);
      state.rows = Array.isArray(data.wallets) ? data.wallets : [];
      state.wallets = state.rows.map(function (r) { return r.wallet; }).filter(Boolean);
      ensureSelectedWallet();
      state.lastError = "";
      state.liveError = Array.isArray(data.errors) && data.errors.length ? data.errors.length + " wallet live state unavailable" : "";
      state.lastUpdated = Date.now();
      await loadEvents(force);
      render();
      setStatus((state.liveError ? "partial " : "live ") + new Date(state.lastUpdated).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }), state.liveError ? "loading" : "ok");
    } catch (e) {
      await loadWalletListFallback(e);
    } finally {
      state.loading = false;
    }
  }

  async function loadWalletListFallback(error) {
    try {
      var data = await readJson("/api/hyperliquid/wallets");
      var wallets = Array.isArray(data.wallets) ? data.wallets : [];
      state.rows = wallets.map(function (wallet) {
        return { wallet: wallet, state: null, positions: [], openOrders: [] };
      });
      state.wallets = wallets;
      ensureSelectedWallet();
      state.eventsByWallet = {};
      state.lastError = "";
      state.liveError = "Live state unavailable: " + ((error && error.message) || String(error || "unknown error"));
      state.lastUpdated = Date.now();
      render();
      setStatus("partial", "loading");
    } catch (fallbackError) {
      state.lastError = (fallbackError && fallbackError.message) || (error && error.message) || String(error || fallbackError);
      state.liveError = "";
      render();
      setStatus("error", "error");
    }
  }

  async function loadEvents(force) {
    var active = state.wallets.filter(function (w) { return w && w.is_active; }).slice(0, 24);
    var pairs = await Promise.all(active.map(function (wallet) {
      var url = "/api/hyperliquid/wallets/" + wallet.id + "/events?limit=8" + (force ? "&force=1" : "");
      return readJson(url).then(function (data) {
        return [wallet.id, Array.isArray(data.events) ? data.events : []];
      }).catch(function () { return [wallet.id, []]; });
    }));
    state.eventsByWallet = {};
    pairs.forEach(function (pair) { state.eventsByWallet[pair[0]] = pair[1]; });
  }

  async function addWallet(address, label) {
    await readJson("/api/hyperliquid/wallets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: address, label: label }),
    });
    await loadWallets(true);
  }

  async function updateWallet(id, address, label) {
    await readJson("/api/hyperliquid/wallets/" + id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: address, label: label }),
    });
    state.editingWalletId = "";
    await loadWallets(true);
  }

  async function deleteWallet(id) {
    await readJson("/api/hyperliquid/wallets/" + id, { method: "DELETE" });
    if (String(state.selectedWalletId) === String(id)) {
      state.selectedWalletId = "";
      localStorage.removeItem("hlWalletWidget:selectedId");
    }
    await loadWallets(true);
  }

  function ensureSelectedWallet() {
    var rows = state.rows || [];
    if (!rows.length) {
      state.selectedWalletId = "";
      localStorage.removeItem("hlWalletWidget:selectedId");
      return;
    }
    var found = rows.some(function (row) {
      return row.wallet && String(row.wallet.id) === String(state.selectedWalletId);
    });
    if (!found) {
      state.selectedWalletId = String(rows[0].wallet && rows[0].wallet.id || "");
      if (state.selectedWalletId) localStorage.setItem("hlWalletWidget:selectedId", state.selectedWalletId);
    }
  }

  function selectedRow() {
    ensureSelectedWallet();
    return (state.rows || []).find(function (row) {
      return row.wallet && String(row.wallet.id) === String(state.selectedWalletId);
    }) || null;
  }

  function positionHtml(pos) {
    var side = pos.side || "flat";
    var cls = side === "long" ? "is-long" : side === "short" ? "is-short" : "";
    var pnl = Number(pos.unrealizedPnl);
    var pnlCls = pnl > 0 ? "is-profit" : pnl < 0 ? "is-loss" : "";
    return '<div class="hl-position ' + cls + '">' +
      '<div class="hl-position-main">' +
        '<span class="hl-coin">' + escape(pos.coin || "--") + '</span>' +
        '<span class="hl-side">' + escape(side.toUpperCase()) + '</span>' +
        '<span class="hl-size">' + fmtNum(pos.absSize, 5) + '</span>' +
      '</div>' +
      '<div class="hl-position-meta">' +
        '<span>Entry ' + fmtNum(pos.entryPx, 2) + '</span>' +
        '<span>Value ' + fmtUsd(pos.positionValue) + '</span>' +
        '<span class="' + pnlCls + '">' + fmtUsd(pos.unrealizedPnl) + '</span>' +
      '</div>' +
    '</div>';
  }

  function orderHtml(order) {
    return '<div class="hl-order">' +
      '<span>' + escape(order.coin || "--") + '</span>' +
      '<span>' + escape((order.side || "").toUpperCase()) + '</span>' +
      '<span>' + fmtNum(order.size, 5) + " @ " + fmtNum(order.limitPx, 2) + '</span>' +
    '</div>';
  }

  function walletTabHtml(row) {
    var wallet = row.wallet || {};
    var positions = Array.isArray(row.positions) ? row.positions : [];
    var orders = Array.isArray(row.openOrders) ? row.openOrders : [];
    var label = wallet.label || shortAddr(wallet.address);
    var upnl = positions.reduce(function (sum, pos) {
      var n = Number(pos.unrealizedPnl);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);
    var pnlCls = upnl > 0 ? "is-profit" : upnl < 0 ? "is-loss" : "";
    var selected = String(wallet.id) === String(state.selectedWalletId);
    var editing = String(wallet.id) === String(state.editingWalletId);

    return '<div class="hl-wallet-tab-wrap ' + (selected ? "active" : "") + (editing ? " is-editing" : "") + '">' +
      '<button type="button" class="hl-wallet-tab" data-hl-select="' + wallet.id + '">' +
        '<strong>' + escape(label) + '</strong>' +
        '<span>' + positions.length + ' pos</span>' +
        '<em class="' + pnlCls + '">' + (positions.length ? fmtUsd(upnl) : "--") + '</em>' +
        (orders.length ? '<small>' + orders.length + ' orders</small>' : "") +
      '</button>' +
      '<button type="button" class="hl-wallet-edit-btn" data-hl-edit="' + wallet.id + '" title="Edit wallet">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>' +
      '</button>' +
    '</div>';
  }

  function renderWalletEditor() {
    if (!state.editingWalletId) return "";
    var row = (state.rows || []).find(function (r) {
      return r.wallet && String(r.wallet.id) === String(state.editingWalletId);
    });
    if (!row || !row.wallet) return "";
    var wallet = row.wallet;
    return '<form class="hl-wallet-edit-panel" id="hlWalletEditForm" data-wallet-id="' + wallet.id + '">' +
      '<input type="text" id="hlWalletEditLabel" value="' + escape(wallet.label || "") + '" placeholder="Label">' +
      '<input type="text" id="hlWalletEditAddress" value="' + escape(wallet.address || "") + '" spellcheck="false" placeholder="0x wallet address">' +
      '<button type="submit" class="btn-primary">Save</button>' +
      '<button type="button" class="hl-wallet-delete-action" data-hl-delete="' + wallet.id + '">Delete</button>' +
      '<button type="button" class="hl-wallet-cancel-action" data-hl-cancel-edit="1">Cancel</button>' +
    '</form>';
  }

  function renderWalletDetail() {
    var row = selectedRow();
    if (!row) return '<div class="hl-empty-panel">Select a wallet.</div>';
    var wallet = row.wallet || {};
    var positions = Array.isArray(row.positions) ? row.positions : [];
    var orders = Array.isArray(row.openOrders) ? row.openOrders : [];
    var label = wallet.label || shortAddr(wallet.address);
    var posHtml = positions.length
      ? positions.map(positionHtml).join("")
      : '<div class="hl-empty-line">No open position</div>';
    var orderBlock = orders.length
      ? '<div class="hl-orders"><h4>Open orders</h4>' + orders.map(orderHtml).join("") + '</div>'
      : "";

    return '<section class="hl-wallet-detail-card">' +
      '<div class="hl-wallet-detail-head">' +
        '<div class="hl-wallet-id">' +
          '<strong>' + escape(label) + '</strong>' +
          '<span>' + escape(wallet.address || "") + '</span>' +
        '</div>' +
        '<div class="hl-wallet-detail-actions">' +
          '<strong>' + positions.length + ' positions</strong>' +
          '<button type="button" class="hl-wallet-delete" data-hl-delete="' + wallet.id + '" title="Remove">&times;</button>' +
        '</div>' +
      '</div>' +
      '<div class="hl-positions">' + posHtml + '</div>' +
      orderBlock +
    '</section>';
  }

  function eventHtml(event, wallet) {
    var type = event.type || "event";
    var cls = type.indexOf("close") >= 0 || type.indexOf("partial") >= 0 ? "is-close" : type.indexOf("open") >= 0 ? "is-open" : "";
    var label = event.label || type;
    var who = wallet ? (wallet.label || shortAddr(wallet.address)) : "";
    return '<div class="hl-event ' + cls + '">' +
      '<div><strong>' + escape(event.coin || "--") + '</strong><span>' + escape(label.replace(/_/g, " ")) + '</span></div>' +
      '<div><span>' + escape(who) + '</span><span>' + fmtNum(event.size, 5) + (event.price ? " @ " + fmtNum(event.price, 2) : "") + '</span></div>' +
    '</div>';
  }

  function renderEvents() {
    var events = [];
    var byId = {};
    state.wallets.forEach(function (w) { byId[w.id] = w; });
    var ids = state.selectedWalletId ? [String(state.selectedWalletId)] : Object.keys(state.eventsByWallet);
    ids.forEach(function (id) {
      (state.eventsByWallet[id] || []).forEach(function (event) {
        events.push({ wallet: byId[id], event: event });
      });
    });
    events.sort(function (a, b) { return Number(b.event.time || 0) - Number(a.event.time || 0); });
    if (!events.length) return '<div class="hl-empty-panel">No recent wallet event.</div>';
    return events.slice(0, 10).map(function (x) { return eventHtml(x.event, x.wallet); }).join("");
  }

  function render() {
    var tabs = $("hlWalletTabs");
    var detail = $("hlWalletDetail");
    var events = $("hlWalletEvents");
    var countEl = $("hlWalletCount");
    var posCountEl = $("hlPositionCount");
    var upnlEl = $("hlWalletUpnl");
    if (!tabs || !detail || !events) return;

    var rows = state.rows || [];
    var allPositions = [];
    rows.forEach(function (r) { allPositions = allPositions.concat(Array.isArray(r.positions) ? r.positions : []); });
    var upnl = allPositions.reduce(function (sum, pos) {
      var n = Number(pos.unrealizedPnl);
      return sum + (Number.isFinite(n) ? n : 0);
    }, 0);

    if (countEl) countEl.textContent = String(rows.length);
    if (posCountEl) posCountEl.textContent = String(allPositions.length);
    if (upnlEl) {
      upnlEl.textContent = allPositions.length ? fmtUsd(upnl) : "--";
      upnlEl.className = upnl > 0 ? "is-profit" : upnl < 0 ? "is-loss" : "";
    }

    if (state.lastError) {
      tabs.innerHTML = '<div class="hl-empty-panel is-error">' + escape(state.lastError) + '</div>';
      detail.innerHTML = "";
      events.innerHTML = "";
      return;
    }

    var liveBanner = state.liveError ? '<div class="hl-empty-panel is-warning">' + escape(state.liveError) + '</div>' : "";
    var editorSlot = $("hlWalletEditorSlot");
    tabs.innerHTML = liveBanner + (rows.length ? rows.map(walletTabHtml).join("") : '<div class="hl-empty-panel">Add a wallet to start tracking positions.</div>');
    if (editorSlot) editorSlot.innerHTML = rows.length ? renderWalletEditor() : "";
    detail.innerHTML = rows.length ? renderWalletDetail() : "";
    events.innerHTML = renderEvents();
  }

  function bind() {
    var form = $("hlWalletForm");
    var refresh = $("hlWalletRefreshBtn");
    var tabs = $("hlWalletTabs");
    var editorSlot = $("hlWalletEditorSlot");
    var detail = $("hlWalletDetail");
    if (form && !form._hlBound) {
      form._hlBound = true;
      form.addEventListener("submit", async function (e) {
        e.preventDefault();
        var address = $("hlWalletAddressInput");
        var label = $("hlWalletLabelInput");
        var normalized = normalizeAddressInput(address && address.value);
        if (!address || !normalized) {
          state.lastError = "Adresse Hyperliquid invalide";
          state.liveError = "";
          render();
          setStatus("error", "error");
          return;
        }
        try {
          await addWallet(normalized, label ? label.value.trim() : "");
          address.value = "";
          if (label) label.value = "";
        } catch (err) {
          state.lastError = err.message || String(err);
          state.liveError = "";
          render();
          setStatus("error", "error");
        }
      });
    }
    if (refresh && !refresh._hlBound) {
      refresh._hlBound = true;
      refresh.addEventListener("click", function () { loadWallets(true); });
    }
    if (tabs && !tabs._hlBound) {
      tabs._hlBound = true;
      tabs.addEventListener("click", function (e) {
        var edit = e.target.closest("[data-hl-edit]");
        if (edit) {
          e.preventDefault();
          state.editingWalletId = String(edit.getAttribute("data-hl-edit") || "");
          state.selectedWalletId = state.editingWalletId;
          if (state.selectedWalletId) localStorage.setItem("hlWalletWidget:selectedId", state.selectedWalletId);
          render();
          return;
        }
        var select = e.target.closest("[data-hl-select]");
        if (!select) return;
        e.preventDefault();
        state.selectedWalletId = String(select.getAttribute("data-hl-select") || "");
        if (state.selectedWalletId) localStorage.setItem("hlWalletWidget:selectedId", state.selectedWalletId);
        render();
      });
    }
    if (editorSlot && !editorSlot._hlBound) {
      editorSlot._hlBound = true;
      editorSlot.addEventListener("click", function (e) {
        var cancel = e.target.closest("[data-hl-cancel-edit]");
        if (!cancel) return;
        e.preventDefault();
        state.editingWalletId = "";
        render();
      });
      editorSlot.addEventListener("submit", async function (e) {
        var editForm = e.target.closest("#hlWalletEditForm");
        if (!editForm) return;
        e.preventDefault();
        var address = $("hlWalletEditAddress");
        var label = $("hlWalletEditLabel");
        var normalized = normalizeAddressInput(address && address.value);
        if (!normalized) {
          state.lastError = "Adresse Hyperliquid invalide";
          render();
          setStatus("error", "error");
          return;
        }
        try {
          await updateWallet(editForm.getAttribute("data-wallet-id"), normalized, label ? label.value.trim() : "");
        } catch (err) {
          state.lastError = err.message || String(err);
          render();
          setStatus("error", "error");
        }
      });
      editorSlot.addEventListener("click", async function (e) {
        var btn = e.target.closest(".hl-wallet-delete-action[data-hl-delete]");
        if (!btn) return;
        e.preventDefault();
        if (!confirm("Supprimer ce wallet Hyperliquid ?")) return;
        await deleteWallet(btn.getAttribute("data-hl-delete"));
      });
    }
    if (detail && !detail._hlBound) {
      detail._hlBound = true;
      detail.addEventListener("click", async function (e) {
        var btn = e.target.closest("[data-hl-delete]");
        if (!btn) return;
        e.preventDefault();
        await deleteWallet(btn.getAttribute("data-hl-delete"));
      });
    }
  }

  function init() {
    var root = document.querySelector(".hl-wallet-widget");
    if (!root) return;
    bind();
    if (!state.initialized) {
      state.initialized = true;
      loadWallets(false);
      state.timer = setInterval(function () {
        if (document.body.getAttribute("data-current-page") === "today") loadWallets(false);
      }, POLL_MS);
    } else {
      render();
    }
  }

  window.initHyperliquidWalletWidget = init;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    setTimeout(init, 0);
  }
})();
