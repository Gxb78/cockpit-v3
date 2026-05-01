// ---------- Journal filters override: single range picker + lean controls ----------

function initJournalFilters() {
  var from = $("#jFilterFrom");
  var to = $("#jFilterTo");
  var instr = $("#jFilterInstrument");
  if (!from || !to || !instr) return;

  // Quick filter buttons (7j, 30j, 90j, Ce mois)
  if (typeof _initQuickFilterButtons === "function") _initQuickFilterButtons();

  var now = new Date();
  var win = getJournalWindow();
  from.value = win.from || _fmtDate2(new Date(now.getFullYear(), now.getMonth(), 1));
  to.value = win.to || _fmtDate2(now);
  instr.value = state.statsInstrument || "ALL";
  updateJournalRangeTriggerLabel();

  from.onchange = _applyJournalFilter;
  to.onchange = _applyJournalFilter;
  instr.onchange = _applyJournalFilter;

  var rangeBtn = $("#journalRangePickerBtn");
  if (rangeBtn && !rangeBtn.dataset.bound) {
    rangeBtn.dataset.bound = "1";
    rangeBtn.addEventListener("click", function() {
      if (typeof openJournalRangePicker !== "function") return;
      openJournalRangePicker({
        from: from.value,
        to: to.value,
        onApply: function(start, end) {
          from.value = start;
          to.value = end;
          _applyJournalFilter();
        },
      });
    });
  }

  $$("#journalFilters .jfilter-layout-btn").forEach(function(btn) {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", function() {
      setJournalLayoutMode(btn.dataset.mode, { persist: true, rerender: true });
    });
  });

  // Metric toggle (PnL/Tr/Mix)
  $$("#calendarMetricToggle .calendar-metric-btn").forEach(function(btn) {
    if (btn.dataset.metricBound) return;
    btn.dataset.metricBound = "1";
    btn.addEventListener("click", function() {
      setCalendarMetricMode(btn.dataset.mode, { persist: true, rerender: true });
    });
  });

  bindJournalStatsArrows();
  updateJournalStatsDisplay();
}

function _applyJournalFilter() {
  var from = $("#jFilterFrom");
  var to = $("#jFilterTo");
  var instr = $("#jFilterInstrument");
  if (!from || !to || !instr) return;

  var fromDate = new Date(from.value + "T00:00:00");
  var toDate = new Date(to.value + "T00:00:00");
  if (!from.value || !to.value || isNaN(fromDate) || isNaN(toDate)) return;
  if (fromDate > toDate) {
    var oldFrom = from.value;
    from.value = to.value;
    to.value = oldFrom;
    fromDate = new Date(from.value + "T00:00:00");
    toDate = new Date(to.value + "T00:00:00");
  }

  state.currentMonth = new Date((fromDate.getTime() + toDate.getTime()) / 2);
  state.statsInstrument = instr.value || "ALL";
  state.journalCustomFrom = from.value;
  state.journalCustomTo = to.value;
  state.journalRangeMode = "custom";
  localStorage.setItem(JOURNAL_RANGE_MODE_KEY, "custom");
  localStorage.setItem(JOURNAL_CUSTOM_RANGE_KEY, JSON.stringify({ from: from.value, to: to.value }));
  updateJournalRangeTriggerLabel();
  updateJournalRangeToggleUI();
  updateJournalControlsVisibility();
  loadMonth();
}

function updateJournalRangeTriggerLabel() {
  var label = $("#journalRangeLabel");
  var from = $("#jFilterFrom")?.value || state.journalCustomFrom || "";
  var to = $("#jFilterTo")?.value || state.journalCustomTo || "";
  if (!label) return;
  label.textContent = from && to ? (from === to ? prettyDateKey(from) : prettyDateKey(from) + " -> " + prettyDateKey(to)) : "Choisir une periode";
}

/* ---- Journal stats bar ---- */
var _journalStatsIndex = 0;

var _journalStatsConfig = [
  { key: "winrate",  label: "Winrate",  fmt: function(v) { return v != null ? v.toFixed(1) + "%" : "--"; } },
  { key: "pnlAvg",   label: "PnL Moy",  fmt: function(v) { return v != null ? fmtMoney(v) : "--"; } },
  { key: "rrAvg",    label: "RR Moy",   fmt: function(v) { return v != null ? Number(v).toFixed(2) + "R" : "--"; } },
];

function computeJournalStats() {
  var days = state.days || [];
  var trades = [];
  days.forEach(function(day) {
    (day.trades || []).forEach(function(t) { trades.push(t); });
  });
  if (trades.length === 0) return { winrate: null, pnlAvg: null, rrAvg: null };

  var decided = 0, wins = 0, totalPnl = 0, totalRr = 0, rrCount = 0;
  trades.forEach(function(t) {
    var m = deriveTradeMetrics(t);
    if (m.isWin === 1 || m.isWin === 0) {
      decided++;
      if (m.isWin === 1) wins++;
    }
    var pnl = m.pnl;
    if (pnl != null) totalPnl += Number(pnl);
    if (m.rr != null) { totalRr += Number(m.rr); rrCount++; }
  });

  return {
    winrate: decided > 0 ? (wins / decided) * 100 : null,
    pnlAvg:  trades.length > 0 ? totalPnl / trades.length : null,
    rrAvg:   rrCount > 0 ? totalRr / rrCount : null,
  };
}

function updateJournalStatsDisplay() {
  var valueEl = $("#jfilterStatsValue");
  var labelEl = $("#jfilterStatsLabel");
  if (!valueEl || !labelEl) return;

  var stats = computeJournalStats();
  var config = _journalStatsConfig[_journalStatsIndex];
  labelEl.textContent = config.label;
  valueEl.textContent = config.fmt(stats[config.key]);
}

function bindJournalStatsArrows() {
  var row = $("#jfilterStatsRow");
  if (!row || row.dataset.statsBound) return;
  row.dataset.statsBound = "1";
  row.addEventListener("click", function(e) {
    var btn = e.target.closest(".jfilter-stats-arrow");
    if (!btn) return;
    var dir = Number(btn.dataset.dir) || 0;
    _journalStatsIndex = (_journalStatsIndex + dir + _journalStatsConfig.length) % _journalStatsConfig.length;
    updateJournalStatsDisplay();
  });
}
