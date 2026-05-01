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

// ---- Drag & Drop (v6 – Pointer Events + setPointerCapture) ----

var _dnd = null;
var _dndRaf = 0;

function initWidgetDragDrop() {
  refreshDragHandles();
  document.addEventListener("pointermove", onDndPointerMove, { passive: false });
  document.addEventListener("pointerup", onDndPointerUp);
  document.addEventListener("pointercancel", onDndPointerUp);
}

function refreshDragHandles() {
  if (_dnd) return;
  document.querySelectorAll(".widget-board[data-widget-board] .widget[data-widget-key]").forEach(function(el) {
    if (el.classList.contains("widget-hidden")) return;
    var existing = el.querySelector(".widget-drag-handle");
    if (existing) existing.remove();
    var handle = document.createElement("div");
    handle.className = "widget-drag-handle";
    handle.setAttribute("aria-label", "Drag to reorder");
    handle.innerHTML = '<svg viewBox="0 0 20 8" fill="currentColor"><circle cx="4" cy="2" r="1.2"/><circle cx="4" cy="6" r="1.2"/><circle cx="10" cy="2" r="1.2"/><circle cx="10" cy="6" r="1.2"/><circle cx="16" cy="2" r="1.2"/><circle cx="16" cy="6" r="1.2"/></svg>';
    el.prepend(handle);
    handle.addEventListener("pointerdown", onDndPointerDown);
  });
}

function onDndPointerDown(e) {
  if (_dnd) return;
  if (e.button && e.button !== 0) return;
  var handle = e.currentTarget;
  var widget = handle.closest(".widget[data-widget-key]");
  if (!widget) return;
  var board = widget.closest(".widget-board[data-widget-board]");
  if (!board) return;
  e.preventDefault();
  handle.setPointerCapture(e.pointerId);
  var rect = widget.getBoundingClientRect();
  _dnd = {
    el: widget,
    board: board,
    key: widget.dataset.widgetKey,
    ptrId: e.pointerId,
    handle: handle,
    startX: e.clientX,
    startY: e.clientY,
    offsetX: e.clientX - rect.left,
    offsetY: e.clientY - rect.top,
    width: rect.width,
    height: rect.height,
    ghost: null,
    placeholder: null,
    active: false,
    lastIdx: -2
  };
}

function onDndPointerMove(e) {
  if (!_dnd) return;
  if (!_dnd.active) {
    var dx = e.clientX - _dnd.startX;
    var dy = e.clientY - _dnd.startY;
    if (dx * dx + dy * dy < 25) return;
    dndStart();
  }
  if (_dnd.active) {
    e.preventDefault();
    if (!_dndRaf) {
      _dndRaf = requestAnimationFrame(function() {
        _dndRaf = 0;
        if (_dnd && _dnd.active) dndMove(e.clientX, e.clientY);
      });
    }
  }
}

function onDndPointerUp() {
  if (_dndRaf) { cancelAnimationFrame(_dndRaf); _dndRaf = 0; }
  if (!_dnd) return;
  if (_dnd.active) dndEnd();
  _dnd = null;
}

function dndStart() {
  _dnd.active = true;

  var ghost = _dnd.el.cloneNode(true);
  var gh = ghost.querySelector(".widget-drag-handle");
  if (gh) gh.remove();
  ghost.classList.add("widget-drag-ghost");
  ghost.style.position = "fixed";
  ghost.style.zIndex = "10000";
  ghost.style.width = _dnd.width + "px";
  ghost.style.height = _dnd.height + "px";
  ghost.style.left = "0";
  ghost.style.top = "0";
  ghost.style.margin = "0";
  ghost.style.pointerEvents = "none";
  ghost.style.willChange = "transform";
  var gx = _dnd.startX - _dnd.offsetX;
  var gy = _dnd.startY - _dnd.offsetY;
  ghost.style.transform = "translate(" + gx + "px," + gy + "px) scale(0.96)";
  ghost.style.opacity = "0.6";
  document.body.appendChild(ghost);
  _dnd.ghost = ghost;

  requestAnimationFrame(function() {
    if (!_dnd || !_dnd.ghost) return;
    _dnd.ghost.style.transition = "transform 140ms cubic-bezier(0.34,1.56,0.64,1), opacity 120ms ease, box-shadow 140ms ease";
    _dnd.ghost.style.transform = "translate(" + gx + "px," + gy + "px) scale(1.03)";
    _dnd.ghost.style.opacity = "0.95";
  });

  var ph = document.createElement("div");
  ph.className = "widget-drag-placeholder";
  ph.style.width = _dnd.width + "px";
  ph.style.height = _dnd.height + "px";
  _dnd.el.parentNode.insertBefore(ph, _dnd.el);
  _dnd.placeholder = ph;

  _dnd.el.classList.add("widget-dragging");
  document.body.classList.add("is-dragging");
}

