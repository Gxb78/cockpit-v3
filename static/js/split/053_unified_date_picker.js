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
