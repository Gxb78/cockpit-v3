function prettify(s) {
  return STRATEGY_LABELS[s] || String(s).replace(/_/g," ").replace(/\b\w/g, c => c.toUpperCase());
}

function defaultSettingsState() {
  return {
    profile: { pseudo: "trader" },
    custom_strategies: [],
    custom_tags: [],
    preferences: { animations: true, dark_mode: false, theme: 'default' },
  };
}

function normalizeStrategyValue(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function uniqueStrategyValue(label, takenValues) {
  const base = normalizeStrategyValue(label) || "custom_strategy";
  if (!takenValues.has(base)) return base;
  let i = 2;
  while (takenValues.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

function normalizeCustomStrategies(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  const taken = new Set(DEFAULT_STRATEGY_VALUES);
  const takenLabels = new Set();
  rawList.forEach(item => {
    const label = (typeof item === "string" ? item : item?.label || "").trim();
    if (!label) return;
    // Deduplicate labels (deux strategies ne peuvent pas avoir le meme nom)
    var finalLabel = label;
    var li = 2;
    while (takenLabels.has(finalLabel)) {
      finalLabel = label + " " + li;
      li += 1;
    }
    takenLabels.add(finalLabel);
    const preferred = normalizeStrategyValue(typeof item === "object" ? item?.value : "");
    const value = preferred && !taken.has(preferred) ? preferred : uniqueStrategyValue(label, taken);
    taken.add(value);
    out.push({ value, label: finalLabel });
  });
  return out;
}

function collectUiState() {
  return {
    calendarMetricMode: state.calendarMetricMode,
    journalViewMode:    state.journalViewMode,
    journalLayoutMode:  state.journalLayoutMode,
    journalRangeMode:   state.journalRangeMode,
    journalTableSortKey: state.journalTableSortKey,
    journalTableSortDir: state.journalTableSortDir,
    breakdownSortMode:  state.breakdownSortMode,
  };
}

function applyServerUiState(obj) {
  if (!obj || typeof obj !== "object") return;
  // Map: state key → { lsKey, validSet }
  var mapping = [
    { stateKey: "calendarMetricMode",  lsKey: CALENDAR_METRIC_MODE_KEY,  valid: CALENDAR_METRIC_MODES },
    { stateKey: "journalViewMode",     lsKey: JOURNAL_VIEW_MODE_KEY,     valid: JOURNAL_VIEW_MODES },
    { stateKey: "journalLayoutMode",   lsKey: JOURNAL_LAYOUT_MODE_KEY,   valid: JOURNAL_LAYOUT_MODES },
    { stateKey: "journalRangeMode",    lsKey: JOURNAL_RANGE_MODE_KEY,    valid: JOURNAL_RANGE_MODES },
    { stateKey: "breakdownSortMode",   lsKey: BREAKDOWN_SORT_KEY,        valid: BREAKDOWN_SORT_MODES },
  ];
  var changed = false;
  mapping.forEach(function(m) {
    // N'appliquer que si localStorage est vide (nouvelle machine)
    if (localStorage.getItem(m.lsKey) != null) return;
    var val = obj[m.stateKey];
    if (!val || !m.valid.has(val)) return;
    state[m.stateKey] = val;
    localStorage.setItem(m.lsKey, val);
    changed = true;
  });
  // Table sort (JSON compound key)
  if (localStorage.getItem(JOURNAL_TABLE_SORT_KEY) == null) {
    var sk = obj.journalTableSortKey, sd = obj.journalTableSortDir;
    if (sk && JOURNAL_TABLE_SORT_KEYS.has(sk)) { state.journalTableSortKey = sk; changed = true; }
    if (sd === "asc" || sd === "desc")          { state.journalTableSortDir = sd; changed = true; }
    if (changed) localStorage.setItem(JOURNAL_TABLE_SORT_KEY, JSON.stringify({
      key: state.journalTableSortKey, dir: state.journalTableSortDir
    }));
  }
  if (changed) {
    // Refresh les UIs qui dependent de ces modes
    if (typeof updateCalendarMetricToggleUI === "function") updateCalendarMetricToggleUI();
    if (typeof updateJournalViewToggleUI === "function") updateJournalViewToggleUI();
    if (typeof updateJournalLayoutToggleUI === "function") updateJournalLayoutToggleUI();
    if (typeof updateJournalRangeToggleUI === "function") updateJournalRangeToggleUI();
    if (typeof updateJournalTableSortUI === "function") updateJournalTableSortUI();
    if (typeof updateBreakdownSortUI === "function") updateBreakdownSortUI();
    if (typeof updateJournalControlsVisibility === "function") updateJournalControlsVisibility();
    if (state.currentPage === "journal" && typeof renderCalendar === "function") renderCalendar();
  }
}

function sanitizeSettings(raw) {
  const defaults = defaultSettingsState();
  const pseudo = String(raw?.profile?.pseudo || "").trim();
  return {
    profile: {
      pseudo: pseudo || defaults.profile.pseudo,
    },
    custom_strategies: normalizeCustomStrategies(raw?.custom_strategies),
    custom_tags: raw?.custom_tags || [],
    preferences: {
      animations: typeof raw?.preferences?.animations === "boolean"
        ? raw.preferences.animations
        : defaults.preferences.animations,
      dark_mode: typeof raw?.preferences?.dark_mode === "boolean"
        ? raw.preferences.dark_mode
        : defaults.preferences.dark_mode,
      theme: (["default", "claude"].includes(raw?.preferences?.theme) ? raw.preferences.theme : "default"),
    },
  };
}

function loadSettingsState() {
  var defaults = defaultSettingsState();
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
    if (raw.preferences?.dark_mode === undefined) {
      try {
        const legacyTheme = localStorage.getItem("theme");
        if (legacyTheme === "light") raw.preferences = raw.preferences || {};
        if (legacyTheme === "light") raw.preferences.dark_mode = false;
      } catch (_) {}
    }
    state.settings = sanitizeSettings(raw);
  } catch {
    state.settings = defaults;
  }
  // Snapshot pour detecter les modifications utilisateur pendant le fetch
  var localSnapshot = JSON.stringify(state.settings);
  fetch("/api/user/profile", { credentials: "same-origin" })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (!data || !data.profile) return;
      // Ne pas ecraser si l'utilisateur a modifie entre temps
      if (JSON.stringify(state.settings) !== localSnapshot) return;
      // Ne pas ecraser avec des donnees vides si on a des donnees locales
      var apiKeys = Object.keys(data.profile);
      if (apiKeys.length === 0) return;
      var merged = Object.assign({}, defaultSettingsState(), data.profile);
      merged.custom_strategies = normalizeCustomStrategies(merged.custom_strategies || []);
      state.settings = sanitizeSettings(merged);
      applySettingsState();
      renderSettingsPage();
      applyServerUiState(merged.ui_state);
      try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state.settings)); } catch(_) {}
    })
    .catch(function() {});
  return state.settings;
}

