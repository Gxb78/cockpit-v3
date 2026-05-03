// ---------- Calendar nav ----------

function getJournalCustomWindow() {
  const from = parseDateKey(state.journalCustomFrom);
  const to = parseDateKey(state.journalCustomTo);
  if (!from || !to || from > to) return null;
  return { from, to };
}

function getJournalWindow() {
  if (state.journalViewMode === "week") {
    const start = startOfWeek(state.currentMonth);
    const end = endOfWeek(state.currentMonth);
    return {
      kind: "week",
      from: fmtDateKey(start),
      to: fmtDateKey(end),
      label: `${prettyDateKey(fmtDateKey(start))} - ${prettyDateKey(fmtDateKey(end))}`,
      title: "Semaine",
    };
  }

  if (state.journalRangeMode === "quarter") {
    const q = quarterRange(state.currentMonth);
    return { kind: "quarter", from: q.from, to: q.to, label: q.label, title: "Trimestre" };
  }

  if (state.journalRangeMode === "custom") {
    const custom = getJournalCustomWindow();
    if (custom) {
      const fromKey = fmtDateKey(custom.from);
      const toKey = fmtDateKey(custom.to);
      return {
        kind: "custom",
        from: fromKey,
        to: toKey,
        label: `${prettyDateKey(fromKey)} -> ${prettyDateKey(toKey)}`,
        title: "Custom",
      };
    }
  }

  const m = monthRange(state.currentMonth);
  return { kind: "month", from: m.from, to: m.to, label: m.label, title: "Mois" };
}

function shiftCustomWindow(dir) {
  const custom = getJournalCustomWindow();
  if (!custom) return false;
  const spanDays = Math.max(1, Math.round((custom.to - custom.from) / 86400000) + 1);
  const delta = spanDays * dir;
  const newFrom = shiftDays(custom.from, delta);
  const newTo = shiftDays(custom.to, delta);
  setJournalCustomRange(fmtDateKey(newFrom), fmtDateKey(newTo), { persist: true, reload: false });
  return true;
}

function bindCalendarNav() {
  $("#prevMonth")?.addEventListener("click", () => {
    if (state.journalViewMode === "week") {
      state.currentMonth = shiftDays(state.currentMonth, -7);
    } else if (state.journalRangeMode === "quarter") {
      state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() - 3, state.currentMonth.getDate());
    } else if (state.journalRangeMode === "custom") {
      shiftCustomWindow(-1);
    } else {
      state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() - 1, 1);
    }
    closeMonthPicker();
    loadMonth();
  });
  $("#nextMonth")?.addEventListener("click", () => {
    if (state.journalViewMode === "week") {
      state.currentMonth = shiftDays(state.currentMonth, 7);
    } else if (state.journalRangeMode === "quarter") {
      state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() + 3, state.currentMonth.getDate());
    } else if (state.journalRangeMode === "custom") {
      shiftCustomWindow(1);
    } else {
      state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() + 1, 1);
    }
    closeMonthPicker();
    loadMonth();
  });
  $("#todayJumpBtn")?.addEventListener("click", () => {
    const now = new Date();
    state.currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    state.journalViewMode = "month";
    if (state.journalRangeMode === "custom") {
      const m = monthRange(now);
      setJournalCustomRange(m.from, m.to, { persist: true, reload: false });
    }
    closeMonthPicker();
    loadMonth();
    // Feedback visuel : flash sur le controle du mois
    const wrap = document.getElementById("journalMonthInputWrap");
    if (wrap) {
      wrap.classList.remove("journal-month-flash");
      void wrap.offsetWidth;
      wrap.classList.add("journal-month-flash");
      setTimeout(function () { wrap.classList.remove("journal-month-flash"); }, 600);
    }
  });

  $("#journalMonthInput")?.addEventListener("change", (e) => {
    const raw = String(e.target?.value || "");
    if (!/^\d{4}-\d{2}$/.test(raw)) return;
    const [y, m] = raw.split("-").map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return;
    state.currentMonth = new Date(y, m - 1, 1);
    if (state.journalRangeMode === "custom") {
      state.journalRangeMode = "month";
      localStorage.setItem(JOURNAL_RANGE_MODE_KEY, "month");
      updateJournalRangeToggleUI();
      updateJournalControlsVisibility();
    }
    loadMonth();
  });
}

// closeMonthPicker — no-op, le popover custom a ete supprime (#49)
function closeMonthPicker() {}

// ── Journal night mode ──
function bindJournalNightToggle() {
  var btn = document.getElementById("journalNightToggle");
  if (!btn) return;
  var page = document.querySelector('.page[data-page="journal"]');
  if (!page) return;

  // Restore saved state
  var saved = localStorage.getItem("journalNightMode");
  if (saved === "true") {
    page.classList.add("journal-night");
    btn.classList.add("active");
  }

  btn.addEventListener("click", function () {
    var on = page.classList.toggle("journal-night");
    btn.classList.toggle("active", on);
    localStorage.setItem("journalNightMode", on ? "true" : "false");
  });
}

