function compareText(a, b) {
  return String(a || "").localeCompare(String(b || ""), "fr", { sensitivity: "base" });
}

let _journalRenderRaf = 0;
let _journalTableRowsCache = [];
let _journalTableBodyBound = false;
let _journalTableObserver = null;
let _journalTableCurrentPage = 0;
let _journalTableTotalRows = 0;

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
      dir.textContent = state.journalTableSortDir === "asc" ? "\u25B2" : "\u25BC";
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

  // Tags chips — click toggles selection
  var tagChips = document.getElementById("journalTagChips");
  if (tagChips) {
    tagChips.addEventListener("click", function (e) {
      var chip = e.target.closest(".tag-chip");
      if (!chip) return;
      var val = chip.dataset.tag;
      var current = Array.isArray(state.journalTradeFilters.tag) ? state.journalTradeFilters.tag.slice() : ["ALL"];
      if (val === "ALL") {
        // "Tous" → reset to ALL
        state.journalTradeFilters.tag = ["ALL"];
      } else {
        if (current[0] === "ALL") current = [];
        var idx = current.indexOf(val);
        if (idx >= 0) {
          current.splice(idx, 1); // deselect
        } else {
          current.push(val); // select
        }
        if (!current.length) current = ["ALL"];
        state.journalTradeFilters.tag = current;
      }
      updateJournalTradeFiltersUI();
      applyJournalTradeFiltersAndRender();
    });
  }

  let timer = null;
  const onPnlInput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.journalTradeFilters.pnlMin = minInput?.value || "";
      state.journalTradeFilters.pnlMax = maxInput?.value || "";
      // Validation croisee: min ≤ max
      var minVal = parseFilterNumber(minInput?.value);
      var maxVal = parseFilterNumber(maxInput?.value);
      var invalid = minVal != null && maxVal != null && minVal > maxVal;
      if (minInput) minInput.classList.toggle("jedit-field-error", invalid);
      if (maxInput) maxInput.classList.toggle("jedit-field-error", invalid);
      // Message d'erreur
      var errEl = document.getElementById("pnlRangeError");
      if (errEl) errEl.classList.toggle("hidden", !invalid);
      if (invalid) return;  // ne pas appliquer le filtre si invalide
      applyJournalTradeFiltersAndRender();
    }, 140);
  };
  minInput?.addEventListener("input", onPnlInput);
  maxInput?.addEventListener("input", onPnlInput);

  // Search — debounce 200ms, hint glow si < 2 chars
  const searchInput = $("#journalFilterSearch");
  let searchTimer = null;
  const hideSearchHint = function () {
    if (searchInput) {
      searchInput.classList.remove("search-too-short");
      searchInput.classList.remove("jedit-field-error");
      var hint = document.getElementById("journalSearchHint");
      if (hint) hint.classList.add("hidden");
    }
  };
  const onSearchInput = function () {
    clearTimeout(searchTimer);
    if (!searchInput) return;
    searchInput.classList.remove("search-too-short");
    searchInput.classList.remove("jedit-field-error");
    var hint = document.getElementById("journalSearchHint");
    if (hint) hint.classList.add("hidden");
    var val = (searchInput.value || "").trim();
    searchTimer = setTimeout(function () {
      state.journalTradeFilters.search = val;
      if (val.length >= 2) {
        fetch("/api/journal/search?q=" + encodeURIComponent(val), { credentials: "same-origin" })
          .then(function(r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
          .then(function(data) {
            if (data && data.days) {
              state._savedDays = state._savedDays || state.days;
              state.days = data.days;
              applyJournalTradeFiltersAndRender();
            }
          })
          .catch(function() {});
      } else {
        if (val.length === 0 && state._savedDays) {
          state.days = state._savedDays;
          state._savedDays = null;
        }
        applyJournalTradeFiltersAndRender();
      }
      // Glow rouge si < 2 chars (sauf vide)
      if (val.length === 1) {
        searchInput.classList.add("search-too-short");
        searchInput.classList.add("jedit-field-error");
        if (hint) hint.classList.remove("hidden");
      }
    }, 200);
  };
  if (searchInput) {
    searchInput.addEventListener("input", onSearchInput);
    searchInput.addEventListener("blur", hideSearchHint);
  }

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
  var pageSize = 100;
  var visibleRows = rows.slice(0, pageSize);

  visibleRows.forEach((row, idx) => {
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

  // Lazy load : observer l'intersection pour charger les pages suivantes
  var pageSize = 100;
  if (_journalTableObserver) _journalTableObserver.disconnect();
  _journalTableCurrentPage = 0;
  _journalTableTotalRows = rows.length;
  if (rows.length > pageSize) {
    _journalTableCurrentPage = 1; // 1 page deja chargee
    var sentinel = document.createElement("tr");
    sentinel.id = "journalTableSentinel";
    sentinel.innerHTML = '<td colspan="10" style="text-align:center;padding:16px"><span class="muted" style="font-size:11px">Chargement...</span></td>';
    tbody.appendChild(sentinel);
    _journalTableObserver = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      if (_journalTableCurrentPage * pageSize >= _journalTableTotalRows) {
        _journalTableObserver.disconnect();
        sentinel.querySelector("td").innerHTML = '<span class="muted" style="font-size:11px">' + _journalTableTotalRows + " trades</span>";
        return;
      }
      var start = _journalTableCurrentPage * pageSize;
      var end = Math.min(start + pageSize, _journalTableTotalRows);
      var batch = rows.slice(start, end);
      var frag = document.createDocumentFragment();
      batch.forEach(function (row, idx) {
        var tr = document.createElement("tr");
        tr.dataset.rowIndex = String(start + idx);
        var pnlClass = row.pnl > 0 ? "pos" : row.pnl < 0 ? "neg" : "";
        var dir = row.direction ? row.direction.toUpperCase() : "-";
        var pnlTxt = row.pnl == null ? "-" : fmtMoney(row.pnl);
        tr.innerHTML = '<td class="mono">' + escapeHtml(row.date || "-") + '</td><td>' + escapeHtml(wizInstrumentLabel(row.instrument)) + '</td><td>' + escapeHtml(prettify(row.strategy || "")) + '</td><td class="mono ' + (row.direction === 'long' ? 'dir-long' : 'dir-short') + '">' + escapeHtml(dir) + '</td><td class="mono">' + (row.entry_price != null ? Number(row.entry_price).toFixed(2) : "-") + '</td><td class="mono">' + (row.exit_price != null ? Number(row.exit_price).toFixed(2) : "-") + '</td><td class="mono">' + (row.rr != null ? Number(row.rr).toFixed(2) + "R" : "-") + '</td><td class="mono journal-td-pnl ' + pnlClass + '">' + pnlTxt + '</td><td class="mono ' + (row.result || "").toLowerCase() + '">' + escapeHtml(row.result || "-") + "</td>";
        frag.appendChild(tr);
      });
      sentinel.parentNode.insertBefore(frag, sentinel);
      _journalTableCurrentPage++;
      var loaded = Math.min(_journalTableCurrentPage * pageSize, _journalTableTotalRows);
      sentinel.querySelector("td").innerHTML = '<span class="muted" style="font-size:11px">' + loaded + "/" + _journalTableTotalRows + " trades...</span>";
    }, { rootMargin: "200px" });
    _journalTableObserver.observe(sentinel);
  }

  const count = rows.length;
  countEl.textContent = `${count} trade${count > 1 ? "s" : ""}`;
  emptyEl.classList.toggle("hidden", count > 0);
}

