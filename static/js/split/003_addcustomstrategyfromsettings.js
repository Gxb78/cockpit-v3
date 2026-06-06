function addCustomTagFromSettings() {
  const input = $("#settingsTagInput");
  if (!input || !state.settings) return;
  const label = input.value.trim();
  if (!label) return;
  const exists = (state.settings.custom_tags || []).some(function(t) {
    return t.toLowerCase() === label.toLowerCase();
  });
  if (exists) {
    toast("Ce tag existe déjà", "error");
    return;
  }
  state.settings.custom_tags.push(label);
  input.value = "";
  saveSettingsState();
  renderSettingsTags();
  toast("Tag custom ajouté ✓", "success");
}

function removeCustomTag(value) {
  if (!value || !state.settings) return;
  state.settings.custom_tags = (state.settings.custom_tags || []).filter(function(t) {
    return t !== value;
  });
  saveSettingsState();
  renderSettingsTags();
  toast("Tag supprimé", "success");
}

function addCustomStrategyFromSettings() {
  const input = $("#settingsStrategyInput");
  if (!input || !state.settings) return;
  const label = input.value.trim();
  if (!label) return;
  const existsLabel = (state.settings.custom_strategies || [])
    .some(s => s.label.toLowerCase() === label.toLowerCase());
  if (existsLabel) {
    toast("Cette stratégie existe déjà", "error");
    return;
  }
  const taken = new Set([
    ...DEFAULT_STRATEGY_VALUES,
    ...(state.settings.custom_strategies || []).map(s => s.value),
  ]);
  const value = uniqueStrategyValue(label, taken);
  state.settings.custom_strategies.push({ value, label });
  input.value = "";
  saveSettingsState();
  applySettingsState();
  renderSettingsPage();
  if (state.currentPage === "insights") renderPerformance();
  toast("Stratégie custom ajoutée ✓", "success");
}

function removeCustomStrategy(value) {
  if (!value || !state.settings) return;
  const current = getPill("strategy");
  state.settings.custom_strategies = (state.settings.custom_strategies || [])
    .filter(s => s.value !== value);
  saveSettingsState();
  applySettingsState();
  renderSettingsPage();
  if (current === value) setPill("strategy", null);
  if (state.currentPage === "insights") renderPerformance();
  toast("Stratégie supprimée", "success");
}

function savePreferenceSettings() {
  if (!state.settings) return;
  var btn = $("#settingsSavePrefsBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Application..."; }
  state.settings.preferences.animations = !!$("#prefAnimations")?.checked;
  state.settings.preferences.dark_mode = !!$("#prefDarkMode")?.checked;
  var themeVal = $("#prefTheme")?.value || "default";
  if (["default", "claude"].includes(themeVal)) state.settings.preferences.theme = themeVal;
  saveSettingsState();
  applySettingsState();
  if (state.currentPage === "insights") renderPerformance();
  toast("Préférences appliquées ✓", "success");
  if (btn) { setTimeout(function () { btn.disabled = false; btn.textContent = "Appliquer"; }, 1500); }
}

async function refreshApiKeyStatus() {
  const status = $("#settingsApiStatus");
  const masked = $("#settingsApiKeyMasked");
  const env = $("#settingsApiEnv");
  const hint = $("#settingsApiResult");
  if (!status || !masked || !env) return;
  status.textContent = "Chargement...";
  status.className = "settings-badge";
  masked.value = "";
  if (hint) hint.style.display = "none";
  try {
    const s = await api("/api/settings");
    const isSet = !!s.deepseek?.key_present;
    status.textContent = isSet ? "Configurée" : "Non configurée";
    status.className = `settings-badge ${isSet ? "ok" : "warn"}`;
    masked.value = s.deepseek?.key_masked || "";
    env.textContent = s.deepseek?.env_var || "DEEPSEEK_API_KEY";
    if (!isSet && hint && s.deepseek?.hint) {
      hint.textContent = s.deepseek.hint;
      hint.style.display = "block";
    }
  } catch {
    status.textContent = "Indisponible";
    status.className = "settings-badge error";
    masked.value = "";
  }
}

function openSettingsPage() {
  renderSettingsPage();
  refreshApiKeyStatus();
}