function saveSettingsState() {
  if (!state.settings) return;
  try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state.settings)); } catch(_) {}
  fetch("/api/user/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(state.settings),
  }).catch(function() {
    toast("Erreur lors de la sauvegarde des réglages", "error");
  });
}

var _uiStateSaveTimer = null;
function saveUiState() {
  clearTimeout(_uiStateSaveTimer);
  _uiStateSaveTimer = setTimeout(function() {
    if (!state.settings) return;
    state.settings.ui_state = collectUiState();
    saveSettingsState();
  }, 2000);
}

function applyProfileSetting() {
  const pseudo = state.settings?.profile?.pseudo || "trader";
  const h = new Date().getHours();
  const salutation = h < 6 ? "Bonne nuit" : h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : h < 22 ? "Bonsoir" : "Bonne nuit";
  const greeting = $("#todayGreeting");
  if (greeting) greeting.textContent = pseudo;
  const sal = $("#todaySalutation");
  if (sal) sal.textContent = salutation;
}

function applyVisualSettings() {
  const prefersDark = state.settings?.preferences?.dark_mode !== false;
  const prefersAnimations = state.settings?.preferences?.animations !== false;
  const theme = state.settings?.preferences?.theme || 'default';
  document.body.classList.toggle("light-mode", !prefersDark);
  document.body.classList.toggle("reduce-motion", !prefersAnimations);
  // Appliquer le theme (default, claude, etc.)
  document.body.classList.remove("theme-default", "theme-claude");
  document.body.classList.add("theme-" + theme);
  // Sync checkbox Settings si visible
  var cb = document.getElementById("prefDarkMode");
  if (cb) cb.checked = prefersDark;
  var themeSel = document.getElementById("prefTheme");
  if (themeSel) themeSel.value = theme;
}

