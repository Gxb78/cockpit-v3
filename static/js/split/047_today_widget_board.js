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

// ---- Drag & Drop ----

var _drag = null; // { el, board, ghost, startX, startY, offsetX, offsetY }

function refreshDragHandles() {
  document.querySelectorAll(".widget-board[data-widget-board] .widget[data-widget-key]").forEach(function(el) {
    var existing = el.querySelector(".widget-drag-handle");
    if (existing) { existing.remove(); }
    if (el.classList.contains("widget-hidden")) return;
    var handle = document.createElement("div");
    handle.className = "widget-drag-handle";
    handle.setAttribute("aria-label", "Deposer pour reorganiser");
    handle.innerHTML = '<svg viewBox="0 0 20 8" fill="currentColor"><circle cx="4" cy="2" r="1.2"/><circle cx="4" cy="6" r="1.2"/><circle cx="10" cy="2" r="1.2"/><circle cx="10" cy="6" r="1.2"/><circle cx="16" cy="2" r="1.2"/><circle cx="16" cy="6" r="1.2"/></svg>';
    el.prepend(handle);
    handle.addEventListener("pointerdown", onDragPointerDown);
  });
}

function onDragPointerDown(e) {
  if (e.button && e.button !== 0) return;
  var handle = e.currentTarget;
  var widget = handle.closest(".widget[data-widget-key]");
  if (!widget) return;
  var board = widget.closest(".widget-board[data-widget-board]");
  if (!board) return;
  e.preventDefault();
  handle.setPointerCapture(e.pointerId);

  var startX = e.clientX;
  var startY = e.clientY;
  var OFF_THRESHOLD = 6;
  var LONG_PRESS_MS = 160;
  var timer = null;
  var dragStarted = false;

  function onMove(ev) {
    var dx = ev.clientX - startX;
    var dy = ev.clientY - startY;
    if (!dragStarted && (Math.abs(dx) > OFF_THRESHOLD || Math.abs(dy) > OFF_THRESHOLD)) {
      clearTimeout(timer);
      dragStarted = true;
      startDrag(widget, board, e.clientX, e.clientY);
    }
    if (dragStarted && _drag) moveDrag(ev.clientX, ev.clientY);
  }

  function onUp(ev) {
    clearTimeout(timer);
    handle.removeEventListener("pointermove", onMove);
    handle.removeEventListener("pointerup", onUp);
    handle.removeEventListener("pointercancel", onUp);
    if (dragStarted && _drag) endDrag();
    if (!dragStarted) {
      // Long press expired without move — start drag anyway
    }
  }

  timer = setTimeout(function() {
    if (!dragStarted) {
      dragStarted = true;
      startDrag(widget, board, startX, startY);
    }
  }, LONG_PRESS_MS);

  handle.addEventListener("pointermove", onMove);
  handle.addEventListener("pointerup", onUp);
  handle.addEventListener("pointercancel", onUp);
}

function startDrag(widget, board, cx, cy) {
  var rect = widget.getBoundingClientRect();
  _drag = {
    el: widget,
    board: board,
    key: widget.dataset.widgetKey,
    ghost: null,
    placeholder: null,
    offsetX: cx - rect.left,
    offsetY: cy - rect.top,
    siblings: []
  };

  // Ghost: fixed clone that follows the cursor
  var ghost = widget.cloneNode(true);
  ghost.classList.add("widget-drag-ghost");
  ghost.style.position = "fixed";
  ghost.style.zIndex = "10000";
  ghost.style.width = rect.width + "px";
  ghost.style.height = rect.height + "px";
  ghost.style.left = (cx - _drag.offsetX) + "px";
  ghost.style.top = (cy - _drag.offsetY) + "px";
  ghost.style.pointerEvents = "none";
  ghost.style.transition = "box-shadow 0.18s ease, transform 0.18s ease";
  document.body.appendChild(ghost);
  _drag.ghost = ghost;

  // Placeholder: occupies the space
  var ph = document.createElement("div");
  ph.className = "widget-drag-placeholder";
  ph.style.width = rect.width + "px";
  ph.style.height = rect.height + "px";
  widget.parentNode.insertBefore(ph, widget);
  _drag.placeholder = ph;

  widget.dataset.widgetDragging = "1";
  widget.style.opacity = "0";
  widget.style.position = "absolute";
  widget.style.pointerEvents = "none";

  document.body.style.userSelect = "none";
  document.body.style.webkitUserSelect = "none";
}

