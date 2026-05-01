// ---------- Calendar ----------

let _calendarByDayCache = {};
let _calendarGridBound = false;
let _calWasAutoTable = false;

function bindCalendarGridActions(grid) {
  if (!grid || _calendarGridBound) return;
  grid.addEventListener("click", (e) => {
    const dayEl = e.target.closest(".day");
    if (!dayEl || !grid.contains(dayEl)) return;
    if (dayEl.dataset.otherMonth === "1") return;
    const key = dayEl.dataset.date;
    if (!key) return;
    const info = _calendarByDayCache[key];
    if (!info || !Array.isArray(info.days) || info.days.length === 0) {
      if (typeof closeJournalDayTrades === "function") closeJournalDayTrades();
      wizOpen({ date: key });
      return;
    }

    const tradeCount = info.days.reduce((sum, day) => sum + ((day.trades || []).length), 0);
    if (tradeCount > 0 && typeof renderJournalDayTrades === "function") {
      renderJournalDayTrades(key, info.days);
      return;
    }

    if (info.days.length === 1) {
      if (typeof closeJournalDayTrades === "function") closeJournalDayTrades();
      openExistingDay(info.days[0]);
      return;
    }
    if (typeof closeJournalDayTrades === "function") closeJournalDayTrades();
    openPickerForDate(key, info.days);
  });
  _calendarGridBound = true;
}

function renderCalendar(windowDef = null) {
  const win = windowDef || getJournalWindow();
  updateJournalTradeFilterOptions(state.days);
  if (typeof updateJournalStatsDisplay === "function") updateJournalStatsDisplay();

  // Auto-switch: table si range > 35 jours (sauf si utilisateur a explicitement choisi)
  var from = parseDateKey(win.from);
  var to = parseDateKey(win.to);
  var spanDays = from && to ? Math.round((to - from) / 86400000) + 1 : 0;
  if (spanDays > 35 && !state._journalLayoutExplicit) {
    if (state.journalLayoutMode !== "table") {
      setJournalLayoutMode("table", { persist: false, rerender: false });
      if (typeof toast === "function") toast("Vue table activee pour les periodes > 35 jours", "info");
    }
    _calWasAutoTable = true;
  } else if (_calWasAutoTable) {
    setJournalLayoutMode("calendar", { persist: false, rerender: false });
    _calWasAutoTable = false;
  }

  updateJournalTradeFiltersUI();
  const byDay = buildCalendarByDay(state.days);

  const monthLabelEl = $("#monthLabel");
  if (monthLabelEl) monthLabelEl.textContent = state.journalViewMode === "month" ? win.label : `${win.title} · ${win.label}`;
  const monthInputEl = $("#journalMonthInput");
  if (monthInputEl) {
    monthInputEl.value = `${state.currentMonth.getFullYear()}-${String(state.currentMonth.getMonth() + 1).padStart(2, "0")}`;
  }

  const prevBtn = $("#prevMonth");
  const nextBtn = $("#nextMonth");
  if (prevBtn) prevBtn.title = state.journalViewMode === "week" ? "Semaine précédente" : "Période précédente";
  if (nextBtn) nextBtn.title = state.journalViewMode === "week" ? "Semaine suivante" : "Période suivante";

  const grid = $("#calendarGrid");
  if (!grid) return;
  bindCalendarGridActions(grid);
  _calendarByDayCache = byDay;
  grid.dataset.metricMode = state.calendarMetricMode || "pnl";
  grid.dataset.viewMode = state.journalViewMode || "month";
  const tk = todayKey();
  const fragment = document.createDocumentFragment();

  if (state.journalViewMode === "week") {
    const weekStart = parseDateKey(win.from) || startOfWeek(state.currentMonth);
    for (let i = 0; i < 7; i += 1) {
      fragment.appendChild(dayCell(shiftDays(weekStart, i), byDay, false, tk));
    }
  } else if (state.journalRangeMode === "custom") {
    const cursor = parseDateKey(win.from);
    const end = parseDateKey(win.to);
    let c = cursor;
    while (c <= end) {
      fragment.appendChild(dayCell(c, byDay, false, tk));
      c = shiftDays(c, 1);
    }
  } else {
    const ref   = state.currentMonth;
    const year  = ref.getFullYear();
    const month = ref.getMonth();
    const first         = new Date(year, month, 1);
    const firstDayIndex = (first.getDay() + 6) % 7;
    const daysInMonth   = new Date(year, month + 1, 0).getDate();
    const daysInPrev    = new Date(year, month, 0).getDate();

    for (let i = firstDayIndex; i > 0; i -= 1) {
      fragment.appendChild(dayCell(new Date(year, month - 1, daysInPrev - i + 1), byDay, true, tk));
    }
    for (let d = 1; d <= daysInMonth; d += 1) {
      fragment.appendChild(dayCell(new Date(year, month, d), byDay, false, tk));
    }
    const trailing = (7 - ((firstDayIndex + daysInMonth) % 7)) % 7;
    for (let d = 1; d <= trailing; d += 1) {
      fragment.appendChild(dayCell(new Date(year, month + 1, d), byDay, true, tk));
    }
  }
  grid.replaceChildren(fragment);

  const totalCells = grid.children.length;
  const rows = Math.max(1, Math.ceil(totalCells / 7));
  grid.style.setProperty("--journal-rows", String(rows));

  renderCalendarMonthFocus(byDay, win);
  renderJournalTable();
}

