function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), "fr", { sensitivity: "base" });
}

let _journalRenderRaf = 0;
let _journalTableRowsCache = [];
let _journalTableBodyBound = false;

function scheduleJournalCalendarRender() {
  if (_journalRenderRaf) return;
  _journalRenderRaf = requestAnimationFrame(() => {
    _journalRenderRaf = 0;
    if (state.currentPage === "journal") {
      if (typeof closeJournalDayTrades === "function") closeJournalDayTrades();
      renderCalendar();
    }
  });
}

function bindJournalTableBodyActions(tbody) {
  if (!tbody || _journalTableBodyBound) return;
  tbody.addEventListener("click", (e) => {
    const tr = e.target.closest("tr");
    if (!tr) return;
    const idx = Number(tr.dataset.rowIndex);
    if (!Number.isFinite(idx)) return;
    const row = _journalTableRowsCache[idx];
    if (!row) return;
    openJournalTradeRow(row);
  });
  _journalTableBodyBound = true;
}

function compareJournalTradeRows(a, b, key) {
  switch (key) {
    case "date":
      return compareText(a.date, b.date);
    case "instrument":
      return compareText(a.instrument, b.instrument);
    case "strategy":
      return compareText(prettify(a.strategy), prettify(b.strategy));
    case "direction":
      return compareText(a.direction, b.direction);
    case "entry_price":
      return compareNullableNumbers(a.entry_price, b.entry_price);
    case "exit_price":
      return compareNullableNumbers(a.exit_price, b.exit_price);
    case "rr":
      return compareNullableNumbers(a.rr, b.rr);
    case "pnl":
      return compareNullableNumbers(a.pnl, b.pnl);
    case "result":
      return compareNullableNumbers(a.resultRank, b.resultRank);
    default:
      return 0;
  }
}

function getSortedJournalTradeRows(days = state.days) {
  const rows = getFilteredJournalTradeRows(days).slice();
  const key = JOURNAL_TABLE_SORT_KEYS.has(state.journalTableSortKey) ? state.journalTableSortKey : "date";
  const dir = state.journalTableSortDir === "asc" ? "asc" : "desc";
  rows.sort((a, b) => {
    const cmp = compareJournalTradeRows(a, b, key);
    if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
    const dateCmp = compareText(b.date, a.date);
    if (dateCmp !== 0) return dateCmp;
    return Number(b.trade?.id || 0) - Number(a.trade?.id || 0);
  });
  return rows;
}

function updateJournalTableSortUI() {
  $$("#journalTableWrap .journal-sort-btn").forEach(btn => {
    if (!btn.dataset.label) btn.dataset.label = btn.textContent.trim();
    btn.innerHTML = "";
    btn.textContent = btn.dataset.label;
    const active = btn.dataset.sortKey === state.journalTableSortKey;
    btn.classList.toggle("active", active);
    if (active) {
      const dir = document.createElement("span");
      dir.className = "sort-dir";
      dir.textContent = state.journalTableSortDir === "asc" ? "^" : "v";
      btn.appendChild(dir);
    }
  });
}

function toggleJournalTableSort(sortKey) {
  if (!JOURNAL_TABLE_SORT_KEYS.has(sortKey)) return;
  if (state.journalTableSortKey === sortKey) {
    state.journalTableSortDir = state.journalTableSortDir === "asc" ? "desc" : "asc";
  } else {
    state.journalTableSortKey = sortKey;
    state.journalTableSortDir = sortKey === "date" ? "desc" : "asc";
  }
  saveJournalTableSort();
  updateJournalTableSortUI();
  renderJournalTable();
}

function bindJournalTableSort() {
  const wrap = $("#journalTableWrap");
  if (!wrap) return;
  wrap.addEventListener("click", e => {
    const btn = e.target.closest(".journal-sort-btn");
    if (!btn) return;
    toggleJournalTableSort(btn.dataset.sortKey);
  });
}

function applyJournalTradeFiltersAndRender() {
  saveJournalTradeFilters();
  scheduleJournalCalendarRender();
}

