// ---------- Boot ----------

document.addEventListener("DOMContentLoaded", async () => {
  // Charger la config partagee (instruments, strategies...)
  try {
    var cfg = await api("/api/config");
    if (cfg && cfg.instruments) INSTRUMENTS = cfg.instruments;
    if (cfg && cfg.strategies) DEFAULT_STRATEGY_VALUES = cfg.strategies;
    if (cfg && cfg.strategy_labels) STRATEGY_LABELS = cfg.strategy_labels;
    renderInstruments(); loadInstruments();
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
  state.breakdownSortMode = loadBreakdownSortMode();
  // Restaurer la derniere page active (#55)
  var lastPage = localStorage.getItem("lastPage");
  if (lastPage && ["today","journal","insights","chart","orderflow","settings"].indexOf(lastPage) >= 0) {
    state.currentPage = lastPage;
  }
  // Sync the DOM to the restored page. The template marks "today" active by
  // default, so without this the JS state and the visible page desynchronise —
  // clicking the restored page would early-return in goPage() and show nothing
  // until you navigate away and back. Apply active classes + fire pageChange.
  (function syncRestoredPage() {
    var pageName = state.currentPage || "today";
    var targetPage = document.querySelector('.page[data-page="' + pageName + '"]');
    if (!targetPage) { pageName = "today"; targetPage = document.querySelector('.page[data-page="today"]'); }
    if (!targetPage) return;
    document.body.setAttribute("data-current-page", pageName);
    $$(".page").forEach(function (p) { p.classList.toggle("active", p.dataset.page === pageName); });
    $$(".nav-item").forEach(function (b) { b.classList.toggle("active", b.dataset.page === pageName); });
    document.dispatchEvent(new CustomEvent('pageChange', { detail: { page: pageName } }));
    if (window.V6OF && V6OF.Page && typeof V6OF.Page.bootstrap === "function") {
      V6OF.Page.bootstrap(pageName);
    }
  })();
  document.addEventListener("pageChange", function (event) {
    var pageName = event.detail && event.detail.page;
    if (window.V6OF && V6OF.Page && typeof V6OF.Page.dispose === "function" && pageName !== "orderflow") {
      V6OF.Page.dispose("orderflow");
    }
    if (window.V6OF && V6OF.Page && typeof V6OF.Page.bootstrap === "function") {
      V6OF.Page.bootstrap(pageName);
    }
  });
  bindNav();
  bindAiPanelToggle();
  bindCalendarNav();
  bindJournalNightToggle();
  bindCalendarMetricToggle();
  bindJournalViewToggle();
  bindJournalLayoutToggle();
  bindJournalRangeToggle();
  bindJournalTradeFilters();
  bindJournalTableSort();
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
  updateBreakdownSortUI();
  setTodayHeader();
  loadAll();
  enhanceSelects(document);

  // Abonnements d'etat — rendent explicites les dependances entre modules.
  // Desormais, modifier state.days ou state._stats met a jour les vues
  // sans que le caller ait a penser au re-rendu.
  onStateChange("days", function () {
    if (state.currentPage === "journal") renderCalendar();
    if (state.currentPage === "today") { renderTodayCalendar(); renderTodayContextWidget(true); }
  });
  onStateChange("_stats", function (stats) {
    renderKPIs(stats);
  });
});
