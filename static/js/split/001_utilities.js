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

// ─────────────────────────────────────────────────────────────────────────
// V6 Orderflow Helpers (canvas/resize/observer)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Resize canvas for high-DPI displays (centralizes devicePixelRatio logic).
 * Sets both physical canvas size and CSS display size to avoid DPI blur.
 * @param {HTMLCanvasElement} canvas
 */
function resizeCanvasForDpr(canvas) {
  if (!canvas || !canvas.parentNode) return;
  var rect = canvas.parentNode.getBoundingClientRect();
  var dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
}

/**
 * Create a ResizeObserver that batches callbacks via requestAnimationFrame.
 * Returns an object with observe(el) and disconnect() methods.
 * @param {Function} callback - Called when resize detected (batched per frame)
 * @returns {Object} - { observe(el), disconnect() }
 */
function createResizeObserverRaf(callback) {
  if (typeof ResizeObserver === 'undefined') {
    return { observe: function() {}, disconnect: function() {} };
  }
  var rafId = null;
  var observer = new ResizeObserver(function () {
    if (rafId) return;
    rafId = requestAnimationFrame(function () {
      rafId = null;
      callback();
    });
  });
  var originalDisconnect = observer.disconnect.bind(observer);
  observer.disconnect = function () {
    if (rafId) cancelAnimationFrame(rafId);
    originalDisconnect();
  };
  return observer;
}

/**
 * ColorRamp: Smooth color interpolation for heatmap rendering.
 * Pre-computes 256-entry lookup table for fast O(1) color lookup.
 * @param {string} coldColor - CSS color (low intensity)
 * @param {string} hotColor - CSS color (high intensity)
 */
function ColorRamp(coldColor, hotColor) {
  this.coldColor = coldColor;
  this.hotColor = hotColor;
  this.lut = this._buildLUT();
}

ColorRamp.prototype._parseColor = function(color) {
  var canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  var data = ctx.getImageData(0, 0, 1, 1).data;
  return { r: data[0], g: data[1], b: data[2] };
};

ColorRamp.prototype._buildLUT = function() {
  var cold = this._parseColor(this.coldColor);
  var hot = this._parseColor(this.hotColor);
  var lut = [];
  for (var i = 0; i < 256; i++) {
    var t = i / 255;
    var r = Math.round(cold.r + (hot.r - cold.r) * t);
    var g = Math.round(cold.g + (hot.g - cold.g) * t);
    var b = Math.round(cold.b + (hot.b - cold.b) * t);
    lut.push('rgb(' + r + ',' + g + ',' + b + ')');
  }
  return lut;
};

ColorRamp.prototype.getColor = function(intensity) {
  var idx = Math.min(255, Math.max(0, Math.round(intensity * 255)));
  return this.lut[idx];
};

ColorRamp.prototype.getColorWithAlpha = function(intensity, alpha) {
  var color = this.getColor(intensity);
  var match = color.match(/\d+/g);
  return 'rgba(' + match[0] + ',' + match[1] + ',' + match[2] + ',' + alpha + ')';
};
