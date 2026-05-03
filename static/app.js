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
    tag: ["ALL"],
    pnlMin: "",
    pnlMax: "",
  },
  // Journal table sorting
  journalTableSortKey: "date",
  journalTableSortDir: "desc",
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
  var rail = document.getElementById("instrList");
  if (rail) {
    rail.innerHTML = '<button class="instr-chip active" data-instr="ALL" role="tab" aria-selected="true"><span class="dot" aria-hidden="true"></span>Tous</button>';
  }
  var ctx = document.getElementById("entryInstrument");
  if (ctx) {
    ctx.innerHTML = '<option value="">Instrument</option>';
  }
  var jf = document.getElementById("jFilterInstrument");
  if (jf) {
    jf.innerHTML = '<option value="ALL">Tous</option>';
  }
}

function loadInstruments() {
  fetch("/api/trades/instruments", { credentials: "same-origin" })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (!data || !data.instruments) return;
      var instrs = data.instruments;
      var rail = document.getElementById("instrList");
      if (rail) {
        rail.innerHTML = '<button class="instr-chip active" data-instr="ALL" role="tab" aria-selected="true"><span class="dot" aria-hidden="true"></span>Tous</button>' +
          instrs.map(function (i) { return '<button class="instr-chip" data-instr="' + i + '" role="tab" aria-selected="false"><span class="dot" aria-hidden="true"></span>' + i + "</button>"; }).join("");
      }
      var ctx = document.getElementById("entryInstrument");
      if (ctx) {
        ctx.innerHTML = '<option value="">Instrument</option>' +
          instrs.map(function (i) { return '<option value="' + i + '">' + i + "</option>"; }).join("");
      }
      var jf = document.getElementById("jFilterInstrument");
      if (jf) {
        jf.innerHTML = '<option value="ALL">Tous</option>' +
          instrs.map(function (i) { return '<option value="' + i + '">' + i + "</option>"; }).join("");
      }
    })
    .catch(function() {
      // Fallback: use hardcoded INSTRUMENTS if API fails
      var ctx = document.getElementById("entryInstrument");
      if (ctx && ctx.options.length <= 1) {
        INSTRUMENTS.forEach(function(i) {
          var opt = document.createElement("option");
          opt.value = i;
          opt.textContent = i;
          ctx.appendChild(opt);
        });
      }
    });
}

function populateInstruments(selectId) {
  var sel = document.getElementById(selectId);
  if (!sel) return;
  fetch("/api/trades/instruments", { credentials: "same-origin" })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (!data || !data.instruments) return;
      var currentVal = sel.value;
      while (sel.options.length > 1) sel.remove(1);
      data.instruments.forEach(function(instr) {
        var opt = document.createElement("option");
        opt.value = instr;
        opt.textContent = instr;
        sel.appendChild(opt);
      });
      if (currentVal) sel.value = currentVal;
    })
    .catch(function() {
      // Fallback: use hardcoded INSTRUMENTS if API fails
      var ctx = document.getElementById("entryInstrument");
      if (ctx && ctx.options.length <= 1) {
        INSTRUMENTS.forEach(function(i) {
          var opt = document.createElement("option");
          opt.value = i;
          opt.textContent = i;
          ctx.appendChild(opt);
        });
      }
    });
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

// ---- Instruments ----
function populateInstruments(selectId) {
  var sel = document.getElementById(selectId);
  if (!sel) return;
  fetch("/api/trades/instruments", { credentials: "same-origin" })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (!data || !data.instruments) return;
      var currentVal = sel.value;
      while (sel.options.length > 1) sel.remove(1);
      data.instruments.forEach(function(instr) {
        var opt = document.createElement("option");
        opt.value = instr;
        opt.textContent = instr;
        sel.appendChild(opt);
      });
      if (currentVal) sel.value = currentVal;
    })
    .catch(function() {
      // Fallback: use hardcoded INSTRUMENTS if API fails
      var ctx = document.getElementById("entryInstrument");
      if (ctx && ctx.options.length <= 1) {
        INSTRUMENTS.forEach(function(i) {
          var opt = document.createElement("option");
          opt.value = i;
          opt.textContent = i;
          ctx.appendChild(opt);
        });
      }
    });
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
  // Pour les erreurs critiques, ajouter un indicateur persistant sur le widget-board
  if (type === "error") {
    var board = document.querySelector('[data-widget-board="today"]');
    if (board && msg.indexOf("stats") >= 0 || msg.indexOf("API") >= 0 || msg.indexOf("réseau") >= 0 || msg.indexOf("HTTP") >= 0) {
      board.setAttribute("data-last-error", msg);
      // Auto-clear apres 10s
      clearTimeout(board._errTimer);
      board._errTimer = setTimeout(function() { board.removeAttribute("data-last-error"); }, 10000);
    }
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
  fetch("/api/user/settings", { credentials: "same-origin" })
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (!data || !data.settings) return;
      // Ne pas ecraser si l'utilisateur a modifie entre temps
      if (JSON.stringify(state.settings) !== localSnapshot) return;
      // Ne pas ecraser avec des donnees vides si on a des donnees locales
      var apiKeys = Object.keys(data.settings);
      if (apiKeys.length === 0) return;
      var merged = Object.assign({}, defaultSettingsState(), data.settings);
      merged.custom_strategies = normalizeCustomStrategies(merged.custom_strategies || []);
      state.settings = sanitizeSettings(merged);
      applySettingsState();
      renderSettingsPage();
      try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state.settings)); } catch(_) {}
    })
    .catch(function() {});
  return state.settings;
}

function saveSettingsState() {
  if (!state.settings) return;
  try { localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state.settings)); } catch(_) {}
  fetch("/api/user/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(state.settings),
  }).catch(function() {
    toast("Erreur lors de la sauvegarde des réglages", "error");
  });
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
    tag: ["ALL"],
    pnlMin: "",
    pnlMax: "",
    search: "",
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

  const quickWrap = $("#calendarQuickRange");
  if (quickWrap) quickWrap.classList.toggle("hidden", !showCustom);

  const customLabel = $("#calendarCustomLabel");
  if (customLabel) {
    const from = state.journalCustomFrom || "";
    const to = state.journalCustomTo || "";
    customLabel.textContent = from && to ? `${prettyDateKey(from)} -> ${prettyDateKey(to)}` : "Choisir une plage";
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
  strategySel.value = f.strategy || "ALL";
  if (resultSel) resultSel.value = f.result || "ALL";

  // Sync chips UI
  var chipsContainer = $("#journalTagChips");
  if (chipsContainer) {
    var chips = chipsContainer.querySelectorAll(".tag-chip");
    var selected = Array.isArray(f.tag) ? f.tag : ["ALL"];
    chips.forEach(function (chip) {
      var val = chip.dataset.tag;
      var isActive = selected.some(function (s) { return s === val; });
      chip.classList.toggle("is-active", isActive);
    });
  }
  var pnlMin = $("#journalFilterPnlMin");
  var pnlMax = $("#journalFilterPnlMax");
  if (pnlMin) pnlMin.value = parseFilterNumber(f.pnlMin) != null ? f.pnlMin : "";
  if (pnlMax) pnlMax.value = parseFilterNumber(f.pnlMax) != null ? f.pnlMax : "";
  var searchInput = $("#journalFilterSearch");
  if (searchInput) searchInput.value = f.search || "";

  // Badge actif sur le summary
  var count = 0;
  if (f.strategy && f.strategy !== "ALL") count++;
  if (f.result && f.result !== "ALL") count++;
  if (Array.isArray(f.tag) && f.tag[0] !== "ALL" && f.tag.length) count += f.tag.length;
  if (parseFilterNumber(f.pnlMin) != null) count++;
  if (parseFilterNumber(f.pnlMax) != null) count++;
  if (f.search && f.search.trim().length >= 2) count++;
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
  // Garder <details> ouvert si des filtres avancés sont actifs
  var details = document.querySelector(".journal-advanced-filters");
  if (details) {
    details.open = count > 0;
  }
}

var _journalFilterOptionsHash = "";