function moveDrag(cx, cy) {
  if (!_drag) return;
  _drag.ghost.style.left = (cx - _drag.offsetX) + "px";
  _drag.ghost.style.top = (cy - _drag.offsetY) + "px";

  // Determine drop position
  var siblings = getVisibleSiblings(_drag.board, _drag.el);
  var insertBefore = null;

  for (var i = 0; i < siblings.length; i++) {
    var sib = siblings[i];
    var r = sib.getBoundingClientRect();
    var midY = r.top + r.height / 2;
    var midX = r.left + r.width / 2;
    // For horizontal rows (KPIs), use X center; for grids, use Y then X
    if (_drag.board.dataset.widgetBoard === "today-kpis") {
      if (cx < midX) { insertBefore = sib; break; }
    } else {
      if (cy < midY || (cy < midY + r.height / 2 && cx < midX)) { insertBefore = sib; break; }
    }
  }

  _drag.board.querySelectorAll("[data-widget-drop-before]").forEach(function(el) {
    el.removeAttribute("data-widget-drop-before");
  });
  _drag.board.querySelectorAll("[data-widget-drop-after]").forEach(function(el) {
    el.removeAttribute("data-widget-drop-after");
  });

  if (insertBefore) {
    insertBefore.setAttribute("data-widget-drop-before", "1");
  } else {
    var last = siblings[siblings.length - 1];
    if (last && last !== _drag.el) last.setAttribute("data-widget-drop-after", "1");
  }
}

function endDrag() {
  if (!_drag) return;

  // Determine final position
  var siblings = getVisibleSiblings(_drag.board, _drag.el);
  var dropTarget = _drag.board.querySelector("[data-widget-drop-before='1']");
  if (dropTarget) {
    _drag.board.insertBefore(_drag.el, dropTarget);
  } else {
    // After the last visible widget (or at end)
    var lastVis = siblings.length ? siblings[siblings.length - 1] : null;
    if (lastVis && lastVis.nextSibling) {
      _drag.board.insertBefore(_drag.el, lastVis.nextSibling);
    } else {
      _drag.board.appendChild(_drag.el);
    }
  }

  // Clean up
  _drag.el.removeAttribute("data-widget-dragging");
  _drag.el.style.opacity = "";
  _drag.el.style.position = "";
  _drag.el.style.pointerEvents = "";
  if (_drag.ghost && _drag.ghost.parentNode) _drag.ghost.remove();
  if (_drag.placeholder && _drag.placeholder.parentNode) _drag.placeholder.remove();
  _drag.board.querySelectorAll("[data-widget-drop-before]").forEach(function(el) { el.removeAttribute("data-widget-drop-before"); });
  _drag.board.querySelectorAll("[data-widget-drop-after]").forEach(function(el) { el.removeAttribute("data-widget-drop-after"); });

  document.body.style.userSelect = "";
  document.body.style.webkitUserSelect = "";

  // Persist order
  var boardKey = _drag.board.dataset.widgetBoard;
  var newOrder = Array.from(_drag.board.children)
    .map(function(el) { return el.dataset && el.dataset.widgetKey; })
    .filter(Boolean);
  writeWidgetOrder(boardKey, newOrder);
  updateDashboardLayout();

  _drag = null;
}

function getVisibleSiblings(board, exclude) {
  return Array.from(board.children).filter(function(el) {
    return el && el.dataset && el.dataset.widgetKey
      && el !== exclude
      && !el.classList.contains("widget-hidden")
      && !el.classList.contains("widget-drag-placeholder");
  });
}

function initWidgetDragDrop() {
  refreshDragHandles();
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