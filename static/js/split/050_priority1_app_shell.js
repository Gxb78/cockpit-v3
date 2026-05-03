// ---------- Priority 1 app shell ----------

const APP_SHELL_PAGES = {
  today: {
    title: "Dashboard",
    subtitle: "Vue du jour, performance et prochaine action.",
    documentTitle: "Dashboard - JOURNAL",
  },
  journal: {
    title: "Journal",
    subtitle: "Calendrier, table des trades, filtres et historique.",
    documentTitle: "Journal - JOURNAL",
  },
  stats: {
    title: "Stats",
    subtitle: "Performance, risque, patterns et breakdowns.",
    documentTitle: "Stats - JOURNAL",
  },
  settings: {
    title: "Settings",
    subtitle: "Profil, instruments, IA et preferences visuelles.",
    documentTitle: "Settings - JOURNAL",
  },
  insights: {
    title: "Insights",
    subtitle: "Profil comportemental et recommandations personnalisées.",
    documentTitle: "Insights - JOURNAL",
  },
};

function updateAppShell(pageName) {
  const page = APP_SHELL_PAGES[pageName] || APP_SHELL_PAGES.today;
  const title = document.getElementById("appTopbarTitle");
  const subtitle = document.getElementById("appTopbarSubtitle");
  if (title) title.textContent = page.title;
  if (subtitle) subtitle.textContent = page.subtitle;
  if (page.documentTitle) document.title = page.documentTitle;

  document.querySelectorAll(".nav-item[data-page]").forEach(function (btn) {
    const current = btn.dataset.page === pageName;
    btn.classList.toggle("active", current);
    if (current) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
}

function bindAppShellActions() {
  document.getElementById("shellNewEntryBtn")?.addEventListener("click", function () {
    wizOpen({});
  });

  document.getElementById("shellCmdkBtn")?.addEventListener("click", function () {
    openCmdk();
  });

  document.getElementById("shellThemeBtn")?.addEventListener("click", function () {
    document.getElementById("themeToggle")?.click();
  });
}

(function installAppShellHooks() {
  const originalGoPage = window.goPage || goPage;
  window.goPage = function (pageName) {
    originalGoPage(pageName);
    updateAppShell(state.currentPage || pageName || "today");
  };
  goPage = window.goPage;

  document.addEventListener("DOMContentLoaded", function () {
    bindAppShellActions();
    updateAppShell(state.currentPage || "today");
  });
})();
