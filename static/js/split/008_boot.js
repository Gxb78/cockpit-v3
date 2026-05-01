// ---------- Boot ----------

document.addEventListener("DOMContentLoaded", async () => {
  // Charger la config partagee (instruments, strategies...)
  try {
    var cfg = await api("/api/config");
    if (cfg && cfg.instruments) INSTRUMENTS = cfg.instruments;
    if (cfg && cfg.strategies) DEFAULT_STRATEGY_VALUES = cfg.strategies;
    if (cfg && cfg.strategy_labels) STRATEGY_LABELS = cfg.strategy_labels;
    renderInstruments();
    // Cacher le bouton dev restart hors mode DEBUG
    if (cfg && !cfg.debug) {
      var devBtn = document.getElementById("devRestart");
      if (devBtn) devBtn.style.display = "none";
    }
  } catch (_) { /* fallback silencieux sur les valeurs hardcodees */ }

  document.body.setAttribute("data-current-page", state.currentPage || "today");
  state.settings = loadSettingsState();
  state.calendarMetricMode = loadCalendarMetricMode();
  state.journalViewMode = loadJournalViewMode();
  state.journalLayoutMode = loadJournalLayoutMode();
  state.journalRangeMode = loadJournalRangeMode();
  state.journalTradeFilters = loadJournalTradeFilters();
  const tableSort = loadJournalTableSort();
  state.journalTableSortKey = tableSort.key;
  state.journalTableSortDir = tableSort.dir;
  const customRange = loadJournalCustomRange();
  state.journalCustomFrom = customRange.from;
  state.journalCustomTo = customRange.to;
  if (state.journalRangeMode === "custom" && !getJournalCustomWindow()) {
    const def = monthRange(new Date());
    state.journalCustomFrom = def.from;
    state.journalCustomTo = def.to;
    localStorage.setItem(JOURNAL_CUSTOM_RANGE_KEY, JSON.stringify({ from: def.from, to: def.to }));
  }
  state.calendarMonthFocusMode = loadCalendarMonthFocusMode();
  state.breakdownSortMode = loadBreakdownSortMode();
  bindNav();
  bindAiPanelToggle();
  bindCalendarNav();
  bindCalendarMonthPicker();
  bindCalendarMetricToggle();
  bindJournalViewToggle();
  bindJournalLayoutToggle();
  bindJournalRangeToggle();
  bindJournalTradeFilters();
  bindJournalTableSort();
  bindCalendarMonthFocusToggle();
  bindBreakdownSort();
  bindFilter();
  bindExport();
  bindGlobalKeys();
  bindCmdk();
  bindPills();
  bindTagsInput();
  bindQuality();
  bindRRPreview();
  if (typeof bindMidnightChallenge === "function") bindMidnightChallenge();
  bindMarkdownToggles();
  bindAutosave();
  bindHashtagSync();
  bindCustomBlocks();
  bindNarration();
  bindSettings();
  bindWizard();
  bindAIChat();
  if (typeof initWidgetBoards === "function") initWidgetBoards();
  else if (typeof initTodayWidgetBoards === "function") initTodayWidgetBoards();
  applySettingsState();
  updateCalendarMetricToggleUI();
  updateJournalViewToggleUI();
  updateJournalLayoutToggleUI();
  updateJournalRangeToggleUI();
  updateJournalTradeFiltersUI();
  updateJournalControlsVisibility();
  updateJournalTableSortUI();
  updateCalendarMonthFocusToggleUI();
  updateBreakdownSortUI();
  setTodayHeader();
  loadAll();
  enhanceSelects(document);

  // Abonnements d'etat — rendent explicites les dependances entre modules.
  // Desormais, modifier state.days ou state._stats met a jour les vues
  // sans que le caller ait a penser au re-rendu.
  onStateChange("days", function () {
    if (state.currentPage === "journal") renderCalendar();
    if (state.currentPage === "today") renderTodayCalendar();
  });
  onStateChange("_stats", function (stats) {
    renderKPIs(stats);
  });
});

