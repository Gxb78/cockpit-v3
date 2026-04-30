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

