// ---------- KPIs ----------

function getTradesForCurrentFilter() {
  return (state.allDays || []).flatMap(day => day.trades || []);
}

function computeDerivedTodayKPIs(s) {
  const trades = getTradesForCurrentFilter();
  const derivedTrades = trades.map(t => ({ trade: t, metrics: deriveTradeMetrics(t) }));
  const totalPnl = Number(s?.total_pnl ?? derivedTrades.reduce((sum, x) => sum + Number(x.metrics.pnl || 0), 0));
  const numTrades = Number(s?.num_trades ?? trades.length);
  const rrValues = derivedTrades
    .map(x => Number(x.metrics.rr))
    .filter(v => Number.isFinite(v));
  const avgRR = rrValues.length > 0
    ? rrValues.reduce((sum, v) => sum + v, 0) / rrValues.length
    : null;

  let grossGains = 0;
  let grossLossesAbs = 0;
  derivedTrades.forEach(x => {
    const pnl = Number(x.metrics.pnl || 0);
    if (pnl > 0) grossGains += pnl;
    if (pnl < 0) grossLossesAbs += Math.abs(pnl);
  });

  let profitFactor = null;
  if (grossLossesAbs > 0) profitFactor = grossGains / grossLossesAbs;
  else if (grossGains > 0) profitFactor = Infinity;

  const expectancy = numTrades > 0 ? totalPnl / numTrades : null;
  return {
    numTrades,
    totalPnl,
    avgRR,
    rrCount: rrValues.length,
    grossGains,
    grossLossesAbs,
    profitFactor,
    expectancy,
  };
}

function buildLast30PnlSeries() {
  const byDate = {};
  (state.allDays || []).forEach(day => {
    const key = day.date;
    if (!key) return;
    const pnl = (day.trades || []).reduce((sum, t) => sum + Number(t.pnl || 0), 0);
    byDate[key] = (byDate[key] || 0) + pnl;
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out = [];
  for (let i = 29; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = fmtDateKey(d);
    out.push({ date: key, pnl: Number(byDate[key] || 0) });
  }
  return out;
}

function renderPnlSparkline() {
  const line = $("#kpiPnlSparkLine");
  const empty = $("#kpiPnlSparkEmpty");
  if (!line || !empty) return;

  const series = buildLast30PnlSeries();
  const values = series.map(v => v.pnl);
  const hasData = values.some(v => v !== 0);

  if (!hasData) {
    line.setAttribute("points", "");
    line.setAttribute("class", "spark-line flat");
    empty.classList.remove("hidden");
    return;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 180;
  const height = 42;
  const padX = 2;
  const padY = 5;
  const stepX = (width - padX * 2) / Math.max(values.length - 1, 1);

  const points = values.map((v, i) => {
    const x = padX + i * stepX;
    const y = padY + (height - padY * 2) * (1 - (v - min) / range);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  line.setAttribute("points", points);

  const total30 = values.reduce((sum, v) => sum + v, 0);
  const tone = total30 > 0 ? "pos" : total30 < 0 ? "neg" : "flat";
  line.setAttribute("class", `spark-line ${tone}`);
  empty.classList.add("hidden");
}

function renderKPIs(s) {
  const d = computeDerivedTodayKPIs(s);
  const pnlEl = $("#kpiPnl");
  pnlEl.textContent = fmtMoney(d.totalPnl);
  pnlEl.style.color = d.totalPnl >= 0 ? "var(--win)" : "var(--loss)";
  var wrEl = $("#kpiWinrate");
  if (wrEl) wrEl.textContent = d.numTrades > 0 ? `${(s.winrate || 0).toFixed(1)}%` : "\u2014";
  $("#kpiWins").textContent = `${s.wins}W`;
  $("#kpiLosses").textContent = `${s.losses}L`;
  $("#kpiWinrateBar").style.transform = `scaleX(${Math.min(s.winrate || 0, 100) / 100})`;

  if (d.rrCount > 0) {
    $("#kpiRR").textContent = d.avgRR.toFixed(2);
    $("#kpiRRBar").style.transform = `scaleX(${Math.min((Math.abs(d.avgRR) || 0) / 5 * 100, 100) / 100})`;
  } else {
    $("#kpiRR").textContent = "\u2014";
    $("#kpiRRBar").style.transform = "scaleX(0)";
  }

  const tradesLabel = `${d.numTrades} trade${d.numTrades > 1 ? "s" : ""}`;
  $("#kpiTrades").textContent = d.numTrades > 0 ? `${d.numTrades}` : "\u2014";
  $("#kpiTradesSub").textContent = d.numTrades > 0
    ? `${tradesLabel} \u00B7 ${fmtMoney(d.expectancy)} moyen / trade`
    : "Aucun trade enregistre";

  let pfText = "\u2014";
  let pfTitle = "";
  if (d.profitFactor === Infinity) { pfText = "\u221E"; pfTitle = "Aucune perte enregistree"; }
  else if (Number.isFinite(d.profitFactor)) pfText = d.profitFactor.toFixed(2);
  var pfEl = $("#kpiProfitFactor");
  if (pfEl) { pfEl.textContent = pfText; pfEl.title = pfTitle; }

  var expEl = $("#kpiExpectancy");
  if (expEl) expEl.textContent = d.expectancy == null ? "\u2014" : fmtMoney(d.expectancy);
  var expSubEl = $("#kpiExpectancySub");
  if (expSubEl) expSubEl.textContent = d.numTrades > 0
    ? `${tradesLabel} pris en compte`
    : "$ moyen par trade";
  // Streak
  var streakEl = $("#kpiStreak");
  if (streakEl) streakEl.textContent = s.streak || 0;
  var streakSub = $("#kpiStreakSub");
  if (streakSub) {
    var streakVal = Number(s.streak) || 0;
    streakSub.textContent = streakVal > 1 ? streakVal + " consecutifs" : "jour";
  }

  renderPnlSparkline();

  // Remove skeleton loading state
  document.querySelector('[data-widget-board="today"]')?.classList.remove("loading");
}
