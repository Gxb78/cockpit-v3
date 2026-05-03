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

function getMonthPickerYear() {
  const yearEl = $("#monthPickerYear");
  const fallback = state.currentMonth.getFullYear();
  if (!yearEl) return fallback;
  const parsed = Number(yearEl.dataset.year || yearEl.textContent);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function setMonthPickerYear(year) {
  const yearEl = $("#monthPickerYear");
  if (!yearEl) return;
  yearEl.dataset.year = String(year);
  yearEl.textContent = String(year);
  const activeMonth = state.currentMonth.getFullYear() === year ? state.currentMonth.getMonth() : -1;
  const now = new Date();
  const isCurrentYear = now.getFullYear() === year;
  $$("#monthGrid .month-btn").forEach(btn => {
    const m = Number(btn.dataset.month);
    btn.classList.toggle("active", m === activeMonth);
    btn.classList.toggle("current", isCurrentYear && m === now.getMonth());
  });
}

function closeMonthPicker() {
  const pop = $("#monthPopover");
  const wrap = $("#calendarMonthPicker");
  if (pop) pop.classList.add("hidden");
  if (wrap) wrap.classList.remove("open");
}

function openMonthPicker() {
  const pop = $("#monthPopover");
  const wrap = $("#calendarMonthPicker");
  if (!pop || !wrap) return;
  if (wrap.classList.contains("hidden")) return;
  setMonthPickerYear(state.currentMonth.getFullYear());
  pop.classList.remove("hidden");
  wrap.classList.add("open");
}

function bindCalendarMonthPicker() {
  // Le popover picker est binde meme si #journalMonthInput existe
  const wrap = $("#calendarMonthPicker");
  const trigger = $("#monthLabel");
  const pop = $("#monthPopover");
  if (!wrap || !trigger || !pop) return;

  trigger.addEventListener("click", e => {
    e.stopPropagation();
    if (pop.classList.contains("hidden")) openMonthPicker();
    else closeMonthPicker();
  });

  $("#monthYearPrev")?.addEventListener("click", e => {
    e.stopPropagation();
    setMonthPickerYear(getMonthPickerYear() - 1);
  });
  $("#monthYearNext")?.addEventListener("click", e => {
    e.stopPropagation();
    setMonthPickerYear(getMonthPickerYear() + 1);
  });

  $("#monthGrid")?.addEventListener("click", e => {
    const btn = e.target.closest(".month-btn");
    if (!btn) return;
    const month = Number(btn.dataset.month);
    if (!Number.isFinite(month)) return;
    state.currentMonth = new Date(getMonthPickerYear(), month, 1);
    closeMonthPicker();
    loadMonth();
  });

  document.addEventListener("click", e => {
    if (pop.classList.contains("hidden")) return;
    if (wrap.contains(e.target)) return;
    closeMonthPicker();
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") closeMonthPicker();
  });
}