function bindJournalTradeFilters() {
  const strategySel = $("#journalFilterStrategy");
  if (!strategySel) return;
  const resultSel = $("#journalFilterResult");
  const tagSel = $("#journalFilterTag");
  const minInput = $("#journalFilterPnlMin");
  const maxInput = $("#journalFilterPnlMax");
  const resetBtn = $("#journalFilterReset");

  strategySel?.addEventListener("change", () => {
    state.journalTradeFilters.strategy = strategySel.value || "ALL";
    applyJournalTradeFiltersAndRender();
  });
  resultSel?.addEventListener("change", () => {
    state.journalTradeFilters.result = resultSel.value || "ALL";
    applyJournalTradeFiltersAndRender();
  });
  tagSel?.addEventListener("change", () => {
    state.journalTradeFilters.tag = tagSel.value || "ALL";
    applyJournalTradeFiltersAndRender();
  });

  let timer = null;
  const onPnlInput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.journalTradeFilters.pnlMin = minInput?.value || "";
      state.journalTradeFilters.pnlMax = maxInput?.value || "";
      applyJournalTradeFiltersAndRender();
    }, 140);
  };
  minInput?.addEventListener("input", onPnlInput);
  maxInput?.addEventListener("input", onPnlInput);

  resetBtn?.addEventListener("click", () => {
    state.journalTradeFilters = defaultJournalTradeFilters();
    updateJournalTradeFiltersUI();
    applyJournalTradeFiltersAndRender();
  });
}

function buildCalendarByDay(days = state.days) {
  const byDay = {};
  const activeTradeFilters = hasActiveJournalTradeFilters();

  (days || []).forEach(day => {
    const dayRows = (day.trades || [])
      .map((trade, idx) => buildJournalTradeRow(day, trade, idx))
      .filter(Boolean)
      .filter(row => rowMatchesJournalTradeFilters(row));

    const includeContextOnly = !activeTradeFilters && (day.trades || []).length === 0;
    if (!dayRows.length && !includeContextOnly) return;

    const key = day.date;
    if (!byDay[key]) byDay[key] = { days: [], pnl: 0, trades: 0, wins: 0, losses: 0 };
    byDay[key].days.push(day);
    dayRows.forEach(row => {
      byDay[key].trades += 1;
      byDay[key].pnl += Number(row.pnl || 0);
      if (row.result === "WIN") byDay[key].wins += 1;
      else if (row.result === "LOSS") byDay[key].losses += 1;
    });
  });

  return byDay;
}

function openJournalTradeRow(row) {
  if (!row?.day) return;
  if (typeof renderJournalDayTrades === "function") {
    renderJournalDayTrades(row.date, [row.day]);
    // Ouvrir l'editeur inline pour ce trade directement
    var tradeId = row.trade && row.trade.id != null ? String(row.trade.id) : null;
    if (tradeId) {
      var checkExist = setInterval(function () {
        var editBtn = document.querySelector('[data-journal-trade-edit="' + tradeId + '"]');
        if (editBtn) {
          clearInterval(checkExist);
          editBtn.click();
          editBtn.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 50);
      setTimeout(function () { clearInterval(checkExist); }, 3000);
    }
  }
}

function renderJournalTable() {
  const tbody = $("#journalTradesTbody");
  const emptyEl = $("#journalTableEmpty");
  const countEl = $("#journalTableCount");
  if (!tbody || !emptyEl || !countEl) return;

  const rows = getSortedJournalTradeRows(state.days);
  _journalTableRowsCache = rows;
  bindJournalTableBodyActions(tbody);
  updateJournalTableSortUI();
  const fragment = document.createDocumentFragment();

  rows.forEach((row, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.rowIndex = String(idx);
    const pnlClass = row.pnl > 0 ? "pos" : row.pnl < 0 ? "neg" : "";
    const dir = row.direction ? row.direction.toUpperCase() : "-";
    const pnlTxt = row.pnl == null ? "-" : fmtMoney(row.pnl);

    tr.innerHTML = `
      <td class="mono">${escapeHtml(row.date || "-")}</td>
      <td>${escapeHtml(wizInstrumentLabel(row.instrument))}</td>
      <td>${escapeHtml(prettify(row.strategy || ""))}</td>
      <td class="mono ${row.direction === 'long' ? 'dir-long' : 'dir-short'}">${escapeHtml(dir)}</td>
      <td class="mono">${row.entry_price != null ? Number(row.entry_price).toFixed(2) : "-"}</td>
      <td class="mono">${row.exit_price != null ? Number(row.exit_price).toFixed(2) : "-"}</td>
      <td class="mono">${row.rr != null ? Number(row.rr).toFixed(2) + "R" : "-"}</td>
      <td class="mono journal-td-pnl ${pnlClass}">${pnlTxt}</td>
      <td class="mono ${(row.result || "").toLowerCase()}">${escapeHtml(row.result || "-")}</td>
    `;
    fragment.appendChild(tr);
  });

  tbody.replaceChildren(fragment);

  const count = rows.length;
  countEl.textContent = `${count} trade${count > 1 ? "s" : ""}`;
  emptyEl.classList.toggle("hidden", count > 0);
}

