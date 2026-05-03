// ---------- KPIs ----------

function getTradesForCurrentFilter() {
  // Filtrer par la periode courante (Journal range)
  var days = state.allDays || [];
  var from = null, to = null;

  if (state.journalRangeMode === "custom" && state.journalCustomFrom && state.journalCustomTo) {
    from = state.journalCustomFrom;
    to = state.journalCustomTo;
  } else if (state.journalRangeMode === "quarter") {
    var q = quarterRange(state.currentMonth || new Date());
    from = q.from;
    to = q.to;
  } else {
    // month mode (defaut)
    var m = monthRange(state.currentMonth || new Date());
    from = m.from;
    to = m.to;
  }

  if (!from || !to) return days.flatMap(function (d) { return d.trades || []; });

  return days
    .filter(function (d) { return d.date >= from && d.date <= to; })
    .flatMap(function (d) { return d.trades || []; });
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
  const zero = $("#kpiPnlZero");
  const labels = $("#kpiPnlSparkLabels");
  if (!line || !empty) return;

  const series = buildLast30PnlSeries();
  const values = series.map(v => v.pnl);
  const hasData = values.some(v => v !== 0);

  if (!hasData) {
    line.setAttribute("points", "");
    line.setAttribute("class", "spark-line flat");
    empty.classList.remove("hidden");
    if (labels) labels.innerHTML = "";
    if (zero) zero.setAttribute("y1", "21");
    return;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 180;
  const height = 42;
  const padX = 2;
  const padY = 5;
  const dataH = height - padY * 2;
  const stepX = (width - padX * 2) / Math.max(values.length - 1, 1);

  // Zero line position (y where v=0)
  if (zero) {
    const zeroY = padY + dataH * (1 - (0 - min) / range);
    zero.setAttribute("y1", zeroY.toFixed(1));
    zero.setAttribute("y2", zeroY.toFixed(1));
  }

  const points = values.map((v, i) => {
    const x = padX + i * stepX;
    const y = padY + dataH * (1 - (v - min) / range);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  line.setAttribute("points", points);

  // Date labels (first, middle, last)
  if (labels) {
    var total = series.length;
    var first = series[0];
    var mid = series[Math.floor(total / 2)];
    var last = series[total - 1];
    labels.innerHTML =
      '<span class="spark-label">' + (first.date ? first.date.slice(5) : "") + '</span>' +
      '<span class="spark-label">' + (mid.date ? mid.date.slice(5) : "") + '</span>' +
      '<span class="spark-label">' + (last.date ? last.date.slice(5) : "") + '</span>';
  }

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
  if (wrEl) {
    if (d.numTrades > 0) _animateCounter(wrEl, Math.round(s.winrate || 0), "%", { duration: 500 });
    else wrEl.textContent = "\u2014";
  }
  $("#kpiWins").textContent = `${s.wins}W`;
  $("#kpiLosses").textContent = `${s.losses}L`;
  var wrBar = $("#kpiWinrateBar");
  if (wrBar) {
    wrBar.style.transform = "scaleX(" + Math.min(s.winrate || 0, 100) / 100 + ")";
    wrBar.setAttribute("role", "progressbar");
    wrBar.setAttribute("aria-valuenow", String(Math.round(s.winrate || 0)));
    wrBar.setAttribute("aria-valuemin", "0");
    wrBar.setAttribute("aria-valuemax", "100");
    wrBar.setAttribute("aria-label", Math.round(s.winrate || 0) + "% winrate");
  }

  if (d.rrCount > 0) {
    _animateCounter($("#kpiRR"), d.avgRR, "", { duration: 500, decimals: 2 });
    var rrBar = $("#kpiRRBar");
    if (rrBar) {
      rrBar.style.transform = "scaleX(" + Math.min(Math.abs(d.avgRR) || 0, 5) / 5 + ")";
      rrBar.setAttribute("role", "progressbar");
      rrBar.setAttribute("aria-valuenow", String(d.avgRR.toFixed(2)));
      rrBar.setAttribute("aria-valuemin", "0");
      rrBar.setAttribute("aria-valuemax", "5");
      rrBar.setAttribute("aria-label", d.avgRR.toFixed(2) + "R moyen");
    }
  } else {
    $("#kpiRR").textContent = "\u2014";
    var rrBar = $("#kpiRRBar");
    if (rrBar) {
      rrBar.style.transform = "scaleX(0)";
      rrBar.removeAttribute("aria-valuenow");
    }
  }

  const tradesLabel = `${d.numTrades} trade${d.numTrades > 1 ? "s" : ""}`;
  var tradesEl = $("#kpiTrades");
  if (tradesEl) {
    if (d.numTrades > 0) _animateCounter(tradesEl, d.numTrades, "", { duration: 400 });
    else tradesEl.textContent = "\u2014";
  }
  $("#kpiTradesSub").textContent = d.numTrades > 0
    ? `${tradesLabel} \u00B7 ${fmtMoney(d.expectancy)} moyen / trade`
    : "Aucun trade enregistre";

  let pfText = "\u2014";
  let pfTooltipText = "";
  if (d.profitFactor === Infinity) { pfText = "\u221E"; pfTooltipText = "Aucune perte enregistree"; }
  else if (Number.isFinite(d.profitFactor)) pfText = d.profitFactor.toFixed(2);
  var pfEl = $("#kpiProfitFactor");
  if (pfEl) { pfEl.textContent = pfText; }
  var pfTip = $("#pfTooltip");
  if (pfTip) { pfTip.textContent = pfTooltipText; pfTip.setAttribute("aria-hidden", pfTooltipText ? "false" : "true"); }

  var expEl = $("#kpiExpectancy");
  if (expEl) expEl.textContent = d.expectancy == null ? "\u2014" : fmtMoney(d.expectancy);
  var expSubEl = $("#kpiExpectancySub");
  if (expSubEl) expSubEl.textContent = d.numTrades > 0
    ? `${tradesLabel} pris en compte`
    : "$ moyen par trade";
  // Streak
  var streakEl = $("#kpiStreak");
  if (streakEl) _animateCounter(streakEl, Number(s.streak) || 0);
  var streakSub = $("#kpiStreakSub");
  if (streakSub) {
    var streakVal = Number(s.streak) || 0;
    streakSub.textContent = streakVal > 1 ? streakVal + " consecutifs" : streakVal === 1 ? "jour" : "\u2014";
  }

  renderPnlSparkline();

  // Remove skeleton loading state
  document.querySelector('[data-widget-board="today"]')?.classList.remove("loading");
}

// Animator: compte de 0 a target sur element
var _animRunning = null;
function _animateCounter(el, target) {
  if (!el) return;
  var current = parseInt(el.textContent, 10) || 0;
  if (current === target || target === 0) {
    el.textContent = target;
    return;
  }
  var start = performance.now();
  var from = current;
  var duration = Math.min(600, Math.max(200, target * 30));
  function _tick(now) {
    var t = Math.min(1, (now - start) / duration);
    var val = Math.round(from + (target - from) * t);
    el.textContent = val;
    if (t < 1) requestAnimationFrame(_tick);
  }
  requestAnimationFrame(_tick);
}
