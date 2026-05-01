// ---------- Calendar ----------

let _calendarByDayCache = {};
let _calendarGridBound = false;
let _calWasAutoTable = false;
let _calPnLThresholds = null;

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
  grid.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const dayEl = e.target.closest(".day");
    if (!dayEl || dayEl.dataset.otherMonth === "1") return;
    e.preventDefault();
    dayEl.click();
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
  _calPnLThresholds = _computePnLBands(byDay);

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
    // Padding leading days pour aligner le premier jour sous son weekday (Lun=0..Dim=6)
    const leadIndex = (cursor.getDay() + 6) % 7;
    for (let i = leadIndex; i > 0; i -= 1) {
      fragment.appendChild(dayCell(shiftDays(cursor, -i), byDay, true, tk));
    }
    let c = cursor;
    let count = 0;
    while (c <= end) {
      fragment.appendChild(dayCell(c, byDay, false, tk));
      c = shiftDays(c, 1);
      count += 1;
    }
    // Padding trailing pour completer la derniere semaine
    const trailing = (7 - ((leadIndex + count) % 7)) % 7;
    for (let i = 0; i < trailing; i += 1) {
      fragment.appendChild(dayCell(shiftDays(c, i), byDay, true, tk));
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

  // Empty state — soit aucun trade sur la periode, soit filtres ont tout vide
  var totalTrades = 0;
  Object.keys(byDay).forEach(function (k) { totalTrades += Number(byDay[k].trades || 0); });
  var hasFilters = hasActiveJournalTradeFilters();
  var isEmpty = totalTrades === 0;
  var wrap = document.getElementById("journalCalendarWrap");
  if (wrap) wrap.classList.toggle("cal-empty", isEmpty);
  var emptyEl = document.getElementById("calendarEmptyState");
  if (isEmpty) {
    if (!emptyEl) {
      emptyEl = document.createElement("div");
      emptyEl.id = "calendarEmptyState";
      emptyEl.className = "calendar-empty-state";
      emptyEl.innerHTML =
        '<div class="empty-state">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="4" width="18" height="17" rx="2"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>' +
          '<span>' + (hasFilters ? 'Aucun trade ne correspond aux filtres actifs.' : 'Aucun trade pour cette periode.') + '</span>' +
          (hasFilters ? '' : '<span class="empty-cta">Ajouter un trade dans le tableau de bord Today</span>') +
        "</div>";
      grid.parentNode.insertBefore(emptyEl, grid.nextSibling);
    }
    emptyEl.classList.remove("hidden");
  } else if (emptyEl) {
    emptyEl.classList.add("hidden");
  }

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

/* ---- PnL intensity bands (4 levels based on quartiles) ---- */

function _computePnLBands(byDay) {
  const wins = [];
  const losses = [];
  Object.values(byDay).forEach(function(info) {
    if (info && info.pnl > 0) wins.push(info.pnl);
    else if (info && info.pnl < 0) losses.push(Math.abs(info.pnl));
  });
  wins.sort(function(a, b) { return a - b; });
  losses.sort(function(a, b) { return a - b; });
  function quartile(arr, q) {
    if (arr.length === 0) return null;
    const pos = (arr.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return arr[lo] + (arr[hi] - arr[lo]) * (pos - lo);
  }
  return {
    winBands: wins.length > 3 ? [quartile(wins, 0.25), quartile(wins, 0.5), quartile(wins, 0.75)] : null,
    lossBands: losses.length > 3 ? [quartile(losses, 0.25), quartile(losses, 0.5), quartile(losses, 0.75)] : null,
  };
}

function _pnlBand(pnl, thresholds) {
  if (!thresholds || pnl == null || pnl === 0) return "";
  if (pnl > 0) {
    if (!thresholds.winBands) return "win";
    if (pnl <= thresholds.winBands[0]) return "win-1";
    if (pnl <= thresholds.winBands[1]) return "win-2";
    if (pnl <= thresholds.winBands[2]) return "win-3";
    return "win-4";
  }
  var absPnl = Math.abs(pnl);
  if (!thresholds.lossBands) return "loss";
  if (absPnl <= thresholds.lossBands[0]) return "loss-1";
  if (absPnl <= thresholds.lossBands[1]) return "loss-2";
  if (absPnl <= thresholds.lossBands[2]) return "loss-3";
  return "loss-4";
}

function dayCell(dt, byDay, otherMonth, today) {
  const key  = fmtDateKey(dt);
  const info = byDay[key];
  const mode = state.calendarMetricMode || "pnl";
  const el   = document.createElement("div");
  el.dataset.date = key;
  el.dataset.otherMonth = otherMonth ? "1" : "0";
  el.dataset.weekday = String(dt.getDay());
  el.className = "day" + (otherMonth ? " other-month" : "") + (key === today ? " today" : "");
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", otherMonth ? "-1" : "0");
  if (dt.getDay() === 0 || dt.getDay() === 6) el.classList.add("is-weekend");
  el.classList.add(`day-mode-${mode}`);
  const band = _pnlBand(info?.pnl, _calPnLThresholds);
  if (band) el.classList.add(band);

  let metricHtml = `<div class="day-center day-center-empty"></div>`;

  if (info) {
    const pnlClass = info.pnl > 0 ? "pos" : info.pnl < 0 ? "neg" : "flat";
    if (mode === "pnl") {
      metricHtml = `
        <div class="day-center mode-pnl">
          <div class="day-metric day-metric-pnl ${pnlClass}">${fmtMoney(info.pnl)}</div>
        </div>`;
    } else if (mode === "trades") {
      metricHtml = `
        <div class="day-center mode-trades">
          <div class="day-metric day-metric-trades">${info.trades}<span class="day-metric-suffix">T</span></div>
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