function updateJournalTradeFilterOptions(days = state.days) {
  // Memoize: ne pas reconstruire si les donnees n'ont pas change
  // (evite flash/perte focus navigation, J-23)
  var hash = (Array.isArray(days) ? days.map(function (d) {
    return d.date + ":" + (d.trades || []).map(function (t) { return (t.strategy||"") + "|" + (t.tags||[]).join(","); }).join(";");
  }).join("|") : "") + "|" + (state.settings?.custom_strategies||[]).length + "|" + (state.settings?.custom_tags||[]).length;
  if (hash === _journalFilterOptionsHash) return;
  _journalFilterOptionsHash = hash;

  const strategySel = $("#journalFilterStrategy");

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

  // Tags → chips cliquables dans #journalTagChips
  var tagChips = $("#journalTagChips");
  if (tagChips) {
    var selectedTags = Array.isArray(state.journalTradeFilters?.tag) ? state.journalTradeFilters.tag : ["ALL"];
    tagChips.innerHTML = "";
    // Toujours un chip "Tous" en premier
    var allChip = document.createElement("button");
    allChip.type = "button";
    allChip.className = "tag-chip" + (selectedTags[0] === "ALL" ? " is-active" : "");
    allChip.dataset.tag = "ALL";
    allChip.textContent = "Tous";
    tagChips.appendChild(allChip);
    Array.from(tagSet).sort(function (a, b) {
      if (a === "ALL") return -1;
      if (b === "ALL") return 1;
      return String(a).localeCompare(String(b));
    }).forEach(function (value) {
      if (value === "ALL") return;
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "tag-chip" + (selectedTags.indexOf(value) >= 0 ? " is-active" : "");
      chip.dataset.tag = value;
      chip.textContent = "#" + value;
      tagChips.appendChild(chip);
    });
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
  updateJournalRangeTriggerLabel();
  updateJournalControlsVisibility();
  if (persist) localStorage.setItem(JOURNAL_RANGE_MODE_KEY, mode);
  if (reload && state.currentPage === "journal") loadMonth();
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
    || (Array.isArray(f.tag) && f.tag[0] !== "ALL" && f.tag.length)
    || parseFilterNumber(f.pnlMin) != null
    || parseFilterNumber(f.pnlMax) != null
    || (f.search && f.search.trim().length >= 2)
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
  if (f.tag && Array.isArray(f.tag) && f.tag[0] !== "ALL") {
    var hasTag = (row.tags || []).some(function (t) {
      return f.tag.some(function (selected) { return String(t).toLowerCase() === String(selected).toLowerCase(); });
    });
    if (!hasTag) return false;
  }

  const min = parseFilterNumber(f.pnlMin);
  const max = parseFilterNumber(f.pnlMax);
  const pnl = row.pnl == null ? 0 : Number(row.pnl);
  if (min != null && pnl < min) return false;
  if (max != null && pnl > max) return false;

  // Full-text search — minimum 2 caracteres, cherche dans les textes longs du trade
  if (f.search && f.search.trim().length >= 2) {
    var q = f.search.trim().toLowerCase();
    var t = row.trade || {};
    var haystack = [
      t.why_trade, t.scenario, t.why_entry,
      t.why_stop, t.why_tp, t.lessons_learned,
      t.plan_override_reason, t.plan_snapshot,
    ].concat(row.tags || []).filter(Boolean).join(" ").toLowerCase();
    if (haystack.indexOf(q) === -1) return false;
  }

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
let _journalTableObserver = null;
let _journalTableCurrentPage = 0;
let _journalTableTotalRows = 0;

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

  // Tags chips — click toggles selection
  var tagChips = document.getElementById("journalTagChips");
  if (tagChips) {
    tagChips.addEventListener("click", function (e) {
      var chip = e.target.closest(".tag-chip");
      if (!chip) return;
      var val = chip.dataset.tag;
      var current = Array.isArray(state.journalTradeFilters.tag) ? state.journalTradeFilters.tag.slice() : ["ALL"];
      if (val === "ALL") {
        // "Tous" → reset to ALL
        state.journalTradeFilters.tag = ["ALL"];
      } else {
        if (current[0] === "ALL") current = [];
        var idx = current.indexOf(val);
        if (idx >= 0) {
          current.splice(idx, 1); // deselect
        } else {
          current.push(val); // select
        }
        if (!current.length) current = ["ALL"];
        state.journalTradeFilters.tag = current;
      }
      updateJournalTradeFiltersUI();
      applyJournalTradeFiltersAndRender();
    });
  }

  let timer = null;
  const onPnlInput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.journalTradeFilters.pnlMin = minInput?.value || "";
      state.journalTradeFilters.pnlMax = maxInput?.value || "";
      // Validation croisee: min ≤ max
      var minVal = parseFilterNumber(minInput?.value);
      var maxVal = parseFilterNumber(maxInput?.value);
      var invalid = minVal != null && maxVal != null && minVal > maxVal;
      if (minInput) minInput.classList.toggle("jedit-field-error", invalid);
      if (maxInput) maxInput.classList.toggle("jedit-field-error", invalid);
      // Message d'erreur
      var errEl = document.getElementById("pnlRangeError");
      if (errEl) errEl.classList.toggle("hidden", !invalid);
      if (invalid) return;  // ne pas appliquer le filtre si invalide
      applyJournalTradeFiltersAndRender();
    }, 140);
  };
  minInput?.addEventListener("input", onPnlInput);
  maxInput?.addEventListener("input", onPnlInput);

  // Search — debounce 200ms, hint glow si < 2 chars
  const searchInput = $("#journalFilterSearch");
  let searchTimer = null;
  const hideSearchHint = function () {
    if (searchInput) {
      searchInput.classList.remove("search-too-short");
      searchInput.classList.remove("jedit-field-error");
      var hint = document.getElementById("journalSearchHint");
      if (hint) hint.classList.add("hidden");
    }
  };
  const onSearchInput = function () {
    clearTimeout(searchTimer);
    if (!searchInput) return;
    searchInput.classList.remove("search-too-short");
    searchInput.classList.remove("jedit-field-error");
    var hint = document.getElementById("journalSearchHint");
    if (hint) hint.classList.add("hidden");
    var val = (searchInput.value || "").trim();
    searchTimer = setTimeout(function () {
      state.journalTradeFilters.search = val;
      if (val.length >= 2) {
        fetch("/api/journal/search?q=" + encodeURIComponent(val), { credentials: "same-origin" })
          .then(function(r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
          .then(function(data) {
            if (data && data.days) {
              state._savedDays = state._savedDays || state.days;
              state.days = data.days;
              applyJournalTradeFiltersAndRender();
            }
          })
          .catch(function() {});
      } else {
        if (val.length === 0 && state._savedDays) {
          state.days = state._savedDays;
          state._savedDays = null;
        }
        applyJournalTradeFiltersAndRender();
      }
      // Glow rouge si < 2 chars (sauf vide)
      if (val.length === 1) {
        searchInput.classList.add("search-too-short");
        searchInput.classList.add("jedit-field-error");
        if (hint) hint.classList.remove("hidden");
      }
    }, 200);
  };
  if (searchInput) {
    searchInput.addEventListener("input", onSearchInput);
    searchInput.addEventListener("blur", hideSearchHint);
  }

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
  var pageSize = 100;
  var visibleRows = rows.slice(0, pageSize);

  visibleRows.forEach((row, idx) => {
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

  // Lazy load : observer l'intersection pour charger les pages suivantes
  var pageSize = 100;
  if (_journalTableObserver) _journalTableObserver.disconnect();
  _journalTableCurrentPage = 0;
  _journalTableTotalRows = rows.length;
  if (rows.length > pageSize) {
    _journalTableCurrentPage = 1; // 1 page deja chargee
    var sentinel = document.createElement("tr");
    sentinel.id = "journalTableSentinel";
    sentinel.innerHTML = '<td colspan="10" style="text-align:center;padding:16px"><span class="muted" style="font-size:11px">Chargement...</span></td>';
    tbody.appendChild(sentinel);
    _journalTableObserver = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      if (_journalTableCurrentPage * pageSize >= _journalTableTotalRows) {
        _journalTableObserver.disconnect();
        sentinel.querySelector("td").innerHTML = '<span class="muted" style="font-size:11px">' + _journalTableTotalRows + " trades</span>";
        return;
      }
      var start = _journalTableCurrentPage * pageSize;
      var end = Math.min(start + pageSize, _journalTableTotalRows);
      var batch = rows.slice(start, end);
      var frag = document.createDocumentFragment();
      batch.forEach(function (row, idx) {
        var tr = document.createElement("tr");
        tr.dataset.rowIndex = String(start + idx);
        var pnlClass = row.pnl > 0 ? "pos" : row.pnl < 0 ? "neg" : "";
        var dir = row.direction ? row.direction.toUpperCase() : "-";
        var pnlTxt = row.pnl == null ? "-" : fmtMoney(row.pnl);
        tr.innerHTML = '<td class="mono">' + escapeHtml(row.date || "-") + '</td><td>' + escapeHtml(wizInstrumentLabel(row.instrument)) + '</td><td>' + escapeHtml(prettify(row.strategy || "")) + '</td><td class="mono ' + (row.direction === 'long' ? 'dir-long' : 'dir-short') + '">' + escapeHtml(dir) + '</td><td class="mono">' + (row.entry_price != null ? Number(row.entry_price).toFixed(2) : "-") + '</td><td class="mono">' + (row.exit_price != null ? Number(row.exit_price).toFixed(2) : "-") + '</td><td class="mono">' + (row.rr != null ? Number(row.rr).toFixed(2) + "R" : "-") + '</td><td class="mono journal-td-pnl ' + pnlClass + '">' + pnlTxt + '</td><td class="mono ' + (row.result || "").toLowerCase() + '">' + escapeHtml(row.result || "-") + "</td>";
        frag.appendChild(tr);
      });
      sentinel.parentNode.insertBefore(frag, sentinel);
      _journalTableCurrentPage++;
      var loaded = Math.min(_journalTableCurrentPage * pageSize, _journalTableTotalRows);
      sentinel.querySelector("td").innerHTML = '<span class="muted" style="font-size:11px">' + loaded + "/" + _journalTableTotalRows + " trades...</span>";
    }, { rootMargin: "200px" });
    _journalTableObserver.observe(sentinel);
  }

  const count = rows.length;
  countEl.textContent = `${count} trade${count > 1 ? "s" : ""}`;
  emptyEl.classList.toggle("hidden", count > 0);
}

// ---- 007_loadcalendarmonthfocusmode.js ----
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
  if (rerender && state.currentPage === "insights") renderPerformance();
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
    renderInstruments(); loadInstruments();
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
  state.breakdownSortMode = loadBreakdownSortMode();
  // Restaurer la derniere page active (#55)
  var lastPage = localStorage.getItem("lastPage");
  if (lastPage && ["today","journal","settings"].indexOf(lastPage) >= 0) {
    state.currentPage = lastPage;
  }
  bindNav();
  bindAiPanelToggle();
  bindCalendarNav();
  bindJournalNightToggle();
  bindCalendarMetricToggle();
  bindJournalViewToggle();
  bindJournalLayoutToggle();
  bindJournalRangeToggle();
  bindJournalTradeFilters();
  bindJournalTableSort();
  bindBreakdownSort();
  bindFilter();
  bindExport();
  bindGlobalKeys();
  bindCmdk();
  bindPills();
  bindTagsInput();
  bindQuality();
  bindRRPreview();
  if (typeof bindMidnightChallenge === "function") bindMidnightChallenge();
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
  updateBreakdownSortUI();
  setTodayHeader();
  loadAll();
  enhanceSelects(document);

  // Abonnements d'etat — rendent explicites les dependances entre modules.
  // Desormais, modifier state.days ou state._stats met a jour les vues
  // sans que le caller ait a penser au re-rendu.
  onStateChange("days", function () {
    if (state.currentPage === "journal") renderCalendar();
    if (state.currentPage === "today") { renderTodayCalendar(); renderTodayContextWidget(true); }
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
  orderflow: "Orderflow — COCKPIT Trading Journal",
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
  $("#newEntryBtn")?.addEventListener("click", function () { wizOpen({}); });
  $("#railNewTradeBtn")?.addEventListener("click", function () { wizOpen({ railMode: true }); });
  $("#quickAddBtn")?.addEventListener("click", function () { wizOpen({}); });
  $("#openCmdk")?.addEventListener("click", function () { openCmdk(); });
}

function goPage(pageName) {
  var targetPage = document.querySelector('.page[data-page="' + pageName + '"]');
  if (!targetPage || state.currentPage === pageName) return;
  state.currentPage = pageName;
  localStorage.setItem("lastPage", pageName);
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
    if (state.journalFocusDate) {
      var fd = parseDateKey(state.journalFocusDate);
      if (fd) {
        state.currentMonth = fd;
        state.journalCustomFrom = state.journalFocusDate;
        state.journalCustomTo = state.journalFocusDate;
        state.journalRangeMode = "custom";
        var m = monthRange(fd);
        setJournalCustomRange(state.journalFocusDate, state.journalFocusDate, { persist: true, reload: false });
      }
      state.journalFocusDate = null;
    }
    loadMonth();
    initJournalFilters();
  }
  if (pageName === "insights") {
    updateBreakdownSortUI();
    renderPerformance();
  }
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
    state.currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    state.journalViewMode = "month";
    if (state.journalRangeMode === "custom") {
      const m = monthRange(now);
      setJournalCustomRange(m.from, m.to, { persist: true, reload: false });
    }
    closeMonthPicker();
    loadMonth();
    // Feedback visuel : flash sur le controle du mois
    const wrap = document.getElementById("journalMonthInputWrap");
    if (wrap) {
      wrap.classList.remove("journal-month-flash");
      void wrap.offsetWidth;
      wrap.classList.add("journal-month-flash");
      setTimeout(function () { wrap.classList.remove("journal-month-flash"); }, 600);
    }
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

// closeMonthPicker — no-op, le popover custom a ete supprime (#49)
function closeMonthPicker() {}

// ── Journal night mode ──
function bindJournalNightToggle() {
  var btn = document.getElementById("journalNightToggle");
  if (!btn) return;
  var page = document.querySelector('.page[data-page="journal"]');
  if (!page) return;

  // Restore saved state
  var saved = localStorage.getItem("journalNightMode");
  if (saved === "true") {
    page.classList.add("journal-night");
    btn.classList.add("active");
  }

  btn.addEventListener("click", function () {
    var on = page.classList.toggle("journal-night");
    btn.classList.toggle("active", on);
    localStorage.setItem("journalNightMode", on ? "true" : "false");
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
    if (state.currentPage === "insights") renderPerformance();
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
  } catch (e) { toast(e.message || "Erreur chargement jours", "error"); }
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
    if (!skipRender) { renderKPIs(s); var board = document.querySelector('[data-widget-board="today"]'); if (board) board.removeAttribute("data-load-error"); }
  } catch (e) {
    toast(e.message || "Erreur chargement stats", "error");
    // D-09: remove skeleton so it doesn't stay frozen on API error
    var board = document.querySelector('[data-widget-board="today"]');
    if (board) { board.classList.remove("loading"); board.setAttribute("data-load-error", "stats"); }
  }
  finally { loading(false); }
}

// ---- 013_kpis.js ----
// ---------- KPIs ----------

function _kpiPeriodRange() {
  // Week mode (journalViewMode) a priorite sur journalRangeMode
  if (state.journalViewMode === "week") {
    var start = startOfWeek(state.currentMonth || new Date());
    var end = endOfWeek(state.currentMonth || new Date());
    return { from: fmtDateKey(start), to: fmtDateKey(end) };
  }
  if (state.journalRangeMode === "custom" && state.journalCustomFrom && state.journalCustomTo) {
    return { from: state.journalCustomFrom, to: state.journalCustomTo };
  }
  if (state.journalRangeMode === "quarter") {
    return quarterRange(state.currentMonth || new Date());
  }
  // month mode (defaut)
  return monthRange(state.currentMonth || new Date());
}

function getTradesForCurrentFilter() {
  var days = state.allDays || [];
  var range = _kpiPeriodRange();
  if (!range || !range.from || !range.to) return days.flatMap(function (d) { return d.trades || []; });
  return days
    .filter(function (d) { return d.date >= range.from && d.date <= range.to; })
    .flatMap(function (d) { return d.trades || []; });
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

function _getPeriodRange() {
  return _kpiPeriodRange();
}

function buildLast30PnlSeries() {
  const byDate = {};
  (state.allDays || []).forEach(day => {
    const key = day.date;
    if (!key) return;
    const pnl = (day.trades || []).reduce(function(sum, t) {
      var metrics = deriveTradeMetrics(t);
      return sum + Number(metrics.pnl || 0);
    }, 0);
    byDate[key] = (byDate[key] || 0) + pnl;
  });

  // Use current journal period instead of hardcoded last-30-days
  const range = _getPeriodRange();
  const out = [];

  if (range && range.from && range.to) {
    var p = range.from.split("-").map(Number);
    var cur = new Date(p[0], p[1] - 1, p[2]);
    var ep = range.to.split("-").map(Number);
    var end = new Date(ep[0], ep[1] - 1, ep[2]);
    var maxBars = 90;
    while (cur <= end && out.length < maxBars) {
      var key = fmtDateKey(cur);
      out.push({ date: key, pnl: Number(byDate[key] || 0) });
      cur.setDate(cur.getDate() + 1);
    }
  }

  // Fallback: last 30 days from today
  if (out.length === 0) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    for (var i = 29; i >= 0; i -= 1) {
      var d = new Date(today);
      d.setDate(today.getDate() - i);
      var key = fmtDateKey(d);
      out.push({ date: key, pnl: Number(byDate[key] || 0) });
    }
  }

  return out;
}

function renderPnlSparkline() {
  const line = $("#kpiPnlSparkLine");
  const empty = $("#kpiPnlSparkEmpty");
  const zero = $("#kpiPnlZero");
  const labels = $("#kpiPnlSparkLabels");
  if (!line || !empty) return;

  const series = buildLast30PnlSeries();
  const values = series.map(v => v.pnl);
  const hasData = values.some(v => v !== 0);

  if (!hasData) {
    line.setAttribute("points", "");
    line.setAttribute("class", "spark-line flat");
    empty.classList.remove("hidden");
    if (labels) labels.innerHTML = "";
    if (zero) zero.classList.add("hidden");
    return;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 180;
  const height = 42;
  const padX = 2;
  const padY = 5;
  const dataH = height - padY * 2;
  const stepX = (width - padX * 2) / Math.max(values.length - 1, 1);

  // Zero line position (y where v=0)
  if (zero) {
    zero.classList.remove("hidden");
    const zeroY = padY + dataH * (1 - (0 - min) / range);
    zero.setAttribute("y1", zeroY.toFixed(1));
    zero.setAttribute("y2", zeroY.toFixed(1));
  }

  const points = values.map((v, i) => {
    const x = padX + i * stepX;
    const y = padY + dataH * (1 - (v - min) / range);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  line.setAttribute("points", points);

  // Date labels (first, middle, last)
  if (labels) {
    var total = series.length;
    var first = series[0];
    var mid = series[Math.floor(total / 2)];
    var last = series[total - 1];
    function _fmtSparkDate(d) {
      if (!d) return "";
      var p = d.split("-").map(Number);
      return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    }
    labels.innerHTML =
      '<span class="spark-label">' + _fmtSparkDate(first.date) + '</span>' +
      '<span class="spark-label">' + _fmtSparkDate(mid.date) + '</span>' +
      '<span class="spark-label">' + _fmtSparkDate(last.date) + '</span>';
  }

  const total30 = values.reduce((sum, v) => sum + v, 0);
  const tone = total30 > 0 ? "pos" : total30 < 0 ? "neg" : "flat";
  line.setAttribute("class", `spark-line ${tone}`);
  empty.classList.add("hidden");

  // D-20: Tooltip au survol — nearest data point
  var wrap = document.querySelector(".kpi-spark-wrap");
  if (!wrap) return;
  var tip = document.getElementById("kpiPnlSparkTip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "kpiPnlSparkTip";
    tip.className = "spark-tooltip hidden";
    wrap.appendChild(tip);
  }
  var svg = document.getElementById("kpiPnlSpark");
  if (!svg._sparkBound) {
    svg._sparkBound = true;
    svg.addEventListener("mousemove", function(e) {
      var rect = svg.getBoundingClientRect();
      var relX = e.clientX - rect.left;
      var pctX = relX / rect.width;
      var idx = Math.round(pctX * (series.length - 1));
      idx = Math.max(0, Math.min(series.length - 1, idx));
      var pt = series[idx];
      if (!pt) return;
      tip.style.left = (relX - 30) + "px";
      var p = pt.date.split("-").map(Number);
      var d = new Date(p[0], p[1] - 1, p[2]);
      var label = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
      var val = pt.pnl;
      var sign = val >= 0 ? "+" : "";
      tip.innerHTML = label + " : " + sign + val.toFixed(2) + "€";
      tip.classList.remove("hidden");
    });
    svg.addEventListener("mouseleave", function() {
      tip.classList.add("hidden");
    });
  }
}

function renderKPIs(s) {
  s = s || {};
  const d = computeDerivedTodayKPIs(s);
  var pnlEl = $("#kpiPnl");
  if (pnlEl) {
    pnlEl.textContent = fmtMoney(d.totalPnl);
    pnlEl.className = "kpi-pnl " + (d.totalPnl >= 0 ? "pnl-pos" : "pnl-neg");
  }
  // Update period label
  var pnlSub = $("#kpiPnlSub");
  if (pnlSub) {
    var range = _kpiPeriodRange();
    if (range && range.from && range.to) {
      var p = range.from.split("-").map(Number);
      var f = new Date(p[0], p[1] - 1, p[2]);
      var pe = range.to.split("-").map(Number);
      var t = new Date(pe[0], pe[1] - 1, pe[2]);
      pnlSub.textContent = f.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
        + " - " + t.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
    }
  }
  var wrEl = $("#kpiWinrate");
  if (wrEl) {
    if (d.numTrades > 0) _animateCounter(wrEl, Math.round(s.winrate || 0), "%", { duration: 500 });
    else wrEl.textContent = "\u2014";
  }
  var winsEl = $("#kpiWins");
  if (winsEl) winsEl.textContent = d.numTrades > 0 ? `${s.wins}W` : "\u2014";
  var lossesEl = $("#kpiLosses");
  if (lossesEl) lossesEl.textContent = d.numTrades > 0 ? `${s.losses}L` : "\u2014";
  var wrBar = $("#kpiWinrateBar");
  if (wrBar) {
    wrBar.style.transform = "scaleX(" + Math.min(s.winrate || 0, 100) / 100 + ")";
    wrBar.setAttribute("role", "progressbar");
    wrBar.setAttribute("aria-valuenow", String(Math.round(s.winrate || 0)));
    wrBar.setAttribute("aria-valuemin", "0");
    wrBar.setAttribute("aria-valuemax", "100");
    wrBar.setAttribute("aria-label", Math.round(s.winrate || 0) + "% winrate");
  }

  if (d.rrCount > 0) {
    _animateCounter($("#kpiRR"), d.avgRR, "", { duration: 500, decimals: 2 });
    var rrBar = $("#kpiRRBar");
    if (rrBar) {
      rrBar.style.transform = "scaleX(" + Math.min(Math.abs(d.avgRR) || 0, 5) / 5 + ")";
      rrBar.setAttribute("role", "progressbar");
      rrBar.setAttribute("aria-valuenow", String(d.avgRR.toFixed(2)));
      rrBar.setAttribute("aria-valuemin", "0");
      rrBar.setAttribute("aria-valuemax", "5");
      rrBar.setAttribute("aria-label", d.avgRR.toFixed(2) + "R moyen");
    }
  } else {
    $("#kpiRR").textContent = "\u2014";
    rrBar = $("#kpiRRBar");
    if (rrBar) {
      rrBar.style.transform = "scaleX(0)";
      rrBar.removeAttribute("aria-valuenow");
    }
  }

  const tradesLabel = `${d.numTrades} trade${d.numTrades > 1 ? "s" : ""}`;
  var tradesEl = $("#kpiTrades");
  if (tradesEl) {
    if (d.numTrades > 0) _animateCounter(tradesEl, d.numTrades, "", { duration: 400 });
    else tradesEl.textContent = "\u2014";
  }
  var tsEl = $("#kpiTradesSub");
  if (tsEl) tsEl.textContent = d.numTrades > 0
    ? `${tradesLabel} \u00B7 ${d.expectancy != null && isFinite(d.expectancy) ? fmtMoney(d.expectancy) : "—"} moyen / trade`
    : "Aucun trade enregistre";

  let pfText = "\u2014";
  let pfTooltipText = "";
  if (d.profitFactor === Infinity) { pfText = "\u221E"; pfTooltipText = "Aucune perte enregistree"; }
  else if (Number.isFinite(d.profitFactor)) pfText = d.profitFactor.toFixed(2);
  var pfEl = $("#kpiProfitFactor");
  if (pfEl) {
    pfEl.textContent = pfText;
    pfEl.style.color = pfText === "\u221E" ? "var(--win)" : "";
  }
  var pfTip = $("#pfTooltip");
  if (pfTip) { pfTip.textContent = pfTooltipText; pfTip.setAttribute("aria-hidden", pfTooltipText ? "false" : "true"); }

  var expEl = $("#kpiExpectancy");
  if (expEl) expEl.textContent = d.expectancy == null ? "\u2014" : fmtMoney(d.expectancy);
  var expSubEl = $("#kpiExpectancySub");
  if (expSubEl) expSubEl.textContent = d.numTrades > 0
    ? `${tradesLabel} pris en compte`
    : "Moyenne par trade";
  // Streak
  var streakVal = Number(s.streak);
  var streakEl = $("#kpiStreak");
  if (streakEl) {
    if (streakVal > 0) _animateCounter(streakEl, streakVal, "", { duration: 400 });
    else streakEl.textContent = "\u2014";
  }
  var streakSub = $("#kpiStreakSub");
  if (streakSub) {
    streakSub.textContent = streakVal > 1 ? streakVal + " consecutifs" : streakVal === 1 ? "jour" : "\u2014";
  }

  renderPnlSparkline();

  // Remove skeleton loading state
  document.querySelector('[data-widget-board="today"]')?.classList.remove("loading");
}

// Animator: compte de 0 a target sur element
var _animRunning = null;
var _reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function _animateCounter(el, target, suffix, opts) {
  if (!el) return;
  if (_reduceMotion) { el.textContent = target + (suffix || ""); return; }
  suffix = suffix || "";
  opts = opts || {};
  var current = parseFloat(el.textContent) || 0;
  if (current === target || target === 0) {
    el.textContent = target + suffix;
    return;
  }
  var start = performance.now();
  var from = current;
  var decimals = opts.decimals || 0;
  var duration = opts.duration || Math.min(600, Math.max(200, Math.abs(target) * 3));
  function _tick(now) {
    var t = Math.min(1, (now - start) / duration);
    var val = (from + (target - from) * t).toFixed(decimals);
    el.textContent = Number(val) + suffix;
    if (t < 1) requestAnimationFrame(_tick);
  }
  requestAnimationFrame(_tick);
}

// ---- 014_today_page.js ----
// ---------- TODAY page ----------

function renderToday() {
  applyProfileSetting();
  renderTodayCalendar();
  renderTodayContextWidget(true);
  const today   = todayKey();
  const todayList = state.allDays.filter(d => d.date === today);
  const recent    = state.allDays.filter(d => d.date !== today).sort(function(a, b) { return a.date < b.date ? 1 : -1; }).slice(0, 2);

  var todayEl = $("#todayEntries");
  if (!todayEl) return;
  todayEl.innerHTML = "";
  if (todayList.length === 0) {
    todayEl.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <div>Aucune entrée pour aujourd'hui.</div>
      <div class="empty-cta" id="emptyTodayCta"></div></div>`;
    var cta = document.getElementById("emptyTodayCta");
    if (cta) {
      var tradeBtn = document.createElement("button");
      tradeBtn.className = "btn-primary";
      tradeBtn.textContent = "Ajouter un trade";
      tradeBtn.addEventListener("click", function () { wizOpen({}); });
      cta.appendChild(tradeBtn);
      var ctxBtn = document.createElement("button");
      ctxBtn.className = "btn-ghost";
      ctxBtn.textContent = "Creer un contexte";
      ctxBtn.style.marginLeft = "8px";
      ctxBtn.addEventListener("click", function () {
        var emptyEl = document.getElementById("todayContextEmpty");
        var form = document.getElementById("dayForm");
        if (emptyEl) emptyEl.classList.add("hidden");
        if (form) {
          form.classList.remove("hidden");
          var dateEl = document.getElementById("entryDate");
          if (dateEl && !dateEl.value) dateEl.value = todayKey();
          var instrEl = document.getElementById("entryInstrument");
          if (instrEl && !instrEl.value && typeof _lastInstrument === "function") instrEl.value = _lastInstrument();
        }
        var instr = document.getElementById("entryInstrument");
        if (instr) setTimeout(function () { instr.focus(); }, 100);
      });
      cta.appendChild(ctxBtn);
    }
  } else {
    todayList.forEach(d => todayEl.appendChild(dayCardEl(d)));
  }

  const recentEl = $("#recentEntries");
  if (recentEl) {
    recentEl.innerHTML = "";
    if (recent.length === 0) {
      recentEl.innerHTML = '<div class="empty-state"><div>Pas encore d\'historique</div><div class="empty-cta"><button type="button" class="btn-ghost" onclick="wizOpen({})">Ajouter un trade</button></div></div>';
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
  const hasDay = day !== null;

  // Empty state vs formulaire
  const emptyEl = $("#todayContextEmpty");
  if (emptyEl) emptyEl.classList.toggle("hidden", hasDay);
  form.classList.toggle("hidden", !hasDay);
  // Reset context status
  var ctxStatus = $("#contextStatus");
  if (ctxStatus) ctxStatus.textContent = hasDay ? "Sauvegardé" : "Non créé";

  if (!hasDay) return;

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
  // No-op: le select est directement stylé comme un badge entry-card
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
    <div class="entry-instr">${escapeHtml(day.instrument || "-")}</div>
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

// Créer un contexte jour depuis l'état vide
document.addEventListener("click", function (e) {
  var btn = e.target.closest("#todayContextCreateBtn");
  if (!btn) return;
  var emptyEl = document.getElementById("todayContextEmpty");
  var form = document.getElementById("dayForm");
  if (emptyEl) emptyEl.classList.add("hidden");
  if (form) {
    form.classList.remove("hidden");
    // Pre-fill date + instrument for a new context
    var dateEl = document.getElementById("entryDate");
    if (dateEl && !dateEl.value) dateEl.value = todayKey();
    var instrEl = document.getElementById("entryInstrument");
    if (instrEl && !instrEl.value && typeof _lastInstrument === "function") instrEl.value = _lastInstrument();
  }
  var instr = document.getElementById("entryInstrument");
  if (instr) setTimeout(function () { instr.focus(); }, 100);
});

// ---- 015_calendar.js ----
// ---------- Calendar ----------
let _calendarByDayCache = {};
let _calendarGridBound = false;
let _calWasAutoTable = false;
let _calPnLThresholds = null;
function bindCalendarGridActions(grid) {
  if (!grid || _calendarGridBound) return;
  grid.addEventListener("click", (e) => {
    const dayEl = e.target.closest(".day");
    if (!dayEl || !grid.contains(dayEl)) return;
    if (dayEl.dataset.otherMonth === "1") {
      // Naviguer vers le mois clique
      var otherKey = dayEl.dataset.date;
      if (otherKey) {
        var parts = otherKey.split("-");
        if (parts.length >= 2) {
          state.currentMonth = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
          loadMonth();
        }
      }
      return;
    }
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
    // Aucun trade → carte contexte avec donnees HTF + bouton Nouveau trade
    if (typeof closeJournalDayTrades === "function") closeJournalDayTrades();
    if (typeof renderJournalDayContext === "function") {
      renderJournalDayContext(key, info.days);
    } else {
      wizOpen({ date: key });
    }
    return;
  });
  grid.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const dayEl = e.target.closest(".day");
    if (!dayEl || dayEl.dataset.otherMonth === "1") return;
    e.preventDefault();
    dayEl.click();
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
  _calPnLThresholds = _computePnLBands(byDay);
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
    // Padding leading days pour aligner le premier jour sous son weekday (Lun=0..Dim=6)
    const leadIndex = (cursor.getDay() + 6) % 7;
    for (let i = leadIndex; i > 0; i -= 1) {
      fragment.appendChild(dayCell(shiftDays(cursor, -i), byDay, true, tk));
    }
    let c = cursor;
    let count = 0;
    while (c <= end) {
      fragment.appendChild(dayCell(c, byDay, false, tk));
      c = shiftDays(c, 1);
      count += 1;
    }
    // Padding trailing pour completer la derniere semaine
    const trailing = (7 - ((leadIndex + count) % 7)) % 7;
    for (let i = 0; i < trailing; i += 1) {
      fragment.appendChild(dayCell(shiftDays(c, i), byDay, true, tk));
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
  // Empty state — seulement si filtres ont tout vide, sinon calendrier reste visible
  var totalTrades = 0;
  Object.keys(byDay).forEach(function (k) { totalTrades += Number(byDay[k].trades || 0); });
  var hasFilters = hasActiveJournalTradeFilters();
  var isEmpty = totalTrades === 0;
  // Cacher la grille seulement si filtres actifs ET aucun resultat
  var hideGrid = isEmpty && hasFilters;
  var wrap = document.getElementById("journalCalendarWrap");
  if (wrap) wrap.classList.toggle("cal-empty", hideGrid);
  var emptyEl = document.getElementById("calendarEmptyState");
  if (hideGrid) {
    if (!emptyEl) {
      emptyEl = document.createElement("div");
      emptyEl.id = "calendarEmptyState";
      emptyEl.className = "calendar-empty-state";
    }
    // Message incluant le terme recherche si actif
    var searchQ = (state.journalTradeFilters?.search || "").trim();
    var msg = searchQ
      ? 'Aucun resultat pour "' + escapeHtml(searchQ) + '".'
      : "Aucun trade ne correspond aux filtres actifs.";
    var resetBtn = searchQ
      ? '<div class="empty-cta"><button type="button" class="btn-ghost" onclick="clearJournalSearch()">Effacer la recherche</button></div>'
      : '<div class="empty-cta"><button type="button" class="btn-ghost" onclick="resetJournalFilters()">Réinitialiser les filtres</button></div>';
    emptyEl.innerHTML =
      '<div class="empty-state">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="17" rx="2"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
        "<span>" + msg + "</span>" +
        resetBtn +
      "</div>";
    emptyEl.classList.remove("hidden");
  } else if (emptyEl) {
    emptyEl.classList.add("hidden");
  }
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
/* ---- PnL intensity bands (4 levels based on quartiles) ---- */
function _computePnLBands(byDay) {
  const wins = [];
  const losses = [];
  Object.values(byDay).forEach(function(info) {
    if (info && info.pnl > 0) wins.push(info.pnl);
    else if (info && info.pnl < 0) losses.push(Math.abs(info.pnl));
  });
  wins.sort(function(a, b) { return a - b; });
  losses.sort(function(a, b) { return a - b; });
  function quartile(arr, q) {
    if (arr.length === 0) return null;
    const pos = (arr.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return arr[lo] + (arr[hi] - arr[lo]) * (pos - lo);
  }
  return {
    winBands: wins.length > 3 ? [quartile(wins, 0.25), quartile(wins, 0.5), quartile(wins, 0.75)] : null,
    lossBands: losses.length > 3 ? [quartile(losses, 0.25), quartile(losses, 0.5), quartile(losses, 0.75)] : null,
  };
}
function _pnlBand(pnl, thresholds) {
  if (!thresholds || pnl == null || pnl === 0) return "";
  if (pnl > 0) {
    if (!thresholds.winBands) return "win";
    if (pnl <= thresholds.winBands[0]) return "win-1";
    if (pnl <= thresholds.winBands[1]) return "win-2";
    if (pnl <= thresholds.winBands[2]) return "win-3";
    return "win-4";
  }
  var absPnl = Math.abs(pnl);
  if (!thresholds.lossBands) return "loss";
  if (absPnl <= thresholds.lossBands[0]) return "loss-1";
  if (absPnl <= thresholds.lossBands[1]) return "loss-2";
  if (absPnl <= thresholds.lossBands[2]) return "loss-3";
  return "loss-4";
}
function dayCell(dt, byDay, otherMonth, today) {
  const key  = fmtDateKey(dt);
  const info = byDay[key];
  const mode = state.calendarMetricMode || "pnl";
  const el   = document.createElement("div");
  el.dataset.date = key;
  el.dataset.otherMonth = otherMonth ? "1" : "0";
  el.className = "day" + (otherMonth ? " other-month" : "") + (key === today ? " today" : "");
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", otherMonth ? "-1" : "0");
  el.classList.add(`day-mode-${mode}`);
  const band = _pnlBand(info?.pnl, _calPnLThresholds);
  if (band) el.classList.add(band);
  let metricHtml = `<div class="day-center day-center-empty"></div>`;
  if (info && info.trades > 0) {
    const pnlClass = info.pnl > 0 ? "pos" : info.pnl < 0 ? "neg" : "flat";
    if (mode === "pnl") {
      metricHtml = `
        <div class="day-center mode-pnl">
          <div class="day-metric day-metric-pnl ${pnlClass}">${fmtMoney(info.pnl)}</div>
        </div>`;
    } else if (mode === "trades") {
      metricHtml = `
        <div class="day-center mode-trades">
          <div class="day-metric day-metric-trades">${info.trades}<span class="day-metric-suffix">T</span></div>
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
// ---- Afficher le contexte d'un jour sans trade (carte HTF + bouton trade) ----
function renderJournalDayContext(dateKey, days) {
  var wrap = $("#journalDayTrades");
  if (!wrap) return;
  bindJournalDayTrades();
  var day = days && days[0];
  if (!day) { closeJournalDayTrades(); return; }
  wrap.classList.remove("hidden");
  wrap.dataset.count = "0";
  // Creer un trade virtuel avec les donnees HTF pour reutiliser journalTradeFlipCardHtml
  var notes = day.daily_notes || day.htf_context || "";
  var biasLabel = day.htf_bias || "neutral";
  var virtualTrade = {
    id: "context_" + dateKey,
    day_id: day.id,
    day_instrument: day.instrument || "-",
    day_date: day.date || dateKey,
    strategy: "Contexte du jour",
    direction: biasLabel,
    pnl: 0,
    rr: null,
    is_win: null,
    why_trade: notes,
    scenario: notes,
    why_entry: "",
    lessons_learned: "",
    screenshots: [],
    tags: ["ctx_card"],
    session: "",
    execution_quality: 0,
  };
  var virtualDay = {
    id: day.id,
    instrument: day.instrument || "-",
    date: day.date || dateKey,
    htf_bias: day.htf_bias,
    htf_context: day.htf_context,
    daily_notes: day.daily_notes,
  };
  if (typeof journalTradeFlipCardHtml === "function") {
    wrap.innerHTML = '<div class="journal-day-context-empty">' +
      journalTradeFlipCardHtml(virtualDay, virtualTrade, 1, [virtualTrade]) +
      '</div>';
    // Remplacer le bouton "Editer" par "Creer un trade"
    var editBtn = wrap.querySelector('[data-journal-trade-edit]');
    if (editBtn) {
      editBtn.textContent = '+ Créer un trade';
      editBtn.className = editBtn.className.replace('journal-back-edit', '') + ' btn-primary';
      editBtn.style.flex = '1';
      editBtn.removeAttribute('data-journal-trade-edit');
      editBtn.id = 'journalDayContextAddTrade';
      editBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        wizOpen({
          date: dateKey,
          contextCard: true,
          instrument: day.instrument,
          htf_context: notes,
          htf_bias: biasLabel,
          daily_notes: day.daily_notes || '',
        });
      });
    }
    // Masquer le bouton "Voir dans le journal"
    var journalBtn = wrap.querySelector('[data-fav-journal]');
    if (journalBtn) journalBtn.style.display = 'none';
    // Injecter le contexte HTF dans la zone summary de la card
    var summaryEl = wrap.querySelector('.journal-trade-main p');
    if (summaryEl && notes) {
      summaryEl.textContent = notes;
    }
  } else {
    // Fallback : wizard direct
    wizOpen({ date: dateKey });
  }
}

// Global helpers for empty-state CTAs (inline onclick handlers)
function clearJournalSearch() {
  var f = JSON.parse(JSON.stringify(state.journalTradeFilters || {}));
  delete f.search;
  state.journalTradeFilters = f;
  if (typeof saveJournalTradeFilters === "function") saveJournalTradeFilters(f);
  if (typeof renderCalendar === "function") renderCalendar();
}
function resetJournalFilters() {
  state.journalTradeFilters = {};
  if (typeof saveJournalTradeFilters === "function") saveJournalTradeFilters({});
  if (typeof renderCalendar === "function") renderCalendar();
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

// ---- 017_open_existing_day.js ----
// ---------- openExistingDay : navigation vers le journal pour un jour donne ----------
// Remplace l'ancienne version qui ouvrait entryModal (supprimee)
function openExistingDay(day) {
  if (!day || !day.date) return;
  state.journalFocusDate = day.date;
  state.currentDayId = day.id;

  // Mettre a jour le contexte du jour dans le widget Today si visible
  var dayForm = $("#dayForm");
  if (dayForm) {
    $("#dayId").value = day.id || "";
    $("#entryDate").value = day.date || "";
    $("#entryInstrument").value = day.instrument || "";
    $("#htfContext").value = day.htf_context ?? "";
    $("#dailyNotes").value = day.daily_notes ?? "";
    if (typeof setPill === "function") setPill("htf_bias", day.htf_bias);
  }

  // Naviguer vers la page journal
  if (typeof goPage === "function") {
    goPage("journal");
  }

  // Forcer le focus sur le jour dans le calendrier journal
  if (typeof loadMonth === "function") {
    if (state.currentPage !== "journal") {
      state.currentMonth = parseDateKey(day.date) || state.currentMonth;
    }
    loadMonth();
  }

  // Afficher les trades du jour si le calendrier est pret
  if (day.trades && day.trades.length && typeof renderJournalDayTrades === "function") {
    setTimeout(function () {
      renderJournalDayTrades(day.date, [day]);
    }, 200);
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
      // Patcher aussi state.allDays (utilise par findTodayContextDay)
      if (state.allDays) {
        for (var _ai = 0; _ai < state.allDays.length; _ai++) {
          if (state.allDays[_ai].id === (saved && saved.id != null ? saved.id : activeId)) {
            Object.assign(state.allDays[_ai], saved || payload);
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
    var ctxStatus = document.getElementById("contextStatus");
    if (ctxStatus) ctxStatus.textContent = "Journée supprimée ✓";
    // Recharger les donnees apres suppression
    if (typeof loadMonth === "function") loadMonth();
    if (typeof loadAll === "function") loadAll();
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

// ---- 021_rr_preview.js ----
// ---------- RR preview ----------

function bindRRPreview() {
  ["entryPrice","stopLoss","takeProfit","exitPrice","positionSize"].forEach(id =>
    document.getElementById(id)?.addEventListener("input", updateRRPreview)
  );
  $("#tradeStatus")?.addEventListener("change", function() {
    syncTradeStatus();
    updateRRPreview();
  });
  $("#takeProfit")?.addEventListener("input", autoFillExitFromTarget);
  $("#exitPrice")?.addEventListener("input", () => {
    const exit = $("#exitPrice");
    if (exit) exit.dataset.autoSource = "manual";
    updateRRPreview();
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

function syncTradeStatus() {
  var status = $("#tradeStatus")?.value;
  var exit = $("#exitPrice");
  var isWinField = $("#isWin");
  if (!status || !exit) return;
  if (status === "open") {
    // Trade ouvert → pas de prix de sortie, PnL inconnu
    exit.value = "";
    exit.disabled = true;
    exit.dataset.autoSource = "";
    if (isWinField) isWinField.value = "";
  } else {
    // Trade clos → prix de sortie actif
    exit.disabled = false;
    // Re-essayer auto-fill depuis TP si exit vide
    if (!exit.value) autoFillExitFromTarget();
  }
  updateRRPreview();
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
  var tradeStatus = $("#tradeStatus")?.value || "closed";

  let rrValue = null;
  if (entry != null && stop != null && target != null && stop !== entry) {
    rrValue = Math.abs(target - entry) / Math.abs(entry - stop);
  }
  if (rrField) rrField.value = rrValue != null ? rrValue.toFixed(2) : "";

  let pnlValue = null;
  if (tradeStatus === "closed" && direction && entry != null && exit != null) {
    pnlValue = (direction === "long" ? (exit - entry) : (entry - exit)) * qty;
    if (pnlField) pnlField.value = pnlValue.toFixed(2);
    // Deriver is_win depuis le PnL (champ hidden)
    if (isWinField) {
      isWinField.value = pnlValue > 0 ? "1" : pnlValue < 0 ? "0" : "";
    }
  } else if (tradeStatus === "open") {
    // Trade ouvert: PnL = 0, pas de win/loss
    if (pnlField) pnlField.value = "0";
    if (isWinField) isWinField.value = "";
  }

  if (entry != null && stop != null && target != null && stop !== entry) {
    const riskPerContract = Math.abs(entry - stop);
    const rewardPerContract = Math.abs(target - entry);
    const gainEstimate = rewardPerContract * qty;
    const lossEstimate = riskPerContract * qty;
    const dirLabel = direction === "short" ? "Short" : "Long";

    if (tradeStatus === "open") {
      prev.textContent = dirLabel + " - RR theorique: " + rrValue.toFixed(2) + "R - Estimation (" + qty + " contrat" + (qty > 1 ? "s" : "") + "): +" + gainEstimate.toFixed(2) + " / -" + lossEstimate.toFixed(2) + " (trade ouvert)";
      prev.className = "rr-preview visible";
    } else {
      // SL = TP → warning
      var slEqualsTp = stop === target || Math.abs(stop - target) < 0.01;
      if (slEqualsTp) {
        prev.textContent = dirLabel + " - SL = TP: impossible de calculer un RR theorique pertinent.";
        prev.className = "rr-preview visible warn";
      } else {
        prev.textContent = dirLabel + " - RR theorique: " + rrValue.toFixed(2) + "R - Estimation (" + qty + " contrat" + (qty > 1 ? "s" : "") + "): +" + gainEstimate.toFixed(2) + " / -" + lossEstimate.toFixed(2);
        prev.className = "rr-preview visible";
      }
    }
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

  const tradeFormSection = $("#tradeFormSection");
  const tradeFormOpen = tradeFormSection && !tradeFormSection.classList.contains("hidden");
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
    if (typeof renderTradesList === "function") renderTradesList(day.trades || []);
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
  // Sync context status
  var ctxStatus = document.getElementById("contextStatus");
  if (ctxStatus) {
    var hasDay = !!document.getElementById("dayId")?.value;
    if (s === "saved") ctxStatus.textContent = "Sauvegardé à " + _nowHHMM();
    else if (s === "saving") ctxStatus.textContent = "Sauvegarde…";
    else if (s === "dirty") ctxStatus.textContent = hasDay ? "Brouillon local" : "Brouillon";
    else if (s === "error") ctxStatus.textContent = "Erreur";
    else ctxStatus.textContent = hasDay ? "Sauvegardé" : "Non créé";
  }
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
  // Sauvegarde à la sortie d'un champ (focusout) avec debounce
  var _autosaveTimer = null;
  $("#dayForm")?.addEventListener("focusout", function () {
    clearTimeout(_autosaveTimer);
    _autosaveTimer = setTimeout(triggerDayAutosave, 200);
  });
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
    if (meta && e.key.toLowerCase() === "n") { e.preventDefault(); wizOpen({}); return; }

    if (e.key === "Escape") {
      if (state.cmdkOpen) { closeCmdk(); return; }

      if (!$("#lightbox").classList.contains("hidden")) { $("#lightbox").classList.add("hidden"); return; }
    }

    if (inField) return;
    if (!meta && !e.altKey) {
      if (e.key === "t" || e.key === "T") { e.preventDefault(); goPage("today"); }
      if (e.key === "j" || e.key === "J") { e.preventDefault(); goPage("journal"); }
      
      if (e.key === "g" || e.key === "G") { e.preventDefault(); goPage("settings"); }
      if (e.key === "c" || e.key === "C") { e.preventDefault(); goPage("chart"); }
      if (e.key === "o" || e.key === "O") { e.preventDefault(); goPage("orderflow"); }
      if (e.key === "/") {
        e.preventDefault();
        var search = document.getElementById("journalFilterSearch");
        if (search) { search.focus(); search.select(); }
      }
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        var details = document.querySelector(".journal-advanced-filters");
        if (details) details.open = !details.open;
      }
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
    { kind:"action", label:"Nouveau trade (aujourd'hui)", icon:"plus", run:()=>{ closeCmdk(); wizOpen({}); }},
    { kind:"action", label:"Aller a Today",                 icon:"home", run:()=>{ closeCmdk(); goPage("today"); }},
    { kind:"action", label:"Journal (calendrier)",          icon:"cal",  run:()=>{ closeCmdk(); goPage("journal"); }},
    { kind:"action", label:"Journal en vue semaine",        icon:"cal",  run:()=>{ closeCmdk(); goPage("journal"); setJournalViewMode("week", { persist:true, reload:true }); }},
    { kind:"action", label:"Journal en vue mois",           icon:"cal",  run:()=>{ closeCmdk(); goPage("journal"); setJournalViewMode("month", { persist:true, reload:true }); }},
    
    { kind:"action", label:"Orderflow Terminal",            icon:"flow", run:()=>{ closeCmdk(); goPage("orderflow"); }},
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

  var streakCur  = $("#statStreakCur");
  var streakBest = $("#statStreakBest");
  if (streakCur)  streakCur.textContent  = s.streak || 0;
  if (streakBest) streakBest.textContent = s.best_streak || 0;

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
  var panel = c.closest(".panel");
  if (panel) {
    var existing = panel.querySelector(".bd-sort-badge");
    if (!existing) {
      var h3 = panel.querySelector(".panel-h h3");
      if (h3) {
        var badge = document.createElement("span");
        badge.className = "bd-sort-badge";
        badge.title = "Cliquer pour changer le tri (selecteur en haut de page)";
        h3.after(badge);
      }
    }
  }
  var entries = Object.entries(data || {});
  if (!entries.length) {
    c.innerHTML = `<div class="bd-empty">Pas encore de donnees.</div>`;
    return;
  }
  var sortMode = state.breakdownSortMode || "count";
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
    : opts.kind === "setup"
    ? k => (k && k !== "null" && k !== "undefined" ? prettify(k) : "Sans stratégie")
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
  var panel = c.closest(".panel");
  var badge = panel && panel.querySelector(".bd-sort-badge");
  if (badge) {
    var labels = { count: "Nb trades", winrate: "Winrate", avg_rr: "RR moyen", pnl: "PnL" };
    badge.textContent = "\u2191 " + (labels[sortMode] || sortMode);
  }
}

function renderPlanMatrix(matrix, summary) {
  const c = $("#planMatrix");
  if (!c) return;
  matrix = matrix || {};
  summary = summary || {};
  const order = ["in_plan_win", "in_plan_loss", "out_of_plan_win", "out_of_plan_loss", "incomplete", "unknown"];
  const total = order.reduce((sum, key) => sum + Number(matrix[key]?.count || 0), 0);
  if (!total) {
    c.innerHTML = `<div class="bd-empty">Aucun trade avec plan pour la periode selectionnee.</div>`;
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
  // Titre
  var title = document.createElement("div");
  title.className = "rr-dist-title";
  title.textContent = "Distribution R:R";
  c.appendChild(title);

  // Y-axis label + bars container
  var chartWrap = document.createElement("div");
  chartWrap.className = "rr-chart-wrap";

  var yLabel = document.createElement("div");
  yLabel.className = "rr-y-label";
  yLabel.textContent = "Trades";
  chartWrap.appendChild(yLabel);

  var barsContainer = document.createElement("div");
  barsContainer.className = "rr-bars";

  const labels = ["<0","0-1","1-2","2-3","3-5","5+"];
  const zones  = ["loss","meh","meh","ok","great","great"];
  const max    = Math.max(1, ...buckets);

  labels.forEach((label, i) => {
    const count = buckets[i] || 0;
    const el = document.createElement("div");
    el.className = "rr-bucket";
    el.innerHTML = `
      <div class="rr-bar-wrap">
        <div class="rr-bar" data-zone="${zones[i]}" style="transform:scaleY(0)">
          ${count > 0 ? `<span class="rr-bar-count">${count}</span>` : ""}
        </div>
      </div>
      <span class="rr-bucket-label">${label}</span>`;
    barsContainer.appendChild(el);
    requestAnimationFrame(() => {
      el.querySelector(".rr-bar").style.transform = `scaleY(${(count/max)})`;
    });
  });

  chartWrap.appendChild(barsContainer);
  c.appendChild(chartWrap);

  // X-axis label
  var xLabel = document.createElement("div");
  xLabel.className = "rr-x-label";
  xLabel.textContent = "Ratio R:R";
  c.appendChild(xLabel);
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

  curPnl.textContent = cur.pnl != null ? fmtMoney(cur.pnl) : "\u2014";
  prevPnl.textContent = prev.pnl != null ? fmtMoney(prev.pnl) : "\u2014";

  // Delta avec fleche et couleur
  var deltaVal = Number(delta.pnl || 0);
  var deltaArrow = $("#periodDeltaArrow");
  if (delta.pnl != null && deltaArrow) {
    deltaArrow.textContent = deltaVal > 0 ? "\u25B2" : deltaVal < 0 ? "\u25BC" : "\u2014";
    deltaArrow.className = "period-delta-arrow " + (deltaVal > 0 ? "pos" : deltaVal < 0 ? "neg" : "");
  }
  deltaPnl.textContent = delta.pnl != null ? fmtMoney(delta.pnl) : "\u2014";

  setSignedClass(curPnl, Number(cur.pnl || 0));
  setSignedClass(prevPnl, Number(prev.pnl || 0));
  setSignedClass(deltaPnl, Number(delta.pnl || 0));

  curMeta.textContent = `${Number(cur.num_trades || 0)} trade${Number(cur.num_trades || 0) > 1 ? "s" : ""} - ${(Number(cur.winrate || 0)).toFixed(0)}%`;
  prevMeta.textContent = `${Number(prev.num_trades || 0)} trade${Number(prev.num_trades || 0) > 1 ? "s" : ""} - ${(Number(prev.winrate || 0)).toFixed(0)}%`;

  // Delta meta: pourcentage, fleche, trades, winrate
  var pnlPct = "";
  if (cur.pnl != null && prev.pnl != null && Number(prev.pnl) !== 0) {
    var pct = ((Number(cur.pnl) - Number(prev.pnl)) / Math.abs(Number(prev.pnl))) * 100;
    pnlPct = (pct > 0 ? "+" : "") + pct.toFixed(1) + "%";
  }
  const tradesDelta = Number(delta.num_trades || 0);
  const wrDelta = Number(delta.winrate || 0);
  const wrPrefix = wrDelta > 0 ? "+" : "";
  deltaMeta.textContent = (pnlPct ? pnlPct + " - " : "") + (tradesDelta > 0 ? "+" : "") + tradesDelta + " trade" + (Math.abs(tradesDelta) > 1 ? "s" : "") + " - " + wrPrefix + wrDelta.toFixed(1) + " pts";
  setSignedClass(deltaMeta, deltaVal);
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
      ctx.fillText(fmtMoney(v), pad.l - 8, y + 3);
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

  // Champs du trade (appliqués automatiquement)
  {
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
var STEPS_TRADE = ['date','instrument','session','strategy','direction','why_trade','why_entry','why_stop_tp','levels','result','screenshots','recap'];
var STEPS_PM = ['pm_exit','pm_quality','pm_lessons'];

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
  console.log('[WIZARD] wizOpen() called');
  // Ne pas reprendre de brouillon — on part de zéro à chaque ouverture
  _wizClearDraft();
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
      htf_bias:     opts.htf_bias    || '',
      htf_context:  opts.htf_context || '',
      daily_notes:  opts.daily_notes || '',
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

  // Auto-resume du draft si la date correspond
  if (wizState.hasDraft && draft && draft.data && draft.data.date === wizState.data.date) {
    wizState.data     = Object.assign(wizState.data, draft.data);
    wizState.stepIdx  = draft.stepIdx || 0;
    wizState.hasDraft = false;
  }

  _wizRender();
  const el = document.getElementById('wiz');
  if (el) {
    el.classList.remove('hidden');
    el.classList.toggle('wiz-rail-mode', !!opts.railMode);
    document.body.style.overflow = 'hidden';

    // Diagnostic DOM — vérifier que les éléments cliquables existent
    console.log('[WIZ] wizOpen DOM check:');
    console.log('  #wizCloseBtn:', !!document.getElementById('wizCloseBtn'));
    console.log('  #wizBackBtn:', !!document.getElementById('wizBackBtn'));
    console.log('  #wizNextBtn:', !!document.getElementById('wizNextBtn'));
    console.log('  #wizSkipBtn:', !!document.getElementById('wizSkipBtn'));
    console.log('  #wizBody:', !!document.getElementById('wizBody'));
    console.log('  .wiz-cards:', !!document.querySelector('.wiz-cards'));
    console.log('  .wiz-dir-btn:', !!document.querySelector('.wiz-dir-btn'));
    console.log('  .wiz-panel:', !!document.querySelector('.wiz-panel'));
    console.log('  el === wiz:', el === document.getElementById('wiz'));
    console.log('  railMode:', !!opts.railMode, 'hidden class:', el.classList.contains('hidden'));

    if (opts.railMode) {
      var btn = document.getElementById('railNewTradeBtn');
      if (btn) {
        var rect = btn.getBoundingClientRect();
        el.style.paddingTop = Math.max(8, rect.top - 8) + 'px';
        el.style.paddingLeft = (rect.right + 12) + 'px';
        btn.classList.add('wiz-active');
      }
      // Click outside panel = close
      el.onclick = function (e) { if (e.target === el) wizClose(); };
    } else if (opts.contextCard) {
      // Ouvrir la wizard pres de la carte contexte (journalDayTrades)
      var card = document.getElementById('journalDayTrades');
      if (card) {
        var rect = card.getBoundingClientRect();
        el.style.paddingTop = Math.max(8, rect.top - 8) + 'px';
        el.style.paddingLeft = (rect.left + 8) + 'px';
        el.style.paddingRight = (window.innerWidth - rect.right + 8) + 'px';
      }
      el.classList.add('wiz-context-card');
      el.onclick = function (e) { if (e.target === el) wizClose(); };
    } else {
      el.style.paddingTop = '';
      el.style.paddingLeft = '';
      el.style.paddingRight = '';
      el.classList.remove('wiz-context-card');
      el.onclick = null;
      // Clean up rail button highlight if any
      var oldBtn = document.getElementById('railNewTradeBtn');
      if (oldBtn) oldBtn.classList.remove('wiz-active');
    }
  }
}

var _wizTimer = null;

function wizClose() {
  console.log('[WIZ] wizClose()');
  // Annuler tout setTimeout en attente (wizSelectInstrument/wizSelectSession)
  if (_wizTimer) { clearTimeout(_wizTimer); _wizTimer = null; }
  // Sauvegarder le draft avant de fermer
  if (wizState && wizState.mode !== 'postmortem') {
    _wizSaveDraft();
  }
  const el = document.getElementById('wiz');
  if (el) {
    el.classList.add('hidden');
    el.classList.remove('wiz-context-card');
    el.classList.remove('wiz-rail-mode');
    el.style.paddingTop = '';
    el.style.paddingLeft = '';
    el.style.paddingRight = '';
    el.onclick = null;
  }
  document.body.style.overflow = '';
  wizState = null;
  // Clean up rail button highlight
  var btn = document.getElementById('railNewTradeBtn');
  if (btn) btn.classList.remove('wiz-active');
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
  console.log('[WIZ] wizNext() step=' + (wizState ? wizState.steps[wizState.stepIdx] : '?') + ' idx=' + (wizState ? wizState.stepIdx : '?'));
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
  console.log('[WIZ] wizBack()');
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
    case 'direction':
      d.direction = _wizActiveDir() || d.direction;
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
      d.entry_price  = _q('#wizEntry')?.value        || d.entry_price;
      d.stop_loss    = _q('#wizStop')?.value         || d.stop_loss;
      d.take_profit  = _q('#wizTarget')?.value       || d.take_profit;
      d.stdv_level   = _q('#wizStdv')?.value         || d.stdv_level;
      break;
    case 'result':
      d.exit_price  = _q('#wizExitPrice')?.value     || d.exit_price;
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
  if (!wizState) { console.log('[WIZ] _wizRender: no wizState'); return; }
  const step  = wizState.steps[wizState.stepIdx];
  const total = wizState.steps.length;
  const idx   = wizState.stepIdx;
  console.log('[WIZ] _wizRender step=' + step + ' (' + (idx+1) + '/' + total + ')');

  // Progress bar
  const fill = document.getElementById('wizProgressFill');
  if (fill) fill.style.transform = 'scaleX(' + (((idx + 1) / total)) + ')';

  // Step indicator
  const indicator = document.getElementById('wizStepIndicator');
  if (indicator) indicator.textContent = (idx + 1) + ' / ' + total;

  // Step title
  var stepTitle = document.getElementById('wizStepTitle');
  var titles = {
    date: 'Date', instrument: 'Instrument', strategy: 'Strategie',
    direction: 'Direction', why_trade: 'Pourquoi ce trade',
    why_entry: "Pourquoi l'entree", why_stop_tp: 'Stop & TP',
    levels: 'Niveaux', result: 'Resultat',
    screenshots: 'Captures', recap: 'Recap',
    pm_exit: 'Sortie', pm_quality: 'Execution', pm_lessons: 'Lecons',
  };
  if (stepTitle) stepTitle.textContent = titles[step] || step;

  // Back button
  const backBtn = document.getElementById('wizBackBtn');
  if (backBtn) backBtn.classList.toggle('invisible', idx === 0);

  // Body
  const body = document.getElementById('wizBody');
  if (body) {
    var stepHtml = _wizStepHtml(step);
    console.log('[WIZ] body.innerHTML, length=' + stepHtml.length + ', first 80chars=' + stepHtml.slice(0,80));
    body.innerHTML = stepHtml;
  } else {
    console.log('[WIZ] ERROR: #wizBody not found');
  }

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
    case 'session':     return _wizStepSession();
    case 'strategy':    return _wizStepStrategy();
    case 'direction':   return _wizStepDirection();
    case 'why_trade':   return _wizStepWhyTrade();
    case 'why_entry':   return _wizStepWhyEntry();
    case 'why_stop_tp': return _wizStepWhyStopTp();
    case 'levels':      return _wizStepLevels();
    case 'result':      return _wizStepResult();
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
  console.log('[WIZ] wizSelectInstrument(' + id + ')');
  if (!wizState) { console.log('[WIZ] wizSelectInstrument: no wizState'); return; }
  wizState.data.instrument = wizCanonicalInstrument(id);
  _wizRender();
  if (_wizTimer) clearTimeout(_wizTimer);
  _wizTimer = setTimeout(wizNext, 200);
}

// ── Session ──

function _wizStepSession() {
  var d = wizState.data;
  var sessions = [
    { id:'asia',    icon:'&#x1F305;', main:'Asia' },
    { id:'london',  icon:'&#x1F1EC;&#x1F1E7;', main:'London' },
    { id:'ny_am',   icon:'&#x1F5FD;', main:'NY AM' },
    { id:'ny_pm',   icon:'&#x1F303;', main:'NY PM' },
  ];
  var html = '<div class="wiz-question">Dans quelle session ?</div><div class="wiz-cards">';
  sessions.forEach(function(s) {
    html += '<div class="wiz-card' + (d.session===s.id?' active':'') + '" onclick="wizSelectSession(\'' + s.id + '\')">'
      + '<div class="wiz-card-icon">' + s.icon + '</div>'
      + '<div class="wiz-card-main">' + s.main + '</div>'
      
      + '</div>';
  });
  return html + '</div>';
}

function wizSelectSession(id) {
  console.log('[WIZ] wizSelectSession(' + id + ')');
  if (!wizState) { console.log('[WIZ] wizSelectSession: no wizState'); return; }
  wizState.data.session = id;
  _wizRender();
  if (_wizTimer) clearTimeout(_wizTimer);
  _wizTimer = setTimeout(wizNext, 200);
}

// ── Strategy ──

function _wizStepStrategy() {
  var d = wizState.data;
  var defaults = [
    { id:'midnight_model', icon:'&#x1F319;', main:'Midnight Model' },
    { id:'london_model',   icon:'&#x1F1EC;&#x1F1E7;', main:'London Model' },
    { id:'ny_model',       icon:'&#x1F5FD;', main:'NY Model' },
  ];
  var custom = (state?.settings?.custom_strategies || []).map(function(s) {
    return {
      id: String(s.value || '').trim(),
      icon: '&#x2728;',
      main: escapeHtml(String(s.label || s.value || '').trim() || prettify(s.value)),

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
  if (_wizTimer) clearTimeout(_wizTimer);
  _wizTimer = setTimeout(wizNext, 200);
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
    
    + '<textarea class="wiz-textarea lg" id="wizWhyTrade" placeholder="Alignement avec le plan, setup identifie...">' + (d.why_trade||'') + '</textarea>';
}

// ── Why Entry ──

function _wizStepWhyEntry() {
  var d = wizState.data;
  return _wizChip()
    + '<div class="wiz-question">Pourquoi cette entree ?</div>'
    
    + '<textarea class="wiz-textarea lg" id="wizWhyEntry" placeholder="Signal declencheur, confirmation, timing...">' + (d.why_entry||'') + '</textarea>';
}

// ── Why Stop + TP (combined) ──

function _wizStepWhyStopTp() {
  var d = wizState.data;
  return _wizChip()
    + '<div class="wiz-question">Stop &amp; objectif</div>'
    
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
  ask('direction', 'Sens du trade (long/short) ?', 'direction');
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
    ['Session',    d.session      || '—', idxOf('session', 2)],
    ['Strategie',  labels[d.strategy] || d.strategy || '—', idxOf('strategy', 3)],
    ['Direction',  d.direction    || '—', idxOf('direction', 3)],
    ['Entree',     d.entry_price  || '—', idxOf('levels', 7)],
    ['Stop',       d.stop_loss    || '—', idxOf('levels', 7)],
    ['TP',         d.take_profit  || '—', idxOf('levels', 7)],
    ['Sortie',     d.exit_price   || '—', idxOf('result', 8)],
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
  if (step === 'direction') {
    var dirBtns = document.querySelectorAll('.wiz-dir-btn');
    if (dirBtns.length) setTimeout(function() { dirBtns[0].focus(); }, 50);
  }
  if (step === 'result') {
    var exitInput = document.getElementById('wizExitPrice');
    if (exitInput) setTimeout(function() { exitInput.focus(); }, 50);
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

// ─── Direction step ─────────────────────────────────────────

function _wizStepDirection() {
  var d = wizState.data;
  var isLong  = d.direction === 'long';
  var isShort = d.direction === 'short';
  return '<div class="wiz-question">Direction</div>'
    
    + '<div class="wiz-direction-toggle">'
    +   '<button class="wiz-dir-btn' + (isLong?' active-long':'') + '" data-dir="long" onclick="wizSetDir(this)">'
    +     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>Long</button>'
    +   '<button class="wiz-dir-btn' + (isShort?' active-short':'') + '" data-dir="short" onclick="wizSetDir(this)">'
    +     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>Short</button>'
    + '</div>';
}

// ─── Result step ────────────────────────────────────────────

function _wizStepResult() {
  var d = wizState.data;
  var dir = d.direction || 'long';
  var pnl = '';
  if (d.entry_price && d.exit_price) {
    var pnlVal = dir === 'long' ? (Number(d.exit_price) - Number(d.entry_price)) : (Number(d.entry_price) - Number(d.exit_price));
    pnl = '<div class="wiz-rr-preview" style="color:' + (pnlVal >= 0 ? 'var(--win)' : 'var(--rose)') + '">PnL: ' + pnlVal.toFixed(2) + '$</div>';
  }
  return '<div class="wiz-question">Resultat</div>'
    + '<div class="wiz-hint">Prix de sortie et PnL calcule automatiquement.</div>'
    + '<div class="wiz-field">'
    +   '<label class="wiz-label">Prix de sortie</label>'
    +   '<input type="number" class="wiz-level-input" id="wizExitPrice" value="' + (d.exit_price||'') + '" placeholder="0.00" step="0.25" oninput="wizUpdateResult()">'
    + '</div>'
    + '<div id="wizResultPreview">' + pnl + '</div>';
}

function wizUpdateResult() {
  var exit = document.getElementById('wizExitPrice')?.value;
  if (!wizState) return;
  wizState.data.exit_price = exit;
  var dir = wizState.data.direction || 'long';
  var entry = wizState.data.entry_price;
  var preview = document.getElementById('wizResultPreview');
  if (!preview) return;
  if (entry && exit) {
    var pnlVal = dir === 'long' ? (Number(exit) - Number(entry)) : (Number(entry) - Number(exit));
    preview.innerHTML = '<div class="wiz-rr-preview" style="color:' + (pnlVal >= 0 ? 'var(--win)' : 'var(--rose)') + '">PnL: ' + pnlVal.toFixed(2) + '$</div>';
  } else {
    preview.innerHTML = '';
  }
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
  console.log('[WIZARD] bindWizard() called');
  var wiz = document.getElementById('wiz');
  if (!wiz) { console.log('[WIZARD] #wiz NOT found'); return; }
  console.log('[WIZARD] #wiz found');

  // Focus trap pour le wizard
  document.addEventListener('keydown', function _wizTrap(e) {
    if (e.key !== 'Tab') return;
    var el = document.getElementById('wiz');
    if (!el || el.classList.contains('hidden')) return;
    var f = el.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), a[href]');
    if (f.length === 0) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });

  // Diagnostic clic — capturer TOUT clic dans la wizard
  wiz.addEventListener('click', function(e) {
    console.log('[WIZ] CLICK target=' + e.target.tagName + (e.target.id ? '#'+e.target.id : '') + (e.target.className ? '.'+e.target.className.slice(0,30) : '') + ' phase=' + e.eventPhase);
  }, true); // capture=true pour intercepter TOUS les clics
  wiz.addEventListener('click', function(e) {
    if (e.target === wiz) { console.log('[WIZARD] backdrop click'); wizClose(); }
  });

  var closeBtn = document.getElementById('wizCloseBtn');
  var backBtn  = document.getElementById('wizBackBtn');
  var nextBtn  = document.getElementById('wizNextBtn');
  var skipBtn  = document.getElementById('wizSkipBtn');

  console.log('[WIZARD] closeBtn:', !!closeBtn, 'backBtn:', !!backBtn, 'nextBtn:', !!nextBtn, 'skipBtn:', !!skipBtn);
  if (closeBtn) closeBtn.addEventListener('click', function(e) { console.log('[WIZARD] closeBtn clicked'); wizClose(); });
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
  kpi_total_pnl:      { label: "Net PnL",          icon: "dollar",  kind: "kpi",    size: "sm" },
  kpi_winrate:         { label: "Winrate",           icon: "clock",  kind: "kpi",    size: "sm" },
  kpi_average_rr:      { label: "Avg R",            icon: "trend",  kind: "kpi",    size: "sm" },
  kpi_trades:          { label: "Trades",            icon: "list",  kind: "kpi",    size: "sm" },
  kpi_profit_factor:   { label: "Profit Factor",    icon: "scale", kind: "kpi",    size: "sm" },
  kpi_expectancy:      { label: "Expectancy",        icon: "chart", kind: "kpi",    size: "sm" },
  today_context:       { label: "Contexte du jour",  icon: "globe", kind: "panel",  size: "full" },
  today_log:           { label: "Recap",             icon: "log",   kind: "panel",  size: "md" },
  today_activity:      { label: "Activite",          icon: "bolt",  kind: "panel",  size: "tall" },
  today_calendar:      { label: "Calendrier",        icon: "cal",   kind: "panel",  size: "md" },
  today_streak:        { label: "Streak",            icon: "bolt",  kind: "kpi",    size: "sm" },
  btc_chart:           { label: "BTC Chart",         icon: "chart", kind: "panel",  size: "xl" },
  favorites_carousel:  { label: "Favoris",           icon: "heart", kind: "panel",  size: "xl" },
};

var WIDGET_DEFAULTS = {
  "today": ["kpi_total_pnl", "kpi_winrate", "kpi_average_rr", "kpi_trades", "kpi_profit_factor", "kpi_expectancy", "today_context", "today_log", "today_activity", "today_calendar", "today_streak", "btc_chart", "favorites_carousel"],
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
  if (!confirm("Réinitialiser tous les widgets à leur état par défaut ?")) return;
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
      if (e.target.closest("input,textarea,button,a,select,[contenteditable],[draggable],[role=\"button\"],.journal-flip-card,.fav-carousel-arrow")) return;
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

        // Cibles fantomes sur les cellules vides de la grille
        var holes = _createWidgetHoles(board);

        _dnd = {
          el: widget, board: board,
          offsetX: rawOffsetX + (centerX - rawOffsetX) * SNAP_TO_CENTER,
          offsetY: rawOffsetY + (centerY - rawOffsetY) * SNAP_TO_CENTER,
          width: rect.width, height: rect.height,
          ghost: null,
          active: false,
          dropRef: null,
          holes: holes,
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
  if (_dnd.active) dndEnd(); // dndEnd nettoie les holes + met _dnd = null
  else {
    // Drag pas encore actif — nettoyer les trous manuellement
    if (_dnd.holes) { _dnd.holes.forEach(function(h) { h.remove(); }); }
    _dnd = null;
  }
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
    var targetBoard = _dnd.targetBoard || target.closest(".widget-board[data-widget-board]");

    if (targetBoard === board) {
      if (target.classList.contains("widget-hole")) {
        // Déplacer le widget dans le trou — pas de swap DOM
        var holeCol = parseInt(target.style.gridColumnStart, 10);
        var holeRow = parseInt(target.style.gridRowStart, 10);
        el.style.gridColumnStart = holeCol;
        el.style.gridRowStart    = holeRow;
      } else {
        // Swap DOM
        var placeholder = document.createElement("div");
        board.insertBefore(placeholder, el);
        board.insertBefore(el, target);
        board.insertBefore(target, placeholder);
        placeholder.remove();
      }
    } else {
      // Cross-board
      var ph = document.createComment("swap");
      board.insertBefore(ph, el);
      targetBoard.insertBefore(el, target);
      board.insertBefore(target, ph);
      ph.remove();
    }
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

  var affectedBoards = [board];
  if (_dnd.targetBoard && _dnd.targetBoard !== board) affectedBoards.push(_dnd.targetBoard);

  affectedBoards.forEach(function(b) {
    var bKey = b.dataset.widgetBoard;
    var order = Array.from(b.children)
      .map(function(c) { return c.dataset && c.dataset.widgetKey; }).filter(Boolean);
    writeWidgetOrder(bKey, order);

    // Snapshot direct des styles inline — PAS de clear, PAS de getComputedStyle
    var pos = {};
    Array.from(b.children).forEach(function(child) {
      var key = child.dataset && child.dataset.widgetKey;
      if (!key || child.classList.contains("widget-hidden")) return;
      var col = parseInt(child.style.gridColumnStart, 10);
      var row = parseInt(child.style.gridRowStart, 10);
      if (!isNaN(col) && col > 0 && !isNaN(row) && row > 0) {
        pos[key] = { col: col, row: row };
      }
    });
    writeWidgetPositions(bKey, pos);
  });

  updateDashboardLayout();

  // Nettoyer les trous
  if (_dnd.holes) { _dnd.holes.forEach(function(h) { h.remove(); }); _dnd.holes = null; }

  setTimeout(refreshDragHandles, 300);
  _dnd = null;
}

function dndItems(board) {
  var items = Array.from(board.children).filter(function(el) {
    return el && el.dataset && el.dataset.widgetKey
      && !el.classList.contains("widget-hidden");
  });
  if (_dnd && _dnd.holes) {
    _dnd.holes.forEach(function(h) {
      if (h.parentNode === board) items.push(h);
    });
  }
  return items;
}

function _createWidgetHoles(board) {
  var holes = [];
  var children = Array.from(board.children).filter(function(c) {
    return c.dataset && c.dataset.widgetKey && !c.classList.contains("widget-hidden");
  });
  if (children.length === 0) return holes;

  // Lire la grille actuelle via computed style
  var boardStyle = window.getComputedStyle(board);
  var cols = (boardStyle.gridTemplateColumns || "").split(/\s+/).filter(Boolean).length;
  if (cols === 0) return holes;

  // Collecter les cellules occupees via data-size (plus fiable que gridRowEnd/computed)
  var occupied = new Set();
  children.forEach(function(c) {
    var cs = window.getComputedStyle(c);
    var col = parseInt(cs.gridColumnStart, 10);
    var row = parseInt(cs.gridRowStart, 10);
    if (isNaN(col) || isNaN(row) || col < 1 || row < 1) return;

    var size = c.dataset.size || "";
    var colSpan = size === "full" ? cols : size === "wide" ? 2 : 1;
    var rowSpan = size === "tall" ? 2 : 1;

    for (var r = row; r < row + rowSpan; r++) {
      for (var co = col; co < col + colSpan; co++) {
        occupied.add(r + ":" + co);
      }
    }
  });

  // Hauteur max = row la plus haute occupee
  var maxRow = 0;
  occupied.forEach(function(cell) { var rr = parseInt(cell, 10); if (rr > maxRow) maxRow = rr; });
  if (maxRow === 0) return holes;

  // Creer un trou pour chaque cellule vide
  for (var r = 1; r <= maxRow; r++) {
    for (var co = 1; co <= cols; co++) {
      if (!occupied.has(r + ":" + co)) {
        var hole = document.createElement("div");
        hole.className = "widget-hole";
        hole.style.gridColumnStart = co;
        hole.style.gridRowStart = r;
        hole.style.pointerEvents = "none";
        board.appendChild(hole);
        holes.push(hole);
      }
    }
  }
  return holes;
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
    // Delegation document-level pour garantir la capture
    document.addEventListener("click", function _todayCalClick(e) {
      var dayEl = e.target.closest("#todayCalendarGrid .day");
      if (!dayEl) return;
      // other-month: navigation vers le mois clique uniquement (pas d'ouverture de jour)
      var isOther = dayEl.dataset.otherMonth === "1";
      if (isOther) {
        var otherKey = dayEl.dataset.date;
        if (otherKey && typeof goPage === "function") {
          state.journalFocusDate = otherKey;
          goPage("journal");
        }
        return;
      }
      var key = dayEl.dataset.date;
      if (!key) return;
      if (typeof wizOpen === "function") {
        wizOpen({ date: key });
      }
    });
    grid.addEventListener("keydown", function(e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var dayEl = e.target.closest(".day");
      if (!dayEl || dayEl.dataset.otherMonth === "1") return;
      e.preventDefault();
      dayEl.click();
    });
  }
}

// ---- 048_ai_chat.js ----
// ---------- AI Chat — frontend ----------
// State : window.aiChatHistory (session only, not persisted)
// Uses : api(), toast()
// Integration : wizard (wizOpen), day editor (openExistingDay)

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
  var regex = /\[(wizOpen|openDay):\s*(\{[^}]+\})\]/g;
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
  return text.replace(/\[(wizOpen|openDay):\s*\{[^}]+\}\]/g, '').trim();
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
  var _insightsRefreshing = false;
  var _savedCardCache = null; // cache pour _markSavedCards

  var INSIGHT_ICONS = {
    best_strategy: { icon: "<svg class='ii' viewBox='0 0 16 16' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round'><circle cx='8' cy='8' r='6'/><polyline points='5 8 7 10 11 6'/></svg>", cls: "success" },
    worst_strategy: { icon: "<svg class='ii' viewBox='0 0 16 16' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round'><circle cx='8' cy='8' r='6'/><line x1='8' y1='5' x2='8' y2='8'/><line x1='8' y1='10' x2='8' y2='10.01'/></svg>", cls: "warning" },
    best_session: { icon: "<svg class='ii' viewBox='0 0 16 16' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round'><circle cx='8' cy='8' r='6'/><polyline points='5 8 7 10 11 6'/></svg>", cls: "success" },
    worst_session: { icon: "<svg class='ii' viewBox='0 0 16 16' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round'><circle cx='8' cy='8' r='6'/><line x1='8' y1='5' x2='8' y2='8'/><line x1='8' y1='10' x2='8' y2='10.01'/></svg>", cls: "warning" },
    bias_correlation: { icon: "<svg class='ii' viewBox='0 0 16 16' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round'><circle cx='8' cy='8' r='6'/><line x1='8' y1='7' x2='8' y2='11'/><circle cx='8' cy='5' r='0.5' fill='currentColor' stroke='none'/></svg>", cls: "info" },
    direction_strength: { icon: "<svg class='ii' viewBox='0 0 16 16' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round'><circle cx='8' cy='8' r='6'/><polyline points='5 8 7 10 11 6'/></svg>", cls: "success" },
    lesson_themes: { icon: "<svg class='ii' viewBox='0 0 16 16' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round'><circle cx='8' cy='8' r='6'/><line x1='8' y1='7' x2='8' y2='11'/><circle cx='8' cy='5' r='0.5' fill='currentColor' stroke='none'/></svg>", cls: "info" },
    execution_quality: { icon: "<svg class='ii' viewBox='0 0 16 16' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round'><circle cx='8' cy='8' r='6'/><polyline points='5 8 7 10 11 6'/></svg>", cls: "success" },
    execution_warning: { icon: "<svg class='ii' viewBox='0 0 16 16' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round'><circle cx='8' cy='8' r='6'/><line x1='8' y1='5' x2='8' y2='8'/><line x1='8' y1='10' x2='8' y2='10.01'/></svg>", cls: "warning" },
    rr_sweetspot: { icon: "<svg class='ii' viewBox='0 0 16 16' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round'><circle cx='8' cy='8' r='6'/><line x1='8' y1='7' x2='8' y2='11'/><circle cx='8' cy='5' r='0.5' fill='currentColor' stroke='none'/></svg>", cls: "info" },
    recent_trend: { icon: "<svg class='ii' viewBox='0 0 16 16' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round'><circle cx='8' cy='8' r='6'/><line x1='8' y1='7' x2='8' y2='11'/><circle cx='8' cy='5' r='0.5' fill='currentColor' stroke='none'/></svg>", cls: "info" },
    stdv_sweetspot: { icon: "<svg class='ii' viewBox='0 0 16 16' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round'><circle cx='8' cy='8' r='6'/><polyline points='5 8 7 10 11 6'/></svg>", cls: "success" },
    thesis_validated: { icon: "<svg class='ii' viewBox='0 0 16 16' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round'><circle cx='8' cy='8' r='6'/><polyline points='5 8 7 10 11 6'/></svg>", cls: "success" },
    thesis_invalid: { icon: "<svg class='ii' viewBox='0 0 16 16' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round'><circle cx='8' cy='8' r='6'/><line x1='8' y1='5' x2='8' y2='8'/><line x1='8' y1='10' x2='8' y2='10.01'/></svg>", cls: "warning" },
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
    var label = n + "/5 confiance";
    return '<span class="insight-stars" aria-label="' + label + '">' + s + "</span>";
  }

  function _confidenceClass(confidence) {
    if (!confidence) return "low";
    if (confidence >= 0.7) return "high";
    if (confidence >= 0.4) return "medium";
    return "low";
  }

  function _renderInsightCard(pattern) {
    var def = INSIGHT_ICONS[pattern.kind] || { icon: "<svg class='ii' viewBox='0 0 16 16' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round'><circle cx='8' cy='8' r='6'/><line x1='5' y1='8' x2='11' y2='8'/></svg>", cls: "info" };
    var cardCls = "insight-card";
    if (def.cls === "warning") cardCls += " insight-card--warning";
    else if (def.cls === "success") cardCls += " insight-card--success";
    else cardCls += " insight-card--info";

    var tags = (pattern.tags || []).map(function (t) {
      return '<span class="insight-tag">' + _escapeHtml(t) + "</span>";
    }).join("");

    var confPct = Math.round((pattern.confidence || 0) * 100);
    var confCls = _confidenceClass(pattern.confidence);

    return '<div class="' + cardCls + '" data-kind="' + _escapeHtml(pattern.kind || '') + '" data-title="' + _escapeHtml(pattern.title || '') + '">' +
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
      '<button type="button" class="insight-save-btn" onclick="InsightsCtrl.toggleSave(this)" title="Sauvegarder">&#9733;</button>' +
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
    _insightsRefreshing = true;

    var params = {};
    if (opts.instrument && opts.instrument !== "ALL") params.instrument = opts.instrument;
    if (opts.from) params.from = opts.from;
    if (opts.to) params.to = opts.to;

    Promise.all([
      _fetchApi("/api/ml/profile", params),
      _fetchApi("/api/ml/insights", params),
    ]).then(function (results) {
      _insightsRefreshing = false;
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
      _markSavedCards();
    }).catch(function (err) {
      _insightsRefreshing = false;
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
        items.push('<span class="pretrade-item"><span class="pretrade-item__icon success"><svg class=\'ii\' viewBox=\'0 0 16 16\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\' stroke-linecap=\'round\'><circle cx=\'8\' cy=\'8\' r=\'6\'/><polyline points=\'5 8 7 10 11 6\'/></svg></span> ' + _escapeHtml(s.title || "") + "</span>");
      });
      warnings.slice(0, 2).forEach(function (w) {
        items.push('<span class="pretrade-item"><span class="pretrade-item__icon warning"><svg class=\'ii\' viewBox=\'0 0 16 16\' fill=\'none\' stroke=\'currentColor\' stroke-width=\'2\' stroke-linecap=\'round\'><circle cx=\'8\' cy=\'8\' r=\'6\'/><line x1=\'8\' y1=\'5\' x2=\'8\' y2=\'8\'/><line x1=\'8\' y1=\'10\' x2=\'8\' y2=\'10.01\'/></svg></span> ' + _escapeHtml(w.title || "") + "</span>");
      });
      if (items.length) {
        container.innerHTML =
          '<div class="pretrade-widget">' +
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
        if (t) t.classList.remove("show");
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
    var refresh = document.getElementById("insightsRefreshBtn");
    if (!from || !to) return;

    // Restore saved filter state, or use journal's current month
    var saved = _loadInsightFilters();
    if (saved) {
      from.value = saved.from || _getFirstDayOfMonth();
      to.value = saved.to || _getTodayStr();
      if (saved.instrument && instr) instr.value = saved.instrument;
    } else {
      // Try to inherit from journal: use current month range
      if (typeof getJournalCustomWindow === "function" && typeof fmtDateKey === "function") {
        var cw = getJournalCustomWindow();
        if (cw && cw.from && cw.to) {
          from.value = fmtDateKey(cw.from);
          to.value = fmtDateKey(cw.to);
        } else {
          from.value = _getFirstDayOfMonth();
          to.value = _getTodayStr();
        }
      } else {
        from.value = _getFirstDayOfMonth();
        to.value = _getTodayStr();
      }
    }
    populateInstruments('filterInstrument');

    var quickBtns = [
      { label: "7j", days: 7 },
      { label: "30j", days: 30 },
      { label: "90j", days: 90 },
      { label: "Ce mois", fn: _getFirstDayOfMonth },
    ];

    function _saveFilterState() {
      try {
        localStorage.setItem("insightFilters", JSON.stringify({
          from: from ? from.value : "",
          to: to ? to.value : "",
          instrument: instr ? instr.value : "ALL",
          strategy: strat ? strat.value : "ALL",
        }));
      } catch(e) {}
    }

    function _loadInsightFilters() {
      try {
        var raw = JSON.parse(localStorage.getItem("insightFilters"));
        if (raw && raw.from && raw.to) return raw;
      } catch(e) {}
      return null;
    }

    function _applyFilter() {
      _saveFilterState();
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
    if (refresh) refresh.addEventListener("click", function () {
      if (_insightsRefreshing) return;
      _applyFilter();
    });
    _applyFilter();
  }

  function initInsights() {
    if (_insightsInitialized) return;
    _insightsInitialized = true;
    _renderPretradeWidget();
    _initPostTradeToast();
    _initFilters();
    if (typeof renderPerformance === "function") renderPerformance();

    document.addEventListener("trade:saved", function (e) {
      onTradeSaved(e.detail);
    });
  }

  function _markSavedCards() {
    if (_savedCardCache) {
      _applySavedCards(_savedCardCache);
      return;
    }
    fetch('/api/ml/knowledge').then(function (r) { return r.json(); }).then(function (cards) {
      _savedCardCache = cards || [];
      _applySavedCards(_savedCardCache);
    }).catch(function () {});
  }

  function _applySavedCards(cards) {
    if (!cards || !cards.length) return;
    var lookup = {};
    cards.forEach(function (c) { lookup[c.kind + '|' + c.title] = true; });
    document.querySelectorAll('.insight-card').forEach(function (card) {
      var key = (card.dataset.kind || '') + '|' + (card.dataset.title || '');
      if (lookup[key]) {
        card.classList.add('is-saved');
        var btn = card.querySelector('.insight-save-btn');
        if (btn) btn.title = 'Retirer des sauvegardes';
      }
    });
  }

  function _escapeHtml(str) {
    if (typeof str !== "string") return str || "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  window.InsightsCtrl = {
    toggleSave: function (btn) {
      var card = btn.closest('.insight-card');
      if (!card) return;
      var kind = card.dataset.kind;
      var title = card.dataset.title;
      if (!kind || !title) return;

      var isSaved = card.classList.contains('is-saved');

      if (isSaved) {
        fetch('/api/ml/knowledge?kind=' + encodeURIComponent(kind) + '&title=' + encodeURIComponent(title), { method: 'DELETE' })
          .then(function () {
            card.classList.remove('is-saved');
            btn.title = 'Sauvegarder';
            _savedCardCache = null; // invalider le cache
          }).catch(function () {});
      } else {
        var body = JSON.stringify({
          kind: kind, title: title,
          body: card.querySelector('.insight-body')?.textContent || '',
          confidence: parseFloat(card.querySelector('.insight-badge')?.textContent || '0') / 100,
        });
        fetch('/api/ml/knowledge', { method: 'POST', body: body, headers: { 'Content-Type': 'application/json' } })
          .then(function () {
            card.classList.add('is-saved');
            btn.title = 'Retirer des sauvegardes';
            _savedCardCache = null; // invalider le cache
          }).catch(function () {});
      }
    }
  };

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
    wizOpen({});
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
    // Calculer dynamiquement la date la plus ancienne depuis state.days
    var earliest = null;
    if (Array.isArray(state.days)) {
      for (var i = 0; i < state.days.length; i++) {
        if (state.days[i] && state.days[i].date && (!earliest || state.days[i].date < earliest)) {
          earliest = state.days[i].date;
        }
      }
    }
    return { from: earliest || "2020-01-01", to: _udpDateKey(today) };
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
        '<button type="button" data-shortcut="today">Aujourd&#39;hui</button>' +
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
  populateInstruments('jFilterInstrument');
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

  state.currentMonth = new Date(toDate.getFullYear(), toDate.getMonth(), 1);
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

  // Loading state: days pas encore charges
  if (!state.days || state.days.length === 0) {
    labelEl.textContent = _journalStatsConfig[_journalStatsIndex].label;
    valueEl.textContent = "...";
    valueEl.className = "jfilter-stats-loading";
    return;
  }

  var stats = computeJournalStats();
  var config = _journalStatsConfig[_journalStatsIndex];
  labelEl.textContent = config.label;
  valueEl.textContent = config.fmt(stats[config.key]);
  valueEl.className = "";
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
    setTimeout(function() { window._consumeClick = false; }, 0);
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
    if (typeof loadStats === 'function') loadStats({ refreshDays: true, skipRender: false });
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


function _bindJournalClick(wrap) {
  wrap.addEventListener("click", function (e) {
    if (window._consumeClick) { window._consumeClick = false; e.stopImmediatePropagation(); e.preventDefault(); return; }
    var ec = e.target.closest("[data-journal-editor-close]"); if (ec) { e.stopPropagation(); closeJournalTradeEditor(); return; }
    var es = e.target.closest("[data-journal-editor-save]"); if (es) { e.stopPropagation(); var st = es.dataset.journalEditorSave || TradeEditorController.activeTradeId; if (st) TradeEditorController.save(st); return; }
    var cb = e.target.closest("[data-journal-day-close]"); if (cb) { closeJournalDayTrades(); return; }
    var eb = e.target.closest("[data-journal-trade-edit]");
    if (!eb && e.target.tagName === "BUTTON" && e.target.classList.contains("journal-back-edit")) eb = e.target;
    if (eb) { e.stopPropagation(); try { openJournalTradeEditor(eb.dataset.journalTradeEdit); } catch (_e) { console.error("[cockpit] Erreur ouverture editeur:", _e); } return; }
    var ep = e.target.closest(".jedit-pill"); if (ep) { e.stopPropagation(); var eg = ep.closest(".jedit-pills"); if (eg) { eg.querySelectorAll(".jedit-pill").forEach(function (p) { p.classList.remove("is-active"); }); ep.classList.add("is-active"); var ed = ep.closest(".journal-trade-editor"); var et = ed && ed.dataset.tradeId; if (et) TradeEditorController.scheduleSave(et); } return; }
    var est = e.target.closest(".jedit-star"); if (est) { e.stopPropagation(); var esw = est.closest(".jedit-stars"); if (esw) { var ev = Number(est.dataset.val); if (String(esw.dataset.value) === String(ev)) ev = 0; esw.dataset.value = String(ev); esw.querySelectorAll(".jedit-star").forEach(function (s) { s.classList.toggle("is-lit", Number(s.dataset.val) <= ev); }); var ed2 = esw.closest(".journal-trade-editor"); var et2 = ed2 && ed2.dataset.tradeId; if (et2) TradeEditorController.scheduleSave(et2); } return; }
    var pill = e.target.closest(".jcard-pill"); if (pill) { e.stopPropagation(); var g = pill.closest(".jcard-pills"); if (g) { g.querySelectorAll(".jcard-pill").forEach(function (p) { p.classList.remove("is-active"); }); pill.classList.add("is-active"); var s = pill.closest(".journal-flip-back-scroll"); var t = s && s.dataset.tradeId; if (t) _journalCardScheduleSave(t); } return; }
    var star = e.target.closest(".jcard-star"); if (star) { e.stopPropagation(); var sw = star.closest(".jcard-stars"); if (sw) { var v = Number(star.dataset.val); if (String(sw.dataset.value) === String(v)) v = 0; sw.dataset.value = String(v); sw.querySelectorAll(".jcard-star").forEach(function (s) { s.classList.toggle("is-lit", Number(s.dataset.val) <= v); }); var s2 = sw.closest(".journal-flip-back-scroll"); var t3 = s2 && s2.dataset.tradeId; if (t3) _journalCardScheduleSave(t3); } return; }
    var fav = e.target.closest("[data-journal-fav]"); if (fav) { e.stopPropagation(); _toggleTradeFavorite(fav.dataset.journalFav, fav); return; }
    var dup = e.target.closest("[data-journal-dup]"); if (dup) { e.stopPropagation(); _duplicateTrade(dup.dataset.journalDup); return; }
    if (e.target.closest(".journal-back-icon")) { e.stopPropagation(); return; }
    if (e.target.closest(".journal-trade-editor")) { e.stopPropagation(); return; }
    if (_jcardFieldFocused) return;
    if (e.target.closest("input, textarea, select, .jcard-pills, .jcard-stars")) return;
    if (document.documentElement.classList.contains("html-editor-open")) { closeJournalTradeEditor(); return; }
    if (TradeEditorController.activeTradeId !== null) { closeJournalTradeEditor(); return; }
    if (TradeEditorController.justClosed) return;
    if (Date.now() - TradeEditorController.closeTime < 1200) return;
    if (document.querySelector("#journalDayTrades .journal-trade-editor")) return;
    var card = e.target.closest(".journal-flip-card"); if (!card || !wrap.contains(card)) return;
    card.classList.toggle("is-flipped");
  });
}

function _bindJournalFocusEvents(wrap) {
  wrap.addEventListener("focusin", function (e) { if (e.target.closest(".jcard-field")) _jcardFieldFocused = true; });
  wrap.addEventListener("focusout", function (e) { if (e.target.closest(".jcard-field")) { setTimeout(function () { _jcardFieldFocused = false; }, 300); } });
}

function _bindJournalFieldSaves(wrap) {
  wrap.addEventListener("focusout", function (e) {
    var field = e.target.closest(".jcard-field");
    if (field) { var s = field.closest(".journal-flip-back-scroll"); var t = s && s.dataset.tradeId; if (t) _journalCardScheduleSave(t); return; }
    var ef = e.target.closest(".jedit-field"); if (ef) { var ed = ef.closest(".journal-trade-editor"); var et = ed && ed.dataset.tradeId; if (et) TradeEditorController.scheduleSave(et); }
  });
}

function _bindJournalChangeSelect(wrap) {
  wrap.addEventListener("change", function (e) {
    var ef = e.target.closest(".jedit-field"); if (!ef) return;
    if (ef.tagName === "SELECT" && ef.dataset.field === "strategy") {
      var ed = ef.closest(".journal-trade-editor");
      var title = ed && ed.querySelector(".jedit-hero-copy h3");
      if (title) title.textContent = ef.options[ef.selectedIndex] ? ef.options[ef.selectedIndex].text : ef.value;
    }
  });
}

function _bindJournalKeydown(wrap) {
  wrap.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && TradeEditorController.activeTradeId) { e.preventDefault(); closeJournalTradeEditor(); return; }
    if (e.key !== "Enter" && e.key !== " ") return;
    if (e.target.matches("input, textarea, select, button")) return;
    if (e.target.closest(".journal-trade-editor")) return;
    if (wrap.querySelector(".jcard-field:focus, .journal-flip-back-scroll:focus-within")) return;
    if (document.documentElement.classList.contains("html-editor-open")) return;
    if (TradeEditorController.activeTradeId !== null) return;
    if (Date.now() - TradeEditorController.closeTime < 1200) return;
    if (document.querySelector("#journalDayTrades .journal-trade-editor")) return;
    var card = e.target.closest(".journal-flip-card"); if (!card || !wrap.contains(card)) return;
    e.preventDefault(); card.classList.toggle("is-flipped");
  });
}

function _bindJournalMarginInput(wrap) {
  wrap.addEventListener("input", function (e) {
    var field = e.target.closest(".journal-flip-back-scroll .jcard-margin-input, .journal-flip-back-scroll .jcard-field[data-field=\"leverage\"], .journal-flip-back-scroll .jcard-field[data-field=\"entry_price\"]");
    if (!field) return; var scroll = field.closest(".journal-flip-back-scroll"); if (!scroll) return; var tid = scroll.dataset.tradeId; if (!tid) return;
    var mi = scroll.querySelector(".jcard-margin-input"); var li = scroll.querySelector(".jcard-field[data-field=\"leverage\"]");
    var ei = scroll.querySelector(".jcard-field[data-field=\"entry_price\"]"); var pi = scroll.querySelector(".jcard-field[data-field=\"position_size\"]");
    if (!mi || !li || !ei || !pi) return;
    if (field === mi || field.dataset.field === "leverage") {
      var m = Number(mi.value); var l = Number(li.value); var e = Number(ei.value);
      if (m > 0 && l > 0 && e > 0) { var c = computePositionSize(m, l, e); if (c != null) { pi.value = String(c); _journalCardScheduleSave(tid); } }
    }
    if (field === pi) {
      var p = Number(pi.value); var l2 = Number(li.value); var e2 = Number(ei.value);
      if (p > 0 && l2 > 0 && e2 > 0) { var cm = computeMarginUsd(p, l2, e2); if (cm != null) mi.value = String(cm); }
    }
  });
}

function _bindJournalScreenshotUpload(wrap) {
  wrap.addEventListener("click", function (e) { var se = e.target.closest(".journal-back-shot"); if (!se) return; var si = se.querySelector(".journal-shot-input"); if (!si) return; si.click(); });
  wrap.addEventListener("change", function (e) {
    var input = e.target.closest(".journal-shot-input"); if (!input || !input.files || !input.files[0]) return;
    var file = input.files[0]; var scroll = input.closest(".journal-flip-back-scroll"); if (!scroll) return;
    var tid = scroll.dataset.tradeId; if (!tid) return;
    var fd = new FormData(); fd.append("file", file);
    fetch("/api/trades/" + tid + "/screenshots", { method: "POST", body: fd })
      .then(function (r) { if (!r.ok) throw new Error("Upload echoue"); return r.json(); })
      .then(function () { return api("/api/trades/" + tid); })
      .then(function (u) { _journalDayTradeCache[String(tid)] = u; _journalCardRefreshFull(String(tid), u); _journalRefreshStateDebounced(); })
      .catch(function (err) { toast(err.message || "Erreur upload screenshot", "error"); });
    input.value = "";
  });
}

function bindJournalDayTrades() {
  var wrap = $("#journalDayTrades");
  if (!wrap || _journalDayTradeCardsBound) return;
  _bindJournalClick(wrap);
  _bindJournalFocusEvents(wrap);
  _bindJournalFieldSaves(wrap);
  _bindJournalChangeSelect(wrap);
  _bindJournalKeydown(wrap);
  _bindJournalMarginInput(wrap);
  _bindJournalScreenshotUpload(wrap);
  _journalDayTradeCardsBound = true;
  if (!window._journalCloseBound) {
    window._journalCloseBound = true;
    document.addEventListener("click", function _closeOnOutside(e) {
      var w = $("#journalDayTrades"); if (!w || w.classList.contains("hidden")) return;
      if (e.target.closest(".journal-flip-card, #journalDayTrades, .day, #journalTradesTbody, [data-journal-trade-edit]")) return;
      if (!w.contains(e.target)) closeJournalDayTrades();
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

  // Preserver l'etat des flips avant de detruire le DOM
  var flipped = {};
  wrap.querySelectorAll('.journal-flip-card.is-flipped').forEach(function (c) {
    var tid = c.dataset.tradeId;
    if (tid) flipped[tid] = true;
  });

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

  // Restaurer les flips preserves
  if (Object.keys(flipped).length) {
    Object.keys(flipped).forEach(function (tid) {
      var card = wrap.querySelector('.journal-flip-card[data-trade-id="' + tid + '"]');
      if (card) card.classList.add('is-flipped');
    });
  }

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

function _flipCardFrontInner(day, trade, m, pnl, pnlClass, resultClass, resultLabel, direction, strategy, rr, summary, shot, shotStyle, shotClass, tid, idx) {
  return `<div class="journal-flip-face journal-flip-front">
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
  </div>`;
}

function _flipCardBackInner(day, trade, m, pnl, pnlClass, resultClass, resultLabel, direction, strategy, rr, summary, shot, shotStyle, shotClass, tid, idx, dateLabel, htf, starsHtml, qualityRaw, lessonsRaw) {
  var isFav = (trade.tags || []).includes("favoris");
  return `<div class="journal-flip-face journal-flip-back">
    <div class="journal-flip-back-scroll" data-trade-id="${tid}">
      <div class="journal-back-actions">
        <button type="button" class="journal-back-icon${isFav ? " is-active" : ""}" aria-label="Favoris" aria-pressed="${isFav}" data-journal-fav="${tid}">
          <svg viewBox="0 0 24 24" fill="${isFav ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>
        </button>
        <button type="button" class="journal-back-icon" aria-label="Dupliquer" data-journal-dup="${tid}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
        <span class="jcard-save-ind" data-state=""></span>
        <button type="button" class="journal-back-edit" data-journal-trade-edit="${tid}">Editer</button>
      </div>
      <h4>${escapeHtml(strategy)}</h4>
      <p class="journal-back-sub">${escapeHtml(dateLabel)} &middot; ${escapeHtml(day.instrument || "-")} &middot; ${escapeHtml(direction)}</p>
      <p class="journal-back-summary">${escapeHtml(summary)}</p>
      <div class="journal-back-stats">
        <div><strong>${escapeHtml(direction)}</strong><span>Direction</span></div>
        <div><strong>${escapeHtml(trade.session || '-')}</strong><span>Session</span></div>
        <div><strong class="jcard-rr-display">${escapeHtml(rr)}</strong><span>R multiple</span></div>
        <div><strong class="jcard-pnl-display ${pnlClass}">${fmtMoney(pnl)}</strong><span>PnL</span></div>
      </div>
      <h5>Niveaux</h5>
      <div class="journal-trade-detail-grid">
        <div style="grid-column:1/-1">
          <span>Entree</span>
          <input class="jcard-field" type="number" step="0.01" data-field="entry_price" value="${trade.entry_price != null ? escapeHtml(String(trade.entry_price)) : ''}" placeholder="&mdash;"/>
        </div>
        <div>
          <span>SL</span>
          <input class="jcard-field" type="number" step="0.01" data-field="stop_loss" value="${trade.stop_loss != null ? escapeHtml(String(trade.stop_loss)) : ''}" placeholder="&mdash;"/>
        </div>
        <div>
          <span>Sortie</span>
          <input class="jcard-field" type="number" step="0.01" data-field="exit_price" value="${trade.exit_price != null ? escapeHtml(String(trade.exit_price)) : ''}" placeholder="&mdash;"/>
        </div>
      </div>
      <h5>Capture</h5>
      <div class="journal-back-shot" data-trade-shot="${tid}">
        ${shot ? `<img class="journal-back-shot-img" src="/screenshots/${escapeHtml(shot.filename)}" alt="Screenshot" />` : '<div class="journal-back-shot-empty"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span>Ajouter une photo</span></div>'}
        <input type="file" accept="image/*" class="journal-shot-input hidden" data-trade-shot-input="${tid}" />
      </div>
      <h5>Execution</h5>
      <div class="journal-trade-detail-grid jcard-exec-grid">
        <div><span>Resultat</span><strong class="jcard-result-display ${resultClass}">${escapeHtml(resultLabel)}</strong></div>
        <div><span>Marge $</span><input class="jcard-field jcard-margin-input" type="number" step="0.01" min="0" data-margin-input="1" value="${trade.position_size != null && trade.leverage != null && trade.entry_price != null ? escapeHtml(String(computeMarginUsd(trade.position_size, trade.leverage, trade.entry_price))) : ''}" placeholder="0.00"/></div>
        <div><span>Levier</span><input class="jcard-field" type="number" step="1" min="1" data-field="leverage" value="${trade.leverage != null ? escapeHtml(String(trade.leverage)) : ''}" placeholder="1x"/></div>
        <div><span>Position</span><input class="jcard-field" type="number" step="0.01" data-field="position_size" value="${trade.position_size != null ? escapeHtml(String(trade.position_size)) : ''}" placeholder="&mdash;"/></div>
        <div><span>Qualite</span><div class="jcard-stars" data-field="execution_quality" data-value="${qualityRaw}">${starsHtml}</div></div>
      </div>
      <h5>Contexte</h5>
      <div class="journal-trade-back-note"><span>HTF / plan</span><p>${escapeHtml(htf)}</p></div>
      <div class="journal-trade-back-note"><span>Review</span><textarea class="jcard-field jcard-textarea" data-field="lessons_learned" rows="3" placeholder="Lecons apprises&hellip;">${escapeHtml(lessonsRaw)}</textarea></div>
    </div>
  </div>`;
}

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

  return '<article class="journal-flip-card" tabindex="0" data-trade-id="' + tid + '">' +
    '<div class="journal-flip-card-inner">' +
    _flipCardFrontInner(day, trade, m, pnl, pnlClass, resultClass, resultLabel, direction, strategy, rr, summary, shot, shotStyle, shotClass, tid, idx) +
    _flipCardBackInner(day, trade, m, pnl, pnlClass, resultClass, resultLabel, direction, strategy, rr, summary, shot, shotStyle, shotClass, tid, idx, dateLabel, htf, starsHtml, qualityRaw, lessonsRaw) +
    '</div></article>';
}
// ---------- Favoris toggle ----------
function _toggleTradeFavorite(tid, btnEl) {
  var trade = _journalDayTradeCache[String(tid)];
  if (!trade) return;
  var tags = Array.isArray(trade.tags) ? trade.tags.slice() : [];
  var idx = tags.indexOf('favoris');
  var isFav = idx !== -1;
  if (isFav) { tags.splice(idx, 1); } else { tags.push('favoris'); }

  btnEl.classList.toggle('is-active', !isFav);
  btnEl.setAttribute('aria-pressed', String(!isFav));
  var svg = btnEl.querySelector('svg');
  if (svg) svg.setAttribute('fill', !isFav ? 'currentColor' : 'none');

  api('/api/trades/' + tid, {
    method: 'PUT',
    body: JSON.stringify({ tags: tags })
  }).then(function(updated) {
    _journalDayTradeCache[String(tid)] = updated;
    _journalSyncStateAfterSave(tid, updated);
    toast(isFav ? 'Retire des favoris' : 'Ajoute aux favoris', 'success');
    // Rafraichir le widget Favoris Carousel si la page Today est visible
    if (typeof window.refreshFavCarousel === 'function') {
      window.refreshFavCarousel();
    }
  }).catch(function() {
    // Rollback visuel
    btnEl.classList.toggle('is-active', isFav);
    btnEl.setAttribute('aria-pressed', String(isFav));
    if (svg) svg.setAttribute('fill', isFav ? 'currentColor' : 'none');
    toast('Erreur mise a jour favoris', 'error');
  });
}

// ---------- Duplicate trade ----------
function _duplicateTrade(tid) {
  var trade = _journalDayTradeCache[String(tid)];
  if (!trade) return;

  // Find the day for this trade
  var day = _journalDayTradeDays[String(tid)];
  if (!day) return;

  var tags = Array.isArray(trade.tags) ? trade.tags.slice() : [];
  if (!tags.includes('copie')) tags.push('copie');

  var payload = {
    strategy: trade.strategy,
    direction: trade.direction,
    entry_price: trade.entry_price,
    stop_loss: trade.stop_loss,
    take_profit: trade.take_profit,
    position_size: trade.position_size,
    leverage: trade.leverage,
    session: trade.session,
    tags: tags,
    why_trade: trade.why_trade,
    scenario: trade.scenario
  };

  api('/api/days/' + day.id + '/trades', {
    method: 'POST',
    body: JSON.stringify(payload)
  }).then(function() {
    _journalRefreshStateDebounced();
    toast('Trade duplique', 'success');
  }).catch(function(err) {
    toast(err && err.message ? err.message : 'Erreur duplication', 'error');
  });
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



TradeEditorController.sessionOptions = function (current) {
  var sessions = [
    { value: '', label: 'Choisir' },
    { value: 'asia', label: 'Asia' },
    { value: 'london', label: 'London' },
    { value: 'ny_am', label: 'NY AM' },
    { value: 'ny_pm', label: 'NY PM' },
  ];
  return sessions.map(function (s) {
    var sel = String(current) === s.value ? ' selected' : '';
    return '<option value="' + s.value + '"' + sel + '>' + s.label + '</option>';
  }).join('');
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

  return '\n    <aside class="journal-trade-editor" data-trade-id="' + tid + '" role="dialog" aria-label="Edition du trade">\n      <div class="jedit-panel">\n        <div class="jedit-hero">\n          <div class="jedit-hero-shot ' + shotClass + '"' + shotStyle + '>' + (shot ? '' : '<span>Aucune capture</span>') + '</div>\n          <div class="jedit-hero-copy">\n            <div class="jedit-topline">\n              <span>' + escapeHtml(dateLabel) + '</span>\n              <span>' + escapeHtml(day.instrument || '-') + '</span>\n              <span>' + escapeHtml((direction || '-').toUpperCase()) + '</span>\n            </div>\n            <h3>' + escapeHtml(strategy) + '</h3>\n            <p>' + escapeHtml(TradeEditorController.shortText(trade.why_trade, trade.scenario, trade.why_entry)) + '</p>\n            <div class="jedit-metrics">\n              <div class="jedit-metric-pnl"><strong class="' + pnlClass + '">' + fmtMoney(pnl) + '</strong><span>PnL</span></div>\n              <div class="jedit-metric-rr"><strong>' + escapeHtml(rr) + '</strong><span>R multiple</span></div>\n              <div class="jedit-metric-result"><strong class="' + resultClass + '">' + escapeHtml(resultLabel) + '</strong><span>Resultat</span></div>\n            </div>\n          </div>\n          <div class="jedit-actions">\n            <span class="jedit-status" data-state=""></span>\n            <button type="button" class="jedit-save" data-journal-editor-save="' + tid + '">Sauver</button>\n            <button type="button" class="jedit-close" data-journal-editor-close aria-label="Fermer">\n              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>\n            </button>\n          </div>\n        </div>\n\n        <div class="jedit-scroll">\n          <div class="jedit-sticky">\n            <button type="button" class="jedit-save" data-journal-editor-save="' + tid + '">Sauver</button>\n            <button type="button" class="jedit-close" data-journal-editor-close aria-label="Fermer">\n              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>\n            </button>\n          </div>\n          <section class="jedit-block jedit-identity">\n            <div class="jedit-block-title"><span>01</span><h4>Setup</h4></div>\n            <div class="jedit-grid">\n              <label class="jedit-field-wrap"><span>Strategie</span><select class="jedit-field" data-field="strategy">' + TradeEditorController.strategyOptions(trade.strategy || '') + '</select></label>\n              <label class="jedit-field-wrap"><span>Direction</span>' + TradeEditorController.pills('direction', direction, [{ value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }, { value: '', label: '?' }]) + '</label>\n              <label class="jedit-field-wrap"><span>Session</span><select class="jedit-field" data-field="session">' + TradeEditorController.sessionOptions(trade.session || '') + '</select></label>\n              ' + TradeEditorController.field('Stdv', 'stdv_level', trade.stdv_level, 'number', { step: '0.5', placeholder: '1 - 5' }) + '\n              <label class="jedit-field-wrap"><span>Resultat</span><select class="jedit-field" data-field="is_win" data-type="bool">' + TradeEditorController.selectOption('', 'A qualifier', winValue) + TradeEditorController.selectOption('1', 'Win', winValue) + TradeEditorController.selectOption('0', 'Loss', winValue) + '</select></label>\n            </div>\n          </section>\n\n          <section class="jedit-block">\n            <div class="jedit-block-title"><span>02</span><h4>Niveaux</h4></div>\n            <div class="jedit-grid jedit-grid-5">\n              ' + TradeEditorController.field('Entree', 'entry_price', trade.entry_price, 'number', { step: '0.01' }) + '\n              ' + TradeEditorController.field('Stop', 'stop_loss', trade.stop_loss, 'number', { step: '0.01' }) + '\n              ' + TradeEditorController.field('TP', 'exit_price', trade.exit_price, 'number', { step: '0.01' }) + '\n              ' + TradeEditorController.field('Sortie', 'exit_price', trade.exit_price, 'number', { step: '0.01' }) + '\n              ' + TradeEditorController.field('Size', 'position_size', trade.position_size, 'number', { step: '0.01' }) + '\n              ' + TradeEditorController.field('Levier', 'leverage', trade.leverage, 'number', { step: '1', placeholder: '1x' }) + '\n              ' + TradeEditorController.field('PnL', 'pnl', trade.pnl, 'number', { step: '0.01' }) + '\n              ' + TradeEditorController.field('RR', 'rr', trade.rr, 'number', { step: '0.01' }) + '\n            </div>\n          </section>\n\n          <section class="jedit-block">\n            <div class="jedit-block-title"><span>03</span><h4>Scenario</h4></div>\n            <div class="jedit-notes">\n              ' + TradeEditorController.textarea('Pourquoi ce trade', 'why_trade', trade.why_trade, 3) + '\n              ' + TradeEditorController.textarea('Pourquoi cette entree', 'why_entry', trade.why_entry, 3) + '\n              ' + TradeEditorController.textarea('Scenario complet', 'scenario', trade.scenario, 4) + '\n              ' + TradeEditorController.textarea('Pourquoi ce stop', 'why_stop', trade.why_stop, 3) + '\n              ' + TradeEditorController.textarea('Pourquoi ce TP', 'why_tp', trade.why_tp, 3) + '\n            </div>\n          </section>\n\n          <section class="jedit-block">\n            <div class="jedit-block-title"><span>04</span><h4>Review</h4></div>\n            <div class="jedit-grid">\n              <label class="jedit-field-wrap"><span>These validee</span>' + TradeEditorController.pills('thesis_validated', trade.thesis_validated || '', [{ value: 'yes', label: 'Oui' }, { value: 'no', label: 'Non' }, { value: '', label: '?' }]) + '</label>\n              <label class="jedit-field-wrap"><span>Qualite execution</span><div class="jedit-stars" data-field="execution_quality" data-value="' + qualityRaw + '">' + starsHtml + '</div></label>\n              ' + TradeEditorController.field('Tags', 'tags', TradeEditorController.tagsValue(trade.tags), 'tags', { placeholder: 'tag1, tag2' }) + '\n              ' + TradeEditorController.textarea('Lecons apprises', 'lessons_learned', trade.lessons_learned, 4) + '\n            </div>\n          </section>\n\n          <section class="jedit-block">\n            <div class="jedit-block-title"><span>05</span><h4>Plan & captures</h4></div>\n            <div class="jedit-plan-grid">\n              <div><span>Plan model</span><strong>' + escapeHtml(trade.plan_model || '-') + '</strong></div>\n              <div><span>Direction plan</span><strong>' + escapeHtml(trade.plan_direction || '-') + '</strong></div>\n              <div><span>Alignement</span><strong>' + escapeHtml(trade.plan_alignment || 'unknown') + '</strong></div>\n              <div><span>Score</span><strong>' + (trade.plan_score == null ? '-' : escapeHtml(String(trade.plan_score))) + '</strong></div>\n            </div>\n            ' + TradeEditorController.textarea('Raison override plan', 'plan_override_reason', trade.plan_override_reason, 3) + '\n            <div class="jedit-shots">' + screenshotsHtml + '</div>\n          </section>\n        </div>\n      </div>\n    </aside>\n  ';
};

// ---- 060_btc_chart_widget.js ----
// ---------- BTC Chart widget — TradingView Lightweight Charts ----------
// v2.0 — Indicators: SMA, EMA, Bollinger, RSI (synced from chart settings)

(function () {
  var chart = null;
  var series = null;
  var countdownPriceLine = null;
  var currentInterval = '3m';
  var resizeObserver = null;
  var chartReady = false;
  var countdownTimer = null;
  var lastCandleTime = 0;

  // Indicator series
  var indicatorSeries = {};
  var rsiSeries = null;
  var vwapSeriesMap = {};
  var activeVwapPeriods = [];
  try { var s = JSON.parse(localStorage.getItem('chartVwapPeriods')); if (Array.isArray(s)) activeVwapPeriods = s; } catch(e) {}
  var VWAP_COLORS = { '1D': '#f59e0b', '7D': '#06b6d4', '30D': '#a78bfa', '90D': '#f472b6' };
  var VWAP_INTERVALS = { '1D': '1h', '7D': '1h', '30D': '4h', '90D': '1d' };
  var VWAP_DAYS = { '1D': 1, '7D': 7, '30D': 30, '90D': 90 };
  var INTERVAL_MINUTES = { '1m':1,'3m':3,'5m':5,'15m':15,'30m':30,'1h':60,'2h':120,'4h':240,'6h':360,'8h':480,'12h':720,'1d':1440,'3d':4320,'1w':10080,'1M':43200 };

  var INTERVAL_MS = {
    '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000,
    '30m': 1800000, '1h': 3600000, '2h': 7200000, '4h': 14400000,
    '6h': 21600000, '8h': 28800000, '12h': 43200000,
    '1d': 86400000, '3d': 259200000, '1w': 604800000, '1M': 2592000000,
  };

  // Read settings from same localStorage as chart page
  var indSettings = {
    sma: { active: false, period: 20, color: '#f59e0b' },
    ema: { active: false, period: 20, color: '#06b6d4' },
    boll: { active: false, period: 20, color: '#a78bfa' },
    rsi: { active: false, period: 14, color: '#f472b6' },
  };

  try {
    var saved = JSON.parse(localStorage.getItem('chartIndSettings'));
    if (saved) {
      Object.keys(saved).forEach(function (k) {
        if (indSettings[k]) Object.assign(indSettings[k], saved[k]);
      });
    }
  } catch(e) {}

  // VWAP period read from chartVwapPeriods (array, multi-select)

  function _getIntervalMs(interval) {
    var m = INTERVAL_MS[interval];
    if (m) return m;
    var match = interval.match(/^(\d+)(m|h|d|w|M)$/);
    if (!match) return 3600000;
    var num = parseInt(match[1], 10);
    var unit = match[2];
    var mult = { m: 60000, h: 3600000, d: 86400000, w: 604800000, M: 2592000000 };
    return num * (mult[unit] || 3600000);
  }

  // ── INDICATOR CALCULATIONS (same as 062) ──

  function _calcSMA(candles, period) {
    var result = [], sum = 0;
    for (var i = 0; i < candles.length; i++) {
      sum += candles[i].close;
      if (i >= period) sum -= candles[i - period].close;
      if (i >= period - 1) result.push({ time: candles[i].time, value: sum / period });
    }
    return result;
  }

  function _calcEMA(candles, period) {
    var result = [];
    var k = 2 / (period + 1);
    // Warmup : SMA des period premieres bougies
    var ema = 0;
    for (var w = 0; w < period; w++) ema += candles[w].close;
    ema /= period;
    for (var i = 0; i < candles.length; i++) {
      ema = (candles[i].close - ema) * k + ema;
      if (i >= period - 1) result.push({ time: candles[i].time, value: ema });
    }
    return result;
  }

  function _calcBollinger(candles, period) {
    var smaData = _calcSMA(candles, period);
    var result = [];
    for (var i = 0; i < smaData.length; i++) {
      var idx = i + period - 1;
      var sumSq = 0;
      for (var j = 0; j < period; j++) {
        var diff = candles[idx - j].close - smaData[i].value;
        sumSq += diff * diff;
      }
      var std = Math.sqrt(sumSq / period);
      result.push({
        time: smaData[i].time,
        middle: smaData[i].value,
        upper: smaData[i].value + 2 * std,
        lower: smaData[i].value - 2 * std,
      });
    }
    return result;
  }

  function _calcRSI(candles, period) {
    if (candles.length < period + 1) return [];
    var gains = [], losses = [];
    for (var i = 1; i < candles.length; i++) {
      var diff = candles[i].close - candles[i - 1].close;
      gains.push(diff > 0 ? diff : 0);
      losses.push(diff < 0 ? -diff : 0);
    }
    var avgGain = 0, avgLoss = 0;
    for (var j = 0; j < period; j++) {
      avgGain += gains[j];
      avgLoss += losses[j];
    }
    avgGain /= period;
    avgLoss /= period;
    var result = [];
    var rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push({ time: candles[period].time, value: 100 - (100 / (1 + rs)) });
    for (var k = period; k < gains.length; k++) {
      avgGain = (avgGain * (period - 1) + gains[k]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[k]) / period;
      rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      result.push({ time: candles[k + 1].time, value: 100 - (100 / (1 + rs)) });
    }
    return result;
  }

  function _clearIndicators() {
    if (!chart) return;
    Object.keys(indicatorSeries).forEach(function (key) {
      try { chart.removeSeries(indicatorSeries[key]); } catch(e) {}
    });
    indicatorSeries = {};
    if (rsiSeries) {
      try { chart.removeSeries(rsiSeries); } catch(e) {}
      rsiSeries = null;
    }
  }

  function _renderIndicators(candles) {
    _clearIndicators();
    if (!chart || !candles || !candles.length) return;

    var s = indSettings;

    if (s.sma.active && candles.length >= s.sma.period) {
      var smaData = _calcSMA(candles, s.sma.period);
      indicatorSeries.sma = chart.addLineSeries({
        color: s.sma.color, lineWidth: 1.5, priceLineVisible: false,
        lastValueVisible: true, crosshairMarkerVisible: false,
        title: 'SMA ' + s.sma.period,
      });
      indicatorSeries.sma.setData(smaData);
    }

    if (s.ema.active && candles.length >= s.ema.period) {
      var emaData = _calcEMA(candles, s.ema.period);
      indicatorSeries.ema = chart.addLineSeries({
        color: s.ema.color, lineWidth: 1.5, priceLineVisible: false,
        lastValueVisible: true, crosshairMarkerVisible: false,
        title: 'EMA ' + s.ema.period,
      });
      indicatorSeries.ema.setData(emaData);
    }

    if (s.boll.active && candles.length >= s.boll.period) {
      var bollData = _calcBollinger(candles, s.boll.period);
      indicatorSeries.bollMid = chart.addLineSeries({
        color: s.boll.color, lineWidth: 1, priceLineVisible: false,
        lastValueVisible: true, crosshairMarkerVisible: false,
        title: 'BB ' + s.boll.period,
      });
      indicatorSeries.bollUpper = chart.addLineSeries({
        color: s.boll.color, lineWidth: 1, priceLineVisible: false,
        lastValueVisible: false, crosshairMarkerVisible: false, lineStyle: 2,
      });
      indicatorSeries.bollLower = chart.addLineSeries({
        color: s.boll.color, lineWidth: 1, priceLineVisible: false,
        lastValueVisible: false, crosshairMarkerVisible: false, lineStyle: 2,
      });
      indicatorSeries.bollMid.setData(bollData.map(function (d) { return { time: d.time, value: d.middle }; }));
      indicatorSeries.bollUpper.setData(bollData.map(function (d) { return { time: d.time, value: d.upper }; }));
      indicatorSeries.bollLower.setData(bollData.map(function (d) { return { time: d.time, value: d.lower }; }));
    }

    if (s.rsi.active && candles.length >= s.rsi.period + 1) {
      try {
        rsiSeries = chart.addLineSeries({
          color: s.rsi.color, lineWidth: 1.5, priceLineVisible: false,
          lastValueVisible: true, crosshairMarkerVisible: false,
          priceScaleId: 'rsi_pane',
          title: 'RSI ' + s.rsi.period,
        });
        chart.priceScale('rsi_pane').applyOptions({
          scaleMargins: { top: 0.7, bottom: 0 },
          visible: true,
        });
        var rsiData = _calcRSI(candles, s.rsi.period);
        rsiSeries.setData(rsiData);
      } catch(e) { console.error('[btc-chart] RSI:', e); }
    }
  }

  // ── VWAP (multi-periode) ──
  function _removeVwapSeries(key) {
    var s = vwapSeriesMap[key];
    if (s) { try { chart.removeSeries(s); } catch(e) {} delete vwapSeriesMap[key]; }
  }
  function _calcAndDrawVwap() {
    Object.keys(vwapSeriesMap).forEach(function (k) {
      if (activeVwapPeriods.indexOf(k) < 0) _removeVwapSeries(k);
    });
    if (!activeVwapPeriods.length) return;

    var _savedR = null, _savedL = null;
    try { _savedR = chart.timeScale().getVisibleRange(); } catch(e) {}
    try { _savedL = chart.timeScale().getVisibleLogicalRange(); } catch(e) {}

    activeVwapPeriods.forEach(function (period) {
      var days = VWAP_DAYS[period] || 1;
      var fetchInterval = VWAP_INTERVALS[period] || '1h';
      var color = VWAP_COLORS[period] || '#f59e0b';
      var label = 'VWAP ' + period + ' (' + fetchInterval + ')';

      function _computeVwap(candleArray, callback) {
        var now = Math.floor(Date.now() / 1000);
        var todayStart = Math.floor(now / 86400) * 86400;
        var cutoff = todayStart - (days - 1) * 86400;
        var cumTpv = 0, cumVol = 0;
        var vwapData = [];
        for (var i = 0; i < candleArray.length; i++) {
          var c = candleArray[i];
          if (c.time < cutoff) continue;
          var tp = (c.high + c.low + c.close) / 3;
          cumTpv += tp * c.volume;
          cumVol += c.volume;
          if (cumVol > 0) vwapData.push({ time: c.time, value: cumTpv / cumVol });
        }
        if (!vwapData.length) { _removeVwapSeries(period); callback(); return; }
        var _renderR = null;
        try { _renderR = chart.timeScale().getVisibleRange(); } catch(e) {}
        if (_renderR && _renderR.from) vwapData = vwapData.filter(function (d) { return d.time >= _renderR.from; });
        if (!vwapData.length) { _removeVwapSeries(period); callback(); return; }
        if (!vwapSeriesMap[period]) {
          vwapSeriesMap[period] = chart.addLineSeries({
            color: color, lineWidth: 1.5, priceLineVisible: false,
            lastValueVisible: true, crosshairMarkerVisible: false,
            title: label,
          });
        }
        var _lv = vwapData[vwapData.length - 1];
        if (_lv) vwapData.push({ time: Math.floor(Date.now() / 1000), value: _lv.value });
        vwapSeriesMap[period].setData(vwapData);
        callback();
      }

      if ((period === '1D' || period === '7D') && _lastCandles && _lastCandles.length) {
        _computeVwap(_lastCandles, function () {});
        return;
      }

      var needed = Math.max(Math.ceil(days * 1440 / (INTERVAL_MINUTES[fetchInterval] || 60)) + 10, 100);
      var url = '/api/market/klines?symbol=BTCUSDT&interval=' + fetchInterval + '&limit=' + needed;
      fetch(url)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) {
          if (data.error || !data.candles || !data.candles.length) { _removeVwapSeries(period); return; }
          _computeVwap(data.candles, function () {});
        })
        .catch(function () { _removeVwapSeries(period); });
    });
    if (_savedL) { try { chart.timeScale().setVisibleLogicalRange(_savedL); } catch(e) {} }
    else if (_savedR) { try { chart.timeScale().setVisibleRange(_savedR); } catch(e) {} }
  }

  // ── TIMER ──

  function _startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    // Petit delai pour laisser LWC finir son rendu initial
    setTimeout(function () {
    function tick() {
      if (!countdownPriceLine) { _updateCountdownLabel('—'); return; }
      if (!lastCandleTime) { _updateCountdownLabel('—'); return; }
      var now = Date.now();
      var ms = _getIntervalMs(currentInterval);
      var elapsed = now - lastCandleTime;
      var remaining = ms - elapsed;
      if (remaining <= 0) {
        _updateCountdownLabel('0:00');
        if (countdownTimer) clearInterval(countdownTimer);
        countdownTimer = null;
        _fetchAndRender(true);
        return;
      }
      var totalSec = Math.ceil(remaining / 1000);
      var m = Math.floor(totalSec / 60);
      var s = totalSec % 60;
      _updateCountdownLabel(m + ':' + (s < 10 ? '0' : '') + s);
    }
    tick();
    countdownTimer = setInterval(tick, 500);
    }, 300);
  }

  function _updateCountdownLabel(timerTxt) {
    if (!countdownPriceLine || !chart) return;
    if (timerTxt === undefined) timerTxt = '—';
    try { countdownPriceLine.applyOptions({ title: timerTxt }); } catch(e) {}
  }

  // ── NETWORK ──

  var refreshTimer = null;
  var currentSymbol = 'btcusdt';
  var ws = null;
  var wsReconnectTimer = null;
  var _wsIntentionalClose = false;

  function _connectWs() {
    if (ws && ws.readyState === WebSocket.CONNECTING) return;
    if (ws) { _wsIntentionalClose = true; try { ws.close(); } catch(e) {} _wsIntentionalClose = false; }
    var stream = currentSymbol + '@kline_' + currentInterval;
    var url = 'wss://stream.binance.com:9443/ws/' + stream;
    try {
      ws = new WebSocket(url);
      ws.onopen = function() { _hideWsError(); };
      ws.onmessage = function (msg) {
        try {
          var d = JSON.parse(msg.data);
          var k = d && d.k;
          if (!k) return;
          var candle = {
            time: Math.floor(k.t / 1000),
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
          };
          var priceEl = document.getElementById('btcChartPrice');
          if (priceEl) priceEl.textContent = '$' + candle.close.toLocaleString('fr-FR', { minimumFractionDigits: 2 });
          lastCandleTime = k.t;
          if (k.x) { _fetchAndRender(true); return; }
          if (series) {
            try { series.update(candle); } catch(e) {}
          }
          if (countdownPriceLine) {
            try { countdownPriceLine.applyOptions({ price: candle.close }); } catch(e) {}
          }
        } catch(e) {}
      };
      ws.onclose = function () {
        if (_wsIntentionalClose) return;
        if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
        wsReconnectTimer = setTimeout(_connectWs, 3000);
        _showWsError();
      };
      ws.onerror = function() { _showWsError(); };
    } catch(e) { console.error('[btc-chart] ws:', e); }
  }

  function _showWsError() {
    var el = document.getElementById("btcChartWsStatus");
    if (el) { el.textContent = "Reconnexion..."; el.className = "btc-chart-ws-error visible"; }
  }
  function _hideWsError() {
    var el = document.getElementById("btcChartWsStatus");
    if (el) { el.className = "btc-chart-ws-error"; }
  }
  function _disconnectWs() {
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    if (ws) {
      if (ws.readyState === WebSocket.CONNECTING) { ws = null; return; }
      _wsIntentionalClose = true; try { ws.close(); } catch(e) {} ws = null; _wsIntentionalClose = false;
    }
  }

  function _startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    var ms = _getIntervalMs(currentInterval);
    var interval = ms < 3600000 ? 15000 : ms < 14400000 ? 30000 : 60000;
    refreshTimer = setInterval(function () {
      if (!lastCandleTime) return;
      var now = Date.now();
      var elapsed = now - lastCandleTime;
      if (elapsed < _getIntervalMs(currentInterval) * 0.95) {
        _fetchAndRender(true);
      }
    }, interval);
  }

  // ── CHART ──

  function initBtcChart() {
    var container = document.getElementById('btcChartContainer');
    if (!container) {
      if (document.querySelector('.page[data-page="today"].active')) {
        setTimeout(initBtcChart, 300);
      }
      return;
    }
    if (chartReady) return;
    if (container.clientHeight < 50) {
      container.style.minHeight = '320px';
    }
    loadLibrary(container);
  }

  function loadLibrary(container) {
    if (typeof window.LightweightCharts !== 'undefined') {
      _createChart(container);
      _fetchAndRender();
      return;
    }
    var urls = [
      'https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js',
      'https://cdn.jsdelivr.net/npm/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js',
      'https://cdnjs.cloudflare.com/ajax/libs/lightweight-charts/4.1.3/lightweight-charts.standalone.production.js',
    ];
    function tryCdn(idx) {
      if (idx >= urls.length) {
        console.error('[btc-chart] aucun CDN disponible');
        container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">Impossible de charger le graphique (CDN bloque)</div>';
        return;
      }
      var script = document.createElement('script');
      script.src = urls[idx];
      script.onload = function () {
        _createChart(container);
        _fetchAndRender();
      };
      script.onerror = function () { tryCdn(idx + 1); };
      document.head.appendChild(script);
    }
    tryCdn(0);
  }

  function _createChart(container) {
    if (chartReady) return;
    chartReady = true;
    if (!container || !container.parentElement) return;

    var isLight = document.body.classList.contains('light-mode');
    var w = container.clientWidth || 600;
    var h = container.clientHeight || 360;

    try {
      chart = window.LightweightCharts.createChart(container, {
        width: w,
        height: Math.max(240, h),
        layout: {
          background: { type: 'solid', color: 'transparent' },
          textColor: isLight ? '#1e293b' : '#d1d5db',
        },
        grid: {
          vertLines: { color: 'transparent' },
          horzLines: { color: 'transparent' },
        },
        crosshair: { mode: 0 },
        rightPriceScale: {
          borderColor: isLight ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)',
          borderVisible: false,
        },
        timeScale: {
          borderColor: isLight ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)',
          timeVisible: true,
          secondsVisible: false,
        },
        handleScroll: { vertTouchDrag: true, horzTouchDrag: true, pressedMouseMove: true },
      });

      series = chart.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderDownColor: '#ef4444',
        borderUpColor: '#22c55e',
        wickDownColor: '#ef4444',
        wickUpColor: '#22c55e',
        lastValueVisible: false,
        priceLineVisible: false,
      });

      countdownPriceLine = series.createPriceLine({
        price: 0,
        color: '#22c55e',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: '—',
      });

      if (resizeObserver) resizeObserver.disconnect();
      resizeObserver = new ResizeObserver(function () {
        if (chart && container) {
          var cw = container.clientWidth;
          var ch = Math.max(240, container.clientHeight || 360);
          if (cw > 0 && ch > 0) chart.applyOptions({ width: cw, height: ch });
        }
      });
      resizeObserver.observe(container);

      // Interval buttons
      document.querySelectorAll('.btc-chart-interval').forEach(function (btn) {
        btn.addEventListener('click', function () {
          document.querySelectorAll('.btc-chart-interval').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          currentInterval = btn.dataset.interval;
          _disconnectWs();
          var ci = document.getElementById('btcChartCustom');
          if (ci) ci.value = '';
          _fetchAndRender();
        });
      });

      // Custom interval input
      var customInput = document.getElementById('btcChartCustom');
      if (customInput) {
        customInput.addEventListener('change', function () {
          var val = this.value.trim().toLowerCase();
          if (!/^\d+(m|h|d|w|M)$/.test(val)) {
            this.classList.add("jedit-field-error");
            this.title = "Format attendu: chiffre + m/h/d/w/M (ex: 45m, 4h, 7d)";
            return;
          }
          this.classList.remove("jedit-field-error");
          this.title = "";
          document.querySelectorAll('.btc-chart-interval').forEach(function (b) { b.classList.remove('active'); });
          currentInterval = val;
          _disconnectWs();
          _fetchAndRender();
        });
        customInput.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { this.blur(); }
        });
      }

    } catch (e) {
      console.error('[btc-chart] createChart error:', e);
      container.innerHTML = '<div class="chart-error-state">'
        + '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
        + '<div>Erreur graphique</div>'
        + '<span>Impossible de creer le graphique</span></div>';
    }
  }

  function _fetchAndRender(keepZoom) {
    if (!series) return;

    // Sauvegarder le zoom utilisateur avant refresh (en temps ET en logique)
    var savedRange = null;
    var savedLogical = null;
    if (keepZoom && chart && chart.timeScale()) {
      try { savedRange = chart.timeScale().getVisibleRange(); } catch(e) {}
      try { savedLogical = chart.timeScale().getVisibleLogicalRange(); } catch(e) {}
      try { chart.priceScale('right').applyOptions({ autoScale: false }); } catch(e) {}
    }

    var url = '/api/market/klines?symbol=BTCUSDT&interval=' + currentInterval + '&limit=300';
    fetch(url)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        if (data.error) { console.error('[btc-chart]', data.error); toast(data.error, 'error'); return; }
        var candles = data.candles || [];
        if (!candles.length) { toast('Aucune donnee disponible pour ' + currentInterval, 'error'); return; }
        _lastCandles = candles;
        var last = candles[candles.length - 1];
        lastCandleTime = last.time * 1000;
        _startCountdown();
        _startAutoRefresh();
        _disconnectWs();
        _connectWs();
        var priceEl = document.getElementById('btcChartPrice');
        if (priceEl) priceEl.textContent = '$' + Number(last.close).toLocaleString('fr-FR', { minimumFractionDigits: 2 });
        series.setData(candles);

        // Indicators
        _renderIndicators(candles);

        // VWAP
        _calcAndDrawVwap();

        if (countdownPriceLine) {
          try { countdownPriceLine.applyOptions({ price: last.close }); } catch(e) {}
        }
        _updateCountdownLabel();
        if (!keepZoom) {
          var total = candles.length;
          var to = total;
          var from = Math.max(0, total - 80);
          try { chart.timeScale().setVisibleLogicalRange({ from: from, to: to }); } catch(e) { chart.timeScale().fitContent(); }
          setTimeout(function() {
            try { chart.priceScale('right').applyOptions({ autoScale: false }); } catch(e) {}
          }, 50);
        }

        // Restaurer le zoom utilisateur apres setData (logique d'abord, temps en fallback)
        if (keepZoom) {
          if (savedLogical) {
            try { chart.timeScale().setVisibleLogicalRange(savedLogical); } catch(e) {}
          } else if (savedRange) {
            try { chart.timeScale().setVisibleRange(savedRange); } catch(e) {}
          }
          try { chart.priceScale('right').applyOptions({ autoScale: false }); } catch(e) {}
        }
      })
      .catch(function (err) {
        console.error('[btc-chart] fetch:', err);
        var container = document.getElementById('btcChartContainer');
        if (container && !chartReady) {
          container.innerHTML = '<div class="chart-error-state">'
            + '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
            + '<div>Marche indisponible</div>'
            + '<span>API Binance injoignable</span></div>';
        }
      });
  }

  // ── INIT ──

  function _waitForContainer(callback, maxRetries, interval) {
    maxRetries = maxRetries || 20;
    interval = interval || 50;
    var retries = 0;
    function poll() {
      if (document.getElementById('btcChartContainer')) {
        callback();
        return;
      }
      retries++;
      if (retries >= maxRetries) {
        console.warn('[btc-chart] #btcChartContainer introuvable apres ' + (maxRetries * interval) + 'ms');
        return;
      }
      setTimeout(poll, interval);
    }
    poll();
  }

  function _tryInit() {
    if (chartReady) return;
    _waitForContainer(initBtcChart);
  }

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(_tryInit, 50);
  });

  var _origGoPage = window.goPage;
  if (_origGoPage) {
    window.goPage = function (pageName) {
      _origGoPage(pageName);
      if (pageName === 'today') _waitForContainer(initBtcChart);
    };
  }

  window.initBtcChart = initBtcChart;
})();

// ---- 062_chart_page.js ----
// ---------- Chart page — TradingView Lightweight Charts XXL ----------
// v2.0 — Indicators: SMA, EMA, Bollinger, RSI + Settings panel

(function () {
  var chart = null;
  var candlestickSeries = null;
  var volumeSeries = null;

  // Indicator series
  var indicatorSeries = {};
  var rsiSeries = null;
  var rsiPaneId = 'rsi_pane';

  // VWAP (multi-periode)
  var vwapSeriesMap = {};
  var activeVwapPeriods = [];
  try {
    var savedVwap = JSON.parse(localStorage.getItem('chartVwapPeriods'));
    if (Array.isArray(savedVwap)) activeVwapPeriods = savedVwap;
  } catch(e) {}
  var VWAP_COLORS = { '1D': '#f59e0b', '7D': '#06b6d4', '30D': '#a78bfa', '90D': '#f472b6' };
  var VWAP_INTERVALS = { '1D': '1h', '7D': '1h', '30D': '4h', '90D': '1d' };
  var VWAP_DAYS = { '1D': 1, '7D': 7, '30D': 30, '90D': 90 };

  // State
  var countdownPriceLine = null;
  var currentInterval = localStorage.getItem('chartDefInterval') || '3m';
  var currentSymbol = localStorage.getItem('chartDefSymbol') || 'BTCUSDT';
  var chartStyle = localStorage.getItem('chartDefStyle') || 'candlestick';
  var countdownTimer = null;
  var lastCandleTime = 0;
  var lastPrice = 0;
  var resizeObserver = null;
  var refreshTimer = null;
  var ws = null;
  var wsReconnectTimer = null;
  var _wsIntentionalClose = false;
  var _lastCandles = null; // dernieres bougies fetchees (pour VWAP 1D/7D temps reel)

  // Settings state
  var indSettings = {
    sma: { active: false, period: 20, color: '#f59e0b' },
    ema: { active: false, period: 20, color: '#06b6d4' },
    boll: { active: false, period: 20, color: '#a78bfa' },
    rsi: { active: false, period: 14, color: '#f472b6' },
  };

  // Load saved settings
  try {
    var savedInd = JSON.parse(localStorage.getItem('chartIndSettings'));
    if (savedInd) {
      Object.keys(savedInd).forEach(function (k) {
        if (indSettings[k]) Object.assign(indSettings[k], savedInd[k]);
      });
    }
  } catch(e) {}

  var INTERVAL_MS = {
    '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000,
    '30m': 1800000, '1h': 3600000, '2h': 7200000, '4h': 14400000,
    '6h': 21600000, '8h': 28800000, '12h': 43200000,
    '1d': 86400000, '3d': 259200000, '1w': 604800000, '1M': 2592000000,
  };

  var PAIR_NAMES = { 'BTCUSDT': 'BTC/USDT', 'ETHUSDT': 'ETH/USDT' };
  function getPairName(s) { return PAIR_NAMES[s] || s; }

  // ── INDICATOR CALCULATIONS ──

  function calcSMA(candles, period) {
    var result = [], sum = 0;
    for (var i = 0; i < candles.length; i++) {
      sum += candles[i].close;
      if (i >= period) sum -= candles[i - period].close;
      if (i >= period - 1) result.push({ time: candles[i].time, value: sum / period });
    }
    return result;
  }

  function calcEMA(candles, period) {
    var result = [];
    var k = 2 / (period + 1);
    // Warmup : SMA des period premieres bougies
    var ema = 0;
    for (var w = 0; w < period; w++) ema += candles[w].close;
    ema /= period;
    for (var i = 0; i < candles.length; i++) {
      ema = (candles[i].close - ema) * k + ema;
      if (i >= period - 1) result.push({ time: candles[i].time, value: ema });
    }
    return result;
  }

  function calcBollinger(candles, period) {
    var smaData = calcSMA(candles, period);
    var result = [];
    for (var i = 0; i < smaData.length; i++) {
      var idx = i + period - 1;
      var sumSq = 0;
      for (var j = 0; j < period; j++) {
        var diff = candles[idx - j].close - smaData[i].value;
        sumSq += diff * diff;
      }
      var std = Math.sqrt(sumSq / period);
      result.push({
        time: smaData[i].time,
        middle: smaData[i].value,
        upper: smaData[i].value + 2 * std,
        lower: smaData[i].value - 2 * std,
      });
    }
    return result;
  }

  function calcRSI(candles, period) {
    if (candles.length < period + 1) return [];
    var gains = [], losses = [];
    for (var i = 1; i < candles.length; i++) {
      var diff = candles[i].close - candles[i - 1].close;
      gains.push(diff > 0 ? diff : 0);
      losses.push(diff < 0 ? -diff : 0);
    }
    var avgGain = 0, avgLoss = 0;
    for (var j = 0; j < period; j++) {
      avgGain += gains[j];
      avgLoss += losses[j];
    }
    avgGain /= period;
    avgLoss /= period;

    var result = [];
    // First RSI starts at index 'period' in gains/losses (candle index = period)
    var rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push({ time: candles[period].time, value: 100 - (100 / (1 + rs)) });

    for (var k = period; k < gains.length; k++) {
      avgGain = (avgGain * (period - 1) + gains[k]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[k]) / period;
      rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      result.push({ time: candles[k + 1].time, value: 100 - (100 / (1 + rs)) });
    }
    return result;
  }

  function _clearIndicators() {
    if (!chart) return;
    Object.keys(indicatorSeries).forEach(function (key) {
      try { chart.removeSeries(indicatorSeries[key]); } catch(e) {}
    });
    indicatorSeries = {};
    if (rsiSeries) {
      try { chart.removeSeries(rsiSeries); } catch(e) {}
      rsiSeries = null;
    }
  }

  function _renderIndicators(candles) {
    _clearIndicators();
    if (!chart || !candles || !candles.length) return;

    var s = indSettings;

    // SMA
    if (s.sma.active && candles.length >= s.sma.period) {
      var smaData = calcSMA(candles, s.sma.period);
      indicatorSeries.sma = chart.addLineSeries({
        color: s.sma.color, lineWidth: 1.5, priceLineVisible: false,
        lastValueVisible: true, crosshairMarkerVisible: false,
        title: 'SMA ' + s.sma.period,
      });
      indicatorSeries.sma.setData(smaData);
    }

    // EMA
    if (s.ema.active && candles.length >= s.ema.period) {
      var emaData = calcEMA(candles, s.ema.period);
      indicatorSeries.ema = chart.addLineSeries({
        color: s.ema.color, lineWidth: 1.5, priceLineVisible: false,
        lastValueVisible: true, crosshairMarkerVisible: false,
        title: 'EMA ' + s.ema.period,
      });
      indicatorSeries.ema.setData(emaData);
    }

    // Bollinger Bands
    if (s.boll.active && candles.length >= s.boll.period) {
      var bollData = calcBollinger(candles, s.boll.period);
      indicatorSeries.bollMid = chart.addLineSeries({
        color: s.boll.color, lineWidth: 1, priceLineVisible: false,
        lastValueVisible: true, crosshairMarkerVisible: false,
        title: 'BB ' + s.boll.period,
      });
      indicatorSeries.bollUpper = chart.addLineSeries({
        color: s.boll.color, lineWidth: 1, priceLineVisible: false,
        lastValueVisible: false, crosshairMarkerVisible: false,
        lineStyle: 2, // dashed
      });
      indicatorSeries.bollLower = chart.addLineSeries({
        color: s.boll.color, lineWidth: 1, priceLineVisible: false,
        lastValueVisible: false, crosshairMarkerVisible: false,
        lineStyle: 2,
      });
      indicatorSeries.bollMid.setData(bollData.map(function (d) { return { time: d.time, value: d.middle }; }));
      indicatorSeries.bollUpper.setData(bollData.map(function (d) { return { time: d.time, value: d.upper }; }));
      indicatorSeries.bollLower.setData(bollData.map(function (d) { return { time: d.time, value: d.lower }; }));
    }

    // RSI (separate pane)
    if (s.rsi.active && candles.length >= s.rsi.period + 1) {
      try {
        rsiSeries = chart.addLineSeries({
          color: s.rsi.color, lineWidth: 1.5, priceLineVisible: false,
          lastValueVisible: true, crosshairMarkerVisible: false,
          priceScaleId: rsiPaneId,
          title: 'RSI ' + s.rsi.period,
        });
        chart.priceScale(rsiPaneId).applyOptions({
          scaleMargins: { top: 0.7, bottom: 0 },
          visible: true,
        });
        var rsiData = calcRSI(candles, s.rsi.period);
        rsiSeries.setData(rsiData);
      } catch(e) {
        console.error('[chart] RSI pane error:', e);
      }
    }
  }

  // ── WEBSOCKET ──

  function _connectWs() {
    if (ws && ws.readyState === WebSocket.CONNECTING) return;
    if (ws) { _wsIntentionalClose = true; try { ws.close(); } catch(e) {} _wsIntentionalClose = false; }
    var stream = currentSymbol.toLowerCase() + '@kline_' + currentInterval;
    var url = 'wss://stream.binance.com:9443/ws/' + stream;
    try {
      ws = new WebSocket(url);
      ws.onmessage = function (msg) {
        try {
          var d = JSON.parse(msg.data);
          var k = d && d.k;
          if (!k) return;
          var candle = {
            time: Math.floor(k.t / 1000),
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
          };
          lastPrice = candle.close;
          var priceEl = document.getElementById('chartPrice');
          if (priceEl) priceEl.textContent = '$' + candle.close.toLocaleString('fr-FR', { minimumFractionDigits: 2 });
          lastCandleTime = k.t;
          if (k.x) { _fetchAndRender(true); return; }
          if (candlestickSeries) {
            try {
              if (chartStyle === 'candlestick') {
                candlestickSeries.update(candle);
              } else {
                candlestickSeries.update({ time: candle.time, value: candle.close });
              }
            } catch(e) {}
            if (volumeSeries) {
              try { volumeSeries.update({ time: candle.time, value: candle.volume, color: candle.close >= candle.open ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)' }); } catch(e) {}
            }
          }
          if (countdownPriceLine) {
            try { countdownPriceLine.applyOptions({ price: candle.close }); } catch(e) {}
          }
        } catch(e) {}
      };
      ws.onclose = function () {
        if (_wsIntentionalClose) return;
        if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
        wsReconnectTimer = setTimeout(_connectWs, 3000);
      };
      ws.onerror = function() {};
    } catch(e) { console.error('[chart] ws:', e); }
  }

  function _disconnectWs() {
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    if (ws) {
      if (ws.readyState === WebSocket.CONNECTING) { ws = null; return; }
      _wsIntentionalClose = true; try { ws.close(); } catch(e) {} ws = null; _wsIntentionalClose = false;
    }
  }

  function _getIntervalMs(interval) {
    var m = INTERVAL_MS[interval];
    if (m) return m;
    var match = interval.match(/^(\d+)(m|h|d|w|M)$/);
    if (!match) return 3600000;
    var num = parseInt(match[1], 10);
    var unit = match[2];
    var mult = { m: 60000, h: 3600000, d: 86400000, w: 604800000, M: 2592000000 };
    return num * (mult[unit] || 3600000);
  }

  function _loadLibrary(cb) {
    if (typeof window.LightweightCharts !== 'undefined') { cb(); return; }
    var urls = [
      'https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js',
      'https://cdn.jsdelivr.net/npm/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js',
    ];
    function tryCdn(idx) {
      if (idx >= urls.length) { console.error('[chart] CDN indisponible'); return; }
      var s = document.createElement('script');
      s.src = urls[idx];
      s.onload = cb;
      s.onerror = function () { tryCdn(idx + 1); };
      document.head.appendChild(s);
    }
    tryCdn(0);
  }

  function initChartPage() {
    var container = document.getElementById('chartCanvas');
    if (!container) return;
    if (chart) {
      // Nettoyer avant refresh : WebSocket, timers, drawings
      _disconnectWs();
      if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
      if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
      _fetchAndRender(true);
      return;
    }

    _loadLibrary(function () {
      _createChart(container);
      _fetchAndRender();
    });
  }

  function _createChart(container) {
    if (chart) return;
    var wrap = document.getElementById('chartCanvasWrap');
    if (!wrap) return;

    var isLight = document.body.classList.contains('light-mode');
    var w = container.clientWidth || wrap.clientWidth || 900;
    var h = container.clientHeight || wrap.clientHeight || 500;

    try {
      chart = window.LightweightCharts.createChart(container, {
        width: w,
        height: h,
        layout: {
          background: { type: 'solid', color: 'transparent' },
          textColor: isLight ? '#1e293b' : '#9ca3af',
          fontSize: 11,
        },
        grid: {
          vertLines: { color: 'transparent' },
          horzLines: { color: 'transparent' },
        },
        crosshair: { mode: 0 },
        rightPriceScale: {
          borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)',
          borderVisible: false,
        },
        timeScale: {
          borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)',
          timeVisible: true,
          secondsVisible: false,
          borderVisible: false,
        },
        handleScroll: { vertTouchDrag: true, horzTouchDrag: true, pressedMouseMove: true },
      });

      // Candlestick series
      var seriesOpts = {
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderDownColor: '#ef4444',
        borderUpColor: '#22c55e',
        wickDownColor: '#ef4444',
        wickUpColor: '#22c55e',
        lastValueVisible: false,
        priceLineVisible: false,
      };

      // Handle chart style
      if (chartStyle === 'line') {
        candlestickSeries = chart.addLineSeries({
          color: '#22c55e',
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
        });
      } else if (chartStyle === 'area') {
        candlestickSeries = chart.addAreaSeries({
          lineColor: '#22c55e',
          topColor: 'rgba(34,197,94,0.3)',
          bottomColor: 'rgba(34,197,94,0.02)',
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
        });
      } else {
        candlestickSeries = chart.addCandlestickSeries(seriesOpts);
      }

      // Price line + countdown
      countdownPriceLine = candlestickSeries.createPriceLine({
        price: 0,
        color: '#22c55e',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: '—',
      });

      // Volume
      volumeSeries = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.85, bottom: 0 },
      });

      // Resize
      if (resizeObserver) resizeObserver.disconnect();
      resizeObserver = new ResizeObserver(function () {
        if (chart && wrap) {
          var cw = container.clientWidth || wrap.clientWidth;
          var ch = container.clientHeight || wrap.clientHeight;
          if (cw > 0 && ch > 0) chart.applyOptions({ width: cw, height: ch });
          if (window.ChartDrawings && window.ChartDrawings.onResize) {
            window.ChartDrawings.onResize();
          }
        }
      });
      resizeObserver.observe(wrap);

      // ── BIND UI EVENTS ──

      _bindVpDropdown();
      _bindVwap();
      _bindTimeframes();
      _bindPairs();
      _bindSettingsPanel();

      // ── DRAWING TOOLS ──
      _initDrawingTools();

      // ── VOLUME PROFILE ──
      _initVolumeProfile();

    } catch (e) {
      console.error('[chart] createChart error:', e);
    }
  }

  // ── DRAWING TOOLS ──

  function _initDrawingTools() {
    var wrap = document.getElementById('chartCanvasWrap');
    if (!wrap || !window.ChartDrawings) return;

    // Create toolbar buttons
    var toolbar = document.getElementById('drawToolbar');
    if (!toolbar) return;

    var tools = window.ChartDrawings.tools;
    toolbar.innerHTML = '';
    tools.forEach(function (t) {
      var btn = document.createElement('button');
      btn.type = 'button';
      if (t.id === 'cursor') {
        // Cursor = toggle snap: 🧲 = snap actif (OHLC), ⊹ = curseur libre
        btn.className = 'draw-toolbar-btn is-active' + (!window.ChartDrawings.getSnapEnabled() ? ' draw-snap-on' : '');
        btn.dataset.tool = 'cursor';
        btn.dataset.label = !window.ChartDrawings.getSnapEnabled() ? 'Snap ON' : 'Curseur';
        btn.textContent = !window.ChartDrawings.getSnapEnabled() ? '🧲' : '⊹';
        btn.addEventListener('click', function () {
          var snapOn = !window.ChartDrawings.getSnapEnabled();
          window.ChartDrawings.setSnapEnabled(snapOn);
          btn.textContent = !snapOn ? '🧲' : '⊹';
          btn.dataset.label = !snapOn ? 'Snap ON' : 'Curseur';
          btn.classList.toggle('draw-snap-on', !snapOn);
          // Sync LWC crosshair mode avec snap
          try { chart.applyOptions({ crosshair: { mode: snapOn ? 0 : 1 } }); } catch(e) {}
          // Toujours passer en mode curseur
          toolbar.querySelectorAll('.draw-toolbar-btn').forEach(function (b) { b.classList.remove('is-active'); });
          btn.classList.add('is-active');
          window.ChartDrawings.setTool('cursor');
        });
      } else {
        btn.className = 'draw-toolbar-btn';
        btn.dataset.tool = t.id;
        btn.dataset.label = t.label;
        btn.textContent = t.icon;
        btn.addEventListener('click', function () {
          toolbar.querySelectorAll('.draw-toolbar-btn').forEach(function (b) { b.classList.remove('is-active'); });
          btn.classList.add('is-active');
          window.ChartDrawings.setTool(t.id);
        });
      }
      toolbar.appendChild(btn);
    });

    // Clear button
    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'draw-toolbar-btn draw-clear';
    clearBtn.dataset.label = 'Tout effacer';
    clearBtn.textContent = '✕';
    clearBtn.addEventListener('click', function () {
      if (confirm('Effacer tous les dessins ?')) {
        window.ChartDrawings.clearAll();
      }
    });
    toolbar.appendChild(clearBtn);

    // Init drawing engine
    var isLight = document.body.classList.contains('light-mode');
    window.ChartDrawings.init(chart, candlestickSeries, wrap, isLight);
  }

  // ── VOLUME PROFILE ──

  function _initVolumeProfile() {
    var wrap = document.getElementById('chartCanvasWrap');
    if (!wrap || !window.VolumeProfile) return;
    window.VolumeProfile.init(chart, candlestickSeries, wrap);
  }

  // ── VWAP ──

  function _bindVpDropdown() {
    var toggle = document.getElementById('vpToggle');
    var dropdown = document.getElementById('vpDropdown');
    if (!toggle || !dropdown) return;
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
      var panel = document.getElementById('chartSettingsPanel');
      if (panel) panel.classList.add('hidden');
      var vwap = document.getElementById('vwapDropdown');
      if (vwap) vwap.classList.add('hidden');
      // Sync UI from VP state
      if (!dropdown.classList.contains('hidden')) {
        var s = window.VolumeProfile ? window.VolumeProfile.getSettings() : null;
        if (s) {
          document.getElementById('vpActive').checked = !!s.active;
          toggle.classList.toggle('active', !!s.active);
          document.getElementById('vpBucketSize').value = s.bucketSize;
          document.getElementById('vpPeriod').value = s.period;
          document.getElementById('vpVaPercent').value = s.vaPercent;
          document.getElementById('vpShowPOC').checked = !!s.showPOC;
          document.getElementById('vpShowVAH').checked = !!s.showVAH;
          document.getElementById('vpShowVAL').checked = !!s.showVAL;
          if (document.getElementById('vpColorPOC')) document.getElementById('vpColorPOC').value = s.colorPOC;
          if (document.getElementById('vpColorVAH')) document.getElementById('vpColorVAH').value = s.colorVAH;
          if (document.getElementById('vpColorVAL')) document.getElementById('vpColorVAL').value = s.colorVAL;
          if (document.getElementById('vpColorHvn')) document.getElementById('vpColorHvn').value = s.colorHvn;
        }
      }
    });
    document.addEventListener('click', function (e) {
      if (!dropdown.contains(e.target) && e.target !== toggle) dropdown.classList.add('hidden');
    }, false);
    // Apply on change
    dropdown.addEventListener('change', function () {
      _readVpSettingsFromUI();
      // Sync toggle active state
      var active = document.getElementById('vpActive');
      toggle.classList.toggle('active', active && active.checked);
    });
    // Init toggle state from saved settings
    setTimeout(function () {
      var s = window.VolumeProfile ? window.VolumeProfile.getSettings() : null;
      if (s) toggle.classList.toggle('active', !!s.active);
    }, 100);
  }

  function _bindVwap() {
    var vwapToggle = document.getElementById('vwapToggle');
    var vwapDropdown = document.getElementById('vwapDropdown');
    if (!vwapToggle || !vwapDropdown) return;

    vwapToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      vwapDropdown.classList.toggle('hidden');
      // Close settings if open
      var panel = document.getElementById('chartSettingsPanel');
      if (panel) panel.classList.add('hidden');
    });
    document.addEventListener('click', function () { vwapDropdown.classList.add('hidden'); }, false);
    vwapDropdown.querySelectorAll('.chart-ind-opt').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var period = btn.dataset.vwap;
        btn.classList.toggle('active');
        var idx = activeVwapPeriods.indexOf(period);
        if (idx >= 0) { activeVwapPeriods.splice(idx, 1); }
        else { activeVwapPeriods.push(period); }
        vwapToggle.classList.toggle('active', activeVwapPeriods.length > 0);
        try { localStorage.setItem('chartVwapPeriods', JSON.stringify(activeVwapPeriods)); } catch(e) {}
        vwapDropdown.classList.add('hidden');
        _fetchAndRender(true);
      });
    });
    // Restaurer l'etat des boutons depuis activeVwapPeriods
    vwapDropdown.querySelectorAll('.chart-ind-opt').forEach(function (btn) {
      if (activeVwapPeriods.indexOf(btn.dataset.vwap) >= 0) btn.classList.add('active');
    });
    if (activeVwapPeriods.length > 0) vwapToggle.classList.add('active');
  }

  var VWAP_COLORS = { '1D': '#f59e0b', '7D': '#06b6d4', '30D': '#a78bfa', '90D': '#f472b6' };
  var VWAP_INTERVALS = { '1D': '1h', '7D': '1h', '30D': '4h', '90D': '1d' };
  var VWAP_DAYS = { '1D': 1, '7D': 7, '30D': 30, '90D': 90 };
  var INTERVAL_MINUTES = { '1m':1,'3m':3,'5m':5,'15m':15,'30m':30,'1h':60,'2h':120,'4h':240,'6h':360,'8h':480,'12h':720,'1d':1440,'3d':4320,'1w':10080,'1M':43200 };

  function _removeVwapSeries(key) {
    var s = vwapSeriesMap[key];
    if (s) { try { chart.removeSeries(s); } catch(e) {} delete vwapSeriesMap[key]; }
  }

  function _calcAndDrawVwap() {
    // Supprimer les series VWAP pour les periodes desactivees
    Object.keys(vwapSeriesMap).forEach(function (k) {
      if (activeVwapPeriods.indexOf(k) < 0) _removeVwapSeries(k);
    });
    if (!activeVwapPeriods.length) return;

    var _savedRange = null, _savedLogical = null;
    try { _savedRange = chart.timeScale().getVisibleRange(); } catch(e) {}
    try { _savedLogical = chart.timeScale().getVisibleLogicalRange(); } catch(e) {}

    activeVwapPeriods.forEach(function (period) {
      var days = VWAP_DAYS[period] || 1;
      var fetchInterval = VWAP_INTERVALS[period] || '1h';
      var color = VWAP_COLORS[period] || '#f59e0b';
      var label = 'VWAP ' + period + ' (' + fetchInterval + ')';

      // Helper: compute cumulative VWAP from candles
      function _computeVwap(candleArray, callback) {
        var now = Math.floor(Date.now() / 1000);
        var todayStart = Math.floor(now / 86400) * 86400;
        var cutoff = todayStart - (days - 1) * 86400;
        var cumTpv = 0, cumVol = 0;
        var vwapData = [];
        for (var i = 0; i < candleArray.length; i++) {
          var c = candleArray[i];
          if (c.time < cutoff) continue;
          var tp = (c.high + c.low + c.close) / 3;
          cumTpv += tp * c.volume;
          cumVol += c.volume;
          if (cumVol > 0) vwapData.push({ time: c.time, value: cumTpv / cumVol });
        }
        if (!vwapData.length) { _removeVwapSeries(period); callback(); return; }
        if (!vwapSeriesMap[period]) {
          vwapSeriesMap[period] = chart.addLineSeries({
            color: color, lineWidth: 1.5, priceLineVisible: false,
            lastValueVisible: true, crosshairMarkerVisible: false,
            title: label,
          });
        }
        var _lv = vwapData[vwapData.length - 1];
        if (_lv) vwapData.push({ time: Math.floor(Date.now() / 1000), value: _lv.value });
        vwapSeriesMap[period].setData(vwapData);
        callback();
      }

      // 1D et 7D : utiliser les bougies du chart (temps reel, fluide)
      if ((period === '1D' || period === '7D') && _lastCandles && _lastCandles.length) {
        _computeVwap(_lastCandles, function () {});
        return;
      }

      // 30D et 90D : fetch au bon intervalle
      var minPerCandle = INTERVAL_MINUTES[fetchInterval] || 60;
      var needed = Math.max(Math.ceil(days * 1440 / minPerCandle) + 10, 100);
      var url = '/api/market/klines?symbol=' + currentSymbol + '&interval=' + fetchInterval + '&limit=' + needed;
      fetch(url)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.error || !data.candles || !data.candles.length) {
            _removeVwapSeries(period);
            return;
          }
          _computeVwap(data.candles, function () {});
        })
        .catch(function () { _removeVwapSeries(period); });
    });

    // Restaurer le range visible
    if (_savedLogical) { try { chart.timeScale().setVisibleLogicalRange(_savedLogical); } catch(e) {} }
    else if (_savedRange) { try { chart.timeScale().setVisibleRange(_savedRange); } catch(e) {} }
  }

  // ── TIMEFRAMES ──

  function _bindTimeframes() {
    var btns = document.querySelectorAll('.chart-tf-btn');
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        btns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentInterval = btn.dataset.interval;
        _disconnectWs();
        _fetchAndRender();
      });
    });
    // Activer le bon bouton
    btns.forEach(function (b) {
      if (b.dataset.interval === currentInterval) b.classList.add('active');
    });
  }

  // ── PAIRS ──

  function _bindPairs() {
    document.querySelectorAll('.chart-pair-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.chart-pair-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentSymbol = btn.dataset.symbol;
        _disconnectWs();
        _fetchAndRender();
      });
    });
  }

  // ── SETTINGS PANEL ──

  function _bindSettingsPanel() {
    var btn = document.getElementById('chartSettingsBtn');
    var panel = document.getElementById('chartSettingsPanel');
    var close = document.getElementById('chartSettingsClose');
    var save = document.getElementById('chartSettingsSave');
    var reset = document.getElementById('chartSettingsReset');
    if (!btn || !panel) return;

    // Open / close
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      panel.classList.toggle('hidden');
      // Close VWAP if open
      var vwap = document.getElementById('vwapDropdown');
      if (vwap) vwap.classList.add('hidden');
      if (!panel.classList.contains('hidden')) {
        _syncSettingsUI();
      }
    });

    if (close) {
      close.addEventListener('click', function () { panel.classList.add('hidden'); });
    }

    document.addEventListener('click', function (e) {
      if (!panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        panel.classList.add('hidden');
      }
    });

    // Sync UI from state
    function _syncSettingsUI() {
      var s = indSettings;
      _setChecked('indSmaActive', s.sma.active);
      _setVal('indSmaPeriod', s.sma.period);
      _setColor('indSmaColor', s.sma.color);
      _setChecked('indEmaActive', s.ema.active);
      _setVal('indEmaPeriod', s.ema.period);
      _setColor('indEmaColor', s.ema.color);
      _setChecked('indBollActive', s.boll.active);
      _setVal('indBollPeriod', s.boll.period);
      _setColor('indBollColor', s.boll.color);
      _setChecked('indRsiActive', s.rsi.active);
      _setVal('indRsiPeriod', s.rsi.period);
      _setColor('indRsiColor', s.rsi.color);
      _setVal('chartDefInterval', currentInterval);
      _setVal('chartDefSymbol', currentSymbol);
      _setVal('chartDefStyle', chartStyle);
      _renderSessionControls();
    }

    // Render session zone controls dynamically
    function _renderSessionControls() {
      var container = document.getElementById('chartSessionControls');
      if (!container || !window.ChartDrawings) return;
      var sessions = window.ChartDrawings.getSessionSettings();
      if (!sessions || !sessions.length) return;

      container.innerHTML = '';
      sessions.forEach(function (sess) {
        var row = document.createElement('div');
        row.className = 'chart-settings-row';
        row.innerHTML =
          '<div class="chart-settings-label">' +
            '<span class="chart-session-dot" style="background:' + sess.color + '"></span> ' +
            '<span>' + sess.name + '</span>' +
            '<span class="chart-session-hours">' + sess.startHour + 'h–' + sess.endHour + 'h UTC</span>' +
          '</div>' +
          '<div class="chart-settings-controls">' +
            '<input type="color" class="chart-settings-color chart-session-color" data-sess-id="' + sess.id + '" value="' + sess.color + '">' +
            '<label class="chart-toggle">' +
              '<input type="checkbox" class="chart-session-active" data-sess-id="' + sess.id + '"' + (sess.active ? ' checked' : '') + '>' +
              '<span class="chart-toggle-track"><span class="chart-toggle-thumb"></span></span>' +
            '</label>' +
          '</div>';
        container.appendChild(row);
      });
    }

    // Read session settings from UI and push to drawing engine
    function _readSessionSettingsFromUI() {
      if (!window.ChartDrawings) return;
      var sessions = window.ChartDrawings.getSessionSettings();
      if (!sessions || !sessions.length) return;

      sessions.forEach(function (sess) {
        var cb = document.querySelector('.chart-session-active[data-sess-id="' + sess.id + '"]');
        if (cb) sess.active = cb.checked;
        var colorInput = document.querySelector('.chart-session-color[data-sess-id="' + sess.id + '"]');
        if (colorInput) sess.color = colorInput.value;
      });

      window.ChartDrawings.updateSessions(sessions);
    }

    function _setChecked(id, val) {
      var el = document.getElementById(id);
      if (el) el.checked = !!val;
    }
    function _setVal(id, val) {
      var el = document.getElementById(id);
      if (el) el.value = val;
    }
    function _setColor(id, val) {
      var el = document.getElementById(id);
      if (el) el.value = val;
    }

    // Save
    if (save) {
      save.addEventListener('click', function () {
        _readSettingsFromUI();
        _readSessionSettingsFromUI();
        _saveSettings();
        _applySettings();
        panel.classList.add('hidden');
        toast('Paramètres du chart sauvegardés', 'success');
      });
    }

    // Reset
    if (reset) {
      reset.addEventListener('click', function () {
        localStorage.removeItem('chartIndSettings');
        localStorage.removeItem('chartDefInterval');
        localStorage.removeItem('chartDefSymbol');
        localStorage.removeItem('chartDefStyle');
        localStorage.removeItem('chartSessionSettings');
        indSettings = {
          sma: { active: false, period: 20, color: '#f59e0b' },
          ema: { active: false, period: 20, color: '#06b6d4' },
          boll: { active: false, period: 20, color: '#a78bfa' },
          rsi: { active: false, period: 14, color: '#f472b6' },
        };
        currentInterval = '3m';
        currentSymbol = 'BTCUSDT';
        chartStyle = 'candlestick';
        _syncSettingsUI();
        _applySettings();
        // Reset sessions to defaults
        if (window.ChartDrawings) {
          var defaultSess = [
            { id: 'asian', name: 'Asie', startHour: 0, endHour: 8, color: '#ffdd00', active: true, opacity: 0.12 },
            { id: 'london', name: 'Londres', startHour: 8, endHour: 16, color: '#0066ff', active: true, opacity: 0.12 },
            { id: 'newyork', name: 'New York', startHour: 13, endHour: 22, color: '#ff0066', active: true, opacity: 0.12 },
          ];
          window.ChartDrawings.updateSessions(defaultSess);
        }
        // Reset VP
        localStorage.removeItem('chartVolumeProfileSettings');
        if (window.VolumeProfile) {
          window.VolumeProfile.init(chart, candlestickSeries, document.getElementById('chartCanvasWrap'));
        }
        panel.classList.add('hidden');
        toast('Paramètres réinitialisés', 'info');
      });
    }
  }

  function _readSettingsFromUI() {
    function _gv(id) {
      var el = document.getElementById(id);
      return el ? el.value : null;
    }
    function _gc(id) {
      var el = document.getElementById(id);
      return el ? el.checked : false;
    }

    indSettings.sma.active = _gc('indSmaActive');
    indSettings.sma.period = parseInt(_gv('indSmaPeriod')) || 20;
    indSettings.sma.color = _gv('indSmaColor') || '#f59e0b';
    indSettings.ema.active = _gc('indEmaActive');
    indSettings.ema.period = parseInt(_gv('indEmaPeriod')) || 20;
    indSettings.ema.color = _gv('indEmaColor') || '#06b6d4';
    indSettings.boll.active = _gc('indBollActive');
    indSettings.boll.period = parseInt(_gv('indBollPeriod')) || 20;
    indSettings.boll.color = _gv('indBollColor') || '#a78bfa';
    indSettings.rsi.active = _gc('indRsiActive');
    indSettings.rsi.period = parseInt(_gv('indRsiPeriod')) || 14;
    indSettings.rsi.color = _gv('indRsiColor') || '#f472b6';
    currentInterval = _gv('chartDefInterval') || currentInterval;
    currentSymbol = _gv('chartDefSymbol') || currentSymbol;
    chartStyle = _gv('chartDefStyle') || chartStyle;
  }

  function _readVpSettingsFromUI() {
    if (!window.VolumeProfile) return;
    var s = {};
    function gc(id) { var el = document.getElementById(id); return el ? el.checked : false; }
    function gv(id) { var el = document.getElementById(id); return el ? el.value : null; }
    s.active = gc('vpActive');
    s.bucketSize = parseInt(gv('vpBucketSize')) || 10;
    s.period = gv('vpPeriod') || 'visible';
    s.vaPercent = parseInt(gv('vpVaPercent')) || 70;
    s.showPOC = gc('vpShowPOC');
    s.showVAH = gc('vpShowVAH');
    s.showVAL = gc('vpShowVAL');
    s.colorPOC = gv('vpColorPOC') || '#f59e0b';
    s.colorVAH = gv('vpColorVAH') || '#22c55e';
    s.colorVAL = gv('vpColorVAL') || '#ef4444';
    s.colorHvn = gv('vpColorHvn') || '#06b6d4';
    window.VolumeProfile.updateSettings(s);
  }

  function _syncVpSettingsUI() {
    if (!window.VolumeProfile) return;
    var s = window.VolumeProfile.getSettings();
    function sc(id, val) { var el = document.getElementById(id); if (el) el.checked = !!val; }
    function sv(id, val) { var el = document.getElementById(id); if (el) el.value = val; }
    sc('vpActive', s.active);
    sv('vpBucketSize', s.bucketSize);
    sv('vpPeriod', s.period);
    sv('vpVaPercent', s.vaPercent);
    sc('vpShowPOC', s.showPOC);
    sc('vpShowVAH', s.showVAH);
    sc('vpShowVAL', s.showVAL);
    sv('vpColorPOC', s.colorPOC);
    sv('vpColorVAH', s.colorVAH);
    sv('vpColorVAL', s.colorVAL);
    sv('vpColorHvn', s.colorHvn);
  }

  function _saveSettings() {
    try {
      localStorage.setItem('chartIndSettings', JSON.stringify({
        sma: { active: indSettings.sma.active, period: indSettings.sma.period, color: indSettings.sma.color },
        ema: { active: indSettings.ema.active, period: indSettings.ema.period, color: indSettings.ema.color },
        boll: { active: indSettings.boll.active, period: indSettings.boll.period, color: indSettings.boll.color },
        rsi: { active: indSettings.rsi.active, period: indSettings.rsi.period, color: indSettings.rsi.color },
      }));
      localStorage.setItem('chartDefInterval', currentInterval);
      localStorage.setItem('chartDefSymbol', currentSymbol);
      localStorage.setItem('chartDefStyle', chartStyle);
      localStorage.setItem('chartVwapPeriods', JSON.stringify(activeVwapPeriods));
    } catch(e) {}
  }

  function _applySettings() {
    // Rebuild chart with new style if needed
    // For indicators, just re-render with current data
    if (chart) _fetchAndRender(true);
  }

  // ── FETCH & RENDER ──

  function _fetchAndRender(keepZoom) {
    if (!candlestickSeries) return;

    // Sauvegarder le zoom utilisateur avant refresh (en temps ET en logique)
    var savedRange = null;
    var savedLogical = null;
    if (keepZoom && chart && chart.timeScale()) {
      try { savedRange = chart.timeScale().getVisibleRange(); } catch(e) {}
      try { savedLogical = chart.timeScale().getVisibleLogicalRange(); } catch(e) {}
      // Freeze price scale BEFORE setData to prevent auto-jump on new candles
      try { chart.priceScale('right').applyOptions({ autoScale: false }); } catch(e) {}
    }

    var url = '/api/market/klines?symbol=' + currentSymbol + '&interval=' + currentInterval + '&limit=500';
    fetch(url)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        if (data.error) { console.error('[chart]', data.error); toast(data.error, 'error'); return; }
        var candles = data.candles || [];
        if (!candles.length) return;
        _lastCandles = candles;

        var last = candles[candles.length - 1];
        lastCandleTime = last.time * 1000;
        lastPrice = last.close;
        _startCountdown();
        _startAutoRefresh();
        _disconnectWs();
        _connectWs();
        _updateStats(candles);

        candlestickSeries.setData(chartStyle === 'candlestick' ? candles : candles.map(function (c) { return { time: c.time, value: c.close }; }));

        // VWAP
        _calcAndDrawVwap();

        // Volume Profile (passe les bougies pour recalcul)
        if (window.VolumeProfile) {
          window.VolumeProfile.setCandles(candles);
        }

        // Indicators
        _renderIndicators(candles);

        // Price line
        if (countdownPriceLine) {
          try { countdownPriceLine.applyOptions({ price: last.close }); } catch(e) {}
        }
        _updateCountdownLabel();

        volumeSeries.setData(candles.map(function (c) {
          return { time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)' };
        }));

        if (!keepZoom) {
          // Show last ~80 candles instead of ALL data (fitContent zooms too far out)
          var total = candles.length;
          var to = total;
          var from = Math.max(0, total - 80);
          try { chart.timeScale().setVisibleLogicalRange({ from: from, to: to }); } catch(e) { chart.timeScale().fitContent(); }
          // Unlock vertical scroll by disabling autoScale AFTER data is visible
          setTimeout(function() {
            try { chart.priceScale('right').applyOptions({ autoScale: false }); } catch(e) {}
          }, 50);
        }

        // Restaurer le zoom utilisateur apres setData (logique d'abord, temps en fallback)
        if (keepZoom) {
          // Le logical range est plus stable que le time range car base sur l'index
          if (savedLogical) {
            try { chart.timeScale().setVisibleLogicalRange(savedLogical); } catch(e) {}
          } else if (savedRange) {
            try { chart.timeScale().setVisibleRange(savedRange); } catch(e) {}
          }
          // Keep price scale unlocked for vertical scroll
          try { chart.priceScale('right').applyOptions({ autoScale: false }); } catch(e) {}
        }
      })
      .catch(function (err) { console.error('[chart] fetch error:', err); });
  }

  function _updateStats(candles) {
    if (!candles.length) return;
    var last = candles[candles.length - 1];
    var first = candles[0];
    var change = last.close - first.close;
    var changePct = (change / first.close) * 100;

    var priceEl = document.getElementById('chartPrice');
    if (priceEl) priceEl.textContent = '$' + Number(last.close).toLocaleString('fr-FR', { minimumFractionDigits: 2 });

    var changeEl = document.getElementById('chartChange');
    if (changeEl) {
      var sign = change >= 0 ? '+' : '';
      changeEl.textContent = sign + change.toFixed(2) + ' (' + sign + changePct.toFixed(2) + '%)';
      changeEl.style.color = change >= 0 ? 'var(--win)' : 'var(--loss)';
    }

    var setStat = function (id, val) {
      var el = document.getElementById(id);
      if (el) el.textContent = val != null ? Number(val).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) : '—';
    };
    setStat('chartOpen', last.open);
    setStat('chartHigh', last.high);
    setStat('chartLow', last.low);
    setStat('chartClose', last.close);
    setStat('chartVol', last.volume);
  }

  // ── COUNTDOWN ──
  function _startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    setTimeout(function () {
    function tick() {
      if (!lastCandleTime) { _updateCountdownLabel('—'); return; }
      var now = Date.now();
      var ms = _getIntervalMs(currentInterval);
      var elapsed = now - lastCandleTime;
      var remaining = ms - elapsed;
      if (remaining <= 0) {
        _updateCountdownLabel('0:00');
        if (countdownTimer) clearInterval(countdownTimer);
        countdownTimer = null;
        _fetchAndRender(true);
        return;
      }
      var totalSec = Math.ceil(remaining / 1000);
      var m = Math.floor(totalSec / 60);
      var s = totalSec % 60;
      var txt = m + ':' + (s < 10 ? '0' : '') + s;
      _updateCountdownLabel(txt);
    }
    tick();
    countdownTimer = setInterval(tick, 500);
    }, 300);
  }

  function _updateCountdownLabel(timerTxt) {
    if (!countdownPriceLine || !chart) return;
    if (timerTxt === undefined) timerTxt = '—';
    try { countdownPriceLine.applyOptions({ title: timerTxt }); } catch(e) {}
  }

  // ── AUTO REFRESH ──

  function _startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    var ms = _getIntervalMs(currentInterval);
    var interval = ms < 3600000 ? 15000 : ms < 14400000 ? 30000 : 60000;
    refreshTimer = setInterval(function () {
      if (!lastCandleTime) return;
      var now = Date.now();
      var elapsed = now - lastCandleTime;
      if (elapsed < _getIntervalMs(currentInterval) * 0.95) {
        _fetchAndRender(true);
      }
    }, interval);
  }

  // ── INIT ──

  // Polling robuste : attend que #chartCanvas soit dans le DOM avant de lancer le callback
  // maxRetries × interval ms (par défaut 20 × 50ms = 1s max)
  function _waitForContainer(callback, maxRetries, interval) {
    maxRetries = maxRetries || 20;
    interval = interval || 50;
    var retries = 0;
    function poll() {
      if (document.getElementById('chartCanvas')) {
        callback();
        return;
      }
      retries++;
      if (retries >= maxRetries) {
        console.warn('[chart] #chartCanvas introuvable apres ' + (maxRetries * interval) + 'ms');
        return;
      }
      setTimeout(poll, interval);
    }
    poll();
  }

  function _tryInit() {
    if (document.querySelector('.page[data-page="chart"].active')) {
      _waitForContainer(initChartPage);
    }
  }

  document.addEventListener('DOMContentLoaded', function () { setTimeout(_tryInit, 50); });

  // Hook dans goPage existante
  var _origGoPage = window.goPage;
  if (_origGoPage) {
    window.goPage = function (pageName) {
      _origGoPage(pageName);
      if (pageName === 'chart') {
        _waitForContainer(function () {
          initChartPage();
          _waitForContainer(function () {
            if (chart) {
              var wrap = document.getElementById('chartCanvasWrap');
              if (wrap) chart.applyOptions({ width: wrap.clientWidth, height: wrap.clientHeight });
            }
          }, 10, 100);
        });
      }
    };
  }

  window.initChartPage = initChartPage;
})();

