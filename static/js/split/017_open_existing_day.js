// ---------- openExistingDay : navigation vers le journal pour un jour donne ----------
// Remplace l'ancienne version qui ouvrait entryModal (supprimee)
function openExistingDay(day) {
  if (!day || !day.date) return;
  state.journalFocusDate = day.date;
  state.currentDayId = day.id;

  // Mettre a jour le contexte du jour dans le widget Today si visible
  var dayForm = $("#dayForm");
  if (dayForm) {
    $("#dayId").value = day.id || "";
    $("#entryDate").value = day.date || "";
    $("#entryInstrument").value = day.instrument || "";
    $("#htfContext").value = day.htf_context ?? "";
    $("#dailyNotes").value = day.daily_notes ?? "";
    if (typeof setPill === "function") setPill("htf_bias", day.htf_bias);
  }

  // Naviguer vers la page journal
  if (typeof goPage === "function") {
    goPage("journal");
  }

  // Forcer le focus sur le jour dans le calendrier journal
  if (typeof loadMonth === "function") {
    if (state.currentPage !== "journal") {
      state.currentMonth = parseDateKey(day.date) || state.currentMonth;
    }
    loadMonth();
  }

  // Afficher les trades du jour si le calendrier est pret
  if (day.trades && day.trades.length && typeof renderJournalDayTrades === "function") {
    setTimeout(function () {
      renderJournalDayTrades(day.date, [day]);
    }, 200);
  }
}