function dndMove(cx, cy) {
  if (!_dnd) return;
  var gx = cx - _dnd.offsetX;
  var gy = cy - _dnd.offsetY;
  _dnd.ghost.style.transition = "none";
  _dnd.ghost.style.transform = "translate(" + gx + "px," + gy + "px) scale(1.03)";

  var idx = dndInsertionIndex(_dnd.board, cx, cy);
  if (idx === _dnd.lastIdx) return;
  _dnd.lastIdx = idx;

  var ref = idx === -1 ? null : dndSiblingAt(_dnd.board, idx);
  if (ref) {
    _dnd.board.insertBefore(_dnd.placeholder, ref);
  } else {
    _dnd.board.appendChild(_dnd.placeholder);
  }
}

function dndEnd() {
  if (!_dnd) return;

  var el = _dnd.el;
  var board = _dnd.board;
  var ghost = _dnd.ghost;
  var placeholder = _dnd.placeholder;

  board.insertBefore(el, placeholder);

  el.classList.remove("widget-dragging");

  el.style.transition = "transform 200ms cubic-bezier(0.34,1.56,0.64,1), opacity 150ms ease";
  el.style.transform = "scale(1.02)";
  el.style.opacity = "0.8";
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      el.style.transform = "scale(1)";
      el.style.opacity = "";
    });
  });
  setTimeout(function() {
    el.style.transition = "";
    el.style.transform = "";
  }, 220);

  if (ghost) ghost.remove();
  if (placeholder) placeholder.remove();
  document.body.classList.remove("is-dragging");

  var order = Array.from(board.children)
    .map(function(c) { return c.dataset && c.dataset.widgetKey; })
    .filter(Boolean);
  writeWidgetOrder(board.dataset.widgetBoard, order);
  updateDashboardLayout();
}

function dndSiblings(board) {
  return Array.from(board.children).filter(function(el) {
    return el && el.dataset && el.dataset.widgetKey
      && !el.classList.contains("widget-hidden")
      && !el.classList.contains("widget-drag-placeholder")
      && !el.classList.contains("widget-dragging");
  });
}

function dndSiblingAt(board, idx) {
  return dndSiblings(board)[idx] || null;
}

function dndInsertionIndex(board, cx, cy) {
  var siblings = dndSiblings(board);
  var n = siblings.length;
  if (n === 0) return -1;

  var isH = board.dataset.widgetBoard === "today-kpis";
  var rects = [];
  for (var i = 0; i < n; i++) {
    rects.push(siblings[i].getBoundingClientRect());
  }

  var bestGap = 0;
  var bestDist = Infinity;

  for (var i = 0; i <= n; i++) {
    var mx, my;
    if (isH) {
      if (i === 0) {
        mx = rects[0].left - 2;
        my = rects[0].top + rects[0].height / 2;
      } else if (i === n) {
        mx = rects[n - 1].right + 2;
        my = rects[n - 1].top + rects[n - 1].height / 2;
      } else {
        mx = (rects[i - 1].right + rects[i].left) / 2;
        my = (rects[i - 1].top + rects[i].top) / 2;
      }
    } else {
      if (i === 0) {
        mx = rects[0].left + rects[0].width / 2;
        my = rects[0].top - 4;
      } else if (i === n) {
        mx = rects[n - 1].left + rects[n - 1].width / 2;
        my = rects[n - 1].bottom + 4;
      } else {
        var prevR = rects[i - 1];
        var currR = rects[i];
        var sameRow = Math.abs((currR.top + currR.height / 2) - (prevR.top + prevR.height / 2)) < prevR.height * 0.5;
        if (sameRow) {
          mx = (prevR.right + currR.left) / 2;
          my = (prevR.top + prevR.bottom) / 2;
        } else {
          mx = currR.left + currR.width / 2;
          my = (prevR.bottom + currR.top) / 2;
        }
      }
    }
    var dx = cx - mx;
    var dy = cy - my;
    var dist = dx * dx + dy * dy;
    if (dist < bestDist) { bestDist = dist; bestGap = i; }
  }

  return bestGap === n ? -1 : bestGap;
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