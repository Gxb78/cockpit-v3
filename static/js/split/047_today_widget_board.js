// ---------- Widget boards ----------

const WIDGET_ORDER_PREFIX = "cockpit:widgetOrder:";
const WIDGET_VIS_PREFIX = "cockpit:widgetVis:";

var WIDGET_REGISTRY = {
  kpi_total_pnl:      { label: "Net P&L",          icon: "dollar",  kind: "kpi",    size: "sm" },
  kpi_winrate:         { label: "Winrate",           icon: "clock",  kind: "kpi",    size: "sm" },
  kpi_average_rr:      { label: "Avg R",            icon: "trend",  kind: "kpi",    size: "sm" },
  kpi_trades:          { label: "Trades",            icon: "list",  kind: "kpi",    size: "sm" },
  kpi_profit_factor:   { label: "Profit Factor",    icon: "scale", kind: "kpi",    size: "sm" },
  kpi_expectancy:      { label: "Expectancy",        icon: "chart", kind: "kpi",    size: "sm" },
  today_context:       { label: "Contexte du jour",  icon: "globe", kind: "panel",  size: "full" },
  today_log:           { label: "Recap",             icon: "log",   kind: "panel",  size: "md" },
  today_activity:      { label: "Activite",          icon: "bolt",  kind: "panel",  size: "sm" },
  today_calendar:      { label: "Calendrier",        icon: "cal",   kind: "panel",  size: "md" },
};

var WIDGET_DEFAULTS = {
  "today-kpis": ["kpi_total_pnl", "kpi_winrate", "kpi_average_rr", "kpi_trades", "kpi_profit_factor", "kpi_expectancy"],
  "today-main": ["today_context", "today_log", "today_activity", "today_calendar"],
};

// ---- Persistence ----

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
  var kpiBoard = document.querySelector('[data-widget-board="today-kpis"]');
  var mainBoard = document.querySelector('[data-widget-board="today-main"]');
  if (kpiBoard) {
    var kpiVisible = Array.from(kpiBoard.children).filter(function(el) {
      return el.dataset && el.dataset.widgetKey && !el.classList.contains("widget-hidden");
    }).length;
    kpiBoard.dataset.visibleCount = kpiVisible;
    kpiBoard.classList.toggle("kpis-empty", kpiVisible === 0);
  }
  if (mainBoard) {
    var mainVisible = Array.from(mainBoard.children).filter(function(el) {
      return el.dataset && el.dataset.widgetKey && !el.classList.contains("widget-hidden");
    }).length;
    mainBoard.dataset.visibleCount = mainVisible;
    mainBoard.classList.toggle("panels-empty", mainVisible === 0);
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
  writeWidgetOrder("today-kpis", WIDGET_DEFAULTS["today-kpis"]);
  writeWidgetOrder("today-main", WIDGET_DEFAULTS["today-main"]);
  applyWidgetVisibility();
  applyWidgetBoardOrder(document.querySelector('[data-widget-board="today-kpis"]'));
  applyWidgetBoardOrder(document.querySelector('[data-widget-board="today-main"]'));
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
  var kpiContainer = document.getElementById("widgetConfigKpis");
  var panelContainer = document.getElementById("widgetConfigPanels");
  if (!kpiContainer || !panelContainer) return;
  var vis = readWidgetVisibility();
  var kpiOrder = readWidgetOrder("today-kpis");
  var mainOrder = readWidgetOrder("today-main");
  if (!kpiOrder.length) kpiOrder = WIDGET_DEFAULTS["today-kpis"];
  if (!mainOrder.length) mainOrder = WIDGET_DEFAULTS["today-main"];
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
  kpiContainer.innerHTML = kpiOrder.map(renderItem).join("");
  panelContainer.innerHTML = mainOrder.map(renderItem).join("");
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
  var kpiC = document.getElementById("widgetConfigKpis");
  var panelC = document.getElementById("widgetConfigPanels");
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
  kpiC.addEventListener("click", handleToggle);
  panelC.addEventListener("click", handleToggle);
  applyWidgetVisibility();
}

// ============================================================
// Drag & Drop v9 — FLIP + Placeholder DOM + Adaptive Spring
// Le CSS grid calcule les positions, FLIP anime les deltas.
// Hit-test pondéré par surface — les grands widgets n'écrasent pas les petits.
// ============================================================

