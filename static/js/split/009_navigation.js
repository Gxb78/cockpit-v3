// ---------- Navigation ----------

var PAGE_TITLES = {
  today:    "Dashboard — COCKPIT Trading Journal",
  journal:  "Journal — COCKPIT Trading Journal",
  stats:    "Stats — COCKPIT Trading Journal",
  settings: "Settings — COCKPIT Trading Journal",
  orderflow: "Orderflow — COCKPIT Trading Journal",
};

function _updateTitle(pageName) {
  var t = PAGE_TITLES[pageName];
  if (t) document.title = t;
}

var _navDelegationBound = false;

function bindNav() {
  if (!_navDelegationBound) {
    _navDelegationBound = true;
    $("#nav")?.addEventListener("click", function (e) {
      var item = e.target.closest(".nav-item");
      if (!item) return;
      goPage(item.dataset.page);
    });
  }
  $("#newEntryBtn")?.addEventListener("click", function () { wizOpen({}); });
  $("#railNewTradeBtn")?.addEventListener("click", function () { wizOpen({ railMode: true }); });
  $("#quickAddBtn")?.addEventListener("click", function () { wizOpen({}); });
  $("#openCmdk")?.addEventListener("click", function () { openCmdk(); });
}

function goPage(pageName) {
  var targetPage = document.querySelector('.page[data-page="' + pageName + '"]');
  if (!targetPage || state.currentPage === pageName) return;
  state.currentPage = pageName;
  localStorage.setItem("lastPage", pageName);
  document.body.setAttribute("data-current-page", pageName);
  $$(".nav-item").forEach(function (b) {
    b.classList.toggle("active", b.dataset.page === pageName);
  });
  $$(".page").forEach(function (p) {
    p.classList.toggle("active", p.dataset.page === pageName);
  });
  _updateTitle(pageName);
  // Dispatcher un event pour que les composants réagissent au changement de page
  document.dispatchEvent(new CustomEvent('pageChange', { detail: { page: pageName } }));
  if (pageName === "journal") {
    updateCalendarMetricToggleUI();
    updateJournalViewToggleUI();
    updateJournalLayoutToggleUI();
    updateJournalRangeToggleUI();
    updateJournalTradeFiltersUI();
    updateJournalControlsVisibility();
    updateJournalTableSortUI();
    if (state.journalFocusDate) {
      var fd = parseDateKey(state.journalFocusDate);
      if (fd) {
        state.currentMonth = fd;
        state.journalCustomFrom = state.journalFocusDate;
        state.journalCustomTo = state.journalFocusDate;
        state.journalRangeMode = "custom";
        var m = monthRange(fd);
        setJournalCustomRange(state.journalFocusDate, state.journalFocusDate, { persist: true, reload: false });
      }
      state.journalFocusDate = null;
    }
    loadMonth();
    initJournalFilters();
  }
  if (pageName === "insights") {
    updateBreakdownSortUI();
    renderPerformance();
  }
  if (pageName === "today")   { renderToday(); renderTodayCalendar(); }
  if (pageName === "settings") openSettingsPage();
}

function setTodayHeader() {
  const d = new Date();
  $("#todayDate").textContent =
    `${DAYS_FR[d.getDay()]} ${d.getDate()} ${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`;
}


// ---------- Fin navigation (theme toggle supprime — voir 003 pour la source unique) ----------
