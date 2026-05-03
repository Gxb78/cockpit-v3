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