function computeMonthFocusData(byDay = null) {
  const dataset = byDay || {};
  const days = Object.values(dataset);
  let trades = 0;
  let wins = 0;
  let losses = 0;
  let pnl = 0;

  days.forEach(dayInfo => {
    trades += Number(dayInfo?.trades || 0);
    wins += Number(dayInfo?.wins || 0);
    losses += Number(dayInfo?.losses || 0);
    pnl += Number(dayInfo?.pnl || 0);
  });

  const decided = wins + losses;
  const winrate = decided > 0 ? (wins / decided) * 100 : null;
  const avgPnlPerTrade = trades > 0 ? pnl / trades : null;
  return { trades, wins, losses, pnl, decided, winrate, avgPnlPerTrade };
}

function renderJournalHeaderStats(data) {
  var wrEl       = $("#jhsWr");
  var pnlEl      = $("#jhsPnl");
  var trEl       = $("#jhsTr");
  var avgEl      = $("#jhsAvg");
  var wrInline   = $("#jhsWrInline");
  var pnlInline  = $("#jhsPnlInline");
  if (!wrEl) return;

  if (!data || data.trades === 0) {
    wrEl.textContent  = "WR --";
    wrEl.className    = "stat";
    pnlEl.textContent = "PnL --";
    pnlEl.className   = "stat";
    trEl.textContent  = "TR --";
    avgEl.textContent = "Moy --";
    if (wrInline)  { wrInline.textContent = "--";  wrInline.className  = "journal-filter-stat-value"; }
    if (pnlInline) { pnlInline.textContent = "--"; pnlInline.className = "journal-filter-stat-value"; }
    return;
  }

  var wrText  = data.winrate == null ? "--" : data.winrate.toFixed(1) + "%";
  var pnlText = fmtMoney(data.pnl);
  var trText  = String(data.trades);
  var avgText = data.avgPnlPerTrade == null ? "--" : fmtMoney(data.avgPnlPerTrade);

  wrEl.textContent  = "WR " + wrText;
  wrEl.className    = "stat" + (data.winrate >= 50 ? " pos" : data.winrate != null ? " neg" : "");
  pnlEl.textContent = "PnL " + pnlText;
  pnlEl.className   = "stat" + (data.pnl > 0 ? " pos" : data.pnl < 0 ? " neg" : "");
  trEl.textContent  = "TR " + trText;
  trEl.className    = "stat";
  avgEl.textContent = "Moy " + avgText;
  avgEl.className   = "stat";

  if (wrInline) {
    wrInline.textContent = wrText;
    wrInline.className   = "journal-filter-stat-value" + (data.winrate != null && data.winrate >= 50 ? " pos" : data.winrate != null ? " neg" : "");
  }
  if (pnlInline) {
    pnlInline.textContent = pnlText;
    pnlInline.className   = "journal-filter-stat-value" + (data.pnl > 0 ? " pos" : data.pnl < 0 ? " neg" : "");
  }
}

function renderCalendarMonthFocus(byDay, windowDef) {
  var data = computeMonthFocusData(byDay);
  renderJournalHeaderStats(data);
}

function dayCell(dt, byDay, otherMonth, today) {
  const key  = fmtDateKey(dt);
  const info = byDay[key];
  const mode = state.calendarMetricMode || "pnl";
  const el   = document.createElement("div");
  el.dataset.date = key;
  el.dataset.otherMonth = otherMonth ? "1" : "0";
  el.className = "day" + (otherMonth ? " other-month" : "") + (key === today ? " today" : "");
  el.classList.add(`day-mode-${mode}`);
  if (info) {
    if (info.pnl > 0) el.classList.add("win");
    else if (info.pnl < 0) el.classList.add("loss");
  }

  let metricHtml = `<div class="day-center day-center-empty"></div>`;

  if (info) {
    const pnlClass = info.pnl > 0 ? "pos" : info.pnl < 0 ? "neg" : "flat";
    if (mode === "pnl") {
      metricHtml = `
        <div class="day-center mode-pnl">
          <div class="day-metric day-metric-pnl ${pnlClass}">${fmtMoney(info.pnl)}</div>
        </div>`;
    } else if (mode === "trades") {
      const tradeWord = info.trades > 1 ? "trades" : "trade";
      const executedWord = info.trades > 1 ? "ex\u00E9cut\u00E9s" : "ex\u00E9cut\u00E9";
      metricHtml = `
        <div class="day-center mode-trades">
          <div class="day-metric day-metric-trades">${info.trades}</div>
          <div class="day-metric-sub">${tradeWord} ${executedWord}</div>
        </div>`;
    } else {
      metricHtml = `
        <div class="day-center mode-both">
          <div class="day-metric day-metric-pnl ${pnlClass}">${fmtMoney(info.pnl)}</div>
          <div class="day-metric-sub">${info.trades} position</div>
        </div>`;
    }
  }
  let stackHtml = "";
  if (info && info.days?.length > 1) {
    stackHtml = `<div class="day-stack-indicator" title="Plusieurs instruments ce jour">${info.days.length} inst</div>`;
  } else if (info && Number(info.trades || 0) > 1) {
    stackHtml = `<div class="day-stack-indicator trades" title="Plusieurs trades ce jour">${info.trades}T</div>`;
  }

  let dotsHtml = "";
  if (info && (info.wins || info.losses)) {
    const winDots = Math.min(info.wins || 0, 5);
    const lossDots = Math.min(info.losses || 0, 5);
    let spans = "";
    for (let i = 0; i < winDots; i++) spans += '<span class="day-dot win"></span>';
    for (let i = 0; i < lossDots; i++) spans += '<span class="day-dot loss"></span>';
    if (spans) dotsHtml = `<div class="day-dots">${spans}</div>`;
  }
  el.innerHTML = `<div class="day-num">${dt.getDate()}</div>${metricHtml}${stackHtml}${dotsHtml}`;
  return el;
}
