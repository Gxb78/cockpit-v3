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
    try { list[i](newValue, oldValue); } catch (_) {}
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