function syncStrategyLabels() {
  Object.keys(STRATEGY_LABELS).forEach(key => {
    if (!DEFAULT_STRATEGY_VALUES.includes(key)) delete STRATEGY_LABELS[key];
  });
  (state.settings?.custom_strategies || []).forEach(s => {
    STRATEGY_LABELS[s.value] = s.label;
  });
}

function findPillByValue(container, value) {
  return [...container.querySelectorAll(".pill-choice")].find(btn => btn.dataset.value === value);
}

function appendStrategyPill(container, strategy, opts = {}) {
  if (!container || !strategy?.value) return null;
  if (findPillByValue(container, strategy.value)) return null;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pill-choice custom-strategy-pill";
  btn.dataset.value = strategy.value;
  if (opts.custom) btn.dataset.customStrategy = "1";
  if (opts.dynamic) btn.dataset.dynamicStrategy = "1";
  btn.textContent = strategy.label || prettify(strategy.value);
  container.appendChild(btn);
  return btn;
}

function syncStrategyPillsFromSettings() {
  const container = document.querySelector(`.pills[data-pills="strategy"]`);
  if (!container) return;
  const currentValue = getPill("strategy");
  container.querySelectorAll(".pill-choice[data-custom-strategy='1']").forEach(btn => btn.remove());
  container.querySelectorAll(".pill-choice[data-dynamic-strategy='1']").forEach(btn => btn.remove());
  (state.settings?.custom_strategies || []).forEach(s => {
    appendStrategyPill(container, s, { custom: true });
  });
  if (currentValue) setPill("strategy", currentValue);
}

function applySettingsState() {
  if (!state.settings) return;
  applyProfileSetting();
  applyVisualSettings();
  syncStrategyLabels();
  syncStrategyPillsFromSettings();
}

function renderSettingsStrategies() {
  const list = $("#settingsStrategiesList");
  if (!list) return;
  const strategies = state.settings?.custom_strategies || [];
  if (!strategies.length) {
    list.innerHTML = `<div class="settings-empty">Aucune stratégie custom pour l'instant.</div>`;
    return;
  }
  list.innerHTML = strategies.map(s => `
    <span class="settings-chip" draggable="true" data-reorder-value="${escapeHtml(s.value)}">
      <span class="settings-chip-drag">${escapeHtml(s.label)}</span>
      <button type="button" class="settings-chip-remove" data-remove-strategy="${escapeHtml(s.value)}" title="Supprimer">x</button>
    </span>
  `).join("");
  _makeChipsDraggable(list, "_reorderStrategies");
}

function renderSettingsTags() {
  const list = $("#settingsTagsList");
  if (!list) return;
  const tags = state.settings?.custom_tags || [];
  if (!tags.length) {
    list.innerHTML = '<div class="settings-empty">Aucun tag custom pour l\'instant.</div>';
    return;
  }
  list.innerHTML = tags.map(function(t) {
    return '<span class="settings-chip" draggable="true" data-reorder-value="' + escapeHtml(t) + '">' +
      '<span class="settings-chip-drag">' + escapeHtml(t) + '</span>' +
      '<button type="button" class="settings-chip-remove" data-remove-tag="' + escapeHtml(t) + '" title="Supprimer">x</button>' +
      '</span>';
  }).join("");
  _makeChipsDraggable(list, "_reorderTags");
}