function bindSettings() {
  $("#settingsSaveProfileBtn")?.addEventListener("click", saveProfileSettings);
  $("#settingsPseudo")?.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); saveProfileSettings(); }
  });

  // Bouton "Ouvrir dans le navigateur"
  var browserBtn = $("#settingsOpenBrowserBtn");
  if (browserBtn) {
    browserBtn.addEventListener("click", function () {
      var url = window.location.protocol + "//" + window.location.host + "/";
      window.open(url, "_blank");
    });
  }

  // Bouton "Rebuild + Redemarrer" (dans Settings > App)
  var restartBtn = $("#settingsRestartBtn");
  if (restartBtn) {
    restartBtn.addEventListener("click", async function () {
      var btn = this;
      btn.disabled = true;
      btn.textContent = "Rebuild...";
      // 1. Envoyer la demande de redémarrage
      try { await api("/api/dev/restart", { method: "POST" }); } catch (_) {}
      // 2. Polling : attendre que le serveur MEURE, puis qu'il REVIENNE
      var url = window.location.href;
      var base = url.split("?")[0].replace(/\/$/, "");
      var retries = 0;
      var maxRetries = 30;
      var wasDown = false;
      function poll() {
        retries++;
        fetch(base, { method: "HEAD", cache: "no-store" })
          .then(function (r) {
            if (wasDown) { window.location.reload(); return; }
            if (retries < maxRetries) setTimeout(poll, 1000);
            else { btn.textContent = "Rebuild + Redemarrer"; btn.disabled = false; }
          })
          .catch(function () {
            if (!wasDown) wasDown = true;
            if (retries < maxRetries) setTimeout(poll, 1000);
            else { btn.textContent = "Rebuild + Redemarrer"; btn.disabled = false; }
          });
      }
      setTimeout(poll, 500);
    });
  }

  // Afficher l'URL du serveur
  var serverDisplay = $("#appServerDisplay");
  if (serverDisplay) {
    serverDisplay.textContent = window.location.host || "—";
  }

  // Quick theme toggle in rail
  $("#themeToggle")?.addEventListener("click", function () {
    if (!state.settings) return;
    state.settings.preferences.dark_mode = !state.settings.preferences.dark_mode;
    saveSettingsState();
    applySettingsState();
  });

  // Dev restart (rail) — rebuild + polling: attendre la mort puis le retour du serveur
  $("#devRestart")?.addEventListener("click", async function () {
    const btn = this;
    btn.classList.add("restarting");
    btn.querySelector("span").textContent = "Rebuild + redémarrage...";
    // 1. Envoyer la demande de redémarrage
    try { await api("/api/dev/restart", { method: "POST" }); } catch (_) {}
    // 2. Polling : attendre que le serveur MEURE, puis qu'il REVIENNE
    var url = window.location.href;
    var base = url.split("?")[0].replace(/\/$/, "");
    var retries = 0;
    var maxRetries = 45;
    var wasDown = false;
    function poll() {
      retries++;
      fetch(base, { method: "HEAD", cache: "no-store" })
        .then(function (r) {
          if (wasDown) {
            // Server was down, now back up → on reload
            window.location.reload();
            return;
          }
          // Old server still alive → keep waiting
          if (retries < maxRetries) setTimeout(poll, 1000);
          else btn.querySelector("span").textContent = "Redémarrage: timeout";
        })
        .catch(function () {
          if (!wasDown) {
            wasDown = true; // First time server goes down
            btn.querySelector("span").textContent = "Redémarrage... attente serveur";
          }
          if (retries < maxRetries) setTimeout(poll, 1000);
          else btn.querySelector("span").textContent = "Redémarrage: timeout";
        });
    }
    setTimeout(poll, 1000);
  });

  $("#settingsAddStrategyBtn")?.addEventListener("click", addCustomStrategyFromSettings);
  $("#settingsStrategyInput")?.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); addCustomStrategyFromSettings(); }
  });
  $("#settingsStrategiesList")?.addEventListener("click", e => {
    const btn = e.target.closest("[data-remove-strategy]");
    if (!btn) return;
    removeCustomStrategy(btn.dataset.removeStrategy);
  });

  // Custom tags
  $("#settingsAddTagBtn")?.addEventListener("click", addCustomTagFromSettings);
  $("#settingsTagInput")?.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); addCustomTagFromSettings(); }
  });
  $("#settingsTagsList")?.addEventListener("click", e => {
    const btn = e.target.closest("[data-remove-tag]");
    if (!btn) return;
    removeCustomTag(btn.dataset.removeTag);
  });

  $("#settingsSavePrefsBtn")?.addEventListener("click", savePreferenceSettings);
  $("#settingsRefreshApiBtn")?.addEventListener("click", refreshApiKeyStatus);

  // Test API key
  var testBtn = document.getElementById("settingsTestApiBtn");
  var resultEl = document.getElementById("settingsApiResult");
  if (testBtn && resultEl) {
    testBtn.addEventListener("click", async function () {
      testBtn.disabled = true;
      testBtn.textContent = "Test en cours...";
      resultEl.style.display = "none";
      try {
        var r = await api("/api/ai/ping", { method: "POST" });
        resultEl.style.display = "block";
        if (r.ok) {
          resultEl.style.color = "var(--green, #34d399)";
          resultEl.textContent = r.message || "Cle valide.";
        } else {
          resultEl.style.color = "var(--red, #f87171)";
          resultEl.textContent = r.message || "Cle invalide.";
          if (r.detail) resultEl.textContent += " (" + r.detail + ")";
        }
      } catch (err) {
        resultEl.style.display = "block";
        resultEl.style.color = "var(--red, #f87171)";
        resultEl.textContent = "Erreur de connexion au serveur.";
      } finally {
        testBtn.disabled = false;
        testBtn.textContent = "Tester";
      }
    });
  }

  // API key toggle visibility (password ↔ text)
  var toggleBtn = document.getElementById("settingsApiToggle");
  var apiInput = document.getElementById("settingsApiKeyMasked");
  if (toggleBtn && apiInput) {
    toggleBtn.addEventListener("click", function () {
      var isPassword = apiInput.type === "password";
      apiInput.type = isPassword ? "text" : "password";
      toggleBtn.classList.toggle("is-visible", isPassword);
    });
  }

  // API key edit/save
  var editBtn = document.getElementById("settingsEditApiBtn");
  var saveBtn = document.getElementById("settingsSaveApiBtn");
  if (editBtn && saveBtn && apiInput) {
    editBtn.addEventListener("click", function () {
      apiInput.readOnly = false;
      apiInput.value = "";
      apiInput.focus();
      editBtn.style.display = "none";
      saveBtn.style.display = "";
      saveBtn.classList.remove("hidden");
    });
    saveBtn.addEventListener("click", async function () {
      var key = apiInput.value.trim();
      if (!key) { toast("Entrez une cle valide", "error"); return; }
      saveBtn.disabled = true; saveBtn.textContent = "Enregistrement...";
      try {
        var r = await fetch("/api/settings/key", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: key, provider: "deepseek" }),
        });
        var data = await r.json();
        if (data.error) { toast(data.error, "error"); return; }
        toast(data.message || "Cle enregistree", "success");
        apiInput.readOnly = true;
        editBtn.style.display = "";
        saveBtn.style.display = "none";
        saveBtn.classList.add("hidden");
        refreshApiKeyStatus();
      } catch (e) { toast("Erreur: " + e.message, "error"); }
      finally { saveBtn.disabled = false; saveBtn.textContent = "Enregistrer"; }
    });
  }

  // Data card: load DB info
  loadDbInfo();

  // Danger zone: reset all data
  var resetBtn = document.getElementById("settingsResetDataBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", async function () {
      if (!confirm("ES-TU SUR DE VOULOIR SUPPRIMER TOUTES LES DONNEES ?\n\nCette action est irreversible. Un backup automatique sera cree avant la suppression.")) return;
      if (!confirm("CONFIRMATION FINALE :\n\nTape OK pour confirmer la suppression definitive de tous tes jours, trades et screenshots.")) return;
      resetBtn.disabled = true;
      resetBtn.textContent = "Suppression...";
      try {
        var r = await fetch("/api/data/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: "RESET ALL DATA" }),
        });
        var data = await r.json();
        if (data.error) { toast(data.error, "error"); return; }
        toast(data.message, "success");
        var resultEl = document.getElementById("settingsResetResult");
        if (resultEl) {
          resultEl.textContent = "Supprime: " + data.deleted.days + " jours, " + data.deleted.trades + " trades, " + data.deleted.screenshots + " screenshots. Backup: " + data.backup;
          resultEl.style.display = "block";
        }
        // Reload state
        if (typeof loadAll === "function") loadAll();
      } catch (e) { toast("Erreur: " + e.message, "error"); }
      finally { resetBtn.disabled = false; resetBtn.textContent = "Tout reset"; }
    });
  }
}

