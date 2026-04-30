// ---------- Navigation ----------

var PAGE_TITLES = {
  today:    "Today — COCKPIT Trading Journal",
  journal:  "Journal — COCKPIT Trading Journal",
  stats:    "Stats — COCKPIT Trading Journal",
  settings: "Settings — COCKPIT Trading Journal",
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
  $("#newEntryBtn")?.addEventListener("click", function () { wizOpen({ date: todayKey() }); });
  $("#railNewTradeBtn")?.addEventListener("click", function () { wizOpen({ date: todayKey() }); });
  $("#quickAddBtn")?.addEventListener("click", function () { wizOpen({ date: todayKey() }); });
  $("#openCmdk")?.addEventListener("click", function () { openCmdk(); });
}

function _lazyLoadPage(pageName) {
  var target = document.querySelector('.page[data-page="' + pageName + '"]');
  if (!target || target.children.length > 0) return; // deja charge
  var template = document.getElementById(pageName + "Template");
  if (!template) return;
  var clone = template.content.cloneNode(true);
  target.appendChild(clone);
}

function goPage(pageName) {
  var targetPage = document.querySelector('.page[data-page="' + pageName + '"]');
  if (!targetPage || state.currentPage === pageName) return;
  state.currentPage = pageName;
  document.body.setAttribute("data-current-page", pageName);
  $$(".nav-item").forEach(function (b) {
    b.classList.toggle("active", b.dataset.page === pageName);
  });
  $$(".page").forEach(function (p) {
    p.classList.toggle("active", p.dataset.page === pageName);
  });
  // Lazy-load les pages a la demande
  _lazyLoadPage(pageName);
  _updateTitle(pageName);
  if (pageName === "journal") {
    updateCalendarMetricToggleUI();
    updateJournalViewToggleUI();
    updateJournalLayoutToggleUI();
    updateJournalRangeToggleUI();
    updateJournalTradeFiltersUI();
    updateJournalControlsVisibility();
    updateJournalTableSortUI();
    updateCalendarMonthFocusToggleUI();
    loadMonth();
    initJournalFilters();
  }
  if (pageName === "stats")   { updateBreakdownSortUI(); renderPerformance(); }
  if (pageName === "today")   { renderToday(); renderTodayCalendar(); }
  if (pageName === "settings") openSettingsPage();
}

function setTodayHeader() {
  const d = new Date();
  $("#todayDate").textContent =
    `${DAYS_FR[d.getDay()]} ${d.getDate()} ${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`;
}


// ---------- Theme toggle dark/light ----------
(function () {
  var btn = document.getElementById("themeToggle");
  if (!btn) return;
  btn.addEventListener("click", function () {
    document.body.classList.toggle("light-mode");
    try { localStorage.setItem("theme",
      document.body.classList.contains("light-mode") ? "light" : "dark"); } catch (_) {}
  });
  try {
    if (localStorage.getItem("theme") === "light") document.body.classList.add("light-mode");
  } catch (_) {}
})();
