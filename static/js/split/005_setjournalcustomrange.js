function setJournalCustomRange(fromKey, toKey, opts = {}) {
  const { persist = true, reload = true } = opts;
  state.journalCustomFrom = fromKey || "";
  state.journalCustomTo = toKey || "";
  if (state.journalRangeMode === "custom") {
    const anchor = parseDateKey(state.journalCustomFrom);
    if (anchor) state.currentMonth = anchor;
  }
  updateJournalRangeToggleUI();
  if (persist) {
    localStorage.setItem(JOURNAL_CUSTOM_RANGE_KEY, JSON.stringify({
      from: state.journalCustomFrom,
      to: state.journalCustomTo,
    }));
  }
  if (reload && state.currentPage === "journal") loadMonth();
}

function setRollingCustomRange(days, opts = {}) {
  const span = Math.max(1, Number(days) || 30);
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - (span - 1));
  setJournalCustomRange(fmtDateKey(start), fmtDateKey(end), opts);
}

function bindJournalViewToggle() {
  const wrap = $("#calendarViewToggle");
  if (!wrap) return;
  wrap.addEventListener("click", e => {
    const btn = e.target.closest(".calendar-view-btn");
    if (!btn) return;
    setJournalViewMode(btn.dataset.mode, { persist: true, reload: true });
  });
}

function bindJournalRangeToggle() {
  const wrap = $("#calendarRangeToggle");
  if (!wrap) return;
  wrap.addEventListener("click", e => {
    const btn = e.target.closest(".calendar-range-btn");
    if (!btn) return;
    setJournalRangeMode(btn.dataset.mode, { persist: true, reload: true });
  });

  $("#calendarQuickRange")?.addEventListener("click", (e) => {
    const btn = e.target.closest(".calendar-quick-btn");
    if (!btn) return;
    const days = Number(btn.dataset.days || 30);
    if (!Number.isFinite(days) || days < 1) return;
    if (state.journalRangeMode !== "custom") {
      setJournalRangeMode("custom", { persist: true, reload: false });
    }
    setRollingCustomRange(days, { persist: true, reload: true });
  });
}

function setJournalLayoutMode(mode, opts = {}) {
  const { persist = true, rerender = true } = opts;
  if (!JOURNAL_LAYOUT_MODES.has(mode)) return;
  state.journalLayoutMode = mode;
  state._journalLayoutExplicit = persist; // auto-switch (persist:false) ne compte pas
  updateJournalLayoutToggleUI();
  updateJournalControlsVisibility();
  if (persist) localStorage.setItem(JOURNAL_LAYOUT_MODE_KEY, mode);
  if (rerender && state.currentPage === "journal") {
    if (typeof closeJournalDayTrades === "function") closeJournalDayTrades();
    renderCalendar();
  }
}

function bindJournalLayoutToggle() {
  const wrap = $("#calendarLayoutToggle");
  if (!wrap) return;
  wrap.addEventListener("click", e => {
    const btn = e.target.closest(".calendar-layout-btn");
    if (!btn) return;
    setJournalLayoutMode(btn.dataset.mode, { persist: true, rerender: true });
  });
}

function parseFilterNumber(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeTradeTags(raw) {
  if (Array.isArray(raw)) {
    return raw.map(t => String(t || "").trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    const maybeJson = raw.trim();
    if (!maybeJson) return [];
    try {
      const parsed = JSON.parse(maybeJson);
      if (Array.isArray(parsed)) return normalizeTradeTags(parsed);
    } catch {
      // fallback below
    }
    return maybeJson.split(",").map(t => t.trim()).filter(Boolean);
  }
  return [];
}

function hasActiveJournalTradeFilters() {
  const f = state.journalTradeFilters || defaultJournalTradeFilters();
  return !!(
    (f.strategy && f.strategy !== "ALL")
    || (f.result && f.result !== "ALL")
    || (Array.isArray(f.tag) && f.tag[0] !== "ALL" && f.tag.length)
    || parseFilterNumber(f.pnlMin) != null
    || parseFilterNumber(f.pnlMax) != null
    || (f.search && f.search.trim().length >= 2)
  );
}

function buildJournalTradeRow(day, trade, idx = 0) {
  if (!day || !trade) return null;
  const metrics = deriveTradeMetrics(trade);
  const result = metrics.isWin === 1 ? "WIN" : metrics.isWin === 0 ? "LOSS" : "OPEN";
  const direction = (metrics.direction || trade.direction || "").toLowerCase();
  return {
    id: `${day.id || "day"}:${trade.id || idx}`,
    day,
    trade,
    date: day.date || "",
    instrument: day.instrument || "",
    strategy: trade.strategy || "",
    direction,
    entry_price: numOrNullRaw(trade.entry_price),
    exit_price: numOrNullRaw(trade.exit_price),
    rr: metrics.rr == null ? null : Number(metrics.rr),
    pnl: metrics.pnl == null ? null : Number(metrics.pnl),
    result,
    resultRank: result === "WIN" ? 2 : result === "OPEN" ? 1 : 0,
    tags: normalizeTradeTags(trade.tags),
  };
}

function getJournalTradeRows(days = state.days) {
  const rows = [];
  (days || []).forEach(day => {
    (day.trades || []).forEach((trade, idx) => {
      const row = buildJournalTradeRow(day, trade, idx);
      if (row) rows.push(row);
    });
  });
  return rows;
}

function rowMatchesJournalTradeFilters(row, filters = state.journalTradeFilters) {
  if (!row) return false;
  const f = filters || defaultJournalTradeFilters();

  if (f.strategy && f.strategy !== "ALL" && row.strategy !== f.strategy) return false;
  if (f.result && f.result !== "ALL" && row.result !== f.result) return false;
  if (f.tag && Array.isArray(f.tag) && f.tag[0] !== "ALL") {
    var hasTag = (row.tags || []).some(function (t) {
      return f.tag.some(function (selected) { return String(t).toLowerCase() === String(selected).toLowerCase(); });
    });
    if (!hasTag) return false;
  }

  const min = parseFilterNumber(f.pnlMin);
  const max = parseFilterNumber(f.pnlMax);
  const pnl = row.pnl == null ? 0 : Number(row.pnl);
  if (min != null && pnl < min) return false;
  if (max != null && pnl > max) return false;

  // Full-text search — minimum 2 caracteres, cherche dans les textes longs du trade
  if (f.search && f.search.trim().length >= 2) {
    var q = f.search.trim().toLowerCase();
    var t = row.trade || {};
    var haystack = [
      t.why_trade, t.scenario, t.why_entry,
      t.why_stop, t.why_tp, t.lessons_learned,
      t.plan_override_reason, t.plan_snapshot,
    ].concat(row.tags || []).filter(Boolean).join(" ").toLowerCase();
    if (haystack.indexOf(q) === -1) return false;
  }

  return true;
}

function getFilteredJournalTradeRows(days = state.days) {
  return getJournalTradeRows(days).filter(row => rowMatchesJournalTradeFilters(row));
}

function compareNullableNumbers(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return Number(a) - Number(b);
}