function loadDbInfo() {
  fetch("/api/db/info").then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }).then(function (d) {
    var pathEl = document.getElementById("dbPathDisplay");
    if (pathEl) pathEl.textContent = d.db_path || "—";
    var sizeEl = document.getElementById("dbSizeDisplay");
    if (sizeEl) sizeEl.textContent = d.size_str || "—";
    var daysEl = document.getElementById("dbDaysCount");
    if (daysEl) daysEl.textContent = d.num_days != null ? d.num_days : "—";
    var tradesEl = document.getElementById("dbTradesCount");
    if (tradesEl) tradesEl.textContent = d.num_trades != null ? d.num_trades : "—";
  }).catch(function () {});
  // Export button
  var exportBtn = document.getElementById("settingsExportBtn");
  if (exportBtn) {
    exportBtn.addEventListener("click", function () {
      window.open("/api/export?format=json", "_blank");
    });
  }
}

function loadCalendarMetricMode() {
  try {
    const raw = localStorage.getItem(CALENDAR_METRIC_MODE_KEY);
    return CALENDAR_METRIC_MODES.has(raw) ? raw : _state.calendarMetricMode;
  } catch {
    return _state.calendarMetricMode;
  }
}

function updateCalendarMetricToggleUI() {
  $$("#calendarMetricToggle .calendar-metric-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === state.calendarMetricMode);
  });
}