// ---- 063_favorites_carousel.js ----
// ---------- Favorites Carousel Widget (reuses journal flip card) ----------
// Uses journalTradeFlipCardHtml() so recto/verso is identical to journal.

(function () {
  'use strict';

  var _trades       = [];
  var _currentIndex = 0;
  var _observer     = null;

  // ── Render / init ──────────────────────────────────────────
  function initFavCarousel() {
    var track   = document.getElementById('favCarouselTrack');
    var empty   = document.getElementById('favCarouselEmpty');
    var countEl = document.getElementById('favCarouselCount');
    if (!track) return;

    // Show skeleton
    track.innerHTML = '<div class="fav-skeleton"></div>';
    if (empty) empty.style.display = 'none';

    fetch('/api/trades/favorites')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        _trades = Array.isArray(data) ? data : [];
        _currentIndex = 0;
        track.innerHTML = '';

        if (_observer) { _observer.disconnect(); _observer = null; }

        if (_trades.length === 0) {
          if (empty)   { empty.style.display = ''; }
          if (countEl) { countEl.textContent = ''; }
          _updateDots(0);
          _updateArrows();
          return;
        }

        if (empty) empty.style.display = 'none';
        _updateCount();

        _trades.forEach(function (trade, i) {
          var day = {
            id: trade.day_id,
            instrument: trade.day_instrument || '-',
            date: trade.day_date || (trade.created_at ? trade.created_at.slice(0, 10) : ''),
          };

          var slide = document.createElement('div');
          slide.className = 'fav-carousel-slide';
          slide.dataset.index = i;

          if (typeof journalTradeFlipCardHtml === 'function') {
            slide.innerHTML = journalTradeFlipCardHtml(day, trade, i + 1, [trade]);
          }

          track.appendChild(slide);
        });

        _updateDots(_trades.length);
        _updateArrows();
        _setupObserver();
      })
      .catch(function (err) {
        console.error('[fav-carousel]', err);
        track.innerHTML = '';
        if (empty) empty.style.display = '';
        if (countEl) countEl.textContent = '';
        _updateDots(0);
        _updateArrows();
      });
  }

  // ── Navigation ───────────────────────────────────────────────
  function _goTo(idx, smooth) {
    if (idx < 0 || idx >= _trades.length) return;
    var track = document.getElementById('favCarouselTrack');
    if (!track) return;
    var slide = track.children[idx];
    if (!slide) return;
    slide.scrollIntoView({ behavior: smooth === false ? 'instant' : 'smooth', block: 'nearest', inline: 'start' });
    _currentIndex = idx;
    _updateDots(_trades.length);
    _updateArrows();
    _updateCount();
  }

  function _updateDots(count) {
    var el = document.getElementById('favCarouselDots');
    if (!el) return;
    if (count <= 1) { el.innerHTML = ''; return; }
    var html = '';
    for (var i = 0; i < count; i++) {
      html += '<button type="button" class="fav-carousel-dot' + (i === _currentIndex ? ' is-active' : '') +
              '" data-dot="' + i + '" aria-label="Trade ' + (i + 1) + '"></button>';
    }
    el.innerHTML = html;
  }

  function _updateArrows() {
    var left  = document.getElementById('favCarouselLeft');
    var right = document.getElementById('favCarouselRight');
    if (!left || !right) return;
    var n = _trades.length;
    left.style.display  = n > 1 ? '' : 'none';
    right.style.display = n > 1 ? '' : 'none';
    left.disabled  = _currentIndex <= 0;
    right.disabled = _currentIndex >= n - 1;
  }

  function _updateCount() {
    var el = document.getElementById('favCarouselCount');
    if (!el) return;
    if (_trades.length > 1) {
      el.textContent = (_currentIndex + 1) + ' / ' + _trades.length;
    } else if (_trades.length === 1) {
      el.textContent = '1 trade';
    } else {
      el.textContent = '';
    }
  }

  // ── Flip helpers (uses journal-flip-card class) ─────────────
  function _flipCard(card, toBack) {
    document.querySelectorAll('.journal-flip-card.is-flipped').forEach(function (c) {
      if (c !== card) c.classList.remove('is-flipped');
    });
    if (toBack === undefined) {
      card.classList.toggle('is-flipped');
    } else {
      card.classList.toggle('is-flipped', toBack);
    }
  }

  // ── Intersection observer ────────────────────────────────────
  function _setupObserver() {
    var track = document.getElementById('favCarouselTrack');
    if (!track) return;

    _observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          var idx = parseInt(e.target.dataset.index, 10);
          if (!isNaN(idx) && idx !== _currentIndex) {
            _currentIndex = idx;
            _updateDots(_trades.length);
            _updateArrows();
            _updateCount();
          }
        }
      });
    }, { root: track, threshold: 0.55 });

    Array.from(track.children).forEach(function (s) { _observer.observe(s); });
  }

  // ── Global delegated click handler ──────────────────────────
  document.addEventListener('click', function (e) {

    // Arrow left / right
    var left = e.target.closest('#favCarouselLeft');
    if (left) { e.preventDefault(); e.stopPropagation(); _goTo(_currentIndex - 1); return; }

    var right = e.target.closest('#favCarouselRight');
    if (right) { e.preventDefault(); e.stopPropagation(); _goTo(_currentIndex + 1); return; }

    // Dot
    var dot = e.target.closest('.fav-carousel-dot');
    if (dot) { _goTo(parseInt(dot.dataset.dot, 10)); return; }

    // Flip back (journal card uses data-journal-day-close or similar)
    var backBtn = e.target.closest('[data-journal-day-close]');
    if (backBtn) {
      e.stopPropagation();
      var card = backBtn.closest('.journal-flip-card');
      if (card) _flipCard(card, false);
      return;
    }

    // Flip card (click anywhere on journal-flip-card that isn't a button)
    var card = e.target.closest('.journal-flip-card');
    if (card) {
      if (e.target.closest('button, input, textarea, a, select, [data-journal-day-close]')) return;
      e.stopPropagation();
      _flipCard(card);
      return;
    }
  }, true); // useCapture = true to intercept before journal handler

  // ── Keyboard support ─────────────────────────────────────────
  document.addEventListener('keydown', function (e) {
    var focused = document.activeElement;
    if (!focused) return;

    var card = focused.closest('.journal-flip-card');
    if (card) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _flipCard(card); return; }
      if (e.key === 'Escape' && card.classList.contains('is-flipped')) { _flipCard(card, false); return; }
    }

    var wrap = document.getElementById('favCarouselWrap');
    if (wrap && (wrap.contains(focused) || wrap.matches(':hover'))) {
      if (e.key === 'ArrowLeft')  { _goTo(_currentIndex - 1); return; }
      if (e.key === 'ArrowRight') { _goTo(_currentIndex + 1); return; }
    }
  });

  // ── Swipe touch support ──────────────────────────────────────
  (function () {
    var startX = 0, startY = 0, isDragging = false;
    document.addEventListener('touchstart', function (e) {
      var wrap = e.target.closest('#favCarouselWrap');
      if (!wrap) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      isDragging = true;
    }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (!isDragging) return;
      isDragging = false;
      var dx = e.changedTouches[0].clientX - startX;
      var dy = e.changedTouches[0].clientY - startY;
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) {
        _goTo(dx < 0 ? _currentIndex + 1 : _currentIndex - 1);
      }
    }, { passive: true });
  })();

  // ── Boot hooks ───────────────────────────────────────────────
  function _waitForFavContainer(callback, maxRetries, interval) {
    maxRetries = maxRetries || 20;
    interval = interval || 50;
    var retries = 0;
    function poll() {
      if (document.getElementById('favCarouselTrack')) {
        callback();
        return;
      }
      retries++;
      if (retries >= maxRetries) { console.warn('[fav-carousel] container introuvable'); return; }
      setTimeout(poll, interval);
    }
    poll();
  }

  var _origGoPage = window.goPage;
  if (_origGoPage) {
    window.goPage = function (pageName) {
      _origGoPage(pageName);
      if (pageName === 'today') {
        _waitForFavContainer(initFavCarousel);
      }
    };
  }

  window.refreshFavCarousel = initFavCarousel;

  document.addEventListener('DOMContentLoaded', function () {
    if (document.querySelector('.page[data-page="today"].active')) {
      _waitForFavContainer(initFavCarousel);
    }
  });

})();

