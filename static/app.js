// ---- 000_state.js ----
/* =============================================================
   COCKPIT v3 — Trading Journal — frontend
   Schéma : days (contexte journalier) + trades (N par jour)
   ============================================================= */

// Stockage interne (private) — la variable ``state`` expose un Proxy
const _state = {
  currentMonth:    new Date(),
  days:            [],   // jours du mois courant
  allDays:         [],   // tous les jours (pour today + search)
  statsInstrument: "ALL",
  currentPage:     "today",
  // Modal state
  currentDayId:    null,
  currentTradeId:  null,
  isSavingDay:     false,
  isSavingTrade:   false,
  modalDataDirty:  false,
  initialDayState: null,
  initialDayPayload: null,
  // Cmd-K
  cmdkOpen:       false,
  cmdkResults:    [],
  cmdkActiveIdx:  0,
  // Stats cache
  _stats: null,
  // Front settings
  settings: null,
  // Journal calendar metric mode: pnl | trades | both
  calendarMetricMode: "pnl",
  // Journal view mode: month | week
  journalViewMode: "month",
  // Journal surface mode: calendar | table
  journalLayoutMode: "calendar",
  // Journal range mode (month view): month | quarter | custom
  journalRangeMode: "month",
  // Journal custom range payload
  journalCustomFrom: "",
  journalCustomTo: "",
  // Journal trade filters (combined)
  journalTradeFilters: {
    strategy: "ALL",
    result: "ALL",
    tag: "ALL",
    pnlMin: "",
    pnlMax: "",
  },
  // Journal table sorting
  journalTableSortKey: "date",
  journalTableSortDir: "desc",
  // Journal monthly focus metric: winrate | pnl | trades
  calendarMonthFocusMode: "winrate",
  // Stats breakdown sort: count | winrate | avg_rr | pnl
  breakdownSortMode: "count",
};

// ---------- Change listeners ----------

const STATE_LISTENERS = {};

/**
 * Souscrire a un changement de clef d'etat.
 * @param {string} key    Nom de la propriete (p. ex. "days")
 * @param {Function} fn   callback(newValue, oldValue)
 */
function onStateChange(key, fn) {
  if (!STATE_LISTENERS[key]) STATE_LISTENERS[key] = [];
  STATE_LISTENERS[key].push(fn);
}

/**
 * Notifier les abonnes d'un changement de clef.
 * Appele automatiquement par le Proxy ci-dessous.
 */
function _dispatchStateChange(key, newValue, oldValue) {
  var list = STATE_LISTENERS[key];
  if (!list) return;
  for (var i = 0; i < list.length; i++) {
    try { list[i](newValue, oldValue); } catch (_) { console.warn('state listener error', _, newValue, oldValue); }
  }
}

// ---------- Proxy : interception des ecritures ----------

/**
 * `state` est un Proxy qui :
 *   - intercepte les ecritures (state.xxx = yyy)
 *   - notifie les abonnes via onStateChange()
 *   - rejette les types incoherents pour les champs connus
 *
 * La syntaxe de lecture/ecriture reste identique : `state.days = [...]`.
 * Aucun refacto des 46 autres modules JS n'est necessaire.
 */
var state = new Proxy(_state, {
  set: function (target, prop, value) {
    // Validation legere des types connus
    var warn = true; // basculer a false pour reduire la verbosite
    if (warn && prop === "days" && !Array.isArray(value)) {
      console.warn("[state] days devrait etre un tableau, recu:", typeof value);
    }
    if (warn && prop === "allDays" && !Array.isArray(value)) {
      console.warn("[state] allDays devrait etre un tableau, recu:", typeof value);
    }
    if (warn && prop === "currentMonth" && !(value instanceof Date)) {
      console.warn("[state] currentMonth devrait etre une Date, recu:", typeof value);
    }

    var old = target[prop];
    if (old === value) return true; // pas de changement
    target[prop] = value;
    _dispatchStateChange(prop, value, old);
    return true;
  },
  get: function (target, prop) {
    return target[prop];
  },
  deleteProperty: function (target, prop) {
    delete target[prop];
    _dispatchStateChange(prop, undefined, undefined);
    return true;
  },
});

// ---- 001_utilities.js ----
// ---------- Utilities ----------

const $  = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const MONTHS_FR = ["Janvier","Février","Mars","Avril","Mai","Juin",
                   "Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const DAYS_FR   = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
var STRATEGY_LABELS = {
  midnight_model: "Midnight Model",
  london_model:   "London Model",
  ny_model:       "NY Model",
};
var DEFAULT_STRATEGY_VALUES = Object.keys(STRATEGY_LABELS);
var INSTRUMENTS = ["BTC", "ETH", "NQ", "ES"];

function renderInstruments() {
  // Rail buttons
  var rail = document.getElementById("instrList");
  if (rail) {
    rail.innerHTML = '<button class="instr-chip active" data-instr="ALL" role="tab" aria-selected="true"><span class="dot" aria-hidden="true"></span>Tous</button>' +
      INSTRUMENTS.map(function (i) {
        return '<button class="instr-chip" data-instr="' + i + '" role="tab" aria-selected="false"><span class="dot" aria-hidden="true"></span>' + i + "</button>";
      }).join("");
  }
  // Day context select
  var ctx = document.getElementById("entryInstrument");
  if (ctx) {
    ctx.innerHTML = '<option value="">Instrument</option>' +
      INSTRUMENTS.map(function (i) { return '<option value="' + i + '">' + i + "</option>"; }).join("");
  }
  // Journal filter select
  var jf = document.getElementById("jFilterInstrument");
  if (jf) {
    jf.innerHTML = '<option value="ALL">Tous</option>' +
      INSTRUMENTS.map(function (i) { return '<option value="' + i + '">' + i + "</option>"; }).join("");
  }
}

const SETTINGS_STORAGE_KEY = "cockpit:settings:v1";
const CALENDAR_METRIC_MODE_KEY = "cockpit:calendarMetricMode:v1";
const CALENDAR_METRIC_MODES = new Set(["pnl", "trades", "both"]);
const JOURNAL_VIEW_MODE_KEY = "cockpit:journalViewMode:v1";
const JOURNAL_VIEW_MODES = new Set(["month", "week"]);
const JOURNAL_LAYOUT_MODE_KEY = "cockpit:journalLayoutMode:v1";
const JOURNAL_LAYOUT_MODES = new Set(["calendar", "table"]);
const JOURNAL_RANGE_MODE_KEY = "cockpit:journalRangeMode:v1";
const JOURNAL_RANGE_MODES = new Set(["month", "quarter", "custom"]);
const JOURNAL_CUSTOM_RANGE_KEY = "cockpit:journalCustomRange:v1";
const JOURNAL_TRADE_FILTERS_KEY = "cockpit:journalTradeFilters:v1";
const JOURNAL_TABLE_SORT_KEY = "cockpit:journalTableSort:v1";
const JOURNAL_TABLE_SORT_KEYS = new Set([
  "date",
  "instrument",
  "strategy",
  "direction",
  "entry_price",
  "exit_price",
  "rr",
  "pnl",
  "result",
]);
const CALENDAR_MONTH_FOCUS_MODE_KEY = "cockpit:calendarMonthFocusMode:v1";
const CALENDAR_MONTH_FOCUS_MODES = new Set(["winrate", "pnl", "trades"]);
const BREAKDOWN_SORT_KEY = "cockpit:breakdownSortMode:v1";
const BREAKDOWN_SORT_MODES = new Set(["count", "winrate", "avg_rr", "pnl"]);

/**
 * Formate un nombre en monnaie: signe + 2 decimales + $.
 * @param {number|string} v
 * @returns {string} Ex: "+150.00$" ou "-50.00$"
 */
function fmtMoney(v) {
  const n = Number(v || 0);
  return (n > 0 ? "+" : "") + n.toFixed(2) + "$";
}
/**
 * Retourne la clef YYYY-MM-DD d'une date.
 * @param {Date} d
 * @returns {string}
 */
function fmtDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function todayKey() { return fmtDateKey(new Date()); }

/**
 * Parse une clef YYYY-MM-DD en objet Date.
 * @param {string} v
 * @returns {Date|null}
 */
function parseDateKey(v) {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return null;
  const dt = new Date(`${v}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}
function startOfWeek(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const shift = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - shift);
  return x;
}
function endOfWeek(d) {
  const x = startOfWeek(d);
  x.setDate(x.getDate() + 6);
  return x;
}
function shiftDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function monthRange(anchor) {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return { from: fmtDateKey(start), to: fmtDateKey(end), label: `${MONTHS_FR[start.getMonth()]} ${start.getFullYear()}` };
}
function quarterRange(anchor) {
  const qStartMonth = Math.floor(anchor.getMonth() / 3) * 3;
  const start = new Date(anchor.getFullYear(), qStartMonth, 1);
  const end = new Date(anchor.getFullYear(), qStartMonth + 3, 0);
  const quarter = Math.floor(qStartMonth / 3) + 1;
  return { from: fmtDateKey(start), to: fmtDateKey(end), label: `T${quarter} ${anchor.getFullYear()}` };
}
/**
 * Formate une date YYYY-MM-DD en JJ/MM/AAAA.
 * @param {string} v
 * @returns {string}
 */
function prettyDateKey(v) {
  const dt = parseDateKey(v);
  if (!dt) return "—";
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`;
}

/**
 * Convertit une valeur en nombre ou null si vide/invalide.
 * @param {*} v
 * @returns {number|null}
 */
function numOrNullRaw(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Infer direction from price levels.
 * NOTE: duplique dans app_parts/03_core_helpers.py _infer_direction_for_validation()
 * @param {number|null} entry
 * @param {number|null} stop
 * @param {number|null} target
 * @returns {string|null} "long", "short", ou null
 */
function inferDirectionFromPrices(entry, stop, target) {
  if (entry == null) return null;
  if (stop != null && stop !== entry) return stop < entry ? "long" : "short";
  if (target != null && target !== entry) return target > entry ? "long" : "short";
  return null;
}

/**
 * Calcule les metriques derivees d'un trade (pnl, is_win, rr, direction).
 * NOTE: duplique dans app_parts/12_stats_math.py _derive_trade_metrics()
 * @param {Object} trade - Donnees brutes du trade
 * @param {number} [trade.entry_price]
 * @param {number} [trade.stop_loss]
 * @param {number} [trade.take_profit]
 * @param {number} [trade.exit_price]
 * @param {number} [trade.position_size]
 * @param {number} [trade.pnl]
 * @param {string} [trade.direction]
 * @param {number} [trade.is_win]
 * @param {number} [trade.rr]
 * @returns {{pnl: number|null, isWin: number|null, rr: number|null, direction: string|null}}
 */
function deriveTradeMetrics(trade) {
  const entry = numOrNullRaw(trade?.entry_price);
  const stop = numOrNullRaw(trade?.stop_loss);
  const target = numOrNullRaw(trade?.take_profit);
  const exit = numOrNullRaw(trade?.exit_price);
  const qtyRaw = numOrNullRaw(trade?.position_size);
  const qty = qtyRaw && qtyRaw > 0 ? qtyRaw : 1;
  const direction = trade?.direction || inferDirectionFromPrices(entry, stop, target);

  let pnl = numOrNullRaw(trade?.pnl);
  if (pnl == null && direction && entry != null && exit != null) {
    pnl = (direction === "long" ? (exit - entry) : (entry - exit)) * qty;
  }

  let isWin = trade?.is_win;
  if (isWin == null || isWin === "") {
    if (pnl != null && pnl !== 0) isWin = pnl > 0 ? 1 : 0;
    else if (direction && entry != null && exit != null && exit !== entry) {
      isWin = direction === "long" ? (exit > entry ? 1 : 0) : (exit < entry ? 1 : 0);
    } else {
      isWin = null;
    }
  }

  let rr = numOrNullRaw(trade?.rr);
  if (rr == null && entry != null && stop != null && stop !== entry) {
    const risk = Math.abs(entry - stop);
    if (risk > 0) {
      if (target != null) rr = Math.abs(target - entry) / risk;
      else if (exit != null) {
        rr = Math.abs(exit - entry) / risk;
        if (isWin === 0) rr = -rr;
      }
    }
  }

  return { pnl, isWin, rr, direction };
}

/**
 * Calcule la position_size en unites depuis la marge, le levier et le prix d entree.
 * Ex: marginUsd=100, leverage=10, entry=23900 -> positionSize=0.04184 BTC
 * @param {number} marginUsd - Marge en dollars
 * @param {number} leverage  - Levier (ex: 10)
 * @param {number} entryPrice - Prix d entree
 * @returns {number|null}
 */
function computePositionSize(marginUsd, leverage, entryPrice) {
  var m = Number(marginUsd);
  var l = Number(leverage);
  var e = Number(entryPrice);
  if (!m || !l || !e || m <= 0 || l <= 0 || e <= 0) return null;
  return Number(((m * l) / e).toFixed(8));
}

/**
 * Calcule la marge en dollars depuis la position_size, le levier et le prix d entree.
 * @param {number} positionSize - Taille en unites (BTC, ETH...)
 * @param {number} leverage - Levier
 * @param {number} entryPrice - Prix d entree
 * @returns {number|null}
 */
function computeMarginUsd(positionSize, leverage, entryPrice) {
  var p = Number(positionSize);
  var l = Number(leverage);
  var e = Number(entryPrice);
  if (!p || !l || !e || p <= 0 || l <= 0 || e <= 0) return null;
  return Number(((p * e) / l).toFixed(2));
}

/**
 * Echappe les caracteres HTML dans une chaine.
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, m =>
    ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m])
  );
}

// ---------- Loading indicator ----------

var _loadingCount = 0;

/**
 * Affiche ou masque la barre de progression en haut de page.
 * Utilise un compteur pour les appels imbriques.
 * @param {boolean} show - true pour afficher, false pour masquer
 */
function loading(show) {
  var el = document.getElementById("loadingBar");
  if (!el) return;
  if (show) {
    _loadingCount += 1;
    el.classList.add("active");
  } else {
    _loadingCount = Math.max(0, _loadingCount - 1);
    if (_loadingCount === 0) el.classList.remove("active");
  }
}

// ---------- Toast ----------

var _toastQueue = [];
var _toastTimer = null;
var _toastDurations = { error: 5000, success: 3000 };
var _toastDefaultDuration = 2800;

function _toastShowNext() {
  if (_toastQueue.length === 0) return;
  var entry = _toastQueue.shift();
  var t = $("#toast");
  var m = $("#toastMsg");
  if (!t || !m) return;
  t.className = "toast " + entry.type;
  m.textContent = entry.msg;
  t.classList.remove("hidden");
  var duration = _toastDurations[entry.type] || _toastDefaultDuration;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(_toastHide, duration);
}

function _toastHide() {
  var t = $("#toast");
  if (t) t.classList.add("hidden");
  // Toast suivant dans la file apres un court delai
  setTimeout(_toastShowNext, 200);
}

/**
 * Affiche une notification temporaire avec file d'attente.
 * Les toasts s empilent : le suivant apparait apres la disparition du courant.
 * @param {string} msg - Message a afficher
 * @param {string} [type=""] - Type : "error" (5s), "success" (3s), ou "" (2.8s)
 */
function toast(msg, type) {
  type = type || "";
  _toastQueue.push({ msg: msg, type: type });
  // Si aucun toast n est affiche, lancer le suivant
  var t = $("#toast");
  if (t && t.classList.contains("hidden")) {
    _toastShowNext();
  }
}

// Dismiss manuel
document.addEventListener("DOMContentLoaded", function () {
  var btn = document.getElementById("toastClose");
  if (btn) {
    btn.addEventListener("click", function () {
      clearTimeout(_toastTimer);
      _toastHide();
    });
  }
});

/**
 * Appel API fetch avec gestion d'erreur integree.
 * @param {string} path - Chemin de l'API (ex: "/api/days")
 * @param {Object} [opts={}] - Options fetch (body, method, etc.)
 * @returns {Promise<Object>} Reponse JSON decodee
 * @throws {Error} Si la reponse HTTP n'est pas OK
 */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || "Erreur");
  }
  return res.json();
}

// ---- 002_prettify.js ----
function prettify(s) {
  return STRATEGY_LABELS[s] || String(s).replace(/_/g," ").replace(/\b\w/g, c => c.toUpperCase());
}

function defaultSettingsState() {
  return {
    profile: { pseudo: "trader" },
    custom_strategies: [],
    custom_tags: [],
    preferences: { animations: true, dark_mode: true },
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
  rawList.forEach(item => {
    const label = (typeof item === "string" ? item : item?.label || "").trim();
    if (!label) return;
    const preferred = normalizeStrategyValue(typeof item === "object" ? item?.value : "");
    const value = preferred && !taken.has(preferred) ? preferred : uniqueStrategyValue(label, taken);
    taken.add(value);
    out.push({ value, label });
  });
  return out;
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
    },
  };
}

function loadSettingsState() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
    // Migration: ancien localStorage["theme"] -> preferences.dark_mode
    if (raw.preferences?.dark_mode === undefined) {
      try {
        const legacyTheme = localStorage.getItem("theme");
        if (legacyTheme === "light") raw.preferences = raw.preferences || {};
        if (legacyTheme === "light") raw.preferences.dark_mode = false;
      } catch (_) {}
    }
    return sanitizeSettings(raw);
  } catch {
    return defaultSettingsState();
  }
}

function saveSettingsState() {
  if (!state.settings) return;
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state.settings));
}

function applyProfileSetting() {
  const pseudo = state.settings?.profile?.pseudo || "trader";
  const greeting = $("#todayGreeting");
  if (greeting) greeting.textContent = pseudo;
}

function applyVisualSettings() {
  const prefersDark = state.settings?.preferences?.dark_mode !== false;
  const prefersAnimations = state.settings?.preferences?.animations !== false;
  document.body.classList.toggle("light-mode", !prefersDark);
  document.body.classList.toggle("reduce-motion", !prefersAnimations);
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
    <span class="settings-chip">
      <span>${escapeHtml(s.label)}</span>
      <button type="button" class="settings-chip-remove" data-remove-strategy="${escapeHtml(s.value)}" title="Supprimer">x</button>
    </span>
  `).join("");
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
    return '<span class="settings-chip">' +
      '<span>' + escapeHtml(t) + '</span>' +
      '<button type="button" class="settings-chip-remove" data-remove-tag="' + escapeHtml(t) + '" title="Supprimer">x</button>' +
      '</span>';
  }).join("");
}

function renderSettingsPage() {
  if (!state.settings) return;
  const pseudo = $("#settingsPseudo");
  const prefAnimations = $("#prefAnimations");
  const prefDarkMode = $("#prefDarkMode");
  if (pseudo) pseudo.value = state.settings.profile?.pseudo || "";
  if (prefAnimations) prefAnimations.checked = state.settings.preferences?.animations !== false;
  if (prefDarkMode) prefDarkMode.checked = state.settings.preferences?.dark_mode !== false;
  renderSettingsStrategies();
  renderSettingsTags();
}

function saveProfileSettings() {
  const input = $("#settingsPseudo");
  if (!input || !state.settings) return;
  const pseudo = input.value.trim() || "trader";
  state.settings.profile.pseudo = pseudo;
  saveSettingsState();
  applySettingsState();
  toast("Profil mis à jour ✓", "success");
}

// ---- 003_addcustomstrategyfromsettings.js ----
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
  if (state.currentPage === "stats") renderPerformance();
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
  if (state.currentPage === "stats") renderPerformance();
  toast("Stratégie supprimée", "success");
}

function savePreferenceSettings() {
  if (!state.settings) return;
  state.settings.preferences.animations = !!$("#prefAnimations")?.checked;
  state.settings.preferences.dark_mode = !!$("#prefDarkMode")?.checked;
  saveSettingsState();
  applySettingsState();
  if (state.currentPage === "stats") renderPerformance();
  toast("Préférences appliquées ✓", "success");
}

async function refreshApiKeyStatus() {
  const status = $("#settingsApiStatus");
  const masked = $("#settingsApiKeyMasked");
  const env = $("#settingsApiEnv");
  const hint = $("#settingsApiHint");
  if (!status || !masked || !env) return;
  status.textContent = "Chargement...";
  status.className = "settings-badge";
  masked.value = "";
  if (hint) hint.style.display = "none";
  try {
    const s = await api("/api/settings");
    const isSet = !!s.ai_api_key_present;
    status.textContent = isSet ? "Configurée" : "Non configurée";
    status.className = `settings-badge ${isSet ? "ok" : "warn"}`;
    masked.value = s.ai_api_key_masked || "";
    env.textContent = s.ai_api_key_env || "ANTHROPIC_API_KEY";
    if (!isSet && hint && s.ai_config_hint) {
      hint.textContent = s.ai_config_hint;
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
}

function loadCalendarMetricMode() {
  try {
    const raw = localStorage.getItem(CALENDAR_METRIC_MODE_KEY);
    return CALENDAR_METRIC_MODES.has(raw) ? raw : "pnl";
  } catch {
    return "pnl";
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
  if (persist) localStorage.setItem(CALENDAR_METRIC_MODE_KEY, mode);
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
    return JOURNAL_VIEW_MODES.has(raw) ? raw : "month";
  } catch {
    return "month";
  }
}

function loadJournalLayoutMode() {
  try {
    const raw = localStorage.getItem(JOURNAL_LAYOUT_MODE_KEY);
    return JOURNAL_LAYOUT_MODES.has(raw) ? raw : "calendar";
  } catch {
    return "calendar";
  }
}

function defaultJournalTradeFilters() {
  return {
    strategy: "ALL",
    result: "ALL",
    tag: "ALL",
    pnlMin: "",
    pnlMax: "",
  };
}

function sanitizeJournalTradeFilters(raw) {
  const d = defaultJournalTradeFilters();
  const out = { ...d };
  if (typeof raw?.strategy === "string" && raw.strategy) out.strategy = raw.strategy;
  if (typeof raw?.result === "string" && ["ALL", "WIN", "LOSS", "OPEN"].includes(raw.result)) out.result = raw.result;
  if (typeof raw?.tag === "string" && raw.tag) out.tag = raw.tag;
  if (raw?.pnlMin != null && raw.pnlMin !== "") out.pnlMin = String(raw.pnlMin);
  if (raw?.pnlMax != null && raw.pnlMax !== "") out.pnlMax = String(raw.pnlMax);
  return out;
}

function loadJournalTradeFilters() {
  try {
    const raw = JSON.parse(localStorage.getItem(JOURNAL_TRADE_FILTERS_KEY) || "{}");
    return sanitizeJournalTradeFilters(raw);
  } catch {
    return defaultJournalTradeFilters();
  }
}

// ---- 004_loadjournaltablesort.js ----
function loadJournalTableSort() {
  try {
    const raw = JSON.parse(localStorage.getItem(JOURNAL_TABLE_SORT_KEY) || "{}");
    const key = (typeof raw?.key === "string" && JOURNAL_TABLE_SORT_KEYS.has(raw.key)) ? raw.key : "date";
    const dir = raw?.dir === "asc" ? "asc" : "desc";
    return { key, dir };
  } catch {
    return { key: "date", dir: "desc" };
  }
}

function updateJournalViewToggleUI() {
  const btns = $$("#calendarViewToggle .calendar-view-btn");
  btns.forEach(btn => btn.classList.toggle("active", btn.dataset.mode === state.journalViewMode));
}

function updateJournalLayoutToggleUI() {
  // Support both old (#calendarLayoutToggle) and new (.jfilter-layout-btn) toggle styles
  var btns = $$("#calendarLayoutToggle .calendar-layout-btn");
  if (!btns.length) btns = $$("#journalFilters .jfilter-layout-btn");
  btns.forEach(btn => btn.classList.toggle("active", btn.dataset.mode === state.journalLayoutMode));
}

function loadJournalRangeMode() {
  try {
    var raw = localStorage.getItem(JOURNAL_RANGE_MODE_KEY);
    return JOURNAL_RANGE_MODES.has(raw) ? raw : "month";
  } catch {
    return "month";
  }
}

function loadJournalCustomRange() {
  try {
    var raw = JSON.parse(localStorage.getItem(JOURNAL_CUSTOM_RANGE_KEY) || "{}");
    return {
      from: typeof raw?.from === "string" ? raw.from : "",
      to: typeof raw?.to === "string" ? raw.to : "",
    };
  } catch {
    return { from: "", to: "" };
  }
}

function updateJournalRangeToggleUI() {
  $$("#calendarRangeToggle .calendar-range-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === state.journalRangeMode);
  });
  const customWrap = $("#calendarCustomRange");
  const showCustom = state.journalViewMode === "month" && state.journalRangeMode === "custom";
  if (customWrap) customWrap.classList.toggle("hidden", !showCustom);

  const customLabel = $("#calendarCustomLabel");
  if (customLabel) {
    const from = state.journalCustomFrom || "";
    const to = state.journalCustomTo || "";
    customLabel.textContent = from && to ? `${prettyDateKey(from)} -> ${prettyDateKey(to)}` : "-";
  }

  const custom = getJournalCustomWindow();
  const spanDays = custom ? Math.max(1, Math.round((custom.to - custom.from) / 86400000) + 1) : null;
  $$("#calendarQuickRange .calendar-quick-btn").forEach((btn) => {
    const days = Number(btn.dataset.days || 0);
    btn.classList.toggle("active", spanDays != null && days === spanDays);
  });
}

function updateJournalTradeFiltersUI() {
  const f = state.journalTradeFilters || defaultJournalTradeFilters();
  const strategySel = $("#journalFilterStrategy");
  if (!strategySel) return;
  const resultSel = $("#journalFilterResult");
  const tagSel = $("#journalFilterTag");
  strategySel.value = f.strategy || "ALL";
  if (resultSel) resultSel.value = f.result || "ALL";
  if (tagSel) tagSel.value = f.tag || "ALL";
  var pnlMin = $("#journalFilterPnlMin");
  var pnlMax = $("#journalFilterPnlMax");
  if (pnlMin) pnlMin.value = parseFilterNumber(f.pnlMin) != null ? f.pnlMin : "";
  if (pnlMax) pnlMax.value = parseFilterNumber(f.pnlMax) != null ? f.pnlMax : "";

  // Badge actif sur le summary
  var count = 0;
  if (f.strategy && f.strategy !== "ALL") count++;
  if (f.result && f.result !== "ALL") count++;
  if (f.tag && f.tag !== "ALL") count++;
  if (parseFilterNumber(f.pnlMin) != null) count++;
  if (parseFilterNumber(f.pnlMax) != null) count++;
  var summary = document.querySelector(".journal-advanced-filters > summary");
  if (summary) {
    var badge = summary.querySelector(".filter-badge");
    if (count > 0) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "filter-badge";
        summary.appendChild(badge);
      }
      badge.textContent = "(" + count + ")";
    } else if (badge) {
      badge.remove();
    }
  }
}

function updateJournalTradeFilterOptions(days = state.days) {
  const strategySel = $("#journalFilterStrategy");
  const tagSel = $("#journalFilterTag");

  const strategySet = new Set(["ALL"]);
  DEFAULT_STRATEGY_VALUES.forEach(s => strategySet.add(s));
  (state.settings?.custom_strategies || []).forEach(s => strategySet.add(s.value));
  const tagSet = new Set(["ALL"]);
  (state.settings?.custom_tags || []).forEach(t => tagSet.add(t));

  (days || []).forEach(day => {
    (day.trades || []).forEach(tr => {
      if (tr.strategy) strategySet.add(tr.strategy);
      (Array.isArray(tr.tags) ? tr.tags : []).forEach(tag => {
        const clean = String(tag || "").trim();
        if (clean) tagSet.add(clean);
      });
    });
  });

  if (strategySel) {
    const current = state.journalTradeFilters?.strategy || "ALL";
    strategySel.innerHTML = "";
    Array.from(strategySet).forEach(value => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = value === "ALL" ? "Toutes" : prettify(value);
      strategySel.appendChild(opt);
    });
    strategySel.value = strategySet.has(current) ? current : "ALL";
    state.journalTradeFilters.strategy = strategySel.value;
  }

  if (tagSel) {
    const current = state.journalTradeFilters?.tag || "ALL";
    tagSel.innerHTML = "";
    Array.from(tagSet).sort((a, b) => {
      if (a === "ALL") return -1;
      if (b === "ALL") return 1;
      return String(a).localeCompare(String(b));
    }).forEach(value => {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = value === "ALL" ? "Tous" : `#${value}`;
      tagSel.appendChild(opt);
    });
    tagSel.value = tagSet.has(current) ? current : "ALL";
    state.journalTradeFilters.tag = tagSel.value;
  }
}

function saveJournalTradeFilters() {
  localStorage.setItem(JOURNAL_TRADE_FILTERS_KEY, JSON.stringify(state.journalTradeFilters || defaultJournalTradeFilters()));
}

function saveJournalTableSort() {
  localStorage.setItem(JOURNAL_TABLE_SORT_KEY, JSON.stringify({
    key: state.journalTableSortKey,
    dir: state.journalTableSortDir,
  }));
}

function updateJournalControlsVisibility() {
  const wrap = $("#journalMonthInputWrap");
  const hidePicker = state.journalViewMode === "week" || state.journalRangeMode === "custom";
  if (wrap) wrap.classList.toggle("hidden", hidePicker);
  if (hidePicker) closeMonthPicker();

  const showCalendar = state.journalLayoutMode !== "table";
  $("#journalCalendarWrap")?.classList.toggle("hidden", !showCalendar);
  $("#calendarMetricToggle")?.classList.toggle("hidden", !showCalendar);
  $("#journalTableWrap")?.classList.toggle("hidden", showCalendar);
}

function setJournalViewMode(mode, opts = {}) {
  const { persist = true, reload = true } = opts;
  if (!JOURNAL_VIEW_MODES.has(mode)) return;
  state.journalViewMode = mode;
  updateJournalViewToggleUI();
  updateJournalRangeToggleUI();
  updateJournalControlsVisibility();
  if (persist) localStorage.setItem(JOURNAL_VIEW_MODE_KEY, mode);
  if (reload && state.currentPage === "journal") loadMonth();
}

function setJournalRangeMode(mode, opts = {}) {
  const { persist = true, reload = true } = opts;
  if (!JOURNAL_RANGE_MODES.has(mode)) return;
  state.journalRangeMode = mode;
  if (mode === "custom") {
    const custom = getJournalCustomWindow();
    if (!custom) {
      setRollingCustomRange(30, { persist: true, reload: false });
    } else {
      state.currentMonth = custom.from;
    }
  }
  updateJournalRangeToggleUI();
  updateJournalControlsVisibility();
  if (persist) localStorage.setItem(JOURNAL_RANGE_MODE_KEY, mode);
  if (reload && state.currentPage === "journal") loadMonth();
}

// ---------- Nouveaux filtres Journal (style Insights) ----------

function _applyJournalFilter() {
  var from = $("#jFilterFrom");
  var to = $("#jFilterTo");
  var instr = $("#jFilterInstrument");
  if (!from || !to || !instr) return;

  var fromDate = new Date(from.value + "T00:00:00");
  var toDate = new Date(to.value + "T00:00:00");
  var mid = new Date((fromDate.getTime() + toDate.getTime()) / 2);
  state.currentMonth = mid;
  state.journalCustomFrom = from.value;
  state.journalCustomTo = to.value;
  state.journalRangeMode = "custom";
  loadMonth();
}

function _fmtDate2(d) {
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, "0");
  var day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

// ---- 005_setjournalcustomrange.js ----
function setJournalCustomRange(fromKey, toKey, opts = {}) {
  const { persist = true, reload = true } = opts;
  state.journalCustomFrom = fromKey || "";
  state.journalCustomTo = toKey || "";
  if (state.journalRangeMode === "custom") {
    const anchor = parseDateKey(state.journalCustomFrom);
    if (anchor) state.currentMonth = anchor;
  }
  updateJournalRangeToggleUI();
  if (persist) {
    localStorage.setItem(JOURNAL_CUSTOM_RANGE_KEY, JSON.stringify({
      from: state.journalCustomFrom,
      to: state.journalCustomTo,
    }));
  }
  if (reload && state.currentPage === "journal") loadMonth();
}

function setRollingCustomRange(days, opts = {}) {
  const span = Math.max(1, Number(days) || 30);
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - (span - 1));
  setJournalCustomRange(fmtDateKey(start), fmtDateKey(end), opts);
}

function bindJournalViewToggle() {
  const wrap = $("#calendarViewToggle");
  if (!wrap) return;
  wrap.addEventListener("click", e => {
    const btn = e.target.closest(".calendar-view-btn");
    if (!btn) return;
    setJournalViewMode(btn.dataset.mode, { persist: true, reload: true });
  });
}

function bindJournalRangeToggle() {
  const wrap = $("#calendarRangeToggle");
  if (!wrap) return;
  wrap.addEventListener("click", e => {
    const btn = e.target.closest(".calendar-range-btn");
    if (!btn) return;
    setJournalRangeMode(btn.dataset.mode, { persist: true, reload: true });
  });

  $("#calendarQuickRange")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".calendar-quick-btn");
    if (!btn) return;
    const days = Number(btn.dataset.days || 30);
    if (!Number.isFinite(days) || days < 1) return;
    if (state.journalRangeMode !== "custom") {
      setJournalRangeMode("custom", { persist: true, reload: false });
    }
    setRollingCustomRange(days, { persist: true, reload: true });
  });
}

function setJournalLayoutMode(mode, opts = {}) {
  const { persist = true, rerender = true } = opts;
  if (!JOURNAL_LAYOUT_MODES.has(mode)) return;
  state.journalLayoutMode = mode;
  state._journalLayoutExplicit = persist; // auto-switch (persist:false) ne compte pas
  updateJournalLayoutToggleUI();
  updateJournalControlsVisibility();
  if (persist) localStorage.setItem(JOURNAL_LAYOUT_MODE_KEY, mode);
  if (rerender && state.currentPage === "journal") {
    if (typeof closeJournalDayTrades === "function") closeJournalDayTrades();
    renderCalendar();
  }
}

function bindJournalLayoutToggle() {
  const wrap = $("#calendarLayoutToggle");
  if (!wrap) return;
  wrap.addEventListener("click", e => {
    const btn = e.target.closest(".calendar-layout-btn");
    if (!btn) return;
    setJournalLayoutMode(btn.dataset.mode, { persist: true, rerender: true });
  });
}

function parseFilterNumber(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeTradeTags(raw) {
  if (Array.isArray(raw)) {
    return raw.map(t => String(t || "").trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    const maybeJson = raw.trim();
    if (!maybeJson) return [];
    try {
      const parsed = JSON.parse(maybeJson);
      if (Array.isArray(parsed)) return normalizeTradeTags(parsed);
    } catch {
      // fallback below
    }
    return maybeJson.split(",").map(t => t.trim()).filter(Boolean);
  }
  return [];
}

function hasActiveJournalTradeFilters() {
  const f = state.journalTradeFilters || defaultJournalTradeFilters();
  return !!(
    (f.strategy && f.strategy !== "ALL")
    || (f.result && f.result !== "ALL")
    || (f.tag && f.tag !== "ALL")
    || parseFilterNumber(f.pnlMin) != null
    || parseFilterNumber(f.pnlMax) != null
  );
}

function buildJournalTradeRow(day, trade, idx = 0) {
  if (!day || !trade) return null;
  const metrics = deriveTradeMetrics(trade);
  const result = metrics.isWin === 1 ? "WIN" : metrics.isWin === 0 ? "LOSS" : "OPEN";
  const direction = (metrics.direction || trade.direction || "").toLowerCase();
  return {
    id: `${day.id || "day"}:${trade.id || idx}`,
    day,
    trade,
    date: day.date || "",
    instrument: day.instrument || "",
    strategy: trade.strategy || "",
    direction,
    entry_price: numOrNullRaw(trade.entry_price),
    exit_price: numOrNullRaw(trade.exit_price),
    rr: metrics.rr == null ? null : Number(metrics.rr),
    pnl: metrics.pnl == null ? null : Number(metrics.pnl),
    result,
    resultRank: result === "WIN" ? 2 : result === "OPEN" ? 1 : 0,
    tags: normalizeTradeTags(trade.tags),
  };
}

function getJournalTradeRows(days = state.days) {
  const rows = [];
  (days || []).forEach(day => {
    (day.trades || []).forEach((trade, idx) => {
      const row = buildJournalTradeRow(day, trade, idx);
      if (row) rows.push(row);
    });
  });
  return rows;
}

function rowMatchesJournalTradeFilters(row, filters = state.journalTradeFilters) {
  if (!row) return false;
  const f = filters || defaultJournalTradeFilters();

  if (f.strategy && f.strategy !== "ALL" && row.strategy !== f.strategy) return false;
  if (f.result && f.result !== "ALL" && row.result !== f.result) return false;
  if (f.tag && f.tag !== "ALL") {
    const wanted = String(f.tag).toLowerCase();
    const hasTag = (row.tags || []).some(t => String(t).toLowerCase() === wanted);
    if (!hasTag) return false;
  }

  const min = parseFilterNumber(f.pnlMin);
  const max = parseFilterNumber(f.pnlMax);
  const pnl = row.pnl == null ? 0 : Number(row.pnl);
  if (min != null && pnl < min) return false;
  if (max != null && pnl > max) return false;
  return true;
}

function getFilteredJournalTradeRows(days = state.days) {
  return getJournalTradeRows(days).filter(row => rowMatchesJournalTradeFilters(row));
}

function compareNullableNumbers(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return Number(a) - Number(b);
}

// ---- 006_comparetext.js ----
function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), "fr", { sensitivity: "base" });
}

let _journalRenderRaf = 0;
let _journalTableRowsCache = [];
let _journalTableBodyBound = false;

function scheduleJournalCalendarRender() {
  if (_journalRenderRaf) return;
  _journalRenderRaf = requestAnimationFrame(() => {
    _journalRenderRaf = 0;
    if (state.currentPage === "journal") {
      if (typeof closeJournalDayTrades === "function") closeJournalDayTrades();
      renderCalendar();
    }
  });
}

function bindJournalTableBodyActions(tbody) {
  if (!tbody || _journalTableBodyBound) return;
  tbody.addEventListener("click", (e) => {
    const tr = e.target.closest("tr");
    if (!tr) return;
    const idx = Number(tr.dataset.rowIndex);
    if (!Number.isFinite(idx)) return;
    const row = _journalTableRowsCache[idx];
    if (!row) return;
    openJournalTradeRow(row);
  });
  _journalTableBodyBound = true;
}

function compareJournalTradeRows(a, b, key) {
  switch (key) {
    case "date":
      return compareText(a.date, b.date);
    case "instrument":
      return compareText(a.instrument, b.instrument);
    case "strategy":
      return compareText(prettify(a.strategy), prettify(b.strategy));
    case "direction":
      return compareText(a.direction, b.direction);
    case "entry_price":
      return compareNullableNumbers(a.entry_price, b.entry_price);
    case "exit_price":
      return compareNullableNumbers(a.exit_price, b.exit_price);
    case "rr":
      return compareNullableNumbers(a.rr, b.rr);
    case "pnl":
      return compareNullableNumbers(a.pnl, b.pnl);
    case "result":
      return compareNullableNumbers(a.resultRank, b.resultRank);
    default:
      return 0;
  }
}

function getSortedJournalTradeRows(days = state.days) {
  const rows = getFilteredJournalTradeRows(days).slice();
  const key = JOURNAL_TABLE_SORT_KEYS.has(state.journalTableSortKey) ? state.journalTableSortKey : "date";
  const dir = state.journalTableSortDir === "asc" ? "asc" : "desc";
  rows.sort((a, b) => {
    const cmp = compareJournalTradeRows(a, b, key);
    if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
    const dateCmp = compareText(b.date, a.date);
    if (dateCmp !== 0) return dateCmp;
    return Number(b.trade?.id || 0) - Number(a.trade?.id || 0);
  });
  return rows;
}

function updateJournalTableSortUI() {
  $$("#journalTableWrap .journal-sort-btn").forEach(btn => {
    if (!btn.dataset.label) btn.dataset.label = btn.textContent.trim();
    btn.innerHTML = "";
    btn.textContent = btn.dataset.label;
    const active = btn.dataset.sortKey === state.journalTableSortKey;
    btn.classList.toggle("active", active);
    if (active) {
      const dir = document.createElement("span");
      dir.className = "sort-dir";
      dir.textContent = state.journalTableSortDir === "asc" ? "\u25B2" : "\u25BC";
      btn.appendChild(dir);
    }
  });
}

function toggleJournalTableSort(sortKey) {
  if (!JOURNAL_TABLE_SORT_KEYS.has(sortKey)) return;
  if (state.journalTableSortKey === sortKey) {
    state.journalTableSortDir = state.journalTableSortDir === "asc" ? "desc" : "asc";
  } else {
    state.journalTableSortKey = sortKey;
    state.journalTableSortDir = sortKey === "date" ? "desc" : "asc";
  }
  saveJournalTableSort();
  updateJournalTableSortUI();
  renderJournalTable();
}

function bindJournalTableSort() {
  const wrap = $("#journalTableWrap");
  if (!wrap) return;
  wrap.addEventListener("click", e => {
    const btn = e.target.closest(".journal-sort-btn");
    if (!btn) return;
    toggleJournalTableSort(btn.dataset.sortKey);
  });
}

function applyJournalTradeFiltersAndRender() {
  saveJournalTradeFilters();
  scheduleJournalCalendarRender();
}

function bindJournalTradeFilters() {
  const strategySel = $("#journalFilterStrategy");
  if (!strategySel) return;
  const resultSel = $("#journalFilterResult");
  const tagSel = $("#journalFilterTag");
  const minInput = $("#journalFilterPnlMin");
  const maxInput = $("#journalFilterPnlMax");
  const resetBtn = $("#journalFilterReset");

  strategySel?.addEventListener("change", () => {
    state.journalTradeFilters.strategy = strategySel.value || "ALL";
    applyJournalTradeFiltersAndRender();
  });
  resultSel?.addEventListener("change", () => {
    state.journalTradeFilters.result = resultSel.value || "ALL";
    applyJournalTradeFiltersAndRender();
  });
  tagSel?.addEventListener("change", () => {
    state.journalTradeFilters.tag = tagSel.value || "ALL";
    applyJournalTradeFiltersAndRender();
  });

  let timer = null;
  const onPnlInput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.journalTradeFilters.pnlMin = minInput?.value || "";
      state.journalTradeFilters.pnlMax = maxInput?.value || "";
      applyJournalTradeFiltersAndRender();
    }, 140);
  };
  minInput?.addEventListener("input", onPnlInput);
  maxInput?.addEventListener("input", onPnlInput);

  resetBtn?.addEventListener("click", () => {
    state.journalTradeFilters = defaultJournalTradeFilters();
    updateJournalTradeFiltersUI();
    applyJournalTradeFiltersAndRender();
  });
}

function buildCalendarByDay(days = state.days) {
  const byDay = {};
  const activeTradeFilters = hasActiveJournalTradeFilters();

  (days || []).forEach(day => {
    const dayRows = (day.trades || [])
      .map((trade, idx) => buildJournalTradeRow(day, trade, idx))
      .filter(Boolean)
      .filter(row => rowMatchesJournalTradeFilters(row));

    const includeContextOnly = !activeTradeFilters && (day.trades || []).length === 0;
    if (!dayRows.length && !includeContextOnly) return;

    const key = day.date;
    if (!byDay[key]) byDay[key] = { days: [], pnl: 0, trades: 0, wins: 0, losses: 0 };
    byDay[key].days.push(day);
    dayRows.forEach(row => {
      byDay[key].trades += 1;
      byDay[key].pnl += Number(row.pnl || 0);
      if (row.result === "WIN") byDay[key].wins += 1;
      else if (row.result === "LOSS") byDay[key].losses += 1;
    });
  });

  return byDay;
}

function openJournalTradeRow(row) {
  if (!row?.day) return;
  if (typeof renderJournalDayTrades === "function") {
    renderJournalDayTrades(row.date, [row.day]);
    // Ouvrir l'editeur inline pour ce trade directement
    var tradeId = row.trade && row.trade.id != null ? String(row.trade.id) : null;
    if (tradeId) {
      var checkExist = setInterval(function () {
        var editBtn = document.querySelector('[data-journal-trade-edit="' + tradeId + '"]');
        if (editBtn) {
          clearInterval(checkExist);
          editBtn.click();
          editBtn.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 50);
      setTimeout(function () { clearInterval(checkExist); }, 3000);
    }
  }
}

function renderJournalTable() {
  const tbody = $("#journalTradesTbody");
  const emptyEl = $("#journalTableEmpty");
  const countEl = $("#journalTableCount");
  if (!tbody || !emptyEl || !countEl) return;

  const rows = getSortedJournalTradeRows(state.days);
  _journalTableRowsCache = rows;
  bindJournalTableBodyActions(tbody);
  updateJournalTableSortUI();
  const fragment = document.createDocumentFragment();

  rows.forEach((row, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.rowIndex = String(idx);
    const pnlClass = row.pnl > 0 ? "pos" : row.pnl < 0 ? "neg" : "";
    const dir = row.direction ? row.direction.toUpperCase() : "-";
    const pnlTxt = row.pnl == null ? "-" : fmtMoney(row.pnl);

    tr.innerHTML = `
      <td class="mono">${escapeHtml(row.date || "-")}</td>
      <td>${escapeHtml(wizInstrumentLabel(row.instrument))}</td>
      <td>${escapeHtml(prettify(row.strategy || ""))}</td>
      <td class="mono ${row.direction === 'long' ? 'dir-long' : 'dir-short'}">${escapeHtml(dir)}</td>
      <td class="mono">${row.entry_price != null ? Number(row.entry_price).toFixed(2) : "-"}</td>
      <td class="mono">${row.exit_price != null ? Number(row.exit_price).toFixed(2) : "-"}</td>
      <td class="mono">${row.rr != null ? Number(row.rr).toFixed(2) + "R" : "-"}</td>
      <td class="mono journal-td-pnl ${pnlClass}">${pnlTxt}</td>
      <td class="mono ${(row.result || "").toLowerCase()}">${escapeHtml(row.result || "-")}</td>
    `;
    fragment.appendChild(tr);
  });

  tbody.replaceChildren(fragment);

  const count = rows.length;
  countEl.textContent = `${count} trade${count > 1 ? "s" : ""}`;
  emptyEl.classList.toggle("hidden", count > 0);
}

// ---- 007_loadcalendarmonthfocusmode.js ----
function loadCalendarMonthFocusMode() {
  try {
    const raw = localStorage.getItem(CALENDAR_MONTH_FOCUS_MODE_KEY);
    return CALENDAR_MONTH_FOCUS_MODES.has(raw) ? raw : "winrate";
  } catch {
    return "winrate";
  }
}

function updateCalendarMonthFocusToggleUI() {
  const root = $("#calendarMonthFocus");
  if (root) root.dataset.mode = state.calendarMonthFocusMode;
  $$("#calendarMonthFocusToggle .calendar-month-focus-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.mode === state.calendarMonthFocusMode);
  });
}

function setCalendarMonthFocusMode(mode, opts = {}) {
  const { persist = true, rerender = true } = opts;
  if (!CALENDAR_MONTH_FOCUS_MODES.has(mode)) return;
  state.calendarMonthFocusMode = mode;
  updateCalendarMonthFocusToggleUI();
  if (persist) localStorage.setItem(CALENDAR_MONTH_FOCUS_MODE_KEY, mode);
  if (rerender && state.currentPage === "journal") {
    if (typeof closeJournalDayTrades === "function") closeJournalDayTrades();
    renderCalendar();
  }
}

function bindCalendarMonthFocusToggle() {
  const wrap = $("#calendarMonthFocusToggle");
  if (!wrap) return;
  wrap.addEventListener("click", e => {
    const btn = e.target.closest(".calendar-month-focus-btn");
    if (!btn) return;
    setCalendarMonthFocusMode(btn.dataset.mode, { persist: true, rerender: true });
  });
}

function loadBreakdownSortMode() {
  try {
    const raw = localStorage.getItem(BREAKDOWN_SORT_KEY);
    return BREAKDOWN_SORT_MODES.has(raw) ? raw : "count";
  } catch {
    return "count";
  }
}

function updateBreakdownSortUI() {
  const select = $("#breakdownSort");
  if (!select) return;
  select.value = state.breakdownSortMode || "count";
}

function setBreakdownSortMode(mode, opts = {}) {
  const { persist = true, rerender = true } = opts;
  if (!BREAKDOWN_SORT_MODES.has(mode)) return;
  state.breakdownSortMode = mode;
  updateBreakdownSortUI();
  if (persist) localStorage.setItem(BREAKDOWN_SORT_KEY, mode);
  if (rerender && state.currentPage === "stats") renderPerformance();
}

function bindBreakdownSort() {
  const select = $("#breakdownSort");
  if (!select) return;
  select.addEventListener("change", () => {
    setBreakdownSortMode(select.value, { persist: true, rerender: true });
  });
}

// ---- 008_boot.js ----
// ---------- Boot ----------

document.addEventListener("DOMContentLoaded", async () => {
  // Charger la config partagee (instruments, strategies...)
  try {
    var cfg = await api("/api/config");
    if (cfg && cfg.instruments) INSTRUMENTS = cfg.instruments;
    if (cfg && cfg.strategies) DEFAULT_STRATEGY_VALUES = cfg.strategies;
    if (cfg && cfg.strategy_labels) STRATEGY_LABELS = cfg.strategy_labels;
    renderInstruments();
    // Cacher le bouton dev restart hors mode DEBUG
    if (cfg && !cfg.debug) {
      var devBtn = document.getElementById("devRestart");
      if (devBtn) devBtn.style.display = "none";
    }
  } catch (_) { /* fallback silencieux sur les valeurs hardcodees */ }

  document.body.setAttribute("data-current-page", state.currentPage || "today");
  state.settings = loadSettingsState();
  state.calendarMetricMode = loadCalendarMetricMode();
  state.journalViewMode = loadJournalViewMode();
  state.journalLayoutMode = loadJournalLayoutMode();
  state.journalRangeMode = loadJournalRangeMode();
  state.journalTradeFilters = loadJournalTradeFilters();
  const tableSort = loadJournalTableSort();
  state.journalTableSortKey = tableSort.key;
  state.journalTableSortDir = tableSort.dir;
  const customRange = loadJournalCustomRange();
  state.journalCustomFrom = customRange.from;
  state.journalCustomTo = customRange.to;
  if (state.journalRangeMode === "custom" && !getJournalCustomWindow()) {
    const def = monthRange(new Date());
    state.journalCustomFrom = def.from;
    state.journalCustomTo = def.to;
    localStorage.setItem(JOURNAL_CUSTOM_RANGE_KEY, JSON.stringify({ from: def.from, to: def.to }));
  }
  state.calendarMonthFocusMode = loadCalendarMonthFocusMode();
  state.breakdownSortMode = loadBreakdownSortMode();
  bindNav();
  bindAiPanelToggle();
  bindCalendarNav();
  bindCalendarMonthPicker();
  bindCalendarMetricToggle();
  bindJournalViewToggle();
  bindJournalLayoutToggle();
  bindJournalRangeToggle();
  bindJournalTradeFilters();
  bindJournalTableSort();
  bindCalendarMonthFocusToggle();
  bindBreakdownSort();
  bindFilter();
  bindModal();
  bindExport();
  bindGlobalKeys();
  bindCmdk();
  bindPills();
  bindTagsInput();
  bindQuality();
  bindRRPreview();
  bindMidnightChallenge();
  initBlocks();
  bindMarkdownToggles();
  bindAutosave();
  bindHashtagSync();
  bindCustomBlocks();
  bindNarration();
  bindSettings();
  bindWizard();
  bindAIChat();
  if (typeof initWidgetBoards === "function") initWidgetBoards();
  else if (typeof initTodayWidgetBoards === "function") initTodayWidgetBoards();
  applySettingsState();
  updateCalendarMetricToggleUI();
  updateJournalViewToggleUI();
  updateJournalLayoutToggleUI();
  updateJournalRangeToggleUI();
  updateJournalTradeFiltersUI();
  updateJournalControlsVisibility();
  updateJournalTableSortUI();
  updateCalendarMonthFocusToggleUI();
  updateBreakdownSortUI();
  setTodayHeader();
  loadAll();
  enhanceSelects(document);

  // Abonnements d'etat — rendent explicites les dependances entre modules.
  // Desormais, modifier state.days ou state._stats met a jour les vues
  // sans que le caller ait a penser au re-rendu.
  onStateChange("days", function () {
    if (state.currentPage === "journal") renderCalendar();
    if (state.currentPage === "today") renderTodayCalendar();
  });
  onStateChange("_stats", function (stats) {
    renderKPIs(stats);
  });
});

// ---- 009_navigation.js ----
// ---------- Navigation ----------

var PAGE_TITLES = {
  today:    "Dashboard — COCKPIT Trading Journal",
  journal:  "Journal — COCKPIT Trading Journal",
  stats:    "Stats — COCKPIT Trading Journal",
  settings: "Settings — COCKPIT Trading Journal",
};

function _updateTitle(pageName) {
  var t = PAGE_TITLES[pageName];
  if (t) document.title = t;
}

var _navDelegationBound = false;

function bindNav() {
  if (!_navDelegationBound) {
    _navDelegationBound = true;
    $("#nav")?.addEventListener("click", function (e) {
      var item = e.target.closest(".nav-item");
      if (!item) return;
      goPage(item.dataset.page);
    });
  }
  $("#newEntryBtn")?.addEventListener("click", function () { wizOpen({ date: todayKey() }); });
  $("#railNewTradeBtn")?.addEventListener("click", function () { wizOpen({ date: todayKey() }); });
  $("#quickAddBtn")?.addEventListener("click", function () { wizOpen({ date: todayKey() }); });
  $("#openCmdk")?.addEventListener("click", function () { openCmdk(); });
}

function goPage(pageName) {
  var targetPage = document.querySelector('.page[data-page="' + pageName + '"]');
  if (!targetPage || state.currentPage === pageName) return;
  state.currentPage = pageName;
  document.body.setAttribute("data-current-page", pageName);
  $$(".nav-item").forEach(function (b) {
    b.classList.toggle("active", b.dataset.page === pageName);
  });
  $$(".page").forEach(function (p) {
    p.classList.toggle("active", p.dataset.page === pageName);
  });
  _updateTitle(pageName);
  if (pageName === "journal") {
    updateCalendarMetricToggleUI();
    updateJournalViewToggleUI();
    updateJournalLayoutToggleUI();
    updateJournalRangeToggleUI();
    updateJournalTradeFiltersUI();
    updateJournalControlsVisibility();
    updateJournalTableSortUI();
    updateCalendarMonthFocusToggleUI();
    loadMonth();
    initJournalFilters();
  }
  if (pageName === "stats")   { updateBreakdownSortUI(); renderPerformance(); }
  if (pageName === "today")   { renderToday(); renderTodayCalendar(); }
  if (pageName === "settings") openSettingsPage();
}

function setTodayHeader() {
  const d = new Date();
  $("#todayDate").textContent =
    `${DAYS_FR[d.getDay()]} ${d.getDate()} ${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`;
}


// ---------- Fin navigation (theme toggle supprime — voir 003 pour la source unique) ----------

// ---- 010_filter.js ----
// ---------- Filter ----------

function bindFilter() {
  $("#instrList").addEventListener("click", (e) => {
    const btn = e.target.closest(".instr-chip");
    if (!btn) return;
    $$(".instr-chip").forEach(c => {
      c.classList.remove("active");
      c.setAttribute("aria-selected", "false");
    });
    btn.classList.add("active");
    btn.setAttribute("aria-selected", "true");
    state.statsInstrument = btn.dataset.instr;
    loadAll();
  });
}

// ---- 011_calendar_nav.js ----
// ---------- Calendar nav ----------

function getJournalCustomWindow() {
  const from = parseDateKey(state.journalCustomFrom);
  const to = parseDateKey(state.journalCustomTo);
  if (!from || !to || from > to) return null;
  return { from, to };
}

function getJournalWindow() {
  if (state.journalViewMode === "week") {
    const start = startOfWeek(state.currentMonth);
    const end = endOfWeek(state.currentMonth);
    return {
      kind: "week",
      from: fmtDateKey(start),
      to: fmtDateKey(end),
      label: `${prettyDateKey(fmtDateKey(start))} - ${prettyDateKey(fmtDateKey(end))}`,
      title: "Semaine",
    };
  }

  if (state.journalRangeMode === "quarter") {
    const q = quarterRange(state.currentMonth);
    return { kind: "quarter", from: q.from, to: q.to, label: q.label, title: "Trimestre" };
  }

  if (state.journalRangeMode === "custom") {
    const custom = getJournalCustomWindow();
    if (custom) {
      const fromKey = fmtDateKey(custom.from);
      const toKey = fmtDateKey(custom.to);
      return {
        kind: "custom",
        from: fromKey,
        to: toKey,
        label: `${prettyDateKey(fromKey)} -> ${prettyDateKey(toKey)}`,
        title: "Custom",
      };
    }
  }

  const m = monthRange(state.currentMonth);
  return { kind: "month", from: m.from, to: m.to, label: m.label, title: "Mois" };
}

function shiftCustomWindow(dir) {
  const custom = getJournalCustomWindow();
  if (!custom) return false;
  const spanDays = Math.max(1, Math.round((custom.to - custom.from) / 86400000) + 1);
  const delta = spanDays * dir;
  const newFrom = shiftDays(custom.from, delta);
  const newTo = shiftDays(custom.to, delta);
  setJournalCustomRange(fmtDateKey(newFrom), fmtDateKey(newTo), { persist: true, reload: false });
  return true;
}

function bindCalendarNav() {
  $("#prevMonth")?.addEventListener("click", () => {
    if (state.journalViewMode === "week") {
      state.currentMonth = shiftDays(state.currentMonth, -7);
    } else if (state.journalRangeMode === "quarter") {
      state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() - 3, state.currentMonth.getDate());
    } else if (state.journalRangeMode === "custom") {
      shiftCustomWindow(-1);
    } else {
      state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() - 1, 1);
    }
    closeMonthPicker();
    loadMonth();
  });
  $("#nextMonth")?.addEventListener("click", () => {
    if (state.journalViewMode === "week") {
      state.currentMonth = shiftDays(state.currentMonth, 7);
    } else if (state.journalRangeMode === "quarter") {
      state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() + 3, state.currentMonth.getDate());
    } else if (state.journalRangeMode === "custom") {
      shiftCustomWindow(1);
    } else {
      state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() + 1, 1);
    }
    closeMonthPicker();
    loadMonth();
  });
  $("#todayJumpBtn")?.addEventListener("click", () => {
    const now = new Date();
    state.currentMonth = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (state.journalRangeMode === "custom") {
      const m = monthRange(now);
      setJournalCustomRange(m.from, m.to, { persist: true, reload: false });
    }
    closeMonthPicker();
    loadMonth();
  });

  $("#journalMonthInput")?.addEventListener("change", (e) => {
    const raw = String(e.target?.value || "");
    if (!/^\d{4}-\d{2}$/.test(raw)) return;
    const [y, m] = raw.split("-").map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return;
    state.currentMonth = new Date(y, m - 1, 1);
    if (state.journalRangeMode === "custom") {
      state.journalRangeMode = "month";
      localStorage.setItem(JOURNAL_RANGE_MODE_KEY, "month");
      updateJournalRangeToggleUI();
      updateJournalControlsVisibility();
    }
    loadMonth();
  });
}

function getMonthPickerYear() {
  const yearEl = $("#monthPickerYear");
  const fallback = state.currentMonth.getFullYear();
  if (!yearEl) return fallback;
  const parsed = Number(yearEl.dataset.year || yearEl.textContent);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function setMonthPickerYear(year) {
  const yearEl = $("#monthPickerYear");
  if (!yearEl) return;
  yearEl.dataset.year = String(year);
  yearEl.textContent = String(year);
  const activeMonth = state.currentMonth.getFullYear() === year ? state.currentMonth.getMonth() : -1;
  const now = new Date();
  const isCurrentYear = now.getFullYear() === year;
  $$("#monthGrid .month-btn").forEach(btn => {
    const m = Number(btn.dataset.month);
    btn.classList.toggle("active", m === activeMonth);
    btn.classList.toggle("current", isCurrentYear && m === now.getMonth());
  });
}

function closeMonthPicker() {
  const pop = $("#monthPopover");
  const wrap = $("#calendarMonthPicker");
  if (pop) pop.classList.add("hidden");
  if (wrap) wrap.classList.remove("open");
}

function openMonthPicker() {
  const pop = $("#monthPopover");
  const wrap = $("#calendarMonthPicker");
  if (!pop || !wrap) return;
  if (wrap.classList.contains("hidden")) return;
  setMonthPickerYear(state.currentMonth.getFullYear());
  pop.classList.remove("hidden");
  wrap.classList.add("open");
}

function bindCalendarMonthPicker() {
  const monthInput = $("#journalMonthInput");
  if (monthInput) return;

  const wrap = $("#calendarMonthPicker");
  const trigger = $("#monthLabelBtn");
  const pop = $("#monthPopover");
  if (!wrap || !trigger || !pop) return;

  trigger.addEventListener("click", e => {
    e.stopPropagation();
    if (pop.classList.contains("hidden")) openMonthPicker();
    else closeMonthPicker();
  });

  $("#monthYearPrev")?.addEventListener("click", e => {
    e.stopPropagation();
    setMonthPickerYear(getMonthPickerYear() - 1);
  });
  $("#monthYearNext")?.addEventListener("click", e => {
    e.stopPropagation();
    setMonthPickerYear(getMonthPickerYear() + 1);
  });

  $("#monthGrid")?.addEventListener("click", e => {
    const btn = e.target.closest(".month-btn");
    if (!btn) return;
    const month = Number(btn.dataset.month);
    if (!Number.isFinite(month)) return;
    state.currentMonth = new Date(getMonthPickerYear(), month, 1);
    closeMonthPicker();
    loadMonth();
  });

  document.addEventListener("click", e => {
    if (pop.classList.contains("hidden")) return;
    if (wrap.contains(e.target)) return;
    closeMonthPicker();
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeMonthPicker();
  });
}

// ---- 012_data_loading.js ----
// ---------- Data loading ----------

/**
 * Charge toutes les donnees (mois, tous les jours, stats) et rend la page courante.
 * Appele au demarrage et apres chaque modification de donnees.
 */
async function loadAll() {
  loading(true);
  try {
    // 1. Mois en priorite — affiche le calendrier + Today tout de suite
    await loadMonth();
    renderToday();
    // 2. Puis le reste en parallele (allDays + stats)
    await Promise.all([
      loadAllDays(),
      loadStats({ refreshDays: false, skipRender: true }),
    ]);
    if (state.currentPage === "today") renderToday();
    if (state._stats) renderKPIs(state._stats);
    if (state.currentPage === "stats") renderPerformance();
  } finally {
    loading(false);
  }
}

/**
 * Charge les jours du mois/periode courant.
 * @returns {Promise<void>}
 */
async function loadMonth() {
  try {
    const windowDef = getJournalWindow();
    const qs = new URLSearchParams();
    if (windowDef.from) qs.set("from", windowDef.from);
    if (windowDef.to) qs.set("to", windowDef.to);
    if (state.statsInstrument !== "ALL") qs.set("instrument", state.statsInstrument);
    state.days = await api(`/api/days?${qs}`);
    renderCalendar(windowDef);
  } catch (e) { toast(e.message, "error"); }
}

/**
 * Charge tous les jours (utilise pour la recherche et la page Today).
 * @returns {Promise<void>}
 */
async function loadAllDays() {
  try {
    const qs = new URLSearchParams();
    if (state.statsInstrument !== "ALL") qs.set("instrument", state.statsInstrument);
    state.allDays = await api(`/api/days?${qs}`);
  } catch (e) { console.error(e); }
}

/**
 * Charge les statistiques depuis /api/stats.
 * @param {Object} [opts]
 * @param {boolean} [opts.refreshDays=true] - Recharger allDays avant les stats
 * @param {boolean} [opts.skipRender=false] - Ne pas mettre a jour les KPIs
 * @returns {Promise<void>}
 */
async function loadStats(opts = {}) {
  const { refreshDays = true, skipRender = false } = opts;
  loading(true);
  try {
    if (refreshDays) await loadAllDays();
    const qs = new URLSearchParams();
    if (state.statsInstrument !== "ALL") qs.set("instrument", state.statsInstrument);
    const s = await api(`/api/stats?${qs}`);
    state._stats = s;
    if (!skipRender) renderKPIs(s);
  } catch (e) { console.error(e); }
  finally { loading(false); }
}

// ---- 013_kpis.js ----
// ---------- KPIs ----------

function getTradesForCurrentFilter() {
  return (state.allDays || []).flatMap(day => day.trades || []);
}

function computeDerivedTodayKPIs(s) {
  const trades = getTradesForCurrentFilter();
  const derivedTrades = trades.map(t => ({ trade: t, metrics: deriveTradeMetrics(t) }));
  const totalPnl = Number(s?.total_pnl ?? derivedTrades.reduce((sum, x) => sum + Number(x.metrics.pnl || 0), 0));
  const numTrades = Number(s?.num_trades ?? trades.length);
  const rrValues = derivedTrades
    .map(x => Number(x.metrics.rr))
    .filter(v => Number.isFinite(v));
  const avgRR = rrValues.length > 0
    ? rrValues.reduce((sum, v) => sum + v, 0) / rrValues.length
    : null;

  let grossGains = 0;
  let grossLossesAbs = 0;
  derivedTrades.forEach(x => {
    const pnl = Number(x.metrics.pnl || 0);
    if (pnl > 0) grossGains += pnl;
    if (pnl < 0) grossLossesAbs += Math.abs(pnl);
  });

  let profitFactor = null;
  if (grossLossesAbs > 0) profitFactor = grossGains / grossLossesAbs;
  else if (grossGains > 0) profitFactor = Infinity;

  const expectancy = numTrades > 0 ? totalPnl / numTrades : null;
  return {
    numTrades,
    totalPnl,
    avgRR,
    rrCount: rrValues.length,
    grossGains,
    grossLossesAbs,
    profitFactor,
    expectancy,
  };
}

function buildLast30PnlSeries() {
  const byDate = {};
  (state.allDays || []).forEach(day => {
    const key = day.date;
    if (!key) return;
    const pnl = (day.trades || []).reduce((sum, t) => sum + Number(t.pnl || 0), 0);
    byDate[key] = (byDate[key] || 0) + pnl;
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out = [];
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = fmtDateKey(d);
    out.push({ date: key, pnl: Number(byDate[key] || 0) });
  }
  return out;
}

function renderPnlSparkline() {
  const line = $("#kpiPnlSparkLine");
  const empty = $("#kpiPnlSparkEmpty");
  if (!line || !empty) return;

  const series = buildLast30PnlSeries();
  const values = series.map(v => v.pnl);
  const hasData = values.some(v => v !== 0);

  if (!hasData) {
    line.setAttribute("points", "");
    line.setAttribute("class", "spark-line flat");
    empty.classList.remove("hidden");
    return;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 180;
  const height = 42;
  const padX = 2;
  const padY = 5;
  const stepX = (width - padX * 2) / Math.max(values.length - 1, 1);

  const points = values.map((v, i) => {
    const x = padX + i * stepX;
    const y = padY + (height - padY * 2) * (1 - (v - min) / range);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  line.setAttribute("points", points);

  const total30 = values.reduce((sum, v) => sum + v, 0);
  const tone = total30 > 0 ? "pos" : total30 < 0 ? "neg" : "flat";
  line.setAttribute("class", `spark-line ${tone}`);
  empty.classList.add("hidden");
}

function renderKPIs(s) {
  const d = computeDerivedTodayKPIs(s);
  const pnlEl = $("#kpiPnl");
  pnlEl.textContent = fmtMoney(d.totalPnl);
  pnlEl.style.color = d.totalPnl >= 0 ? "var(--win)" : "var(--loss)";
  $("#kpiWinrate").textContent = `${(s.winrate || 0).toFixed(1)}%`;
  $("#kpiWins").textContent = `${s.wins}W`;
  $("#kpiLosses").textContent = `${s.losses}L`;
  $("#kpiWinrateBar").style.transform = `scaleX(${Math.min(s.winrate || 0, 100) / 100})`;

  if (d.rrCount > 0) {
    $("#kpiRR").textContent = d.avgRR.toFixed(2);
    $("#kpiRRBar").style.transform = `scaleX(${Math.min((Math.abs(d.avgRR) || 0) / 5 * 100, 100) / 100})`;
  } else {
    $("#kpiRR").textContent = "\u2014";
    $("#kpiRRBar").style.transform = "scaleX(0)";
  }

  const tradesLabel = `${d.numTrades} trade${d.numTrades > 1 ? "s" : ""}`;
  $("#kpiTrades").textContent = d.numTrades > 0 ? `${d.numTrades}` : "\u2014";
  $("#kpiTradesSub").textContent = d.numTrades > 0
    ? `${tradesLabel} \u00B7 ${fmtMoney(d.expectancy)} moyen / trade`
    : "Aucun trade enregistre";

  let pfText = "\u2014";
  if (d.profitFactor === Infinity) pfText = "\u221E";
  else if (Number.isFinite(d.profitFactor)) pfText = d.profitFactor.toFixed(2);
  var pfEl = $("#kpiProfitFactor");
  if (pfEl) pfEl.textContent = pfText;

  var expEl = $("#kpiExpectancy");
  if (expEl) expEl.textContent = d.expectancy == null ? "\u2014" : fmtMoney(d.expectancy);
  var expSubEl = $("#kpiExpectancySub");
  if (expSubEl) expSubEl.textContent = d.numTrades > 0
    ? `${tradesLabel} pris en compte`
    : "$ moyen par trade";

  renderPnlSparkline();
  var streakEl = $("#streakCount");
  if (streakEl) streakEl.textContent = s.streak || 0;

  // Remove skeleton loading state
  document.querySelector('[data-widget-board="today"]')?.classList.remove("loading");
}

// ---- 014_today_page.js ----
// ---------- TODAY page ----------

function renderToday() {
  renderTodayCalendar();
  renderTodayContextWidget();
  const today   = todayKey();
  const todayList = state.allDays.filter(d => d.date === today);
  const recent    = state.allDays.filter(d => d.date !== today).slice(0, 6);

  const todayEl = $("#todayEntries");
  todayEl.innerHTML = "";
  if (todayList.length === 0) {
    todayEl.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <div>Aucune entrée pour aujourd'hui.</div>
      <div class="empty-cta" id="emptyTodayCta"></div></div>`;
    var cta = document.getElementById("emptyTodayCta");
    if (cta) {
      var btn = document.createElement("button");
      btn.className = "btn-ghost";
      btn.textContent = "Nouvelle entree";
      btn.addEventListener("click", function () { wizOpen({ date: todayKey() }); });
      cta.appendChild(btn);
    }
  } else {
    todayList.forEach(d => todayEl.appendChild(dayCardEl(d)));
  }

  const recentEl = $("#recentEntries");
  if (recentEl) {
    recentEl.innerHTML = "";
    if (recent.length === 0) {
      recentEl.innerHTML = '<div class="empty-state"><div>Pas encore d\'historique</div></div>';
    } else {
      recent.forEach(d => recentEl.appendChild(dayCardEl(d)));
    }
  }
}

function findTodayContextDay() {
  const tk = todayKey();
  const sources = []
    .concat(Array.isArray(state.allDays) ? state.allDays : [])
    .concat(Array.isArray(state.days) ? state.days : []);
  return sources.find(d => d && d.date === tk) || null;
}

function renderTodayContextWidget(force) {
  const form = $("#dayForm");
  if (!form) return;
  if (!force && form.contains(document.activeElement)) return;

  const tk = todayKey();
  const day = findTodayContextDay();
  $("#dayId").value = day?.id || "";
  $("#entryDate").value = day?.date || tk;
  $("#entryInstrument").value = day?.instrument || _lastInstrument();
  syncTodayContextSelectUI();
  $("#htfContext").value = day?.htf_context || "";
  $("#dailyNotes").value = day?.daily_notes || "";
  setPill("htf_bias", day?.htf_bias || null);
  state.initialDayPayload = buildDayPayload();
  state.initialDayState = snapshotDayForm();
}

function syncTodayContextSelectUI() {
  const select = $("#entryInstrument");
  if (!select) return;
  const wrap = select.closest(".select-wrapper");
  const trigger = wrap?.querySelector(".custom-select-trigger");
  const dropdown = wrap?.querySelector(".custom-select-dropdown");
  if (trigger) {
    const label = trigger.querySelector(".trigger-label");
    if (label) label.textContent = select.options[select.selectedIndex]?.textContent || select.value || "\u2014";
  }
  if (dropdown) {
    dropdown.querySelectorAll(".custom-select-item").forEach(function (el) {
      const selected = el.dataset.value === select.value;
      el.classList.toggle("selected", selected);
      el.setAttribute("aria-selected", selected ? "true" : "false");
    });
  }
}

function dayCardEl(day) {
  const card = document.createElement("div");
  card.className = "entry-card";
  card.dataset.instr = day.instrument;

  const trades = day.trades || [];
  const derived = trades.map(t => deriveTradeMetrics(t));
  const totalPnl = derived.reduce((sum, m) => sum + Number(m.pnl || 0), 0);
  const wins = derived.filter(m => m.isWin === 1).length;
  const losses = derived.filter(m => m.isWin === 0).length;
  const pnlClass = totalPnl > 0 ? "pos" : totalPnl < 0 ? "neg" : "";

  const strategies = [...new Set(trades.map(t => t.strategy).filter(Boolean))];
  const stratChips = strategies.map(s =>
    `<span class="tag">${escapeHtml(prettify(s))}</span>`
  ).join("");

  const firstTrade = trades[0];
  const title = firstTrade?.why_trade?.trim()
    || firstTrade?.scenario?.trim()
    || (strategies[0] ? prettify(strategies[0]) : "")
    || `Journee ${day.date}`;

  let resultClass = "neutral";
  let resultLabel = "\u2014";
  if (wins > 0 && losses === 0) {
    resultClass = "win";
    resultLabel = `W ${wins}`;
  } else if (losses > 0 && wins === 0) {
    resultClass = "loss";
    resultLabel = `L ${losses}`;
  } else if (wins > 0 && losses > 0) {
    resultClass = "mixed";
    resultLabel = `${wins}W/${losses}L`;
  }

  card.innerHTML = `
    <div class="entry-instr">${day.instrument}</div>
    <div class="entry-meta">
      <div class="entry-title">${escapeHtml(title.slice(0, 80))}</div>
      <div class="entry-tags">
        ${day.date !== todayKey() ? `<span class="tag">${day.date}</span>` : ""}
        ${stratChips}
        ${trades.length > 0 ? `<span class="tag">${trades.length} trade${trades.length > 1 ? "s" : ""}</span>` : ""}
      </div>
    </div>
    <div class="entry-outcome">
      <span class="entry-result-chip ${resultClass}">${resultLabel}</span>
      <div class="entry-pnl ${pnlClass}">${fmtMoney(totalPnl)}</div>
    </div>
  `;
  card.addEventListener("click", () => openExistingDay(day));
  return card;
}

// ---- 015_calendar.js ----
// ---------- Calendar ----------

let _calendarByDayCache = {};
let _calendarGridBound = false;
let _calWasAutoTable = false;

function bindCalendarGridActions(grid) {
  if (!grid || _calendarGridBound) return;
  grid.addEventListener("click", (e) => {
    const dayEl = e.target.closest(".day");
    if (!dayEl || !grid.contains(dayEl)) return;
    if (dayEl.dataset.otherMonth === "1") return;
    const key = dayEl.dataset.date;
    if (!key) return;
    const info = _calendarByDayCache[key];
    if (!info || !Array.isArray(info.days) || info.days.length === 0) {
      if (typeof closeJournalDayTrades === "function") closeJournalDayTrades();
      wizOpen({ date: key });
      return;
    }

    const tradeCount = info.days.reduce((sum, day) => sum + ((day.trades || []).length), 0);
    if (tradeCount > 0 && typeof renderJournalDayTrades === "function") {
      renderJournalDayTrades(key, info.days);
      return;
    }

    if (info.days.length === 1) {
      if (typeof closeJournalDayTrades === "function") closeJournalDayTrades();
      openExistingDay(info.days[0]);
      return;
    }
    if (typeof closeJournalDayTrades === "function") closeJournalDayTrades();
    openPickerForDate(key, info.days);
  });
  _calendarGridBound = true;
}

function renderCalendar(windowDef = null) {
  const win = windowDef || getJournalWindow();
  updateJournalTradeFilterOptions(state.days);
  if (typeof updateJournalStatsDisplay === "function") updateJournalStatsDisplay();

  // Auto-switch: table si range > 35 jours (sauf si utilisateur a explicitement choisi)
  var from = parseDateKey(win.from);
  var to = parseDateKey(win.to);
  var spanDays = from && to ? Math.round((to - from) / 86400000) + 1 : 0;
  if (spanDays > 35 && !state._journalLayoutExplicit) {
    if (state.journalLayoutMode !== "table") {
      setJournalLayoutMode("table", { persist: false, rerender: false });
      if (typeof toast === "function") toast("Vue table activee pour les periodes > 35 jours", "info");
    }
    _calWasAutoTable = true;
  } else if (_calWasAutoTable) {
    setJournalLayoutMode("calendar", { persist: false, rerender: false });
    _calWasAutoTable = false;
  }

  updateJournalTradeFiltersUI();
  const byDay = buildCalendarByDay(state.days);

  const monthLabelEl = $("#monthLabel");
  if (monthLabelEl) monthLabelEl.textContent = state.journalViewMode === "month" ? win.label : `${win.title} · ${win.label}`;
  const monthInputEl = $("#journalMonthInput");
  if (monthInputEl) {
    monthInputEl.value = `${state.currentMonth.getFullYear()}-${String(state.currentMonth.getMonth() + 1).padStart(2, "0")}`;
  }

  const prevBtn = $("#prevMonth");
  const nextBtn = $("#nextMonth");
  if (prevBtn) prevBtn.title = state.journalViewMode === "week" ? "Semaine précédente" : "Période précédente";
  if (nextBtn) nextBtn.title = state.journalViewMode === "week" ? "Semaine suivante" : "Période suivante";

  const grid = $("#calendarGrid");
  if (!grid) return;
  bindCalendarGridActions(grid);
  _calendarByDayCache = byDay;
  grid.dataset.metricMode = state.calendarMetricMode || "pnl";
  grid.dataset.viewMode = state.journalViewMode || "month";
  const tk = todayKey();
  const fragment = document.createDocumentFragment();

  if (state.journalViewMode === "week") {
    const weekStart = parseDateKey(win.from) || startOfWeek(state.currentMonth);
    for (let i = 0; i < 7; i += 1) {
      fragment.appendChild(dayCell(shiftDays(weekStart, i), byDay, false, tk));
    }
  } else if (state.journalRangeMode === "custom") {
    const cursor = parseDateKey(win.from);
    const end = parseDateKey(win.to);
    let c = cursor;
    while (c <= end) {
      fragment.appendChild(dayCell(c, byDay, false, tk));
      c = shiftDays(c, 1);
    }
  } else {
    const ref   = state.currentMonth;
    const year  = ref.getFullYear();
    const month = ref.getMonth();
    const first         = new Date(year, month, 1);
    const firstDayIndex = (first.getDay() + 6) % 7;
    const daysInMonth   = new Date(year, month + 1, 0).getDate();
    const daysInPrev    = new Date(year, month, 0).getDate();

    for (let i = firstDayIndex; i > 0; i -= 1) {
      fragment.appendChild(dayCell(new Date(year, month - 1, daysInPrev - i + 1), byDay, true, tk));
    }
    for (let d = 1; d <= daysInMonth; d += 1) {
      fragment.appendChild(dayCell(new Date(year, month, d), byDay, false, tk));
    }
    const trailing = (7 - ((firstDayIndex + daysInMonth) % 7)) % 7;
    for (let d = 1; d <= trailing; d += 1) {
      fragment.appendChild(dayCell(new Date(year, month + 1, d), byDay, true, tk));
    }
  }
  grid.replaceChildren(fragment);

  const totalCells = grid.children.length;
  const rows = Math.max(1, Math.ceil(totalCells / 7));
  grid.style.setProperty("--journal-rows", String(rows));

  renderCalendarMonthFocus(byDay, win);
  renderJournalTable();
}

function computeMonthFocusData(byDay = null) {
  const dataset = byDay || {};
  const days = Object.values(dataset);
  let trades = 0;
  let wins = 0;
  let losses = 0;
  let pnl = 0;

  days.forEach(dayInfo => {
    trades += Number(dayInfo?.trades || 0);
    wins += Number(dayInfo?.wins || 0);
    losses += Number(dayInfo?.losses || 0);
    pnl += Number(dayInfo?.pnl || 0);
  });

  const decided = wins + losses;
  const winrate = decided > 0 ? (wins / decided) * 100 : null;
  const avgPnlPerTrade = trades > 0 ? pnl / trades : null;
  return { trades, wins, losses, pnl, decided, winrate, avgPnlPerTrade };
}

function renderJournalHeaderStats(data) {
  var wrEl       = $("#jhsWr");
  var pnlEl      = $("#jhsPnl");
  var trEl       = $("#jhsTr");
  var avgEl      = $("#jhsAvg");
  var wrInline   = $("#jhsWrInline");
  var pnlInline  = $("#jhsPnlInline");
  if (!wrEl) return;

  if (!data || data.trades === 0) {
    wrEl.textContent  = "WR --";
    wrEl.className    = "stat";
    pnlEl.textContent = "PnL --";
    pnlEl.className   = "stat";
    trEl.textContent  = "TR --";
    avgEl.textContent = "Moy --";
    if (wrInline)  { wrInline.textContent = "--";  wrInline.className  = "journal-filter-stat-value"; }
    if (pnlInline) { pnlInline.textContent = "--"; pnlInline.className = "journal-filter-stat-value"; }
    return;
  }

  var wrText  = data.winrate == null ? "--" : data.winrate.toFixed(1) + "%";
  var pnlText = fmtMoney(data.pnl);
  var trText  = String(data.trades);
  var avgText = data.avgPnlPerTrade == null ? "--" : fmtMoney(data.avgPnlPerTrade);

  wrEl.textContent  = "WR " + wrText;
  wrEl.className    = "stat" + (data.winrate >= 50 ? " pos" : data.winrate != null ? " neg" : "");
  pnlEl.textContent = "PnL " + pnlText;
  pnlEl.className   = "stat" + (data.pnl > 0 ? " pos" : data.pnl < 0 ? " neg" : "");
  trEl.textContent  = "TR " + trText;
  trEl.className    = "stat";
  avgEl.textContent = "Moy " + avgText;
  avgEl.className   = "stat";

  if (wrInline) {
    wrInline.textContent = wrText;
    wrInline.className   = "journal-filter-stat-value" + (data.winrate != null && data.winrate >= 50 ? " pos" : data.winrate != null ? " neg" : "");
  }
  if (pnlInline) {
    pnlInline.textContent = pnlText;
    pnlInline.className   = "journal-filter-stat-value" + (data.pnl > 0 ? " pos" : data.pnl < 0 ? " neg" : "");
  }
}

function renderCalendarMonthFocus(byDay, windowDef) {
  var data = computeMonthFocusData(byDay);
  renderJournalHeaderStats(data);
}

function dayCell(dt, byDay, otherMonth, today) {
  const key  = fmtDateKey(dt);
  const info = byDay[key];
  const mode = state.calendarMetricMode || "pnl";
  const el   = document.createElement("div");
  el.dataset.date = key;
  el.dataset.otherMonth = otherMonth ? "1" : "0";
  el.className = "day" + (otherMonth ? " other-month" : "") + (key === today ? " today" : "");
  el.classList.add(`day-mode-${mode}`);
  if (info) {
    if (info.pnl > 0) el.classList.add("win");
    else if (info.pnl < 0) el.classList.add("loss");
  }

  let metricHtml = `<div class="day-center day-center-empty"></div>`;

  if (info) {
    const pnlClass = info.pnl > 0 ? "pos" : info.pnl < 0 ? "neg" : "flat";
    if (mode === "pnl") {
      metricHtml = `
        <div class="day-center mode-pnl">
          <div class="day-metric day-metric-pnl ${pnlClass}">${fmtMoney(info.pnl)}</div>
        </div>`;
    } else if (mode === "trades") {
      const tradeWord = info.trades > 1 ? "trades" : "trade";
      const executedWord = info.trades > 1 ? "ex\u00E9cut\u00E9s" : "ex\u00E9cut\u00E9";
      metricHtml = `
        <div class="day-center mode-trades">
          <div class="day-metric day-metric-trades">${info.trades}</div>
          <div class="day-metric-sub">${tradeWord} ${executedWord}</div>
        </div>`;
    } else {
      metricHtml = `
        <div class="day-center mode-both">
          <div class="day-metric day-metric-pnl ${pnlClass}">${fmtMoney(info.pnl)}</div>
          <div class="day-metric-sub">${info.trades} position</div>
        </div>`;
    }
  }
  let stackHtml = "";
  if (info && info.days?.length > 1) {
    stackHtml = `<div class="day-stack-indicator" title="Plusieurs instruments ce jour">${info.days.length} inst</div>`;
  } else if (info && Number(info.trades || 0) > 1) {
    stackHtml = `<div class="day-stack-indicator trades" title="Plusieurs trades ce jour">${info.trades}T</div>`;
  }

  let dotsHtml = "";
  if (info && (info.wins || info.losses)) {
    const winDots = Math.min(info.wins || 0, 5);
    const lossDots = Math.min(info.losses || 0, 5);
    let spans = "";
    for (let i = 0; i < winDots; i++) spans += '<span class="day-dot win"></span>';
    for (let i = 0; i < lossDots; i++) spans += '<span class="day-dot loss"></span>';
    if (spans) dotsHtml = `<div class="day-dots">${spans}</div>`;
  }
  el.innerHTML = `<div class="day-num">${dt.getDate()}</div>${metricHtml}${stackHtml}${dotsHtml}`;
  return el;
}

// ---- 016_openpickerfordate.js ----
var _dayPickerEscHandler = null;
var _dayPickerDays = null;

function openPickerForDate(dateKey, days) {
  closeDayPicker();
  var safeDays = (days || []).slice().sort((a, b) => String(a.instrument || "").localeCompare(String(b.instrument || "")));
  _dayPickerDays = safeDays;
  if (safeDays.length === 0) {
    wizOpen({ date: dateKey });
    return;
  }

  var overlay = document.createElement("div");
  overlay.className = "day-picker-overlay";
  overlay.id = "dayPickerOverlay";

  var itemHtml = safeDays.map(function (day, idx) {
    var trades = day.trades || [];
    var pnl = trades.reduce(function (sum, t) { return sum + Number(deriveTradeMetrics(t).pnl || 0); }, 0);
    return `
      <button type="button" class="day-picker-item" data-idx="${idx}">
        <span class="day-picker-main">${escapeHtml(wizInstrumentLabel(day.instrument))}</span>
        <span class="day-picker-sub">${trades.length} trade${trades.length > 1 ? "s" : ""} - ${fmtMoney(pnl)}</span>
      </button>
    `;
  }).join("");

  overlay.innerHTML = `
    <div class="day-picker-backdrop"></div>
    <div class="day-picker-panel" role="dialog" aria-modal="true" aria-label="Selection du jour">
      <div class="day-picker-head">
        <div class="day-picker-title">${escapeHtml(dateKey)}</div>
        <button type="button" class="day-picker-close" aria-label="Fermer">x</button>
      </div>
      <div class="day-picker-list">${itemHtml}</div>
    </div>
  `;

  var onEsc = function (e) {
    if (e.key === "Escape") close();
  };
  var close = function () {
    closeDayPicker();
  };

  overlay.querySelector(".day-picker-backdrop")?.addEventListener("click", close);
  overlay.querySelector(".day-picker-close")?.addEventListener("click", close);
  overlay.querySelector(".day-picker-list")?.addEventListener("click", function (e) {
    var btn = e.target.closest(".day-picker-item");
    if (!btn) return;
    var idx = Number(btn.dataset.idx);
    close();
    openExistingDay(_dayPickerDays[idx]);
  });

  _dayPickerEscHandler = onEsc;
  document.addEventListener("keydown", onEsc);
  document.body.appendChild(overlay);
}

function closeDayPicker() {
  if (_dayPickerEscHandler) {
    document.removeEventListener("keydown", _dayPickerEscHandler);
    _dayPickerEscHandler = null;
  }
  document.getElementById("dayPickerOverlay")?.remove();
}

// ---- 017_modal_gestion_globale.js ----
// ---------- Modal : gestion globale ----------

var _lastFocused = null; // element qui a ouvert la modale (pour restauration)
var _modalScrollPerfTimer = null;

function bindModalScrollPerf() {
  const modal = $("#entryModal");
  const scroller = modal?.querySelector(".modal-scroll");
  if (!modal || !scroller || scroller.dataset.perfBound === "1") return;

  const markScrolling = () => {
    modal.classList.add("is-scrolling");
    if (_modalScrollPerfTimer) clearTimeout(_modalScrollPerfTimer);
    _modalScrollPerfTimer = setTimeout(() => {
      modal.classList.remove("is-scrolling");
      _modalScrollPerfTimer = null;
    }, 120);
  };

  scroller.addEventListener("scroll", markScrolling, { passive: true });
  scroller.addEventListener("wheel", markScrolling, { passive: true });
  scroller.addEventListener("touchmove", markScrolling, { passive: true });
  scroller.dataset.perfBound = "1";
}

function sanitizeEntryModalSticky() {
  const modal = $("#entryModal");
  if (!modal) return;
  const body = modal.querySelector(".modal-body");
  const scroll = modal.querySelector(".modal-scroll");
  const sticky = modal.querySelector(".modal-sticky");
  if (!sticky) return;

  // Ne garder dans la zone sticky que le panel narration et le header des trades.
  const keep = new Set(["narrationPanel", "tradesSectionHeader"]);
  [...sticky.children].forEach((node) => {
    if (!keep.has(node.id)) node.remove();
  });

  // Defense en profondeur: supprimer toute section trades dupliquee hors zone scroll.
  const keepFirst = (selector) => {
    const nodes = [...modal.querySelectorAll(selector)];
    nodes.slice(1).forEach((n) => n.remove());
  };
  keepFirst(".trades-section-header");
  keepFirst("#tradesList");
  keepFirst("#tradeFormSection");
  keepFirst("#addTradeBtn");

  modal.querySelectorAll(".trades-section-header, #tradesList, #tradeFormSection, #addTradeBtn")
    .forEach((node) => { if (!scroll && !sticky || (scroll && !scroll.contains(node) && sticky && !sticky.contains(node))) node.remove(); });

  // Nettoie aussi les anciens footers (version legacy) si presents.
  if (body) {
    body.querySelectorAll("button").forEach((btn) => {
      const label = (btn.textContent || "").trim().toLowerCase();
      const isHeaderClose = !!btn.closest(".modal-header");
      const isTradeFormAction = !!btn.closest("#tradeFormSection");
      if (isHeaderClose || isTradeFormAction) return;
      if (label === "fermer" || label.includes("supprimer le jour") || label.includes("supprimer ce jour")) {
        btn.remove();
      }
    });
  }
}

function setModalTradeFocus(enabled) {
  const modal = $("#entryModal");
  if (!modal) return;
  modal.classList.toggle("modal-trade-focus", !!enabled);
}

/**
 * Piege le focus clavier a l interieur d un conteneur.
 * Appele sur keydown du document quand la modale est ouverte.
 */
function _trapFocus(e, containerId) {
  var container = document.getElementById(containerId);
  if (!container || container.classList.contains("hidden")) return;
  var focusable = container.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
  if (focusable.length === 0) return;
  var first = focusable[0];
  var last  = focusable[focusable.length - 1];
  if (e.key === "Tab") {
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

function bindModal() {
  sanitizeEntryModalSticky();
  bindModalScrollPerf();

  // Focus trap quand la modale est ouverte
  document.addEventListener("keydown", function (e) {
    if (e.key === "Tab") _trapFocus(e, "entryModal");
  });

  // Délégation : un seul listener pour tous les [data-close]
  $("#entryModal")?.addEventListener("click", function(e) {
    if (e.target.closest("[data-close]")) closeModal();
  });
  // Delete day
  $("#deleteBtn")?.addEventListener("click", deleteDay);
  // Add trade button
  $("#addTradeBtn")?.addEventListener("click", () => openTradeForm(null));
  // Trade form
  $("#tradeForm")?.addEventListener("submit", submitTrade);
  $("#deleteTradeBtn")?.addEventListener("click", deleteTrade);
  $("#cancelTradeBtn")?.addEventListener("click", closeTradeForm);
  $("#closeTradeFormBtn")?.addEventListener("click", closeTradeForm);
  // Screenshots
  const zone  = $("#uploadZone");
  const input = $("#fileInput");
  if (zone && input) {
    zone.addEventListener("click", () => input.click());
    input.addEventListener("change", e => handleFiles(e.target.files));
    ["dragenter","dragover"].forEach(ev =>
      zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add("dragover"); }));
    ["dragleave","drop"].forEach(ev =>
      zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove("dragover"); }));
    zone.addEventListener("drop", e => handleFiles(e.dataTransfer.files));
  }
  // Paste screenshot (Ctrl+V) anywhere in the trade wizard
  window.addEventListener("paste", onClipboardImagePaste, true);
  // Lightbox
  $("#lightbox")?.addEventListener("click", function () {
    $("#lightbox").classList.add("hidden");
    if (_lastFocused) { _lastFocused.focus(); _lastFocused = null; }
  });
}

function openNewDay(dateKey) {
  _lastFocused = document.activeElement; // memoriser l'element qui a ouvert
  sanitizeEntryModalSticky();
  setModalTradeFocus(false);
  closeDayPicker();
  state.currentDayId   = null;
  state.currentTradeId = null;
  state.isSavingDay    = false;
  state.isSavingTrade  = false;
  state.modalDataDirty = false;

  resetDayForm();
  resetTradeForm();
  closeTradeFormUI();

  $("#dayId").value           = "";
  $("#entryDate").value       = dateKey;
  $("#entryInstrument").value = _lastInstrument();
  $("#modalTitle").textContent = "Nouvelle journee";
  $("#deleteBtn")?.classList.add("hidden");
  $("#tradesList").innerHTML = "";
  var _addBtn = $("#addTradeBtn");
  if (_addBtn) { _addBtn.disabled = false; _addBtn.title = ""; }

  state.initialDayPayload = buildDayPayload();
  state.initialDayState = snapshotDayForm();
  $("#entryModal").classList.remove("hidden");
  if (typeof syncDayContextMidnightVisibility === "function") syncDayContextMidnightVisibility();
  setTimeout(() => { enhanceSelects($("#entryModal")); }, 0);
}

function openExistingDay(day) {
  sanitizeEntryModalSticky();
  setModalTradeFocus(false);
  closeDayPicker();
  state.currentDayId   = day.id;
  state.currentTradeId = null;
  state.isSavingDay    = false;
  state.isSavingTrade  = false;
  state.modalDataDirty = false;

  resetDayForm();
  resetTradeForm();
  closeTradeFormUI();

  // Remplir le formulaire du jour
  $("#dayId").value     = day.id;
  $("#entryDate").value = day.date;
  $("#entryInstrument").value = day.instrument;
  $("#htfContext").value    = day.htf_context  ?? "";
  $("#dailyNotes").value    = day.daily_notes   ?? "";
  setPill("htf_bias", day.htf_bias);

  $("#modalTitle").textContent = `${day.instrument} - ${day.date}`;
  $("#deleteBtn")?.classList.remove("hidden");
  var _ab2 = $("#addTradeBtn");
  if (_ab2) _ab2.disabled = false;

  renderTradesList(day.trades || []);

  state.initialDayPayload = buildDayPayload();
  state.initialDayState = snapshotDayForm();
  $("#entryModal").classList.remove("hidden");
  if (typeof syncDayContextMidnightVisibility === "function") syncDayContextMidnightVisibility();
  setTimeout(() => { enhanceSelects($("#entryModal")); }, 0);
}

async function closeModal() {
  if (state.isSavingDay || state.isSavingTrade) return;
  // Autosave du jour si modifie
  if (dayFormChanged() && $("#dayId").value) {
    await saveDayContext(false);
  }
  closeModalDirect();
}

function closeModalDirect() {
  closeDayPicker();
  setModalTradeFocus(false);
  $("#entryModal").classList.add("hidden");
  const shouldRefresh = !!state.modalDataDirty;
  state.currentDayId   = null;
  state.currentTradeId = null;
  state.isSavingDay    = false;
  state.isSavingTrade  = false;
  state.modalDataDirty = false;
  state.initialDayState = null;
  state.initialDayPayload = null;
  // Restaurer le focus sur l'element qui a ouvert la modale
  if (_lastFocused) { _lastFocused.focus(); _lastFocused = null; }
  if (shouldRefresh) {
    document.dispatchEvent(new CustomEvent("trade:saved"));
    loadAll();
  } else if (typeof renderTodayContextWidget === "function") {
    renderTodayContextWidget(true);
  }
}

// ---- 018_day_form.js ----
// ---------- Day form ----------

  function resetDayForm() {
    $("#dayForm").reset();
    $$(".pills[data-pills='htf_bias'] .pill-choice").forEach(p => p.classList.remove("active"));
    setAutosaveState("idle");
}

function buildDayPayload() {
  return {
    date:         $("#entryDate").value,
    instrument:   $("#entryInstrument").value,
    htf_bias:     getPill("htf_bias"),
    htf_context:  $("#htfContext").value || null,
    daily_notes:  $("#dailyNotes").value || null,
  };
}

function dayPayloadEquals(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

function dayPayloadDiff(prev, next) {
  const base = prev || {};
  const cur = next || {};
  const diff = {};
  Object.keys(cur).forEach((k) => {
    const pv = base[k] ?? null;
    const nv = cur[k] ?? null;
    if (pv !== nv) diff[k] = cur[k];
  });
  return diff;
}

function snapshotDayForm() { return JSON.stringify(buildDayPayload()); }
function dayFormChanged()   {
  if (!state.initialDayPayload) return false;
  return !dayPayloadEquals(buildDayPayload(), state.initialDayPayload);
}

function activeDayFormId() {
  return state.currentDayId || $("#dayId")?.value || null;
}

function _dayFieldGlow(fields) {
  if (!fields || !Object.keys(fields).length) return;
  var map = {
    date:        '.day-inline-date',
    instrument:  '.day-inline-instrument',
    htf_bias:    '.today-context-bias .pills',
    htf_context: '#htfContext',
    daily_notes: '#dailyNotes',
  };
  Object.keys(fields).forEach(function (key) {
    var sel = map[key];
    if (!sel) return;
    var el = document.querySelector(sel);
    if (!el) return;
    el.classList.add('day-field-glow');
    setTimeout(function () { el.classList.remove('day-field-glow'); }, 1000);
  });
}

async function saveDayContext(isNew) {
  if (state.isSavingDay) return null;
  state.isSavingDay = true;
  setAutosaveState("saving");
  const fullPayload = buildDayPayload();
  const activeId = activeDayFormId();
  const isCreate = isNew || !activeId;
  let payload = fullPayload;
  let changedFields = null;
  if (!isCreate) {
    payload = dayPayloadDiff(state.initialDayPayload, fullPayload);
    changedFields = Object.keys(payload);
    if (Object.keys(payload).length === 0) {
      setAutosaveState("idle");
      return null;
    }
  }
  try {
    let saved;
    if (isCreate) {
      saved = await api("/api/days", { method: "POST", body: JSON.stringify(payload) });
      state.currentDayId = saved.id;
      $("#dayId").value  = saved.id;
      $("#deleteBtn")?.classList.remove("hidden");
      var _ab = $("#addTradeBtn");
      if (_ab) { _ab.disabled = false; _ab.title = ""; }
      $("#modalTitle").textContent = `${saved.instrument} - ${saved.date}`;
      // Pour une création, tous les champs sont "changés"
      changedFields = Object.keys(fullPayload).filter(function(k) { return fullPayload[k] != null && fullPayload[k] !== ''; });
    } else {
      saved = await api(`/api/days/${activeId}`,
        { method: "PUT", body: JSON.stringify(payload) });
      if (payload.date || payload.instrument) {
        const curDate = $("#entryDate").value;
        const curInstr = $("#entryInstrument").value;
        $("#modalTitle").textContent = `${curInstr} - ${curDate}`;
      }
    }
    state.modalDataDirty = true;
    // Mutation locale + re-render si update simple (pas de changement date/instrument)
    if (!isCreate && !payload.date && !payload.instrument) {
      // Patcher localement state.days pour eviter un loadAll()
      if (state.days) {
        for (var _i = 0; _i < state.days.length; _i++) {
          if (state.days[_i].id === (saved && saved.id != null ? saved.id : activeId)) {
            Object.assign(state.days[_i], saved || payload);
            break;
          }
        }
      }
      if (state.currentPage === "today" && typeof renderToday === "function") renderToday();
      if (state._stats && typeof renderKPIs === "function") renderKPIs(state._stats);
    } else {
      // Changement structurel (create, date, instrument) -> rechargement complet
      if (typeof loadAll === "function") {
        setTimeout(loadAll, 100);
      }
    }
    state.initialDayPayload = buildDayPayload();
    state.initialDayState = snapshotDayForm();
    setAutosaveState("saved");
    // Glow sur les champs modifiés
    if (changedFields && changedFields.length) {
      var glowFields = {};
      changedFields.forEach(function(k) { glowFields[k] = true; });
      _dayFieldGlow(glowFields);
    }
    setTimeout(() => { if (_autosaveState === "saved") setAutosaveState("idle"); }, 2200);
    return saved;
  } catch (err) {
    setAutosaveState("error", err.message?.slice(0,30) || "Erreur");
    // Rouge persistant sur les champs modifiés
    if (changedFields && changedFields.length) {
      var errFields = {};
      changedFields.forEach(function(k) { errFields[k] = true; });
      Object.keys(errFields).forEach(function (key) {
        var sel = {date:'.day-inline-date',instrument:'.day-inline-instrument',htf_bias:'.today-context-bias .pills',htf_context:'#htfContext',daily_notes:'#dailyNotes'}[key];
        if (!sel) return;
        var el = document.querySelector(sel);
        if (el) el.classList.add('day-field-error');
      });
    }
    toast(err.message, "error");
    return null;
  } finally {
    state.isSavingDay = false;
  }
}

async function deleteDay() {
  if (!state.currentDayId) return;
  const tradesCount = (state.allDays.find(d => d.id === state.currentDayId)?.trades || []).length;
  const msg = tradesCount > 0
    ? `Supprimer ce jour ET ses ${tradesCount} trade(s) ?`
    : "Supprimer ce jour ?";
  if (!confirm(msg)) return;
  try {
    await api(`/api/days/${state.currentDayId}`, { method: "DELETE" });
    state.modalDataDirty = true;
    toast("Journée supprimée", "success");
    closeModalDirect();
  } catch (err) { toast(err.message, "error"); }
}

// ---- 018_plan_engine.js ----
// ---------- Plan / PO3 engine ----------

const PLAN_ERROR_LABELS = {
  counter_direction: "Direction opposee au plan PO3",
  invalid_zone: "Zone Premium/Discount incoherente",
  po3_invalid: "PO3 invalide",
};

const PLAN_WARNING_LABELS = {
  plan_incomplete: "Plan PO3 incomplet",
  po3_partial: "PO3 partiel",
  smt_missing: "SMT absente",
  smt_inconsistent: "SMT incoherente",
  liquidity_inconsistent: "Cible de liquidite incoherente",
  counter_thesis_missing: "Contre-these absente",
};

function po3PlanDirection(openBehavior) {
  if (openBehavior === "rise") return "short";
  if (openBehavior === "drop") return "long";
  return null;
}

function _dedupePlanItems(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function evaluateMidnightPlan(input) {
  const coach = input?.coach || {};
  const direction = String(input?.direction || "").toLowerCase();
  const openBehavior = String(coach.open_behavior || "").toLowerCase();
  const po3State = String(coach.po3_state || "").toLowerCase();
  const zoneRule = String(coach.zone_rule || "").toLowerCase();
  const smtState = String(coach.smt_state || "").toLowerCase();
  const liquidityTarget = String(coach.liquidity_target || "").toLowerCase();
  const counterThesis = String(coach.counter_thesis || "").trim();
  const planDirection = po3PlanDirection(openBehavior);
  const errors = [];
  const warnings = [];

  if (!planDirection) warnings.push("plan_incomplete");
  else if (direction && direction !== planDirection) errors.push("counter_direction");
  else if (!direction) warnings.push("plan_incomplete");

  if (po3State === "no") errors.push("po3_invalid");
  else if (po3State === "partial") warnings.push("po3_partial");
  else if (!po3State) warnings.push("plan_incomplete");

  const effectiveDirection = direction || planDirection;
  if (zoneRule === "invalid") errors.push("invalid_zone");
  else if (effectiveDirection === "long" && zoneRule && zoneRule !== "discount") errors.push("invalid_zone");
  else if (effectiveDirection === "short" && zoneRule && zoneRule !== "premium") errors.push("invalid_zone");
  else if (!zoneRule) warnings.push("plan_incomplete");

  if (!smtState || smtState === "none") warnings.push("smt_missing");
  else if (effectiveDirection === "long" && smtState !== "bullish") warnings.push("smt_inconsistent");
  else if (effectiveDirection === "short" && smtState !== "bearish") warnings.push("smt_inconsistent");

  if (effectiveDirection === "long" && liquidityTarget && !["above", "both"].includes(liquidityTarget)) warnings.push("liquidity_inconsistent");
  else if (effectiveDirection === "short" && liquidityTarget && !["below", "both"].includes(liquidityTarget)) warnings.push("liquidity_inconsistent");
  else if (!liquidityTarget) warnings.push("plan_incomplete");

  if (counterThesis.length < 10) warnings.push("counter_thesis_missing");

  const planErrors = _dedupePlanItems(errors);
  const planWarnings = _dedupePlanItems(warnings);
  const alignment = planErrors.length
    ? "out_of_plan"
    : (!planDirection || planWarnings.includes("plan_incomplete")) ? "incomplete" : "in_plan";
  const score = Math.max(0, 100 - (planErrors.length * 24) - (planWarnings.length * 7) - (alignment === "incomplete" ? 15 : 0));

  return {
    plan_model: "midnight_po3",
    plan_direction: planDirection,
    plan_alignment: alignment,
    plan_score: Math.round(score),
    plan_errors: planErrors,
    plan_warnings: planWarnings,
  };
}

function planAlignmentLabel(alignment) {
  return {
    in_plan: "Dans le plan",
    out_of_plan: "Hors plan",
    incomplete: "Plan incomplet",
    unknown: "Plan inconnu",
  }[alignment] || "Plan inconnu";
}

// ---- 019_trades_list_dans_la_modal.js ----
// ---------- Trades list (dans la modal) ----------

var _tradeCardDataCache = {};
var _tradesListBound = false;

function bindTradesListActions(list) {
  if (!list || _tradesListBound) return;
  list.addEventListener("click", function (e) {
    // Lightbox on shot click
    var shot = e.target.closest(".trade-card-shot");
    if (shot) {
      e.stopPropagation();
      var card = shot.closest(".trade-card");
      var tid = card && card.dataset.tid;
      var trade = tid ? _tradeCardDataCache[tid] : null;
      var shots = trade && trade.screenshots;
      var first = shots && shots[0];
      if (first && typeof openLightbox === "function") {
        openLightbox("/screenshots/" + first.filename);
      }
      return;
    }
    // Edit on card click
    var card = e.target.closest(".trade-card");
    if (!card) return;
    var tid = card.dataset.tid;
    var trade = tid ? _tradeCardDataCache[tid] : null;
    if (trade && typeof openTradeForm === "function") {
      openTradeForm(trade);
    }
  });
  _tradesListBound = true;
}

function renderTradesList(trades) {
  var list = $("#tradesList");
  list.innerHTML = "";
  bindTradesListActions(list);
  // Build cache
  var cache = {};
  trades.forEach(function (t) { if (t.id != null) cache[String(t.id)] = t; });
  _tradeCardDataCache = cache;
  if (trades.length === 0) {
    list.innerHTML = '<div class="trades-empty"><strong>Aucun trade sur cette journee.</strong>Ajoute le premier trade pour construire ton plan, tes niveaux et ta review.</div>';
    return;
  }
  var summary = trades.reduce(function (acc, t) {
    var d = deriveTradeMetrics(t);
    var pnl = d.pnl ?? 0;
    acc.pnl += pnl;
    if (d.isWin === 1) acc.wins += 1;
    if (d.isWin === 0) acc.losses += 1;
    return acc;
  }, { pnl: 0, wins: 0, losses: 0 });
  var decided = summary.wins + summary.losses;
  var wr = decided ? Math.round(summary.wins / decided * 100) + "%" : "-";
  list.insertAdjacentHTML("beforeend",
    '<div class="trade-orchestrator">' +
      '<div class="trade-orchestrator-line"></div>' +
      '<div class="trade-orchestrator-node">Execution desk</div>' +
      '<div class="trade-orchestrator-node is-active">Trades du jour</div>' +
      '<div class="trade-orchestrator-metrics">' +
        '<span>' + trades.length + ' setups</span>' +
        '<span>' + fmtMoney(summary.pnl) + '</span>' +
        '<span>WR ' + wr + '</span>' +
      '</div>' +
    '</div>'
  );
  var fragment = document.createDocumentFragment();
  trades.forEach(function (t, i) {
    fragment.appendChild(tradeCardEl(t, i + 1));
  });
  list.appendChild(fragment);
  if (typeof setActiveTradeCard === "function") setActiveTradeCard(state.currentTradeId);
}

function tradeCardEl(trade, num) {
  var el       = document.createElement("article");
  el.className = "trade-card";
  el.dataset.tid = trade.id;

  el.innerHTML = tradeHeroCardHtml(trade, {
    variant: 'card',
    index: num,
    showInstrument: false,
  });

  return el;
}

function pmWizOpen(tradeId, trade) {
  if (!tradeId) {
    toast("Trade introuvable", "error");
    return;
  }
  wizOpen({
    mode: "postmortem",
    tradeId: tradeId,
    dayId: state.currentDayId || (trade ? trade.day_id : null) || null,
  });
  if (!wizState) return;
  wizState.data.exit_price = (trade && trade.exit_price) ?? "";
  wizState.data.exit_quality = Number((trade && trade.execution_quality) || 0);

  wizState.data.lessons = (trade && trade.lessons_learned) || "";
  _wizRender();
}

// ---- 020_trade_form.js ----
// ---------- Trade form ----------

const MM_INTERNAL_BLOCK_ID = "__mm_challenge__";
const MIDNIGHT_QUESTION_ORDER = [
  { key: "pre_open", id: "mmPreOpen", label: "1/10 Avant open: prix monte, baisse ou range ?" },
  { key: "open_behavior", id: "mmOpenBehavior", label: "2/10 A l'open: creation du high, creation du low, ou chop ?" },
  { key: "po3_state", id: "mmPo3State", label: "3/10 PO3: valide, partiel, ou invalide ?" },
  { key: "direction", id: "direction", label: "4/10 Direction executee: respecte-t-elle le plan ?" },
  { key: "stdv_level", id: "stdvLevel", label: "5/10 Quel niveau STDV a ete touche ?" },
  { key: "entry_trigger", id: "mmEntryTrigger", label: "6/10 Trigger d'entree: IFVG, breaker, ou les deux ?" },
  { key: "zone_rule", id: "mmZoneRule", label: "7/10 Regle 50% respectee ? (long=Discount, short=Premium)" },
  { key: "smt_state", id: "mmSmtState", label: "8/10 SMT confirmee au contact du STDV ?" },
  { key: "liquidity_target", id: "mmLiquidityTarget", label: "9/10 Quelle liquidite est ciblee en priorite ?" },
  { key: "counter_thesis", id: "mmCounterThesis", label: "10/10 Quelle est ta contre-these (1 phrase) ?" },
];

function isMidnightStrategySelected() {
  return getPill("strategy") === "midnight_model";
}

function syncDayContextMidnightVisibility() {
  const field = $("#midnightOpenField");
  if (!field) return;
  field.classList.toggle("hidden", !isMidnightStrategySelected());
}

function getMidnightCoachInputs() {
  return {
    pre_open: $("#mmPreOpen")?.value || "",
    open_behavior: $("#mmOpenBehavior")?.value || "",
    po3_state: $("#mmPo3State")?.value || "",
    entry_trigger: $("#mmEntryTrigger")?.value || "",
    zone_rule: $("#mmZoneRule")?.value || "",
    smt_state: $("#mmSmtState")?.value || "",
    liquidity_target: $("#mmLiquidityTarget")?.value || "",
    counter_thesis: ($("#mmCounterThesis")?.value || "").trim(),
  };
}

function getCurrentMidnightPlan() {
  return evaluateMidnightPlan({
    direction: getPill("direction"),
    stdv_level: numOrNull("stdvLevel"),
    coach: getMidnightCoachInputs(),
  });
}

function syncPlanDecisionUI(plan) {
  const hint = $("#planDirectionHint");
  const pill = $("#planAlignmentPill");
  const field = $("#planOverrideField");
  const ruleText = $("#po3RuleText");
  const direction = plan?.plan_direction;
  const alignment = plan?.plan_alignment || "incomplete";
  if (hint) hint.textContent = direction ? direction.toUpperCase() : "A definir par le Plan PO3";
  if (pill) {
    pill.textContent = `${planAlignmentLabel(alignment)}${plan?.plan_score != null ? " - " + plan.plan_score + "/100" : ""}`;
    pill.className = `plan-alignment-pill ${alignment}`;
  }
  if (field) field.classList.toggle("hidden", alignment !== "out_of_plan");
  if (ruleText) {
    ruleText.textContent = direction === "short"
      ? "Open haussier: chercher le high de la journee puis distribution short."
      : direction === "long"
        ? "Open baissier: chercher le low de la journee puis expansion long."
        : "Open haussier = chercher short. Open baissier = chercher long.";
  }
}

function resetMidnightChallenge() {
  [
    "mmPreOpen",
    "mmOpenBehavior",
    "mmPo3State",
    "mmEntryTrigger",
    "mmZoneRule",
    "mmSmtState",
    "mmLiquidityTarget",
    "mmCounterThesis",
  ].forEach((id) => {
    const el = $("#" + id);
    if (!el) return;
    el.value = "";
  });
  const status = $("#midnightCoachStatus");
  const next = $("#midnightCoachNextQuestion");
  const list = $("#midnightCoachChecklist");
  if (status) status.textContent = "";
  if (next) next.textContent = "";
  if (list) list.innerHTML = "";
  const override = $("#planOverrideReason");
  if (override) override.value = "";
  syncPlanDecisionUI({ plan_alignment: "incomplete", plan_score: null, plan_direction: null });
}

function evaluateMidnightChallenge() {
  const direction = getPill("direction");
  const stdvLevel = numOrNull("stdvLevel");
  const coach = getMidnightCoachInputs();
  const missing = [];
  const blockers = [];
  const warnings = [];
  const checks = [];
  const plan = getCurrentMidnightPlan();

  function miss(key, message) {
    missing.push({ key, message });
    checks.push({ tone: "bad", text: message });
  }
  function block(message) {
    blockers.push(message);
    checks.push({ tone: "bad", text: message });
  }
  function warn(message) {
    warnings.push(message);
    checks.push({ tone: "warn", text: message });
  }
  function ok(message) {
    checks.push({ tone: "ok", text: message });
  }

  if (!coach.pre_open) miss("pre_open", "Challenge 1: precise le contexte avant open.");
  else ok("OK - Avant open renseigne.");

  if (!coach.open_behavior) miss("open_behavior", "Challenge 2: indique la reaction de l'open.");
  else if (plan.plan_direction) ok(`OK - Plan PO3 attendu: ${plan.plan_direction.toUpperCase()}.`);
  else warn("Open indecis: plan PO3 incomplet.");

  if (!coach.po3_state) miss("po3_state", "Challenge 3: indique l'etat du PO3.");
  else if (coach.po3_state === "no") warn("PO3 invalide: challenge ton entree avant execution.");
  else ok("OK - Etat PO3 renseigne.");

  if (!direction) miss("direction", "Challenge 4: choisis la direction executee (long/short).");
  else ok(`OK - Direction executee: ${direction.toUpperCase()}.`);

  if (stdvLevel == null) miss("stdv_level", "Challenge 5: precise le niveau STDV touche.");
  else ok(`OK - STDV ${stdvLevel} renseigne.`);

  if (!coach.entry_trigger) miss("entry_trigger", "Challenge 6: precise le trigger d'entree.");
  else ok("OK - Trigger d'entree renseigne.");

  if (!coach.zone_rule) miss("zone_rule", "Challenge 7: indique la zone d'entree (Premium/Discount).");
  else if (coach.zone_rule === "invalid") block("Bloquant: entree hors regle 50% (Premium/Discount).");
  else ok("OK - Regle Premium/Discount renseignee.");

  if (!coach.smt_state) miss("smt_state", "Challenge 8: confirme la SMT au contact du STDV.");
  else if (coach.smt_state === "none") warn("Pas de SMT: confluence plus faible.");
  else ok("OK - SMT renseignee.");

  if (!coach.liquidity_target) miss("liquidity_target", "Challenge 9: precise la liquidite ciblee.");
  else ok("OK - Liquidite ciblee renseignee.");

  if (!coach.counter_thesis || coach.counter_thesis.length < 10) {
    miss("counter_thesis", "Challenge 10: ecris une contre-these claire (1 phrase).");
  } else {
    ok("OK - Contre-these renseignee.");
  }

  (plan.plan_errors || []).forEach((code) => block(PLAN_ERROR_LABELS[code] || code));
  (plan.plan_warnings || [])
    .filter((code) => code !== "plan_incomplete")
    .forEach((code) => warn(PLAN_WARNING_LABELS[code] || code));

  const questionMap = Object.fromEntries(MIDNIGHT_QUESTION_ORDER.map((item) => [item.key, item]));
  const firstMissing = missing[0] || null;
  const nextQuestion = firstMissing
    ? `${questionMap[firstMissing.key]?.label || firstMissing.key}`
    : blockers.length
      ? `Corrige d'abord: ${blockers[0]}`
      : warnings.length
        ? `Point de vigilance: ${warnings[0]}`
        : "Challenge rapide termine: setup coherent.";

  const score = Math.min(plan.plan_score ?? 100, Math.max(0, 100 - (missing.length * 8) - (blockers.length * 14) - (warnings.length * 5)));
  return { direction, stdvLevel, coach, plan, missing, blockers, warnings, checks, score, nextQuestion };
}

function renderMidnightChallenge() {
  const block = $("#midnightCoachBlock");
  if (!block) return;
  const active = isMidnightStrategySelected();
  syncDayContextMidnightVisibility();
  block.classList.toggle("hidden", !active);
  if (!active) {
    if (typeof refreshTradeFlowNavState === "function") refreshTradeFlowNavState();
    return;
  }

  const evals = evaluateMidnightChallenge();
  const status = $("#midnightCoachStatus");
  const next = $("#midnightCoachNextQuestion");
  const list = $("#midnightCoachChecklist");

  if (status) {
    const tone = evals.blockers.length || evals.missing.length > 2
      ? "bad"
      : evals.warnings.length
        ? "warn"
        : "good";
    status.className = `midnight-coach-status ${tone}`;
    status.innerHTML = `<span class="midnight-coach-score">${Math.round(evals.score)}/100</span>
      <span>${evals.missing.length} a completer, ${evals.blockers.length} bloquant(s), ${evals.warnings.length} vigilance(s)</span>`;
  }

  if (next) {
    next.innerHTML = `<strong>Challenge rapide - prochaine question:</strong> ${escapeHtml(evals.nextQuestion)}`;
  }
  syncPlanDecisionUI(evals.plan);

  if (list) {
    list.innerHTML = evals.checks.slice(0, 10).map((item) =>
      `<li class="${item.tone}"><span class="midnight-coach-bullet"></span><span>${escapeHtml(item.text)}</span></li>`
    ).join("");
  }
  if (typeof refreshTradeFlowNavState === "function") refreshTradeFlowNavState();
}

function hydrateMidnightChallengeFromSnapshot(snapshotContent) {
  if (!snapshotContent) return;
  let parsed = null;
  try {
    parsed = JSON.parse(snapshotContent);
  } catch (_) {
    return;
  }
  if (!parsed || !parsed.coach) return;
  const coach = parsed.coach;
  const map = {
    mmPreOpen: coach.pre_open,
    mmOpenBehavior: coach.open_behavior,
    mmPo3State: coach.po3_state,
    mmEntryTrigger: coach.entry_trigger,
    mmZoneRule: coach.zone_rule,
    mmSmtState: coach.smt_state,
    mmLiquidityTarget: coach.liquidity_target,
    mmCounterThesis: coach.counter_thesis,
  };
  Object.entries(map).forEach(([id, value]) => {
    const el = $("#" + id);
    if (!el || value == null) return;
    el.value = value;
  });
}

function buildMidnightCoachSnapshotBlock(evals) {
  if (!isMidnightStrategySelected()) return null;
  const payload = {
    version: 1,
    saved_at: new Date().toISOString(),
    score: evals.score,
    missing: evals.missing.map((x) => x.key),
    blockers: evals.blockers,
    warnings: evals.warnings,
    direction: evals.direction,
    stdv_level: evals.stdvLevel,
    coach: evals.coach,
    plan: evals.plan,
  };
  return {
    id: MM_INTERNAL_BLOCK_ID,
    title: "Midnight Challenge Snapshot",
    content: JSON.stringify(payload),
  };
}

function applyMidnightAutofillFromCoach(payload, evals) {
  const c = evals.coach;
  const directionLabel = payload.direction === "short" ? "short" : "long";
  if (!payload.scenario) {
    const preOpenLabel = { up: "hausse", down: "baisse", range: "range" }[c.pre_open] || "non precise";
    const openLabel = { drop: "open baissier", rise: "open haussier", chop: "open indecis" }[c.open_behavior] || "open non precise";
    payload.scenario = `Pre-open: ${preOpenLabel}. ${openLabel}. PO3: ${c.po3_state || "non precise"}.`;
  }
  if (!payload.why_entry) {
    const trigger = c.entry_trigger === "both" ? "IFVG + breaker" : c.entry_trigger || "trigger non precise";
    const zone = c.zone_rule || "zone non precisee";
    const smt = c.smt_state || "SMT non precisee";
    payload.why_entry = `Entree ${directionLabel} via ${trigger}, en zone ${zone}, avec ${smt}.`;
  }
  if (!payload.why_trade) {
    payload.why_trade = `Setup Midnight: validation rapide du scenario, puis execution ${directionLabel} selon check-list.`;
  }
  if (!payload.why_stop && c.counter_thesis) {
    payload.why_stop = `Invalidation definie par la contre-these: ${c.counter_thesis}`;
  }
  if (!payload.why_tp) {
    const targetLabel = { above: "liquidite au-dessus", below: "liquidite en dessous", both: "liquidites des deux cotes (scaling)" }[c.liquidity_target] || "cible non precisee";
    payload.why_tp = `TP oriente vers ${targetLabel}.`;
  }
}

function mergeMidnightCoachTags(tags, evals) {
  const set = new Set((tags || []).map((x) => String(x).trim()).filter(Boolean));
  set.add("midnight_challenge");
  if (evals.coach.entry_trigger) set.add(`entry_${evals.coach.entry_trigger}`);
  if (evals.coach.zone_rule) set.add(`zone_${evals.coach.zone_rule}`);
  if (evals.coach.smt_state) set.add(`smt_${evals.coach.smt_state}`);
  if (evals.coach.liquidity_target) set.add(`liq_${evals.coach.liquidity_target}`);
  if (evals.stdvLevel != null) set.add(`stdv_${String(evals.stdvLevel).replace(".", "_")}`);
  return [...set];
}

function validateMidnightBeforeSave() {
  if (!isMidnightStrategySelected()) return { ok: true };
  const evals = evaluateMidnightChallenge();
  if (evals.plan?.plan_alignment === "out_of_plan" && !($("#planOverrideReason")?.value || "").trim()) {
    return {
      ok: false,
      message: "Trade hors plan PO3: explique la raison de l'override avant d'enregistrer.",
      focusId: "planOverrideReason",
      evals,
    };
  }
  if (!evals.missing.length && !evals.blockers.length && !evals.warnings.length) return { ok: true, evals };
  const details = [];
  if (evals.missing.length) details.push(`${evals.missing.length} info(s) manquante(s)`);
  if (evals.blockers.length) details.push(`${evals.blockers.length} incoherence(s)`);
  if (evals.warnings.length) details.push(`${evals.warnings.length} alerte(s)`);
  return {
    ok: true,
    confirmNeeded: true,
    confirmMessage: `Challenge rapide Midnight incomplet (${details.join(", ")}).\n\nTu peux enregistrer maintenant, ou revenir completer les points ci-dessus.`,
    evals,
  };
}

function bindMidnightChallenge() {
  const fields = [
    "mmPreOpen",
    "mmOpenBehavior",
    "mmPo3State",
    "mmEntryTrigger",
    "mmZoneRule",
    "mmSmtState",
    "mmLiquidityTarget",
    "mmCounterThesis",
    "stdvLevel",
    "whyStop",
    "whyTp",
  ];
  fields.forEach((id) => {
    const el = $("#" + id);
    if (!el) return;
    el.addEventListener("input", scheduleMidnightChallengeRender);
    el.addEventListener("change", scheduleMidnightChallengeRender);
  });
  document.querySelector(`.pills[data-pills="direction"]`)?.addEventListener("click", scheduleMidnightChallengeRender);
  document.querySelector(`.pills[data-pills="strategy"]`)?.addEventListener("click", scheduleMidnightChallengeRender);
}

function setActiveTradeCard(tradeId) {
  const cards = $$("#tradesList .trade-card");
  const wanted = tradeId == null ? "" : String(tradeId);
  cards.forEach((card) => {
    const isActive = wanted !== "" && String(card.dataset.tid || "") === wanted;
    card.classList.toggle("active", isActive);
  });
}

const TRADE_FLOW_STEPS = [
  { bid: "strategy", label: "Setup" },
  { bid: "midnight-coach", label: "Plan PO3" },
  { bid: "direction", label: "Direction" },
  { bid: "levels", label: "Niveaux" },
  { bid: "result", label: "Resultat" },
  { bid: "postmortem", label: "Review" },
  { bid: "screenshots", label: "Screens" },
];

let _tradeFlowBound = false;
let _tradeFlowNavDelegationBound = false;
let _tradeFlowRefreshRaf = 0;
let _midnightChallengeRaf = 0;

function scheduleTradeFlowNavStateRefresh() {
  if (_tradeFlowRefreshRaf) return;
  _tradeFlowRefreshRaf = requestAnimationFrame(() => {
    _tradeFlowRefreshRaf = 0;
    refreshTradeFlowNavState();
  });
}

function scheduleMidnightChallengeRender() {
  if (_midnightChallengeRaf) return;
  _midnightChallengeRaf = requestAnimationFrame(() => {
    _midnightChallengeRaf = 0;
    renderMidnightChallenge();
  });
}

function _isFilledValue(v) {
  if (v == null) return false;
  if (typeof v === "number") return Number.isFinite(v);
  return String(v).trim() !== "";
}

function _stepDone(bid) {
  if (bid === "strategy") return !!getPill("strategy");
  if (bid === "direction") {
    const plan = getCurrentMidnightPlan();
    const directionOk = !!getPill("direction");
    const overrideOk = plan.plan_alignment !== "out_of_plan" || _isFilledValue($("#planOverrideReason")?.value);
    return directionOk && overrideOk;
  }
  if (bid === "scenario") return ["whyTrade", "whyEntry", "scenario", "whyStop", "whyTp"].some((id) => _isFilledValue($("#" + id)?.value));
  if (bid === "levels") return _isFilledValue($("#entryPrice")?.value) && _isFilledValue($("#stopLoss")?.value) && _isFilledValue($("#takeProfit")?.value);
  if (bid === "result") return _isFilledValue($("#exitPrice")?.value) || _isFilledValue($("#isWin")?.value);
  if (bid === "midnight-coach") {
    if (!isMidnightStrategySelected()) return true;
    const evals = evaluateMidnightChallenge();
    return evals.missing.length === 0 && evals.blockers.length === 0;
  }
  if (bid === "postmortem") return _isFilledValue($("#lessonsLearned")?.value) || !!getPill("thesis_validated");
  if (bid === "screenshots") return ($$("#shotsList .shot").length > 0);
  return false;
}

function _setBlockCollapsed(block, collapsed) {
  if (!block) return;
  block.classList.toggle("collapsed", !!collapsed);
  const bid = block.dataset.bid || "";
  if (bid && typeof loadCollapsedBlocks === "function" && typeof saveCollapsedBlocks === "function") {
    const stateCollapsed = loadCollapsedBlocks();
    stateCollapsed[bid] = !!collapsed;
    saveCollapsedBlocks(stateCollapsed);
  }
  if (typeof updateBlockSummary === "function") updateBlockSummary(block);
}

function _focusTradeBlockByBid(bid, opts = {}) {
  const options = opts || {};
  const blocks = [...$$("#tradeFormSection .block")];
  const target = blocks.find((b) => (b.dataset.bid || "") === bid && !b.classList.contains("hidden"));
  if (!target) return;

  blocks.forEach((block) => {
    if (block.classList.contains("hidden")) return;
    _setBlockCollapsed(block, block !== target);
  });

  if (options.scroll !== false) {
    const behavior = options.smooth ? "smooth" : "auto";
    const modalScroll = $("#entryModal .modal-scroll");
    if (modalScroll) {
      const targetTop = target.offsetTop - modalScroll.offsetTop - 12;
      modalScroll.scrollTo({ top: Math.max(0, targetTop), behavior });
    } else {
      target.scrollIntoView({ behavior, block: "start" });
    }
  }

  if (options.focus !== false) {
    setTimeout(() => {
      const candidate = target.querySelector("textarea, input:not([type='hidden']):not([readonly]), select, .pill-choice");
      if (candidate && typeof candidate.focus === "function") candidate.focus();
    }, 120);
  }
}

function _ensureTradeFlowNav() {
  var section = $("#tradeFormSection");
  if (!section) return null;
  var inner = section.querySelector(".trade-form-inner");
  if (!inner) return null;

  var nav = $("#tradeFlowNav");
  if (!nav) {
    nav = document.createElement("div");
    nav.id = "tradeFlowNav";
    nav.className = "trade-flow-nav";
    inner.insertAdjacentElement("beforebegin", nav);
  }

  nav.innerHTML = TRADE_FLOW_STEPS.map(function (step) {
    return `<button type="button" class="trade-flow-step" data-bid="${step.bid}">
      <span class="trade-flow-dot"></span>
      <span class="trade-flow-label">${step.label}</span>
    </button>`;
  }).join("");

  if (!_tradeFlowNavDelegationBound) {
    _tradeFlowNavDelegationBound = true;
    nav.addEventListener("click", function (e) {
      var btn = e.target.closest(".trade-flow-step");
      if (!btn) return;
      _focusTradeBlockByBid(btn.dataset.bid, { scroll: true, focus: true });
      refreshTradeFlowNavState();
    });
  }
  return nav;
}

function refreshTradeFlowNavState() {
  const nav = $("#tradeFlowNav");
  if (!nav) return;
  const blocks = [...$$("#tradeFormSection .block")].filter((b) => !b.classList.contains("hidden"));
  const active = blocks.find((b) => !b.classList.contains("collapsed"));
  const activeBid = active?.dataset?.bid || "";

  nav.querySelectorAll(".trade-flow-step").forEach((btn) => {
    const bid = btn.dataset.bid || "";
    const block = blocks.find((b) => (b.dataset.bid || "") === bid);
    const visible = !!block;
    const done = visible ? _stepDone(bid) : true;
    btn.classList.toggle("is-active", bid === activeBid);
    btn.classList.toggle("is-done", done);
    btn.classList.toggle("is-hidden-step", !visible);
  });
}

function _pickInitialTradeStep(trade) {
  if (!trade) return "strategy";
  if (isMidnightStrategySelected()) {
    const plan = getCurrentMidnightPlan();
    if (!plan.plan_direction || plan.plan_alignment === "incomplete") return "midnight-coach";
    if (!getPill("direction")) return "direction";
  }
  if (!_isFilledValue($("#entryPrice")?.value) || !_isFilledValue($("#takeProfit")?.value)) return "levels";
  if (_isFilledValue($("#entryPrice")?.value) && !_isFilledValue($("#exitPrice")?.value)) return "result";
  return "scenario";
}

function _initTradeFlowUX() {
  _ensureTradeFlowNav();
  if (_tradeFlowBound) {
    refreshTradeFlowNavState();
    return;
  }
  const form = $("#tradeForm");
  if (form) {
    form.addEventListener("input", scheduleTradeFlowNavStateRefresh);
    form.addEventListener("change", scheduleTradeFlowNavStateRefresh);
  }
  $$("#tradeForm .pills").forEach((el) => {
    el.addEventListener("click", scheduleTradeFlowNavStateRefresh);
  });
  _tradeFlowBound = true;
  refreshTradeFlowNavState();
}

function _enterCompactTradeFlow(trade) {
  _initTradeFlowUX();
  const initialBid = _pickInitialTradeStep(trade);
  _focusTradeBlockByBid(initialBid, { scroll: true, focus: true });
  refreshTradeFlowNavState();
}

function openTradeForm(trade) {
  if (typeof sanitizeEntryModalSticky === "function") sanitizeEntryModalSticky();
  if (typeof setModalTradeFocus === "function") setModalTradeFocus(true);
  state.currentTradeId = trade?.id || null;
  setActiveTradeCard(state.currentTradeId);
  resetTradeForm();

  if (trade) {
    // Edition d'un trade existant
    $("#tradeId").value         = trade.id;
    setPill("strategy",          trade.strategy);
    setPill("direction",         trade.direction);
    setPill("thesis_validated",  trade.thesis_validated);

    setQuality(trade.execution_quality);
    $("#whyTrade").value      = trade.why_trade      ?? "";
    $("#whyEntry").value      = trade.why_entry      ?? "";
    $("#scenario").value      = trade.scenario       ?? "";
    $("#whyStop").value       = trade.why_stop       ?? "";
    $("#whyTp").value         = trade.why_tp         ?? "";
    $("#stdvLevel").value     = trade.stdv_level     ?? "";
    $("#entryPrice").value    = trade.entry_price    ?? "";
    $("#stopLoss").value      = trade.stop_loss      ?? "";
    $("#takeProfit").value    = trade.take_profit    ?? "";
    $("#exitPrice").value     = trade.exit_price     ?? "";
    $("#positionSize").value  = trade.position_size  ?? 1;
    $("#pnl").value           = trade.pnl            ?? 0;
    $("#rr").value            = trade.rr             ?? "";
    $("#isWin").value         = trade.is_win != null ? String(trade.is_win) : "";
    $("#planOverrideReason").value = trade.plan_override_reason ?? "";
    $("#exitPrice").dataset.autoSource = (
      trade.exit_price != null && trade.take_profit != null && Number(trade.exit_price) === Number(trade.take_profit)
    ) ? "tp" : "manual";
    $("#lessonsLearned").value = trade.lessons_learned ?? "";
    (trade.tags || []).forEach((t) => addTag(t));
    const allBlocks = trade.custom_blocks || [];
    const internalMidnight = allBlocks.find((b) => String(b?.id || "") === MM_INTERNAL_BLOCK_ID);
    if (internalMidnight) {
      hydrateMidnightChallengeFromSnapshot(internalMidnight.content);
    }
    allBlocks
      .filter((b) => String(b?.id || "") !== MM_INTERNAL_BLOCK_ID)
      .forEach((b) => addCustomBlock(b));
    renderShots(trade.screenshots || []);
    $("#tradeFormTitle").textContent = `Trade #${$("#tradesList .trade-card").length} - edition`;
    $("#deleteTradeBtn").classList.remove("hidden");
  } else {
    // Nouveau trade
    $("#tradeFormTitle").textContent = "Nouveau trade";
    $("#deleteTradeBtn").classList.add("hidden");
    renderShots([]);
    $("#positionSize").value = 1;
    setPill("strategy", "midnight_model");
  }

  autoFillExitFromTarget();
  updateRRPreview();
  renderMidnightChallenge();
  syncDayContextMidnightVisibility();
  setTimeout(function () { enhanceSelects($("#tradeFormSection")); }, 0);
  const tradeSection = $("#tradeFormSection");
  tradeSection?.classList.remove("hidden");
  _enterCompactTradeFlow(trade);
}

function closeTradeForm() {
  closeTradeFormUI();
}

function closeTradeFormUI() {
  $("#tradeFormSection").classList.add("hidden");
  if (typeof setModalTradeFocus === "function") setModalTradeFocus(false);
  setActiveTradeCard(null);
  state.currentTradeId = null;
  syncDayContextMidnightVisibility();
  refreshTradeFlowNavState();
}

function resetTradeForm() {
  $("#tradeForm").reset();
  $("#tradeId").value = "";
  $$("#tradeForm .pills .pill-choice").forEach((p) => p.classList.remove("active"));
  $$(".quality button").forEach((b) => b.classList.remove("on"));
  $("#executionQuality").value = "";
  $("#tagsInput").querySelectorAll(".tag-pill").forEach((t) => t.remove());
  $("#customBlocksList").innerHTML = "";
  renderShots([]);
  $("#rrPreview").textContent = "";
  const exit = $("#exitPrice");
  if (exit) exit.dataset.autoSource = "";
  const override = $("#planOverrideReason");
  if (override) override.value = "";
  resetMidnightChallenge();
  syncDayContextMidnightVisibility();
}

function buildTradePayload() {
  const isWinVal = $("#isWin").value;
  const eq       = $("#executionQuality").value;
  const midnightEvals = evaluateMidnightChallenge();
  const plan = midnightEvals.plan || getCurrentMidnightPlan();
  const customBlocks = getCustomBlocks().filter((b) => String(b?.id || "") !== MM_INTERNAL_BLOCK_ID);
  const midnightSnapshot = buildMidnightCoachSnapshotBlock(midnightEvals);
  if (midnightSnapshot) customBlocks.push(midnightSnapshot);
  let tags = getTags();
  if (isMidnightStrategySelected()) tags = mergeMidnightCoachTags(tags, midnightEvals);

  const payload = {
    strategy:         getPill("strategy"),
    direction:        getPill("direction"),
    why_trade:        $("#whyTrade").value   || null,
    why_entry:        $("#whyEntry").value   || null,
    scenario:         $("#scenario").value   || null,
    why_stop:         $("#whyStop").value    || null,
    why_tp:           $("#whyTp").value      || null,
    stdv_level:       numOrNull("stdvLevel"),
    entry_price:      numOrNull("entryPrice"),
    stop_loss:        numOrNull("stopLoss"),
    take_profit:      numOrNull("takeProfit"),
    exit_price:       numOrNull("exitPrice"),
    position_size:    numOrNull("positionSize"),
    pnl:              Number($("#pnl").value || 0),
    rr:               numOrNull("rr"),
    is_win:           isWinVal === "" ? null : isWinVal === "1",
    execution_quality: eq === "" ? null : Number(eq),
    thesis_validated: getPill("thesis_validated"),
    lessons_learned:  $("#lessonsLearned").value || null,
    tags,
    custom_blocks:    customBlocks,
  };

  if (isMidnightStrategySelected()) {
    Object.assign(payload, {
      plan_model:       plan.plan_model,
      plan_direction:   plan.plan_direction,
      plan_alignment:   plan.plan_alignment,
      plan_score:       plan.plan_score,
      plan_errors:      plan.plan_errors,
      plan_warnings:    plan.plan_warnings,
      plan_override_reason: $("#planOverrideReason")?.value?.trim() || null,
      plan_snapshot:    {
        version: 1,
        saved_at: new Date().toISOString(),
        direction: getPill("direction"),
        stdv_level: numOrNull("stdvLevel"),
        coach: midnightEvals.coach,
        plan,
      },
    });
    applyMidnightAutofillFromCoach(payload, midnightEvals);
  }
  return payload;
}

function numOrNull(id) {
  const v = $("#" + id)?.value;
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function submitTrade(e) {
  e.preventDefault();
  if (state.isSavingTrade) return;
  updateRRPreview();
  renderMidnightChallenge();

  // S'assurer que le jour existe avant d'enregistrer le trade
  if (!state.currentDayId) {
    const saved = await saveDayContext(true);
    if (!saved) return;
  }

  const challengeValidation = validateMidnightBeforeSave();
  if (!challengeValidation.ok) {
    toast(challengeValidation.message, "error");
    if (challengeValidation.focusId) {
      const focusEl = $("#" + challengeValidation.focusId);
      if (focusEl) focusEl.focus();
    }
    return;
  }
  if (challengeValidation.confirmNeeded && !confirm(challengeValidation.confirmMessage)) {
    return;
  }

  state.isSavingTrade = true;
  const payload = buildTradePayload();

  try {
    if (state.currentTradeId) {
      await api(`/api/trades/${state.currentTradeId}`,
        { method: "PUT", body: JSON.stringify(payload) });
      state.modalDataDirty = true;
      toast("Trade mis a jour ✓", "success");
    } else {
      await api(`/api/days/${state.currentDayId}/trades`,
        { method: "POST", body: JSON.stringify(payload) });
      state.modalDataDirty = true;
      toast("Trade enregistre ✓", "success");
    }
    // Recharger le jour pour mettre a jour la liste
    const day = await api(`/api/days/${state.currentDayId}`);
    renderTradesList(day.trades || []);
    closeTradeFormUI();
    document.dispatchEvent(new CustomEvent("trade:saved"));
    await loadAll();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    state.isSavingTrade = false;
  }
}

async function deleteTrade() {
  if (!state.currentTradeId) return;
  if (!confirm("Supprimer ce trade (screenshots inclus) ?")) return;
  try {
    await api(`/api/trades/${state.currentTradeId}`, { method: "DELETE" });
    state.modalDataDirty = true;
    toast("Trade supprime", "success");
    const day = await api(`/api/days/${state.currentDayId}`);
    renderTradesList(day.trades || []);
    closeTradeFormUI();
    document.dispatchEvent(new CustomEvent("trade:saved"));
    await loadAll();
  } catch (err) { toast(err.message, "error"); }
}

// ---- 021_rr_preview.js ----
// ---------- RR preview ----------

function bindRRPreview() {
  ["entryPrice","stopLoss","takeProfit","exitPrice","positionSize"].forEach(id =>
    document.getElementById(id)?.addEventListener("input", updateRRPreview)
  );
  $("#takeProfit")?.addEventListener("input", autoFillExitFromTarget);
  $("#exitPrice")?.addEventListener("input", () => {
    const exit = $("#exitPrice");
    if (exit) exit.dataset.autoSource = "manual";
  });
}

function autoFillExitFromTarget() {
  const exit = $("#exitPrice");
  const target = $("#takeProfit");
  if (!exit || !target) return;
  const tp = target.value;
  const source = exit.dataset.autoSource || "";
  if (!tp) {
    if (source === "tp") {
      exit.value = "";
      exit.dataset.autoSource = "";
      updateRRPreview();
    }
    return;
  }
  if (!exit.value || source === "tp") {
    exit.value = tp;
    exit.dataset.autoSource = "tp";
    updateRRPreview();
  }
}

function updateRRPreview() {
  const entry = numOrNull("entryPrice");
  const stop  = numOrNull("stopLoss");
  const target = numOrNull("takeProfit");
  const exit  = numOrNull("exitPrice");
  const qty   = numOrNull("positionSize") || 1;
  const prev = $("#rrPreview");
  const rrField = $("#rr");
  const pnlField = $("#pnl");
  const isWinField = $("#isWin");
  if (!prev) return;
  const selectedDirection = getPill("direction");
  const inferredDirection = inferDirectionFromPrices(entry, stop, target);
  const direction = selectedDirection || inferredDirection;

  let rrValue = null;
  if (entry != null && stop != null && target != null && stop !== entry) {
    rrValue = Math.abs(target - entry) / Math.abs(entry - stop);
  }
  if (rrField) rrField.value = rrValue != null ? rrValue.toFixed(2) : "";

  let pnlValue = null;
  if (direction && entry != null && exit != null) {
    pnlValue = (direction === "long" ? (exit - entry) : (entry - exit)) * qty;
    if (pnlField) pnlField.value = pnlValue.toFixed(2);
    if (isWinField) isWinField.value = pnlValue > 0 ? "1" : pnlValue < 0 ? "0" : "";
  }

  if (entry != null && stop != null && target != null && stop !== entry) {
    const riskPerContract = Math.abs(entry - stop);
    const rewardPerContract = Math.abs(target - entry);
    const gainEstimate = rewardPerContract * qty;
    const lossEstimate = riskPerContract * qty;
    const dirLabel = direction === "short" ? "Short" : "Long";
    prev.textContent = `${dirLabel} - RR theorique: ${rrValue.toFixed(2)}R - Estimation (${qty} contrat${qty > 1 ? "s" : ""}): +${gainEstimate.toFixed(2)} / -${lossEstimate.toFixed(2)}`;
    prev.className = "rr-preview visible";
  } else {
    prev.textContent = "";
    prev.className = "rr-preview";
  }
}

// ---- 022_pills.js ----
// ---------- Pills ----------

function bindPills() {
  $$(".pills").forEach(group => {
    group.addEventListener("click", (e) => {
      const btn = e.target.closest(".pill-choice");
      if (!btn) return;
      const wasActive = btn.classList.contains("active");
      group.querySelectorAll(".pill-choice").forEach(p => p.classList.remove("active"));
      if (!wasActive) btn.classList.add("active");
      if (group.dataset.pills === "direction") setTimeout(updateRRPreview, 0);
    });
  });
}

function setPill(group, value) {
  const c = document.querySelector(`.pills[data-pills="${group}"]`);
  if (!c) return;
  if (group === "strategy" && value && !findPillByValue(c, value)) {
    appendStrategyPill(c, {
      value,
      label: STRATEGY_LABELS[value] || prettify(value),
    }, { dynamic: true });
  }
  c.querySelectorAll(".pill-choice").forEach(p =>
    p.classList.toggle("active", p.dataset.value === value)
  );
}

function getPill(group) {
  const a = document.querySelector(`.pills[data-pills="${group}"] .pill-choice.active`);
  return a ? a.dataset.value : null;
}

// ---- 023_quality_stars.js ----
// ---------- Quality stars ----------

function bindQuality() {
  const c = $("#qualityRating");
  if (!c) return;
  c.addEventListener("click", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const q   = Number(btn.dataset.q);
    const cur = Number($("#executionQuality").value || 0);
    setQuality(cur === q ? 0 : q);
  });
  c.addEventListener("mouseover", e => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const q = Number(btn.dataset.q);
    c.querySelectorAll("button").forEach(b => b.classList.toggle("on", Number(b.dataset.q) <= q));
  });
  c.addEventListener("mouseleave", () => setQuality(Number($("#executionQuality").value || 0)));
}

function setQuality(q) {
  $("#executionQuality").value = q || "";
  $$("#qualityRating button").forEach(b =>
    b.classList.toggle("on", Number(b.dataset.q) <= (q || 0))
  );
}

// ---- 024_tags_input.js ----
// ---------- Tags input ----------

function bindTagsInput() {
  const wrap  = $("#tagsInput");
  const input = $("#tagsInputField");
  if (!wrap || !input) return;
  wrap.addEventListener("click", () => input.focus());
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const v = input.value.trim().replace(/^#/, "");
      if (v) addTag(v);
      input.value = "";
    } else if (e.key === "Backspace" && input.value === "") {
      const pills = wrap.querySelectorAll(".tag-pill");
      if (pills.length) pills[pills.length - 1].remove();
    }
  });
}

function addTag(value) {
  const wrap = $("#tagsInput");
  if (!wrap) return;
  const existing = [...wrap.querySelectorAll(".tag-pill")].map(p => p.dataset.value);
  if (existing.includes(value)) return;
  const pill     = document.createElement("span");
  pill.className = "tag-pill";
  pill.dataset.value = value;
  pill.innerHTML = `#${escapeHtml(value)} <span class="x">✕</span>`;
  pill.querySelector(".x").addEventListener("click", () => pill.remove());
  wrap.insertBefore(pill, $("#tagsInputField"));
}

function getTags() {
  return [...($("#tagsInput")?.querySelectorAll(".tag-pill") || [])].map(p => p.dataset.value);
}

// ---- 025_screenshots.js ----
// ---------- Screenshots ----------

function getClipboardImageFiles(e) {
  const clipboard = e.clipboardData;
  if (!clipboard) return [];
  const directFiles = [...(clipboard.files || [])].filter(f => f?.type?.startsWith("image/"));
  if (directFiles.length) return directFiles;
  const items = [...(clipboard.items || [])];
  return items
    .filter(it => it?.kind === "file" && it?.type?.startsWith("image/"))
    .map(it => it.getAsFile())
    .filter(Boolean);
}

function getPasteMarkdownTarget(target) {
  if (!(target instanceof Element)) return null;
  const field = target.closest("textarea, input[type='text']");
  if (!field) return null;
  if (field.id === "tagsInputField") return null;
  if (!field.closest("#entryModal")) return null;
  return field;
}

function insertTextAtCursor(field, text) {
  if (!field) return;
  const start = field.selectionStart ?? field.value.length;
  const end   = field.selectionEnd ?? start;
  const before = field.value.slice(0, start);
  const after  = field.value.slice(end);
  const isSingleLine = field.tagName === "INPUT";
  const addLeadingNL  = !isSingleLine && before.length > 0 && !before.endsWith("\n");
  const addTrailingNL = !isSingleLine && after.length > 0 && !after.startsWith("\n");
  const payload = `${addLeadingNL ? "\n" : ""}${text}${addTrailingNL ? "\n" : ""}`;
  field.value = before + payload + after;
  const caret = before.length + payload.length;
  field.focus();
  field.setSelectionRange(caret, caret);
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function buildMarkdownImageSnippet(shots, singleLine = false) {
  return (shots || [])
    .map((s, i) => `![Screenshot ${i + 1}](/screenshots/${s.filename})`)
    .join(singleLine ? " " : "\n");
}

function isWizardVisible() {
  const wiz = $("#wiz");
  return !!wiz && !wiz.classList.contains("hidden");
}

async function onClipboardImagePaste(e) {
  const files = getClipboardImageFiles(e);
  if (!files.length) return;

  if (isWizardVisible()) {
    e.preventDefault();
    await _wizHandleFiles(files);
    if (wizState) toast(`${files.length} image${files.length > 1 ? "s" : ""} ajoutee${files.length > 1 ? "s" : ""} au wizard`, "success");
    return;
  }

  if ($("#entryModal")?.classList.contains("hidden")) return;
  e.preventDefault();
  const targetField = getPasteMarkdownTarget(e.target);
  const shots = await handleFiles(files);
  if (!targetField || !shots.length) return;
  const isSingleLine = targetField.tagName === "INPUT";
  insertTextAtCursor(targetField, buildMarkdownImageSnippet(shots, isSingleLine));
}

function renderShots(shots) {
  const list = $("#shotsList");
  if (!list) return;
  list.innerHTML = "";
  (shots || []).forEach(s => appendShot(s));
  if (typeof refreshTradeFlowNavState === "function") refreshTradeFlowNavState();
}

async function handleFiles(fileList) {
  if (!fileList || fileList.length === 0) return [];
  const files = [...fileList];
  const uploaded = [];

  // S'assurer que le jour existe
  if (!state.currentDayId) {
    const saved = await saveDayContext(true);
    if (!saved) return uploaded;
  }

  const tradeReady = await ensureTradeContextForUpload();
  if (!tradeReady) {
    return uploaded;
  }

  let ok = 0;
  for (const file of files) {
    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch(`/api/trades/${state.currentTradeId}/screenshots`,
        { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast(err.error || `Upload échoué : ${file.name}`, "error");
        continue;
      }
      const s = await res.json();
      appendShot(s);
      uploaded.push(s);
      ok++;
    } catch (err) { toast("Erreur réseau : " + err.message, "error"); }
  }
  const input = $("#fileInput");
  if (input) input.value = "";
  if (ok > 0) toast(`${ok} screenshot${ok > 1 ? "s" : ""} ajouté${ok > 1 ? "s" : ""} ✓`, "success");
  if (ok > 0) {
    // Rafraîchir les cartes trades dans la modale pour que le hero media s'affiche
    if (state.currentDayId) {
      const day = await api(`/api/days/${state.currentDayId}`);
      if (typeof renderTradesList === "function") renderTradesList(day.trades || []);
    }
    state.modalDataDirty = true;
    if (typeof loadAll === "function") setTimeout(loadAll, 100);
  }
  return uploaded;
}

async function ensureTradeContextForUpload() {
  if (state.currentTradeId) return true;

  const tradeFormOpen = !$("#tradeFormSection")?.classList.contains("hidden");
  if (!tradeFormOpen) {
    toast("Ouvre ou crée un trade pour lui attacher des screenshots", "error");
    return false;
  }

  try {
    const payload = buildTradePayload();
    const saved = await api(`/api/days/${state.currentDayId}/trades`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.currentTradeId = saved.id;
    if ($("#tradeId")) $("#tradeId").value = saved.id || "";
    state.modalDataDirty = true;
    if (typeof loadAll === "function") setTimeout(loadAll, 100);
    const day = await api(`/api/days/${state.currentDayId}`);
    renderTradesList(day.trades || []);
    toast("Trade créé automatiquement pour ajouter le screenshot", "success");
    return true;
  } catch (err) {
    toast(err.message || "Impossible de préparer le trade pour l'upload", "error");
    return false;
  }
}

var _shotsDelegationBound = false;

function _bindShotsDelegation() {
  if (_shotsDelegationBound) return;
  var list = $("#shotsList");
  if (!list) return;
  _shotsDelegationBound = true;
  list.addEventListener("click", function (e) {
    var img = e.target.closest(".shot img");
    if (img) { openLightbox(img.src); return; }
    var del = e.target.closest(".shot-x");
    if (!del) return;
    var wrap = del.closest(".shot");
    if (!wrap) return;
    (async function () {
      if (!confirm("Supprimer ce screenshot ?")) return;
      try {
        await api("/api/screenshots/" + wrap.dataset.sid, { method: "DELETE" });
        wrap.remove();
        state.modalDataDirty = true;
        if (typeof loadAll === "function") setTimeout(loadAll, 100);
        // Rafraîchir les cartes trades dans la modale pour que le hero media soit mis à jour
        if (state.currentDayId) {
          const day = await api(`/api/days/${state.currentDayId}`);
          if (typeof renderTradesList === "function") renderTradesList(day.trades || []);
        }
        if (typeof refreshTradeFlowNavState === "function") refreshTradeFlowNavState();
      } catch (err) { toast(err.message, "error"); }
    })();
  });
}

function appendShot(s) {
  _bindShotsDelegation();
  var list = $("#shotsList");
  if (!list) return;
  var wrap = document.createElement("div");
  wrap.className = "shot";
  wrap.dataset.sid = s.id;
  wrap.innerHTML = `
    <img src="/screenshots/${s.filename}" alt="" />
    <button class="shot-x" type="button" title="Supprimer">✕</button>
  `;
  list.appendChild(wrap);
  if (typeof refreshTradeFlowNavState === "function") refreshTradeFlowNavState();
}

function openLightbox(src) {
  $("#lightboxImg").src = src;
  $("#lightbox").classList.remove("hidden");
}

// ---- 026_autosave_du_jour.js ----
// ---------- Autosave du jour ----------

let _autosaveState = "idle";

function _nowHHMM() {
  var d = new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

var _autosaveSavedTimer = null;

function setAutosaveState(s, msg) {
  _autosaveState = s;
  const el = $("#autosaveInd");
  const t  = $("#autosaveText");
  if (!el || !t) return;
  el.dataset.state = s;
  var labels = {
    idle: "Auto-save",
    dirty: "Modif…",
    saving: "Sauvegarde…",
    saved: msg || ("Sauvegardé à " + _nowHHMM()),
    error: msg || "Erreur",
  };
  t.textContent = labels[s] || s;
  // Retour automatique a idle apres 3s pour l etat saved
  if (s === "saved") {
    clearTimeout(_autosaveSavedTimer);
    _autosaveSavedTimer = setTimeout(function () {
      setAutosaveState("idle");
    }, 3000);
  }
}

function bindAutosave() {
  // Sauvegarde à la sortie d'un champ (focusout) comme dans l'éditeur
  $("#dayForm")?.addEventListener("focusout", triggerDayAutosave);
  $("#dayForm")?.addEventListener("click", e => {
    if (e.target.closest(".pill-choice")) setTimeout(triggerDayAutosave, 50);
  });
}

function triggerDayAutosave() {
  if (!dayFormChanged()) return;
  setAutosaveState("dirty");
  if (activeDayFormId()) {
    saveDayContext(false);
  } else if (dayFormHasMeaningfulContent()) {
    saveDayContext(true);
  }
}

function dayFormHasMeaningfulContent() {
  const p = buildDayPayload();
  return !!(p.htf_bias || p.htf_context || p.daily_notes);
}

// ---- 027_export.js ----
// ---------- Export ----------

function bindExport() {
  $("#exportBtn")?.addEventListener("click", async () => {
    try {
      const data = await api("/api/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `journal-export-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`Export ${data.count} jours ✓`, "success");
    } catch (err) { toast(err.message, "error"); }
  });
}

// ---- 028_global_keys.js ----
// ---------- Global keys ----------

function bindGlobalKeys() {
  document.addEventListener("keydown", e => {
    const tag    = (e.target.tagName || "").toLowerCase();
    const inField = ["input","textarea","select"].includes(tag);
    const meta   = e.metaKey || e.ctrlKey;

    if (meta && e.key.toLowerCase() === "k") { e.preventDefault(); openCmdk(); return; }
    if (meta && e.key.toLowerCase() === "n") { e.preventDefault(); wizOpen({ date: todayKey() }); return; }

    if (e.key === "Escape") {
      if (state.cmdkOpen) { closeCmdk(); return; }
      if (!$("#tradeFormSection")?.classList.contains("hidden")) { closeTradeForm(); return; }
      if (!$("#entryModal").classList.contains("hidden")) { closeModal(); return; }
      if (!$("#lightbox").classList.contains("hidden")) { $("#lightbox").classList.add("hidden"); return; }
    }

    if (inField) return;
    if (!meta && !e.altKey) {
      if (e.key === "t" || e.key === "T") { e.preventDefault(); goPage("today"); }
      if (e.key === "j" || e.key === "J") { e.preventDefault(); goPage("journal"); }
      if (e.key === "s" || e.key === "S") { e.preventDefault(); goPage("stats"); }
      if (e.key === "g" || e.key === "G") { e.preventDefault(); goPage("settings"); }
      if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        if (state.currentPage !== "journal") goPage("journal");
        const nextMode = state.journalViewMode === "week" ? "month" : "week";
        setJournalViewMode(nextMode, { persist: true, reload: true });
      }
      if (e.key === "?") { e.preventDefault(); openCmdk(); }
    }
  });
}

// ---- 029_command_palette.js ----
// ---------- Command Palette ----------

var _cmdkLastFocused = null;
var _cmdkDelegationBound = false;

function _bindCmdkDelegation() {
  if (_cmdkDelegationBound) return;
  var parent = $("#cmdkResults");
  if (!parent) return;
  _cmdkDelegationBound = true;
  parent.addEventListener("click", function (e) {
    var item = e.target.closest(".cmdk-item");
    if (!item) return;
    var idx = Number(item.dataset.idx);
    var it = state.cmdkResults[idx];
    if (it) it.run();
  });
  parent.addEventListener("mouseenter", function (e) {
    var item = e.target.closest(".cmdk-item");
    if (!item) return;
    state.cmdkActiveIdx = Number(item.dataset.idx);
    highlightCmdk();
  }, true);
}

function bindCmdk() {
  _bindCmdkDelegation();
  const input = $("#cmdkInput");
  var _cmdkTimer;
  input.addEventListener("input", function () {
    clearTimeout(_cmdkTimer);
    _cmdkTimer = setTimeout(function () { renderCmdkResults(input.value); }, 150);
  });
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveCmdk(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveCmdk(-1); }
    else if (e.key === "Enter") { e.preventDefault(); execCmdk(); }
    else if (e.key === "Tab") { e.preventDefault(); moveCmdk(e.shiftKey ? -1 : 1); }
  });
  $("#cmdk").addEventListener("click", e => { if (e.target.id === "cmdk") closeCmdk(); });
  document.addEventListener("keydown", function _cmdkTrap(e) {
    if (e.key !== "Tab" || !state.cmdkOpen) return;
    var container = $("#cmdk");
    if (!container || container.classList.contains("hidden")) return;
    var focusable = container.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    if (e.shiftKey && document.activeElement === focusable[0]) {
      e.preventDefault();
      focusable[focusable.length - 1].focus();
    } else if (!e.shiftKey && document.activeElement === focusable[focusable.length - 1]) {
      e.preventDefault();
      focusable[0].focus();
    }
  });
}

function openCmdk() {
  _cmdkLastFocused = document.activeElement;
  state.cmdkOpen = true;
  $("#cmdk").classList.remove("hidden");
  const input = $("#cmdkInput");
  input.value = "";
  setTimeout(() => input.focus(), 50);
  renderCmdkResults("");
}

function closeCmdk() {
  state.cmdkOpen = false;
  $("#cmdk").classList.add("hidden");
  if (_cmdkLastFocused) {
    _cmdkLastFocused.focus();
    _cmdkLastFocused = null;
  }
}

function buildCmdkItems(query) {
  const q = (query || "").trim().toLowerCase();
  const items = [];
  const actions = [
    { kind:"action", label:"Nouvelle entree (aujourd'hui)", icon:"plus", run:()=>{ closeCmdk(); wizOpen({ date: todayKey() }); }},
    { kind:"action", label:"Aller a Today",                 icon:"home", run:()=>{ closeCmdk(); goPage("today"); }},
    { kind:"action", label:"Journal (calendrier)",          icon:"cal",  run:()=>{ closeCmdk(); goPage("journal"); }},
    { kind:"action", label:"Journal en vue semaine",        icon:"cal",  run:()=>{ closeCmdk(); goPage("journal"); setJournalViewMode("week", { persist:true, reload:true }); }},
    { kind:"action", label:"Journal en vue mois",           icon:"cal",  run:()=>{ closeCmdk(); goPage("journal"); setJournalViewMode("month", { persist:true, reload:true }); }},
    { kind:"action", label:"Voir les Stats",                icon:"chart",run:()=>{ closeCmdk(); goPage("stats"); }},
    { kind:"action", label:"Ouvrir Settings",               icon:"gear", run:()=>{ closeCmdk(); goPage("settings"); }},
    { kind:"action", label:"Exporter en JSON",              icon:"down", run:()=>{ closeCmdk(); $("#exportBtn").click(); }},
  ];
  ["ALL","BTC","ETH","NQ","ES"].forEach(i =>
    actions.push({ kind:"action", label: i === "ALL" ? "Filtrer : tous" : `Filtrer : ${i}`, icon:"filter",
      run:()=>{ closeCmdk(); document.querySelector(`.instr-chip[data-instr="${i}"]`)?.click(); }})
  );

  const matchedActions = q
    ? actions.filter(a => a.label.toLowerCase().includes(q))
    : actions.slice(0, 6);
  matchedActions.forEach(a => items.push(a));

  const matchedDays = q
    ? state.allDays.filter(d => {
        const hay = [d.date, d.instrument, d.htf_context, d.daily_notes,
          ...(d.trades || []).flatMap(t => [t.why_trade, t.scenario, t.strategy])
        ].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      }).slice(0, 12)
    : state.allDays.slice(0, 6);

  matchedDays.forEach(d => {
    const trades = d.trades || [];
    const summary = trades[0]?.why_trade || trades[0]?.scenario || d.htf_context || "-";
    items.push({
      kind:"entry",
      icon:"doc",
      label: `${d.instrument} - ${d.date}`,
      meta: summary.slice(0, 60),
      run: ()=>{ closeCmdk(); openExistingDay(d); },
    });
  });
  return items;
}

function renderCmdkResults(query) {
  const items = buildCmdkItems(query);
  state.cmdkResults = items;
  state.cmdkActiveIdx = 0;
  const c = $("#cmdkResults");
  c.innerHTML = "";
  if (items.length === 0) {
    c.innerHTML = `<div class="cmdk-empty">Aucun resultat pour "${escapeHtml(query)}"</div>`;
    return;
  }
  const groups = { action:[], entry:[] };
  items.forEach((it, idx) => groups[it.kind]?.push({ ...it, idx }));
  if (groups.action.length) {
    c.insertAdjacentHTML("beforeend", `<div class="cmdk-section">Actions</div>`);
    groups.action.forEach(it => c.appendChild(cmdkItemEl(it)));
  }
  if (groups.entry.length) {
    c.insertAdjacentHTML("beforeend", `<div class="cmdk-section">Entrees</div>`);
    groups.entry.forEach(it => c.appendChild(cmdkItemEl(it)));
  }
  highlightCmdk();
}

function cmdkItemEl(it) {
  const el = document.createElement("div");
  el.className = "cmdk-item";
  el.dataset.idx = it.idx;
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "-1");
  el.innerHTML = `
    <div class="icon">${cmdkIcon(it.icon)}</div>
    <div class="label">${escapeHtml(it.label)}</div>
    ${it.meta ? `<div class="meta">${escapeHtml(it.meta)}</div>` : ""}
  `;
  return el;
}

function cmdkIcon(name) {
  const icons = {
    plus:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    home:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    cal:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
    gear:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .33 1.76l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.6 1.6 0 0 0 15 19.4a1.6 1.6 0 0 0-1 .6 1.6 1.6 0 0 1-2 0 1.6 1.6 0 0 0-1-.6 1.6 1.6 0 0 0-1.76.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 0-.6-1 1.6 1.6 0 0 1 0-2 1.6 1.6 0 0 0 .6-1 1.6 1.6 0 0 0-.33-1.76l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 9 4.6a1.6 1.6 0 0 0 1-.6 1.6 1.6 0 0 1 2 0 1.6 1.6 0 0 0 1 .6 1.6 1.6 0 0 0 1.76-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.6 1.6 0 0 0 19.4 9a1.6 1.6 0 0 0 .6 1 1.6 1.6 0 0 1 0 2 1.6 1.6 0 0 0-.6 1z"/></svg>`,
    down:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    filter:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`,
    doc:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  };
  return icons[name] || icons.doc;
}

function moveCmdk(delta) {
  const max = state.cmdkResults.length;
  if (!max) return;
  state.cmdkActiveIdx = (state.cmdkActiveIdx + delta + max) % max;
  highlightCmdk();
}

function highlightCmdk() {
  $$("#cmdkResults .cmdk-item").forEach(el =>
    el.classList.toggle("active", Number(el.dataset.idx) === state.cmdkActiveIdx)
  );
  document.querySelector("#cmdkResults .cmdk-item.active")?.scrollIntoView({ block:"nearest" });
}

function execCmdk() {
  state.cmdkResults[state.cmdkActiveIdx]?.run();
}

// ---- 030_stats.js ----
// ---------- Stats ----------

var _statsLastLoad = 0;
var _renderQueue = [];

function _runRenderQueue() {
  if (_renderQueue.length === 0) return;
  var fn = _renderQueue.shift();
  fn();
  if (_renderQueue.length > 0) setTimeout(_runRenderQueue, 0);
}

async function renderPerformance() {
  // Recharger les stats au maximum toutes les 30s pour eviter un cache stale
  var now = Date.now();
  if (now - _statsLastLoad > 30000) {
    await loadStats({ refreshDays: false, skipRender: true });
    _statsLastLoad = Date.now();
  }
  var s = state._stats;
  if (!s) return;

  var content = document.getElementById("statsContent");
  var empty   = document.getElementById("statsEmpty");
  if (content && empty) {
    var hasData = (s.num_trades || 0) > 0;
    content.classList.toggle("hidden", !hasData);
    empty.classList.toggle("hidden", hasData);
    if (!hasData) return;
  }

  $("#statStreakCur").textContent  = s.streak || 0;
  $("#statStreakBest").textContent = s.best_streak || 0;

  var animate = state.settings && state.settings.preferences && state.settings.preferences.animations !== false;

  _renderQueue = [
    function() { renderInsights(s.insights || []); },
    function() { renderHeatmap(s.activity  || []); },
    function() { renderCumChart(s.cumulative || [], { animate: animate }); },
    function() { renderDrawdownChart(s.drawdown || { series: [], max_drawdown: 0, current_drawdown: 0 }, { animate: animate }); },
    function() { renderPnlHistogram(s.pnl_histogram || []); },
    function() { renderPeriodCompare(s.period_compare || null); },
    function() { renderBreakdown("#bdSetup",   s.by_setup,   { kind:"setup" }); },
    function() { renderBreakdown("#bdSession", s.by_session, { kind:"session" }); },
    function() { renderBreakdown("#bdDow",     s.by_dow,     { kind:"dow" }); },
    function() { renderBreakdown("#bdTag",     s.by_tag,     { kind:"tag" }); },
    function() { renderPlanMatrix(s.plan_matrix || {}, s.plan_summary || {}); },
    function() { renderBreakdown("#bdPlanError", s.by_plan_error, { kind:"plan_error" }); },
    function() { renderInstrumentList(s.per_instrument); },
    function() { renderRRDist(s.rr_buckets || [0,0,0,0,0,0]); }
  ];
  _runRenderQueue();
  setTimeout(function () { enhanceSelects($("#statsContent")); }, 50);
}

const INSIGHT_ICONS = {
  trophy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0z"/></svg>`,
  alert:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  clock:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  brain:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2z"/></svg>`,
  warning:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  tools:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
  compass:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`,
  star:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
};

function insightWidgetKey(ins, seen) {
  const icon = String(ins?.icon || "star").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const title = String(ins?.title || "item")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "item";
  const base = `stats_insight_${icon}_${title}`;
  const count = (seen[base] || 0) + 1;
  seen[base] = count;
  return count === 1 ? base : `${base}_${count}`;
}

function renderInsights(insights) {
  const c = $("#insightsRow");
  if (!c) return;
  c.innerHTML = "";
  if (!insights.length) {
    c.innerHTML = `<div class="insight cyan widget" data-widget-key="stats_insight_empty" data-widget-kind="card">
      <div class="insight-h"><div class="insight-icon">${INSIGHT_ICONS.brain}</div>
      <div class="insight-title">Pas encore d'insights</div></div>
      <div class="insight-body">Enregistre plus de trades avec strategie, session et contexte. Les patterns apparaitront automatiquement.</div>
    </div>`;
    if (typeof applyWidgetBoardOrder === "function") applyWidgetBoardOrder(c);
    return;
  }
  const seenKeys = Object.create(null);
  insights.forEach((ins, i) => {
    const el = document.createElement("div");
    el.className = `insight ${ins.color || "cyan"} widget`;
    el.dataset.widgetKey = insightWidgetKey(ins, seenKeys);
    el.dataset.widgetKind = "card";
    el.style.animationDelay = `${i * 60}ms`;
    el.innerHTML = `
      <div class="insight-h">
        <div class="insight-icon">${INSIGHT_ICONS[ins.icon] || INSIGHT_ICONS.star}</div>
        <div class="insight-title">${escapeHtml(ins.title)}</div>
      </div>
      <div class="insight-body">${escapeHtml(ins.body)}</div>`;
    c.appendChild(el);
  });
  if (typeof applyWidgetBoardOrder === "function") applyWidgetBoardOrder(c);
}

// ---- 031_heatmap.js ----
// ---------- Heatmap ----------

var _hmLastActivity = null;  // cache: skip rerender if same reference
var _hmDelegated    = false; // flag: one-shot delegated listener

function renderHeatmap(activity) {
  if (activity === _hmLastActivity) return;
  _hmLastActivity = activity;

  const grid   = $("#heatmap");
  const months = $("#heatmapMonths");
  if (!grid || !months) return;

  const map = {};
  activity.forEach(a => { map[a.date] = a; });

  const today     = new Date();
  today.setHours(0,0,0,0);
  const totalDays = 365 + ((today.getDay() + 6) % 7);
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - totalDays + 1);

  let maxAbs = 1;
  Object.values(map).forEach(a => { if (Math.abs(a.pnl) > maxAbs) maxAbs = Math.abs(a.pnl); });

  // Build cells array (same logic, no DOM)
  const cells = [];
  const cur   = new Date(startDate);
  while (cur <= today) {
    const key = fmtDateKey(cur);
    const a   = map[key];
    let level = 0, cls = "";
    if (a) {
      if (a.pnl > 0)      { cls = "win";  level = Math.min(4, Math.ceil((Math.abs(a.pnl)/maxAbs)*4)); }
      else if (a.pnl < 0) { cls = "loss"; level = Math.min(4, Math.ceil((Math.abs(a.pnl)/maxAbs)*4)); }
      else                  level = Math.min(2, a.entries);
    }
    cells.push({ date: key, level, cls, info: a });
    cur.setDate(cur.getDate() + 1);
  }

  const weeks = Math.ceil(cells.length / 7);
  months.style.gridTemplateColumns = `repeat(${weeks}, 12px)`;

  // --- Month labels: innerHTML batch ---
  let lastMonth = -1;
  const monthParts = [];
  for (let w = 0; w < weeks; w++) {
    const cell = cells[w * 7];
    const m    = cell ? parseInt(cell.date.slice(5,7), 10) - 1 : -1;
    monthParts.push(
      (m !== -1 && m !== lastMonth)
        ? `<span>${MONTHS_FR[m].slice(0,3)}</span>`
        : `<span></span>`
    );
    if (m !== -1) lastMonth = m;
  }
  months.innerHTML = monthParts.join("");

  // --- Heatmap cells: innerHTML batch (no createElement per cell) ---
  const tk = todayKey();
  const cellParts = cells.map(c => {
    const cls = `hm-cell ${c.cls}${c.date === tk ? " today" : ""}`;
    const tt  = JSON.stringify(c.info
      ? { date: c.date, entries: c.info.entries, pnl: c.info.pnl, wins: c.info.wins, losses: c.info.losses }
      : { date: c.date, entries: 0, pnl: 0, wins: 0, losses: 0 }
    );
    return `<div class="${cls}" data-l="${c.level}" data-tt='${tt}'></div>`;
  });
  grid.innerHTML = cellParts.join("");

  // --- Single delegated listener (attached once) ---
  if (!_hmDelegated) {
    _hmDelegated = true;
    grid.addEventListener("mouseover", hmMouseOver);
    grid.addEventListener("mouseleave", hmMouseLeave);
    grid.addEventListener("click", hmClick);
  }
}

// ---------- Delegated event handlers ----------

var _hmCurrentCell = null;

function hmMouseOver(e) {
  const cell = e.target.closest(".hm-cell");
  if (cell && cell !== _hmCurrentCell) {
    _hmCurrentCell = cell;
    showHmTooltip(cell);
  }
}

function hmMouseLeave() {
  _hmCurrentCell = null;
  hideHmTooltip();
}

function hmClick(e) {
  const cell = e.target.closest(".hm-cell");
  if (!cell) return;
  const d = JSON.parse(cell.dataset.tt);
  const [y, m] = d.date.split("-").map(Number);
  state.currentMonth = new Date(y, m - 1, 1);
  goPage("journal");
  setTimeout(loadMonth, 50);
}

// ---------- Tooltip helpers (unchanged signatures) ----------

function showHmTooltip(el) {
  var tt = $("#hmTooltip");
  if (!tt) {
    tt = document.createElement("div");
    tt.id = "hmTooltip"; tt.className = "hm-tooltip";
    document.body.appendChild(tt);
  }
  var d = JSON.parse(el.dataset.tt);
  var pnlClass = d.pnl > 0 ? "pos" : d.pnl < 0 ? "neg" : "";
  tt.innerHTML = `<div class="hm-tt-date">${d.date}</div>
    ${d.entries === 0
      ? `<div class="hm-tt-meta">Aucune entrée</div>`
      : `<div class="hm-tt-pnl ${pnlClass}">${fmtMoney(d.pnl)}</div>
         <div class="hm-tt-meta">${d.entries} jour${d.entries>1?"s":""}${d.wins?" · "+d.wins+"W":""}${d.losses?" · "+d.losses+"L":""}</div>`}`;
  var rect = el.getBoundingClientRect();
  tt.style.left    = rect.left + rect.width/2 + "px";
  tt.style.top     = rect.top + "px";
  tt.style.display = "block";
}

function hideHmTooltip() {
  var tt = $("#hmTooltip");
  if (tt) tt.style.display = "none";
}

// ---- 032_breakdowns.js ----
// ---------- Breakdowns ----------

function renderBreakdown(selector, data, opts = {}) {
  const c = document.querySelector(selector);
  if (!c) return;
  c.innerHTML = "";
  const entries = Object.entries(data || {});
  if (!entries.length) {
    c.innerHTML = `<div class="bd-empty">Pas encore de donnees.</div>`;
    return;
  }
  const sortMode = state.breakdownSortMode || "count";
  entries.sort((a, b) => {
    const av = a[1] || {};
    const bv = b[1] || {};
    if (sortMode === "winrate") {
      const d = (Number(bv.winrate || 0) - Number(av.winrate || 0));
      if (d !== 0) return d;
    } else if (sortMode === "avg_rr") {
      const d = (Number(bv.avg_rr || 0) - Number(av.avg_rr || 0));
      if (d !== 0) return d;
    } else if (sortMode === "pnl") {
      const d = (Number(bv.pnl || 0) - Number(av.pnl || 0));
      if (d !== 0) return d;
    } else {
      const d = (Number(bv.count || 0) - Number(av.count || 0));
      if (d !== 0) return d;
    }
    return Number(bv.count || 0) - Number(av.count || 0);
  });
  const labelFn = opts.kind === "dow"
    ? k => (["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"][Number(k)] || `Jour ${k}`)
    : opts.kind === "tag"
    ? k => `#${String(k || "").trim()}`
    : opts.kind === "plan_error"
    ? k => PLAN_ERROR_LABELS[k] || prettify(k)
    : k => prettify(k);

  entries.forEach(([k, v], i) => {
    const wr  = v.winrate || 0;
    const avgRR = Number(v.avg_rr || 0);
    const wrColor  = wr >= 60 ? "lime" : wr >= 40 ? "amber" : "rose";
    const pnlClass = v.pnl > 0 ? "pos" : v.pnl < 0 ? "neg" : "";
    const row = document.createElement("div");
    row.className = "bd-row";
    row.style.animationDelay = `${i * 40}ms`;
    row.innerHTML = `
      <div class="bd-h">
        <span class="bd-name">${escapeHtml(labelFn(k))}</span>
        <span class="bd-meta">
          <span class="muted">${v.count}t</span>
          <span class="pnl ${pnlClass}">${fmtMoney(v.pnl)}</span>
          <span class="muted">${avgRR.toFixed(2)}R</span>
          <span class="wr">${wr.toFixed(0)}%</span>
        </span>
      </div>
      <div class="bd-bar"><div class="fill ${wrColor}" style="transform:scaleX(0)"></div></div>`;
    c.appendChild(row);
    requestAnimationFrame(() => { row.querySelector(".fill").style.transform = `scaleX(${Math.min(wr,100)/100})`; });
  });
}

function renderPlanMatrix(matrix, summary) {
  const c = $("#planMatrix");
  if (!c) return;
  const order = ["in_plan_win", "in_plan_loss", "out_of_plan_win", "out_of_plan_loss", "incomplete", "unknown"];
  const total = order.reduce((sum, key) => sum + Number(matrix?.[key]?.count || 0), 0);
  if (!total) {
    c.innerHTML = `<div class="bd-empty">Pas encore de donnees plan.</div>`;
    return;
  }
  const avg = Number(summary?.avg_score || 0);
  const rate = Number(summary?.in_plan_rate || 0);
  const cards = order.map((key) => {
    const item = matrix?.[key] || {};
    const count = Number(item.count || 0);
    const pnl = Number(item.pnl || 0);
    const cls = key.includes("out_of_plan") ? "warn" : key.includes("in_plan") ? "ok" : "muted";
    return `<div class="plan-matrix-cell ${cls}">
      <span>${escapeHtml(item.label || prettify(key))}</span>
      <strong>${count}</strong>
      <em class="${pnl > 0 ? "pos" : pnl < 0 ? "neg" : ""}">${fmtMoney(pnl)}</em>
    </div>`;
  }).join("");
  c.innerHTML = `
    <div class="plan-summary-strip">
      <div><span>Score moyen</span><strong>${avg.toFixed(0)}/100</strong></div>
      <div><span>Dans le plan</span><strong>${rate.toFixed(0)}%</strong></div>
      <div><span>Trades classes</span><strong>${Number(summary?.scored || 0)}</strong></div>
    </div>
    <div class="plan-matrix-grid">${cards}</div>
  `;
}

function renderInstrumentList(perInstr) {
  const list = $("#pairsList");
  if (!list) return;
  list.innerHTML = "";
  ["BTC","ETH","NQ","ES"].forEach((k, i) => {
    const v = perInstr?.[k];
    if (!v || !v.count) {
      list.insertAdjacentHTML("beforeend", `<div class="bd-row">
        <div class="bd-h"><span class="bd-name">${k}</span><span class="bd-meta muted">-</span></div>
        <div class="bd-empty" style="padding:4px 0">Aucune entree</div></div>`);
      return;
    }
    const wr  = v.winrate || 0;
    const wrColor  = wr >= 60 ? "lime" : wr >= 40 ? "amber" : "rose";
    const pnlClass = v.pnl > 0 ? "pos" : v.pnl < 0 ? "neg" : "";
    const row = document.createElement("div");
    row.className = "bd-row";
    row.style.animationDelay = `${i * 40}ms`;
    row.innerHTML = `
      <div class="bd-h">
        <span class="bd-name">${k}</span>
        <span class="bd-meta">
          <span class="muted">${v.entries}j - ${v.trades}t</span>
          <span class="muted">${Number(v.avg_rr || 0).toFixed(2)}R</span>
          <span class="pnl ${pnlClass}">${fmtMoney(v.pnl)}</span>
          <span class="wr">${wr.toFixed(0)}%</span>
        </span>
      </div>
      <div class="bd-bar"><div class="fill ${wrColor}" style="transform:scaleX(0)"></div></div>`;
    list.appendChild(row);
    requestAnimationFrame(() => { row.querySelector(".fill").style.transform = `scaleX(${Math.min(wr,100)/100})`; });
  });
}

function renderRRDist(buckets) {
  const c = $("#rrDist");
  if (!c) return;
  c.innerHTML = "";
  const labels = ["<0","0-1","1-2","2-3","3-5","5+"];
  const zones  = ["loss","meh","meh","ok","great","great"];
  const max    = Math.max(1, ...buckets);
  buckets.forEach((count, i) => {
    const el = document.createElement("div");
    el.className = "rr-bucket";
    el.innerHTML = `
      <div class="rr-bar-wrap">
        <div class="rr-bar" data-zone="${zones[i]}" style="transform:scaleY(0)">
          ${count > 0 ? `<span class="rr-bar-count">${count}</span>` : ""}
        </div>
      </div>
      <span class="rr-bucket-label">${labels[i]}</span>`;
    c.appendChild(el);
    requestAnimationFrame(() => {
      el.querySelector(".rr-bar").style.transform = `scaleY(${(count/max)})`;
    });
  });
}

function fmtPeriodRange(fromKey, toKey) {
  if (!fromKey || !toKey) return "-";
  const from = String(fromKey).slice(5);
  const to = String(toKey).slice(5);
  return `${from} -> ${to}`;
}

function setSignedClass(el, value) {
  if (!el) return;
  el.classList.remove("pos", "neg");
  if (value > 0) el.classList.add("pos");
  if (value < 0) el.classList.add("neg");
}

function renderPeriodCompare(periodCompare) {
  const curRange = $("#periodCurrentRange");
  const curPnl = $("#periodCurrentPnl");
  const curMeta = $("#periodCurrentMeta");
  const prevRange = $("#periodPreviousRange");
  const prevPnl = $("#periodPreviousPnl");
  const prevMeta = $("#periodPreviousMeta");
  const deltaPnl = $("#periodDeltaPnl");
  const deltaMeta = $("#periodDeltaMeta");
  if (!curRange || !curPnl || !curMeta || !prevRange || !prevPnl || !prevMeta || !deltaPnl || !deltaMeta) return;

  const cur = periodCompare?.current || {};
  const prev = periodCompare?.previous || {};
  const delta = periodCompare?.delta || {};

  curRange.textContent = fmtPeriodRange(cur.from, cur.to);
  prevRange.textContent = fmtPeriodRange(prev.from, prev.to);

  curPnl.textContent = fmtMoney(cur.pnl || 0);
  prevPnl.textContent = fmtMoney(prev.pnl || 0);
  deltaPnl.textContent = fmtMoney(delta.pnl || 0);

  setSignedClass(curPnl, Number(cur.pnl || 0));
  setSignedClass(prevPnl, Number(prev.pnl || 0));
  setSignedClass(deltaPnl, Number(delta.pnl || 0));

  curMeta.textContent = `${Number(cur.num_trades || 0)} trade${Number(cur.num_trades || 0) > 1 ? "s" : ""} - ${(Number(cur.winrate || 0)).toFixed(0)}%`;
  prevMeta.textContent = `${Number(prev.num_trades || 0)} trade${Number(prev.num_trades || 0) > 1 ? "s" : ""} - ${(Number(prev.winrate || 0)).toFixed(0)}%`;

  const tradesDelta = Number(delta.num_trades || 0);
  const wrDelta = Number(delta.winrate || 0);
  const wrPrefix = wrDelta > 0 ? "+" : "";
  deltaMeta.textContent = `${tradesDelta > 0 ? "+" : ""}${tradesDelta} trade${Math.abs(tradesDelta) > 1 ? "s" : ""} - ${wrPrefix}${wrDelta.toFixed(1)} pts`;
  setSignedClass(deltaMeta, Number(delta.pnl || 0));
}

function renderPnlHistogram(buckets) {
  const c = $("#pnlHist");
  if (!c) return;
  c.innerHTML = "";
  if (!Array.isArray(buckets) || buckets.length === 0) {
    c.innerHTML = `<div class="bd-empty">Pas assez de donnees.</div>`;
    return;
  }
  const maxCount = Math.max(1, ...buckets.map(b => Number(b.count || 0)));
  buckets.forEach((b, idx) => {
    const count = Number(b.count || 0);
    const center = Number(b.center || 0);
    const el = document.createElement("div");
    el.className = "pnl-hist-bin";
    el.innerHTML = `
      <div class="pnl-hist-bar-wrap">
        <div class="pnl-hist-bar ${center >= 0 ? "pos" : "neg"}" style="transform:scaleY(0)">
          ${count > 0 ? `<span class="pnl-hist-count">${count}</span>` : ""}
        </div>
      </div>
      <span class="pnl-hist-label">${escapeHtml(String(b.label || ""))}</span>
    `;
    c.appendChild(el);
    requestAnimationFrame(() => {
      const bar = el.querySelector(".pnl-hist-bar");
      if (bar) bar.style.transform = `scaleY(${(count / maxCount)})`;
    });
    el.style.animationDelay = `${idx * 24}ms`;
  });
}

// ---- 033_renderdrawdownchart.js ----
function renderDrawdownChart(drawdown, opts = {}) {
  const canvas = $("#drawdownChart");
  const meta = $("#drawdownMeta");
  if (!canvas || !meta) return;

  const series = Array.isArray(drawdown?.series) ? drawdown.series : [];
  const maxDrawdown = Number(drawdown?.max_drawdown || 0);
  const currentDrawdown = Number(drawdown?.current_drawdown || 0);
  meta.textContent = `Max ${fmtMoney(maxDrawdown)} · Courant ${fmtMoney(currentDrawdown)}`;
  setSignedClass(meta, currentDrawdown);

  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;

  // Cached getBoundingClientRect — refresh only on window resize
  if (!renderDrawdownChart._cachedRect || renderDrawdownChart._dirty) {
    renderDrawdownChart._cachedRect = canvas.getBoundingClientRect();
    renderDrawdownChart._dirty = false;
  }
  const rect = renderDrawdownChart._cachedRect;
  canvas.width = rect.width * dpr;
  canvas.height = 260 * dpr;
  ctx.scale(dpr, dpr);
  const w = rect.width;
  const h = 260;

  if (!series.length) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#7e85a3";
    ctx.font = "13px Inter,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Aucune donnée", w / 2, h / 2);
    return;
  }

  const pad = { l: 56, r: 22, t: 20, b: 36 };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;
  const values = series.map(d => Number(d.drawdown || 0));
  const minV = Math.min(...values, -1);
  const maxV = 0;
  const range = maxV - minV || 1;
  const n = series.length;
  const xStep = n === 1 ? cw : cw / (n - 1);
  const yFor = v => pad.t + ch - ((v - minV) / range) * ch;
  const zeroY = yFor(0);
  const points = series.map((d, i) => ({
    x: pad.l + i * xStep,
    y: yFor(Number(d.drawdown || 0)),
  }));

  function draw(progress) {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#7e85a3";
    ctx.font = "11px Inter,sans-serif";
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i += 1) {
      const v = minV + (range * i / 4);
      const y = yFor(v);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + cw, y);
      ctx.stroke();
      ctx.fillText(`${v.toFixed(0)}$`, pad.l - 8, y + 3);
    }

    const maxIdx = Math.max(0, Math.floor((n - 1) * progress));
    const t = (n - 1) * progress - maxIdx;
    const visible = points.slice(0, maxIdx + 1);
    if (maxIdx < n - 1) {
      const a = points[maxIdx];
      const b = points[maxIdx + 1];
      visible.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    if (visible.length < 2) return;

    const fillGrad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
    fillGrad.addColorStop(0, "rgba(255,78,107,0.30)");
    fillGrad.addColorStop(1, "rgba(255,78,107,0.02)");
    ctx.beginPath();
    ctx.moveTo(visible[0].x, zeroY);
    visible.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(visible[visible.length - 1].x, zeroY);
    ctx.closePath();
    ctx.fillStyle = fillGrad;
    ctx.fill();

    ctx.strokeStyle = "#ff4e6b";
    ctx.lineWidth = 2.2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(255,78,107,0.45)";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    visible.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  if (opts.animate && n > 1) {
    const duration = Math.min(900, 220 + n * 20);
    const start = performance.now();
    (function frame(now) {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      draw(eased);
      if (p < 1) requestAnimationFrame(frame);
    })(performance.now());
  } else {
    draw(1);
  }
}

// Invalidate cached rect on window resize
if (!renderDrawdownChart._listenerAttached) {
  window.addEventListener("resize", () => { renderDrawdownChart._dirty = true; });
  renderDrawdownChart._listenerAttached = true;
}

// ---- 034_cumulative_chart_canvas.js ----
// ---------- Cumulative chart (canvas) ----------

function renderCumChart(data, opts = {}) {
  const canvas = $("#cumChart");
  if (!canvas) return;
  const ctx  = canvas.getContext("2d");
  const dpr  = window.devicePixelRatio || 1;

  // Cached getBoundingClientRect — refresh only on window resize
  if (!renderCumChart._cachedRect || renderCumChart._dirty) {
    renderCumChart._cachedRect = canvas.getBoundingClientRect();
    renderCumChart._dirty = false;
  }
  const rect = renderCumChart._cachedRect;
  canvas.width  = rect.width * dpr;
  canvas.height = 320 * dpr;
  ctx.scale(dpr, dpr);
  const w = rect.width, h = 320;

  if (!data.length) {
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = "#7e85a3"; ctx.font = "13px Inter,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Aucune donnée", w/2, h/2);
    canvas.onmousemove = null;
    canvas.onmouseleave = null;
    const tt = $("#cumChartTooltip");
    if (tt) tt.style.display = "none";
    return;
  }

  const pad = { l:60, r:24, t:24, b:44 };
  const cw  = w - pad.l - pad.r;
  const ch  = h - pad.t - pad.b;
  const values = data.map(d => d.cumulative);
  let minV = Math.min(0, ...values), maxV = Math.max(0, ...values);
  if (minV === maxV) { minV -= 1; maxV += 1; }
  const range = maxV - minV;
  const zeroY = pad.t + ch - ((0 - minV) / range) * ch;
  const n     = data.length;
  const xStep = n === 1 ? cw : cw / (n-1);
  const points = data.map((d, i) => ({
    x: pad.l + i * xStep,
    y: pad.t + ch - ((d.cumulative - minV) / range) * ch,
    date: d.date, cum: d.cumulative,
  }));

  function drawBackground() {
    ctx.clearRect(0,0,w,h);
    ctx.strokeStyle = "rgba(255,255,255,0.04)"; ctx.lineWidth = 1;
    ctx.fillStyle = "#7e85a3"; ctx.font = "11px Inter,sans-serif"; ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const v = minV + (range * i / 4);
      const y = pad.t + ch - (i/4) * ch;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l+cw, y); ctx.stroke();
      ctx.fillText(v.toFixed(0)+"$", pad.l - 8, y + 3);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(pad.l, zeroY); ctx.lineTo(pad.l+cw, zeroY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#7e85a3"; ctx.textAlign = "center";
    const every = Math.max(1, Math.floor(n/6));
    points.forEach((p, i) => {
      if (i % every === 0 || i === n-1) ctx.fillText(p.date.slice(5), p.x, pad.t+ch+22);
    });
  }

  function drawCurveTo(progress) {
    drawBackground();
    if (progress <= 0) return;
    const idxF   = (n-1) * progress;
    const idx    = Math.floor(idxF);
    const t      = idxF - idx;
    const visible = points.slice(0, idx+1);
    if (idx < n-1) {
      const a = points[idx], b = points[idx+1];
      visible.push({ x: a.x+(b.x-a.x)*t, y: a.y+(b.y-a.y)*t });
    }
    if (visible.length < 2) return;

    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t+ch);
    grad.addColorStop(0, "rgba(0,229,255,0.30)");
    grad.addColorStop(1, "rgba(255,46,196,0.02)");
    ctx.beginPath();
    ctx.moveTo(visible[0].x, zeroY);
    visible.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(visible[visible.length-1].x, zeroY);
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill();

    const lineGrad = ctx.createLinearGradient(pad.l, 0, pad.l+cw, 0);
    lineGrad.addColorStop(0, "#00E5FF"); lineGrad.addColorStop(1, "#FF2EC4");
    ctx.strokeStyle = lineGrad; ctx.lineWidth = 2.4;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.shadowColor = "rgba(0,229,255,0.5)"; ctx.shadowBlur = 8;
    ctx.beginPath();
    visible.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke(); ctx.shadowBlur = 0;
    points.slice(0, idx+1).forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 3.2, 0, Math.PI*2);
      ctx.fillStyle = "#0b0c16"; ctx.fill();
      ctx.strokeStyle = "#00E5FF"; ctx.lineWidth = 2; ctx.stroke();
    });
  }

  if (opts.animate && n > 1) {
    const duration = Math.min(900, 200 + n*25);
    const start = performance.now();
    (function frame(now) {
      const eased = 1 - Math.pow(1 - Math.min(1, (now-start)/duration), 3);
      drawCurveTo(eased);
      if (eased < 1) requestAnimationFrame(frame);
    })(performance.now());
  } else {
    drawCurveTo(1);
  }

  function hideTooltip() {
    const tt = $("#cumChartTooltip");
    if (tt) tt.style.display = "none";
  }
  function showTooltip(point, clientX, clientY) {
    let tt = $("#cumChartTooltip");
    if (!tt) {
      tt = document.createElement("div");
      tt.id = "cumChartTooltip";
      tt.className = "chart-tooltip";
      document.body.appendChild(tt);
    }
    const pnlClass = point.cum > 0 ? "pos" : point.cum < 0 ? "neg" : "";
    tt.innerHTML = `<div class="chart-tt-date">${point.date}</div><div class="chart-tt-value ${pnlClass}">${fmtMoney(point.cum)}</div>`;
    tt.style.left = `${clientX}px`;
    tt.style.top = `${clientY - 10}px`;
    tt.style.display = "block";
  }

  canvas.onmouseleave = hideTooltip;
  canvas.onmousemove = evt => {
    if (!points.length) return;
    const cRect = canvas.getBoundingClientRect();
    const x = evt.clientX - cRect.left;
    if (x < pad.l || x > pad.l + cw) {
      hideTooltip();
      return;
    }
    let nearest = points[0];
    let minDx = Math.abs(x - nearest.x);
    for (let i = 1; i < points.length; i += 1) {
      const dx = Math.abs(x - points[i].x);
      if (dx < minDx) {
        minDx = dx;
        nearest = points[i];
      }
    }
    if (minDx > Math.max(18, xStep * 1.4)) {
      hideTooltip();
      return;
    }
    showTooltip(nearest, evt.clientX, evt.clientY);
  };
}

// Invalidate cached rect on window resize
if (!renderCumChart._listenerAttached) {
  window.addEventListener("resize", () => { renderCumChart._dirty = true; });
  renderCumChart._listenerAttached = true;
}

// =============================================================
//  BLOCK SYSTEM, MARKDOWN, HASHTAGS, CUSTOM BLOCKS
// =============================================================

const BLOCK_STATE_KEY = "cockpit:blockCollapsed";

function loadCollapsedBlocks() {
  try { return JSON.parse(localStorage.getItem(BLOCK_STATE_KEY) || "{}"); } catch { return {}; }
}
function saveCollapsedBlocks(state) {
  try { localStorage.setItem(BLOCK_STATE_KEY, JSON.stringify(state)); } catch {}
}
function slugify(s) {
  return String(s||"").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
}

// ---- 035_initblocks.js ----
var _initBlocksDelegationBound = false;

function initBlocks() {
  var collapsed = loadCollapsedBlocks();
  $$("#entryModal .block").forEach(function (block) {
    var head = block.querySelector(".block-h");
    if (!head) return;
    if (!block.dataset.bid) {
      block.dataset.bid = slugify(head.textContent.trim().split(/\s+/).slice(0, 4).join(" "));
    }
    var bid = block.dataset.bid;
    if (!head.querySelector(".chevron")) {
      var sum = document.createElement("span"); sum.className = "block-summary";
      var spc = document.createElement("span"); spc.className = "block-h-spacer";
      var chev = document.createElement("button");
      chev.type = "button"; chev.className = "chevron"; chev.title = "Replier / déplier";
      chev.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
      head.append(sum, spc, chev);
    }
    if (collapsed[bid]) block.classList.add("collapsed");
    updateBlockSummary(block);
  });

  if (_initBlocksDelegationBound) return;
  _initBlocksDelegationBound = true;
  $("#entryModal")?.addEventListener("click", function (e) {
    if (e.target.closest("button:not(.chevron), input, select, textarea, .pill-choice")) return;
    var head = e.target.closest(".block-h");
    if (!head) return;
    var block = head.closest(".block");
    if (!block) return;
    var bid = block.dataset.bid;
    var willOpen = block.classList.contains("collapsed");
    if (willOpen && document.querySelector("#entryModal.modal-trade-focus")) {
      $$("#tradeFormSection .block").forEach(function (other) {
        if (other === block || other.classList.contains("hidden")) return;
        other.classList.add("collapsed");
        var oid = other.dataset.bid;
        if (oid) {
          var oc = loadCollapsedBlocks();
          oc[oid] = true;
          saveCollapsedBlocks(oc);
        }
        updateBlockSummary(other);
      });
    }
    block.classList.toggle("collapsed");
    var c = loadCollapsedBlocks();
    c[bid] = block.classList.contains("collapsed");
    saveCollapsedBlocks(c);
    updateBlockSummary(block);
    if (typeof refreshTradeFlowNavState === "function") refreshTradeFlowNavState();
  });
}

function updateBlockSummary(block) {
  const sum = block.querySelector(".block-summary");
  if (!sum) return;
  const parts = [];
  block.querySelectorAll(".pills .pill-choice.active").forEach(p => parts.push(p.textContent.trim()));
  block.querySelectorAll("textarea, input[type='text'], input[type='number']").forEach(inp => {
    if (parts.length >= 3) return;
    const v = (inp.value || "").trim();
    if (v && inp.id !== "tagsInputField")
      parts.push(v.length > 28 ? v.slice(0,28)+"…" : v);
  });
  const q = block.querySelector("#executionQuality")?.value;
  if (q) parts.push("★".repeat(Number(q)));
  sum.textContent = parts.filter(Boolean).slice(0,4).join(" · ");
}

// ---- 036_markdown_preview.js ----
// ---------- Markdown preview ----------

const MARKDOWN_FIELDS = ["htfContext","midnightOpen","dailyNotes","whyTrade","whyEntry","whyStop","stdvLevel","lessonsLearned"];

function bindMarkdownToggles() {
  MARKDOWN_FIELDS.forEach(fid => {
    const ta    = document.getElementById(fid);
    if (!ta) return;
    const field = ta.closest(".field");
    if (!field || field.querySelector(".field-h")) return;
    const label = field.querySelector("label");
    if (!label) return;

    const h   = document.createElement("div"); h.className = "field-h";
    label.parentNode.insertBefore(h, label);
    h.appendChild(label);
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "field-toggle"; btn.title = "Aperçu Markdown";
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    h.appendChild(btn);
    const prev  = document.createElement("div");
    prev.className = "md-preview hidden"; prev.id = fid + "Preview";
    ta.after(prev);
    btn.addEventListener("click", () => {
      const isPreview = btn.classList.toggle("active");
      if (isPreview) {
        prev.innerHTML = renderMarkdown(ta.value) || `<span class="md-empty">— rien à prévisualiser —</span>`;
        prev.classList.remove("hidden"); ta.classList.add("hidden");
      } else {
        prev.classList.add("hidden"); ta.classList.remove("hidden"); ta.focus();
      }
    });
  });
}

function renderMarkdown(text) {
  if (!text) return "";
  let html = escapeHtml(text);
  html = html.replace(/```([\s\S]*?)```/g, (_, code) =>
    `<pre style="background:rgba(0,0,0,0.3);padding:10px 12px;border-radius:8px;overflow-x:auto;font-family:JetBrains Mono,monospace;font-size:12px;color:var(--cyan);border:1px solid var(--border)"><code>${code}</code></pre>`);
  html = html.replace(/^### (.+)$/gm,"<h3>$1</h3>").replace(/^## (.+)$/gm,"<h2>$1</h2>").replace(/^# (.+)$/gm,"<h1>$1</h1>");
  html = html.replace(/^&gt; (.+)$/gm,"<blockquote>$1</blockquote>");
  html = html.replace(/^---+$/gm,"<hr>");
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,'<img src="$2" alt="$1" class="md-inline-image" loading="lazy">');
  html = html.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>");
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g,"<em>$1</em>");
  html = html.replace(/`([^`]+)`/g,"<code>$1</code>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/(^|[\s,;])#([a-zA-Z][\w-]*)/g,'$1<span class="md-tag">#$2</span>');
  html = html.replace(/^([-*]) (.+)$/gm,"<li>$2</li>");
  html = html.replace(/(?:<li>.*<\/li>\s*)+/g, m => `<ul>${m}</ul>`);
  html = html.replace(/\n(?!<\/?(h[1-3]|ul|li|blockquote|hr|pre))/g,"<br>");
  return html;
}

// ---- 037_hashtag_auto_extraction.js ----
// ---------- Hashtag auto-extraction ----------

function bindHashtagSync() {
  MARKDOWN_FIELDS.forEach(fid => {
    document.getElementById(fid)?.addEventListener("blur", syncHashtagsFromText);
  });
}
function syncHashtagsFromText() {
  const allText = MARKDOWN_FIELDS.map(fid => document.getElementById(fid)?.value || "").join(" ");
  const found   = [...new Set([...allText.matchAll(/(?:^|[\s,;.])#([a-zA-Z][\w-]+)/g)].map(m => m[1]))];
  found.forEach(t => addTag(t));
}

// ---- 038_custom_blocks.js ----
// ---------- Custom blocks ----------

var _customBlocksDelegationBound = false;

function _bindCustomBlocksDelegation() {
  if (_customBlocksDelegationBound) return;
  var list = $("#customBlocksList");
  if (!list) return;
  _customBlocksDelegationBound = true;
  list.addEventListener("click", function (e) {
    var del = e.target.closest(".custom-block-delete");
    if (!del) return;
    var block = del.closest(".custom-block");
    if (block) block.remove();
  });
}

function bindCustomBlocks() {
  _bindCustomBlocksDelegation();
  $("#addBlockBtn")?.addEventListener("click", function () {
    addCustomBlock({ id: "", title: "", content: "" });
    var last = $("#customBlocksList .custom-block:last-child .custom-block-title");
    if (last) setTimeout(function () { last.focus(); }, 50);
  });
}

function addCustomBlock(block) {
  _bindCustomBlocksDelegation();
  var list = $("#customBlocksList");
  if (!list) return;
  var id = block.id || "cb_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
  var el = document.createElement("div");
  el.className = "block custom-block";
  el.dataset.cbid = id;
  el.innerHTML = `
    <div class="block-h">
      <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>
      <input type="text" class="custom-block-title" placeholder="TITRE DU BLOC" />
      <button type="button" class="custom-block-delete" title="Supprimer ce bloc">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    </div>
    <div class="field" style="margin-bottom:0">
      <textarea class="custom-block-content" rows="3" placeholder="Tape ce que tu veux ici… Markdown supporté."></textarea>
    </div>`;
  el.querySelector(".custom-block-title").value   = block.title   || "";
  el.querySelector(".custom-block-content").value = block.content || "";
  list.appendChild(el);
}

function getCustomBlocks() {
  return [...$$("#customBlocksList .custom-block")].map(el => ({
    id:      el.dataset.cbid,
    title:   el.querySelector(".custom-block-title")?.value   || "",
    content: el.querySelector(".custom-block-content")?.value || "",
  })).filter(b => b.title.trim() || b.content.trim());
}

// =============================================================
//  NARRATION AUTO-FILL
// =============================================================

const NARRATION_CHIP_MAP = {
  pnl:              { label:"PnL",       color: v => v>0?"lime":"rose",    fmt: v => (v>0?"+":"")+v+"$" },
  rr:               { label:"RR",        color: ()=>"cyan",                fmt: v => v+"R" },
  is_win:           { label:"Résultat",  color: v => v?"lime":"rose",       fmt: v => v?"WIN ✓":"LOSS ✗" },
  strategy:         { label:"Stratégie", color: ()=>"violet",              fmt: v => prettify(v) },
  direction:        { label:"Direction", color: v => v==="long"?"lime":"rose", fmt: v => v.toUpperCase() },
  _htf_bias:        { label:"HTF Bias",  color: v => v==="bullish"?"lime":v==="bearish"?"rose":"amber", fmt: v => v.charAt(0).toUpperCase()+v.slice(1) },

  thesis_validated: { label:"Thèse",     color: v => v==="yes"?"lime":v==="no"?"rose":"amber", fmt: v => ({yes:"Validée ✓",no:"Invalidée ✗",partial:"Partielle ~"})[v]||v },
  tags:             { label:"Tags",      color: ()=>"magenta",             fmt: v => Array.isArray(v)?v.map(t=>"#"+t).join(" "):v },
};

function bindNarration() {
  const panel    = $("#narrationPanel");
  const closeBtn = $("#narrationClose");
  const parseBtn = $("#narrationParseBtn");
  const retryBtn = $("#narrationRetryBtn");
  const openBtn  = $("#narrationBtn");
  const textarea = $("#narrationText");
  if (!panel) return;

  openBtn?.addEventListener("click", () => {
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) setTimeout(() => textarea?.focus(), 80);
  });
  closeBtn?.addEventListener("click", () => panel.classList.add("hidden"));
  parseBtn?.addEventListener("click", () => runNarrationParse());
  retryBtn?.addEventListener("click", () => runNarrationParse());
  textarea?.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); runNarrationParse(); }
  });
}

async function runNarrationParse() {
  const textarea = $("#narrationText");
  const parseBtn = $("#narrationParseBtn");
  const retryBtn = $("#narrationRetryBtn");
  const btnLabel = $("#narrationBtnLabel");
  const preview  = $("#narrationPreview");
  const sourceEl = $("#narrationSource");
  const text = textarea?.value?.trim();
  if (!text) { toast("Décris d'abord ton trade", "error"); return; }

  parseBtn.disabled = true;
  if (retryBtn) retryBtn.classList.add("hidden");
  if (btnLabel) btnLabel.textContent = "Analyse en cours…";
  if (preview)  preview.classList.add("hidden");

  try {
    const data = await api("/api/parse-trade", {
      method: "POST", body: JSON.stringify({ text }),
    });
    if (sourceEl) {
      sourceEl.textContent = data._source === "claude" ? "✦ Claude AI" : "⚙ Regex";
      if (data._warning) sourceEl.textContent += " · fallback";
    }
    if (data._warning) {
      toast(data._warning, "error");
      if (retryBtn && data._retryable) retryBtn.classList.remove("hidden");
    }
    renderNarrationPreview(data, preview);
    const followUps = getNarrationFollowUps(data);
    if (followUps.length) {
      toast(`Challenge rapide: ${followUps.length} point(s) a completer`, "error");
    }
  } catch (err) {
    toast("Erreur analyse : " + err.message, "error");
    if (retryBtn) retryBtn.classList.remove("hidden");
  } finally {
    parseBtn.disabled = false;
    if (btnLabel) btnLabel.textContent = "Analyser & remplir";
  }
}

function renderNarrationPreview(data, container) {
  if (!container) return;
  const followUps = getNarrationFollowUps(data);
  const fields = Object.keys(NARRATION_CHIP_MAP).filter(k => data[k] != null);
  if (!fields.length && !followUps.length) {
    container.innerHTML = `<div class="narration-preview-title">Résultat</div>
      <p class="narration-none">Aucun champ détecté — sois plus précis dans ta description.</p>`;
    container.classList.remove("hidden");
    return;
  }
  const COLORS = new Set(["lime","rose","cyan","violet","amber","magenta"]);
  const chips  = fields.map((k, i) => {
    const cfg   = NARRATION_CHIP_MAP[k];
    const val   = data[k];
    const color = COLORS.has(cfg.color(val)) ? cfg.color(val) : "cyan";
    return `<span class="nc ${color}" style="animation-delay:${i*40}ms">
      <span class="nc-label">${escapeHtml(cfg.label)}</span>${escapeHtml(cfg.fmt(val))}
    </span>`;
  }).join("");
  const chipsSection = fields.length ? `
    <div class="narration-preview-title">Champs détectés — ${fields.length}</div>
    <div class="narration-chips">${chips}</div>` : "";
  const followUpSection = followUps.length ? `
    <div class="narration-preview-title">Challenge rapide — ${followUps.length} point(s)</div>
    <div class="narration-chat-list">
      ${followUps.map((q, i) => `
      <div class="narration-chat-item" style="animation-delay:${i * 50}ms">
        <div class="narration-chat-role">Assistant</div>
        <div class="narration-chat-q">${escapeHtml(q.question)}</div>
      </div>`).join("")}
    </div>
    <div class="narration-chat-help">Reponds dans la zone texte, puis relance “Analyser & remplir”.</div>
    <div class="narration-followup-row">
      <button type="button" class="btn-ghost" id="narrationInsertFollowupsBtn">Copier le challenge dans le chat</button>
    </div>` : "";
  container.innerHTML = `${chipsSection}${followUpSection}
    <div class="narration-apply-row">
      <button type="button" class="narration-apply-btn" id="narrationApplyBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        Appliquer au formulaire
      </button>
    </div>`;
  container.classList.remove("hidden");
  $("#narrationApplyBtn")?.addEventListener("click", () => applyNarrationToForm(data));
  $("#narrationInsertFollowupsBtn")?.addEventListener("click", () => injectNarrationFollowUps(followUps));
}

function getNarrationFollowUps(data) {
  const raw = Array.isArray(data?._follow_up_questions) ? data._follow_up_questions : [];
  return raw.map(item => {
    if (typeof item === "string") return { field: "", question: item };
    return {
      field: String(item?.field || ""),
      question: String(item?.question || ""),
    };
  }).filter(item => item.question.trim());
}

function injectNarrationFollowUps(followUps) {
  const textarea = $("#narrationText");
  if (!textarea || !followUps.length) return;
  const block = `\n\nQuestions a completer:\n${followUps.map(q => `- ${q.question}`).join("\n")}\n`;
  if (!textarea.value.includes("Questions a completer:")) {
    textarea.value = (textarea.value || "").trimEnd() + block;
  } else {
    textarea.value = (textarea.value || "").trimEnd() + "\n" + followUps.map(q => `- ${q.question}`).join("\n") + "\n";
  }
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
}

function applyNarrationToForm(data) {
  const d = { ...data };
  delete d._source;

  // Champs du jour
  if (d._htf_bias) setPill("htf_bias", d._htf_bias);

  // Champs du trade (si le formulaire de trade est ouvert)
  const tradeFormOpen = !$("#tradeFormSection")?.classList.contains("hidden");
  if (tradeFormOpen) {
    if (d.strategy)        setPill("strategy",         d.strategy);
    if (d.direction)       setPill("direction",        d.direction);

    if (d.thesis_validated) setPill("thesis_validated", d.thesis_validated);
    if (d.why_trade)       { const el = $("#whyTrade"); if (el) el.value = d.why_trade; }
    if (d.why_entry)       { const el = $("#whyEntry"); if (el) el.value = d.why_entry; }
    if (d.scenario)        { const el = $("#scenario"); if (el) el.value = d.scenario; }
    if (d.why_stop)        { const el = $("#whyStop"); if (el) el.value = d.why_stop; }
    if (d.why_tp)          { const el = $("#whyTp"); if (el) el.value = d.why_tp; }
    if (d.stdv_level != null) { const el = $("#stdvLevel"); if (el) el.value = d.stdv_level; }
    if (d.pnl != null)     { const el = $("#pnl");  if (el) el.value = d.pnl; }
    if (d.rr  != null)     { const el = $("#rr");   if (el) el.value = d.rr; }
    if (d.is_win != null)  { const el = $("#isWin"); if (el) el.value = String(d.is_win); }
    if (Array.isArray(d.tags)) d.tags.forEach(t => addTag(t));
    updateRRPreview();
    if (typeof renderMidnightChallenge === "function") renderMidnightChallenge();
  }
  $("#narrationPanel")?.classList.add("hidden");
  const missing = Array.isArray(d._missing_fields) ? d._missing_fields : [];
  if (missing.length) {
    toast(`Champs appliqués (fiche partielle: ${missing.length} infos manquantes)`, "error");
  } else {
    toast("Champs appliqués ✓", "success");
  }
}

// ---- 039_helpers.js ----
// ---------- Helpers ----------

function _lastInstrument() {
  const raw = String(state.allDays[0]?.instrument || "BTC").toUpperCase();
  return raw === "NAS" ? "NQ" : raw;
}

// ---- 040_wizard_core.js ----
/* ============================================================
   WIZARD MODULE — Scenario Logger
   ============================================================ */

const WIZ_DRAFT_KEY = 'cockpit:wizard_draft:v3';

let wizState = null;

// WIZ_INSTRUMENTS supprime — utiliser INSTRUMENTS depuis 001_utilities.js
const STEPS_TRADE = ['date','instrument','strategy','day_context','why_trade','why_entry','why_stop_tp','levels','screenshots','recap'];
const STEPS_PM = ['pm_exit','pm_quality','pm_lessons'];

const STRATEGY_HINTS = {
  midnight_model: {
    why_trade:   "Quel setup Midnight Model justifie ce trade ? (ex: London pre-market, range overnight, etc.)",
    why_entry:   "Trigger d'entree Midnight : LVN, liquidite overnight, gap fill...",
    why_stop_tp: "Stop : au-dela du range overnight.  TP : prochaine zone LVN ou HVN.",
  },
  london_model: {
    why_trade:   "Quel setup London Model ? (ex: ouverture London, sweep d'Asian range, LVN London...)",
    why_entry:   "Trigger d'entree London : cassure de session, LVN, rejet sur VWAP...",
    why_stop_tp: "Stop : au-dela du swing London.  TP : niveau LVN ou R:R cible.",
  },
  ny_model: {
    why_trade:   "Quel setup NY Model ? (ex: continuation post-London, LVN NY, rotation...)",
    why_entry:   "Trigger d'entree NY : rejet VWAP, LVN, cassure intraday...",
    why_stop_tp: "Stop : invalidation du setup NY.  TP : objectif de session ou LVN.",
  },
  default: {
    why_trade:   "Pourquoi ce trade est-il aligne avec votre plan du jour ?",
    why_entry:   "Quel signal ou configuration vous a declenche ?",
    why_stop_tp: "Logique de placement du stop et de l'objectif.",
  }
};

function _wizHint(field) {
  const strat = wizState?.data?.strategy || 'default';
  return (STRATEGY_HINTS[strat] || STRATEGY_HINTS.default)[field] || '';
}

function wizCanonicalInstrument(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  return raw === "NAS" ? "NQ" : raw;
}

function wizInstrumentLabel(value) {
  const canonical = wizCanonicalInstrument(value);
  return canonical;
}

function wizDefaultInstrument() {
  const fromFilter = wizCanonicalInstrument(state?.statsInstrument || "");
  if (INSTRUMENTS.includes(fromFilter)) return fromFilter;
  if (typeof _lastInstrument === "function") {
    const last = wizCanonicalInstrument(_lastInstrument());
    if (INSTRUMENTS.includes(last)) return last;
  }
  return "BTC";
}

// ─── Open / Close ──────────────────────────────────────────

var _wizLastFocused = null;

function wizOpen(opts) {
  _wizLastFocused = document.activeElement;
  opts = opts || {};
  const mode = opts.mode === 'postmortem' ? 'postmortem' : 'trade';
  const instrument = wizCanonicalInstrument(opts.instrument || "") || wizDefaultInstrument();
  const strategy = String(opts.strategy || "midnight_model").trim() || "midnight_model";
  const draft = _wizLoadDraft();

  wizState = {
    mode:    mode,
    stepIdx: opts.date ? 1 : 0,
    steps:   mode === 'postmortem' ? STEPS_PM : STEPS_TRADE,
    data: {
      date:         opts.date        || todayKey(),
      instrument:   instrument       || '',
      strategy:     strategy,
      htf_bias:     '',
    htf_context:  '',
      daily_notes:  '',
      tags:         [],
      scenario:     '',
      why_trade:    '',
      why_entry:    '',
      why_stop:     '',
      why_tp:       '',
      direction:    '',
      entry_price:  '',
      stop_loss:    '',
      take_profit:  '',
      stdv_level:   '',
      screenshots:  [],
      exit_price:   '',
      exit_quality: 0,

      lessons:      '',
      missing_chat_text: '',
      missing_followups: [],
      tradeId:      opts.tradeId || null,
      dayId:        opts.dayId   || null,
    },
    hasDraft: !!(draft && mode !== 'postmortem'),
    _draft:   draft || null,
  };

  _wizRender();
  const el = document.getElementById('wiz');
  if (el) {
    el.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
}

function wizClose() {
  const el = document.getElementById('wiz');
  if (el) el.classList.add('hidden');
  document.body.style.overflow = '';
  wizState = null;
  if (_wizLastFocused) { _wizLastFocused.focus(); _wizLastFocused = null; }
}

// ─── Draft ─────────────────────────────────────────────────

function _wizSaveDraft() {
  if (!wizState || wizState.mode === 'postmortem') return;
  try {
    localStorage.setItem(WIZ_DRAFT_KEY, JSON.stringify({
      stepIdx: wizState.stepIdx,
      data: wizState.data
    }));
  } catch(e) {}
}

function _wizLoadDraft() {
  try { return JSON.parse(localStorage.getItem(WIZ_DRAFT_KEY)); } catch(e) { return null; }
}

function _wizClearDraft() {
  localStorage.removeItem(WIZ_DRAFT_KEY);
}

function wizResumeDraft() {
  if (!wizState || !wizState._draft) return;
  wizState.data     = Object.assign(wizState.data, wizState._draft.data);
  wizState.stepIdx  = wizState._draft.stepIdx || 0;
  wizState.hasDraft = false;
  _wizRender();
}

function wizDiscardDraft() {
  _wizClearDraft();
  if (wizState) { wizState.hasDraft = false; }
  _wizRender();
}

// ─── Navigation ────────────────────────────────────────────

function wizNext() {
  if (!wizState) return;
  _wizSaveCurrentStep();
  if (wizState.stepIdx < wizState.steps.length - 1) {
    wizState.stepIdx++;
    _wizSaveDraft();
    _wizRender();
  } else {
    _wizSubmit();
  }
}

function wizBack() {
  if (!wizState) return;
  if (wizState.stepIdx > 0) {
    wizState.stepIdx--;
    _wizRender();
  } else {
    wizClose();
  }
}

// ---- 041_wizskip.js ----
function wizSkip() {
  if (!wizState) return;
  if (wizState.stepIdx < wizState.steps.length - 1) {
    wizState.stepIdx++;
    _wizRender();
  } else {
    _wizSubmit();
  }
}

function wizGoTo(idx) {
  if (!wizState) return;
  wizState.stepIdx = idx;
  _wizRender();
}

// ─── Save current step values ──────────────────────────────

function _wizSaveCurrentStep() {
  if (!wizState) return;
  const step = wizState.steps[wizState.stepIdx];
  const d    = wizState.data;

  switch (step) {
    case 'date':
      d.date = _q('#wizDate')?.value || d.date;
      break;
    case 'day_context':
      d.htf_bias      = _wizActivePill('.wiz-bias')         || d.htf_bias;
      d.htf_context   = _q('#wizHtfContext')?.value         || d.htf_context;
      d.daily_notes   = _q('#wizDailyNotes')?.value         || d.daily_notes;
      break;
    case 'why_trade':
      d.why_trade = _q('#wizWhyTrade')?.value || d.why_trade;
      break;
    case 'why_entry':
      d.why_entry = _q('#wizWhyEntry')?.value || d.why_entry;
      break;
    case 'why_stop_tp':
      d.why_stop = _q('#wizWhyStop')?.value || d.why_stop;
      d.why_tp   = _q('#wizWhyTp')?.value   || d.why_tp;
      break;
    case 'levels':
      d.direction    = _wizActiveDir()               || d.direction;
      d.entry_price  = _q('#wizEntry')?.value        || d.entry_price;
      d.stop_loss    = _q('#wizStop')?.value         || d.stop_loss;
      d.take_profit  = _q('#wizTarget')?.value       || d.take_profit;
      d.stdv_level   = _q('#wizStdv')?.value         || d.stdv_level;
      break;
    case 'pm_exit':
      d.exit_price  = _q('#wizExitPrice')?.value    || d.exit_price;

      break;
    case 'pm_lessons':
      d.lessons = _q('#wizLessons')?.value || d.lessons;
      break;
    case 'recap':
      d.missing_chat_text = _q('#wizMissingChat')?.value || '';
      break;
  }
}

function _q(sel) { return document.querySelector(sel); }

function _wizActivePill(cls) {
  return document.querySelector(cls + '.active')?.dataset.value || '';
}

function _wizActiveDir() {
  const el = document.querySelector('.wiz-dir-btn[class*="active-"]');
  return el ? el.dataset.dir : '';
}

// ─── Render ────────────────────────────────────────────────

function _wizRender() {
  if (!wizState) return;
  const step  = wizState.steps[wizState.stepIdx];
  const total = wizState.steps.length;
  const idx   = wizState.stepIdx;

  // Progress bar
  const fill = document.getElementById('wizProgressFill');
  if (fill) fill.style.transform = 'scaleX(' + (((idx + 1) / total)) + ')';

  // Step indicator
  const indicator = document.getElementById('wizStepIndicator');
  if (indicator) indicator.textContent = (idx + 1) + ' / ' + total;

  // Back button
  const backBtn = document.getElementById('wizBackBtn');
  if (backBtn) backBtn.classList.toggle('invisible', idx === 0);

  // Body
  const body = document.getElementById('wizBody');
  if (body) body.innerHTML = _wizStepHtml(step);

  // Footer
  _wizRenderFooter(step, idx, total);

  // Post-render
  _wizAfterRender(step);
}

function _wizRenderFooter(step, idx, total) {
  const isLast    = idx === total - 1;
  const skippable = !isLast;
  const skipBtn   = document.getElementById('wizSkipBtn');
  const nextBtn   = document.getElementById('wizNextBtn');

  if (skipBtn) skipBtn.classList.toggle('invisible', !skippable);

  if (nextBtn) {
    if (isLast) {
      nextBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Enregistrer';
    } else {
      nextBtn.innerHTML = 'Suivant <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>';
    }
  }
}

// ─── Step HTML ─────────────────────────────────────────────

function _wizStepHtml(step) {
  switch (step) {
    case 'date':        return _wizStepDate();
    case 'instrument':  return _wizStepInstrument();
    case 'strategy':    return _wizStepStrategy();
    case 'day_context': return _wizStepDayContext();
    case 'why_trade':   return _wizStepWhyTrade();
    case 'why_entry':   return _wizStepWhyEntry();
    case 'why_stop_tp': return _wizStepWhyStopTp();
    case 'levels':      return _wizStepLevels();
    case 'screenshots': return _wizStepScreenshots();
    case 'recap':       return _wizStepRecap();
    case 'pm_exit':     return _wizStepPmExit();
    case 'pm_quality':  return _wizStepPmQuality();
    case 'pm_lessons':  return _wizStepPmLessons();
    default:            return '<p>Etape inconnue</p>';
  }
}

function _wizChip() {
  const strat = wizState.data.strategy;
  if (!strat) return '';
  return '<div class="wiz-strategy-chip"><span class="wiz-strategy-chip-dot"></span>' + prettify(strat) + '</div>';
}

// ── Date ──

function _wizStepDate() {
  const d       = wizState.data;
  const today   = todayKey();
  const yest    = (function() { var dt = new Date(); dt.setDate(dt.getDate()-1); return dt.toISOString().slice(0,10); })();
  var draftHtml = '';

  if (wizState.hasDraft && wizState._draft) {
    var dd = wizState._draft.data;
    draftHtml = '<div class="wiz-draft-banner">'
      + '<div class="wiz-draft-banner-text">Brouillon : ' + (dd.date||'') + ' ' + (wizInstrumentLabel(dd.instrument)||'') + ' ' + prettify(dd.strategy||'')
      + '  <span class="wiz-draft-yes" onclick="wizResumeDraft()">Reprendre</span>'
      + '  <span class="wiz-draft-no"  onclick="wizDiscardDraft()">Ignorer</span>'
      + '</div></div>';
  }

  return draftHtml
    + '<div class="wiz-question">Quelle date ?</div>'
    + '<div class="wiz-hint">Date du trade (YYYY-MM-DD)</div>'
    + '<input type="date" class="wiz-input" id="wizDate" value="' + (d.date||today) + '">'
    + '<div class="wiz-date-shortcuts">'
    + '<button class="wiz-date-btn' + (d.date===today?' active':'') + '" onclick="wizSetDate(\'' + today + '\')">Aujourd\'hui</button>'
    + '<button class="wiz-date-btn' + (d.date===yest?' active':'') + '" onclick="wizSetDate(\'' + yest  + '\')">Hier</button>'
    + '</div>';
}

// ---- 042_wizsetdate.js ----
function wizSetDate(dt) {
  if (!wizState) return;
  wizState.data.date = dt;
  var el = document.getElementById('wizDate');
  if (el) el.value = dt;
  var today = todayKey();
  document.querySelectorAll('.wiz-date-btn').forEach(function(b) {
    var label = b.textContent.trim();
    b.classList.toggle('active', (label === "Aujourd'hui" && dt === today) || (label === 'Hier' && dt !== today));
  });
}

// ── Instrument ──

function _wizStepInstrument() {
  var d = wizState.data;
  var instruments = [
    { id:'ES',  label:'ES',  icon:'&#x1F4C8;', sub:'S&amp;P 500 Futures' },
    { id:'NQ', label:'NQ',  icon:'&#x1F4BB;', sub:'Nasdaq Futures' },
    { id:'BTC', label:'BTC', icon:'&#x20BF;',  sub:'Bitcoin' },
    { id:'ETH', label:'ETH', icon:'&#926;',    sub:'Ethereum' },
  ];
  var html = '<div class="wiz-question">Quel instrument ?</div><div class="wiz-cards">';
  instruments.forEach(function(i) {
    html += '<div class="wiz-card' + (d.instrument===i.id?' active':'') + '" onclick="wizSelectInstrument(\'' + i.id + '\')">'
      + '<div class="wiz-card-icon">' + i.icon + '</div>'
      + '<div class="wiz-card-main">' + i.label + '</div>'
      + '<div class="wiz-card-sub">'  + i.sub + '</div>'
      + '</div>';
  });
  return html + '</div>';
}

function wizSelectInstrument(id) {
  if (!wizState) return;
  wizState.data.instrument = wizCanonicalInstrument(id);
  _wizRender();
  setTimeout(wizNext, 200);
}

// ── Strategy ──

function _wizStepStrategy() {
  var d = wizState.data;
  var defaults = [
    { id:'midnight_model', icon:'&#x1F319;', main:'Midnight Model', sub:'Range overnight &amp; London pre-market' },
    { id:'london_model',   icon:'&#x1F1EC;&#x1F1E7;', main:'London Model', sub:'Ouverture &amp; session London' },
    { id:'ny_model',       icon:'&#x1F5FD;', main:'NY Model', sub:'Session New York &amp; continuation' },
  ];
  var custom = (state?.settings?.custom_strategies || []).map(function(s) {
    return {
      id: String(s.value || '').trim(),
      icon: '&#x2728;',
      main: escapeHtml(String(s.label || s.value || '').trim() || prettify(s.value)),
      sub: 'Strategie custom',
    };
  }).filter(function(s) { return !!s.id; });
  var byId = {};
  var strategies = [];
  defaults.concat(custom).forEach(function(s) {
    if (byId[s.id]) return;
    byId[s.id] = true;
    strategies.push(s);
  });
  if (d.strategy && !byId[d.strategy]) {
    strategies.push({
      id: d.strategy,
      icon: '&#x2728;',
      main: escapeHtml(prettify(d.strategy)),
      sub: 'Strategie detectee',
    });
  }

  var cardsClass = strategies.length <= 3 ? 'wiz-cards wiz-cards-3' : 'wiz-cards';
  var html = '<div class="wiz-question">Quelle strategie ?</div>'
    + '<div class="wiz-hint">3 modeles de base + tes strategies custom des Settings.</div>'
    + '<div class="' + cardsClass + '">';
  strategies.forEach(function(s) {
    var sid = String(s.id).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    html += '<div class="wiz-card' + (d.strategy===s.id?' active':'') + '" onclick="wizSelectStrategy(\'' + sid + '\')">'
      + '<div class="wiz-card-icon">' + s.icon + '</div>'
      + '<div class="wiz-card-main">' + s.main + '</div>'
      + '<div class="wiz-card-sub">'  + s.sub  + '</div>'
      + '</div>';
  });
  return html + '</div>';
}

function wizSelectStrategy(id) {
  if (!wizState) return;
  wizState.data.strategy = id;
  _wizRender();
  setTimeout(wizNext, 200);
}

// ── Day Context ──

function _wizStepDayContext() {
  var d = wizState.data;
  var isMidnight = d.strategy === 'midnight_model';
  var biases = [
    { value:'bullish', label:'Bullish', tone:'lime' },
    { value:'bearish', label:'Bearish', tone:'rose' },
    { value:'neutral', label:'Neutral', tone:'' },
  ];

  var biasHtml = biases.map(function(b) {
    return '<button class="wiz-pill wiz-bias' + (d.htf_bias===b.value?' active':'') + (b.tone?' '+b.tone:'') + '" data-value="' + b.value + '" onclick="wizTogglePill(this,\'htf_bias\')">' + b.label + '</button>';
  }).join('');

  var midnightField = '';

  return '<div class="wiz-question">Contexte du jour</div>'
    + '<div class="wiz-hint">Contexte global du jour. Le champ Open Midnight apparait uniquement pour Midnight Model.</div>'
    + '<div class="wiz-field"><label class="wiz-label">HTF Bias</label><div class="wiz-pills">' + biasHtml + '</div></div>'
    + '<div class="wiz-field">'
    +   '<label class="wiz-label">Analyse HTF</label>'
    +   '<textarea class="wiz-textarea" id="wizHtfContext" placeholder="Structure, niveaux clés, invalidation..." rows="3">' + (d.htf_context||'') + '</textarea>'
    + '</div>'
    + midnightField
    + '<div class="wiz-field">'
    +   '<label class="wiz-label">Notes du jour</label>'
    +   '<textarea class="wiz-textarea" id="wizDailyNotes" placeholder="Contexte macro, alertes, discipline du jour...">' + (d.daily_notes||'') + '</textarea>'
    + '</div>';
}

function wizTogglePill(el, field) {
  var group = el.parentElement.querySelectorAll('.wiz-pill');
  var wasActive = el.classList.contains('active');
  group.forEach(function(p) { p.classList.remove('active'); });
  if (!wasActive) {
    el.classList.add('active');
    if (wizState) wizState.data[field] = el.dataset.value;
  } else {
    if (wizState) wizState.data[field] = '';
  }
}

// ── Why Trade ──

function _wizStepWhyTrade() {
  var d = wizState.data;
  return _wizChip()
    + '<div class="wiz-question">Pourquoi ce trade ?</div>'
    + '<div class="wiz-hint">' + _wizHint('why_trade') + '</div>'
    + '<textarea class="wiz-textarea lg" id="wizWhyTrade" placeholder="Alignement avec le plan, setup identifie...">' + (d.why_trade||'') + '</textarea>';
}

// ── Why Entry ──

function _wizStepWhyEntry() {
  var d = wizState.data;
  return _wizChip()
    + '<div class="wiz-question">Pourquoi cette entree ?</div>'
    + '<div class="wiz-hint">' + _wizHint('why_entry') + '</div>'
    + '<textarea class="wiz-textarea lg" id="wizWhyEntry" placeholder="Signal declencheur, confirmation, timing...">' + (d.why_entry||'') + '</textarea>';
}

// ── Why Stop + TP (combined) ──

function _wizStepWhyStopTp() {
  var d = wizState.data;
  return _wizChip()
    + '<div class="wiz-question">Stop &amp; objectif</div>'
    + '<div class="wiz-hint">' + _wizHint('why_stop_tp') + '</div>'
    + '<div class="wiz-field">'
    +   '<label class="wiz-label">Pourquoi ce stop</label>'
    +   '<textarea class="wiz-textarea" id="wizWhyStop" placeholder="Invalidation du setup, zone de protection...">' + (d.why_stop||'') + '</textarea>'
    + '</div>'
    + '<div class="wiz-divider"></div>'
    + '<div class="wiz-field">'
    +   '<label class="wiz-label">Pourquoi ce TP / objectif</label>'
    +   '<textarea class="wiz-textarea" id="wizWhyTp" placeholder="Zone cible, R:R vise, niveau technique...">' + (d.why_tp||'') + '</textarea>'
    + '</div>';
}

// ── Levels ──

function _wizStepLevels() {
  var d      = wizState.data;
  var isLong  = d.direction === 'long';
  var isShort = d.direction === 'short';

  var rrHtml = '';
  if (d.entry_price && d.stop_loss && d.take_profit) {
    var rr  = _calcRR(+d.entry_price, +d.stop_loss, +d.take_profit, d.direction);
    var col = rr >= 2 ? 'var(--win)' : rr >= 1.5 ? 'var(--cyan)' : 'var(--text-muted)';
    rrHtml  = '<div class="wiz-rr-preview" style="color:' + col + '">R:R ' + rr.toFixed(2) + '</div>';
  }

  return '<div class="wiz-question">Direction &amp; niveaux</div>'
    + '<div class="wiz-hint">Prix d\'entree, stop et objectif.</div>'
    + '<div class="wiz-direction-toggle">'
    +   '<button class="wiz-dir-btn' + (isLong?' active-long':'') + '" data-dir="long" onclick="wizSetDir(this)">'
    +     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>Long</button>'
    +   '<button class="wiz-dir-btn' + (isShort?' active-short':'') + '" data-dir="short" onclick="wizSetDir(this)">'
    +     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>Short</button>'
    + '</div>'
    + '<div class="wiz-levels-grid">'
    +   '<div><label class="wiz-level-lbl">Entree</label><input type="number" class="wiz-level-input" id="wizEntry" value="' + (d.entry_price||'') + '" placeholder="0.00" step="0.25" oninput="wizUpdateRR()"></div>'
    +   '<div><label class="wiz-level-lbl">Stop</label><input type="number" class="wiz-level-input" id="wizStop" value="' + (d.stop_loss||'') + '" placeholder="0.00" step="0.25" oninput="wizUpdateRR()"></div>'
    +   '<div><label class="wiz-level-lbl">Objectif (TP)</label><input type="number" class="wiz-level-input" id="wizTarget" value="' + (d.take_profit||'') + '" placeholder="0.00" step="0.25" oninput="wizUpdateRR()"></div>'
    +   '<div><label class="wiz-level-lbl">STDV</label><input type="number" class="wiz-level-input" id="wizStdv" value="' + (d.stdv_level||'') + '" placeholder="0.0" step="0.01"></div>'
    + '</div>'
    + '<div id="wizRrPreview">' + rrHtml + '</div>';
}

// ---- 043_wizsetdir.js ----
function wizSetDir(btn) {
  document.querySelectorAll('.wiz-dir-btn').forEach(function(b) {
    b.classList.remove('active-long','active-short');
  });
  var dir = btn.dataset.dir;
  btn.classList.add(dir === 'long' ? 'active-long' : 'active-short');
  if (wizState) wizState.data.direction = dir;
}

function wizUpdateRR() {
  var entry = +(_q('#wizEntry')?.value || 0);
  var stop  = +(_q('#wizStop')?.value  || 0);
  var tp    = +(_q('#wizTarget')?.value || 0);
  var dir   = (wizState && wizState.data.direction) || _wizActiveDir();
  var prev  = document.getElementById('wizRrPreview');
  if (!prev) return;
  if (!entry || !stop || !tp) { prev.innerHTML = ''; return; }
  var rr  = _calcRR(entry, stop, tp, dir);
  var col = rr >= 2 ? 'var(--win)' : rr >= 1.5 ? 'var(--cyan)' : 'var(--text-muted)';
  prev.innerHTML = '<div class="wiz-rr-preview" style="color:' + col + '">R:R ' + rr.toFixed(2) + '</div>';
}

function _calcRR(entry, stop, tp, dir) {
  if (!dir) dir = tp > entry ? 'long' : 'short';
  var risk   = Math.abs(entry - stop);
  var reward = dir === 'long' ? (tp - entry) : (entry - tp);
  if (!risk) return 0;
  return reward / risk;
}

// ── Screenshots ──

function _wizStepScreenshots() {
  var d      = wizState.data;
  var thumbs = (d.screenshots || []).map(function(s, i) {
    var src = s.dataUrl || s.url || s;
    return '<div class="wiz-thumb"><img src="' + src + '" alt=""><button class="wiz-thumb-del" onclick="wizRemoveScreenshot(' + i + ')" title="Supprimer">x</button></div>';
  }).join('');

  return '<div class="wiz-question">Screenshots</div>'
    + '<div class="wiz-hint">Capturez votre setup. (Optionnel)</div>'
    + '<div class="wiz-upload-zone" id="wizDropZone" onclick="document.getElementById(\'wizFileInput\').click()">'
    +   '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>'
    +   '<p>Glissez ou cliquez pour ajouter</p><small>PNG, JPG, WebP</small>'
    + '</div>'
    + '<input type="file" id="wizFileInput" accept="image/*" multiple style="display:none">'
    + '<div class="wiz-thumbs" id="wizThumbs">' + thumbs + '</div>';
}

function wizRemoveScreenshot(idx) {
  if (!wizState) return;
  wizState.data.screenshots.splice(idx, 1);
  _wizRender();
}

// ── Recap ──

function _wizFieldEmpty(value) {
  return value == null || String(value).trim() === '';
}

function _wizCollectMissingFields(data) {
  var d = data || {};
  var missing = [];

  function ask(field, question, step) {
    if (_wizFieldEmpty(d[field])) {
      missing.push({ field: field, question: question, step: step });
    }
  }

  ask('strategy', 'Challenge: quelle strategie as-tu executee ?', 'strategy');
  ask('direction', 'Challenge: direction finale long ou short ?', 'levels');
  ask('entry_price', 'Challenge: quel est ton prix d\'entree exact ?', 'levels');
  ask('stop_loss', 'Challenge: ou est place ton stop loss ?', 'levels');
  ask('take_profit', 'Challenge: quel est ton take-profit principal ?', 'levels');

  if (d.strategy === 'midnight_model') {
    ask('stdv_level', 'Challenge Midnight: quel niveau STDV a ete touche ?', 'levels');
    ask('why_entry', 'Challenge Midnight: trigger au contact (IFVG, breaker, ou les deux) ?', 'why_entry');
  }

  return missing;
}

function _wizStepRecap() {
  var d   = wizState.data;
  var idxMap = {};
  (wizState.steps || []).forEach(function(stepName, idx) { idxMap[stepName] = idx; });
  function idxOf(stepName, fallback) {
    return Number.isInteger(idxMap[stepName]) ? idxMap[stepName] : fallback;
  }
  var labels = { midnight_model:'Midnight Model', london_model:'London Model', ny_model:'NY Model' };
  var rows = [
    ['Date',       d.date         || '—', idxOf('date', 0)],
    ['Instrument', wizInstrumentLabel(d.instrument) || '—', idxOf('instrument', 1)],
    ['Strategie',  labels[d.strategy] || d.strategy || '—', idxOf('strategy', 2)],
    ['Biais',      d.htf_bias     || '—', idxOf('day_context', 3)],
    ['Direction',  d.direction    || '—', idxOf('levels', 7)],
    ['Entree',     d.entry_price  || '—', idxOf('levels', 7)],
    ['Stop',       d.stop_loss    || '—', idxOf('levels', 7)],
    ['TP',         d.take_profit  || '—', idxOf('levels', 7)],
  ];

  var tableRows = rows.filter(function(r) { return r[1] !== '—'; }).map(function(r) {
    var canEdit = r[2] >= 0;
    var editHtml = canEdit
      ? '<span class="wiz-recap-edit" onclick="wizGoTo(' + r[2] + ')">modifier</span>'
      : '<span class="wiz-recap-edit invisible">modifier</span>';
    return '<div class="wiz-recap-row">'
      + '<span class="wiz-recap-key">' + r[0] + '</span>'
      + '<span class="wiz-recap-val">' + r[1] + '</span>'
      + editHtml
      + '</div>';
  }).join('');

  var missing = _wizCollectMissingFields(d);
  var missingRows = missing.map(function(item) {
    var stepIdx = idxOf(item.step, -1);
    var edit = stepIdx >= 0
      ? '<button type="button" class="wiz-missing-edit" onclick="wizGoTo(' + stepIdx + ')">ouvrir</button>'
      : '';
    return '<div class="wiz-missing-row">'
      + '<span>' + escapeHtml(item.question) + '</span>'
      + edit
      + '</div>';
  }).join('');

  var followUps = (d.missing_followups || []).map(function(q) {
    var qq = String(q?.question || '').trim();
    if (!qq) return '';
    return '<div class="wiz-missing-row"><span>' + escapeHtml(qq) + '</span></div>';
  }).join('');

  var missingBlock = '';
  if (missing.length || followUps) {
    missingBlock = '<div class="wiz-missing-box">'
      + '<div class="wiz-missing-title">Challenge rapide final (optionnel)</div>'
      + '<div class="wiz-missing-list">' + missingRows + followUps + '</div>'
      + '<div class="wiz-missing-help">Tu peux ignorer et enregistrer, ou repondre ici pour auto-remplir la fiche.</div>'
      + '<textarea class="wiz-textarea" id="wizMissingChat" rows="4" placeholder="Ex: short, entree 18954, stop 18992, TP 18890, STDV 2, trigger IFVG en Premium avec SMT baissiere.">' + escapeHtml(d.missing_chat_text || '') + '</textarea>'
      + '<div class="wiz-missing-actions">'
      + '<button type="button" class="wiz-skip-btn" id="wizMissingAnalyzeBtn" onclick="wizAnalyzeMissingChat()">Appliquer ma reponse</button>'
      + '</div>'
      + '</div>';
  } else {
    missingBlock = '<div class="wiz-missing-box ok">'
      + '<div class="wiz-missing-title">Challenge valide</div>'
      + '<div class="wiz-missing-help">Toutes les infos clefs sont renseignees.</div>'
      + '</div>';
  }

  return '<div class="wiz-question">Recapitulatif</div>'
    + '<div class="wiz-hint">Verifie, puis enregistre. Rien n\'est obligatoire.</div>'
    + '<div class="wiz-recap-table">' + tableRows + '</div>'
    + missingBlock;
}

// ── PM Steps ──

function _wizStepPmExit() {
  var d = wizState.data;
  return '<div class="wiz-question">Cloture du trade</div>'
    + '<div class="wiz-hint">Prix de sortie.</div>'
    + '<div class="wiz-field"><label class="wiz-label">Prix de sortie</label>'
    + '<input type="number" class="wiz-input" id="wizExitPrice" value="' + (d.exit_price||'') + '" placeholder="0.00" step="0.25"></div>';
}

function _wizStepPmQuality() {
  var d = wizState.data;
  var q = d.exit_quality || 0;
  var stars = [1,2,3,4,5].map(function(n) {
    return '<button class="wiz-star' + (n<=q?' on':'') + '" data-n="' + n + '" onclick="wizSetStar(' + n + ')">'
      + '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
      + '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'
      + '</svg></button>';
  }).join('');

  return '<div class="wiz-question">Qualite de l\'execution</div>'
    + '<div class="wiz-hint">Comment avez-vous gere ce trade ? (sur 5)</div>'
    + '<div class="wiz-stars" id="wizStars">' + stars + '</div>';
}

function wizSetStar(n) {
  if (wizState) wizState.data.exit_quality = n;
  document.querySelectorAll('.wiz-star').forEach(function(s, i) {
    s.classList.toggle('on', i < n);
  });
}

function _wizStepPmLessons() {
  var d = wizState.data;
  return '<div class="wiz-question">Lecons &amp; notes</div>'
    + '<div class="wiz-hint">Que retenez-vous de ce trade ?</div>'
    + '<textarea class="wiz-textarea lg" id="wizLessons" placeholder="Observations, erreurs a eviter, ce qui a bien fonctionne...">' + (d.lessons||'') + '</textarea>';
}

// ─── After render hooks ────────────────────────────────────

function _wizAfterRender(step) {
  if (step === 'date') {
    var el = document.getElementById('wizDate');
    if (el) setTimeout(function() { el.focus(); }, 50);
  }
  if (step === 'why_trade' || step === 'why_entry' || step === 'pm_lessons') {
    var ta = document.querySelector('#wizBody textarea');
    if (ta) setTimeout(function() { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 50);
  }
  if (step === 'why_stop_tp') {
    var stop = document.getElementById('wizWhyStop');
    if (stop) setTimeout(function() { stop.focus(); }, 50);
  }
  if (step === 'levels') {
    var entry = document.getElementById('wizEntry');
    if (entry) setTimeout(function() { entry.focus(); }, 50);
  }
  if (step === 'screenshots') {
    _wizBindScreenshots();
  }
  if (step === 'recap') {
    var missingTa = document.getElementById('wizMissingChat');
    if (missingTa && !(wizState.data.missing_chat_text || '').trim()) {
      setTimeout(function() { missingTa.focus(); }, 50);
    }
  }
}

// ─── Screenshot drag-drop ──────────────────────────────────

function _wizBindScreenshots() {
  var zone  = document.getElementById('wizDropZone');
  var input = document.getElementById('wizFileInput');
  if (!zone || !input) return;

  zone.ondragover  = function(e) { e.preventDefault(); zone.classList.add('dragover'); };
  zone.ondragleave = function()  { zone.classList.remove('dragover'); };
  zone.ondrop      = function(e) {
    e.preventDefault();
    zone.classList.remove('dragover');
    _wizHandleFiles(e.dataTransfer.files);
  };
  input.onchange = function(e) { _wizHandleFiles(e.target.files); };
}

// ---- 044_wizreadfileasdataurl.js ----
function _wizReadFileAsDataUrl(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) { resolve(e.target.result); };
    reader.onerror = function() { reject(new Error('Lecture image impossible')); };
    reader.readAsDataURL(file);
  });
}

async function _wizHandleFiles(files) {
  if (!wizState || !files || files.length === 0) return;
  var imageFiles = Array.from(files).filter(function(file) {
    return !!file && file.type && file.type.startsWith('image/');
  });
  if (!imageFiles.length) return;

  for (const file of imageFiles) {
    try {
      const dataUrl = await _wizReadFileAsDataUrl(file);
      if (!wizState) return;
      wizState.data.screenshots.push({ dataUrl: dataUrl, name: file.name });
    } catch (_err) {}
  }

  if (wizState && wizState.steps[wizState.stepIdx] === 'screenshots') {
    _wizRender();
  }
}

function _wizFollowUpQuestionsFromParse(data) {
  var raw = Array.isArray(data?._follow_up_questions) ? data._follow_up_questions : [];
  return raw.map(function(item) {
    if (typeof item === 'string') return { field: '', question: item };
    return {
      field: String(item?.field || ''),
      question: String(item?.question || ''),
    };
  }).filter(function(item) { return !!item.question.trim(); });
}

function _wizApplyParseResult(data) {
  if (!wizState || !data) return;
  var d = wizState.data;

  if (data.strategy) d.strategy = String(data.strategy);
  if (data.direction) d.direction = String(data.direction);
  if (data._htf_bias) d.htf_bias = String(data._htf_bias);

  if (data.why_trade) d.why_trade = String(data.why_trade);
  if (data.why_entry) d.why_entry = String(data.why_entry);
  if (data.scenario) d.scenario = String(data.scenario);
  if (data.why_stop) d.why_stop = String(data.why_stop);
  if (data.why_tp) d.why_tp = String(data.why_tp);

  if (data.entry_price != null) d.entry_price = String(data.entry_price);
  if (data.stop_loss != null) d.stop_loss = String(data.stop_loss);
  if (data.take_profit != null) d.take_profit = String(data.take_profit);
  if (data.stdv_level != null) d.stdv_level = String(data.stdv_level);
  if (data.pnl != null) d.pnl = String(data.pnl);
  if (data.rr != null) d.rr = String(data.rr);
  if (data.is_win != null) d.is_win = data.is_win ? '1' : '0';

  d.missing_followups = _wizFollowUpQuestionsFromParse(data);
}

async function wizAnalyzeMissingChat() {
  if (!wizState) return;
  _wizSaveCurrentStep();

  var textarea = document.getElementById('wizMissingChat');
  var analyzeBtn = document.getElementById('wizMissingAnalyzeBtn');
  var text = String(textarea?.value || '').trim();
  if (!text) {
    if (typeof toast === 'function') toast("Ecris ta reponse avant l'application", "error");
    return;
  }

  if (analyzeBtn) {
    analyzeBtn.disabled = true;
    analyzeBtn.textContent = "Application...";
  }

  try {
    var parsed = await api('/api/parse-trade', {
      method: 'POST',
      body: JSON.stringify({ text: text }),
    });
    _wizApplyParseResult(parsed);
    _wizSaveDraft();
    _wizRender();
    var followUps = _wizFollowUpQuestionsFromParse(parsed);
    if (followUps.length) {
      if (typeof toast === 'function') toast("Challenge rapide partiel: complete les points restants si besoin", "error");
    } else if (typeof toast === 'function') {
      toast("Reponse appliquee a la fiche", "success");
    }
  } catch (err) {
    if (typeof toast === 'function') toast("Erreur analyse : " + err.message, "error");
  } finally {
    if (analyzeBtn) {
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = "Appliquer ma reponse";
    }
  }
}

// ─── Submit ────────────────────────────────────────────────

async function _wizSubmit() {
  _wizSaveCurrentStep();

  if (wizState.mode === 'postmortem') {
    return _wizSubmitPM();
  }

  var d = wizState.data;
  if (!d.date) d.date = todayKey();
  var instrument = wizCanonicalInstrument(d.instrument) || wizDefaultInstrument();
  if (!INSTRUMENTS.includes(instrument)) {
    instrument = wizDefaultInstrument();
  }
  d.instrument = instrument;

  try {
    // 1. Find or create day
    var dayId = d.dayId;
    if (!dayId) {
      var lookupRes = await fetch('/api/days/lookup?date=' + d.date + '&instrument=' + encodeURIComponent(instrument));
      if (lookupRes.ok) {
        var existing = await lookupRes.json();
        if (existing && existing.id) dayId = existing.id;
      }
    }

    if (!dayId) {
      var dayRes = await fetch('/api/days', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date:          d.date,
          instrument:    instrument,
          htf_bias:      d.htf_bias,
          htf_context:   d.htf_context,
          daily_notes:   d.daily_notes,
          tags:          d.tags,
        })
      });
      if (!dayRes.ok) throw new Error('Erreur creation du jour');
      var day = await dayRes.json();
      dayId = day.id;
    } else if (d.htf_bias || d.htf_context || d.daily_notes) {
      await fetch('/api/days/' + dayId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          htf_bias: d.htf_bias,
          htf_context: d.htf_context,
          daily_notes: d.daily_notes,
        })
      });
    }

    // 2. Create trade
    var tradeRes = await fetch('/api/days/' + dayId + '/trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        strategy:     d.strategy,
        direction:    d.direction,
        entry_price:  d.entry_price  ? +d.entry_price  : null,
        stop_loss:    d.stop_loss    ? +d.stop_loss    : null,
        take_profit:  d.take_profit  ? +d.take_profit  : null,
        stdv_level:   d.stdv_level   ? +d.stdv_level   : null,
        scenario:     d.scenario,
        why_trade:    d.why_trade,
        why_entry:    d.why_entry,
        why_stop:     d.why_stop,
        why_tp:       d.why_tp,
      })
    });
    if (!tradeRes.ok) throw new Error('Erreur creation du trade');
    var trade   = await tradeRes.json();
    var tradeId = trade.id;

    // 3. Upload screenshots
    for (var si = 0; si < (d.screenshots || []).length; si++) {
      var s = d.screenshots[si];
      if (!s.dataUrl) continue;
      var blob = await (await fetch(s.dataUrl)).blob();
      var form = new FormData();
      form.append('file', blob, s.name || 'screenshot.png');
      await fetch('/api/trades/' + tradeId + '/screenshots', { method: 'POST', body: form });
    }

    _wizClearDraft();
    wizClose();
    if (typeof toast    === 'function') toast("Trade enregistre", "success");
    if (typeof loadAll === 'function') loadAll();

  } catch(err) {
    console.error(err);
    if (typeof toast === 'function') toast("Erreur : " + err.message, "error");
  }
}

async function _wizSubmitPM() {
  var d = wizState.data;
  if (!d.tradeId) {
    if (typeof toast === 'function') toast("Trade introuvable", "error");
    return;
  }
  try {
    var res = await fetch('/api/trades/' + d.tradeId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        exit_price:        d.exit_price   ? +d.exit_price : null,

        execution_quality: d.exit_quality || null,
        lessons_learned:   d.lessons,
      })
    });
    if (!res.ok) throw new Error('Erreur mise a jour trade');
    wizClose();
    if (typeof toast    === 'function') toast("Post-mortem enregistre", "success");
    if (typeof loadAll === 'function') loadAll();
  } catch(err) {
    if (typeof toast === 'function') toast("Erreur : " + err.message, "error");
  }
}

// ─── Keyboard ──────────────────────────────────────────────

function _wizKeydown(e) {
  if (!wizState) return;
  if (e.key === 'Escape') { e.preventDefault(); wizBack(); return; }
  if (e.key === 'Enter') {
    var activeEl = document.activeElement;
    var isTextarea = activeEl && activeEl.tagName === 'TEXTAREA';
    if (isTextarea && !e.ctrlKey) return;
    e.preventDefault();
    wizNext();
  }
}

// ─── Bind ──────────────────────────────────────────────────

// ---- 045_bindwizard.js ----
function bindWizard() {
  var wiz = document.getElementById('wiz');
  if (!wiz) return;

  // Focus trap pour le wizard
  document.addEventListener('keydown', function _wizTrap(e) {
    if (e.key !== 'Tab') return;
    var el = document.getElementById('wiz');
    if (!el || el.classList.contains('hidden')) return;
    var f = el.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])');
    if (f.length === 0) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });

  // Close on backdrop click
  wiz.addEventListener('click', function(e) {
    if (e.target === wiz) wizClose();
  });

  var closeBtn = document.getElementById('wizCloseBtn');
  var backBtn  = document.getElementById('wizBackBtn');
  var nextBtn  = document.getElementById('wizNextBtn');
  var skipBtn  = document.getElementById('wizSkipBtn');

  if (closeBtn) closeBtn.addEventListener('click', wizClose);
  if (backBtn)  backBtn.addEventListener('click',  wizBack);
  if (nextBtn)  nextBtn.addEventListener('click',  wizNext);
  if (skipBtn)  skipBtn.addEventListener('click',  wizSkip);

  document.addEventListener('keydown', _wizKeydown);
}

// ---- 046_ai_panel.js ----
// ---------- AI panel ----------

const AI_PANEL_OPEN_KEY = "cockpit:aiPanelOpen:v1";

function setAiPanelOpen(open, persist = true) {
  document.body.classList.toggle("ai-panel-open", !!open);
  const btn = $("#aiPanelToggle");
  if (btn) btn.setAttribute("aria-expanded", open ? "true" : "false");
  if (persist) {
    try { localStorage.setItem(AI_PANEL_OPEN_KEY, open ? "1" : "0"); } catch (_) {}
  }
}

function bindAiPanelToggle() {
  const btn = $("#aiPanelToggle");
  if (!btn) return;
  let saved = null;
  try { saved = localStorage.getItem(AI_PANEL_OPEN_KEY); } catch (_) {}
  setAiPanelOpen(saved === "1", false);
  btn.addEventListener("click", () => {
    const next = !document.body.classList.contains("ai-panel-open");
    setAiPanelOpen(next, true);
  });
}

// ---- 047_today_widget_board.js ----
// ---------- Widget boards ----------

const WIDGET_ORDER_PREFIX = "cockpit:widgetOrder:";
const WIDGET_VIS_PREFIX = "cockpit:widgetVis:";
const WIDGET_POS_PREFIX = "cockpit:widgetPos:";

var WIDGET_REGISTRY = {
  kpi_total_pnl:      { label: "Net P&L",          icon: "dollar",  kind: "kpi",    size: "sm" },
  kpi_winrate:         { label: "Winrate",           icon: "clock",  kind: "kpi",    size: "sm" },
  kpi_average_rr:      { label: "Avg R",            icon: "trend",  kind: "kpi",    size: "sm" },
  kpi_trades:          { label: "Trades",            icon: "list",  kind: "kpi",    size: "sm" },
  kpi_profit_factor:   { label: "Profit Factor",    icon: "scale", kind: "kpi",    size: "sm" },
  kpi_expectancy:      { label: "Expectancy",        icon: "chart", kind: "kpi",    size: "sm" },
  today_context:       { label: "Contexte du jour",  icon: "globe", kind: "panel",  size: "full" },
  today_log:           { label: "Recap",             icon: "log",   kind: "panel",  size: "md" },
  today_activity:      { label: "Activite",          icon: "bolt",  kind: "panel",  size: "tall" },
  today_calendar:      { label: "Calendrier",        icon: "cal",   kind: "panel",  size: "md" },
};

var WIDGET_DEFAULTS = {
  "today": ["kpi_total_pnl", "kpi_winrate", "kpi_average_rr", "kpi_trades", "kpi_profit_factor", "kpi_expectancy", "today_context", "today_log", "today_activity", "today_calendar"],
};

function readWidgetOrder(boardKey) {
  try {
    var raw = localStorage.getItem(WIDGET_ORDER_PREFIX + boardKey);
    var parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter(function(x) { return typeof x === "string" && x; }) : [];
  } catch (_) { return []; }
}

function writeWidgetOrder(boardKey, keys) {
  try { localStorage.setItem(WIDGET_ORDER_PREFIX + boardKey, JSON.stringify(keys)); } catch (_) {}
}

function readWidgetPositions(boardKey) {
  try {
    var raw = localStorage.getItem(WIDGET_POS_PREFIX + boardKey);
    var parsed = JSON.parse(raw || "{}");
    return (typeof parsed === "object" && parsed !== null) ? parsed : {};
  } catch (_) { return {}; }
}

function writeWidgetPositions(boardKey, pos) {
  try { localStorage.setItem(WIDGET_POS_PREFIX + boardKey, JSON.stringify(pos)); } catch (_) {}
}

function readWidgetVisibility() {
  try {
    var raw = localStorage.getItem(WIDGET_VIS_PREFIX + "today");
    var parsed = JSON.parse(raw || "{}");
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch (_) { return {}; }
}

function writeWidgetVisibility(map) {
  try { localStorage.setItem(WIDGET_VIS_PREFIX + "today", JSON.stringify(map)); } catch (_) {}
}

function getWidgetDefaults() {
  var vis = {};
  Object.keys(WIDGET_REGISTRY).forEach(function(key) { vis[key] = true; });
  return vis;
}

function applyWidgetBoardOrder(board) {
  var boardKey = board && board.dataset && board.dataset.widgetBoard;
  if (!boardKey) return;
  var desired = readWidgetOrder(boardKey);
  var nodes = Array.from(board.children).filter(function(el) { return el && el.dataset && el.dataset.widgetKey; });
  var byKey = new Map(nodes.map(function(el) { return [el.dataset.widgetKey, el]; }));
  desired.forEach(function(key) {
    var node = byKey.get(key);
    if (node) board.appendChild(node);
  });
  var finalKeys = Array.from(board.children).map(function(el) { return el && el.dataset && el.dataset.widgetKey; }).filter(Boolean);
  writeWidgetOrder(boardKey, finalKeys);

  var pos = readWidgetPositions(boardKey);
  Array.from(board.children).forEach(function(el) {
    var key = el.dataset && el.dataset.widgetKey;
    if (!key) return;
    var p = pos[key];
    if (p && p.col && p.row) {
      el.style.gridColumnStart = p.col;
      el.style.gridRowStart = p.row;
    } else {
      el.style.gridColumnStart = "";
      el.style.gridRowStart = "";
    }
  });

  board.dataset.widgetReady = "1";
}

function applyWidgetVisibility() {
  var vis = readWidgetVisibility();
  Object.keys(WIDGET_REGISTRY).forEach(function(key) {
    var visible = vis[key] !== undefined ? vis[key] : true;
    var el = document.querySelector('[data-widget-key="' + key + '"]');
    if (!el) return;
    if (visible) { el.classList.remove("widget-hidden"); el.style.display = ""; }
    else { el.classList.add("widget-hidden"); el.style.display = "none"; }
  });
  updateDashboardLayout();
  refreshDragHandles();
}

function updateDashboardLayout() {
  var board = document.querySelector('[data-widget-board="today"]');
  if (board) {
    var visible = Array.from(board.children).filter(function(el) {
      return el.dataset && el.dataset.widgetKey && !el.classList.contains("widget-hidden");
    }).length;
    board.dataset.visibleCount = visible;
    board.classList.toggle("today-empty", visible === 0);
  }
}

function initWidgetBoards() {
  document.querySelectorAll(".widget-board[data-widget-board]").forEach(applyWidgetBoardOrder);
  applyWidgetVisibility();
  bindWidgetConfig();
  initWidgetDragDrop();
}

function initTodayWidgetBoards() { initWidgetBoards(); }

function toggleWidgetVisibility(key) {
  var vis = readWidgetVisibility();
  vis[key] = vis[key] === undefined ? false : !vis[key];
  writeWidgetVisibility(vis);
  applyWidgetVisibility();
  renderWidgetConfigItems();
  if (state.currentPage === "today" && typeof renderToday === "function") renderToday();
  if (typeof renderKPIs === "function" && state._stats) renderKPIs(state._stats);
}

function resetWidgetVisibility() {
  writeWidgetVisibility(getWidgetDefaults());
  writeWidgetOrder("today", WIDGET_DEFAULTS["today"]);
  writeWidgetPositions("today", {});
  applyWidgetVisibility();
  applyWidgetBoardOrder(document.querySelector('[data-widget-board="today"]'));
  renderWidgetConfigItems();
  if (state.currentPage === "today" && typeof renderToday === "function") renderToday();
  if (typeof renderKPIs === "function" && state._stats) renderKPIs(state._stats);
}

// ---- Dropdown config ----

function widgetIconSvg(icon) {
  var svgs = {
    dollar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    trend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>',
    scale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12h18"/><path d="M8 7l-5 5 5 5"/><path d="M16 17l5-5-5-5"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 19h16"/><path d="M6 15l4-4 3 3 5-6"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    log: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="3"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  };
  return svgs[icon] || svgs.list;
}

function renderWidgetConfigItems() {
  var container = document.getElementById("widgetConfigItems");
  if (!container) return;
  var vis = readWidgetVisibility();
  var order = readWidgetOrder("today");
  if (!order.length) order = WIDGET_DEFAULTS["today"];
  function renderItem(key) {
    var meta = WIDGET_REGISTRY[key];
    if (!meta) return "";
    var isOn = vis[key] !== false;
    return '<div class="widget-config-item' + (isOn ? " is-on" : "") + '" data-widget-toggle="' + key + '">' +
      '<div class="widget-config-item-icon">' + widgetIconSvg(meta.icon) + '</div>' +
      '<div class="widget-config-item-info">' +
        '<span class="widget-config-item-label">' + escapeHtml(meta.label) + '</span>' +
        '<span class="widget-config-item-kind">' + (meta.kind === "kpi" ? "KPI" : "Panneau") + '</span>' +
      '</div>' +
      '<div class="widget-config-item-toggle">' +
        '<div class="toggle-track' + (isOn ? " is-on" : "") + '"><div class="toggle-thumb"></div></div>' +
      '</div>' +
    '</div>';
  }
  container.innerHTML = order.map(renderItem).join("");
}

function positionDropdown(dropdown, btn) {
  if (!dropdown || !btn) return;
  var rect = btn.getBoundingClientRect();
  var top = rect.bottom + 6;
  var left = rect.right - 280;
  if (left < 8) left = 8;
  if (top + 400 > window.innerHeight) { top = rect.top - 6 - 400; if (top < 8) top = 8; }
  dropdown.style.top = top + "px";
  dropdown.style.left = left + "px";
}

function bindWidgetConfig() {
  var dropdown = document.getElementById("widgetDropdown");
  var btn = document.getElementById("widgetConfigBtn");
  var resetBtn = document.getElementById("widgetConfigReset");
  var itemsC = document.getElementById("widgetConfigItems");
  if (!dropdown || !btn) return;

  btn.addEventListener("click", function(e) {
    e.stopPropagation();
    if (dropdown.classList.contains("is-open")) { dropdown.classList.remove("is-open"); return; }
    renderWidgetConfigItems();
    positionDropdown(dropdown, btn);
    dropdown.classList.add("is-open");
  });
  dropdown.addEventListener("click", function(e) { e.stopPropagation(); });
  document.addEventListener("click", function(e) {
    if (!dropdown.contains(e.target) && e.target !== btn && !btn.contains(e.target)) dropdown.classList.remove("is-open");
  });
  document.addEventListener("keydown", function(e) { if (e.key === "Escape") dropdown.classList.remove("is-open"); });
  window.addEventListener("scroll", function() { if (dropdown.classList.contains("is-open")) dropdown.classList.remove("is-open"); }, { passive: true });
  resetBtn.addEventListener("click", function() { resetWidgetVisibility(); });
  function handleToggle(e) {
    var item = e.target.closest("[data-widget-toggle]");
    if (!item) return;
    e.preventDefault();
    toggleWidgetVisibility(item.dataset.widgetToggle);
  }
  itemsC.addEventListener("click", handleToggle);
  applyWidgetVisibility();
}

// ============================================================
// Drag & Drop v12 — swap-based with overlap-normalized hit test
// ============================================================

var _dnd = null;
var _dndRaf = 0;
var DND_LONG_PRESS = ('ontouchstart' in window) ? 120 : 180;

function initWidgetDragDrop() {
  refreshDragHandles();
  document.addEventListener("pointermove", onDndPointerMove, { passive: false });
  document.addEventListener("pointerup",   onDndPointerUp);
  document.addEventListener("pointercancel", onDndPointerUp);
}

function refreshDragHandles() {
  if (_dnd) return;
  document.querySelectorAll(".widget-board[data-widget-board] .widget[data-widget-key]").forEach(function(el) {
    if (el.classList.contains("widget-hidden")) return;
    if (el._dndBound) return;
    el._dndBound = true;

    var pressTimer = null;
    var pressStartX = 0, pressStartY = 0;

    el.addEventListener("pointerdown", function(e) {
      if (e.button && e.button !== 0) return;
      if (e.target.closest("input,textarea,button,a,select,[contenteditable]")) return;
      if (_dnd) return;
      var widget = el;
      var board = widget.closest(".widget-board[data-widget-board]");
      if (!board) return;

      el.setPointerCapture(e.pointerId);

      pressStartX = e.clientX;
      pressStartY = e.clientY;
      widget.classList.add("is-press-pending");

      pressTimer = setTimeout(function() {
        pressTimer = null;
        if (navigator.vibrate) navigator.vibrate(18);
        widget.classList.remove("is-press-pending");
        var rect = widget.getBoundingClientRect();
        var rawOffsetX = pressStartX - rect.left;
        var rawOffsetY = pressStartY - rect.top;
        var centerX = rect.width / 2;
        var centerY = rect.height / 2;
        var SNAP_TO_CENTER = 0.40;
        _dnd = {
          el: widget, board: board,
          offsetX: rawOffsetX + (centerX - rawOffsetX) * SNAP_TO_CENTER,
          offsetY: rawOffsetY + (centerY - rawOffsetY) * SNAP_TO_CENTER,
          width: rect.width, height: rect.height,
          ghost: null,
          active: false,
          dropRef: null
        };
        dndStart(pressStartX, pressStartY);
      }, DND_LONG_PRESS);
    });

    el.addEventListener("pointerup", function() {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      el.classList.remove("is-press-pending");
    });
    el.addEventListener("pointercancel", function() {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      el.classList.remove("is-press-pending");
    });
    el.addEventListener("pointermove", function(e) {
      if (!pressTimer) return;
      var dx = e.clientX - pressStartX, dy = e.clientY - pressStartY;
      if (dx*dx + dy*dy > 100) {
        clearTimeout(pressTimer); pressTimer = null;
        el.classList.remove("is-press-pending");
      }
    }, { passive: true });
  });
}

function onDndPointerMove(e) {
  if (!_dnd || !_dnd.active) return;
  e.preventDefault();
  if (_dndRaf) cancelAnimationFrame(_dndRaf);
  var cx = e.clientX, cy = e.clientY;
  _dndRaf = requestAnimationFrame(function() {
    _dndRaf = 0;
    if (_dnd && _dnd.active) dndMove(cx, cy);
  });
}

function onDndPointerUp() {
  if (_dndRaf) { cancelAnimationFrame(_dndRaf); _dndRaf = 0; }
  if (!_dnd) return;
  if (_dnd.active) dndEnd();
  _dnd = null;
}

function dndStart(cx, cy) {
  _dnd.active = true;
  var el = _dnd.el;

  el.classList.add("widget-dragging");

  var ghost = el.cloneNode(true);
  ghost.classList.remove("is-press-pending", "widget-dragging");
  ghost.removeAttribute("data-widget-key");
  ghost.classList.add("widget-drag-ghost");
  ghost.style.cssText = [
    "position:fixed","z-index:10000","left:0","top:0",
    "width:"  + _dnd.width  + "px",
    "height:" + _dnd.height + "px",
    "margin:0","pointer-events:none","will-change:transform",
    "transform:translate(" + (cx - _dnd.offsetX) + "px," + (cy - _dnd.offsetY) + "px) scale(0.97)",
    "opacity:0.75",
    "transition:opacity 120ms ease,box-shadow 120ms ease"
  ].join(";");
  document.body.appendChild(ghost);
  _dnd.ghost = ghost;

  requestAnimationFrame(function() {
    if (!_dnd || !_dnd.ghost) return;
    _dnd.ghost.style.opacity   = "0.97";
    _dnd.ghost.style.transform = "translate(" + (cx - _dnd.offsetX) + "px," + (cy - _dnd.offsetY) + "px) scale(1.04)";
    _dnd.ghost.style.boxShadow = "0 28px 80px rgba(0,0,0,0.65),0 0 0 1.5px rgba(0,229,255,0.4)";
    _dnd.ghost.style.transition = "opacity 120ms ease,box-shadow 120ms ease";
  });

  document.body.classList.add("is-dragging");
  _dnd.dropRef = null;
}

function dndMove(cx, cy) {
  if (!_dnd) return;

  _dnd.ghost.style.transition = "none";
  _dnd.ghost.style.transform  = "translate(" + (cx - _dnd.offsetX) + "px," + (cy - _dnd.offsetY) + "px) scale(1.04)";

  var items = dndItems(_dnd.board);
  var ghostLeft   = cx - _dnd.offsetX;
  var ghostTop    = cy - _dnd.offsetY;
  var ghostRight  = ghostLeft + _dnd.width;
  var ghostBottom = ghostTop  + _dnd.height;
  var ghostCX     = ghostLeft + _dnd.width  / 2;
  var ghostCY     = ghostTop  + _dnd.height / 2;

  var dropIdx = dndHitTest(items, ghostLeft, ghostTop, ghostRight, ghostBottom, ghostCX, ghostCY, _dnd.el);
  var dropRef = dropIdx >= 0 && dropIdx < items.length ? items[dropIdx] : null;

  if (dropRef === _dnd.dropRef) return;

  if (_dnd.dropRef) _dnd.dropRef.classList.remove("widget-drop-target");
  _dnd.dropRef = dropRef;
  if (dropRef) dropRef.classList.add("widget-drop-target");
}

function dndEnd() {
  if (!_dnd) return;
  var el = _dnd.el, board = _dnd.board;

  if (_dnd.dropRef && _dnd.dropRef !== el) {
    _dnd.dropRef.classList.remove("widget-drop-target");

    var target = _dnd.dropRef;
    var placeholder = document.createElement("div");
    board.insertBefore(placeholder, el);
    board.insertBefore(el, target);
    board.insertBefore(target, placeholder);
    placeholder.remove();
  }

  el.classList.remove("widget-dragging");
  el.style.transition = ""; el.style.transform = "";

  requestAnimationFrame(function() {
    el.style.transition = "transform 220ms cubic-bezier(0.34,1.56,0.64,1)";
    el.style.transform  = "scale(1.03)";
    setTimeout(function() {
      el.style.transform = "scale(1)";
      setTimeout(function() { el.style.transition = ""; el.style.transform = ""; }, 220);
    }, 30);
  });

  if (_dnd.ghost) _dnd.ghost.remove();
  document.body.classList.remove("is-dragging");

  var boardKey = board.dataset.widgetBoard;
  var order = Array.from(board.children)
    .map(function(c) { return c.dataset && c.dataset.widgetKey; })
    .filter(Boolean);
  writeWidgetOrder(boardKey, order);

  Array.from(board.children).forEach(function(child) {
    var key = child.dataset && child.dataset.widgetKey;
    if (!key || child.classList.contains("widget-hidden")) return;
    child.style.gridColumnStart = "";
    child.style.gridRowStart = "";
  });

  var pos = {};
  Array.from(board.children).forEach(function(child) {
    var key = child.dataset && child.dataset.widgetKey;
    if (!key || child.classList.contains("widget-hidden")) return;
    var cs = window.getComputedStyle(child);
    var col = parseInt(cs.gridColumnStart, 10);
    var row = parseInt(cs.gridRowStart, 10);
    if (!isNaN(col) && !isNaN(row) && col > 0 && row > 0) {
      pos[key] = { col: col, row: row };
    }
  });
  writeWidgetPositions(boardKey, pos);

  Object.keys(pos).forEach(function(key) {
    var child = board.querySelector('[data-widget-key="' + key + '"]');
    if (child) {
      child.style.gridColumnStart = pos[key].col;
      child.style.gridRowStart = pos[key].row;
    }
  });

  updateDashboardLayout();
  setTimeout(refreshDragHandles, 300);
  _dnd = null;
}

function dndItems(board) {
  return Array.from(board.children).filter(function(el) {
    return el && el.dataset && el.dataset.widgetKey
      && !el.classList.contains("widget-hidden");
  });
}

function dndHitTest(items, ghostLeft, ghostTop, ghostRight, ghostBottom, ghostCX, ghostCY, draggedEl) {
  var bestScore = 0, bestIdx = -1;

  for (var i = 0; i < items.length; i++) {
    if (items[i] === draggedEl) continue;
    var r = items[i].getBoundingClientRect();
    var ox = Math.max(0, Math.min(ghostRight, r.right) - Math.max(ghostLeft, r.left));
    var oy = Math.max(0, Math.min(ghostBottom, r.bottom) - Math.max(ghostTop, r.top));
    var overlap = ox * oy;
    if (overlap <= 0) continue;
    var targetArea = r.width * r.height;
    var score = overlap / targetArea;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  if (bestIdx >= 0) {
    return bestIdx;
  }

  var nearest = -1, nearestDist = Infinity;
  for (var j = 0; j < items.length; j++) {
    if (items[j] === draggedEl) continue;
    var rj = items[j].getBoundingClientRect();
    var dx = ghostCX - (rj.left + rj.width / 2);
    var dy = ghostCY - (rj.top + rj.height / 2);
    var dist = dx * dx + dy * dy;
    if (dist < nearestDist) { nearestDist = dist; nearest = j; }
  }

  return nearest < 0 ? -1 : nearest;
}

// ---------- Today calendar (mini vue mois courant) ----------

function renderTodayCalendar() {
  var grid = $("#todayCalendarGrid");
  var monthEl = $("#todayCalendarMonth");
  if (!grid) return;

  var now = new Date();
  var year = now.getFullYear();
  var month = now.getMonth();

  if (monthEl) monthEl.textContent = (MONTHS_FR[month] || "") + " " + year;

  var byDay = buildCalendarByDay(state.days || []);

  var prevMode = state.calendarMetricMode;
  state.calendarMetricMode = state.calendarMetricMode || "pnl";

  var first = new Date(year, month, 1);
  var firstIdx = (first.getDay() + 6) % 7;
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var tk = todayKey();
  var frag = document.createDocumentFragment();

  for (var i = 0; i < firstIdx; i++) {
    var spacer = document.createElement("div");
    spacer.className = "day other-month";
    spacer.style.visibility = "hidden";
    frag.appendChild(spacer);
  }
  for (var d = 1; d <= daysInMonth; d++) {
    frag.appendChild(dayCell(new Date(year, month, d), byDay, false, tk));
  }

  state.calendarMetricMode = prevMode;
  grid.replaceChildren(frag);
  grid.dataset.metricMode = state.calendarMetricMode || "pnl";
  grid.dataset.viewMode = "month";

  if (!grid.dataset.bound) {
    grid.dataset.bound = "1";
    grid.addEventListener("click", function _todayCalClick(e) {
      var dayEl = e.target.closest(".day");
      if (!dayEl || dayEl.dataset.otherMonth === "1") return;
      var key = dayEl.dataset.date;
      if (!key) return;
      if (typeof wizOpen === "function") wizOpen({ date: key });
    });
  }
}

// ---- 048_ai_chat.js ----
// ---------- AI Chat — frontend ----------
// State : window.aiChatHistory (session only, not persisted)
// Uses : api(), toast()
// Integration : wizard (wizOpen), day editor (openExistingDay), trade form (openTradeForm)

/* Markdown rendering helpers (lightweight — no external lib needed) */

function _aiRenderInline(text) {
  var s = escapeHtml(text);
  // Bold
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  s = s.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  // Inline code
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Links
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}

function _aiRenderMarkdown(text) {
  if (!text) return '';
  var lines = text.split('\n');
  var html = '';
  var inCodeBlock = false;
  var codeContent = '';

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // Code block fences
    if (/^```/.test(line)) {
      if (inCodeBlock) {
        html += '<pre><code>' + escapeHtml(codeContent.replace(/\n$/, '')) + '</code></pre>';
        codeContent = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
        codeContent = '';
      }
      continue;
    }

    if (inCodeBlock) {
      codeContent += line + '\n';
      continue;
    }

    var trimmed = line.trim();

    // Headings
    if (/^#{1,4}\s/.test(trimmed)) {
      var level = trimmed.match(/^#{1,4}/)[0].length;
      var hContent = _aiRenderInline(trimmed.replace(/^#+\s*/, ''));
      html += '<h' + level + '>' + hContent + '</h' + level + '>';
      continue;
    }

    // Blockquote
    if (/^>\s/.test(trimmed)) {
      html += '<blockquote>' + _aiRenderInline(trimmed.replace(/^>\s*/, '')) + '</blockquote>';
      continue;
    }

    // Horizontal rule
    if (/^---+\s*$/.test(trimmed)) {
      html += '<hr>';
      continue;
    }

    // Unordered list
    if (/^[-*+]\s/.test(trimmed)) {
      html += '<li>' + _aiRenderInline(trimmed.replace(/^[-*+]\s*/, '')) + '</li>';
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(trimmed)) {
      html += '<li value="' + trimmed.match(/^\d+/)[0] + '">' + _aiRenderInline(trimmed.replace(/^\d+\.\s*/, '')) + '</li>';
      continue;
    }

    // Empty line = paragraph break
    if (trimmed === '') {
      html += '</p><p>';
      continue;
    }

    // Regular text
    html += _aiRenderInline(line) + ' ';
  }

  if (inCodeBlock) {
    html += '<pre><code>' + escapeHtml(codeContent.replace(/\n$/, '')) + '</code></pre>';
  }

  // Wrap list items
  html = html.replace(/(<li[^>]*>.*?<\/li>)((?!<\/?li|<pre|<code|<\/p>).)*/gs, function(m) {
    var items = m.match(/<li[^>]*>.*?<\/li>/g);
    if (items && items.length > 1) {
      return '<ul>' + items.join('') + '</ul>';
    }
    return m;
  });

  // Wrap ordered list items
  html = html.replace(/((?:<li value="\d+".*?<\/li>)+)/g, function(m) {
    return '<ol>' + m + '</ol>';
  });

  // Trim and wrap
  html = html.trim();
  html = '<p>' + html + '</p>';
  // Clean double paragraph wraps
  html = html.replace(/<\/p>\s*<p>/g, '</p><p>');
  // Remove empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');
  return html;
}

/* Parse action markers from AI response */

function _aiParseActions(text) {
  var actions = [];
  var regex = /\[(wizOpen|openDay|openTradeForm):\s*(\{[^}]+\})\]/g;
  var match;
  while ((match = regex.exec(text)) !== null) {
    try {
      var data = JSON.parse(match[2]);
      actions.push({ type: match[1], data: data });
    } catch (_) {}
  }
  return actions;
}

/* Strip action markers from display text */

function _aiStripActions(text) {
  return text.replace(/\[(wizOpen|openDay|openTradeForm):\s*\{[^}]+\}\]/g, '').trim();
}

/* Render action buttons */

function _aiRenderActions(actions) {
  if (!actions || actions.length === 0) return '';
  var html = '<div class="ai-chat-actions">';
  for (var i = 0; i < actions.length; i++) {
    var a = actions[i];
    var label = '';
    var icon = '';
    switch (a.type) {
      case 'wizOpen':
        label = 'Ouvrir le wizard';
        icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
        break;
      case 'openDay':
        label = 'Ouvrir le jour';
        icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';
        break;
      case 'openTradeForm':
        label = 'Modifier le trade';
        icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
        break;
    }
    html += '<button type="button" class="ai-chat-action-btn" data-ai-action="' + a.type + '" data-ai-action-data=\'' + JSON.stringify(a.data) + '\'>' + icon + label + '</button>';
  }
  html += '</div>';
  return html;
}

/* Handle action button click */

function _aiHandleActionClick(e) {
  var btn = e.currentTarget;
  var type = btn.getAttribute('data-ai-action');
  var raw = btn.getAttribute('data-ai-action-data');
  var data;
  try { data = JSON.parse(raw); } catch (_) { return; }

  switch (type) {
    case 'wizOpen':
      if (typeof wizOpen === 'function') {
        wizOpen(data);
      }
      break;
    case 'openDay':
      if (typeof openExistingDay === 'function' && data.id) {
        // Fetch the day by ID
        api('/api/days/' + data.id).then(function(day) {
          openExistingDay(day);
        }).catch(function() {
          toast('Impossible de charger ce jour', 'error');
        });
      } else if (data.date && data.instrument) {
        api('/api/days/lookup?date=' + encodeURIComponent(data.date) + '&instrument=' + encodeURIComponent(data.instrument)).then(function(day) {
          if (day) {
            openExistingDay(day);
          } else {
            toast('Jour introuvable pour cette date', 'error');
          }
        }).catch(function() {
          toast('Impossible de charger ce jour', 'error');
        });
      }
      break;
    case 'openTradeForm':
      if (typeof openTradeForm === 'function' && data) {
        openTradeForm(data);
      }
      break;
  }
}

/* --- Core chat functions --- */

function aiChatInit() {
  window.aiChatHistory = [];

  var messages = document.getElementById('aiChatMessages');
  if (!messages) return;

  // Render welcome
  messages.innerHTML =
    '<div class="ai-chat-welcome">' +
      '<div class="ai-chat-welcome-icon">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>' +
        '</svg>' +
      '</div>' +
      '<div class="ai-chat-welcome-title">Assistant COCKPIT</div>' +
      '<div class="ai-chat-welcome-text">' +
        'Pose-moi des questions sur tes trades, demande-moi de créer ou modifier des entrées, ou de te donner des insights sur tes performances.' +
      '</div>' +
    '</div>';
}

function aiChatAddMessage(role, content, extra) {
  extra = extra || {};
  var messages = document.getElementById('aiChatMessages');
  if (!messages) return;

  // Remove welcome if user message
  var welcome = messages.querySelector('.ai-chat-welcome');
  if (welcome && role === 'user') {
    welcome.remove();
  }

  var now = new Date();
  var timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

  var div = document.createElement('div');
  div.className = 'ai-chat-msg ai-chat-msg-' + role;
  if (extra.error) div.classList.add('ai-chat-error');

  var displayContent = content;
  var actions = [];

  if (role === 'assistant') {
    actions = _aiParseActions(content);
    displayContent = _aiStripActions(content);
  }

  if (role === 'assistant' || role === 'system') {
    div.innerHTML =
      '<div class="ai-chat-msg-bubble">' + _aiRenderMarkdown(displayContent) + '</div>' +
      _aiRenderActions(actions) +
      '<div class="ai-chat-msg-time">' + timeStr + '</div>';
  } else {
    div.innerHTML =
      '<div class="ai-chat-msg-bubble">' + escapeHtml(displayContent) + '</div>' +
      '<div class="ai-chat-msg-time">' + timeStr + '</div>';
  }

  messages.appendChild(div);

  // Bind action buttons
  var actionBtns = div.querySelectorAll('.ai-chat-action-btn');
  for (var i = 0; i < actionBtns.length; i++) {
    actionBtns[i].addEventListener('click', _aiHandleActionClick);
  }

  aiChatScrollBottom();
}

function aiChatScrollBottom() {
  var messages = document.getElementById('aiChatMessages');
  if (!messages) return;
  // Use requestAnimationFrame to ensure DOM is flushed
  requestAnimationFrame(function() {
    messages.scrollTop = messages.scrollHeight;
  });
}

function aiChatShowLoading() {
  var messages = document.getElementById('aiChatMessages');
  if (!messages) return;
  var loading = document.createElement('div');
  loading.className = 'ai-chat-loading';
  loading.id = 'aiChatLoading';
  loading.innerHTML =
    '<div class="ai-chat-loading-dots">' +
      '<span></span><span></span><span></span>' +
    '</div>' +
    '<span class="ai-chat-loading-label">Réflexion...</span>';
  messages.appendChild(loading);
  aiChatScrollBottom();
}

function aiChatHideLoading() {
  var loading = document.getElementById('aiChatLoading');
  if (loading) loading.remove();
}

function aiChatSetBusy(busy) {
  var input = document.getElementById('aiChatInput');
  var send = document.getElementById('aiChatSend');
  if (input) input.disabled = busy;
  if (send) send.disabled = busy;
}

/* --- Pending image support --- */

var _aiChatPendingImageToken = null;

function _aiChatShowImagePreview(base64Data) {
  var preview = document.getElementById('aiChatImgPreview');
  if (!preview) return;
  preview.innerHTML =
    '<div class=\"ai-chat-img-chip\">' +
      '<img src=\"' + base64Data + '\" alt=\"Image uploadee\" class=\"ai-chat-img-thumb\">' +
      '<button type="button" class="ai-chat-img-remove" id="aiChatImgRemove" aria-label="Retirer image">' +
        '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" width=\"12\" height=\"12\">' +
          '<line x1=\"18\" y1=\"6\" x2=\"6\" y2=\"18\"/><line x1=\"6\" y1=\"6\" x2=\"18\" y2=\"18\"/>' +
        '</svg>' +
      '</button>' +
    '</div>';
  preview.hidden = false;

  // Bind remove button
  var removeBtn = document.getElementById('aiChatImgRemove');
  if (removeBtn) {
    removeBtn.addEventListener('click', _aiChatClearImage);
  }
}

function _aiChatClearImage() {
  _aiChatPendingImageToken = null;
  var preview = document.getElementById('aiChatImgPreview');
  if (preview) {
    preview.hidden = true;
    preview.innerHTML = '';
  }
  var input = document.getElementById('aiChatImgInput');
  if (input) input.value = '';
}

function _aiChatUploadImage(file) {
  if (!file) return;
  // Validate type
  if (!file.type.match(/^image\/(png|jpeg|jpg|gif|webp)$/)) {
    toast("Format d'image non supporte. PNG, JPEG, GIF ou WebP.", 'error');
    return;
  }
  // Validate size (max 5MB)
  if (file.size > 5 * 1024 * 1024) {
    toast('Image trop volumineuse (max 5 Mo).', 'error');
    return;
  }

  var formData = new FormData();
  formData.append('file', file);

  // Show local preview immediately
  var reader = new FileReader();
  reader.onload = function(e) {
    _aiChatShowImagePreview(e.target.result);
  };
  reader.readAsDataURL(file);

  // Upload to server
  toast("Upload de l'image...", 'info');
  api('/api/ai/chat/upload-image', {
    method: 'POST',
    body: formData,
    // Ensure we don't set Content-Type manually — browser sets it with boundary
  }).then(function(result) {
    if (result && result.image_token) {
      _aiChatPendingImageToken = result.image_token;
      toast("Image prete. Dis a l'assistant de l'attacher a un trade.", 'success');
    } else {
      toast("Erreur lors de l'upload", 'error');
      _aiChatClearImage();
    }
  }).catch(function(err) {
    toast('Erreur upload: ' + (err.message || 'inconnue'), 'error');
    _aiChatClearImage();
  });
}

function _aiChatHandlePaste(e) {
  var clipboardData = e.clipboardData || e.originalEvent?.clipboardData || window.clipboardData;
  if (!clipboardData) return;
  var items = clipboardData.items;
  if (!items) return;
  for (var i = 0; i < items.length; i++) {
    if (items[i].type && items[i].type.indexOf('image') === 0) {
      var file = items[i].getAsFile();
      if (file) {
        e.preventDefault();
        _aiChatUploadImage(file);
        return;
      }
    }
  }
}

async function aiChatSend() {
  var input = document.getElementById('aiChatInput');
  var text = (input && input.value.trim()) || '';

  // Build message content: include image hint if pending
  var content = text;
  if (!content && !_aiChatPendingImageToken) return;

  // Push to history if needed
  if (!window.aiChatHistory) {
    window.aiChatHistory = [];
  }

  // Add user message
  var displayText = _aiChatPendingImageToken
    ? (text || 'Attache cette image a un trade')
    : text;
  aiChatAddMessage('user', displayText);
  window.aiChatHistory.push({ role: 'user', content: displayText });
  input.value = '';
  input.style.height = 'auto';

  aiChatSetBusy(true);
  aiChatShowLoading();

  try {
    // Build request with pending image token
    var body = { messages: window.aiChatHistory };
    if (_aiChatPendingImageToken) {
      body.pending_image_token = _aiChatPendingImageToken;
    }

    var result = await api('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    aiChatHideLoading();

    var responseText = result.response || result.error || 'Pas de réponse.';

    // Handle missing API key
    if (result.needs_api_key) {
      aiChatAddMessage('system', responseText);
      return;
    }

    // Handle circuit breaker
    if (result.circuit_open) {
      aiChatAddMessage('system', responseText);
      return;
    }

    aiChatAddMessage('assistant', responseText);
    window.aiChatHistory.push({ role: 'assistant', content: responseText });

  } catch (err) {
    aiChatHideLoading();
    aiChatAddMessage('assistant', '**Erreur :** ' + (err.message || "Impossible de contacter l'assistant."), { error: true });
    toast('Erreur API chat', 'error');
  } finally {
    aiChatSetBusy(false);
    input.focus();
  }
}

function aiChatClear() {
  window.aiChatHistory = [];
  var messages = document.getElementById('aiChatMessages');
  if (messages) messages.innerHTML = '';

  // Reset with welcome
  aiChatInit();

  // Also send a reset to the server to clear cache
  api('/api/ai/chat', {
    method: 'POST',
    body: JSON.stringify({ messages: [{ role: 'user', content: '' }], reset: true }),
  }).catch(function() { /* silent */ });

  toast('Nouvelle conversation', 'success');
}

function aiChatInputResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 100) + 'px';
}

/* Handle Enter key (to send) vs Shift+Enter (newline) */

function _aiChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    aiChatSend();
  }
}

/* --- Bind --- */

function bindAIChat() {
  var input = document.getElementById('aiChatInput');
  var send = document.getElementById('aiChatSend');
  var clearBtn = document.getElementById('aiChatClear');

  if (!input || !send) return;

  aiChatInit();

  send.addEventListener('click', aiChatSend);
  input.addEventListener('keydown', _aiChatKeydown);
  input.addEventListener('input', function() { aiChatInputResize(this); });
  input.addEventListener('paste', _aiChatHandlePaste);

  // File input binding
  var imgInput = document.getElementById('aiChatImgInput');
  if (imgInput) {
    imgInput.addEventListener('change', function(e) {
      var files = e.target.files;
      if (files && files.length > 0) {
        _aiChatUploadImage(files[0]);
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', aiChatClear);
  }

  // Focus input when panel opens
  var toggle = document.getElementById('aiPanelToggle');
  if (toggle) {
    toggle.addEventListener('click', function() {
      // Small delay to let panel open animation finish
      setTimeout(function() { input.focus(); }, 100);
    });
  }
}

// ---- 049_enhanced_select.js ----
// ---------- Enhanced select : remplace les <select> natifs par un dropdown custom ----------
//
// Le select natif est cache mais garde sa valeur (utilise pour la compatibilité formulaire).
// Un bouton + dropdown stylisé le remplace visuellement.
//
// Usage : enhanceSelects() apres tout render qui ajoute/modifie des selects.
// Les selects deja enhances (data-enhanced="1") sont ignores.

function enhanceSelects(container) {
  const root = container || document;
  const selects = root.querySelectorAll(".select-wrapper select:not([data-enhanced])");
  if (!selects.length) return;

  selects.forEach(function (select) {
    if (select.dataset.enhanced) return;
    select.dataset.enhanced = "1";

    // Cacher la fleche native
    var arrowSvg = select.parentNode.querySelector(".select-arrow");
    if (arrowSvg) arrowSvg.style.display = "none";

    // Cacher le select natif
    select.style.position = "absolute";
    select.style.opacity = "0";
    select.style.width = "0";
    select.style.height = "0";
    select.style.pointerEvents = "none";

    // Trigger button
    var trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "custom-select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    var label = document.createElement("span");
    label.className = "trigger-label";
    label.textContent = _getSelectedText(select);

    var arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    arrow.setAttribute("viewBox", "0 0 16 16");
    arrow.setAttribute("width", "12");
    arrow.setAttribute("height", "12");
    arrow.setAttribute("fill", "none");
    arrow.setAttribute("stroke", "currentColor");
    arrow.setAttribute("stroke-width", "1.8");
    arrow.setAttribute("stroke-linecap", "round");
    arrow.setAttribute("stroke-linejoin", "round");
    arrow.className = "trigger-arrow";
    var polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("points", "4 6 8 10 12 6");
    arrow.appendChild(polyline);

    trigger.appendChild(label);
    trigger.appendChild(arrow);

    // Dropdown
    var dropdown = document.createElement("div");
    dropdown.className = "custom-select-dropdown";
    dropdown.setAttribute("role", "listbox");
    dropdown.setAttribute("aria-label", select.id || "Options");

    Array.from(select.options).forEach(function (opt, i) {
      if (opt.disabled && !opt.value) return; // sauter le placeholder disabled

      var item = document.createElement("div");
      item.className = "custom-select-item";
      item.dataset.value = opt.value;
      item.textContent = opt.textContent;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", opt.selected ? "true" : "false");
      if (opt.selected) item.classList.add("selected");

      item.addEventListener("click", function (e) {
        e.stopPropagation();
        _selectOption(select, opt.value, trigger, dropdown);
      });

      dropdown.appendChild(item);
    });

    // Insertion dans le DOM
    select.parentNode.appendChild(trigger);
    select.parentNode.appendChild(dropdown);

    // Toggle dropdown
    trigger.addEventListener("click", function (e) {
      e.stopPropagation();
      _toggleSelect(trigger, dropdown, select);
    });

    // Fermer si click ailleurs
    trigger._docHandler = function () { _closeSelect(trigger, dropdown); };
    document.addEventListener("click", trigger._docHandler);
  });
}

function _getSelectedText(select) {
  var idx = select.selectedIndex;
  if (idx >= 0 && select.options[idx]) return select.options[idx].textContent;
  return "\u2014";
}

function _selectOption(select, value, trigger, dropdown) {
  select.value = value;
  trigger.querySelector(".trigger-label").textContent = _getSelectedText(select);
  dropdown.querySelectorAll(".custom-select-item").forEach(function (el) {
    var sel = el.dataset.value === value;
    el.classList.toggle("selected", sel);
    el.setAttribute("aria-selected", sel ? "true" : "false");
  });
  _closeSelect(trigger, dropdown);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function _toggleSelect(trigger, dropdown, select) {
  var isOpen = dropdown.classList.contains("open");
  document.querySelectorAll(".custom-select-dropdown.open").forEach(function (d) {
    if (d !== dropdown) {
      d.classList.remove("open");
      var t = d._trigger;
      if (t) { t.classList.remove("open"); t.setAttribute("aria-expanded", "false"); }
    }
  });
  if (isOpen) {
    _closeSelect(trigger, dropdown);
  } else {
    _openSelect(trigger, dropdown, select);
  }
}

function _openSelect(trigger, dropdown, select) {
  dropdown.classList.add("open");
  trigger.classList.add("open");
  trigger.setAttribute("aria-expanded", "true");
  dropdown._trigger = trigger;

  // Positionnement sous le trigger
  var rect = trigger.getBoundingClientRect();
  var ddH = Math.min(dropdown.scrollHeight || 200, 240);
  var spaceBelow = window.innerHeight - rect.bottom;
  var spaceAbove = rect.top;

  if (spaceBelow >= ddH || spaceBelow > spaceAbove) {
    dropdown.style.top = rect.bottom + "px";
    dropdown.style.left = rect.left + "px";
    dropdown.style.width = Math.max(rect.width, 160) + "px";
    dropdown.style.maxHeight = (spaceBelow - 4) + "px";
    dropdown.style.transformOrigin = "top";
  } else {
    dropdown.style.top = (rect.top - ddH) + "px";
    dropdown.style.left = rect.left + "px";
    dropdown.style.width = Math.max(rect.width, 160) + "px";
    dropdown.style.maxHeight = (spaceAbove - 4) + "px";
    dropdown.style.transformOrigin = "bottom";
  }

  // Scroll vers l'option selectionnée
  var sel = dropdown.querySelector(".custom-select-item.selected");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}

function _closeSelect(trigger, dropdown) {
  dropdown.classList.remove("open");
  if (trigger) { trigger.classList.remove("open"); trigger.setAttribute("aria-expanded", "false"); }
}

// ---- 049_insights.js ----
// ---- 049_insights.js ---- Page Profil & Insights ML ----

(function () {
  "use strict";

  var _insightsInitialized = false;
  var _insightsToastTimeout = null;

  var INSIGHT_ICONS = {
    best_strategy: { icon: "+", cls: "success" },
    worst_strategy: { icon: "!", cls: "warning" },
    best_session: { icon: "+", cls: "success" },
    worst_session: { icon: "!", cls: "warning" },
    bias_correlation: { icon: "#", cls: "info" },
    direction_strength: { icon: "+", cls: "success" },
    lesson_themes: { icon: "#", cls: "info" },
    execution_quality: { icon: "+", cls: "success" },
    execution_warning: { icon: "!", cls: "warning" },
    rr_sweetspot: { icon: "#", cls: "info" },
    recent_trend: { icon: "#", cls: "info" },
    stdv_sweetspot: { icon: "+", cls: "success" },
    thesis_validated: { icon: "+", cls: "success" },
    thesis_invalid: { icon: "!", cls: "warning" },
  };

  function _dateKey(d) {
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function _getTodayStr() {
    return _dateKey(new Date());
  }

  function _get30dAgo() {
    var d = new Date();
    d.setDate(d.getDate() - 30);
    return _dateKey(d);
  }

  function _getFirstDayOfMonth() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-01";
  }

  function _fetchApi(endpoint, params) {
    var qs = [];
    params = params || {};
    for (var k in params) {
      if (params[k] && params[k] !== "ALL" && params[k] !== "") {
        qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
      }
    }
    var url = endpoint + (qs.length ? "?" + qs.join("&") : "");
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function _renderEmpty() {
    return '<div class="insight-empty">' +
      '<div class="insight-empty__icon">#</div>' +
      '<div class="insight-empty__title">Pas assez de donnees</div>' +
      '<div class="insight-empty__text">Remplis au moins 3 trades avec resultat pour que le moteur commence a detecter des patterns.</div>' +
      "</div>";
  }

  function _renderProfileHeader(profile) {
    if (profile.empty) return "";
    var pnlCls = (profile.total_pnl || 0) >= 0 ? "up" : "down";
    var pnlSign = (profile.total_pnl || 0) >= 0 ? "+" : "";
    return '<div class="profile-banner">' +
      '<div class="profile-stat"><div class="profile-stat__value">' + (profile.total_trades || 0) + '</div><div class="profile-stat__label">Trades</div></div>' +
      '<div class="profile-stat"><div class="profile-stat__value">' + (profile.winrate || 0) + '%</div><div class="profile-stat__label">Winrate (' + (profile.wins || 0) + "W/" + (profile.losses || 0) + "L)</div></div>" +
      '<div class="profile-stat"><div class="profile-stat__value ' + pnlCls + '">' + pnlSign + (profile.total_pnl || 0) + '$</div><div class="profile-stat__label">PnL Total</div></div>' +
      '<div class="profile-stat"><div class="profile-stat__value">' + (profile.avg_rr || "-") + '</div><div class="profile-stat__label">R:R Moyen</div></div>' +
      "</div>";
  }

  function _stars(confidence) {
    var n = Math.round((confidence || 0) * 5);
    var s = "";
    for (var i = 0; i < n; i++) s += "*";
    return '<span class="insight-stars">' + s + "</span>";
  }

  function _confidenceClass(confidence) {
    if (!confidence) return "low";
    if (confidence >= 0.7) return "high";
    if (confidence >= 0.4) return "medium";
    return "low";
  }

  function _renderInsightCard(pattern) {
    var def = INSIGHT_ICONS[pattern.kind] || { icon: "-", cls: "info" };
    var cardCls = "insight-card";
    if (def.cls === "warning") cardCls += " insight-card--warning";
    else if (def.cls === "success") cardCls += " insight-card--success";
    else cardCls += " insight-card--info";

    var tags = (pattern.tags || []).map(function (t) {
      return '<span class="insight-tag">' + _escapeHtml(t) + "</span>";
    }).join("");

    var confPct = Math.round((pattern.confidence || 0) * 100);
    var confCls = _confidenceClass(pattern.confidence);

    return '<div class="' + cardCls + '">' +
      '<div class="insight-header">' +
      '<div class="insight-icon insight-icon--' + def.cls + '">' + def.icon + "</div>" +
      '<div class="insight-title">' + _escapeHtml(pattern.title || "") + "</div>" +
      '<span class="insight-badge">' + confPct + "%</span>" +
      "</div>" +
      '<div class="insight-body">' + _escapeHtml(pattern.body || "") + "</div>" +
      '<div class="insight-meta">' +
      '<span class="insight-confidence">' + _stars(pattern.confidence) + " " + confPct + "% confiance</span>" +
      (pattern.evidence_count ? "<span>" + pattern.evidence_count + " trades</span>" : "") +
      "</div>" +
      (tags ? '<div class="insight-meta" style="margin-top:8px">' + tags + "</div>" : "") +
      '<div class="confidence-track"><div class="confidence-fill confidence-fill--' + confCls + '" style="width:' + confPct + '%"></div></div>' +
      "</div>";
  }

  function _renderStrategyTable(strategies) {
    if (!strategies || !strategies.length) return "";
    var best = strategies[0], worst = strategies[strategies.length - 1];
    var bestWr = 0, worstWr = 100;
    strategies.forEach(function (s) {
      if (s.winrate > bestWr) { bestWr = s.winrate; best = s; }
      if (s.winrate < worstWr && s.wins + s.losses >= 3) { worstWr = s.winrate; worst = s; }
    });

    var rows = strategies.map(function (s) {
      var pnlCls = (s.pnl || 0) >= 0 ? "up" : "down";
      var rowCls = "";
      if (s.name === (best && best.name) && s.winrate >= 60) rowCls = " best-row";
      else if (s.name === (worst && worst.name) && s.winrate < 45) rowCls = " worst-row";
      return '<tr class="' + rowCls + '"><td><strong>' + _escapeHtml(s.name || "-") + "</strong></td>" +
        '<td class="num">' + (s.total || 0) + "</td>" +
        "<td>" + (s.wins || 0) + "W/" + (s.losses || 0) + "L</td>" +
        '<td class="num">' + (s.winrate || 0) + "%</td>" +
        '<td class="num ' + pnlCls + '">' + ((s.pnl || 0) >= 0 ? "+" : "") + (s.pnl || 0) + "$</td></tr>";
    }).join("");

    return '<div class="insight-card insight-full" style="grid-column:1/-1">' +
      '<div class="insight-header"><div class="insight-icon insight-icon--info">#</div><div class="insight-title">Performance par strategie</div></div>' +
      '<table class="insight-table"><thead><tr>' +
      "<th>Strategie</th><th>Trades</th><th>Resultat</th><th>WR</th><th>PnL</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>";
  }

  function _renderSuggestions(profile, patterns) {
    var warns = (patterns || []).filter(function (p) {
      return p.kind && (p.kind.indexOf("worst") >= 0 || p.kind.indexOf("warning") >= 0 || p.kind.indexOf("invalid") >= 0);
    });
    var goods = (patterns || []).filter(function (p) {
      return p.kind && (p.kind.indexOf("best") >= 0 || p.kind.indexOf("strength") >= 0 || p.kind.indexOf("sweetspot") >= 0);
    });

    var html = '<div class="insight-full" style="grid-column:1/-1">';
    html += '<div class="insight-header" style="margin-bottom:12px"><div class="insight-title">Recommandations</div></div>';

    warns.slice(0, 3).forEach(function (w) {
      html += '<div class="suggestion-card suggestion-card--warn"><div class="suggestion-icon">!</div><div class="suggestion-content"><strong>' +
        _escapeHtml(w.title || "") + "</strong><br/>" + _escapeHtml(w.body || "") + "</div></div>";
    });
    goods.slice(0, 3).forEach(function (g) {
      html += '<div class="suggestion-card suggestion-card--good"><div class="suggestion-icon">+</div><div class="suggestion-content"><strong>' +
        _escapeHtml(g.title || "") + "</strong><br/>" + _escapeHtml(g.body || "") + "</div></div>";
    });
    if (!warns.length && !goods.length) {
      html += '<div class="insight-empty">Ajoute des resultats a tes trades pour obtenir des recommandations.</div>';
    }
    html += "</div>";
    return html;
  }

  function loadInsights(opts) {
    opts = opts || {};
    var container = document.getElementById("insightsContent");
    var loading = document.getElementById("insightsLoading");
    if (!container) return;

    loading.style.display = "";
    container.style.display = "none";
    container.innerHTML = "";

    var params = {};
    if (opts.instrument && opts.instrument !== "ALL") params.instrument = opts.instrument;
    if (opts.from) params.from = opts.from;
    if (opts.to) params.to = opts.to;

    Promise.all([
      _fetchApi("/api/ml/profile", params),
      _fetchApi("/api/ml/insights", params),
    ]).then(function (results) {
      var profile = results[0];
      var insightsResp = results[1];
      var patterns = insightsResp.patterns || [];
      var html = "";

      loading.style.display = "none";
      container.style.display = "grid";
      html += _renderProfileHeader(profile);
      if (patterns.length) patterns.forEach(function (p) { html += _renderInsightCard(p); });
      else html += '<div style="grid-column:1/-1">' + _renderEmpty() + "</div>";
      if (profile.preferred_strategies && profile.preferred_strategies.length) html += _renderStrategyTable(profile.preferred_strategies);
      html += _renderSuggestions(profile, patterns);
      container.innerHTML = html;
    }).catch(function (err) {
      loading.style.display = "none";
      container.style.display = "grid";
      container.innerHTML = '<div class="insight-empty"><div class="insight-empty__icon">!</div><div class="insight-empty__title">Erreur</div><div class="insight-empty__text">' +
        _escapeHtml(err.message || "Impossible de charger les insights.") + "</div></div>";
    });
  }

  function _renderPretradeWidget() {
    _fetchApi("/api/ml/insights", { from: _get30dAgo() }).then(function (resp) {
      var patterns = resp.patterns || [];
      var container = document.getElementById("pretradeWidget");
      if (!container) return;
      var warnings = patterns.filter(function (p) {
        return p.kind && (p.kind.indexOf("worst") >= 0 || p.kind.indexOf("warning") >= 0);
      });
      var strengths = patterns.filter(function (p) {
        return p.kind && (p.kind.indexOf("best") >= 0 || p.kind.indexOf("strength") >= 0);
      });
      var items = [];
      strengths.slice(0, 2).forEach(function (s) {
        items.push('<span class="pretrade-item"><span class="pretrade-item__icon">+</span> ' + _escapeHtml(s.title || "") + "</span>");
      });
      warnings.slice(0, 2).forEach(function (w) {
        items.push('<span class="pretrade-item"><span class="pretrade-item__icon">!</span> ' + _escapeHtml(w.title || "") + "</span>");
      });
      if (items.length) {
        container.innerHTML =
          '<div class="pretrade-widget" id="pretradeWidget">' +
          '<div class="pretrade-header">Pré-trade du jour</div>' +
          '<div class="pretrade-items">' + items.join("") + "</div></div>";
      }
    }).catch(function () {});
  }

  function showInsightToast(title, body, duration) {
    duration = duration || 6000;
    var toast = document.getElementById("toastInsight");
    var titleEl = document.getElementById("toastInsightTitle");
    var bodyEl = document.getElementById("toastInsightBody");
    if (!toast || !titleEl || !bodyEl) return;
    if (_insightsToastTimeout) clearTimeout(_insightsToastTimeout);
    titleEl.textContent = title;
    bodyEl.textContent = body;
    toast.classList.add("show");
    _insightsToastTimeout = setTimeout(function () {
      toast.classList.remove("show");
    }, duration);
  }

  function _initPostTradeToast() {
    var closeBtn = document.getElementById("toastInsightClose");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        var t = document.getElementById("toastInsight");
        if (t) t.classList.remove("toast-insight--visible");
        if (_insightsToastTimeout) clearTimeout(_insightsToastTimeout);
      });
    }
  }

  function onTradeSaved(tradeData) {
    if (tradeData && tradeData.id) {
      _fetchApi("/api/ml/setups/similar", { trade_id: tradeData.id, limit: 3 }).then(function (data) {
        if (data.error || !data.similar_trades || !data.similar_trades.length) return;
        var similar = data.similar_trades;
        var wins = similar.filter(function (s) { return s.trade && s.trade.is_win === 1; }).length;
        var losses = similar.filter(function (s) { return s.trade && s.trade.is_win === 0; }).length;
        if (wins + losses >= 2) {
          var wr = Math.round(wins / (wins + losses) * 100);
          var body = wins + "W/" + losses + "L = " + wr + "% WR dans des trades similaires. ";
          body += wr >= 60 ? "Bon setup !" : "Sois prudent.";
          showInsightToast("Setups similaires", body);
        }
      }).catch(function () {});
    }
    _renderPretradeWidget();
  }

  function _initFilters() {
    var from = document.getElementById("filterFrom");
    var to = document.getElementById("filterTo");
    var instr = document.getElementById("filterInstrument");
    var strat = document.getElementById("filterStrategy");
    var refresh = document.getElementById("insightsRefreshBtn");
    if (!from || !to) return;

    from.value = _getFirstDayOfMonth();
    to.value = _getTodayStr();

    var quickBtns = [
      { label: "7j", days: 7 },
      { label: "30j", days: 30 },
      { label: "90j", days: 90 },
      { label: "Ce mois", fn: _getFirstDayOfMonth },
    ];

    function _applyFilter() {
      loadInsights({
        from: from.value || undefined,
        to: to.value || undefined,
        instrument: instr ? instr.value : undefined,
        strategy: strat ? strat.value : undefined,
      });
    }

    function _setQuickRange(days) {
      var d = new Date();
      d.setDate(d.getDate() - days);
      from.value = _dateKey(d);
      to.value = _getTodayStr();
      _applyFilter();
    }

    var btnContainer = document.getElementById("filterQuick");
    if (!btnContainer) return;
    btnContainer.innerHTML = "";
    quickBtns.forEach(function (q) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "qbtn";
      btn.textContent = q.label;
      btn.addEventListener("click", function () {
        if (q.fn) {
          from.value = q.fn();
          to.value = _getTodayStr();
          _applyFilter();
        } else {
          _setQuickRange(q.days);
        }
      });
      btnContainer.appendChild(btn);
    });

    if (from) from.addEventListener("change", _applyFilter);
    if (to) to.addEventListener("change", _applyFilter);
    if (instr) instr.addEventListener("change", _applyFilter);
    if (strat) strat.addEventListener("change", _applyFilter);
    if (refresh) refresh.addEventListener("click", _applyFilter);
    _applyFilter();
  }

  function initInsights() {
    if (_insightsInitialized) return;
    _insightsInitialized = true;
    _renderPretradeWidget();
    _initPostTradeToast();
    _initFilters();

    document.addEventListener("trade:saved", function (e) {
      onTradeSaved(e.detail);
    });
  }

  function _escapeHtml(str) {
    if (typeof str !== "string") return str || "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  window.initInsights = initInsights;
  window.loadInsights = loadInsights;
  window.showInsightToast = showInsightToast;
  window.onTradeSaved = onTradeSaved;

  if (document.querySelector('.page[data-page="insights"].active')) {
    initInsights();
  } else {
    var _origGoPage = window.goPage;
    if (_origGoPage) {
      window.goPage = function (pageName) {
        _origGoPage(pageName);
        if (pageName === "insights") initInsights();
      };
    }
  }

  if (document.readyState === "complete" || document.readyState === "interactive") {
    if (document.querySelector('.page[data-page="insights"]')) {
      var checkPage = function () {
        if (document.querySelector('.page[data-page="insights"].active')) {
          initInsights();
        } else {
          setTimeout(checkPage, 300);
        }
      };
      setTimeout(checkPage, 500);
    }
  }
})();

// ---- 050_priority1_app_shell.js ----
// ---------- Priority 1 app shell ----------

const APP_SHELL_PAGES = {
  today: {
    title: "Dashboard",
    subtitle: "Vue du jour, performance et prochaine action.",
    documentTitle: "Dashboard - JOURNAL",
  },
  journal: {
    title: "Journal",
    subtitle: "Calendrier, table des trades, filtres et historique.",
    documentTitle: "Journal - JOURNAL",
  },
  stats: {
    title: "Stats",
    subtitle: "Performance, risque, patterns et breakdowns.",
    documentTitle: "Stats - JOURNAL",
  },
  settings: {
    title: "Settings",
    subtitle: "Profil, instruments, IA et preferences visuelles.",
    documentTitle: "Settings - JOURNAL",
  },
  insights: {
    title: "Insights",
    subtitle: "Profil comportemental et recommandations personnalisées.",
    documentTitle: "Insights - JOURNAL",
  },
};

function updateAppShell(pageName) {
  const page = APP_SHELL_PAGES[pageName] || APP_SHELL_PAGES.today;
  const title = document.getElementById("appTopbarTitle");
  const subtitle = document.getElementById("appTopbarSubtitle");
  if (title) title.textContent = page.title;
  if (subtitle) subtitle.textContent = page.subtitle;
  if (page.documentTitle) document.title = page.documentTitle;

  document.querySelectorAll(".nav-item[data-page]").forEach(function (btn) {
    const current = btn.dataset.page === pageName;
    btn.classList.toggle("active", current);
    if (current) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
}

function bindAppShellActions() {
  document.getElementById("shellNewEntryBtn")?.addEventListener("click", function () {
    wizOpen({ date: todayKey() });
  });

  document.getElementById("shellCmdkBtn")?.addEventListener("click", function () {
    openCmdk();
  });

  document.getElementById("shellThemeBtn")?.addEventListener("click", function () {
    document.getElementById("themeToggle")?.click();
  });
}

(function installAppShellHooks() {
  const originalGoPage = window.goPage || goPage;
  window.goPage = function (pageName) {
    originalGoPage(pageName);
    updateAppShell(state.currentPage || pageName || "today");
  };
  goPage = window.goPage;

  document.addEventListener("DOMContentLoaded", function () {
    bindAppShellActions();
    updateAppShell(state.currentPage || "today");
  });
})();

// ---- 051_spotlight.js ----
// Legacy cursor spotlight disabled.
// The global empty-space background is handled by 055_interactive_empty_background.js.

// ---- 052_pretext_greeting.js ----
// ---- 052_pretext_greeting.js ----
// Animated greeting with @chenglou/pretext: text flows around a subtle orb.

(function () {
  return;
  var CANVAS_ID = "pretextGreetingCanvas";
  var canvas, ctx, animId;
  var orb = { x: 0.7, y: 0.4, r: 18, vx: 0.001, vy: 0.0006 };
  var cells = [
    { x: 1, y: 1, a: 0.25, d: 0 }, { x: 2, y: 2, a: 0.16, d: 0.4 },
    { x: 3, y: 0, a: 0.30, d: 0.8 }, { x: 3, y: 1, a: 0.22, d: 1.1 },
    { x: 4, y: 1, a: 0.18, d: 1.4 }, { x: 4, y: 2, a: 0.15, d: 1.8 },
    { x: 5, y: 3, a: 0.20, d: 2.0 }, { x: 6, y: 4, a: 0.13, d: 2.5 },
    { x: 7, y: 2, a: 0.16, d: 2.9 }, { x: 8, y: 1, a: 0.22, d: 3.2 },
    { x: 2, y: 6, a: 0.13, d: 3.7 }, { x: 7, y: 6, a: 0.16, d: 4.1 }
  ];
  var pretextModule = null;
  var prepared = null;
  var currentText = "";
  var currentColor = "#00e5ff";

  var GREETINGS = {
    morning: { text: "Bonjour", emoji: "\u2615" },
    afternoon: { text: "Bon apr\u00e8s-midi", emoji: "\u2600" },
    evening: { text: "Bonsoir", emoji: "\u{1F319}" },
    night: { text: "Bonne nuit", emoji: "\u{1F303}" },
  };

  function getGreeting() {
    var h = new Date().getHours();
    if (h < 5) return GREETINGS.night;
    if (h < 12) return GREETINGS.morning;
    if (h < 18) return GREETINGS.afternoon;
    if (h < 22) return GREETINGS.evening;
    return GREETINGS.night;
  }

  function getGreetingText(username) {
    var g = getGreeting();
    var d = new Date();
    var days = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
    var months = ["janv", "f\u00e9vr", "mars", "avr", "mai", "juin",
      "juil", "ao\u00fbt", "sept", "oct", "nov", "d\u00e9c"];
    return g.text + " " + (username || "trader") + " \u00b7 "
      + days[d.getDay()] + " " + d.getDate() + " " + months[d.getMonth()];
  }

  function initCanvas() {
    canvas = document.getElementById(CANVAS_ID);
    if (!canvas) return false;
    var parent = canvas.parentElement;
    canvas.width = parent.offsetWidth;
    canvas.height = parent.offsetHeight;
    ctx = canvas.getContext("2d");
    return true;
  }

  function resizeCanvas() {
    if (!canvas || !canvas.parentElement) return;
    canvas.width = canvas.parentElement.offsetWidth;
    canvas.height = canvas.parentElement.offsetHeight;
  }

  function loadPretext() {
    try {
      return import(
        /* @vite-ignore */
        "https://esm.sh/@chenglou/pretext@0.0.6"
      );
    } catch (e) {
      // Fallback: render static text if Pretext fails to load
      return null;
    }
  }

  function drawFallback() {
    if (!ctx || !canvas) return;
    var w = canvas.width, h = canvas.height;
    ctx.font = '500 22px "Instrument Serif", Georgia, serif';
    ctx.textBaseline = "middle";
    ctx.fillStyle = currentColor;
    ctx.textAlign = "left";
    ctx.fillText(currentText, 4, h / 2 - 2);
    ctx.font = '14px "JetBrains Mono", monospace';
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillText("Trading Journal", 4, h / 2 + 22);
  }

  function drawKineticGrid(timestamp, w, h) {
    var t = timestamp * 0.001;
    var cell = Math.max(38, Math.min(62, Math.floor(w / 14)));
    var cols = Math.ceil(w / cell) + 1;
    var rows = Math.ceil(h / cell) + 1;

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(3,4,6,0.72)";
    ctx.fillRect(0, 0, w, h);

    ctx.lineWidth = 1;
    for (var cx = 0; cx <= cols; cx++) {
      var x = cx * cell + ((Math.sin(t * 0.22) * 8) % cell);
      ctx.strokeStyle = "rgba(255,255,255,0.018)";
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (var ry = 0; ry <= rows; ry++) {
      var y = ry * cell;
      ctx.strokeStyle = "rgba(255,255,255,0.014)";
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    var wave = (Math.sin(t * 0.33) * 0.5 + 0.5) * w * 0.42;
    var glow = ctx.createRadialGradient(wave, h * 0.38, 0, wave, h * 0.38, w * 0.28);
    glow.addColorStop(0, "rgba(120,28,28,0.24)");
    glow.addColorStop(0.45, "rgba(120,28,28,0.09)");
    glow.addColorStop(1, "rgba(120,28,28,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    cells.forEach(function (c) {
      var px = c.x * cell + Math.sin(t * 0.18 + c.d) * 10;
      var py = c.y * cell + Math.cos(t * 0.15 + c.d) * 8;
      if (px > w || py > h) return;
      var pulse = c.a + (Math.sin(t * 1.4 + c.d) * 0.5 + 0.5) * 0.10;
      ctx.strokeStyle = "rgba(165,42,42," + pulse.toFixed(3) + ")";
      ctx.fillStyle = "rgba(110,24,24," + (pulse * 0.10).toFixed(3) + ")";
      ctx.lineWidth = 1.2;
      ctx.strokeRect(px + 0.5, py + 0.5, cell - 1, cell - 1);
      ctx.fillRect(px + 1, py + 1, cell - 2, cell - 2);
    });

    ctx.restore();
  }

  function animate(timestamp) {
    if (!ctx || !canvas || canvas.width === 0) {
      animId = requestAnimationFrame(animate);
      return;
    }
    var w = canvas.width, h = canvas.height;

    // Update orb position (gentle drift)
    orb.x += orb.vx;
    orb.y += orb.vy;
    // Bounce softly off edges
    if (orb.x < 0.1 || orb.x > 0.9) orb.vx *= -1;
    if (orb.y < 0.1 || orb.y > 0.9) orb.vy *= -1;
    // Keep orb in right third for visual balance
    orb.x = Math.max(0.5, Math.min(0.9, orb.x));

    var ox = orb.x * w;
    var oy = orb.y * h;
    var or = orb.r + Math.sin(timestamp * 0.001) * 2;

    ctx.clearRect(0, 0, w, h);
    drawKineticGrid(timestamp, w, h);

    if (pretextModule && prepared) {
      // Pretext rendering

      var fontSize = h > 80 ? 22 : 18;
      var font = fontSize + 'px "Instrument Serif", Georgia, serif';
      var lineHeight = fontSize + 8;

      var cursor = { segmentIndex: 0, graphemeIndex: 0 };
      var y = 14;
      var padding = 4;

      while (true) {
        // Calculate available width at this y (subtract orb)
        var availW = w - padding * 2;
        // If this line overlaps with orb, carve out space
        var lineCenterY = y + lineHeight / 2;
        var dy = Math.abs(lineCenterY - oy);
        if (dy < or + lineHeight) {
          var carveLeft = ox - or - 6;
          var carveRight = w - (ox + or + 6);
          if (carveLeft > 60) {
            availW = Math.min(availW, carveLeft - padding);
          } else if (carveRight > 60) {
            availW = Math.min(availW, carveRight - padding);
          }
        }

        if (availW < 30) {
          y += lineHeight;
          continue;
        }

        var range = pretextModule.layoutNextLineRange(prepared, cursor, availW);
        if (!range) break;

        var line = pretextModule.materializeLineRange(prepared, range);
        var lineX = padding;

        // If orb is on the left side of this line, shift text right
        if (dy < or + lineHeight && ox < w * 0.5 && line.advance > ox - or) {
          lineX = Math.max(padding, ox + or + 6);
        }

        ctx.font = font;
        ctx.textBaseline = "top";
        ctx.fillStyle = currentColor;
        ctx.fillText(line.text, lineX, y);
        cursor = range.end;
        y += lineHeight;
      }
    } else {
      // Fallback rendering
      drawFallback();
    }

    // Draw the moving focus glow
    var grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, or + 20);
    grad.addColorStop(0, "rgba(0,229,255,0.18)");
    grad.addColorStop(0.4, "rgba(0,229,255,0.06)");
    grad.addColorStop(1, "rgba(0,229,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(ox, oy, or + 20, 0, Math.PI * 2);
    ctx.fill();

    // Draw a small scanner node
    ctx.beginPath();
    ctx.arc(ox, oy, Math.max(3, or * 0.18), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,229,255,0.34)";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,229,255,0.5)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    animId = requestAnimationFrame(animate);
  }

  function initPretextGreeting() {
    var header = document.querySelector(".page[data-page='today'] .page-head");
    if (!header) return;

    // Check if canvas already exists
    if (document.getElementById(CANVAS_ID)) return;

    // Create canvas
    var canvasEl = document.createElement("canvas");
    canvasEl.id = CANVAS_ID;
    canvasEl.className = "pretext-greeting-canvas";
    canvasEl.width = header.offsetWidth || header.clientWidth;
    canvasEl.height = header.offsetHeight || header.clientHeight;
    header.insertBefore(canvasEl, header.firstChild);

    header.classList.add("pretext-head");

    // Get current greeting text
    var nameEl = document.getElementById("todayGreeting");
    var username = nameEl ? nameEl.textContent : null;
    currentText = getGreetingText(username);

    // Pick color based on state
    currentColor = state && state._stats
      ? (state._stats.todayPnl > 0 ? "#88ff5a" : state._stats.todayPnl < 0 ? "#ff4e6b" : "#00e5ff")
      : "#00e5ff";

    if (!initCanvas()) return;

    // Load Pretext
    loadPretext().then(function (mod) {
      pretextModule = mod;
      var fontSize = (canvas.height > 80 ? 22 : 18);
      var font = fontSize + 'px "Instrument Serif", Georgia, serif';
      prepared = mod.prepareWithSegments(currentText, font);
      if (!animId) animate(Date.now());
    }).catch(function () {
      // Fallback animation without Pretext
      currentText = getGreetingText(username);
      if (!animId) animate(Date.now());
    });

    // Resize handler
    window.addEventListener("resize", function () {
      resizeCanvas();
      if (pretextModule && prepared) {
        var fontSize = (canvas.height > 80 ? 22 : 18);
        var font = fontSize + 'px "Instrument Serif", Georgia, serif';
        prepared = pretextModule.prepareWithSegments(currentText, font);
      }
    });

    // Listen for updates
    document.addEventListener("trade:saved", function () {
      // Refresh color based on latest stats
      if (state && state._stats) {
        currentColor = state._stats.todayPnl > 0
          ? "#88ff5a"
          : state._stats.todayPnl < 0
            ? "#ff4e6b"
            : "#00e5ff";
      }
    });
  }

  // Initialize on page show — hook into existing navigation
  function _patchGoPage() {
    var orig = window.goPage;
    if (!orig || window.__pretextPatched) return;
    window.__pretextPatched = true;
    window.goPage = function (pageName) {
      orig(pageName);
      if (pageName === "today" || !pageName) {
        setTimeout(initPretextGreeting, 100);
      }
    };
  }

  // Init on DOMContentLoaded if today page is active
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      if (document.querySelector(".page[data-page='today'].active")) {
        setTimeout(initPretextGreeting, 200);
      }
      _patchGoPage();
    });
  } else {
    if (document.querySelector(".page[data-page='today'].active")) {
      setTimeout(initPretextGreeting, 200);
    }
    _patchGoPage();
  }
})();

// ---- 053_unified_date_picker.js ----
// ---------- Unified date/range picker ----------

var _unifiedDatePickerState = null;

function _udpDateKey(d) { return fmtDateKey(d); }
function _udpParse(key) { return parseDateKey(key) || new Date(); }
function _udpMonthStart(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function _udpAddMonths(d, delta) { return new Date(d.getFullYear(), d.getMonth() + delta, 1); }
function _udpDaysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

function _udpRangeForShortcut(kind) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  if (kind === "today") return { from: _udpDateKey(today), to: _udpDateKey(today) };
  if (kind === "yesterday") {
    start.setDate(start.getDate() - 1);
    return { from: _udpDateKey(start), to: _udpDateKey(start) };
  }
  if (kind === "7d") start.setDate(start.getDate() - 6);
  else if (kind === "30d") start.setDate(start.getDate() - 29);
  else if (kind === "3m") start.setMonth(start.getMonth() - 3);
  else if (kind === "6m") start.setMonth(start.getMonth() - 6);
  else if (kind === "last_month") {
    const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const last = new Date(today.getFullYear(), today.getMonth(), 0);
    return { from: _udpDateKey(first), to: _udpDateKey(last) };
  } else if (kind === "month") {
    return {
      from: _udpDateKey(new Date(today.getFullYear(), today.getMonth(), 1)),
      to: _udpDateKey(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    };
  } else if (kind === "all") {
    return { from: "2020-01-01", to: _udpDateKey(today) };
  }
  return { from: _udpDateKey(start), to: _udpDateKey(today) };
}

function _udpMonthShortcut(monthOffset) {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + monthOffset + 1, 0);
  return { from: _udpDateKey(first), to: _udpDateKey(last) };
}

function _udpEnsure() {
  let root = $("#unifiedDatePicker");
  if (root) return root;
  root = document.createElement("div");
  root.id = "unifiedDatePicker";
  root.className = "udp hidden";
  root.innerHTML =
    '<div class="udp-backdrop" data-udp-close></div>' +
    '<div class="udp-panel" role="dialog" aria-modal="true" aria-label="Selection de date">' +
      '<aside class="udp-side">' +
        '<div class="udp-side-title">Raccourcis</div>' +
        '<button type="button" data-shortcut="today">Aujourd hui</button>' +
        '<button type="button" data-shortcut="yesterday">Hier</button>' +
        '<button type="button" data-shortcut="7d">7 derniers jours</button>' +
        '<button type="button" data-shortcut="30d">30 derniers jours</button>' +
        '<button type="button" data-shortcut="month">Ce mois</button>' +
        '<button type="button" data-shortcut="last_month">Mois dernier</button>' +
        '<button type="button" data-shortcut="3m">3 derniers mois</button>' +
        '<button type="button" data-shortcut="6m">6 derniers mois</button>' +
        '<button type="button" data-shortcut="all">Tout</button>' +
        '<div class="udp-side-title udp-month-title">Par mois</div>' +
        '<div class="udp-month-shortcuts" id="udpMonthShortcuts"></div>' +
      '</aside>' +
      '<main class="udp-main">' +
        '<div class="udp-inputs">' +
          '<label>Debut <span id="udpFromText">--</span></label>' +
          '<span class="udp-arrow">-></span>' +
          '<label>Fin <span id="udpToText">--</span></label>' +
        '</div>' +
        '<div class="udp-cal-head">' +
          '<button type="button" class="udp-nav" data-nav="-1" aria-label="Mois precedent">&lsaquo;</button>' +
          '<button type="button" class="udp-nav" data-nav="1" aria-label="Mois suivant">&rsaquo;</button>' +
        '</div>' +
        '<div class="udp-calendars" id="udpCalendars"></div>' +
        '<div class="udp-actions">' +
          '<button type="button" class="udp-cancel" data-udp-close>Annuler</button>' +
          '<button type="button" class="udp-apply" id="udpApply">Appliquer</button>' +
        '</div>' +
      '</main>' +
    '</div>';
  document.body.appendChild(root);
  _udpBind(root);
  return root;
}

function _udpBind(root) {
  root.addEventListener("click", function(e) {
    if (e.target.closest("[data-udp-close]")) { closeUnifiedDatePicker(); return; }
    const nav = e.target.closest("[data-nav]");
    if (nav && _unifiedDatePickerState) {
      _unifiedDatePickerState.anchor = _udpAddMonths(_unifiedDatePickerState.anchor, Number(nav.dataset.nav || 0));
      _udpRender();
      return;
    }
    const shortcut = e.target.closest("[data-shortcut]");
    if (shortcut && _unifiedDatePickerState) {
      const r = _udpRangeForShortcut(shortcut.dataset.shortcut);
      _unifiedDatePickerState.from = r.from;
      _unifiedDatePickerState.to = _unifiedDatePickerState.mode === "single" ? r.from : r.to;
      _unifiedDatePickerState.anchor = _udpMonthStart(_udpParse(_unifiedDatePickerState.from));
      _udpRender();
      _udpApply();
      return;
    }
    const monthShortcut = e.target.closest("[data-month-offset]");
    if (monthShortcut && _unifiedDatePickerState) {
      const r = _udpMonthShortcut(Number(monthShortcut.dataset.monthOffset || 0));
      _unifiedDatePickerState.from = r.from;
      _unifiedDatePickerState.to = _unifiedDatePickerState.mode === "single" ? r.from : r.to;
      _unifiedDatePickerState.anchor = _udpMonthStart(_udpParse(r.from));
      _udpRender();
      return;
    }
    const day = e.target.closest("[data-date]");
    if (day && _unifiedDatePickerState) { _udpPick(day.dataset.date); return; }
    if (e.target.closest("#udpApply")) _udpApply();
  });
  document.addEventListener("keydown", function(e) {
    if (e.key === "Escape") closeUnifiedDatePicker();
  });
}

function _udpPick(key) {
  const s = _unifiedDatePickerState;
  if (!s) return;
  if (s.mode === "single") {
    s.from = key;
    s.to = key;
    _udpRender();
    _udpApply();
    return;
  }
  if (!s.from || (s.from && s.to && s._complete)) {
    s.from = key;
    s.to = "";
    s._complete = false;
  } else if (key < s.from) {
    s.to = s.from;
    s.from = key;
    s._complete = true;
  } else {
    s.to = key;
    s._complete = true;
  }
  _udpRender();
}

function _udpApply() {
  const s = _unifiedDatePickerState;
  if (!s || !s.from) return;
  const from = s.from;
  const to = s.to || s.from;
  if (typeof s.onApply === "function") s.onApply(from, to);
  else if (s.input) {
    s.input.value = from;
    s.input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  closeUnifiedDatePicker();
}

function _udpMonthHtml(anchor) {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  const first = new Date(y, m, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const days = _udpDaysInMonth(y, m);
  const prevDays = _udpDaysInMonth(y, m - 1);
  const cells = [];
  const s = _unifiedDatePickerState || {};
  for (let i = 0; i < 42; i++) {
    let d;
    let other = false;
    if (i < startOffset) {
      d = new Date(y, m - 1, prevDays - startOffset + i + 1);
      other = true;
    } else if (i >= startOffset + days) {
      d = new Date(y, m + 1, i - startOffset - days + 1);
      other = true;
    } else {
      d = new Date(y, m, i - startOffset + 1);
    }
    const key = _udpDateKey(d);
    const inRange = s.from && s.to && key >= s.from && key <= s.to;
    const edge = key === s.from || key === s.to;
    cells.push('<button type="button" class="udp-day' + (other ? " is-other" : "") + (inRange ? " is-range" : "") + (edge ? " is-edge" : "") + '" data-date="' + key + '">' + d.getDate() + '</button>');
  }
  return '<section class="udp-month"><h3>' + MONTHS_FR[m] + ' ' + y + '</h3><div class="udp-weekdays"><span>Lu</span><span>Ma</span><span>Me</span><span>Je</span><span>Ve</span><span>Sa</span><span>Di</span></div><div class="udp-days">' + cells.join("") + '</div></section>';
}

function _udpRender() {
  const s = _unifiedDatePickerState;
  if (!s) return;
  $("#udpFromText").textContent = s.from ? prettyDateKey(s.from) : "--";
  $("#udpToText").textContent = s.mode === "single" ? "Date simple" : (s.to ? prettyDateKey(s.to) : "--");
  $("#udpCalendars").innerHTML = _udpMonthHtml(s.anchor) + _udpMonthHtml(_udpAddMonths(s.anchor, 1));
  const monthBox = $("#udpMonthShortcuts");
  if (monthBox && !monthBox.children.length) {
    const now = new Date();
    for (let i = 0; i > -12; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const label = MONTHS_FR[d.getMonth()].slice(0, 3) + " " + String(d.getFullYear()).slice(2);
      monthBox.insertAdjacentHTML("beforeend", '<button type="button" data-month-offset="' + i + '">' + label + '</button>');
    }
  }
}

function closeUnifiedDatePicker() {
  $("#unifiedDatePicker")?.classList.add("hidden");
  _unifiedDatePickerState = null;
}

function openJournalRangePicker(opts = {}) {
  const root = _udpEnsure();
  const current = getJournalWindow();
  const from = opts.from || state.journalCustomFrom || current.from || _udpDateKey(new Date());
  const to = opts.to || state.journalCustomTo || current.to || from;
  _unifiedDatePickerState = {
    mode: "range",
    from,
    to,
    _complete: true,
    anchor: _udpMonthStart(_udpParse(from)),
    onApply: opts.onApply,
  };
  root.classList.remove("hidden");
  _udpRender();
}

function openUnifiedSingleDatePicker(input) {
  if (!input) return;
  const root = _udpEnsure();
  const value = input.value || _udpDateKey(new Date());
  _unifiedDatePickerState = {
    mode: "single",
    from: value,
    to: value,
    _complete: true,
    anchor: _udpMonthStart(_udpParse(value)),
    input,
  };
  root.classList.remove("hidden");
  _udpRender();
}

function bindUnifiedDatePickers(root = document) {
  if (root.__unifiedDatePickersBound) return;
  root.__unifiedDatePickersBound = true;
  root.querySelectorAll?.('input[type="date"]:not(.visually-hidden-date)').forEach(function(input) {
    input.readOnly = true;
    input.classList.add("udp-bound-input");
  });
  root.addEventListener("click", function(e) {
    const input = e.target.closest('input[type="date"]:not(.visually-hidden-date)');
    if (!input) return;
    e.preventDefault();
    input.readOnly = true;
    input.classList.add("udp-bound-input");
    input.blur();
    openUnifiedSingleDatePicker(input);
  });
  root.addEventListener("keydown", function(e) {
    const input = e.target.closest?.('input[type="date"]:not(.visually-hidden-date)');
    if (!input || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    openUnifiedSingleDatePicker(input);
  });
}

document.addEventListener("DOMContentLoaded", function() {
  bindUnifiedDatePickers(document);
});

// ---- 054_journal_filter_picker_override.js ----
// ---------- Journal filters override: single range picker + lean controls ----------

function initJournalFilters() {
  var from = $("#jFilterFrom");
  var to = $("#jFilterTo");
  var instr = $("#jFilterInstrument");
  if (!from || !to || !instr) return;

  var now = new Date();
  var win = getJournalWindow();
  from.value = win.from || _fmtDate2(new Date(now.getFullYear(), now.getMonth(), 1));
  to.value = win.to || _fmtDate2(now);
  instr.value = state.statsInstrument || "ALL";
  updateJournalRangeTriggerLabel();

  from.onchange = _applyJournalFilter;
  to.onchange = _applyJournalFilter;
  instr.onchange = _applyJournalFilter;

  var rangeBtn = $("#journalRangePickerBtn");
  if (rangeBtn && !rangeBtn.dataset.bound) {
    rangeBtn.dataset.bound = "1";
    rangeBtn.addEventListener("click", function() {
      if (typeof openJournalRangePicker !== "function") return;
      openJournalRangePicker({
        from: from.value,
        to: to.value,
        onApply: function(start, end) {
          from.value = start;
          to.value = end;
          _applyJournalFilter();
        },
      });
    });
  }

  $$("#journalFilters .jfilter-layout-btn").forEach(function(btn) {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", function() {
      setJournalLayoutMode(btn.dataset.mode, { persist: true, rerender: true });
    });
  });

  // Metric toggle (PnL/Tr/Mix)
  $$("#calendarMetricToggle .calendar-metric-btn").forEach(function(btn) {
    if (btn.dataset.metricBound) return;
    btn.dataset.metricBound = "1";
    btn.addEventListener("click", function() {
      setCalendarMetricMode(btn.dataset.mode, { persist: true, rerender: true });
    });
  });

  bindJournalStatsArrows();
  updateJournalStatsDisplay();
}

function _applyJournalFilter() {
  var from = $("#jFilterFrom");
  var to = $("#jFilterTo");
  var instr = $("#jFilterInstrument");
  if (!from || !to || !instr) return;

  var fromDate = new Date(from.value + "T00:00:00");
  var toDate = new Date(to.value + "T00:00:00");
  if (!from.value || !to.value || isNaN(fromDate) || isNaN(toDate)) return;
  if (fromDate > toDate) {
    var oldFrom = from.value;
    from.value = to.value;
    to.value = oldFrom;
    fromDate = new Date(from.value + "T00:00:00");
    toDate = new Date(to.value + "T00:00:00");
  }

  state.currentMonth = new Date((fromDate.getTime() + toDate.getTime()) / 2);
  state.statsInstrument = instr.value || "ALL";
  state.journalCustomFrom = from.value;
  state.journalCustomTo = to.value;
  state.journalRangeMode = "custom";
  localStorage.setItem(JOURNAL_RANGE_MODE_KEY, "custom");
  localStorage.setItem(JOURNAL_CUSTOM_RANGE_KEY, JSON.stringify({ from: from.value, to: to.value }));
  updateJournalRangeTriggerLabel();
  updateJournalRangeToggleUI();
  updateJournalControlsVisibility();
  loadMonth();
}

function updateJournalRangeTriggerLabel() {
  var label = $("#journalRangeLabel");
  var from = $("#jFilterFrom")?.value || state.journalCustomFrom || "";
  var to = $("#jFilterTo")?.value || state.journalCustomTo || "";
  if (!label) return;
  var txt = from && to ? (from === to ? prettyDateKey(from) : prettyDateKey(from) + " -> " + prettyDateKey(to)) : "Choisir une periode";
  label.textContent = txt;
  label.title = txt;
}

/* ---- Journal stats bar ---- */
var _journalStatsIndex = 0;

var _journalStatsConfig = [
  { key: "winrate",    label: "Winrate",     fmt: function(v) { return v != null ? v.toFixed(1) + "%" : "--"; } },
  { key: "tradesTotal",label: "Trades",      fmt: function(v) { return v != null ? v : "--"; } },
  { key: "pnlAvg",     label: "PnL Moy",     fmt: function(v) { return v != null ? fmtMoney(v) : "--"; } },
  { key: "rrAvg",      label: "RR Moy",      fmt: function(v) { return v != null ? Number(v).toFixed(2) + "R" : "--"; } },
  { key: "profitFactor",label: "Profit Fact", fmt: function(v) { return v != null ? Number(v).toFixed(2) : "--"; } },
  { key: "pnlTotal",   label: "PnL Total",   fmt: function(v) { return v != null ? fmtMoney(v) : "--"; } },
  { key: "streak",     label: "Streak",      fmt: function(v) { return v != null ? v : "--"; } },
  { key: "bestDay",    label: "Best Day",    fmt: function(v) { return v != null ? fmtMoney(v) : "--"; } },
  { key: "worstDay",   label: "Worst Day",   fmt: function(v) { return v != null ? fmtMoney(v) : "--"; } },
];

function computeJournalStats() {
  var days = state.days || [];
  var trades = [];
  days.forEach(function(day) {
    (day.trades || []).forEach(function(t) { trades.push(t); });
  });
  if (trades.length === 0) return { winrate: null, tradesTotal: 0, pnlAvg: null, rrAvg: null, profitFactor: null, pnlTotal: null, streak: null, bestDay: null, worstDay: null };

  var decided = 0, wins = 0, losses = 0, totalPnl = 0, totalRr = 0, rrCount = 0;
  var dayPnl = {}; // date -> sum
  var bestStreak = 0, curStreak = 0, lastResult = null;
  // Sort trades by date for streak computation
  var sorted = trades.slice().sort(function(a,b) { return (a.id||0) - (b.id||0); });

  sorted.forEach(function(t) {
    var m = deriveTradeMetrics(t);
    if (m.isWin === 1 || m.isWin === 0) {
      decided++;
      if (m.isWin === 1) wins++; else losses++;
      if (lastResult === null || m.isWin === lastResult) {
        curStreak++;
      } else {
        curStreak = 1;
      }
      lastResult = m.isWin;
      if (curStreak > bestStreak) bestStreak = curStreak;
    }
    var pnl = m.pnl;
    if (pnl != null) totalPnl += Number(pnl);
    if (m.rr != null) { totalRr += Number(m.rr); rrCount++; }
  });

  // Day-level aggregation for best/worst
  days.forEach(function(day) {
    var daySum = 0;
    (day.trades || []).forEach(function(t) {
      var m = deriveTradeMetrics(t);
      if (m.pnl != null) daySum += Number(m.pnl);
    });
    dayPnl[day.date] = daySum;
  });
  var bestDay = null, worstDay = null;
  Object.keys(dayPnl).forEach(function(d) {
    if (bestDay === null || dayPnl[d] > bestDay) bestDay = dayPnl[d];
    if (worstDay === null || dayPnl[d] < worstDay) worstDay = dayPnl[d];
  });

  // Profit Factor = sum(wins) / abs(sum(losses))
  var sumWins = 0, sumLosses = 0;
  sorted.forEach(function(t) {
    var m = deriveTradeMetrics(t);
    if (m.pnl != null && m.pnl > 0) sumWins += Number(m.pnl);
    if (m.pnl != null && m.pnl < 0) sumLosses += Number(m.pnl);
  });
  var profitFactor = sumLosses !== 0 ? sumWins / Math.abs(sumLosses) : (sumWins > 0 ? 999 : null);

  return {
    winrate: decided > 0 ? (wins / decided) * 100 : null,
    tradesTotal: trades.length,
    pnlAvg:  trades.length > 0 ? totalPnl / trades.length : null,
    rrAvg:   rrCount > 0 ? totalRr / rrCount : null,
    profitFactor: profitFactor,
    pnlTotal: totalPnl,
    streak: bestStreak > 1 ? (lastResult === 1 ? bestStreak + "W" : bestStreak + "L") : null,
    bestDay: bestDay,
    worstDay: worstDay,
  };
}

function updateJournalStatsDisplay() {
  var valueEl = $("#jfilterStatsValue");
  var labelEl = $("#jfilterStatsLabel");
  if (!valueEl || !labelEl) return;

  var stats = computeJournalStats();
  var config = _journalStatsConfig[_journalStatsIndex];
  labelEl.textContent = config.label;
  valueEl.textContent = config.fmt(stats[config.key]);
}

function bindJournalStatsArrows() {
  var row = $("#jfilterStatsRow");
  if (!row || row.dataset.statsBound) return;
  row.dataset.statsBound = "1";
  row.addEventListener("click", function(e) {
    var btn = e.target.closest(".jfilter-stats-arrow");
    if (!btn) return;
    var dir = Number(btn.dataset.dir) || 0;
    _journalStatsIndex = (_journalStatsIndex + dir + _journalStatsConfig.length) % _journalStatsConfig.length;
    updateJournalStatsDisplay();
  });
}

// ---- 055_interactive_empty_background.js ----
// ---------- Interactive empty-space background ----------

(function () {
  var canvas, ctx, rafId;
  var pointer = { x: -9999, y: -9999, tx: -9999, ty: -9999, active: false };
  var cells = [];
  var lastW = 0;
  var lastH = 0;

  function pickCells(w, h) {
    var size = Math.max(44, Math.min(68, Math.round(w / 22)));
    var cols = Math.ceil(w / size) + 2;
    var rows = Math.ceil(h / size) + 2;
    var out = [];
    for (var y = -1; y < rows; y++) {
      for (var x = -1; x < cols; x++) {
        var n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        var r = n - Math.floor(n);
        if (r > 0.78 || (x < 9 && y < 8 && r > 0.60)) {
          out.push({
            x: x * size,
            y: y * size,
            size: size,
            seed: r * 10,
            alpha: 0.08 + r * 0.17,
            hue: r > 0.88 ? "blue" : "red",
          });
        }
      }
    }
    cells = out;
  }

  function resize() {
    if (!canvas) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    lastW = window.innerWidth;
    lastH = window.innerHeight;
    canvas.width = Math.floor(lastW * dpr);
    canvas.height = Math.floor(lastH * dpr);
    canvas.style.width = lastW + "px";
    canvas.style.height = lastH + "px";
    ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pickCells(lastW, lastH);
  }

  function movePointer(e) {
    pointer.tx = e.clientX;
    pointer.ty = e.clientY;
    pointer.active = true;
  }

  function leavePointer() {
    pointer.active = false;
    pointer.tx = -9999;
    pointer.ty = -9999;
  }

  function drawGrid(w, h, t) {
    var grid = 60;
    var offset = (t * 5) % grid;
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.018)";
    for (var x = -grid + offset; x < w + grid; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.012)";
    for (var y = 0; y < h + grid; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  function draw(tms) {
    if (!ctx || !canvas) return;
    var t = tms * 0.001;
    if (lastW !== window.innerWidth || lastH !== window.innerHeight) resize();

    pointer.x += (pointer.tx - pointer.x) * 0.14;
    pointer.y += (pointer.ty - pointer.y) * 0.14;

    ctx.clearRect(0, 0, lastW, lastH);
    drawGrid(lastW, lastH, t);

    var waveX = (Math.sin(t * 0.16) * 0.5 + 0.5) * lastW;
    var ambient = ctx.createRadialGradient(waveX, lastH * 0.42, 0, waveX, lastH * 0.42, Math.max(lastW, lastH) * 0.42);
    ambient.addColorStop(0, "rgba(120,24,24,0.11)");
    ambient.addColorStop(0.45, "rgba(80,20,20,0.045)");
    ambient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = ambient;
    ctx.fillRect(0, 0, lastW, lastH);

    cells.forEach(function (c) {
      var cx = c.x + c.size / 2;
      var cy = c.y + c.size / 2;
      var dx = cx - pointer.x;
      var dy = cy - pointer.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var avoid = pointer.active ? Math.max(0, 1 - dist / 190) : 0;
      var push = avoid * 34;
      var nx = dist > 0 ? dx / dist : 0;
      var ny = dist > 0 ? dy / dist : 0;
      var driftX = Math.sin(t * 0.26 + c.seed) * 8;
      var driftY = Math.cos(t * 0.21 + c.seed) * 7;
      var x = c.x + driftX + nx * push;
      var y = c.y + driftY + ny * push;
      var pulse = c.alpha + (Math.sin(t * 1.1 + c.seed) * 0.5 + 0.5) * 0.08 + avoid * 0.18;
      var color = c.hue === "blue" ? "48,82,255" : "140,32,32";
      ctx.strokeStyle = "rgba(" + color + "," + pulse.toFixed(3) + ")";
      ctx.fillStyle = "rgba(" + color + "," + (pulse * 0.11).toFixed(3) + ")";
      ctx.lineWidth = 1.2;
      ctx.strokeRect(x + 0.5, y + 0.5, c.size - 1, c.size - 1);
      ctx.fillRect(x + 1, y + 1, c.size - 2, c.size - 2);
    });

    rafId = requestAnimationFrame(draw);
  }

  function initInteractiveBackground() {
    canvas = document.getElementById("interactiveBgCanvas");
    if (!canvas) return;
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", movePointer, { passive: true });
    window.addEventListener("mouseleave", leavePointer);
    if (!rafId) rafId = requestAnimationFrame(draw);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initInteractiveBackground);
  } else {
    initInteractiveBackground();
  }
})();

// ---- 056_journal_day_trade_cards.js ----
function journalTradeEditorHtml(day, trade) { return TradeEditorController.renderHtml(day, trade); }

// ---------- Journal inline day trades ----------

var _journalDayTradeCardsBound = false;
var _journalDayTradeCache = {};
var _journalDayTradeDays = {};
var _journalCardSaveTimers = {};
var _journalRefreshTimer = null;
var _jcardFieldFocused = false;

// ---- Intercepteur anti re-fired click (enregistre avant tout) ----
(function() {
  if (window._intRegistered) return;
  window._intRegistered = true;
  window.addEventListener('click', function interceptor(e) {
    var wrap = document.getElementById('journalDayTrades');
    if (!wrap || !wrap.classList.contains('is-editing')) return;
    var inPanel = e.target.closest('.jedit-panel');
    if (inPanel) return;
    if (!wrap.contains(e.target)) return;
    closeJournalTradeEditor();
    window._consumeClick = true;
    setTimeout(function() { window._consumeClick = false; }, 1000);
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);
})();

// ---- collect / summarize helpers ----

function collectJournalDayTrades(days) {
  var out = [];
  (days || []).forEach(function (day) {
    (day.trades || []).forEach(function (trade) {
      out.push({ day: day, trade: trade });
    });
  });
  return out;
}

function summarizeJournalDayTrades(items) {
  return items.reduce(function (acc, item) {
    var m = deriveTradeMetrics(item.trade);
    var pnl = Number(m.pnl || 0);
    acc.pnl += pnl;
    if (m.isWin === 1) acc.wins += 1;
    if (m.isWin === 0) acc.losses += 1;
    acc.instruments[item.day.instrument || "-"] = true;
    return acc;
  }, { pnl: 0, wins: 0, losses: 0, instruments: {} });
}

// ---- inline edit: collect, save, refresh ----

function _journalCardCollectPayload(tid) {
  var tidStr = String(tid);
  var scroll = document.querySelector('.journal-flip-back-scroll[data-trade-id="' + tidStr + '"]');
  if (!scroll) return null;
  var trade = _journalDayTradeCache[tidStr];
  if (!trade) return null;

  var patch = {};

  // text / number inputs and textareas
  scroll.querySelectorAll('input.jcard-field, textarea.jcard-field').forEach(function (el) {
    patch[el.dataset.field] = el.value;
  });

  // pill groups — active pill value per group
  scroll.querySelectorAll('.jcard-pills').forEach(function (group) {
    var field = group.dataset.field;
    var active = group.querySelector('.jcard-pill.is-active');
    if (field) patch[field] = active ? active.dataset.value : '';
  });

  // star rating — stored on the wrapper's data-value
  scroll.querySelectorAll('.jcard-stars').forEach(function (group) {
    var field = group.dataset.field;
    if (field) {
      var starVal = group.dataset.value;
      if (starVal && starVal !== '0') patch[field] = starVal;
    }
  });

  return Object.assign({}, trade, patch);
}

function _journalCardSave(tid) {
  var tidStr = String(tid);
  var payload = _journalCardCollectPayload(tidStr);
  if (!payload) return;

  var scroll = document.querySelector('.journal-flip-back-scroll[data-trade-id="' + tidStr + '"]');
  var ind = scroll && scroll.querySelector('.jcard-save-ind');
  if (ind) { ind.textContent = '…'; ind.dataset.state = 'saving'; }

  api('/api/trades/' + tidStr, { method: 'PUT', body: JSON.stringify(payload) })
    .then(function (res) {
      var updated = (res && res.trade) ? res.trade : payload;
      _journalDayTradeCache[tidStr] = updated;
      _journalCardRefreshMetrics(tidStr, updated);
      _journalSyncStateAfterSave(tidStr, updated);
      _journalRefreshStateDebounced();
      if (ind) {
        ind.textContent = 'Sauvegardé ✓';
        ind.dataset.state = 'saved';
        setTimeout(function () {
          if (ind) { ind.textContent = ''; ind.dataset.state = ''; }
        }, 2200);
      }
    })
    .catch(function () {
      if (ind) { ind.textContent = 'Erreur'; ind.dataset.state = 'error'; }
    });
}

function _journalCardRefreshMetrics(tid, trade) {
  var tidStr = String(tid);
  var scroll = document.querySelector('.journal-flip-back-scroll[data-trade-id="' + tidStr + '"]');
  var card   = document.querySelector('.journal-flip-card[data-trade-id="' + tidStr + '"]');
  var editor = document.querySelector('.journal-trade-editor[data-trade-id="' + tidStr + '"]');
  var m      = deriveTradeMetrics(trade);
  var pnl    = Number(m.pnl || 0);
  var pnlClass    = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : 'flat';
  var resultClass = m.isWin === 1 ? 'win' : m.isWin === 0 ? 'loss' : 'neutral';
  var resultLabel = m.isWin === 1 ? 'WIN' : m.isWin === 0 ? 'LOSS' : '-';
  var rrTxt  = m.rr == null ? '-' : Number(m.rr).toFixed(2) + 'R';
  var pnlTxt = fmtMoney(pnl);

  // Back face
  if (scroll) {
    var pnlEl = scroll.querySelector('.jcard-pnl-display');
    if (pnlEl) { pnlEl.textContent = pnlTxt; pnlEl.className = 'jcard-pnl-display ' + pnlClass; }
    var rrEl  = scroll.querySelector('.jcard-rr-display');
    if (rrEl) rrEl.textContent = rrTxt;
    var resEl = scroll.querySelector('.jcard-result-display');
    if (resEl) { resEl.textContent = resultLabel; resEl.className = 'jcard-result-display ' + resultClass; }
  }

  // Front face
  if (card) {
    var topPnl = card.querySelector('.journal-flip-front .journal-trade-top-pnl');
    if (topPnl) { topPnl.textContent = pnlTxt; topPnl.className = 'journal-trade-top-pnl ' + pnlClass; }
    var topRes = card.querySelector('.journal-flip-front .journal-trade-result');
    if (topRes) { topRes.textContent = resultLabel; topRes.className = 'journal-trade-result ' + resultClass; }
    var frontPnl = card.querySelector('.journal-flip-front .journal-trade-pnl');
    if (frontPnl) { frontPnl.textContent = pnlTxt; frontPnl.className = 'journal-trade-pnl ' + pnlClass; }
  }

  if (editor) {
    var editorPnl = editor.querySelector('.jedit-metric-pnl strong');
    if (editorPnl) { editorPnl.textContent = pnlTxt; editorPnl.className = pnlClass; }
    var editorRr = editor.querySelector('.jedit-metric-rr strong');
    if (editorRr) editorRr.textContent = rrTxt;
    var editorResult = editor.querySelector('.jedit-metric-result strong');
    if (editorResult) { editorResult.textContent = resultLabel; editorResult.className = resultClass; }
  }
}

// ---- Full card DOM refresh + state sync after save ----

function _journalCardRefreshFull(tid, trade) {
  var tidStr = String(tid);
  var card = document.querySelector('.journal-flip-card[data-trade-id="' + tidStr + '"]');
  var day = _journalDayTradeDays[tidStr];
  if (!card || !day) return;

  // Preserve flip state
  var isFlipped = card.classList.contains('is-flipped');

  // Find card index within grid
  var grid = card.closest('.journal-day-trades-grid');
  var idx = 1;
  if (grid) {
    var allCards = grid.querySelectorAll('.journal-flip-card');
    for (var i = 0; i < allCards.length; i++) {
      if (allCards[i] === card) { idx = i + 1; break; }
    }
  }

  var newHtml = journalTradeFlipCardHtml(day, trade, idx, {});
  var temp = document.createElement('div');
  temp.innerHTML = newHtml;
  var newCard = temp.firstElementChild;
  if (isFlipped) newCard.classList.add('is-flipped');
  card.parentNode.replaceChild(newCard, card);
}

// Debounced state refresh for calendar, stats, filters
function _journalRefreshStateDebounced() {
  clearTimeout(_journalRefreshTimer);
  _journalRefreshTimer = setTimeout(function () {
    if (typeof loadMonth === 'function') loadMonth();
    if (typeof loadStats === 'function') loadStats({ refreshDays: false, skipRender: false });
  }, 400);
}

// Lightweight state sync after editor save - updates state.days in place
function _journalSyncStateAfterSave(tid, updated) {
  if (!state || !state.days) return;
  var targetId = Number(tid);
  state.days.forEach(function (day) {
    if (day.trades) {
      day.trades.forEach(function (trade, i) {
        if (Number(trade.id) === targetId) {
          day.trades[i] = updated;
        }
      });
    }
  });
}

function _journalCardScheduleSave(tid) {
  _journalCardSave(tid);
}

// ---- card-style editor drawer ----

// ---- Live recalc PnL/RR/is_win for editor before save ----

// ---- Live editor UI refresh after save ----

// ---- Inline warnings in editor sections ----

function openJournalTradeEditor(tid) {
  TradeEditorController.open(tid);
}

// Save a trade immediately via TradeEditorController
function _journalEditorSave(tid) {
  TradeEditorController.save(String(tid));
}

function _flushPendingJournalSaves() {
  // Execute pending editor saves immediately instead of dropping them
  Object.keys(TradeEditorController.saveTimers).forEach(function (tid) {
    clearTimeout(TradeEditorController.saveTimers[tid]);
    _journalEditorSave(tid);
  });
  TradeEditorController.saveTimers = {};

  // Execute pending card saves immediately
  Object.keys(_journalCardSaveTimers).forEach(function (tid) {
    clearTimeout(_journalCardSaveTimers[tid]);
    _journalCardSave(tid);
  });
  _journalCardSaveTimers = {};
}

function closeJournalTradeEditor(opts) {
  TradeEditorController.close(opts);
}

function bindJournalDayTrades() {
  var wrap = $("#journalDayTrades");
  if (!wrap || _journalDayTradeCardsBound) return;

  wrap.addEventListener("click", function (e) {

    // 🛡️ Bouclier anti re-fired click du navigateur
    if (window._consumeClick) {
      window._consumeClick = false;
      e.stopImmediatePropagation();
      e.preventDefault();
      return;
    }

    var editorClose = e.target.closest("[data-journal-editor-close]");
    if (editorClose) {
      e.stopPropagation();
      closeJournalTradeEditor();
      return;
    }

    var editorSave = e.target.closest("[data-journal-editor-save]");
    if (editorSave) {
      e.stopPropagation();
      var saveTid = editorSave.dataset.journalEditorSave || TradeEditorController.activeTradeId;
      if (saveTid) TradeEditorController.save(saveTid);
      return;
    }

    // Close button
    var closeBtn = e.target.closest("[data-journal-day-close]");
    if (closeBtn) { closeJournalDayTrades(); return; }

    // Edit button → open full modal
    var editBtn = e.target.closest("[data-journal-trade-edit]");
    // Fallback: match by class if data attribute lookup fails (3D transform hit-test edge case)
    if (!editBtn && e.target.tagName === 'BUTTON' && e.target.classList.contains('journal-back-edit')) {
      editBtn = e.target;
    }
    if (editBtn) {
      e.stopPropagation();
      try {
        var tid = editBtn.dataset.journalTradeEdit;
        openJournalTradeEditor(tid);
      } catch (_e) {
        console.error("[cockpit] Erreur ouverture editeur:", _e);
      }
      return;
    }

    var editorPill = e.target.closest('.jedit-pill');
    if (editorPill) {
      e.stopPropagation();
      var editorGroup = editorPill.closest('.jedit-pills');
      if (editorGroup) {
        editorGroup.querySelectorAll('.jedit-pill').forEach(function (p) { p.classList.remove('is-active'); });
        editorPill.classList.add('is-active');
        var editor = editorPill.closest('.journal-trade-editor');
        var editorTid = editor && editor.dataset.tradeId;
        if (editorTid) TradeEditorController.scheduleSave(editorTid);
      }
      return;
    }

    var editorStar = e.target.closest('.jedit-star');
    if (editorStar) {
      e.stopPropagation();
      var editorStars = editorStar.closest('.jedit-stars');
      if (editorStars) {
        var editorVal = Number(editorStar.dataset.val);
        if (String(editorStars.dataset.value) === String(editorVal)) editorVal = 0;
        editorStars.dataset.value = String(editorVal);
        editorStars.querySelectorAll('.jedit-star').forEach(function (s) {
          s.classList.toggle('is-lit', Number(s.dataset.val) <= editorVal);
        });
        var editor2 = editorStars.closest('.journal-trade-editor');
        var editorTid2 = editor2 && editor2.dataset.tradeId;
        if (editorTid2) TradeEditorController.scheduleSave(editorTid2);
      }
      return;
    }

    // Pill toggle (thesis, etc.)
    var pill = e.target.closest('.jcard-pill');
    if (pill) {
      e.stopPropagation();
      var group = pill.closest('.jcard-pills');
      if (group) {
        group.querySelectorAll('.jcard-pill').forEach(function (p) { p.classList.remove('is-active'); });
        pill.classList.add('is-active');
        var scroll = pill.closest('.journal-flip-back-scroll');
        var tid2 = scroll && scroll.dataset.tradeId;
        if (tid2) _journalCardScheduleSave(tid2);
      }
      return;
    }

    // Star rating
    var star = e.target.closest('.jcard-star');
    if (star) {
      e.stopPropagation();
      var starsWrap = star.closest('.jcard-stars');
      if (starsWrap) {
        var val = Number(star.dataset.val);
        // Click same value again → clear
        if (String(starsWrap.dataset.value) === String(val)) val = 0;
        starsWrap.dataset.value = String(val);
        starsWrap.querySelectorAll('.jcard-star').forEach(function (s) {
          s.classList.toggle('is-lit', Number(s.dataset.val) <= val);
        });
        var scroll2 = starsWrap.closest('.journal-flip-back-scroll');
        var tid3 = scroll2 && scroll2.dataset.tradeId;
        if (tid3) _journalCardScheduleSave(tid3);
      }
      return;
    }

    // Back-face icon buttons — don't flip
    if (e.target.closest(".journal-back-icon")) { e.stopPropagation(); return; }

    if (e.target.closest(".journal-trade-editor")) { e.stopPropagation(); return; }

    // 🛡️ Si un champ jcard-field a (ou avait récemment) le focus
    // → l'utilisateur est en train d'éditer → ne pas flipper
    if (_jcardFieldFocused) {
      return;
    }

    // Don't flip when clicking editable elements
    if (e.target.closest('input, textarea, select, .jcard-pills, .jcard-stars')) return;

    // 🛡️ GUARD ULTIME : classe html-editor-open sur <html>.
    if (document.documentElement.classList.contains('html-editor-open')) {
      closeJournalTradeEditor();
      return;
    }

    // Si l'éditeur est ouvert → ferme-le, ne flip pas
    if (TradeEditorController.activeTradeId !== null) {
      closeJournalTradeEditor();
      return;
    }

    // Cooldown booléen fermeture editeur (1000ms)
    if (TradeEditorController.justClosed) return;

    // 🛡️ Grace period timestamp — ne dépend PAS d'un setTimeout
    if (Date.now() - TradeEditorController.closeTime < 1200) return;

    // 🛡️ Bouclier DOM : éditeur encore dans le DOM (invisible, pointer-events: none)
    if (document.querySelector('#journalDayTrades .journal-trade-editor')) return;

    var card = e.target.closest(".journal-flip-card");
    if (!card || !wrap.contains(card)) return;
    console.log('[FLIP_CHECK] TradeEditorController.activeTradeId=', TradeEditorController.activeTradeId, 'TradeEditorController.justClosed=', TradeEditorController.justClosed);
    card.classList.toggle("is-flipped");
  });

  // ---- Track focus on jcard-field pour éviter le flip ----
  wrap.addEventListener("focusin", function (e) {
    if (e.target.closest('.jcard-field')) {
      _jcardFieldFocused = true;
    }
  });
  wrap.addEventListener("focusout", function (e) {
    if (e.target.closest('.jcard-field')) {
      // Le focus est perdu AVANT le click event. On diffère le flag
      // pour que le flip handler du click qui suit le voie encore.
      setTimeout(function () { _jcardFieldFocused = false; }, 300);
    }
  });

  // Save on blur for inputs / textareas
  wrap.addEventListener("focusout", function (e) {
    var field = e.target.closest('.jcard-field');
    if (field) {
      var scroll = field.closest('.journal-flip-back-scroll');
      var tid = scroll && scroll.dataset.tradeId;
      if (tid) _journalCardScheduleSave(tid);
      return;
    }

    var editorField = e.target.closest('.jedit-field');
    if (editorField) {
      var editor = editorField.closest('.journal-trade-editor');
      var editorTid = editor && editor.dataset.tradeId;
      if (editorTid) TradeEditorController.scheduleSave(editorTid);
    }
  });

  wrap.addEventListener("change", function (e) {
    var editorField = e.target.closest('.jedit-field');
    if (!editorField) return;
    var editor = editorField.closest('.journal-trade-editor');
    var editorTid = editor && editor.dataset.tradeId;
    // Live preview: update strategy title on select change
    if (editorField.tagName === 'SELECT' && editorField.dataset.field === 'strategy') {
      var title = editor && editor.querySelector('.jedit-hero-copy h3');
      if (title) title.textContent = editorField.options[editorField.selectedIndex] ?
        editorField.options[editorField.selectedIndex].text : editorField.value;
    }
  });

  wrap.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && TradeEditorController.activeTradeId) {
      e.preventDefault();
      closeJournalTradeEditor();
      return;
    }
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.matches('input, textarea, select, button')) return;
    if (e.target.closest(".journal-trade-editor")) return;

    // 🛡️ Si un champ a le focus → ne pas flipper
    if (wrap.querySelector('.jcard-field:focus, .journal-flip-back-scroll:focus-within')) return;

    // 🛡️ GUARD ULTIME : classe html-editor-open
    if (document.documentElement.classList.contains('html-editor-open')) return;

    // Éditeur ouvert → pas de flip
    if (TradeEditorController.activeTradeId !== null) return;

    // 🛡️ Grace period timestamp
    if (Date.now() - TradeEditorController.closeTime < 1200) return;

    // 🛡️ Bouclier DOM re-fired click
    if (document.querySelector('#journalDayTrades .journal-trade-editor')) return;

    var card = e.target.closest(".journal-flip-card");
    if (!card || !wrap.contains(card)) return;
    e.preventDefault();
    console.log('[FLIP_CHECK_KEY] TradeEditorController.activeTradeId=', TradeEditorController.activeTradeId, 'TradeEditorController.justClosed=', TradeEditorController.justClosed);
    card.classList.toggle("is-flipped");
  });

  // Auto-compute position_size from Marge + Levier + Entry (verso flip card uniquement)
  wrap.addEventListener("input", function (e) {
    var field = e.target.closest('.journal-flip-back-scroll .jcard-margin-input, .journal-flip-back-scroll .jcard-field[data-field="leverage"], .journal-flip-back-scroll .jcard-field[data-field="entry_price"]');
    if (!field) return;
    var scroll = field.closest('.journal-flip-back-scroll');
    if (!scroll) return;
    var tid = scroll.dataset.tradeId;
    if (!tid) return;

    var marginInput = scroll.querySelector('.jcard-margin-input');
    var levInput = scroll.querySelector('.jcard-field[data-field="leverage"]');
    var entryInput = scroll.querySelector('.jcard-field[data-field="entry_price"]');
    var posInput = scroll.querySelector('.jcard-field[data-field="position_size"]');
    if (!marginInput || !levInput || !entryInput || !posInput) return;

    if (field === marginInput || field.dataset.field === 'leverage') {
      var margin = Number(marginInput.value);
      var lev = Number(levInput.value);
      var entry = Number(entryInput.value);
      if (margin > 0 && lev > 0 && entry > 0) {
        var computed = computePositionSize(margin, lev, entry);
        if (computed != null) {
          posInput.value = String(computed);
          // Trigger save indicator
          _journalCardScheduleSave(tid);
        }
      }
    }

    // If user changed position_size, update margin display
    if (field === posInput) {
      var pos = Number(posInput.value);
      var lev2 = Number(levInput.value);
      var entry2 = Number(entryInput.value);
      if (pos > 0 && lev2 > 0 && entry2 > 0) {
        var computedMargin = computeMarginUsd(pos, lev2, entry2);
        if (computedMargin != null) marginInput.value = String(computedMargin);
      }
    }
  });

  // Screenshot upload on card back face
  wrap.addEventListener("click", function (e) {
    var shotEl = e.target.closest(".journal-back-shot");
    if (!shotEl) return;
    var input = shotEl.querySelector(".journal-shot-input");
    if (!input) return;
    input.click();
  });

  wrap.addEventListener("change", function (e) {
    var input = e.target.closest(".journal-shot-input");
    if (!input || !input.files || !input.files[0]) return;
    var file = input.files[0];
    var scroll = input.closest(".journal-flip-back-scroll");
    if (!scroll) return;
    var tid = scroll.dataset.tradeId;
    if (!tid) return;

    var fd = new FormData();
    fd.append("file", file);
    fetch("/api/trades/" + tid + "/screenshots", { method: "POST", body: fd })
      .then(function (r) {
        if (!r.ok) throw new Error("Upload echoue");
        return r.json();
      })
      .then(function () {
        // Recharge le trade pour mettre a jour la capture
        return api("/api/trades/" + tid);
      })
      .then(function (updated) {
        _journalDayTradeCache[String(tid)] = updated;
        _journalCardRefreshFull(String(tid), updated);
        _journalRefreshStateDebounced();
      })
      .catch(function (err) {
        toast(err.message || "Erreur upload screenshot", "error");
      });
    input.value = "";
  });

  _journalDayTradeCardsBound = true;

  // Close on click outside — registered once globally
  if (!window._journalCloseBound) {
    window._journalCloseBound = true;
    document.addEventListener("click", function _closeOnOutside(e) {
      var w = $("#journalDayTrades");
      if (!w || w.classList.contains("hidden")) return;
      // Ne pas fermer si le clic est sur une card, un input verso, le tableau, ou un bouton editer
      if (e.target.closest(".journal-flip-card, #journalDayTrades, .day, #journalTradesTbody, [data-journal-trade-edit]")) return;
      if (!w.contains(e.target)) {
        closeJournalDayTrades();
      }
    });
  }
}

// ---- render / close ----
function renderJournalDayTrades(dateKey, days) {
  var wrap = $("#journalDayTrades");
  if (!wrap) return;
  bindJournalDayTrades();

  var items = collectJournalDayTrades(days);
  if (!items.length) { closeJournalDayTrades(); return; }

  _journalDayTradeCache = {};
  _journalDayTradeDays  = {};
  items.forEach(function (item) {
    var id = String(item.trade.id);
    _journalDayTradeCache[id] = item.trade;
    _journalDayTradeDays[id]  = item.day;
  });

  var summary   = summarizeJournalDayTrades(items);
  var decided   = summary.wins + summary.losses;
  var wr        = decided ? Math.round(summary.wins / decided * 100) + "%" : "-";
  var instruments = Object.keys(summary.instruments).join(" / ");

  wrap.classList.remove("hidden");
  wrap.dataset.count = String(Math.min(items.length, 3));
  wrap.innerHTML = `
    <div class="journal-day-trades-grid">
      ${items.map(function (item, idx) {
        return journalTradeFlipCardHtml(item.day, item.trade, idx + 1, { dateKey: dateKey, wr: wr });
      }).join("")}
    </div>
  `;

  var firstCard = wrap.querySelector(".journal-flip-card");
  if (firstCard) firstCard.focus({ preventScroll: true });
}

function closeJournalDayTrades() {
  var wrap = $("#journalDayTrades");
  if (!wrap) return;
  // Flush any pending saves before destroying
  _flushPendingJournalSaves();
  TradeEditorController.activeTradeId = null;
  document.documentElement.classList.remove('html-editor-open');
  wrap.classList.add("hidden");
  wrap.classList.remove("is-editing");
  delete wrap.dataset.count;
  wrap.innerHTML = "";
  _journalDayTradeCache = {};
  _journalDayTradeDays  = {};
}

// ---- helpers ----

function journalShortText() {
  for (var i = 0; i < arguments.length; i += 1) {
    var v = String(arguments[i] || "").trim();
    if (v) return v.length > 150 ? v.slice(0, 147) + "..." : v;
  }
  return "Aucun resume renseigne pour ce trade.";
}

function journalFmtPrice(v) {
  if (v == null || v === "") return "-";
  var n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "-";
}

function journalValueAttr(v) {
  return v == null ? "" : escapeHtml(String(v));
}

function journalTagsValue(tags) {
  return Array.isArray(tags) ? tags.join(", ") : "";
}

function journalSelectOption(value, label, current) {
  return '<option value="' + escapeHtml(value) + '"' + (String(current || '') === String(value) ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
}

function journalEditorField(label, field, value, type, opts) { return TradeEditorController.field(label, field, value, type, opts); }

function journalEditorTextarea(label, field, value, rows) { return TradeEditorController.textarea(label, field, value, rows); }

function journalEditorPills(field, current, choices) { return TradeEditorController.pills(field, current, choices); }

function journalEditorStrategyOptions(current) { return TradeEditorController.strategyOptions(current); }

// ---- flip card HTML ----

function journalTradeFlipCardHtml(day, trade, idx, deck) {
  var m           = deriveTradeMetrics(trade);
  var pnl         = Number(m.pnl || 0);
  var pnlClass    = pnl > 0 ? "pos" : pnl < 0 ? "neg" : "flat";
  var resultClass = m.isWin === 1 ? "win" : m.isWin === 0 ? "loss" : "neutral";
  var resultLabel = m.isWin === 1 ? "WIN" : m.isWin === 0 ? "LOSS" : "-";
  var direction   = (m.direction || trade.direction || "-").toUpperCase();
  var strategy    = trade.strategy ? prettify(trade.strategy) : "Strategie inconnue";
  var rr          = m.rr == null ? "-" : Number(m.rr).toFixed(2) + "R";
  var summary     = journalShortText(trade.why_trade, trade.scenario, trade.why_entry);
  var lessonsRaw  = String(trade.lessons_learned || "");
  var qualityRaw  = Number(trade.execution_quality) || 0;
  var dateLabel   = prettyDateKey((deck && deck.dateKey) || day.date);
  var htf         = journalShortText(day.htf_context, day.daily_notes, trade.scenario);
  var shot        = (trade.screenshots || [])[0];
  var shotStyle   = shot ? " style=\"background-image:url('/screenshots/" + escapeHtml(shot.filename) + "')\"" : "";
  var shotClass   = shot ? "has-shot" : "is-empty";
  var tid         = escapeHtml(String(trade.id));

  var starsHtml = [1, 2, 3, 4, 5].map(function (i) {
    return '<button type="button" class="jcard-star' + (qualityRaw >= i ? ' is-lit' : '') + '" data-val="' + i + '">★</button>';
  }).join('');

  return `
    <article class="journal-flip-card" tabindex="0" data-trade-id="${tid}">
      <div class="journal-flip-card-inner">

        <!-- ── FRONT ── -->
        <div class="journal-flip-face journal-flip-front">
          <div class="journal-flip-top">
            <span class="metric-pill metric-pill--muted journal-trade-index">#${idx}</span>
            <span class="metric-pill metric-pill--cyan journal-trade-instrument">${escapeHtml(day.instrument || "-")}</span>
            <span class="metric-pill metric-pill--${pnlClass === 'pos' ? 'win' : pnlClass === 'neg' ? 'loss' : 'muted'} journal-trade-top-pnl ${pnlClass}">${fmtMoney(pnl)}</span>
            <span class="metric-pill metric-pill--${resultClass === 'win' ? 'win' : resultClass === 'loss' ? 'loss' : 'muted'} journal-trade-result ${resultClass}">${resultLabel}</span>
            <button type="button" class="journal-card-close" data-journal-day-close aria-label="Fermer">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="journal-trade-shot ${shotClass}"${shotStyle}>
            ${shot ? "" : "<span>Aucune capture</span>"}
          </div>
          <div class="journal-trade-content">
            <div class="journal-trade-main">
              <div>
                <h4>${escapeHtml(strategy)}</h4>
                <p>${escapeHtml(summary)}</p>
              </div>
              <strong class="journal-trade-pnl ${pnlClass}">${fmtMoney(pnl)}</strong>
            </div>
            <div class="journal-trade-strip">
              <span class="metric-pill">${escapeHtml(direction)}</span>
              <span class="metric-pill">${escapeHtml(rr)}</span>
              <span class="metric-pill metric-pill--${resultClass === 'win' ? 'win' : resultClass === 'loss' ? 'loss' : 'muted'}">${escapeHtml(resultLabel)}</span>
            </div>
            <div class="journal-trade-card-actions">
              <span>${escapeHtml(resultLabel)}</span>
              <button type="button">Voir details</button>
            </div>
          </div>
        </div>

        <!-- ── BACK ── -->
        <div class="journal-flip-face journal-flip-back">
          <div class="journal-flip-back-scroll" data-trade-id="${tid}">

            <div class="journal-back-actions">
              <button type="button" class="journal-back-icon" aria-label="Trade marque">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>
              </button>
              <button type="button" class="journal-back-icon" aria-label="Partager">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.7 15.4 6.3"/><path d="M8.6 13.3l6.8 4.4"/></svg>
              </button>
              <span class="jcard-save-ind" data-state=""></span>
              <button type="button" class="journal-back-edit" data-journal-trade-edit="${tid}">Editer</button>
            </div>

            <h4>${escapeHtml(strategy)}</h4>
            <p class="journal-back-sub">${escapeHtml(dateLabel)} · ${escapeHtml(day.instrument || "-")} · ${escapeHtml(direction)}</p>
            <p class="journal-back-summary">${escapeHtml(summary)}</p>

            <div class="journal-back-stats">
              <div><strong>${escapeHtml(direction)}</strong><span>Direction</span></div>
              <div><strong class="jcard-rr-display">${escapeHtml(rr)}</strong><span>R multiple</span></div>
              <div><strong class="jcard-pnl-display ${pnlClass}">${fmtMoney(pnl)}</strong><span>PnL</span></div>
            </div>

            <h5>Niveaux</h5>
            <div class="journal-trade-detail-grid">
              <div style="grid-column:1/-1">
                <span>Entree</span>
                <input class="jcard-field" type="number" step="0.01" data-field="entry_price"
                  value="${trade.entry_price != null ? escapeHtml(String(trade.entry_price)) : ''}" placeholder="—"/>
              </div>
              <div>
                <span>SL</span>
                <input class="jcard-field" type="number" step="0.01" data-field="stop_loss"
                  value="${trade.stop_loss != null ? escapeHtml(String(trade.stop_loss)) : ''}" placeholder="—"/>
              </div>
              <div>
                <span>TP</span>
                <input class="jcard-field" type="number" step="0.01" data-field="exit_price"
                  value="${trade.exit_price != null ? escapeHtml(String(trade.exit_price)) : ''}" placeholder="—"/>
              </div>
            </div>

            <h5>Capture</h5>
            <div class="journal-back-shot" data-trade-shot="${tid}">
              ${shot
                ? `<img class="journal-back-shot-img" src="/screenshots/${escapeHtml(shot.filename)}" alt="Screenshot" />`
                : '<div class="journal-back-shot-empty"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span>Ajouter une photo</span></div>'}
              <input type="file" accept="image/*" class="journal-shot-input hidden" data-trade-shot-input="${tid}" />
            </div>

            <h5>Execution</h5>
            <div class="journal-trade-detail-grid jcard-exec-grid">
              <div>
                <span>Resultat</span>
                <strong class="jcard-result-display ${resultClass}">${escapeHtml(resultLabel)}</strong>
              </div>
              <div>
                <span>Marge $</span>
                <input class="jcard-field jcard-margin-input" type="number" step="0.01" min="0" data-margin-input="1"
                  value="${trade.position_size != null && trade.leverage != null && trade.entry_price != null
                    ? escapeHtml(String(computeMarginUsd(trade.position_size, trade.leverage, trade.entry_price)))
                    : ''}" placeholder="0.00"/>
              </div>
              <div>
                <span>Levier</span>
                <input class="jcard-field" type="number" step="1" min="1" data-field="leverage"
                  value="${trade.leverage != null ? escapeHtml(String(trade.leverage)) : ''}" placeholder="1x"/>
              </div>
              <div>
                <span>Position</span>
                <input class="jcard-field" type="number" step="0.01" data-field="position_size"
                  value="${trade.position_size != null ? escapeHtml(String(trade.position_size)) : ''}" placeholder="—"/>
              </div>
              <div>
                <span>Qualite</span>
                <div class="jcard-stars" data-field="execution_quality" data-value="${qualityRaw}">${starsHtml}</div>
              </div>
            </div>

            <h5>Contexte</h5>
            <div class="journal-trade-back-note">
              <span>HTF / plan</span>
              <p>${escapeHtml(htf)}</p>
            </div>
            <div class="journal-trade-back-note">
              <span>Review</span>
              <textarea class="jcard-field jcard-textarea" data-field="lessons_learned"
                rows="3" placeholder="Lecons apprises…">${escapeHtml(lessonsRaw)}</textarea>
            </div>

          </div>
        </div>

      </div>
    </article>
  `;
}

// ---- 057_debug_labels.js ----
// ---- 057_debug_labels.js ----
// Affiche des labels sur chaque composant avec data-name.
// Activer: localStorage.DEBUG_LABELS = "1" puis reload.
// Desactiver: localStorage.removeItem("DEBUG_LABELS") puis reload.

if (localStorage.DEBUG_LABELS === "1") {
document.addEventListener("DOMContentLoaded", function () {
  var labels = document.querySelectorAll("[data-name]");
  labels.forEach(function (el) {
    var name = el.getAttribute("data-name");
    if (!name) return;
    var badge = document.createElement("span");
    badge.textContent = name;
    badge.style.cssText =
      "position:fixed;bottom:10px;right:10px;z-index:999999;" +
      "padding:3px 9px;border-radius:6px;" +
      "background:rgba(0,0,0,0.50);color:rgba(255,255,255,0.55);" +
      "font-family:'JetBrains Mono',monospace;font-size:9px;" +
      "letter-spacing:0.04em;pointer-events:none;" +
      "opacity:0;transition:opacity 0.2s ease;";
    badge.className = "hermes-debug-label";
    el.appendChild(badge);
    el.addEventListener("mouseenter", function () { badge.style.opacity = "1"; });
    el.addEventListener("mouseleave", function () { badge.style.opacity = "0"; });
  });
});
}

// ---- 058_trade_hero_card.js ----
// ---------- TradeHeroCard — reusable primitive ----------
// Two variants:
//   'flip-front' → journal card front face (light Apple, compact)
//   'card'       → modal trade list (dark theme, full details)
// Returns a DIV (not article) — caller wraps in appropriate container.

function tradeHeroCardHtml(trade, options) {
  options = options || {};
  var variant = options.variant || 'card';
  var day     = options.day || {};
  var idx     = options.index || 1;
  var extraHtml = options.extraHtml || '';
  var extraClasses = options.extraClasses || '';

  var m           = deriveTradeMetrics(trade);
  var pnl         = Number(m.pnl || 0);
  var pnlClass    = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : 'flat';
  var resultClass = m.isWin === 1 ? 'win' : m.isWin === 0 ? 'loss' : 'neutral';
  var resultLabel = m.isWin === 1 ? 'WIN' : m.isWin === 0 ? 'LOSS' : '\u2014';
  var direction   = (m.direction || trade.direction || '-').toUpperCase();
  var strategy    = trade.strategy ? prettify(trade.strategy) : 'Strategie inconnue';
  var rr          = m.rr == null ? '-' : Number(m.rr).toFixed(2) + 'R';
  var summary     = options.summary || journalShortText(trade.why_trade, trade.scenario, trade.why_entry);
  var tid         = escapeHtml(String(trade.id));
  var instr       = options.showInstrument !== false ? escapeHtml(day.instrument || '-') : '';
  var dateLabel   = options.dateLabel || (day.date ? prettyDateKey(day.date) : '');

  // Screenshot
  var shot     = (trade.screenshots || [])[0];
  var shotUrl  = shot ? '/screenshots/' + escapeHtml(shot.filename) : null;
  var shotStyle = shotUrl ? ' style="background-image:url(\'' + shotUrl + '\')"' : '';
  var hasShot   = !!shotUrl;

  // Helper: fmt price
  function _price(v) {
    return v != null && v !== '' ? Number(v).toFixed(2) : '\u2014';
  }

  // ── TOPBAR ──
  var topbarPill = function (text, cls) {
    return '<span class="metric-pill' + (cls ? ' ' + cls : '') + '">' + escapeHtml(text) + '</span>';
  };

  var topbar = '';
  if (variant === 'flip-front') {
    var pnlPillClass = pnlClass === 'pos' ? 'metric-pill--win' : pnlClass === 'neg' ? 'metric-pill--loss' : 'metric-pill--muted';
    var resPillClass = resultClass === 'win' ? 'metric-pill--win' : resultClass === 'loss' ? 'metric-pill--loss' : 'metric-pill--muted';
    topbar =
      '<div class="thc-topbar">' +
        topbarPill('#' + idx, 'metric-pill--muted journal-trade-index') +
        topbarPill(instr, 'metric-pill--cyan journal-trade-instrument') +
        topbarPill(fmtMoney(pnl), pnlPillClass + ' journal-trade-top-pnl ' + pnlClass) +
        topbarPill(resultLabel, resPillClass + ' journal-trade-result ' + resultClass) +
        '<button type="button" class="thc-close journal-card-close" data-journal-day-close aria-label="Fermer">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
      '</div>';
  } else if (variant === 'card') {
    topbar =
      '<div class="thc-topbar">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          topbarPill('#' + idx, 'trade-chip trade-chip-num') +
          topbarPill(instr, 'metric-pill--cyan') +
          '<span class="thc-strategy-name" style="font-size:13px;color:var(--text-soft,#c8ccdb);font-weight:700">' + escapeHtml(strategy) + '</span>' +
        '</div>' +
      '</div>';
  }

  // ── MEDIA ──
  var media = '';
  if (variant === 'flip-front' || variant === 'card') {
    if (hasShot) {
      media = '<div class="thc-media">' +
        '<div class="thc-shot"' + shotStyle + '></div>' +
        (variant === 'card' ? '<div class="trade-card-media-overlay"></div>' : '') +
      '</div>';
    } else {
      var emptyLabel = variant === 'flip-front'
        ? '<span>Aucune capture</span>'
        : '<span>Aucune capture</span><strong>' + escapeHtml(pnl > 0 ? 'Moteur propre' : pnl < 0 ? 'Point a corriger' : 'Setup neutre') + '</strong>';
      media = '<div class="thc-media is-empty">' +
        '<div class="thc-shot-empty">' + emptyLabel + '</div>' +
      '</div>';
    }
  }

  // ── BODY ──
  var dirPillClass = direction === 'LONG' ? 'long' : direction === 'SHORT' ? 'short' : '';
  var resPillClass = resultClass === 'win' ? 'win' : resultClass === 'loss' ? 'loss' : 'neutral';

  var stripHtml =
    '<div class="thc-strip">' +
      '<span class="metric-pill thc-direction' + (dirPillClass ? ' ' + dirPillClass : '') + '">' + escapeHtml(direction || '-') + '</span>' +
      '<span class="metric-pill">' + escapeHtml(rr) + '</span>' +
      '<span class="metric-pill metric-pill--' + resPillClass + '">' + escapeHtml(resultLabel) + '</span>' +
    '</div>';

  var body = '';
  if (variant === 'flip-front') {
    body =
      '<div class="thc-body">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding-bottom:14px">' +
          '<div style="flex:1">' +
            '<h4 class="thc-strategy-name">' + escapeHtml(strategy) + '</h4>' +
            '<p class="thc-summary">' + escapeHtml(summary) + '</p>' +
          '</div>' +
          '<div class="thc-pnl-large" style="flex-shrink:0">' +
            '<strong class="' + pnlClass + '">' + fmtMoney(pnl) + '</strong>' +
          '</div>' +
        '</div>' +
        stripHtml +
        '<div class="journal-trade-card-actions">' +
          '<span>' + escapeHtml(resultLabel) + '</span>' +
          '<button type="button">Voir details</button>' +
        '</div>' +
      '</div>';
  } else if (variant === 'card') {
    var thesisLabel = trade.thesis_validated === 'yes' ? 'These validee' : trade.thesis_validated === 'no' ? 'These rejetee' : 'These a qualifier';
    body =
      '<div class="thc-body">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px">' +
          '<div class="thc-strategy-name">' + escapeHtml(thesisLabel) + '</div>' +
          '<div class="thc-pnl ' + pnlClass + '">' + fmtMoney(pnl) + '</div>' +
        '</div>' +
        stripHtml +
        '<div class="thc-grid">' +
          _thcField('Entree', _price(trade.entry_price)) +
          _thcField('Sortie', _price(trade.exit_price)) +
          _thcField('Stop', _price(trade.stop_loss)) +
          _thcField('Target', _price(trade.take_profit)) +
        '</div>' +
        '<div class="thc-footer">' +
          '<span class="trade-meta-pill">Exec ' + (trade.execution_quality ? trade.execution_quality + '/5' : '-') + '</span>' +
          '<span class="trade-meta-pill">Pos ' + (trade.position_size != null ? Number(trade.position_size) + 'u' : '-') + '</span>' +
          '<span class="trade-edit-hint" style="margin-left:auto;font-size:10px;color:var(--cyan,#00E5FF);letter-spacing:0.45px;text-transform:uppercase;opacity:0.86">Cliquer pour editer</span>' +
        '</div>' +
        (summary ? '<div class="thc-footer-note">' + escapeHtml(summary) + '</div>' : '') +
      '</div>';
  }

  // ── ASSEMBLE — returns a DIV with variant class ──
  return '<div class="trade-hero-card thc--' + variant + ' ' + extraClasses + '"' +
    (variant === 'card' ? ' data-tid="' + tid + '"' : '') +
    '>' +
    topbar + media + body + extraHtml +
    '</div>';
}

// ── Internal helper ──

function _thcField(label, value) {
  return '<div class="thc-field">' +
    '<span class="thc-field-label">' + escapeHtml(label) + '</span>' +
    '<strong class="thc-field-value">' + value + '</strong>' +
  '</div>';
}

// ---- 059_trade_editor_controller.js ----
// ---------- TradeEditorController — inline trade editor ----------
// Responsabilités:
//   - Ouvrir/fermer l'éditeur (drawer latéral)
//   - Collecter le payload du formulaire
//   - Sauvegarder via API (direct ou debounced)
//   - Recalculer les métriques (PnL, RR, is_win) avant save
//   - Afficher les warnings de validation
//   - Gérer le statut save (sauvegarde/sauvé/erreur)
//   - Rafraîchir l'UI après save
//
// Dépend de: deriveTradeMetrics(), journalShortText(), api(), fmtMoney(), escapeHtml(), prettify(), prettyDateKey(), computeMarginUsd(), computePositionSize()

var TradeEditorController = {};

// ---- State ----
TradeEditorController.activeTradeId = null;
TradeEditorController.saveTimers = {};
TradeEditorController.closeTime = 0;
TradeEditorController.justClosed = false;

// ---- Status management ----
TradeEditorController.setStatus = function (editor, state, text) {
  var saveBtn = editor && editor.querySelector('.jedit-save');
  if (!saveBtn) return;
  if (state === 'saving') {
    saveBtn.textContent = text || 'Sauvegarde...';
  } else if (state === 'saved') {
    saveBtn.textContent = text || 'Sauvegarde';
    setTimeout(function () { if (document.body.contains(saveBtn)) saveBtn.textContent = 'Sauver'; }, 2200);
  } else {
    saveBtn.textContent = 'Sauver';
  }
};

// ---- Payload collection ----
TradeEditorController.collectPayload = function (tid) {
  var tidStr = String(tid);
  var editor = document.querySelector('.journal-trade-editor[data-trade-id="' + tidStr + '"]');
  var trade  = _journalDayTradeCache[tidStr];
  if (!editor || !trade) return null;

  var patch = {};

  editor.querySelectorAll('.jedit-field').forEach(function (el) {
    var field = el.dataset.field;
    if (!field) return;
    var val = el.value;
    if (el.dataset.type === 'number') {
      patch[field] = val === '' ? null : Number(val);
    } else if (el.dataset.type === 'int') {
      patch[field] = val === '' ? null : Number(val);
    } else if (el.dataset.type === 'bool') {
      patch[field] = val === '' ? null : val;
    } else if (el.dataset.type === 'tags') {
      patch[field] = String(val || '')
        .split(',')
        .map(function (tag) { return tag.trim(); })
        .filter(Boolean);
    } else {
      patch[field] = val === '' ? null : val;
    }
  });

  editor.querySelectorAll('.jedit-pills').forEach(function (group) {
    var field = group.dataset.field;
    var active = group.querySelector('.jedit-pill.is-active');
    if (field) patch[field] = active ? active.dataset.value : '';
  });

  editor.querySelectorAll('.jedit-stars').forEach(function (group) {
    var field = group.dataset.field;
    if (field) {
      var starVal = group.dataset.value;
      if (starVal && starVal !== '0') patch[field] = starVal;
    }
  });

  return Object.assign({}, trade, patch);
};

// ---- Metrics recalculation before save ----
TradeEditorController.recalcMetrics = function (collected, originalTrade) {
  var entry  = collected.entry_price != null ? Number(collected.entry_price) : null;
  var exit_  = collected.exit_price != null ? Number(collected.exit_price) : null;
  var stop   = collected.stop_loss != null ? Number(collected.stop_loss) : null;
  var target = collected.take_profit != null ? Number(collected.take_profit) : null;
  var qtyRaw = collected.position_size != null ? Number(collected.position_size) : null;
  var qty    = qtyRaw && qtyRaw > 0 ? qtyRaw : 1;
  var dir    = (collected.direction || '').toLowerCase();
  if (!dir && entry != null && stop != null && stop !== entry) {
    dir = stop < entry ? 'long' : 'short';
  }

  // Recalc RR if entry + stop + target available
  if (entry != null && stop != null && target != null && stop !== entry) {
    collected.rr = Number((Math.abs(target - entry) / Math.abs(entry - stop)).toFixed(4));
  }

  // Recalc PnL from exit if user didn't explicitly change pnl
  var pnlExplicit = collected.hasOwnProperty('pnl') && collected.pnl !== (originalTrade && originalTrade.pnl);
  if (!pnlExplicit && dir && entry != null && exit_ != null) {
    collected.pnl = dir === 'long' ? (exit_ - entry) * qty : (entry - exit_) * qty;
  }

  // Infer is_win from pnl
  if (collected.is_win == null || collected.is_win === '') {
    var pnlNum = collected.pnl != null ? Number(collected.pnl) : null;
    if (pnlNum != null) {
      collected.is_win = pnlNum > 0 ? '1' : pnlNum < 0 ? '0' : '';
    }
  }
};

// ---- UI refresh after save ----
TradeEditorController.refreshUI = function (editor, trade) {
  if (!editor || !trade) return;

  // Update direction badge in topline
  var topline = editor.querySelector('.jedit-topline');
  if (topline) {
    var badges = topline.querySelectorAll('span');
    var dir = (trade.direction || '-').toUpperCase();
    if (badges.length >= 3) badges[2].textContent = dir;
  }

  // Le résumé (p) n'est plus refresh ici — le textarea contient déjà la donnée correcte.
  // L'ancienne version pouvait faire clignoter un texte d'un autre champ.
};

// ---- Inline warnings ----
TradeEditorController._warningSection = function (error) {
  var e = error.toLowerCase();
  if (e.indexOf('stop') >= 0 || e.indexOf('tp') >= 0 || e.indexOf("prix d'entree") >= 0) return 1; // Niveaux
  if (e.indexOf('pnl') >= 0) return 1;
  if (e.indexOf('these') >= 0 || e.indexOf('execution') >= 0 || e.indexOf('lecon') >= 0) return 3; // Review
  if (e.indexOf('plan') >= 0 || e.indexOf('override') >= 0) return 4; // Plan
  return 0;
};

TradeEditorController.showWarnings = function (editor, errorMsg) {
  TradeEditorController.clearWarnings(editor);
  if (!errorMsg) return;

  var errors = errorMsg.split('; ');
  errors.forEach(function (err) {
    err = err.trim();
    if (!err) return;
    var sectionIdx = TradeEditorController._warningSection(err);
    if (sectionIdx < 0) return;

    var sections = editor.querySelectorAll('.jedit-block');
    var target   = sections[sectionIdx];
    if (!target) return;

    var warn = document.createElement('div');
    warn.className = 'jedit-block-msg';
    warn.textContent = err;
    var title = target.querySelector('.jedit-block-title');
    if (title) title.parentNode.insertBefore(warn, title.nextSibling);
  });
};

TradeEditorController.clearWarnings = function (editor) {
  if (!editor) return;
  editor.querySelectorAll('.jedit-block-msg').forEach(function (el) { el.remove(); });
};

// ---- Field glow — feedback visuel par champ ---- //

// Mapping champ → section (utilisé par _changedFields pour filtrer les champs metier)
TradeEditorController._fieldToSection = {
  strategy: 0, direction: 0, stdv_level: 0, is_win: 0,
  entry_price: 1, stop_loss: 1, take_profit: 1, exit_price: 1,
  position_size: 1, leverage: 1, pnl: 1, rr: 1,
  why_trade: 2, why_entry: 2, scenario: 2, why_stop: 2, why_tp: 2,
  thesis_validated: 3, execution_quality: 3, tags: 3, lessons_learned: 3,
  plan_model: 4, plan_direction: 4, plan_alignment: 4, plan_score: 4,
  plan_errors: 4, plan_warnings: 4, plan_override_reason: 4, plan_snapshot: 4,
};

TradeEditorController._changedFields = function (payload, original) {
  var fields = {};
  if (!original) return fields;
  Object.keys(payload).forEach(function (key) {
    if (TradeEditorController._fieldToSection[key] === undefined) return;
    // Ignorer les champs qui seront recalculés par recalcMetrics
    // (leur diff est artifact du calcul, pas une modif volontaire)
    if (key === 'rr' || key === 'pnl' || key === 'is_win') return;
    if (String(payload[key] ?? '').trim() !== String(original[key] ?? '').trim()) {
      fields[key] = true;
    }
  });
  return fields;
};

TradeEditorController._findFieldEl = function (editor, fieldName) {
  if (!editor) return null;
  // Chercher l'élément du champ directement (input, textarea, select, pills, stars)
  return editor.querySelector(
    'input[data-field="' + fieldName + '"], ' +
    'textarea[data-field="' + fieldName + '"], ' +
    'select[data-field="' + fieldName + '"], ' +
    '.jedit-pills[data-field="' + fieldName + '"], ' +
    '.jedit-stars[data-field="' + fieldName + '"]'
  ) || null;
};

TradeEditorController._glowFields = function (editor, fields, type) {
  if (!editor) return;
  // Nettoyer les glows précédents du même type
  editor.querySelectorAll('.jedit-field-glow, .jedit-field-error').forEach(function (el) {
    el.classList.remove('jedit-field-glow', 'jedit-field-error');
  });
  if (type === '') return;
  Object.keys(fields).forEach(function (fieldName) {
    var wrap = TradeEditorController._findFieldEl(editor, fieldName);
    if (!wrap) return;
    if (type === 'success') {
      wrap.classList.add('jedit-field-glow');
    } else if (type === 'error') {
      wrap.classList.add('jedit-field-error');
    }
  });
};

// ---- Save ----
TradeEditorController.save = function (tid) {
  var tidStr  = String(tid);
  // Nettoyer tout timer en attente pour éviter une double sauvegarde
  clearTimeout(TradeEditorController.saveTimers[tidStr]);
  
  var original = _journalDayTradeCache[tidStr];
  var payload  = TradeEditorController.collectPayload(tidStr);
  var editor   = document.querySelector('.journal-trade-editor[data-trade-id="' + tidStr + '"]');
  if (!payload || !editor) return;

  // Détecter les champs modifiés
  var changedFields = TradeEditorController._changedFields(payload, original);

  TradeEditorController.recalcMetrics(payload, original);

  // Nettoyer les glows précédents
  TradeEditorController._glowFields(editor, {}, '');
  TradeEditorController.setStatus(editor, 'saving', 'Sauvegarde...');

  api('/api/trades/' + tidStr, { method: 'PUT', body: JSON.stringify(payload) })
    .then(function (res) {
      var updated = (res && res.trade) ? res.trade : res;
      updated = updated && updated.id ? updated : payload;
      _journalDayTradeCache[tidStr] = updated;
      _journalCardRefreshMetrics(tidStr, updated);
      TradeEditorController.refreshUI(editor, updated);
      _journalSyncStateAfterSave(tidStr, updated);
      TradeEditorController.clearWarnings(editor);
      TradeEditorController._glowFields(editor, changedFields, 'success');
      TradeEditorController.setStatus(editor, 'saved', 'Sauvegarde');
      // Retirer le glow après 1s
      setTimeout(function () {
        TradeEditorController._glowFields(editor, changedFields, '');
      }, 1000);
    })
    .catch(function (err) {
      TradeEditorController.showWarnings(editor, (err && err.message) ? err.message : null);
      TradeEditorController._glowFields(editor, changedFields, 'error');
    });
};

TradeEditorController.scheduleSave = function (tid) {
  // Sauvegarde immédiate à la sortie du champ, pas de debounce
  TradeEditorController.save(tid);
};

TradeEditorController.flushPending = function () {
  var timers = TradeEditorController.saveTimers;
  Object.keys(timers).forEach(function (tid) {
    clearTimeout(timers[tid]);
    TradeEditorController.save(tid);
  });
  TradeEditorController.saveTimers = {};
};

// ---- Open / Close ----
TradeEditorController.open = function (tid) {
  var tidStr = String(tid);
  var wrap   = $('#journalDayTrades');
  var trade  = _journalDayTradeCache[tidStr];
  var day    = _journalDayTradeDays[tidStr];
  if (!wrap || !trade || !day) return;

  // Repérer la card source
  var sourceCard = wrap.querySelector('.journal-flip-card[data-trade-id="' + tidStr + '"]');

  TradeEditorController.close({ immediate: true });
  TradeEditorController.activeTradeId = tidStr;
  wrap.classList.add('is-editing');
  wrap.classList.add('is-focusing');
  document.documentElement.classList.add('html-editor-open');
  document.documentElement.classList.add('journal-no-flip');

  // Card source monte, les autres s'atténuent (CSS transitions)
  if (sourceCard) sourceCard.classList.add('is-source');

  // Insérer l'éditeur immédiatement
  wrap.insertAdjacentHTML('beforeend', TradeEditorController.renderHtml(day, trade));

  var editor = wrap.querySelector('.journal-trade-editor[data-trade-id="' + tidStr + '"]');
  if (!editor) return;

  // Double RAF : laisser le navigateur peindre l'état initial (opacity:0)
  // avant de déclencher la transition vers l'état final (opacity:1)
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      editor.classList.add('is-visible');
      var scroll = editor.querySelector('.jedit-scroll');
      if (scroll) {
        scroll.classList.add('is-revealing');
        scroll.addEventListener('scroll', function () {
          scroll.classList.toggle('is-stuck', scroll.scrollTop > 60);
        });
      }
    });
  });

  setTimeout(function () {
    var focusTarget = editor.querySelector('.jedit-field, .jedit-pill, .jedit-close');
    if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus({ preventScroll: true });
  }, 220);
};

TradeEditorController.close = function (opts) {
  var wrap    = $('#journalDayTrades');
  var editor  = wrap && wrap.querySelector('.journal-trade-editor');
  if (!wrap || !editor) return;

  var closingTid = TradeEditorController.activeTradeId;
  TradeEditorController.flushPending();
  TradeEditorController.justClosed = true;
  TradeEditorController.closeTime = Date.now();

  // 🛡️ Mettre à jour les infos de la card SANS remplacer le DOM
  // pour éviter le glitch visuel
  if (closingTid && !(opts && opts.immediate)) {
    _journalCardRefreshMetrics(closingTid, _journalDayTradeCache[String(closingTid)]);
    // Mettre à jour le nom de la stratégie et le résumé sur la face avant
    var card = document.querySelector('.journal-flip-card[data-trade-id="' + String(closingTid) + '"]');
    var trade = _journalDayTradeCache[String(closingTid)];
    if (card && trade) {
      var h4 = card.querySelector('.journal-trade-main h4');
      if (h4) h4.textContent = escapeHtml(trade.strategy ? prettify(trade.strategy) : 'Strategie inconnue');
      var summary = card.querySelector('.journal-trade-main p');
      if (summary) summary.textContent = escapeHtml(TradeEditorController.shortText(trade.why_trade, trade.scenario, trade.why_entry));
    }
  }

  // 🔥 Unfocus : animation inverse
  wrap.classList.add('is-unfocusing');
  wrap.classList.remove('is-focusing');

  // Retirer is-source tout de suite pour que la card
  // suive la transition de retour normalement
  var sourceCard = wrap.querySelector('.journal-flip-card.is-source');
  if (sourceCard) sourceCard.classList.remove('is-source');

  if (opts && opts.immediate) {
    wrap.classList.remove('is-editing');
    wrap.classList.remove('is-unfocusing');
    document.documentElement.classList.remove('html-editor-open');
    document.documentElement.classList.remove('journal-no-flip');
    TradeEditorController.activeTradeId = null;
    editor.remove();
    setTimeout(function () { TradeEditorController.justClosed = false; }, 250);
    return;
  }

  editor.classList.remove('is-visible');
  wrap.classList.remove('is-editing');
  document.documentElement.classList.remove('journal-no-flip');

  // Attendre la fin de l'animation unfocus puis nettoyer
  setTimeout(function () {
    TradeEditorController.activeTradeId = null;
    document.documentElement.classList.remove('html-editor-open');
    wrap.classList.remove('is-unfocusing');
    if (editor.parentNode) editor.remove();
  }, 420);
  setTimeout(function () { TradeEditorController.justClosed = false; }, 500);
};

// ---- Editor HTML helpers ----
TradeEditorController.selectOption = function (value, label, current) {
  return '<option value="' + escapeHtml(value) + '"' + (String(current || '') === String(value) ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
};

TradeEditorController.field = function (label, field, value, type, opts) {
  var o = opts || {};
  var inputType = type === 'number' || type === 'int' ? 'number' : 'text';
  var step      = o.step ? ' step="' + escapeHtml(o.step) + '"' : '';
  var placeholder = o.placeholder ? ' placeholder="' + escapeHtml(o.placeholder) + '"' : '';
  var dataType = type ? ' data-type="' + escapeHtml(type) + '"' : '';
  return '<label class="jedit-field-wrap"><span>' + escapeHtml(label) + '</span><input class="jedit-field" type="' + inputType + '"' + step + dataType + ' data-field="' + escapeHtml(field) + '" value="' + TradeEditorController.valueAttr(value) + '"' + placeholder + ' /></label>';
};

TradeEditorController.textarea = function (label, field, value, rows) {
  return '<label class="jedit-field-wrap jedit-text-wrap"><span>' + escapeHtml(label) + '</span><textarea class="jedit-field" data-field="' + escapeHtml(field) + '" rows="' + (rows || 3) + '">' + escapeHtml(String(value || '')) + '</textarea></label>';
};

TradeEditorController.pills = function (field, current, choices) {
  return '<div class="jedit-pills" data-field="' + escapeHtml(field) + '">' + choices.map(function (choice) {
    var active = String(current || '') === String(choice.value || '');
    return '<button type="button" class="jedit-pill' + (active ? ' is-active' : '') + '" data-value="' + escapeHtml(choice.value || '') + '">' + escapeHtml(choice.label) + '</button>';
  }).join('') + '</div>';
};

TradeEditorController.strategyOptions = function (current) {
  var values = [];
  (DEFAULT_STRATEGY_VALUES || []).forEach(function (value) { if (values.indexOf(value) === -1) values.push(value); });
  ((state && state.settings && state.settings.custom_strategies) || []).forEach(function (s) {
    if (s && s.value && values.indexOf(s.value) === -1) values.push(s.value);
  });
  if (current && values.indexOf(current) === -1) values.push(current);
  return values.map(function (value) { return TradeEditorController.selectOption(value, prettify(value), current); }).join('');
};

TradeEditorController.shortText = function () {
  for (var i = 0; i < arguments.length; i += 1) {
    var v = String(arguments[i] || '').trim();
    if (v) return v.length > 150 ? v.slice(0, 147) + '...' : v;
  }
  return 'Aucun resume renseigne pour ce trade.';
};

TradeEditorController.fmtPrice = function (v) {
  if (v == null || v === '') return '-';
  var n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : '-';
};

TradeEditorController.valueAttr = function (v) {
  return v == null ? '' : escapeHtml(String(v));
};

TradeEditorController.tagsValue = function (tags) {
  return Array.isArray(tags) ? tags.join(', ') : '';
};

// ---- Editor HTML template ----
TradeEditorController.renderHtml = function (day, trade) {
  var m = deriveTradeMetrics(trade);
  var pnl = Number(m.pnl || 0);
  var pnlClass = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : 'flat';
  var resultClass = m.isWin === 1 ? 'win' : m.isWin === 0 ? 'loss' : 'neutral';
  var resultLabel = m.isWin === 1 ? 'WIN' : m.isWin === 0 ? 'LOSS' : '-';
  var direction   = (m.direction || trade.direction || '').toLowerCase();
  var rr    = m.rr == null ? '-' : Number(m.rr).toFixed(2) + 'R';
  var strategy = trade.strategy ? prettify(trade.strategy) : 'Strategie inconnue';
  var dateLabel = prettyDateKey(day.date);
  var shot = (trade.screenshots || [])[0];
  var shotStyle = shot ? ' style="background-image:url(\'/screenshots/' + escapeHtml(shot.filename) + '\')"' : '';
  var shotClass = shot ? 'has-shot' : 'is-empty';
  var qualityRaw = Number(trade.execution_quality) || 0;
  var tid = escapeHtml(String(trade.id));
  var winValue = trade.is_win == null ? '' : String(trade.is_win);
  var starsHtml = [1, 2, 3, 4, 5].map(function (i) {
    return '<button type="button" class="jedit-star' + (qualityRaw >= i ? ' is-lit' : '') + '" data-val="' + i + '">★</button>';
  }).join('');
  var screenshotsHtml = (trade.screenshots || []).length
    ? (trade.screenshots || []).map(function (s) {
        return '<a class="jedit-shot-thumb" href="/screenshots/' + escapeHtml(s.filename) + '" target="_blank" rel="noreferrer" style="background-image:url(&quot;/screenshots/' + escapeHtml(s.filename) + '&quot;)" aria-label="Ouvrir screenshot"></a>';
      }).join('')
    : '<div class="jedit-empty">Aucune capture pour ce trade.</div>';

  return '\n    <aside class="journal-trade-editor" data-trade-id="' + tid + '" role="dialog" aria-label="Edition du trade">\n      <div class="jedit-panel">\n        <div class="jedit-hero">\n          <div class="jedit-hero-shot ' + shotClass + '"' + shotStyle + '>' + (shot ? '' : '<span>Aucune capture</span>') + '</div>\n          <div class="jedit-hero-copy">\n            <div class="jedit-topline">\n              <span>' + escapeHtml(dateLabel) + '</span>\n              <span>' + escapeHtml(day.instrument || '-') + '</span>\n              <span>' + escapeHtml((direction || '-').toUpperCase()) + '</span>\n            </div>\n            <h3>' + escapeHtml(strategy) + '</h3>\n            <p>' + escapeHtml(TradeEditorController.shortText(trade.why_trade, trade.scenario, trade.why_entry)) + '</p>\n            <div class="jedit-metrics">\n              <div class="jedit-metric-pnl"><strong class="' + pnlClass + '">' + fmtMoney(pnl) + '</strong><span>PnL</span></div>\n              <div class="jedit-metric-rr"><strong>' + escapeHtml(rr) + '</strong><span>R multiple</span></div>\n              <div class="jedit-metric-result"><strong class="' + resultClass + '">' + escapeHtml(resultLabel) + '</strong><span>Resultat</span></div>\n            </div>\n          </div>\n          <div class="jedit-actions">\n            <span class="jedit-status" data-state=""></span>\n            <button type="button" class="jedit-save" data-journal-editor-save="' + tid + '">Sauver</button>\n            <button type="button" class="jedit-close" data-journal-editor-close aria-label="Fermer">\n              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>\n            </button>\n          </div>\n        </div>\n\n        <div class="jedit-scroll">\n          <div class="jedit-sticky">\n            <button type="button" class="jedit-save" data-journal-editor-save="' + tid + '">Sauver</button>\n            <button type="button" class="jedit-close" data-journal-editor-close aria-label="Fermer">\n              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>\n            </button>\n          </div>\n          <section class="jedit-block jedit-identity">\n            <div class="jedit-block-title"><span>01</span><h4>Setup</h4></div>\n            <div class="jedit-grid">\n              <label class="jedit-field-wrap"><span>Strategie</span><select class="jedit-field" data-field="strategy">' + TradeEditorController.strategyOptions(trade.strategy || '') + '</select></label>\n              <label class="jedit-field-wrap"><span>Direction</span>' + TradeEditorController.pills('direction', direction, [{ value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }, { value: '', label: '?' }]) + '</label>\n              ' + TradeEditorController.field('Stdv', 'stdv_level', trade.stdv_level, 'number', { step: '0.5', placeholder: '1 - 5' }) + '\n              <label class="jedit-field-wrap"><span>Resultat</span><select class="jedit-field" data-field="is_win" data-type="bool">' + TradeEditorController.selectOption('', 'A qualifier', winValue) + TradeEditorController.selectOption('1', 'Win', winValue) + TradeEditorController.selectOption('0', 'Loss', winValue) + '</select></label>\n            </div>\n          </section>\n\n          <section class="jedit-block">\n            <div class="jedit-block-title"><span>02</span><h4>Niveaux</h4></div>\n            <div class="jedit-grid jedit-grid-5">\n              ' + TradeEditorController.field('Entree', 'entry_price', trade.entry_price, 'number', { step: '0.01' }) + '\n              ' + TradeEditorController.field('Stop', 'stop_loss', trade.stop_loss, 'number', { step: '0.01' }) + '\n              ' + TradeEditorController.field('Target', 'take_profit', trade.take_profit, 'number', { step: '0.01' }) + '\n              ' + TradeEditorController.field('Sortie', 'exit_price', trade.exit_price, 'number', { step: '0.01' }) + '\n              ' + TradeEditorController.field('Size', 'position_size', trade.position_size, 'number', { step: '0.01' }) + '\n              ' + TradeEditorController.field('Levier', 'leverage', trade.leverage, 'number', { step: '1', placeholder: '1x' }) + '\n              ' + TradeEditorController.field('PnL', 'pnl', trade.pnl, 'number', { step: '0.01' }) + '\n              ' + TradeEditorController.field('RR', 'rr', trade.rr, 'number', { step: '0.01' }) + '\n            </div>\n          </section>\n\n          <section class="jedit-block">\n            <div class="jedit-block-title"><span>03</span><h4>Scenario</h4></div>\n            <div class="jedit-notes">\n              ' + TradeEditorController.textarea('Pourquoi ce trade', 'why_trade', trade.why_trade, 3) + '\n              ' + TradeEditorController.textarea('Pourquoi cette entree', 'why_entry', trade.why_entry, 3) + '\n              ' + TradeEditorController.textarea('Scenario complet', 'scenario', trade.scenario, 4) + '\n              ' + TradeEditorController.textarea('Pourquoi ce stop', 'why_stop', trade.why_stop, 3) + '\n              ' + TradeEditorController.textarea('Pourquoi ce TP', 'why_tp', trade.why_tp, 3) + '\n            </div>\n          </section>\n\n          <section class="jedit-block">\n            <div class="jedit-block-title"><span>04</span><h4>Review</h4></div>\n            <div class="jedit-grid">\n              <label class="jedit-field-wrap"><span>These validee</span>' + TradeEditorController.pills('thesis_validated', trade.thesis_validated || '', [{ value: 'yes', label: 'Oui' }, { value: 'no', label: 'Non' }, { value: '', label: '?' }]) + '</label>\n              <label class="jedit-field-wrap"><span>Qualite execution</span><div class="jedit-stars" data-field="execution_quality" data-value="' + qualityRaw + '">' + starsHtml + '</div></label>\n              ' + TradeEditorController.field('Tags', 'tags', TradeEditorController.tagsValue(trade.tags), 'tags', { placeholder: 'tag1, tag2' }) + '\n              ' + TradeEditorController.textarea('Lecons apprises', 'lessons_learned', trade.lessons_learned, 4) + '\n            </div>\n          </section>\n\n          <section class="jedit-block">\n            <div class="jedit-block-title"><span>05</span><h4>Plan & captures</h4></div>\n            <div class="jedit-plan-grid">\n              <div><span>Plan model</span><strong>' + escapeHtml(trade.plan_model || '-') + '</strong></div>\n              <div><span>Direction plan</span><strong>' + escapeHtml(trade.plan_direction || '-') + '</strong></div>\n              <div><span>Alignement</span><strong>' + escapeHtml(trade.plan_alignment || 'unknown') + '</strong></div>\n              <div><span>Score</span><strong>' + (trade.plan_score == null ? '-' : escapeHtml(String(trade.plan_score))) + '</strong></div>\n            </div>\n            ' + TradeEditorController.textarea('Raison override plan', 'plan_override_reason', trade.plan_override_reason, 3) + '\n            <div class="jedit-shots">' + screenshotsHtml + '</div>\n          </section>\n        </div>\n      </div>\n    </aside>\n  ';
};