function renderSettingsPage() {
  if (!state.settings) return;
  const pseudo = $("#settingsPseudo");
  const prefAnimations = $("#prefAnimations");
  const prefDarkMode = $("#prefDarkMode");
  if (pseudo) pseudo.value = state.settings.profile?.pseudo || "";
  if (prefAnimations) prefAnimations.checked = state.settings.preferences?.animations !== false;
  if (prefDarkMode) prefDarkMode.checked = state.settings.preferences?.dark_mode !== false;
  var themeSel = $("#prefTheme");
  if (themeSel) themeSel.value = state.settings.preferences?.theme || "default";
  renderSettingsStrategies();
  renderSettingsTags();
}

// ── Settings : drag-to-reorder chips ──
function _makeChipsDraggable(list, reorderFn) {
  var dragSrc = null;
  list.addEventListener("dragstart", function (e) {
    var chip = e.target.closest(".settings-chip");
    if (!chip) return;
    dragSrc = chip;
    chip.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
  });
  list.addEventListener("dragend", function (e) {
    var chip = e.target.closest(".settings-chip");
    if (chip) chip.classList.remove("dragging");
    list.querySelectorAll(".settings-chip").forEach(function (c) { c.classList.remove("drag-over"); });
  });
  list.addEventListener("dragover", function (e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    var target = e.target.closest(".settings-chip");
    if (!target || target === dragSrc) return;
    list.querySelectorAll(".settings-chip").forEach(function (c) { c.classList.remove("drag-over"); });
    target.classList.add("drag-over");
  });
  list.addEventListener("drop", function (e) {
    e.preventDefault();
    if (!dragSrc) return;
    var target = e.target.closest(".settings-chip");
    if (!target || target === dragSrc) return;
    var fromVal = dragSrc.dataset.reorderValue;
    var toVal = target.dataset.reorderValue;
    if (!fromVal || !toVal) return;
    if (typeof window[reorderFn] === "function") {
      window[reorderFn](fromVal, toVal);
    }
    dragSrc = null;
  });
}

function _reorderStrategies(fromVal, toVal) {
  var arr = state.settings?.custom_strategies || [];
  var fromIdx = arr.findIndex(function (s) { return s.value === fromVal; });
  var toIdx = arr.findIndex(function (s) { return s.value === toVal; });
  if (fromIdx < 0 || toIdx < 0) return;
  var item = arr.splice(fromIdx, 1)[0];
  arr.splice(toIdx, 0, item);
  saveSettingsState();
  applySettingsState();
  renderSettingsPage();
  if (state.currentPage === "insights") renderPerformance();
}

function _reorderTags(fromVal, toVal) {
  var arr = state.settings?.custom_tags || [];
  var fromIdx = arr.indexOf(fromVal);
  var toIdx = arr.indexOf(toVal);
  if (fromIdx < 0 || toIdx < 0) return;
  var item = arr.splice(fromIdx, 1)[0];
  arr.splice(toIdx, 0, item);
  saveSettingsState();
  renderSettingsPage();
}

function saveProfileSettings() {
  const input = $("#settingsPseudo");
  if (!input || !state.settings) return;
  const pseudo = input.value.trim() || "trader";
  state.settings.profile.pseudo = pseudo;
  const btn = $("#settingsSaveProfileBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Enregistrement..."; }
  saveSettingsState();
  applySettingsState();
  // Mettre a jour le dashboard Today si visible
  if (state.currentPage === "today" && typeof renderToday === "function") renderToday();
  toast("Profil mis à jour ✓", "success");
  if (btn) { setTimeout(function() { btn.disabled = false; btn.textContent = "Enregistrer"; }, 1500); }
}