function setCalendarMetricMode(mode, opts = {}) {
  const { persist = true, rerender = true } = opts;
  if (!CALENDAR_METRIC_MODES.has(mode)) return;
  state.calendarMetricMode = mode;
  updateCalendarMetricToggleUI();
  if (persist) { localStorage.setItem(CALENDAR_METRIC_MODE_KEY, mode); saveUiState(); }
  if (rerender && state.currentPage === "journal") {
    if (typeof closeJournalDayTrades === "function") closeJournalDayTrades();
    renderCalendar();
  }
}

function bindCalendarMetricToggle() {
  const wrap = $("#calendarMetricToggle");
  if (!wrap) return;
  wrap.addEventListener("click", e => {
    const btn = e.target.closest(".calendar-metric-btn");
    if (!btn) return;
    setCalendarMetricMode(btn.dataset.mode, { persist: true, rerender: true });
  });
}

function loadJournalViewMode() {
  try {
    const raw = localStorage.getItem(JOURNAL_VIEW_MODE_KEY);
    return JOURNAL_VIEW_MODES.has(raw) ? raw : _state.journalViewMode;
  } catch {
    return _state.journalViewMode;
  }
}

function loadJournalLayoutMode() {
  try {
    const raw = localStorage.getItem(JOURNAL_LAYOUT_MODE_KEY);
    return JOURNAL_LAYOUT_MODES.has(raw) ? raw : _state.journalLayoutMode;
  } catch {
    return _state.journalLayoutMode;
  }
}

function defaultJournalTradeFilters() {
  var d = _state.journalTradeFilters;
  return {
    strategy: d.strategy,
    result: d.result,
    tag: d.tag.slice(),
    pnlMin: d.pnlMin,
    pnlMax: d.pnlMax,
    search: d.search || "",
  };
}

function sanitizeJournalTradeFilters(raw) {
  const d = defaultJournalTradeFilters();
  const out = { ...d };
  if (typeof raw?.strategy === "string" && raw.strategy) out.strategy = raw.strategy;
  if (typeof raw?.result === "string" && ["ALL", "WIN", "LOSS", "OPEN"].includes(raw.result)) out.result = raw.result;
  if (raw?.tag != null) {
    if (Array.isArray(raw.tag)) {
      out.tag = raw.tag.filter(function (t) { return typeof t === "string" && t.trim(); });
      if (!out.tag.length) out.tag = ["ALL"];
    } else if (typeof raw.tag === "string" && raw.tag) {
      // Retrocompat: ancien format string unique
      out.tag = [raw.tag];
    }
  }
  if (typeof raw?.pnlMin != null && raw.pnlMin !== "") out.pnlMin = String(raw.pnlMin);
  if (typeof raw?.pnlMax != null && raw.pnlMax !== "") out.pnlMax = String(raw.pnlMax);
  if (typeof raw?.search === "string") out.search = raw.search;
  return out;
}

function loadJournalTradeFilters() {
  try {
    const raw = JSON.parse(localStorage.getItem(JOURNAL_TRADE_FILTERS_KEY) || "{}");
    // Ne pas restaurer la recherche au refresh (transient)
    delete raw.search;
    return sanitizeJournalTradeFilters(raw);
  } catch {
    return defaultJournalTradeFilters();
  }
}

