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
