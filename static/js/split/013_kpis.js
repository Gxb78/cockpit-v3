// ---------- KPIs ----------

function _kpiPeriodRange() {
  // Week mode (journalViewMode) a priorite sur journalRangeMode
  if (state.journalViewMode === "week") {
    var start = startOfWeek(state.currentMonth || new Date());
    var end = endOfWeek(state.currentMonth || new Date());
    return { from: fmtDateKey(start), to: fmtDateKey(end) };
  }
  if (state.journalRangeMode === "custom" && state.journalCustomFrom && state.journalCustomTo) {
    return { from: state.journalCustomFrom, to: state.journalCustomTo };
  }
  if (state.journalRangeMode === "quarter") {
    return quarterRange(state.currentMonth || new Date());
  }
  // month mode (defaut)
  return monthRange(state.currentMonth || new Date());
}

function getTradesForCurrentFilter() {
  var days = state.allDays || [];
  var range = _kpiPeriodRange();
  if (!range || !range.from || !range.to) return days.flatMap(function (d) { return d.trades || []; });
  return days
    .filter(function (d) { return d.date >= range.from && d.date <= range.to; })
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

function _getPeriodRange() {
  return _kpiPeriodRange();
}

function buildLast30PnlSeries() {
  const byDate = {};
  (state.allDays || []).forEach(day => {
    const key = day.date;
    if (!key) return;
    const pnl = (day.trades || []).reduce(function(sum, t) {
      var metrics = deriveTradeMetrics(t);
      return sum + Number(metrics.pnl || 0);
    }, 0);
    byDate[key] = (byDate[key] || 0) + pnl;
  });

  // Use current journal period instead of hardcoded last-30-days
  const range = _getPeriodRange();
  const out = [];

  if (range && range.from && range.to) {
    var p = range.from.split("-").map(Number);
    var cur = new Date(p[0], p[1] - 1, p[2]);
    var ep = range.to.split("-").map(Number);
    var end = new Date(ep[0], ep[1] - 1, ep[2]);
    var maxBars = 90;
    while (cur <= end && out.length < maxBars) {
      var key = fmtDateKey(cur);
      out.push({ date: key, pnl: Number(byDate[key] || 0) });
      cur.setDate(cur.getDate() + 1);
    }
  }

  // Fallback: last 30 days from today
  if (out.length === 0) {
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    for (var i = 29; i >= 0; i -= 1) {
      var d = new Date(today);
      d.setDate(today.getDate() - i);
      var key = fmtDateKey(d);
      out.push({ date: key, pnl: Number(byDate[key] || 0) });
    }
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
    if (zero) zero.classList.add("hidden");
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
    zero.classList.remove("hidden");
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
    function _fmtSparkDate(d) {
      if (!d) return "";
      var p = d.split("-").map(Number);
      return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
    }
    labels.innerHTML =
      '<span class="spark-label">' + _fmtSparkDate(first.date) + '</span>' +
      '<span class="spark-label">' + _fmtSparkDate(mid.date) + '</span>' +
      '<span class="spark-label">' + _fmtSparkDate(last.date) + '</span>';
  }

  const total30 = values.reduce((sum, v) => sum + v, 0);
  const tone = total30 > 0 ? "pos" : total30 < 0 ? "neg" : "flat";
  line.setAttribute("class", `spark-line ${tone}`);
  empty.classList.add("hidden");

  // D-20: Tooltip au survol — nearest data point
  var wrap = document.querySelector(".kpi-spark-wrap");
  if (!wrap) return;
  var tip = document.getElementById("kpiPnlSparkTip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "kpiPnlSparkTip";
    tip.className = "spark-tooltip hidden";
    wrap.appendChild(tip);
  }
  var svg = document.getElementById("kpiPnlSpark");
  if (!svg._sparkBound) {
    svg._sparkBound = true;
    svg.addEventListener("mousemove", function(e) {
      var rect = svg.getBoundingClientRect();
      var relX = e.clientX - rect.left;
      var pctX = relX / rect.width;
      var idx = Math.round(pctX * (series.length - 1));
      idx = Math.max(0, Math.min(series.length - 1, idx));
      var pt = series[idx];
      if (!pt) return;
      tip.style.left = (relX - 30) + "px";
      var p = pt.date.split("-").map(Number);
      var d = new Date(p[0], p[1] - 1, p[2]);
      var label = d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
      var val = pt.pnl;
      var sign = val >= 0 ? "+" : "";
      tip.innerHTML = label + " : " + sign + val.toFixed(2) + "€";
      tip.classList.remove("hidden");
    });
    svg.addEventListener("mouseleave", function() {
      tip.classList.add("hidden");
    });
  }
}

function renderKPIs(s) {
  s = s || {};
  const d = computeDerivedTodayKPIs(s);
  var pnlEl = $("#kpiPnl");
  if (pnlEl) {
    pnlEl.textContent = fmtMoney(d.totalPnl);
    pnlEl.className = "kpi-pnl " + (d.totalPnl >= 0 ? "pnl-pos" : "pnl-neg");
  }
  // Update period label
  var pnlSub = $("#kpiPnlSub");
  if (pnlSub) {
    var range = _kpiPeriodRange();
    if (range && range.from && range.to) {
      var p = range.from.split("-").map(Number);
      var f = new Date(p[0], p[1] - 1, p[2]);
      var pe = range.to.split("-").map(Number);
      var t = new Date(pe[0], pe[1] - 1, pe[2]);
      pnlSub.textContent = f.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
        + " - " + t.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
    }
  }
  var wrEl = $("#kpiWinrate");
  if (wrEl) {
    if (d.numTrades > 0) _animateCounter(wrEl, Math.round(s.winrate || 0), "%", { duration: 500 });
    else wrEl.textContent = "\u2014";
  }
  var winsEl = $("#kpiWins");
  if (winsEl) winsEl.textContent = d.numTrades > 0 ? `${s.wins}W` : "\u2014";
  var lossesEl = $("#kpiLosses");
  if (lossesEl) lossesEl.textContent = d.numTrades > 0 ? `${s.losses}L` : "\u2014";
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
    rrBar = $("#kpiRRBar");
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
  var tsEl = $("#kpiTradesSub");
  if (tsEl) tsEl.textContent = d.numTrades > 0
    ? `${tradesLabel} \u00B7 ${d.expectancy != null && isFinite(d.expectancy) ? fmtMoney(d.expectancy) : "—"} moyen / trade`
    : "Aucun trade enregistre";

  let pfText = "\u2014";
  let pfTooltipText = "";
  if (d.profitFactor === Infinity) { pfText = "\u221E"; pfTooltipText = "Aucune perte enregistree"; }
  else if (Number.isFinite(d.profitFactor)) pfText = d.profitFactor.toFixed(2);
  var pfEl = $("#kpiProfitFactor");
  if (pfEl) {
    pfEl.textContent = pfText;
    pfEl.style.color = pfText === "\u221E" ? "var(--win)" : "";
  }
  var pfTip = $("#pfTooltip");
  if (pfTip) { pfTip.textContent = pfTooltipText; pfTip.setAttribute("aria-hidden", pfTooltipText ? "false" : "true"); }

  var expEl = $("#kpiExpectancy");
  if (expEl) expEl.textContent = d.expectancy == null ? "\u2014" : fmtMoney(d.expectancy);
  var expSubEl = $("#kpiExpectancySub");
  if (expSubEl) expSubEl.textContent = d.numTrades > 0
    ? `${tradesLabel} pris en compte`
    : "Moyenne par trade";
  // Streak
  var streakVal = Number(s.streak);
  var streakEl = $("#kpiStreak");
  if (streakEl) {
    if (streakVal > 0) _animateCounter(streakEl, streakVal, "", { duration: 400 });
    else streakEl.textContent = "\u2014";
  }
  var streakSub = $("#kpiStreakSub");
  if (streakSub) {
    streakSub.textContent = streakVal > 1 ? streakVal + " consecutifs" : streakVal === 1 ? "jour" : "\u2014";
  }

  renderPnlSparkline();

  // Remove skeleton loading state
  document.querySelector('[data-widget-board="today"]')?.classList.remove("loading");
}

// Animator: compte de 0 a target sur element
var _animRunning = null;
var _reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function _animateCounter(el, target, suffix, opts) {
  if (!el) return;
  if (_reduceMotion) { el.textContent = target + (suffix || ""); return; }
  suffix = suffix || "";
  opts = opts || {};
  var current = parseFloat(el.textContent) || 0;
  if (current === target || target === 0) {
    el.textContent = target + suffix;
    return;
  }
  var start = performance.now();
  var from = current;
  var decimals = opts.decimals || 0;
  var duration = opts.duration || Math.min(600, Math.max(200, Math.abs(target) * 3));
  function _tick(now) {
    var t = Math.min(1, (now - start) / duration);
    var val = (from + (target - from) * t).toFixed(decimals);
    el.textContent = Number(val) + suffix;
    if (t < 1) requestAnimationFrame(_tick);
  }
  requestAnimationFrame(_tick);
}
