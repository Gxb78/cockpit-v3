// ---------- Global keys ----------

function bindGlobalKeys() {
  document.addEventListener("keydown", e => {
    const tag    = (e.target.tagName || "").toLowerCase();
    const inField = ["input","textarea","select"].includes(tag);
    const meta   = e.metaKey || e.ctrlKey;

    if (meta && e.key.toLowerCase() === "k") { e.preventDefault(); openCmdk(); return; }
    if (meta && e.key.toLowerCase() === "n") { e.preventDefault(); wizOpen({}); return; }

    if (e.key === "Escape") {
      if (state.cmdkOpen) { closeCmdk(); return; }

      if (!$("#lightbox").classList.contains("hidden")) { $("#lightbox").classList.add("hidden"); return; }
    }

    if (inField) return;
    if (!meta && !e.altKey) {
      if (e.key === "t" || e.key === "T") { e.preventDefault(); goPage("today"); }
      if (e.key === "j" || e.key === "J") { e.preventDefault(); goPage("journal"); }
      
      if (e.key === "g" || e.key === "G") { e.preventDefault(); goPage("settings"); }
      if (e.key === "c" || e.key === "C") { e.preventDefault(); goPage("chart"); }
      if (e.key === "o" || e.key === "O") { e.preventDefault(); goPage("orderflow"); }
      if (e.key === "/") {
        e.preventDefault();
        var search = document.getElementById("journalFilterSearch");
        if (search) { search.focus(); search.select(); }
      }
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        var details = document.querySelector(".journal-advanced-filters");
        if (details) details.open = !details.open;
      }
      if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        if (state.currentPage !== "journal") goPage("journal");
        const nextMode = state.journalViewMode === "week" ? "month" : "week";
        setJournalViewMode(nextMode, { persist: true, reload: true });
      }
      if (e.key === "?") { e.preventDefault(); openCmdk(); }
    }
  });
}

