// ---------- Widget boards ----------

const WIDGET_ORDER_PREFIX = "cockpit:widgetOrder:";

function readWidgetOrder(boardKey) {
  try {
    const raw = localStorage.getItem(WIDGET_ORDER_PREFIX + boardKey);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter(x => typeof x === "string" && x) : [];
  } catch (_) {
    return [];
  }
}

function writeWidgetOrder(boardKey, keys) {
  try {
    localStorage.setItem(WIDGET_ORDER_PREFIX + boardKey, JSON.stringify(keys));
  } catch (_) {}
}

function applyWidgetBoardOrder(board) {
  const boardKey = board?.dataset?.widgetBoard;
  if (!boardKey) return;
  const desired = readWidgetOrder(boardKey);
  const nodes = Array.from(board.children).filter(el => el?.dataset?.widgetKey);
  const byKey = new Map(nodes.map(el => [el.dataset.widgetKey, el]));

  desired.forEach(key => {
    const node = byKey.get(key);
    if (node) board.appendChild(node);
  });

  // Keep any new/untracked widgets at the end, then persist canonical order.
  const finalKeys = Array.from(board.children)
    .map(el => el?.dataset?.widgetKey)
    .filter(Boolean);
  writeWidgetOrder(boardKey, finalKeys);
  board.dataset.widgetReady = "1";
}

function initWidgetBoards() {
  document.querySelectorAll(".widget-board[data-widget-board]").forEach(applyWidgetBoardOrder);
}

// Reset widget order for today-main to match template order
// (le widget-board sauvegarde un ordre qui peut devenir obsolète)
(function() {
  try { localStorage.removeItem(WIDGET_ORDER_PREFIX + "today-main"); } catch(_) {}
})();

// Backward compatible alias.
function initTodayWidgetBoards() {
  initWidgetBoards();
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

  // Use the full dayCell from the calendar module
  var prevMode = state.calendarMetricMode;
  state.calendarMetricMode = state.calendarMetricMode || "pnl";

  var first = new Date(year, month, 1);
  var firstIdx = (first.getDay() + 6) % 7;
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var tk = todayKey();
  var frag = document.createDocumentFragment();

  // Spacers invisibles pour aligner le 1er du mois sur la bonne colonne
  for (var i = 0; i < firstIdx; i++) {
    var spacer = document.createElement("div");
    spacer.className = "day other-month";
    spacer.style.visibility = "hidden";
    frag.appendChild(spacer);
  }
  // Uniquement les jours du mois en cours
  for (var d = 1; d <= daysInMonth; d++) {
    frag.appendChild(dayCell(new Date(year, month, d), byDay, false, tk));
  }

  state.calendarMetricMode = prevMode;
  grid.replaceChildren(frag);
  grid.dataset.metricMode = state.calendarMetricMode || "pnl";
  grid.dataset.viewMode = "month";

  // Clic sur un jour → ouvre le wizard (bind une seule fois)
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