// ---- 064_chart_drawings.js ----
// ---------- Chart Drawing Engine v3 — Canvas Overlay ----------
// Tools: Box, Trend, Horizontal, Horizontal Ray, Vertical, Fibonacci, Text
// Features: opacity, fib level toggles, templates, colors, extends, text labels
// v3.2 — Session zones: Asian, London, New York time-based overlays

(function () {
  'use strict';

  var DRAW_TOOLS = [
    { id: 'cursor',        label: 'Curseur',      icon: '⊹' },
    { id: 'box',           label: 'Rectangle',     icon: '▭' },
    { id: 'trendline',     label: 'Trend line',    icon: '↗' },
    { id: 'horizontal',    label: 'Horizontale',   icon: '—' },
    { id: 'horizontalray', label: 'Rayon horiz.',  icon: '→' },
    { id: 'vertical',      label: 'Verticale',     icon: '│' },
    { id: 'fibonacci',     label: 'Fibonacci',     icon: 'ϕ' },
    { id: 'text',          label: 'Texte',          icon: 'T' },
  ];

  var LINE_WIDTHS = [1, 1.5, 2, 2.5, 3];
  var LINE_STYLES = [
    { id: 'solid',  label: '─', dash: [] },
    { id: 'dashed', label: '╌', dash: [6, 4] },
    { id: 'dotted', label: '┈', dash: [2, 4] },
  ];
  var TOOL_COLORS = ['#06b6d4', '#22c55e', '#f59e0b', '#ef4444', '#a78bfa', '#f472b6', '#fb923c', '#ffffff', '#9ca3af'];

  var FIB_LEVELS = [
    { key: 0,     label: '0',     color: '#9ca3af' },
    { key: 0.236, label: '23.6',  color: '#06b6d4' },
    { key: 0.382, label: '38.2',  color: '#22c55e' },
    { key: 0.5,   label: '50',    color: '#f59e0b' },
    { key: 0.618, label: '61.8',  color: '#ef4444' },
    { key: 1,     label: '100',   color: '#9ca3af' },
    { key: 2,     label: '200',   color: '#a78bfa' },
    { key: 2.5,   label: '250',   color: '#f472b6' },
    { key: 3,     label: '300',   color: '#fb923c' },
    { key: 4,     label: '400',   color: '#34d399' },
    { key: 4.5,   label: '450',   color: '#818cf8' },
    { key: 5,     label: '500',   color: '#e879f9' },
  ];
  // Default: all levels visible
  var DEFAULT_FIB_VISIBLE = {};
  FIB_LEVELS.forEach(function (l) { DEFAULT_FIB_VISIBLE[l.key] = true; });

  var STORAGE_KEY = 'chartDrawings';
  var TEMPLATE_KEY = 'chartDrawTemplates';
  var MAX_UNDO = 30;

  // ── SESSION PRESETS ──
  // Hours in UTC, startHour < endHour = within same day, startHour > endHour = spans midnight
  var SESSION_PRESETS = [
    { id: 'asian',     name: 'Asie',      startHour: 0,  endHour: 8,  color: '#ffdd00', active: true,  opacity: 0.12 },
    { id: 'london',    name: 'Londres',   startHour: 8,  endHour: 16, color: '#0066ff', active: true,  opacity: 0.12 },
    { id: 'newyork',   name: 'New York',  startHour: 13, endHour: 22, color: '#ff0066', active: true,  opacity: 0.12 },
  ];

  var SESSION_STORAGE_KEY = 'chartSessionSettings';
  // ── / SESSION PRESETS

  // ── STATE ──

  var state = {
    ctx: null, chart: null, series: null, container: null, canvas: null,
    drawings: [],
    undoStack: [],
    sessions: [], // session zone configs
    activeTool: 'cursor',
    isDrawing: false, dragStart: null, previewPoint: null,
    selectedIndex: -1, // -1 = none, >=0 = editing an existing drawing
    snapEnabled: false, // false = snap actif (OHLC) — cf. _snapPoint inverse
    _crosshairPos: null, // position souris pour crosshair canvas
    _drag: null, // drag state: { idx, startTime, startPrice, pointIdx }
    toolOptions: {
      color: '#06b6d4', fillColor: '#06b6d4', opacity: 0.3,
      lineWidth: 1.5, lineStyle: 'solid',
      extendLeft: false, extendRight: true,
      text: '', fibLevels: Object.assign({}, DEFAULT_FIB_VISIBLE),
    },
  };

  // ── INIT ──

  function initDrawings(chart, series, container) {
    state.chart = chart; state.series = series; state.container = container;
    _loadDrawings();
    _loadSessionSettings();
    _createCanvas();
    _bindEvents();
    _renderAll();
    _syncOptionsUI();
  }

  function destroyDrawings() {
    _stopRenderLoop();
    clearTimeout(_interactionTimeout);
    if (state.canvas) {
      state.canvas.removeEventListener('click', _onCanvasClick);
      state.canvas.removeEventListener('mousemove', _onMouseMove);
      state.canvas.removeEventListener('mouseleave', _onMouseLeave);
      state.canvas.removeEventListener('dblclick', _onDblClick);
      if (state.canvas.parentNode) state.canvas.parentNode.removeChild(state.canvas);
    }
    window.removeEventListener('resize', _onWindowResize);
    state.chart = null; state.series = null; state.container = null;
    state.ctx = null; state.canvas = null; state.drawings = []; state.undoStack = [];
  }

  // ── CANVAS ──

  function _createCanvas() {
    if (!state.container) return;
    state.canvas = document.createElement('canvas');
    state.canvas.className = 'draw-overlay';
    state.canvas.style.cssText = 'position:absolute;inset:0;z-index:10;pointer-events:none;width:100%;height:100%;';
    state.container.appendChild(state.canvas);
    state.ctx = state.canvas.getContext('2d');
    _resizeCanvas();
  }

  function _resizeCanvas() {
    var c = state.canvas; if (!c || !state.container) return;
    var pane = _getLwcPaneRect();
    var rect = pane || { left: 0, top: 0, width: state.container.clientWidth, height: state.container.clientHeight };
    var dpr = window.devicePixelRatio || 1;
    c.style.left = rect.left + 'px';
    c.style.top = rect.top + 'px';
    c.style.width = rect.width + 'px';
    c.style.height = rect.height + 'px';
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
    if (state.ctx) state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Trouve le rectangle du pane LWC interne (pas tout le container)
  function _getLwcPaneRect() {
    if (!state.container) return null;
    var containerRect = state.container.getBoundingClientRect();
    var canvases = Array.prototype.slice.call(
      state.container.querySelectorAll('canvas')
    ).filter(function (c) {
      return c !== state.canvas && !c.classList.contains('draw-overlay');
    });
    console.log('[draw] _getLwcPaneRect canvases found:', canvases.length, 'overlay:', !!state.canvas);
    if (!canvases.length) return null;
    var best = null, bestArea = 0;
    for (var i = 0; i < canvases.length; i++) {
      var r = canvases[i].getBoundingClientRect();
      var area = r.width * r.height;
      console.log('[draw] canvas', i, 'size:', r.width, 'x', r.height, 'area:', area);
      if (r.width > 100 && r.height > 100 && area > bestArea) {
        best = r; bestArea = area;
      }
    }
    if (!best) return null;
    var result = {
      left: best.left - containerRect.left,
      top: best.top - containerRect.top,
      width: best.width,
      height: best.height,
      absLeft: best.left,
      absTop: best.top,
    };
    console.log('[draw] pane rect:', JSON.stringify(result), 'container rect:', JSON.stringify({left: containerRect.left, top: containerRect.top, w: containerRect.width, h: containerRect.height}));
    return result;
  }

  // ── COORDINATES ──

  function _toPixel(time, price) {
    var x = state.chart.timeScale().timeToCoordinate(time);
    var y = state.series.priceToCoordinate(price);
    // Si timeToCoordinate echoue (temps au-dela des donnees), calculer via le ratio temps/pixel
    if (x == null && state.chart && state.chart.timeScale()) {
      try {
        var vr = state.chart.timeScale().getVisibleRange();
        if (vr && vr.from != null && vr.to != null) {
          var lx = state.chart.timeScale().timeToCoordinate(vr.from);
          var rx = state.chart.timeScale().timeToCoordinate(vr.to);
          if (lx != null && rx != null && rx !== lx) {
            // Inverser le calcul: (time - vr.from) * (pixels / time) + offset gauche
            var pxPerTime = (rx - lx) / (vr.to - vr.from);
            x = lx + (time - vr.from) * pxPerTime;
          }
        }
      } catch(e) {}
    }
    if (x == null || y == null) return null;
    return { x: x, y: y };
  }

  function _toTimePrice(clientX, clientY) {
    var pane = _getLwcPaneRect();
    var rect = pane
      ? { left: pane.absLeft, top: pane.absTop }
      : state.container.getBoundingClientRect();
    var x = clientX - rect.left;
    var y = clientY - rect.top;
    var tp = state.chart.timeScale().coordinateToTime(x);
    var pp = state.series.coordinateToPrice(y);
    if (pp == null) return null;
    // Si clic au-dela du temps visible (dans le futur/droite), prendre le bord droit de la time scale
    if (tp == null) {
      try {
        var vr = state.chart.timeScale().getVisibleRange();
        if (vr && vr.from != null && vr.to != null) {
          var lx = state.chart.timeScale().timeToCoordinate(vr.from);
          var rx = state.chart.timeScale().timeToCoordinate(vr.to);
          if (lx != null && rx != null && rx !== lx) {
            var timePerPx = (vr.to - vr.from) / (rx - lx);
            tp = vr.from + (x - lx) * timePerPx;
          }
        }
      } catch(e) {}
    }
    if (tp == null) return null;
    return { time: tp, price: pp };
  }

  // Snap un point {time, price} a la bougie la plus proche (OHLC)
  function _snapPoint(tp, clientX) {
    if (state.snapEnabled || !state.chart || !state.series || !state.container) return tp;
    try {
      var rect = state.container.getBoundingClientRect();
      var x = clientX - rect.left;
      var logical = state.chart.timeScale().coordinateToLogical(x);
      if (logical == null) return tp;
      var index = Math.round(logical);
      var candle = state.series.dataByIndex(index);
      if (!candle || typeof candle.high !== 'number' || typeof candle.time !== 'number') return tp;
      tp.time = candle.time;
      var candidates = [
        { val: candle.high,  dist: Math.abs(candle.high - tp.price) },
        { val: candle.low,   dist: Math.abs(candle.low - tp.price) },
        { val: candle.open,  dist: Math.abs(candle.open - tp.price) },
        { val: candle.close, dist: Math.abs(candle.close - tp.price) },
      ];
      candidates.sort(function (a, b) { return a.dist - b.dist; });
      tp.price = candidates[0].val;
    } catch(e) {
      console.warn('[drawings] snap error:', e);
    }
    return tp;
  }

  function _createDrawing(type, points) {
    var o = state.toolOptions;
    var d = {
      id: _uid(), type: type, points: points,
      color: o.color, fillColor: o.fillColor,
      lineWidth: o.lineWidth, lineStyle: o.lineStyle,
      opacity: o.opacity,
      extendLeft: o.extendLeft, extendRight: o.extendRight,
      text: o.text || '',
      fibLevels: type === 'fibonacci' ? Object.assign({}, o.fibLevels) : null,
      locked: false,
      createdAt: Date.now(),
    };
    return d;
  }

  function _uid() { return 'draw_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6); }

  // ── STORAGE ──

  function _saveDrawings() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.drawings)); } catch(e) {} }
  function _loadDrawings() {
    try { var r = localStorage.getItem(STORAGE_KEY); state.drawings = r ? JSON.parse(r) : []; } catch(e) { state.drawings = []; }
  }

  // ── SESSION ZONE STORAGE ──

  function _loadSessionSettings() {
    try {
      var r = localStorage.getItem(SESSION_STORAGE_KEY);
      if (r) {
        var saved = JSON.parse(r);
        // Merge with presets: keep saved if exists, fallback to preset defaults
        state.sessions = SESSION_PRESETS.map(function (preset) {
          var existing = null;
          for (var i = 0; i < saved.length; i++) {
            if (saved[i].id === preset.id) { existing = saved[i]; break; }
          }
          return existing ? Object.assign({}, preset, existing) : Object.assign({}, preset);
        });
      } else {
        state.sessions = SESSION_PRESETS.map(function (p) { return Object.assign({}, p); });
      }
    } catch(e) {
      state.sessions = SESSION_PRESETS.map(function (p) { return Object.assign({}, p); });
    }
  }

  function _saveSessionSettings() {
    try { localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state.sessions)); } catch(e) {}
  }

  function updateSessions(sessions) {
    state.sessions = sessions;
    _saveSessionSettings();
    _renderAll();
  }

  function getSessionSettings() { return state.sessions.slice(); }

  // ── / SESSION ZONE STORAGE

  // ── UNDO ──

  function _pushUndoState() {
    try {
      state.undoStack.push(JSON.stringify(state.drawings));
      if (state.undoStack.length > MAX_UNDO) state.undoStack.shift();
    } catch(e) {}
  }

  function undo() {
    if (!state.undoStack.length) return;
    try {
      state.drawings = JSON.parse(state.undoStack.pop());
      _saveDrawings();
      _renderAll();
    } catch(e) {}
  }

  // ── TEMPLATES ──

  function saveTemplate(name) {
    if (!name || !state.drawings.length) return;
    try {
      var templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY)) || {};
      templates[name] = { name: name, drawings: JSON.parse(JSON.stringify(state.drawings)), savedAt: Date.now() };
      localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
      return true;
    } catch(e) { return false; }
  }

  function loadTemplate(name) {
    try {
      var templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY)) || {};
      var t = templates[name];
      if (!t) return false;
      _pushUndoState();
      state.drawings = JSON.parse(JSON.stringify(t.drawings));
      _saveDrawings();
      _renderAll();
      return true;
    } catch(e) { return false; }
  }

  function listTemplates() {
    try {
      var templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY)) || {};
      var names = Object.keys(templates);
      names.sort(function (a, b) { return templates[b].savedAt - templates[a].savedAt; });
      return names.map(function (n) { return templates[n]; });
    } catch(e) { return []; }
  }

  function deleteTemplate(name) {
    try {
      var templates = JSON.parse(localStorage.getItem(TEMPLATE_KEY)) || {};
      delete templates[name];
      localStorage.setItem(TEMPLATE_KEY, JSON.stringify(templates));
    } catch(e) {}
  }

  // ── TOOL MANAGEMENT ──

  function setActiveTool(toolId) {
    state.selectedIndex = -1; // clear selection on tool change
    state.activeTool = toolId || 'cursor';
    state.isDrawing = false; state.dragStart = null; state.previewPoint = null; state._crosshairPos = null;
    if (toolId === 'horizontal' || toolId === 'horizontalray' || toolId === 'vertical') {
      state.toolOptions.extendLeft = false; state.toolOptions.extendRight = true;
    } else if (toolId === 'text') {
      state.toolOptions.text = '';
    }
    _updateCanvasPointer();
    _syncOptionsUI();
    _renderAll();
  }

  function getActiveTool() { return state.activeTool; }

  function _updateCanvasPointer() {
    if (!state.canvas) return;
    state.canvas.style.pointerEvents = state.activeTool === 'cursor' ? 'none' : 'all';
    state.canvas.style.cursor = state.activeTool === 'cursor' ? '' : 'crosshair';
  }

  // ── LOCK TOGGLE ──

  function _syncLockButton(d) {
    var btn = document.getElementById('drawLockToggle');
    if (!btn) return;
    var locked = d && d.locked;
    btn.textContent = locked ? '🔒' : '🔓';
    btn.title = locked ? 'Déverrouiller le dessin' : 'Verrouiller le dessin (clic traverse vers le chart)';
    btn.dataset.locked = locked ? 'true' : 'false';
  }

  function _toggleLock() {
    if (state.selectedIndex < 0 || state.selectedIndex >= state.drawings.length) return;
    var d = state.drawings[state.selectedIndex];
    d.locked = !d.locked;
    _saveDrawings();
    _syncLockButton(d);
    _renderAll();
    toast('Dessin ' + (d.locked ? 'verrouillé' : 'déverrouillé'), 'info');
  }

  // ── / LOCK TOGGLE

  function _syncOptionsUI() {
    ['drawOptionsPanel', 'drawOptionsPanelWidget'].forEach(function (id) {
      var panel = document.getElementById(id);
      if (panel) {
        if (state.activeTool === 'cursor' && state.selectedIndex < 0) { panel.classList.add('hidden'); }
        else { panel.classList.remove('hidden'); }
      }
    });

    _setVal('drawColorPick', state.toolOptions.color);
    _setVal('drawFillColor', state.toolOptions.fillColor);
    _setVal('drawLineWidth', state.toolOptions.lineWidth);
    _setVal('drawLineStyle', state.toolOptions.lineStyle);
    _setVal('drawOpacity', state.toolOptions.opacity);
    var ov = document.getElementById('drawOpacityVal');
    if (ov) ov.textContent = parseFloat(state.toolOptions.opacity).toFixed(2);
    _setChecked('drawExtLeft', state.toolOptions.extendLeft);
    _setChecked('drawExtRight', state.toolOptions.extendRight);
    _setVal('drawText', state.toolOptions.text);

    // Row visibility : selon le tool actif OU le dessin selectionne
    var tool = state.activeTool;
    if (tool === 'cursor' && state.selectedIndex >= 0) {
      // Utiliser le type du dessin selectionne
      var sel = state.drawings[state.selectedIndex];
      if (sel) tool = sel.type;
    }
    _showEl('drawExtRow', tool === 'trendline');
    _showEl('drawTextRow', tool === 'text' || tool === 'trendline' || tool === 'horizontal' || tool === 'horizontalray' || tool === 'vertical' || tool === 'box');
    _showEl('drawFillRow', tool === 'box');
    _showEl('drawOpacityRow', tool === 'box');
    _showEl('drawFibSection', tool === 'fibonacci');

    // Swatches
    var swatches = document.getElementById('drawColorSwatches');
    if (swatches && swatches.innerHTML === '') {
      TOOL_COLORS.forEach(function (c) {
        var sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'draw-swatch' + (c === state.toolOptions.color ? ' is-active' : '');
        sw.style.background = c;
        sw.dataset.color = c;
        sw.addEventListener('click', function () {
          swatches.querySelectorAll('.draw-swatch').forEach(function (s) { s.classList.remove('is-active'); });
          this.classList.add('is-active');
          state.toolOptions.color = c;
          _setVal('drawColorPick', c);
          _readOptionsFromUI();
        });
        swatches.appendChild(sw);
      });
    }
    // Update active swatch
    if (swatches) {
      swatches.querySelectorAll('.draw-swatch').forEach(function (s) {
        s.classList.toggle('is-active', s.dataset.color === state.toolOptions.color);
      });
    }

    // Fib level toggles
    var fibList = document.getElementById('drawFibLevels');
    if (fibList) {
      fibList.innerHTML = '';
      FIB_LEVELS.forEach(function (l) {
        var vis = state.toolOptions.fibLevels[l.key] !== false;
        var row = document.createElement('label');
        row.className = 'draw-fib-row';
        row.innerHTML =
          '<input type="checkbox" ' + (vis ? 'checked' : '') + ' data-fib-key="' + l.key + '">' +
          '<span class="draw-fib-dot" style="background:' + l.color + '"></span>' +
          '<span class="draw-fib-label">' + l.label + '%</span>';
        row.querySelector('input').addEventListener('change', function () {
          state.toolOptions.fibLevels[parseFloat(this.dataset.fibKey)] = this.checked;
        });
        fibList.appendChild(row);
      });
    }
  }

  function _setVal(id, val) { var e = document.getElementById(id); if (e) e.value = val; }
  function _setChecked(id, val) { var e = document.getElementById(id); if (e) e.checked = !!val; }
  function _showEl(id, show) { var e = document.getElementById(id); if (e) e.style.display = show ? '' : 'none'; }

  function _readOptionsFromUI() {
    function gv(id) { var e = document.getElementById(id); return e ? e.value : null; }
    function gc(id) { var e = document.getElementById(id); return e ? e.checked : false; }
    state.toolOptions.color = gv('drawColorPick') || '#06b6d4';
    state.toolOptions.fillColor = gv('drawFillColor') || '#06b6d4';
    state.toolOptions.lineWidth = parseFloat(gv('drawLineWidth')) || 1.5;
    state.toolOptions.lineStyle = gv('drawLineStyle') || 'solid';
    state.toolOptions.opacity = parseFloat(gv('drawOpacity')) || 0.3;
    state.toolOptions.extendLeft = gc('drawExtLeft');
    state.toolOptions.extendRight = gc('drawExtRight');
    state.toolOptions.text = gv('drawText') || '';

    // Apply to selected drawing (live edit)
    if (state.selectedIndex >= 0 && state.selectedIndex < state.drawings.length) {
      var d = state.drawings[state.selectedIndex];
      d.color = state.toolOptions.color;
      d.fillColor = state.toolOptions.fillColor;
      d.lineWidth = state.toolOptions.lineWidth;
      d.lineStyle = state.toolOptions.lineStyle;
      d.opacity = state.toolOptions.opacity;
      d.extendLeft = state.toolOptions.extendLeft;
      d.extendRight = state.toolOptions.extendRight;
      d.text = state.toolOptions.text;
      // Fib levels preserved — only sync top-level props
      _saveDrawings();
      _renderAll();
    }
  }

  // ── EVENTS ──

  // rAF render loop — double rAF pour laisser LWC finir son rendu avant nous
  var _renderLoopRunning = false;
  var _rafA = null;
  var _rafB = null;
  var _interactionTimeout = null;
  var IDLE_DELAY_MS = 200;

  function _startRenderLoop() {
    if (_renderLoopRunning) return;
    _renderLoopRunning = true;

    function tick() {
      if (!_renderLoopRunning) return;

      _rafA = requestAnimationFrame(function () {
        _rafA = null;
        // Deuxieme rAF : LWC a fini ses transforms internes
        _rafB = requestAnimationFrame(function () {
          _rafB = null;
          if (!_renderLoopRunning) return;
          _resizeCanvas();
          _renderAll();
          tick();
        });
      });
    }

    tick();
  }

  function _stopRenderLoop() {
    _renderLoopRunning = false;
    if (_rafA) { cancelAnimationFrame(_rafA); _rafA = null; }
    if (_rafB) { cancelAnimationFrame(_rafB); _rafB = null; }
    // Dernier rendu stabilise
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        _resizeCanvas();
        _renderAll();
      });
    });
  }

  function _scheduleStop() {
    clearTimeout(_interactionTimeout);
    _interactionTimeout = setTimeout(_stopRenderLoop, IDLE_DELAY_MS);
  }

  function _bindEvents() {
    if (!state.canvas) return;
    state.canvas.addEventListener('click', _onCanvasClick);
    state.canvas.addEventListener('mousemove', _onMouseMove);
    state.canvas.addEventListener('mouseleave', _onMouseLeave);
    state.canvas.addEventListener('dblclick', _onDblClick);

      // Click handler sur le conteneur pour hit-test en mode curseur
      if (state.container) {
        // Mousedown en phase CAPTURE pour intercepter avant LWC
        state.container.addEventListener('mousedown', function (e) {
          if (state.activeTool !== 'cursor' || e.button !== 0) return;
          if (e.target.closest('#drawOptionsPanel, #drawOptionsPanelWidget')) return;
          var tp = _toTimePrice(e.clientX, e.clientY);
          if (!tp) return;
          var hitIdx = _hitTestIndex(tp.time, tp.price);
          if (hitIdx >= 0 && !state.drawings[hitIdx].locked) {
            e.stopPropagation();
            e.preventDefault();
            // Detecter si le clic est sur une extremite (resize) ou le corps (deplacer)
            var dragPointIdx = -1; // -1 = deplacement complet
            var d = state.drawings[hitIdx];
            if (d.points && tp) {
              var cpx = _toPixel(tp.time, tp.price);
              if (cpx) {
                for (var p = 0; p < Math.min(d.points.length, 2); p++) {
                  var ppx = _toPixel(d.points[p].time, d.points[p].price);
                  if (ppx) {
                    var dist = Math.sqrt((cpx.x - ppx.x) * (cpx.x - ppx.x) + (cpx.y - ppx.y) * (cpx.y - ppx.y));
                    if (dist < 15) { dragPointIdx = p; break; }
                  }
                }
              }
            }
            state._drag = { idx: hitIdx, startTime: tp.time, startPrice: tp.price, pointIdx: dragPointIdx };
            if (state.canvas) state.canvas.style.cursor = 'grabbing';
          }
        }, { capture: true });

        state.container.addEventListener('mouseup', function (e) {
          if (state._drag) {
            // Drag termine : sauvegarder
            _saveDrawings();
            state._drag = null;
            state.canvas.style.cursor = state.activeTool === 'cursor' ? '' : 'crosshair';
            _scheduleStop();
          }
        });

        state.container.addEventListener('click', function (e) {
          if (state.activeTool !== 'cursor') return;
          // Ne pas interferer avec les clics dans le panneau d'options
          if (e.target.closest('#drawOptionsPanel, #drawOptionsPanelWidget')) return;
          // Ignorer si on vient de draguer
          if (state._drag) return;
          var tp = _toTimePrice(e.clientX, e.clientY);
          if (tp) {
            var hitIdx = _hitTestIndex(tp.time, tp.price);
            if (hitIdx >= 0) {
              e.stopPropagation();
              _selectDrawing(hitIdx);
            } else {
              _deselectDrawing();
            }
          } else {
            _deselectDrawing();
          }
        });
        // Fallback: document-level click si le container ne capte pas
        document.addEventListener('click', function (e) {
          if (state.activeTool !== 'cursor') return;
          if (!state.container || !state.container.contains(e.target)) return;
          // Ne pas interferer avec les clics dans le panneau d'options
          if (e.target.closest('#drawOptionsPanel, #drawOptionsPanelWidget')) return;
          var tp = _toTimePrice(e.clientX, e.clientY);
          if (tp) {
            var hitIdx = _hitTestIndex(tp.time, tp.price);
            if (hitIdx >= 0) {
              e.stopPropagation();
              _selectDrawing(hitIdx);
            } else {
              _deselectDrawing();
            }
          } else {
            _deselectDrawing();
          }
        });
      }

    // Render loop synchro parfaite pendant interaction souris
    if (state.container) {
      state.container.addEventListener('mousemove', function (e) {
        // Drag: deplacer le dessin selectionne
        if (state._drag) {
          var tp = _toTimePrice(e.clientX, e.clientY);
          if (tp) {
            var d = state.drawings[state._drag.idx];
            if (d && d.points) {
              var dTime = tp.time - state._drag.startTime;
              var dPrice = tp.price - state._drag.startPrice;
              if (state._drag.pointIdx >= 0) {
                // Resize : ne deplacer qu'un seul point
                var p = state._drag.pointIdx;
                d.points[p] = {
                  time: d.points[p].time + dTime,
                  price: d.points[p].price + dPrice,
                };
              } else {
                // Deplacement complet : tous les points
                for (var p = 0; p < d.points.length; p++) {
                  d.points[p] = {
                    time: d.points[p].time + dTime,
                    price: d.points[p].price + dPrice,
                  };
                }
              }
              state._drag.startTime = tp.time;
              state._drag.startPrice = tp.price;
              _renderAll();
            }
          }
        }
        _startRenderLoop();
        _scheduleStop();
      }, { passive: true });
      state.container.addEventListener('wheel', function () {
        _startRenderLoop();
        _scheduleStop();
      }, { passive: true });
      state.container.addEventListener('mouseleave', function () {
        clearTimeout(_interactionTimeout);
        _stopRenderLoop();
      });
    }

    document.addEventListener('change', function (e) {
      if (e.target.closest('#drawOptionsPanel')) _readOptionsFromUI();
      if (e.target.id === 'drawTemplateLoad') _onTemplateLoad();
    });

    // Live preview for range slider
    document.addEventListener('input', function (e) {
      if (e.target.id === 'drawOpacity') {
        var valEl = document.getElementById('drawOpacityVal');
        if (valEl) valEl.textContent = parseFloat(e.target.value).toFixed(2);
        _readOptionsFromUI();
      }
    });

    document.addEventListener('click', function (e) {
      if (e.target.id === 'drawTemplateSave') _onTemplateSave();
      if (e.target.id === 'drawTemplateDelete') _onTemplateDelete();
      if (e.target.id === 'drawTypeBtn') _onDrawTypeBtn();
      if (e.target.id === 'drawLockToggle') _toggleLock();
    });

    // Mouseup global pour finaliser le drag meme hors container
    document.addEventListener('mouseup', function () {
      if (state._drag) {
        _saveDrawings();
        state._drag = null;
        if (state.canvas) state.canvas.style.cursor = state.activeTool === 'cursor' ? '' : 'crosshair';
      }
    });
    // Keyboard: Ctrl+Z for undo + Escape to deselect
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      }
      if (e.key === 'Escape' && state.selectedIndex >= 0) {
        _deselectDrawing();
      }
    });

    if (state.chart && state.chart.timeScale()) {
      var _debounceTimer = null;
      function _scheduleRender() {
        if (_debounceTimer) return;
        _debounceTimer = setTimeout(function () { _debounceTimer = null; _renderAll(); }, 16);
      }
      state.chart.timeScale().subscribeVisibleTimeRangeChange(_scheduleRender);
      state.chart.timeScale().subscribeVisibleLogicalRangeChange(_scheduleRender);
    }

    // Redraw on window resize — DEPRECATED, utilise le ResizeObserver du chart page
    // window.addEventListener('resize', _onWindowResize);
  }

  function _onWindowResize() {
    _resizeCanvas();
    _renderAll();
  }

  function _onTemplateSave() {
    var name = prompt('Nom du template :');
    if (name && saveTemplate(name.trim())) {
      _refreshTemplateList();
      toast('Template "' + name.trim() + '" sauvegardé', 'success');
    }
  }

  function _onTemplateLoad() {
    var sel = document.getElementById('drawTemplateLoad');
    if (!sel || !sel.value) return;
    if (loadTemplate(sel.value)) {
      _refreshTemplateList();
      toast('Template "' + sel.value + '" chargé', 'success');
    }
  }

  function _onTemplateDelete() {
    var sel = document.getElementById('drawTemplateLoad');
    if (!sel || !sel.value) return;
    if (confirm('Supprimer le template "' + sel.value + '" ?')) {
      deleteTemplate(sel.value);
      _refreshTemplateList();
    }
  }

  function _refreshTemplateList() {
    var sel = document.getElementById('drawTemplateLoad');
    if (!sel) return;
    var current = sel.value;
    sel.innerHTML = '<option value="">— Charger un template —</option>';
    var templates = listTemplates();
    templates.forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = t.name + ' (' + t.drawings.length + ' dessins)';
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  }

  function _onCanvasClick(e) {
    if (state.activeTool === 'cursor') return;
    _readOptionsFromUI();
    var tp = _snapPoint(_toTimePrice(e.clientX, e.clientY), e.clientX);
    if (!tp) return;

    var tool = state.activeTool;
    var isOnePoint = (tool === 'horizontal' || tool === 'horizontalray' || tool === 'vertical' || tool === 'text');

    // If editing an existing drawing, clicking elsewhere deselects
    if (state.selectedIndex >= 0 && state.selectedIndex < state.drawings.length) {
      _deselectDrawing();
      // If user clicked on a different drawing, select that one instead
      var hitIdx = _hitTestIndex(tp.time, tp.price);
      if (hitIdx >= 0 && hitIdx !== state.selectedIndex) {
        _selectDrawing(hitIdx);
        return;
      }
      return;
    }

    // Hit test: clicking on existing drawing enters edit mode
    if (!state.isDrawing) {
      var hitIdx = _hitTestIndex(tp.time, tp.price);
      if (hitIdx >= 0) {
        _selectDrawing(hitIdx);
        return;
      }
    }

    // Otherwise, creation flow
    if (!state.isDrawing) {
      // First click: start drawing
      state.dragStart = { time: tp.time, price: tp.price };
      state.isDrawing = true;
      state.previewPoint = null;
      // For 1-point tools, finalize immediately
      if (isOnePoint) { _finalizeDrawing(tp); }
    } else {
      // Second click: finalize drawing
      _finalizeDrawing(tp);
    }
  }

  function _selectDrawing(idx) {
    if (idx < 0 || idx >= state.drawings.length) return;
    _cancelDrawing();
    state.selectedIndex = idx;
    var d = state.drawings[idx];
    // Sync tool options to match the selected drawing
    state.toolOptions.color = d.color || '#06b6d4';
    state.toolOptions.fillColor = d.fillColor || '#06b6d4';
    state.toolOptions.lineWidth = d.lineWidth || 1.5;
    state.toolOptions.lineStyle = d.lineStyle || 'solid';
    state.toolOptions.opacity = d.opacity !== undefined ? d.opacity : 0.3;
    state.toolOptions.extendLeft = d.extendLeft || false;
    state.toolOptions.extendRight = d.extendRight !== false;
    state.toolOptions.text = d.text || '';
    if (d.fibLevels) {
      Object.keys(state.toolOptions.fibLevels).forEach(function (k) {
        state.toolOptions.fibLevels[k] = d.fibLevels[k] !== false;
      });
    }
    _syncOptionsUI();
    // Forcer l'affichage du panneau d'options meme en mode curseur
    ['drawOptionsPanel', 'drawOptionsPanelWidget'].forEach(function (id) {
      var panel = document.getElementById(id);
      if (panel) panel.classList.remove('hidden');
    });
    // Sync lock button
    _syncLockButton(d);
    _renderAll();
    if (typeof toast === 'function') toast('Dessin sélectionné — modifie les options en direct', 'info');
  }

  function _deselectDrawing() {
    if (state.selectedIndex < 0) return;
    state.selectedIndex = -1;
    _syncOptionsUI();
    // Reset lock button
    var btn = document.getElementById('drawLockToggle');
    if (btn) { btn.textContent = '🔓'; btn.dataset.locked = 'false'; btn.title = 'Verrouiller le dessin (clic traverse vers le chart)'; }
    _renderAll();
  }

  function _finalizeDrawing(tp) {
    if (!state.dragStart) { _cancelDrawing(); return; }
    var p1 = state.dragStart, p2 = { time: tp.time, price: tp.price };
    var tool = state.activeTool, drawing = null;

    switch (tool) {
      case 'box':
        if (p1.time === p2.time && p1.price === p2.price) { _cancelDrawing(); _renderAll(); return; }
        drawing = _createDrawing('box', [p1, p2]);
        break;
      case 'trendline':
        if (p1.time === p2.time && p1.price === p2.price) { _cancelDrawing(); _renderAll(); return; }
        drawing = _createDrawing('trendline', [p1, p2]);
        break;
      case 'horizontal':
        drawing = _createDrawing('horizontal', [p1]);
        break;
      case 'horizontalray':
        drawing = _createDrawing('horizontalray', [p1]);
        break;
      case 'vertical':
        drawing = _createDrawing('vertical', [p1]);
        break;
      case 'fibonacci':
        if (p1.time === p2.time && p1.price === p2.price) { _cancelDrawing(); _renderAll(); return; }
        drawing = _createDrawing('fibonacci', [p1, p2]);
        break;
      case 'text':
        drawing = _createDrawing('text', [p1]);
        break;
    }

    if (drawing) {
      _pushUndoState();
      state.drawings.push(drawing); _saveDrawings();
    }
    _cancelDrawing();
    _renderAll();

    // Auto-exit to cursor mode
    setActiveTool('cursor');
    // Update toolbar button active state
    var toolbar = document.getElementById('drawToolbar');
    if (toolbar) {
      toolbar.querySelectorAll('.draw-toolbar-btn').forEach(function (b) {
        b.classList.toggle('is-active', b.dataset.tool === 'cursor');
      });
    }
    var widgetToolbar = document.getElementById('drawToolbarWidget');
    if (widgetToolbar) {
      widgetToolbar.querySelectorAll('.draw-toolbar-btn').forEach(function (b) {
        b.classList.toggle('is-active', b.dataset.tool === 'cursor');
      });
    }
  }

  function _onMouseMove(e) {
    if (state.isDrawing && state.dragStart) {
      var tp = _snapPoint(_toTimePrice(e.clientX, e.clientY), e.clientX);
      if (tp) { state.previewPoint = { time: tp.time, price: tp.price }; _renderAll(); }
    }
    if (state.activeTool === 'cursor') {
      var tp = _snapPoint(_toTimePrice(e.clientX, e.clientY), e.clientX);
      if (tp && state.canvas) state.canvas.style.cursor = _hitTest(tp.time, tp.price) ? 'pointer' : '';
    }
    // Stocker la position pour le crosshair canvas en mode dessin
    if (state.activeTool !== 'cursor') {
      var rect = state.container ? state.container.getBoundingClientRect() : null;
      if (rect) {
        state._crosshairPos = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
      }
    }
  }

  function _onMouseLeave() { state.previewPoint = null; state._crosshairPos = null; _renderAll(); }

  function _onDblClick(e) {
    if (state.activeTool !== 'cursor') return;
    var tp = _snapPoint(_toTimePrice(e.clientX, e.clientY), e.clientX);
    if (!tp) return;
    var idx = _hitTestIndex(tp.time, tp.price);
    if (idx !== -1) {
      _pushUndoState();
      state.drawings.splice(idx, 1); _saveDrawings(); _renderAll();
    }
  }

  function _cancelDrawing() { state.isDrawing = false; state.dragStart = null; state.previewPoint = null; }

  // ── HIT TEST ──

  function _hitTestIndex(time, price) {
    var threshold = 10;
    var clickPx = _toPixel(time, price);
    if (!clickPx) return -1;
    var cx = clickPx.x, cy = clickPx.y;
    for (var i = state.drawings.length - 1; i >= 0; i--) {
      var d = state.drawings[i];
      if (!d.points || !d.points[0]) continue;

      // Toujours tester les endpoints (points d'extremite)
      for (var p = 0; p < Math.min(d.points.length, 2); p++) {
        var px = _toPixel(d.points[p].time, d.points[p].price);
        if (!px) continue;
        var dist = Math.sqrt((cx - px.x) * (cx - px.x) + (cy - px.y) * (cy - px.y));
        if (dist < threshold) return i;
      }

      // Si locke : seulement les endpoints, pas les segments/aires
      if (d.locked) continue;

      // Hit-test par type (segments de ligne, aires)
      switch (d.type) {
        case 'box':
          // Unlock: integre (tout le rectangle). Lock: seulement endpoints (deja teste plus haut)
          if (!d.locked && d.points.length >= 2) {
            var p1 = _toPixel(d.points[0].time, d.points[0].price);
            var p2 = _toPixel(d.points[1].time, d.points[1].price);
            if (p1 && p2) {
              var bX1 = Math.min(p1.x, p2.x), bY1 = Math.min(p1.y, p2.y);
              var bX2 = Math.max(p1.x, p2.x), bY2 = Math.max(p1.y, p2.y);
              // Marge 10px autour pour le confort
              if (cx >= bX1 - 10 && cx <= bX2 + 10 && cy >= bY1 - 10 && cy <= bY2 + 10) return i;
            }
          }
          break;

        case 'trendline':
          if (d.points.length >= 2) {
            var p1 = _toPixel(d.points[0].time, d.points[0].price);
            var p2 = _toPixel(d.points[1].time, d.points[1].price);
            if (p1 && p2) {
              var cw = state.canvas ? state.canvas.width / (window.devicePixelRatio || 1) : 0;
              var x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
              if (d.extendLeft) { var tL = (0 - x1) / (x2 - x1 || 1); x1 = 0; y1 = y1 + (y2 - y1) * tL; }
              if (d.extendRight) { var tR = (cw - x1) / (x2 - x1 || 1); x2 = cw; y2 = y1 + (y2 - y1) * tR; }
              if (_distToSegment(cx, cy, x1, y1, x2, y2) < threshold) return i;
            }
          }
          break;

        case 'horizontal':
        case 'horizontalray':
          {
            var px = _toPixel(d.points[0].time, d.points[0].price);
            if (px) {
              var cw = state.canvas ? state.canvas.width / (window.devicePixelRatio || 1) : 0;
              var rx1 = d.type === 'horizontal' ? 0 : px.x;
              var rx2 = cw;
              if (Math.abs(cy - px.y) < threshold && cx >= rx1 - threshold && cx <= rx2 + threshold) return i;
            }
          }
          break;

        case 'vertical':
          {
            var px = _toPixel(d.points[0].time, d.points[0].price);
            if (px) {
              var ch = state.canvas ? state.canvas.height / (window.devicePixelRatio || 1) : 0;
              if (Math.abs(cx - px.x) < threshold && cy >= -threshold && cy <= ch + threshold) return i;
            }
          }
          break;

        case 'fibonacci':
          if (d.points.length >= 2) {
            var p1 = _toPixel(d.points[0].time, d.points[0].price);
            var p2 = _toPixel(d.points[1].time, d.points[1].price);
            if (p1 && p2) {
              if (_distToSegment(cx, cy, p1.x, p1.y, p2.x, p2.y) < threshold) return i;
              var price1 = d.points[0].price, price2 = d.points[1].price, diff = price2 - price1;
              var fibKeys = d.fibLevels || {};
              for (var f = 0; f < FIB_LEVELS.length; f++) {
                var l = FIB_LEVELS[f];
                if (fibKeys[l.key] === false) continue;
                var fPrice = price1 + diff * l.key;
                var fp = _toPixel(d.points[0].time, fPrice);
                if (!fp) continue;
                if (Math.abs(cy - fp.y) < threshold) return i;
              }
            }
          }
          break;

        case 'text':
          // Deja teste via endpoints (un seul point)
          break;
      }
    }
    return -1;
  }

  // Distance d'un point (px,py) a un segment (x1,y1)-(x2,y2)
  function _distToSegment(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
    var t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    var nearX = x1 + t * dx, nearY = y1 + t * dy;
    return Math.sqrt((px - nearX) * (px - nearX) + (py - nearY) * (py - nearY));
  }

  // ── RENDER ──

  function _renderAll() {
    var ctx = state.ctx; if (!ctx || !state.canvas) return;

    // Clear en repere bitmap (pas CSS) pour eviter les artefacts Retina
    var dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
    ctx.restore();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    _renderSessions();
    for (var i = 0; i < state.drawings.length; i++) { _renderDrawing(state.drawings[i], i); _drawSelectionIndicators(state.drawings[i], i); _drawLockIcon(state.drawings[i], i); _drawLockedDots(state.drawings[i], i); }
    if (state.dragStart && state.previewPoint && state.activeTool !== 'cursor') {
      _renderPreview(state.activeTool, state.dragStart, state.previewPoint);
    }
    // Crosshair en mode dessin : lignes horizontale + verticale
    if (state.activeTool !== 'cursor' && state._crosshairPos) {
      _renderCrosshair(state._crosshairPos);
    }
  }

  function _drawSelectionIndicators(d, index) {
    if (index !== state.selectedIndex || !d.points) return;
    var ctx = state.ctx;
    ctx.save();
    for (var p = 0; p < d.points.length; p++) {
      var px = _toPixel(d.points[p].time, d.points[p].price);
      if (!px) continue;
      // Outer glow ring
      ctx.beginPath(); ctx.arc(px.x, px.y, 6, 0, Math.PI * 2);
      ctx.strokeStyle = '#06b6d4'; ctx.lineWidth = 2;
      ctx.shadowColor = '#06b6d4'; ctx.shadowBlur = 8;
      ctx.stroke();
      // Inner dot
      ctx.beginPath(); ctx.arc(px.x, px.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#06b6d4'; ctx.fill();
    }
    ctx.restore();
  }

  function _drawLockIcon(d, index) {
    if (!d.locked || !d.points || !d.points[0]) return;
    var px = _toPixel(d.points[0].time, d.points[0].price);
    if (!px) return;
    var ctx = state.ctx;
    ctx.save();
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = '#f59e0b';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    ctx.fillText('🔒', px.x, px.y - 8);
    ctx.restore();
  }

  // Points d'extremite visibles pour les dessins lockes (pour pouvoir les selectionner)
  function _drawLockedDots(d, index) {
    if (!d.locked || !d.points) return;
    if (index === state.selectedIndex) return; // deja dessine par _drawSelectionIndicators
    var ctx = state.ctx;
    ctx.save();
    for (var p = 0; p < Math.min(d.points.length, 2); p++) {
      var px = _toPixel(d.points[p].time, d.points[p].price);
      if (!px) continue;
      ctx.beginPath(); ctx.arc(px.x, px.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = d.color || '#06b6d4';
      ctx.globalAlpha = 0.5;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function _renderDrawing(d, index) {
    switch (d.type) {
      case 'box':          _drawBox(d.points, d, index); break;
      case 'trendline':    _drawLine(d.points, d, index); break;
      case 'horizontal':   _drawHorizLine(d.points[0], d, index); break;
      case 'horizontalray':_drawHorizRay(d.points[0], d, index); break;
      case 'vertical':     _drawVertLine(d.points[0], d, index); break;
      case 'fibonacci':    _drawFibonacci(d, index); break;
      case 'text':         _drawText(d.points[0], d, index); break;
    }
  }

  function _renderPreview(tool, p1, p2) {
    var o = state.toolOptions;
    var pd = { color: o.color, fillColor: o.fillColor, lineWidth: 1, lineStyle: 'dashed', opacity: o.opacity, text: o.text, fibLevels: o.fibLevels };
    switch (tool) {
      case 'box':          _drawBox([p1, p2], pd); break;
      case 'trendline':    _drawLine([p1, p2], pd); break;
      case 'horizontal':   _drawHorizLine(p1, pd); break;
      case 'horizontalray':_drawHorizRay(p1, pd); break;
      case 'vertical':     _drawVertLine(p1, pd); break;
      case 'fibonacci':    _drawFibonacci({ points: [p1, p2], color: o.color, fibLevels: o.fibLevels }); break;
      case 'text':         _drawText(p1, pd); break;
    }
  }

  // ── CROSSHAIR CANVAS (mode dessin) ──

  function _renderCrosshair(pos) {
    var ctx = state.ctx;
    if (!ctx || !state.canvas) return;
    var w = state.canvas.width;
    var h = state.canvas.height;
    var dpr = window.devicePixelRatio || 1;
    var px = pos.x * dpr;
    var py = pos.y * dpr;

    ctx.save();
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);

    // Ligne verticale
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.stroke();

    // Ligne horizontale
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(w, py);
    ctx.stroke();

    ctx.restore();
  }

  // ── SESSION ZONES ──

  function _renderSessions() {
    var ctx = state.ctx;
    if (!ctx || !state.chart || !state.sessions || !state.sessions.length) return;

    var visibleRange = state.chart.timeScale().getVisibleRange();
    if (!visibleRange || !visibleRange.from || !visibleRange.to) return;

    var from = visibleRange.from; // seconds
    var to = visibleRange.to;

    var ch;
    try { ch = state.canvas.height / (window.devicePixelRatio || 1); } catch(e) { return; }
    if (!ch) return;

    // Day boundaries: floor/ceil to UTC midnight
    var dayStart = Math.floor(from / 86400) * 86400;
    var dayEnd = Math.ceil(to / 86400) * 86400;

    ctx.save();
    ctx.textBaseline = 'top';
    ctx.font = '9px "JetBrains Mono", monospace';

    for (var s = 0; s < state.sessions.length; s++) {
      var session = state.sessions[s];
      if (!session.active) continue;

      for (var t = dayStart; t < dayEnd; t += 86400) {
        var sStart = t + session.startHour * 3600;
        var sEnd = t + session.endHour * 3600;

        // Handle midnight-spanning sessions (e.g. 22:00-08:00)
        if (session.startHour > session.endHour) {
          sEnd += 86400;
        }

        // Clip to visible range
        var clipStart = Math.max(sStart, from);
        var clipEnd = Math.min(sEnd, to);
        if (clipStart >= clipEnd) continue;

        var x1 = state.chart.timeScale().timeToCoordinate(clipStart);
        var x2 = state.chart.timeScale().timeToCoordinate(clipEnd);
        if (x1 == null || x2 == null || x2 - x1 < 2) continue;

        // Draw fill
        ctx.globalAlpha = parseFloat(session.opacity) || 0.12;
        ctx.fillStyle = session.color;
        ctx.fillRect(x1, 0, x2 - x1, ch);
        ctx.globalAlpha = 1;

        // Draw label at top-left of zone
        ctx.fillStyle = session.color;
        ctx.textAlign = 'left';
        ctx.fillText(session.name, x1 + 3, 3);

        // Thin line at session start
        ctx.strokeStyle = session.color;
        ctx.lineWidth = 0.5;
        ctx.globalAlpha = 0.25;
        ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, ch); ctx.stroke();

        // Thin line at session end
        ctx.beginPath(); ctx.moveTo(x2, 0); ctx.lineTo(x2, ch); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    ctx.restore();
  }

  // ── / SESSION ZONES

  // ── DRAWING PRIMITIVES ──

  function _getDash(style) { for (var i = 0; i < LINE_STYLES.length; i++) { if (LINE_STYLES[i].id === style) return LINE_STYLES[i].dash; } return []; }
  function _getAlpha(d) { var a = parseFloat(d.opacity); return (a >= 0 && a <= 1) ? a : 0.3; }

  function _drawBox(points, d, index) {
    if (points.length < 2) return;
    var ctx = state.ctx;
    var p1 = _toPixel(points[0].time, points[0].price);
    var p2 = _toPixel(points[1].time, points[1].price);
    if (!p1 || !p2) return;

    var x = Math.min(p1.x, p2.x), y = Math.min(p1.y, p2.y);
    var w = Math.abs(p2.x - p1.x), h = Math.abs(p2.y - p1.y);

    ctx.save();
    // Fill
    ctx.globalAlpha = _getAlpha(d);
    ctx.fillStyle = d.fillColor || d.color;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    // Border
    ctx.strokeStyle = d.color;
    ctx.lineWidth = d.lineWidth || 1.5;
    ctx.setLineDash(_getDash(d.lineStyle));
    ctx.strokeRect(x, y, w, h);
    // Dots (seulement si selectionne)
    if (index === state.selectedIndex) {
      _drawDot(p1.x, p1.y, d.color);
      _drawDot(p2.x, p2.y, d.color);
    }
    // Label
    if (d.text) _drawLabel(p2.x + 6, p1.y - 4, d.text, d.color);
    ctx.restore();
  }

  function _drawLine(points, d, index) {
    if (points.length < 2) return;
    var ctx = state.ctx;
    var p1 = _toPixel(points[0].time, points[0].price);
    var p2 = _toPixel(points[1].time, points[1].price);
    if (!p1 || !p2) return;
    var cw = state.canvas.width / (window.devicePixelRatio || 1);

    ctx.save();
    ctx.globalAlpha = _getAlpha(d);
    ctx.strokeStyle = d.color;
    ctx.lineWidth = d.lineWidth || 1.5;
    ctx.setLineDash(_getDash(d.lineStyle));

    var x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
    if (d.extendLeft || d.extendRight) {
      var dx = x2 - x1, dy = y2 - y1;
      if (dx !== 0) {
        if (d.extendLeft) { var tL = (0 - x1) / dx; x1 = 0; y1 = y1 + dy * tL; }
        if (d.extendRight) { var tR = (cw - x1) / dx; x2 = cw; y2 = y1 + dy * tR; }
      }
    }

    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.globalAlpha = 1;
    if (index === state.selectedIndex) {
      _drawDot(p1.x, p1.y, d.color); _drawDot(p2.x, p2.y, d.color);
    }
    if (d.text) _drawLabel(p2.x + 6, p2.y - 6, d.text, d.color);
    ctx.restore();
  }

  function _drawHorizLine(point, d) {
    var ctx = state.ctx;
    var px = _toPixel(point.time, point.price);
    if (!px) return;
    var cw = state.canvas.width / (window.devicePixelRatio || 1);
    ctx.save();
    ctx.globalAlpha = _getAlpha(d);
    ctx.strokeStyle = d.color; ctx.lineWidth = d.lineWidth || 1.5;
    ctx.setLineDash(_getDash(d.lineStyle));
    ctx.beginPath(); ctx.moveTo(0, px.y); ctx.lineTo(cw, px.y); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = d.color;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(point.price.toFixed(2), 4, px.y - 4);
    if (d.text) { ctx.textAlign = 'right'; ctx.fillText(d.text, cw - 4, px.y - 4); }
    ctx.restore();
  }

  function _drawHorizRay(point, d, index) {
    var ctx = state.ctx;
    var px = _toPixel(point.time, point.price);
    if (!px) return;
    var cw = state.canvas.width / (window.devicePixelRatio || 1);
    ctx.save();
    ctx.globalAlpha = _getAlpha(d);
    ctx.strokeStyle = d.color; ctx.lineWidth = d.lineWidth || 1.5;
    ctx.setLineDash(_getDash(d.lineStyle));
    ctx.beginPath(); ctx.moveTo(px.x, px.y); ctx.lineTo(cw, px.y); ctx.stroke();
    ctx.globalAlpha = 1;
    var as = 8; ctx.beginPath(); ctx.moveTo(cw, px.y); ctx.lineTo(cw - as, px.y - as / 2); ctx.lineTo(cw - as, px.y + as / 2); ctx.closePath(); ctx.fillStyle = d.color; ctx.fill();
    ctx.fillStyle = d.color;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(point.price.toFixed(2), px.x + 6, px.y - 6);
    if (d.text) ctx.fillText(d.text, px.x + 6, px.y + 14);
    if (index === state.selectedIndex) _drawDot(px.x, px.y, d.color);
    ctx.restore();
  }

  function _drawVertLine(point, d, index) {
    var ctx = state.ctx;
    var px = _toPixel(point.time, point.price);
    if (!px) return;
    var ch = state.canvas.height / (window.devicePixelRatio || 1);
    ctx.save();
    ctx.globalAlpha = _getAlpha(d);
    ctx.strokeStyle = d.color; ctx.lineWidth = d.lineWidth || 1.5;
    ctx.setLineDash(_getDash(d.lineStyle));
    ctx.beginPath(); ctx.moveTo(px.x, 0); ctx.lineTo(px.x, ch); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = d.color; ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(d.text || '', px.x, ch - 4);
    if (index === state.selectedIndex) _drawDot(px.x, 0, d.color);
    ctx.restore();
  }

  function _drawFibonacci(d, index) {
    var points = d.points;
    if (points.length < 2) return;
    var ctx = state.ctx;
    var p1 = _toPixel(points[0].time, points[0].price);
    var p2 = _toPixel(points[1].time, points[1].price);
    if (!p1 || !p2) return;

    var price1 = points[0].price, price2 = points[1].price, diff = price2 - price1;
    var vis = d.fibLevels || {};

    ctx.save();
    ctx.globalAlpha = _getAlpha(d);
    ctx.strokeStyle = d.color; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    ctx.globalAlpha = 1;

    var cw = state.canvas.width / (window.devicePixelRatio || 1);
    var minX = Math.max(0, Math.min(p1.x, p2.x) - 30);
    var maxX = Math.min(cw, Math.max(p1.x, p2.x) + 30);

    for (var i = 0; i < FIB_LEVELS.length; i++) {
      var l = FIB_LEVELS[i];
      if (vis[l.key] === false) continue;
      var price = price1 + diff * l.key;
      var py = _toPixel(points[0].time, price);
      if (!py) continue;
      ctx.save();
      ctx.strokeStyle = l.color; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(minX, py.y); ctx.lineTo(maxX, py.y); ctx.stroke();
      ctx.fillStyle = l.color; ctx.font = '9px "JetBrains Mono", monospace';
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillText(l.label + '% (' + price.toFixed(2) + ')', maxX - 2, py.y);
      ctx.restore();
    }

    if (index === state.selectedIndex) {
      _drawDot(p1.x, p1.y, d.color); _drawDot(p2.x, p2.y, d.color);
    }
    ctx.restore();
  }

  function _drawText(point, d, index) {
    var ctx = state.ctx;
    var px = _toPixel(point.time, point.price);
    if (!px) return;
    ctx.save();
    ctx.globalAlpha = _getAlpha(d);
    ctx.fillStyle = d.color;
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(d.text || 'Texte', px.x + 6, px.y - 6);
    ctx.globalAlpha = 1;
    if (index === state.selectedIndex) _drawDot(px.x, px.y, d.color);
    ctx.restore();
  }

  function _drawLabel(x, y, txt, color) {
    var ctx = state.ctx;
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(txt, x, y);
    ctx.restore();
  }

  function _drawDot(x, y, color) {
    var ctx = state.ctx; if (!ctx) return;
    ctx.save(); ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ── CLEAR ──

  function clearAllDrawings() {
    _pushUndoState();
    state.drawings = []; _saveDrawings(); _renderAll();
  }

  // ── EXPOSED API ──

  window.ChartDrawings = {
    init: initDrawings, destroy: destroyDrawings,
    setTool: setActiveTool, getTool: getActiveTool,
    clearAll: clearAllDrawings, undo: undo, tools: DRAW_TOOLS,
    saveTemplate: saveTemplate, loadTemplate: loadTemplate,
    listTemplates: listTemplates, deleteTemplate: deleteTemplate,
    getDrawings: function () { return state.drawings.slice(); },
    onResize: function () { _resizeCanvas(); _renderAll(); },
    setSnapEnabled: function (v) { state.snapEnabled = !!v; },
    getSnapEnabled: function () { return state.snapEnabled; },
    // Session zones
    getSessionSettings: getSessionSettings,
    updateSessions: updateSessions,
  };

})();

// ---- 065_volume_profile.js ----
// ---------- Volume Profile v1 — Canvas Overlay ----------
// Draws horizontal volume histogram, POC, VAH, VAL on the chart canvas.
// Independent from drawings — uses its own canvas layer (z-index: 9).

(function () {
  'use strict';

  var STORAGE_KEY = 'chartVolumeProfileSettings';

  // ── DEFAULTS ──
  var DEFAULTS = {
    active: false,
    bucketSize: 10,       // $10 buckets for BTC
    period: 'visible',    // 'visible', 'day', 'week', 'month'
    vaPercent: 70,        // Value Area % (68, 70, 80)
    showPOC: true,
    showVAH: true,
    showVAL: true,
    colorPOC: '#f59e0b',  // amber
    colorVAH: '#22c55e',  // green
    colorVAL: '#ef4444',  // red
    colorHvn: '#06b6d4',  // cyan
    colorLvn: 'rgba(255,255,255,0.15)',
  };

  // ── STATE ──
  var state = {
    ctx: null,
    chart: null,
    series: null,
    container: null,
    canvas: null,
    candles: [],
    settings: null,
    data: null,           // calculated VP data
  };

  // ── INIT ──
  function init(chart, series, container) {
    state.chart = chart;
    state.series = series;
    state.container = container;
    _loadSettings();
    _createCanvas();
    _bindTimeScale();

    // Re-render on time scale change (zoom/pan) — debounce double fire
    if (state.chart && state.chart.timeScale()) {
      var _vpDeb = null;
      function _vpSched() { if (_vpDeb) return; _vpDeb = setTimeout(function () { _vpDeb = null; _renderVP(); }, 16); }
      try {
        state.chart.timeScale().subscribeVisibleTimeRangeChange(_vpSched);
        state.chart.timeScale().subscribeVisibleLogicalRangeChange(_vpSched);
      } catch (e) {}
    }

    // rAF render loop pendant interaction (double rAF pour synchro LWC)
    if (state.container) {
      var _vpLoopId = null, _vpTimer = null;
      function _vpTick() {
        if (!_vpLoopId) return;
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            if (!_vpLoopId) return;
            _resizeCanvas();
            _renderVP();
            _vpLoopId = requestAnimationFrame(_vpTick);
          });
        });
      }
      function _vpStart() {
        if (_vpLoopId) return;
        _vpLoopId = requestAnimationFrame(_vpTick);
      }
      function _vpStop() {
        if (_vpLoopId) { cancelAnimationFrame(_vpLoopId); _vpLoopId = null; }
        // Dernier rendu stabilise
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            _resizeCanvas();
            _renderVP();
          });
        });
      }
      try {
        state.container.addEventListener('mousemove', function () {
          _vpStart(); clearTimeout(_vpTimer); _vpTimer = setTimeout(_vpStop, 200);
        }, { passive: true });
        state.container.addEventListener('wheel', function () {
          _vpStart(); clearTimeout(_vpTimer); _vpTimer = setTimeout(_vpStop, 200);
        }, { passive: true });
        state.container.addEventListener('mouseleave', function () { clearTimeout(_vpTimer); _vpStop(); });
      } catch(e) {}
    }

    _renderVP();
  }

  function destroy() {
    if (state.canvas && state.canvas.parentNode) {
      state.canvas.parentNode.removeChild(state.canvas);
    }
    state.ctx = null;
    state.canvas = null;
    state.chart = null;
    state.series = null;
    state.container = null;
    state.candles = [];
    state.data = null;
  }

  // ── CANVAS ──
  function _createCanvas() {
    if (!state.container) return;
    if (state.canvas) { state.container.removeChild(state.canvas); }

    state.canvas = document.createElement('canvas');
    state.canvas.className = 'vp-overlay';
    state.canvas.style.cssText =
      'position:absolute;z-index:9;pointer-events:none;';
    // Insert before drawings canvas (z-index 10) so VP is behind tools
    var drawingsCanvas = state.container.querySelector('.draw-overlay');
    if (drawingsCanvas) {
      state.container.insertBefore(state.canvas, drawingsCanvas);
    } else {
      state.container.appendChild(state.canvas);
    }
    state.ctx = state.canvas.getContext('2d');
    _resizeCanvas();
  }

  function _resizeCanvas() {
    var c = state.canvas;
    if (!c || !state.container) return;
    var pane = _getLwcPaneRect();
    var rect = pane || state.container.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    c.style.left = rect.left + 'px';
    c.style.top = rect.top + 'px';
    c.style.width = rect.width + 'px';
    c.style.height = rect.height + 'px';
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
    if (state.ctx) state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function _getLwcPaneRect() {
    if (!state.container) return null;
    var containerRect = state.container.getBoundingClientRect();
    var canvases = Array.prototype.slice.call(
      state.container.querySelectorAll('canvas')
    ).filter(function (c) {
      return c !== state.canvas && !c.classList.contains('draw-overlay');
    });
    if (!canvases.length) return null;
    var best = null, bestArea = 0;
    for (var i = 0; i < canvases.length; i++) {
      var r = canvases[i].getBoundingClientRect();
      var area = r.width * r.height;
      if (r.width > 100 && r.height > 100 && area > bestArea) {
        best = r; bestArea = area;
      }
    }
    if (!best) return null;
    return {
      left: best.left - containerRect.left,
      top: best.top - containerRect.top,
      width: best.width,
      height: best.height,
    };
  }

  function _bindTimeScale() {
    // Re-render on resize too
    var ro = new ResizeObserver(function () {
      _resizeCanvas();
      _renderVP();
    });
    if (state.container) ro.observe(state.container);
  }

  // ── SETTINGS ──
  function _loadSettings() {
    try {
      var r = localStorage.getItem(STORAGE_KEY);
      state.settings = r ? Object.assign({}, DEFAULTS, JSON.parse(r)) : Object.assign({}, DEFAULTS);
    } catch (e) {
      state.settings = Object.assign({}, DEFAULTS);
    }
  }

  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings)); } catch (e) {}
  }

  function updateSettings(s) {
    Object.assign(state.settings, s);
    saveSettings();
    _calcVP();
    _renderVP();
  }

  function getSettings() { return Object.assign({}, state.settings); }

  // ── SET CANDLES (called after each fetch) ──
  function setCandles(candles) {
    state.candles = candles || [];
    _calcVP();
    _renderVP();
  }

  // ── CALCULATION ──
  function _calcVP() {
    if (!state.settings.active) { state.data = null; return; }
    var candles = state.candles;
    if (!candles || candles.length < 2) { state.data = null; return; }

    var s = state.settings;
    var bucketSize = s.bucketSize;

    // Filter candles by period
    var filtered = _filterPeriod(candles, s.period);
    if (!filtered || filtered.length < 2) { state.data = null; return; }

    // Find price range
    var minPrice = Infinity, maxPrice = -Infinity;
    for (var i = 0; i < filtered.length; i++) {
      var c = filtered[i];
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
    }

    // Build price buckets
    var step = bucketSize;
    // For sub-dollar assets, scale bucket size down
    if (maxPrice < 10) step = Math.max(step * 0.01, 0.01);
    else if (maxPrice < 100) step = Math.max(step * 0.1, 0.1);
    else if (maxPrice < 1000) step = Math.max(step, 1);

    var buckets = {};

    for (var j = 0; j < filtered.length; j++) {
      var ci = filtered[j];
      var lo = Math.floor(ci.low / step) * step;
      var hi = Math.ceil(ci.high / step) * step;
      var numB = Math.max(1, Math.round((hi - lo) / step));

      for (var k = 0; k < numB; k++) {
        var pp = lo + k * step;
        var key = pp.toFixed(2);
        buckets[key] = (buckets[key] || 0) + (ci.volume / numB);
      }
    }

    // Convert to sorted array
    var bucketArray = [];
    for (var bk in buckets) {
      if (buckets.hasOwnProperty(bk)) {
        bucketArray.push({ price: parseFloat(bk), volume: buckets[bk] });
      }
    }
    bucketArray.sort(function (a, b) { return a.price - b.price; });

    if (bucketArray.length === 0) { state.data = null; return; }

    // POC = bucket with highest volume
    var pocBucket = bucketArray[0];
    var totalVol = 0;
    for (var m = 0; m < bucketArray.length; m++) {
      totalVol += bucketArray[m].volume;
      if (bucketArray[m].volume > pocBucket.volume) pocBucket = bucketArray[m];
    }

    // Value Area: expand from POC outward until we reach VA%
    var vaRatio = s.vaPercent / 100;
    var vaVol = pocBucket.volume;
    var pocIdx = -1;
    for (var n = 0; n < bucketArray.length; n++) {
      if (bucketArray[n].price === pocBucket.price) { pocIdx = n; break; }
    }
    if (pocIdx === -1) { state.data = null; return; }

    var vah = pocBucket.price;
    var val = pocBucket.price;
    var leftIdx = pocIdx - 1;
    var rightIdx = pocIdx + 1;
    var targetVaVol = totalVol * vaRatio;

    while (vaVol < targetVaVol && (leftIdx >= 0 || rightIdx < bucketArray.length)) {
      var leftVol = leftIdx >= 0 ? bucketArray[leftIdx].volume : -1;
      var rightVol = rightIdx < bucketArray.length ? bucketArray[rightIdx].volume : -1;

      if (leftVol >= rightVol) {
        val = bucketArray[leftIdx].price;
        vaVol += leftVol;
        leftIdx--;
      } else {
        vah = bucketArray[rightIdx].price;
        vaVol += rightVol;
        rightIdx++;
      }
    }

    // Compute max volume for normalization
    var maxVol = pocBucket.volume;

    // Store
    state.data = {
      poc: pocBucket.price,
      vah: vah,
      val: val,
      pocVolume: pocBucket.volume,
      totalVolume: totalVol,
      maxVolume: maxVol,
      buckets: bucketArray,
      bucketSize: step,
      candleCount: filtered.length,
    };
  }

  function _filterPeriod(candles, period) {
    if (!candles || !candles.length) return null;
    if (period === 'visible') {
      // Use ALL candles (the chart shows the visible range, but for VP we want context)
      // Return all candles — the user can see the full picture
      return candles;
    }
    var now = Math.floor(Date.now() / 1000);
    var todayStart = Math.floor(now / 86400) * 86400;
    var cutoff;
    switch (period) {
      case 'day':   cutoff = todayStart; break;
      case 'week':  cutoff = todayStart - 6 * 86400; break;
      case 'month': cutoff = todayStart - 29 * 86400; break;
      default:      return candles;
    }
    var result = [];
    for (var i = 0; i < candles.length; i++) {
      if (candles[i].time >= cutoff) result.push(candles[i]);
    }
    return result.length >= 2 ? result : candles;
  }

  // ── RENDER ──
  function _renderVP() {
    var ctx = state.ctx;
    if (!ctx || !state.canvas || !state.settings.active || !state.data) {
      _clearCanvas();
      return;
    }

    var dpr = window.devicePixelRatio || 1;
    var cw = state.canvas.width / dpr;
    var ch = state.canvas.height / dpr;
    var s = state.settings;
    var vp = state.data;
    var ser = state.series;

    ctx.clearRect(0, 0, cw, ch);

    // Histogram width (% of canvas width)
    var histWidth = Math.min(80, cw * 0.12);
    var histX = cw - histWidth;

    // Draw vertical background strip for histogram
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(histX, 0, histWidth, ch);
    ctx.restore();

    // Draw each bucket as a horizontal bar
    var minVis = Infinity, maxVis = -Infinity;
    if (ser && ser.coordinateToPrice) {
      minVis = ser.coordinateToPrice(ch);
      maxVis = ser.coordinateToPrice(0);
    }

    ctx.save();
    for (var i = 0; i < vp.buckets.length; i++) {
      var b = vp.buckets[i];

      // Price → y coordinate
      var py = null;
      try {
        if (ser && ser.priceToCoordinate) {
          py = ser.priceToCoordinate(b.price);
        } else {
          py = null;
        }
      } catch (e) { py = null; }
      if (py == null || isNaN(py)) continue;

      // Bar width proportional to volume (max = histWidth)
      var ratio = vp.maxVolume > 0 ? b.volume / vp.maxVolume : 0;
      var barW = Math.max(2, ratio * histWidth);
      var barX = cw - barW;

      // Color: HVN = bright, LVN = dim
      var isPOC = b.price === vp.poc;
      var isVAH = b.price === vp.vah;
      var isVAL = b.price === vp.val;

      var isInVA = b.price <= vp.vah && b.price >= vp.val;
      var alpha = 0.3 + ratio * 0.5;
      var color = isPOC ? s.colorPOC
                : isInVA ? s.colorHvn
                : s.colorLvn;

      // Blend color with alpha
      ctx.globalAlpha = isPOC ? 0.7 : alpha;
      ctx.fillStyle = color;
      ctx.fillRect(barX, py - 1, barW, 2);

      ctx.globalAlpha = isPOC ? 0.4 : alpha * 0.3;
      ctx.fillStyle = color;
      ctx.fillRect(barX, py - 4, barW, 8);
    }
    ctx.restore();

    // ── POC LINE ──
    if (s.showPOC && vp.poc != null) {
      var pocY = null;
      try { pocY = ser.priceToCoordinate(vp.poc); } catch (e) {}
      if (pocY != null && !isNaN(pocY)) {
        ctx.save();
        ctx.strokeStyle = s.colorPOC;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(0, pocY);
        ctx.lineTo(cw, pocY);
        ctx.stroke();

        // Label
        ctx.fillStyle = s.colorPOC;
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.globalAlpha = 0.9;
        ctx.fillText('POC ' + vp.poc.toFixed(2), 6, pocY - 4);
        ctx.restore();
      }
    }

    // ── VAH LINE ──
    if (s.showVAH && vp.vah != null) {
      var vahY = null;
      try { vahY = ser.priceToCoordinate(vp.vah); } catch (e) {}
      if (vahY != null && !isNaN(vahY)) {
        ctx.save();
        ctx.strokeStyle = s.colorVAH;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.moveTo(0, vahY);
        ctx.lineTo(cw, vahY);
        ctx.stroke();

        ctx.fillStyle = s.colorVAH;
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.globalAlpha = 0.85;
        ctx.fillText('VAH ' + vp.vah.toFixed(2), cw - 4, vahY - 4);
        ctx.restore();
      }
    }

    // ── VAL LINE ──
    if (s.showVAL && vp.val != null) {
      var valY = null;
      try { valY = ser.priceToCoordinate(vp.val); } catch (e) {}
      if (valY != null && !isNaN(valY)) {
        ctx.save();
        ctx.strokeStyle = s.colorVAL;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.moveTo(0, valY);
        ctx.lineTo(cw, valY);
        ctx.stroke();

        ctx.fillStyle = s.colorVAL;
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.globalAlpha = 0.85;
        ctx.fillText('VAL ' + vp.val.toFixed(2), cw - 4, valY + 4);
        ctx.restore();
      }
    }

    // ── INFO BADGE ──
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.globalAlpha = 0.5;
    var infoTxt = 'VP ' + vp.bucketSize + '$\xa0|\xa0' + vp.candleCount + ' candles';
    ctx.fillText(infoTxt, 6, 6);
    ctx.restore();
  }

  function _clearCanvas() {
    var ctx = state.ctx;
    if (!ctx || !state.canvas) return;
    ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
  }

  // ── EXPOSED API ──
  window.VolumeProfile = {
    init: init,
    destroy: destroy,
    setCandles: setCandles,
    updateSettings: updateSettings,
    getSettings: getSettings,
    render: _renderVP,
  };

})();

