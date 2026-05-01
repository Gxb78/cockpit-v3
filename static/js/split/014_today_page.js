// ---------- TODAY page ----------

function renderToday() {
  renderTodayCalendar();
  renderTodayContextWidget();
  const today   = todayKey();
  const todayList = state.allDays.filter(d => d.date === today);
  const recent    = state.allDays.filter(d => d.date !== today).slice(0, 2);

  const todayEl = $("#todayEntries");
  todayEl.innerHTML = "";
  if (todayList.length === 0) {
    todayEl.innerHTML = `<div class="empty-state">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <div>Aucune entrée pour aujourd'hui.</div>
      <div class="empty-cta" id="emptyTodayCta"></div></div>`;
    var cta = document.getElementById("emptyTodayCta");
    if (cta) {
      var btn = document.createElement("button");
      btn.className = "btn-ghost";
      btn.textContent = "Nouvelle entree";
      btn.addEventListener("click", function () { wizOpen({ date: todayKey() }); });
      cta.appendChild(btn);
    }
  } else {
    todayList.forEach(d => todayEl.appendChild(dayCardEl(d)));
  }

  const recentEl = $("#recentEntries");
  if (recentEl) {
    recentEl.innerHTML = "";
    if (recent.length === 0) {
      recentEl.innerHTML = '<div class="empty-state"><div>Pas encore d\'historique</div></div>';
    } else {
      recent.forEach(d => recentEl.appendChild(dayCardEl(d)));
    }
  }
}

function findTodayContextDay() {
  const tk = todayKey();
  const sources = []
    .concat(Array.isArray(state.allDays) ? state.allDays : [])
    .concat(Array.isArray(state.days) ? state.days : []);
  return sources.find(d => d && d.date === tk) || null;
}

function renderTodayContextWidget(force) {
  const form = $("#dayForm");
  if (!form) return;
  if (!force && form.contains(document.activeElement)) return;

  const tk = todayKey();
  const day = findTodayContextDay();
  $("#dayId").value = day?.id || "";
  $("#entryDate").value = day?.date || tk;
  $("#entryInstrument").value = day?.instrument || _lastInstrument();
  syncTodayContextSelectUI();
  $("#htfContext").value = day?.htf_context || "";
  $("#dailyNotes").value = day?.daily_notes || "";
  setPill("htf_bias", day?.htf_bias || null);
  state.initialDayPayload = buildDayPayload();
  state.initialDayState = snapshotDayForm();
}

function syncTodayContextSelectUI() {
  // No-op: le select est directement stylé comme un badge entry-card
}

function dayCardEl(day) {
  const card = document.createElement("div");
  card.className = "entry-card";
  card.dataset.instr = day.instrument;

  const trades = day.trades || [];
  const derived = trades.map(t => deriveTradeMetrics(t));
  const totalPnl = derived.reduce((sum, m) => sum + Number(m.pnl || 0), 0);
  const wins = derived.filter(m => m.isWin === 1).length;
  const losses = derived.filter(m => m.isWin === 0).length;
  const pnlClass = totalPnl > 0 ? "pos" : totalPnl < 0 ? "neg" : "";

  const strategies = [...new Set(trades.map(t => t.strategy).filter(Boolean))];
  const stratChips = strategies.map(s =>
    `<span class="tag">${escapeHtml(prettify(s))}</span>`
  ).join("");

  const firstTrade = trades[0];
  const title = firstTrade?.why_trade?.trim()
    || firstTrade?.scenario?.trim()
    || (strategies[0] ? prettify(strategies[0]) : "")
    || `Journee ${day.date}`;

  let resultClass = "neutral";
  let resultLabel = "\u2014";
  if (wins > 0 && losses === 0) {
    resultClass = "win";
    resultLabel = `W ${wins}`;
  } else if (losses > 0 && wins === 0) {
    resultClass = "loss";
    resultLabel = `L ${losses}`;
  } else if (wins > 0 && losses > 0) {
    resultClass = "mixed";
    resultLabel = `${wins}W/${losses}L`;
  }

  card.innerHTML = `
    <div class="entry-instr">${escapeHtml(day.instrument || "-")}</div>
    <div class="entry-meta">
      <div class="entry-title">${escapeHtml(title.slice(0, 80))}</div>
      <div class="entry-tags">
        ${day.date !== todayKey() ? `<span class="tag">${day.date}</span>` : ""}
        ${stratChips}
        ${trades.length > 0 ? `<span class="tag">${trades.length} trade${trades.length > 1 ? "s" : ""}</span>` : ""}
      </div>
    </div>
    <div class="entry-outcome">
      <span class="entry-result-chip ${resultClass}">${resultLabel}</span>
      <div class="entry-pnl ${pnlClass}">${fmtMoney(totalPnl)}</div>
    </div>
  `;
  card.addEventListener("click", () => openExistingDay(day));
  return card;
}