var _dnd = null;
var _dndRaf = 0;
var DND_DEAD_ZONE = 12;
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
        _dnd = {
          el: widget, board: board,
          offsetX: pressStartX - rect.left,
          offsetY: pressStartY - rect.top,
          width: rect.width, height: rect.height,
          ghost: null, placeholder: null,
          active: false, items: null, lastToIdx: -1
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
  var el = _dnd.el, board = _dnd.board;

  var ph = document.createElement("div");
  ph.className = "widget-drag-placeholder";
  var cs = window.getComputedStyle(el);
  ph.style.gridColumn = cs.gridColumn || "";
  ph.style.gridRow    = cs.gridRow    || "";
  ph.style.width      = _dnd.width  + "px";
  ph.style.height     = _dnd.height + "px";
  ph.style.minHeight  = _dnd.height + "px";
  ph.style.minWidth   = _dnd.width  + "px";
  ph.style.boxSizing  = "border-box";
  board.insertBefore(ph, el);
  _dnd.placeholder = ph;

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
  _dnd.lastToIdx = -1;
}

function dndMove(cx, cy) {
  if (!_dnd) return;

  _dnd.ghost.style.transition = "none";
  _dnd.ghost.style.transform  = "translate(" + (cx - _dnd.offsetX) + "px," + (cy - _dnd.offsetY) + "px) scale(1.04)";

  var items = dndItemsWithPlaceholder(_dnd.board, _dnd.placeholder);
  var newIdx = dndHitTest(items, _dnd.board, cx, cy);

  if (newIdx === _dnd.lastToIdx) return;

  var beforeRects = items.map(function(i) { return i.getBoundingClientRect(); });

  var refNode = newIdx < items.length ? items[newIdx] : null;
  if (refNode === _dnd.placeholder) return;
  _dnd.board.insertBefore(_dnd.placeholder, refNode);
  _dnd.lastToIdx = newIdx;

  var afterRects = items.map(function(i) { return i.getBoundingClientRect(); });

  items.forEach(function(item, i) {
    if (item === _dnd.placeholder) return;
    var dx = beforeRects[i].left - afterRects[i].left;
    var dy = beforeRects[i].top  - afterRects[i].top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      item.style.transition = "transform 200ms cubic-bezier(0.25,1,0.5,1)";
      item.style.transform  = "";
      return;
    }
    var dist = Math.sqrt(dx * dx + dy * dy);
    var duration = Math.min(80 + dist * 0.35, 380);
    var easing = dist > 120
      ? "cubic-bezier(0.22, 1, 0.36, 1)"
      : "cubic-bezier(0.34, 1.56, 0.64, 1)";
    item.style.transition = "none";
    item.style.transform  = "translate(" + dx + "px," + dy + "px)";
    item.getBoundingClientRect();
    item.style.transition = "transform " + duration + "ms " + easing;
    item.style.transform  = "";
  });
}

function dndEnd() {
  if (!_dnd) return;
  var el = _dnd.el, board = _dnd.board, ph = _dnd.placeholder;

  Array.from(board.children).forEach(function(c) {
    c.style.transition = ""; c.style.transform = "";
  });

  el.classList.remove("widget-dragging");
  el.style.transition = ""; el.style.transform = "";
  if (ph && ph.parentNode === board) {
    board.insertBefore(el, ph);
    ph.remove();
  }

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

  var order = Array.from(board.children)
    .map(function(c) { return c.dataset && c.dataset.widgetKey; })
    .filter(Boolean);
  writeWidgetOrder(board.dataset.widgetBoard, order);
  updateDashboardLayout();
  setTimeout(refreshDragHandles, 300);
}

function dndItems(board) {
  return Array.from(board.children).filter(function(el) {
    return el && el.dataset && el.dataset.widgetKey
      && !el.classList.contains("widget-hidden");
  });
}

function dndItemsWithPlaceholder(board, ph) {
  return Array.from(board.children).filter(function(el) {
    if (!el) return false;
    if (el === ph) return true;
    return el.dataset && el.dataset.widgetKey && !el.classList.contains("widget-hidden");
  });
}

function dndHitTest(items, board, cx, cy) {
  var isH = board.dataset.widgetBoard === "today-kpis";
  var best = -1, bestScore = Infinity;

  for (var i = 0; i < items.length; i++) {
    var r = items[i].getBoundingClientRect();
    var centerX = r.left + r.width  / 2;
    var centerY = r.top  + r.height / 2;
    var area = Math.max(r.width * r.height, 1);
    var weight = 1 / Math.sqrt(area);
    var dx = (cx - centerX) * weight;
    var dy = (cy - centerY) * weight * (isH ? 0.1 : 1);
    var score = dx * dx + dy * dy;
    if (score < bestScore) { bestScore = score; best = i; }
  }

  if (best < 0) return items.length;

  var br = items[best].getBoundingClientRect();
  if (isH) {
    return cx < br.left + br.width / 2 ? best : best + 1;
  }
  var third = br.height / 3;
  var relY = cy - br.top;
  if (relY < third)             return best;
  if (relY > br.height - third) return best + 1;
  return best;
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