// ---- 066_orderflow_engine.js ----
// ---------- Orderflow Engine v0.1 — Canvas 2D Custom ----------
// Phase 1 : squelette moteur — axes, grille, zoom, pan, crosshair
// Aucune dépendance à Lightweight Charts ou à la page Chart classique

/**
 * @typedef {Object} OFPoint
 * @property {number} x - pixel
 * @property {number} y - pixel
 */

/**
 * @typedef {Object} PriceScale
 * @property {number} minPrice
 * @property {number} maxPrice
 * @property {number} height
 * @property {number} topMargin
 * @property {number} bottomMargin
 * @property {number} pixelsPerUnit
 */

/**
 * @typedef {Object} TimeScale
 * @property {number} startTime
 * @property {number} endTime
 * @property {number} width
 * @property {number} leftMargin
 * @property {number} rightMargin
 * @property {number} pixelsPerMs
 */

(function () {
  'use strict';

  // ============================================================
  // OrderflowEngine — classe principale, boucle rAF
  // ============================================================

  var OF = window.OF = {};

  function OrderflowEngine(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) throw new Error('Canvas #' + canvasId + ' not found');
    this.ctx = this.canvas.getContext('2d');

    // Scales
    this.priceScale = {
      minPrice: 60000,
      maxPrice: 75000,
      height: 1,
      topMargin: 30,
      bottomMargin: 40,
      get pixelsPerUnit() { return (this.height - this.topMargin - this.bottomMargin) / (this.maxPrice - this.minPrice); }
    };

    this.timeScale = {
      startTime: Date.now() - 24 * 60 * 60 * 1000,
      endTime: Date.now(),
      width: 1,
      leftMargin: 10,
      rightMargin: 10,
      get pixelsPerMs() { return (this.width - this.leftMargin - this.rightMargin) / (this.endTime - this.startTime); }
    };

    // Scroll / zoom state
    this.dpr = 1;
    this.isDragging = false;
    this.dragStart = { x: 0, y: 0 };
    this.scrollStart = { x: 0, y: 0 };
    this.mousePos = { x: 0, y: 0 };
    this.inCanvas = false;

    // Indicateur de dirty — on ne redraw que si nécessaire
    this._dirty = true;

    // Dernières dimensions connues (pour détecter les changements)
    this._lastW = 0;
    this._lastH = 0;

    // Binding des events
    this._bindEvents();

    // Candles data
    this._candles = [];
    this._isLiveData = false;
    this._loading = false;
    this._error = null;
    this._symbol = 'BTCUSDT';
    this._interval = '3m';
    this._tickSize = 10;
    this._intervalMs = 180000;

    // Statut
    this._setStatus('ready');
    console.log('[OrderflowEngine] initialized');

    // Load mock data
    this._loadMockData();
  }

  OrderflowEngine.prototype._setStatus = function (msg) {
    var el = document.getElementById('ofStatus');
    if (el) el.textContent = msg;
  };

  // ============================================================
  // Resize
  // ============================================================

  OrderflowEngine.prototype._handleResize = function () {
    var rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    var w = rect.width;
    var h = rect.height;

    // Mettre à jour les dimensions du canvas (logique)
    this.canvas.width = w * this.dpr;
    this.canvas.height = h * this.dpr;
    // CSS gère l'affichage

    // Mettre à jour les scales
    this.priceScale.height = h;
    this.timeScale.width = w;

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this._dirty = true;
  };

  // ============================================================
  // Events
  // ============================================================

  OrderflowEngine.prototype._bindEvents = function () {
    var self = this;
    var c = this.canvas;

    // Mouse wheel — scroll temps (defaut), zoom prix (Shift+wheel)
    c.addEventListener('wheel', function (e) {
      e.preventDefault();

      if (e.ctrlKey || e.metaKey) {
        // Ctrl+Wheel = zoom prix
        self._zoomPrice(e.offsetY, e.deltaY < 0 ? 1.08 : 0.92);
        return;
      }

      if (e.deltaY !== 0) {
        if (e.shiftKey) {
          // Shift+Wheel = scroll temps (horizontal)
          var p = Math.abs(e.deltaY) * 0.6;
          self._scrollTime(e.deltaY > 0 ? 1 : -1, p);
        } else {
          // Wheel = scroll prix (vertical) - comme une page
          self._panPrice(e.deltaY * 0.5);
        }
      }

      if (e.deltaX !== 0) {
        // Trackpad lateral = scroll temps
        self._scrollTime(e.deltaX > 0 ? 1 : -1, Math.abs(e.deltaX) * 0.6);
      }
    }, { passive: false });

    // Mouse down — début du drag
    c.addEventListener('mousedown', function (e) {
      self.isDragging = true;
      self.dragStart.x = e.offsetX;
      self.dragStart.y = e.offsetY;
      self.scrollStart.time = self.timeScale.startTime;
      self.scrollStart.price = self.priceScale.minPrice;
    });

    // Mouse move — drag / crosshair
    c.addEventListener('mousemove', function (e) {
      self.mousePos.x = e.offsetX;
      self.mousePos.y = e.offsetY;
      self.inCanvas = true;

      if (self.isDragging) {
        var dx = e.offsetX - self.dragStart.x;
        var dy = e.offsetY - self.dragStart.y;
        self._pan(dx, dy);
      } else {
        self._dirty = true;
      }
    });

    // Mouse up — fin du drag
    c.addEventListener('mouseup', function () {
      self.isDragging = false;
    });

    // Mouse leave
    c.addEventListener('mouseleave', function () {
      self.inCanvas = false;
      self.isDragging = false;
      self._dirty = true;
    });

    // Double-click — reset zoom
    c.addEventListener('dblclick', function () {
      self._resetView();
    });

    // Resize
    window.addEventListener('resize', function () {
      self._handleResize();
    });

    // Symbol buttons
    self._bindTopbarClicks();
  };

  /** Bind clicks on topbar symbol/timeframe buttons */
  OrderflowEngine.prototype._bindTopbarClicks = function () {
    var self = this;
    var pairBtns = document.querySelectorAll('.of-pair-btn');
    var tfBtns = document.querySelectorAll('.of-tf-btn');

    pairBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var symbol = this.dataset.symbol;
        if (symbol === self._symbol) return;
        pairBtns.forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        self._symbol = symbol;
        self.loadData(symbol, self._interval);
      });
    });

    tfBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var interval = this.dataset.interval;
        if (interval === self._interval) return;
        tfBtns.forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        self._interval = interval;
        self.loadData(self._symbol, interval);
      });
    });
  };

  // ============================================================
  // Transformations
  // ============================================================

  /**
   * Convertir un prix en pixel Y
   * @param {number} price
   * @returns {number}
   */
  OrderflowEngine.prototype.priceToY = function (price) {
    var ps = this.priceScale;
    return ps.topMargin + (ps.maxPrice - price) * ps.pixelsPerUnit;
  };

  /**
   * Convertir un pixel Y en prix
   * @param {number} y
   * @returns {number}
   */
  OrderflowEngine.prototype.yToPrice = function (y) {
    var ps = this.priceScale;
    return ps.maxPrice - (y - ps.topMargin) / ps.pixelsPerUnit;
  };

  /**
   * Convertir un timestamp en pixel X
   * @param {number} time - timestamp ms
   * @returns {number}
   */
  OrderflowEngine.prototype.timeToX = function (time) {
    var ts = this.timeScale;
    return ts.leftMargin + (time - ts.startTime) * ts.pixelsPerMs;
  };

  /**
   * Convertir un pixel X en timestamp
   * @param {number} x
   * @returns {number}
   */
  OrderflowEngine.prototype.xToTime = function (x) {
    var ts = this.timeScale;
    return ts.startTime + (x - ts.leftMargin) / ts.pixelsPerMs;
  };

  // ============================================================
  // Zoom / Pan / Scroll
  // ============================================================

  /**
   * Zoom vertical centré sur un pixel Y
   * @param {number} y - centre du zoom en pixels
   * @param {number} factor - >1 zoom in, <1 zoom out
   */
  OrderflowEngine.prototype._zoomPrice = function (y, factor) {
    var ps = this.priceScale;
    var centerPrice = this.yToPrice(y);
    var range = ps.maxPrice - ps.minPrice;
    var newRange = range * (1 / factor);

    // Limiter le zoom
    if (newRange < 10) newRange = 10;   // ~$10 minimum
    if (newRange > 100000) newRange = 100000; // ~$100k maximum

    ps.minPrice = centerPrice - (centerPrice - ps.minPrice) * (newRange / range);
    ps.maxPrice = ps.minPrice + newRange;

    this._dirty = true;
  };

  /**
   * Pan horizontal + vertical
   */
  OrderflowEngine.prototype._pan = function (dx, dy) {
    var ps = this.priceScale;
    var ts = this.timeScale;

    // Horizontal
    var dt = -dx / ts.pixelsPerMs;
    ts.startTime = this.scrollStart.time + dt;
    ts.endTime = ts.startTime + (this.timeScale.width - ts.leftMargin - ts.rightMargin) / ts.pixelsPerMs;

    // Vertical
    var dp = dy / ps.pixelsPerUnit;
    ps.minPrice = this.scrollStart.price + dp;
    ps.maxPrice = ps.minPrice + (this.priceScale.height - ps.topMargin - ps.bottomMargin) / ps.pixelsPerUnit;

    this._dirty = true;
  };

  /**
   * Scroll horizontal par ticks
   */
  OrderflowEngine.prototype._scrollTime = function (dir, pixels) {
    var ts = this.timeScale;
    var dt = (pixels * dir) / ts.pixelsPerMs;
    ts.startTime += dt;
    ts.endTime += dt;
    this._dirty = true;
  };

  /**
   * Reset view — tout afficher
   */
  OrderflowEngine.prototype._resetView = function () {
    var now = Date.now();
    this.timeScale.startTime = now - 24 * 60 * 60 * 1000;
    this.timeScale.endTime = now;
    this.priceScale.minPrice = 60000;
    this.priceScale.maxPrice = 75000;
    this._dirty = true;
  };

  // ============================================================
  // Rendu
  // ============================================================

  OrderflowEngine.prototype.render = function () {
    var ctx = this.ctx;
    var ps = this.priceScale;
    var ts = this.timeScale;

    // VÉRIFICATION DES DIMENSIONS en temps réel (getBoundingClientRect)
    // Le canvas peut être à 0×0 si la page était cachée au démarrage.
    var rect = this.canvas.getBoundingClientRect();
    var rw = Math.round(rect.width);
    var rh = Math.round(rect.height);

    if (rw !== this._lastW || rh !== this._lastH) {
      this._lastW = rw;
      this._lastH = rh;
      // Appliquer les nouvelles dimensions
      this.dpr = window.devicePixelRatio || 1;
      this.canvas.width = rw * this.dpr;
      this.canvas.height = rh * this.dpr;
      // CSS gère l'affichage (width:100%;height:100%)
      ps.height = rh;
      ts.width = rw;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this._dirty = true;
      // console.log('[OF] resize', rw, rh, 'dpr', this.dpr);
    }

    if (!this._dirty) return;
    this._dirty = false;

    // Protection: ne pas render si dimensions 0
    if (rw < 1 || rh < 1) return;
    
    var w = rw;
    var h = rh;

    // --- Clear ---
    ctx.clearRect(0, 0, w, h);

    // --- Background ---
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, w, h);

    // --- Grille ---
    this._drawGrid(ctx, w, h);

    // --- Footprint candles ---
    if (this._candles.length > 0) {
      this._drawFootprint(ctx, w, h);
      this._drawVolumeProfile(ctx, w, h);
    }

    // --- Axe prix (Y à droite) ---
    this._drawPriceAxis(ctx, w, h);

    // --- Axe temps (X en bas) ---
    this._drawTimeAxis(ctx, w, h);

    // --- Crosshair ---
    if (this.inCanvas) {
      this._drawCrosshair(ctx, w, h);
    }

    // --- Status bar info ---
    if (this.inCanvas) {
      this._drawTooltip(ctx);
    }
  };

  /**
   * Grille horizontale + verticale
   */
  OrderflowEngine.prototype._drawGrid = function (ctx, w, h) {
    var ps = this.priceScale;
    var ts = this.timeScale;

    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;

    // Niveaux de prix (tous les $200)
    var tickStep = this._nicePriceStep((ps.maxPrice - ps.minPrice) / 10);
    var startPrice = Math.floor(ps.minPrice / tickStep) * tickStep;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (var price = startPrice; price <= ps.maxPrice; price += tickStep) {
      var y = this.priceToY(price);
      if (y < ps.topMargin || y > h - ps.bottomMargin) continue;
      ctx.beginPath();
      ctx.moveTo(ts.leftMargin, y);
      ctx.lineTo(w - 10, y);
      ctx.stroke();
    }
  };

  /**
   * Axe prix à droite
   */
  OrderflowEngine.prototype._drawPriceAxis = function (ctx, w, h) {
    var ps = this.priceScale;
    var tickStep = this._nicePriceStep((ps.maxPrice - ps.minPrice) / 10);
    var startPrice = Math.floor(ps.minPrice / tickStep) * tickStep;

    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    for (var price = startPrice; price <= ps.maxPrice; price += tickStep) {
      var y = this.priceToY(price);
      if (y < ps.topMargin || y > h - ps.bottomMargin) continue;
      ctx.fillText(price.toFixed(0), w - 12, y);
    }
  };

  /**
   * Axe temps en bas
   */
  OrderflowEngine.prototype._drawTimeAxis = function (ctx, w, h) {
    var ts = this.timeScale;
    var ps = this.priceScale;
    var timeRange = ts.endTime - ts.startTime;

    // Déterminer un pas de temps lisible
    var stepMs = this._niceTimeStep(timeRange / 8);
    var startTime = Math.floor(ts.startTime / stepMs) * stepMs;

    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (var t = startTime; t <= ts.endTime; t += stepMs) {
      var x = this.timeToX(t);
      if (x < ts.leftMargin || x > w - ts.rightMargin) continue;

      // Petite marque
      ctx.beginPath();
      ctx.moveTo(x, h - ps.bottomMargin + 4);
      ctx.lineTo(x, h - ps.bottomMargin + 8);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Label
      var d = new Date(t);
      ctx.fillText(
        ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2),
        x, h - ps.bottomMargin + 10
      );
    }
  };

  /**
   * Crosshair
   */
  OrderflowEngine.prototype._drawCrosshair = function (ctx, w, h) {
    var mx = this.mousePos.x;
    var my = this.mousePos.y;
    var ps = this.priceScale;

    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;

    // Ligne verticale
    ctx.beginPath();
    ctx.moveTo(mx, ps.topMargin);
    ctx.lineTo(mx, h - ps.bottomMargin);
    ctx.stroke();

    // Ligne horizontale
    ctx.beginPath();
    ctx.moveTo(this.timeScale.leftMargin, my);
    ctx.lineTo(w - 10, my);
    ctx.stroke();

    ctx.restore();
  };

  /**
   * Tooltip — prix + temps sous le crosshair
   */
  OrderflowEngine.prototype._drawTooltip = function (ctx) {
    var mx = this.mousePos.x;
    var my = this.mousePos.y;
    var w = this.canvas.width / this.dpr;

    var price = this.yToPrice(my);
    var time = this.xToTime(mx);
    var d = new Date(time);

    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    var text = price.toFixed(1) + ' @ ' +
      ('0' + d.getHours()).slice(-2) + ':' +
      ('0' + d.getMinutes()).slice(-2) + ':' +
      ('0' + d.getSeconds()).slice(-2);

    var tw = ctx.measureText(text).width;
    var tx = Math.min(mx + 12, w - tw - 24);
    var ty = Math.max(8, my - 20);

    // Background
    // Fond du tooltip (fillRect pour compatibilité cross-browser)
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(tx - 4, ty - 2, tw + 8, 16);

    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(text, tx, ty);
  };

  // ============================================================
  // Helpers
  // ============================================================

  /**
   * Pas de prix "lisible" — arrondi à la puissance de 10 × 1/2/5
   */
  OrderflowEngine.prototype._nicePriceStep = function (rawStep) {
    var exp = Math.floor(Math.log10(rawStep));
    var mant = rawStep / Math.pow(10, exp);
    if (mant < 1.5) return Math.pow(10, exp);
    if (mant < 3.5) return 2 * Math.pow(10, exp);
    if (mant < 7.5) return 5 * Math.pow(10, exp);
    return 10 * Math.pow(10, exp);
  };

  /**
   * Pas de temps lisible (ms)
   */
  OrderflowEngine.prototype._niceTimeStep = function (rawMs) {
    var steps = [
      1000,          // 1s
      5000,          // 5s
      30000,         // 30s
      60000,         // 1m
      300000,        // 5m
      900000,        // 15m
      1800000,       // 30m
      3600000,       // 1h
      7200000,       // 2h
      14400000,      // 4h
      43200000,      // 12h
      86400000,      // 1d
    ];
    for (var i = 0; i < steps.length; i++) {
      if (steps[i] >= rawMs) return steps[i];
    }
    return steps[steps.length - 1];
  };

  // ============================================================
  // Pan vertical (scroll prix)
  // ============================================================

  OrderflowEngine.prototype._panPrice = function (pixels) {
    var ps = this.priceScale;
    var dp = pixels / ps.pixelsPerUnit;
    ps.minPrice += dp;
    ps.maxPrice += dp;
    this._dirty = true;
  };

  // ============================================================
  // Boucle rAF
  // ============================================================

  OrderflowEngine.prototype.start = function () {
    var self = this;
    function loop() {
      self.render();
      requestAnimationFrame(loop);
    }
    loop();
  };

  // ============================================================
  // Init automatique
  // ============================================================

  function initOrderflow() {
    if (document.querySelector('.page[data-page="orderflow"]')) {
      var engine = new OrderflowEngine('ofCanvas');
      window.__ofEngine = engine;
      engine.start();
    }
  }

  // Attendre que le DOM soit prêt
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOrderflow);
  } else {
    initOrderflow();
  }


  // ============================================================
  // Load real data from API
  // ============================================================

  OrderflowEngine.prototype.loadData = function (symbol, interval) {
    var self = this;
    this._symbol = symbol || this._symbol;
    this._interval = interval || this._interval;
    this._intervalMs = this._intervalToMs(this._interval);
    this._loading = true;
    this._error = null;
    this._setStatus('loading ' + this._symbol + ' ' + this._interval + '...');

    var now = Date.now();
    var rangeMs = 12 * 60 * 60 * 1000; // 12h de données
    var startTime = now - rangeMs;

    OF.DataService.fetchTrades(this._symbol, startTime, now, 3000)
      .then(function (trades) {
        if (!trades || trades.length === 0) {
          throw new Error('Aucune trade recue pour ' + self._symbol);
        }
        var candles = OF.Aggregator.aggregate(trades, self._intervalMs, self._tickSize);
        if (candles.length === 0) {
          throw new Error('Aggregation vide');
        }

        self._candles = candles;
        self._isLiveData = true;
        self._loading = false;

        // Ajuster les scales
        self._fitToData();
        self._dirty = true;
        self._setStatus(self._symbol + ' ' + self._interval + ' (' + candles.length + ' candles, ' + trades.length + ' trades)');
      })
      .catch(function (err) {
        console.warn('[OF] API error, fallback mock:', err.message);
        self._error = err.message;
        self._isLiveData = false;
        self._loadMockData();
        self._setStatus('mock (API: ' + err.message + ')');
      });
  };

  /** Convertir timeframe string en ms */
  OrderflowEngine.prototype._intervalToMs = function (interval) {
    var map = { '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000 };
    return map[interval] || 180000;
  };

  /** Ajuster les scales aux donnees chargees */
  OrderflowEngine.prototype._fitToData = function () {
    var candles = this._candles;
    if (!candles || candles.length === 0) return;

    var minP = candles[0].low, maxP = candles[0].high;
    for (var i = 0; i < candles.length; i++) {
      if (candles[i].low < minP) minP = candles[i].low;
      if (candles[i].high > maxP) maxP = candles[i].high;
    }
    var pad = (maxP - minP) * 0.1 || 100;
    this.priceScale.minPrice = minP - pad;
    this.priceScale.maxPrice = maxP + pad;
    this.timeScale.startTime = candles[0].time;
    this.timeScale.endTime = candles[candles.length - 1].time + this._intervalMs * 3;
  };

  // ============================================================
  // Mock Data Generator — 200 candles footprint
  // ============================================================

  /**
   * @returns {Array} candles avec levels [{price, bid, ask, delta}]
   */
  OF._generateMockCandles = function (count) {
    var candles = [];
    var now = Date.now();
    var intervalMs = 3 * 60 * 1000; // 3m
    var price = 68500 + Math.random() * 2000;
    var tickSize = 10; // $10 buckets

    for (var i = 0; i < count; i++) {
      var time = now - (count - i) * intervalMs;

      // Random walk
      var change = (Math.random() - 0.48) * 400;
      price += change;
      if (price < 60000) price = 60000 + Math.random() * 1000;
      if (price > 80000) price = 80000 - Math.random() * 1000;

      var open = price;
      var close = price + (Math.random() - 0.48) * 120;
      var high = Math.max(open, close) + Math.random() * 80;
      var low = Math.min(open, close) - Math.random() * 80;

      // Build price levels around candle range
      var levels = [];
      var levelCount = 15 + Math.floor(Math.random() * 30);
      var basePrice = Math.floor(low / tickSize) * tickSize;
      var maxLevel = Math.ceil(high / tickSize) * tickSize;

      for (var p = basePrice; p <= maxLevel; p += tickSize) {
        // More volume near high/low (trading activity clusters)
        var proximity = 1 - Math.abs(p - (high + low) / 2) / ((high - low) || 1);
        var baseVol = (0.3 + proximity * 0.7) * (0.5 + Math.random());

        // Generate imbalance based on candle direction
        var bullBias = (close - open) / (high - low + 1) * 2;
        var bid = baseVol * (1 + Math.max(0, bullBias) * 0.5 + Math.random() * 0.3);
        var ask = baseVol * (1 + Math.max(0, -bullBias) * 0.5 + Math.random() * 0.3);

        // Occasional absorption zone (high volume both sides)
        if (Math.random() < 0.12) {
          bid *= 2 + Math.random() * 2;
          ask *= 2 + Math.random() * 2;
        }

        var delta = bid - ask;
        levels.push({
          price: p,
          bid: Math.round(bid * 10) / 10,
          ask: Math.round(ask * 10) / 10,
          delta: Math.round(delta * 10) / 10
        });
      }

      candles.push({
        time: time,
        open: Math.round(open * 100) / 100,
        high: Math.round(high * 100) / 100,
        low: Math.round(low * 100) / 100,
        close: Math.round(close * 100) / 100,
        volume: Math.round((Math.random() * 500 + 100) * 100) / 100,
        levels: levels
      });
    }
    return candles;
  };

  // ============================================================
  // Load mock data into engine
  // ============================================================

  OrderflowEngine.prototype._loadMockData = function () {
    this._candles = OF._generateMockCandles(200);

    // Auto-fit scales
    this._fitToData();

    this._dirty = true;
    this._setStatus('mock ' + this._candles.length + ' candles');
  };

  // ============================================================
  // Footprint renderer
  // ============================================================

  OrderflowEngine.prototype._drawFootprint = function (ctx, w, h) {
    var candles = this._candles;
    if (!candles || candles.length === 0) return;

    var ps = this.priceScale;
    var ts = this.timeScale;
    var visibleStart = ts.startTime;
    var visibleEnd = ts.endTime;

    // Espacement entre bougies
    var candleGap = 0.2; // 20% de l'espace en gap
    var candleW = (ts.pixelsPerMs * (candles[1] ? (candles[1].time - candles[0].time) : 180000)) * (1 - candleGap);
    if (candleW < 4) candleW = 4;
    if (candleW > 40) candleW = 40;

    for (var i = 0; i < candles.length; i++) {
      var c = candles[i];
      if (c.time < visibleStart - 60000 || c.time > visibleEnd + 60000) continue;

      var cx = this.timeToX(c.time);
      if (cx < -candleW || cx > w + candleW) continue;

      var yOpen = this.priceToY(c.open);
      var yClose = this.priceToY(c.close);
      var yHigh = this.priceToY(c.high);
      var yLow = this.priceToY(c.low);

      var isBull = c.close >= c.open;

      // --- Wick ---
      ctx.strokeStyle = isBull ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, yHigh);
      ctx.lineTo(cx, yLow);
      ctx.stroke();

      // --- Body ---
      var bodyTop = Math.max(yOpen, yClose);
      var bodyBottom = Math.min(yOpen, yClose);
      var bodyH = bodyBottom - bodyTop;
      if (bodyH < 2) bodyH = 2;

      ctx.fillStyle = isBull ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)';
      ctx.fillRect(cx - candleW / 2, bodyTop, candleW, bodyH);

      // --- Footprint levels ---
      if (!c.levels || c.levels.length === 0) continue;

      // Find max volumes in this candle for scaling
      var maxBid = 0, maxAsk = 0;
      for (var li = 0; li < c.levels.length; li++) {
        var lv = c.levels[li];
        if (lv.bid > maxBid) maxBid = lv.bid;
        if (lv.ask > maxAsk) maxAsk = lv.ask;
      }
      if (maxBid < 1) maxBid = 1;
      if (maxAsk < 1) maxAsk = 1;

      var halfW = candleW / 2;

      for (var li = 0; li < c.levels.length; li++) {
        var lv = c.levels[li];
        var y = this.priceToY(lv.price);

        // Skip levels outside candle range (high→low)
        if (y > yHigh - 2 || y < yLow + 2) continue;

        var bidPx = (lv.bid / maxBid) * halfW;
        var askPx = (lv.ask / maxAsk) * halfW;

        // Bid volume (green) — left side
        var barH = Math.max(4, Math.min(20, halfW * 0.6));
        if (bidPx > 0.5) {
          ctx.fillStyle = 'rgba(34,197,94,' + Math.min(0.7, 0.2 + (bidPx / halfW) * 0.5) + ')';
          ctx.fillRect(cx - bidPx, y - barH/2, bidPx, barH);
        }

        // Ask volume (red) — right side
        if (askPx > 0.5) {
          ctx.fillStyle = 'rgba(239,68,68,' + Math.min(0.7, 0.2 + (askPx / halfW) * 0.5) + ')';
          ctx.fillRect(cx, y - barH/2, askPx, barH);
        }

        // Delta dot: small circle if imbalance > 3:1
        var ratio = maxBid > maxAsk ? lv.bid / (lv.ask || 0.01) : lv.ask / (lv.bid || 0.01);
        if (ratio > 3) {
          ctx.fillStyle = lv.delta > 0 ? '#22c55e' : '#ef4444';
          ctx.beginPath();
          ctx.arc(cx + (lv.delta > 0 ? halfW + 4 : -halfW - 4), y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  };

  // ============================================================
  // Volume Profile renderer (side histogram)
  // ============================================================

  OrderflowEngine.prototype._drawVolumeProfile = function (ctx, w, h) {
    var candles = this._candles;
    if (!candles || candles.length === 0) return;

    var ps = this.priceScale;
    var ts = this.timeScale;
    var vpWidth = 60; // pixels for VP panel
    var vpX = w - vpWidth - 5; // position (just left of price axis)

    var visibleStart = ts.startTime;
    var visibleEnd = ts.endTime;

    // Accumulate volume by price level
    var volMap = {};
    var maxVolLevel = 0;
    var tickSize = 10;

    for (var i = 0; i < candles.length; i++) {
      var c = candles[i];
      if (c.time < visibleStart || c.time > visibleEnd) continue;
      if (!c.levels) continue;

      for (var li = 0; li < c.levels.length; li++) {
        var lv = c.levels[li];
        var bucket = Math.floor(lv.price / tickSize) * tickSize;
        if (!volMap[bucket]) volMap[bucket] = 0;
        volMap[bucket] += lv.bid + lv.ask;
        if (volMap[bucket] > maxVolLevel) maxVolLevel = volMap[bucket];
      }
    }

    if (maxVolLevel < 1) return;

    // Sort price levels
    var prices = Object.keys(volMap).map(Number).sort(function (a, b) { return b - a; });

    // Calculate POC, VAH, VAL
    var totalVol = prices.reduce(function (sum, p) { return sum + volMap[p]; }, 0);
    var pocPrice = prices.reduce(function (best, p) {
      return volMap[p] > volMap[best] ? p : best;
    }, prices[0]);

    // Value Area: 70% of volume around POC
    var sortedDesc = prices.slice().sort(function (a, b) { return volMap[b] - volMap[a]; });
    var vaVol = 0;
    var vaPrices = [];
    for (var vi = 0; vi < sortedDesc.length; vi++) {
      vaPrices.push(sortedDesc[vi]);
      vaVol += volMap[sortedDesc[vi]];
      if (vaVol / totalVol >= 0.7) break;
    }
    var vah = vaPrices.reduce(function (a, b) { return Math.max(a, b); }, -Infinity);
    var val = vaPrices.reduce(function (a, b) { return Math.min(a, b); }, Infinity);

    // Draw VP histogram
    for (var pi = 0; pi < prices.length; pi++) {
      var price = prices[pi];
      var vol = volMap[price];
      var y = this.priceToY(price);
      var barW = (vol / maxVolLevel) * vpWidth;

      // VA range: ligne horizontale subtile aux extremites
      if (price <= vah && price >= val && (price === vah || price === val)) {
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(vpX, y);
        ctx.lineTo(vpX + vpWidth, y);
        ctx.stroke();
      }

      // Volume bar
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(vpX + vpWidth - barW, y - 3, barW, 6);

      // POC line
      if (price === pocPrice) {
        ctx.strokeStyle = 'rgba(245,158,11,0.6)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(vpX, y);
        ctx.lineTo(vpX + vpWidth, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // VAH/VAL labels
    ctx.font = '8px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(34,197,94,0.5)';
    ctx.textAlign = 'left';
    ctx.fillText('VAH', vpX + vpWidth + 4, this.priceToY(vah) + 3);
    ctx.fillStyle = 'rgba(239,68,68,0.5)';
    ctx.fillText('VAL', vpX + vpWidth + 4, this.priceToY(val) + 3);

    // POC label
    ctx.fillStyle = 'rgba(245,158,11,0.7)';
    ctx.fillText('POC', vpX + vpWidth + 4, this.priceToY(pocPrice) + 3);
  };



  // ============================================================
  // OrderflowDataService — fetch trades from API
  // ============================================================

  var CACHE_TTL = 30000; // 30s

  OF.DataService = {
    _cache: {},

    /** Fetch aggTrades (auto-paginate: max 5 pages x 1000 = 5000 trades) */
    fetchTrades: function (symbol, startTime, endTime, limit) {
      var cacheKey = symbol + ':' + (startTime || '') + ':' + (endTime || '');
      var cached = this._cache[cacheKey];
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        return Promise.resolve(cached.trades);
      }

      var self = this;
      var allTrades = [];
      var pagesLeft = 5;
      var currentEnd = endTime;

      function fetchPage() {
        var url = '/api/market/aggtrades?symbol=' + encodeURIComponent(symbol)
          + '&limit=1000';
        if (startTime) url += '&startTime=' + startTime;
        if (currentEnd) url += '&endTime=' + currentEnd;

        return fetch(url)
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + r.statusText);
            return r.json();
          })
          .then(function (data) {
            if (data.error) throw new Error(data.error);
            var batch = data.trades || [];
            if (batch.length === 0) return allTrades;

            allTrades = batch.concat(allTrades);
            var lim = limit || 1000;

            if (allTrades.length >= lim || batch.length < 1000 || pagesLeft <= 1) {
              if (allTrades.length > lim) allTrades = allTrades.slice(-lim);
              self._cache[cacheKey] = { ts: Date.now(), trades: allTrades };
              return allTrades;
            }

            pagesLeft--;
            currentEnd = batch[0].time - 1;
            return fetchPage();
          });
      }

      return fetchPage();
    },

    /** Clear cache (e.g., on symbol change) */
    clearCache: function () {
      this._cache = {};
    }
  };

  // ============================================================
  // OrderflowAggregator — trades → footprint candles
  // ============================================================

  OF.Aggregator = {

    /**
     * Aggregate trades into footprint candles.
     * @param {Array} trades — [{time, price, qty, side}]
     * @param {number} intervalMs — candle interval in ms (e.g. 180000 for 3m)
     * @param {number} tickSize — price bucket size (e.g. 10 for BTC)
     * @returns {Array} footprints candles
     */
    aggregate: function (trades, intervalMs, tickSize) {
      if (!trades || trades.length === 0) return [];

      tickSize = tickSize || 10;
      intervalMs = intervalMs || 180000;

      // Grouper les trades par candle
      var candleMap = {};

      for (var i = 0; i < trades.length; i++) {
        var t = trades[i];
        // Floor au début de la bougie
        var candleTime = Math.floor(t.time / intervalMs) * intervalMs;

        if (!candleMap[candleTime]) {
          candleMap[candleTime] = {
            time: candleTime,
            open: t.price,
            high: t.price,
            low: t.price,
            close: t.price,
            volume: 0,
            delta: 0,
            levels: {}  // {priceKey: {bid, ask, delta}}
          };
        }

        var c = candleMap[candleTime];
        c.high = Math.max(c.high, t.price);
        c.low = Math.min(c.low, t.price);
        c.close = t.price;
        c.volume += t.qty;

        // Price level bucket
        var priceKey = Math.floor(t.price / tickSize) * tickSize;
        if (!c.levels[priceKey]) {
          c.levels[priceKey] = { bid: 0, ask: 0, delta: 0 };
        }

        var lv = c.levels[priceKey];
        if (t.side === 'buy') {
          lv.bid += t.qty;
          lv.delta += t.qty;
          c.delta += t.qty;
        } else {
          lv.ask += t.qty;
          lv.delta -= t.qty;
          c.delta -= t.qty;
        }
      }

      // Convertir en array trié par time
      var candles = Object.keys(candleMap).map(function (k) {
        var c = candleMap[k];
        // Convertir levels en array pour le rendu
        var levelsArr = [];
        var priceKeys = Object.keys(c.levels).map(Number).sort(function (a, b) { return a - b; });
        for (var pi = 0; pi < priceKeys.length; pi++) {
          var pk = priceKeys[pi];
          levelsArr.push({
            price: pk,
            bid: Math.round(c.levels[pk].bid * 100) / 100,
            ask: Math.round(c.levels[pk].ask * 100) / 100,
            delta: Math.round(c.levels[pk].delta * 100) / 100
          });
        }
        c.levels = levelsArr;
        return c;
      });

      candles.sort(function (a, b) { return a.time - b.time; });
      return candles;
    }
  };


})();
