// ---------- Stats ----------

var _statsLastLoad = 0;
var _renderQueue = [];

function _runRenderQueue() {
  if (_renderQueue.length === 0) return;
  var fn = _renderQueue.shift();
  fn();
  if (_renderQueue.length > 0) setTimeout(_runRenderQueue, 0);
}

async function renderPerformance() {
  // Recharger les stats au maximum toutes les 30s pour eviter un cache stale
  var now = Date.now();
  if (now - _statsLastLoad > 30000) {
    await loadStats({ refreshDays: false, skipRender: true });
    _statsLastLoad = Date.now();
  }
  var s = state._stats;
  if (!s) return;

  var content = document.getElementById("statsContent");
  var empty   = document.getElementById("statsEmpty");
  if (content && empty) {
    var hasData = (s.num_trades || 0) > 0;
    content.classList.toggle("hidden", !hasData);
    empty.classList.toggle("hidden", hasData);
    if (!hasData) return;
  }

  var streakCur  = $("#statStreakCur");
  var streakBest = $("#statStreakBest");
  if (streakCur)  streakCur.textContent  = s.streak || 0;
  if (streakBest) streakBest.textContent = s.best_streak || 0;

  var animate = state.settings && state.settings.preferences && state.settings.preferences.animations !== false;

  _renderQueue = [
    function() { renderInsights(s.insights || []); },
    function() { renderHeatmap(s.activity  || []); },
    function() { renderCumChart(s.cumulative || [], { animate: animate }); },
    function() { renderDrawdownChart(s.drawdown || { series: [], max_drawdown: 0, current_drawdown: 0 }, { animate: animate }); },
    function() { renderPnlHistogram(s.pnl_histogram || []); },
    function() { renderPeriodCompare(s.period_compare || null); },
    function() { renderBreakdown("#bdSetup",   s.by_setup,   { kind:"setup" }); },
    function() { renderBreakdown("#bdSession", s.by_session, { kind:"session" }); },
    function() { renderBreakdown("#bdDow",     s.by_dow,     { kind:"dow" }); },
    function() { renderBreakdown("#bdTag",     s.by_tag,     { kind:"tag" }); },
    function() { renderPlanMatrix(s.plan_matrix || {}, s.plan_summary || {}); },
    function() { renderBreakdown("#bdPlanError", s.by_plan_error, { kind:"plan_error" }); },
    function() { renderInstrumentList(s.per_instrument); },
    function() { renderRRDist(s.rr_buckets || [0,0,0,0,0,0]); }
  ];
  _runRenderQueue();
  setTimeout(function () { enhanceSelects($("#statsContent")); }, 50);
}

const INSIGHT_ICONS = {
  trophy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0z"/></svg>`,
  alert:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  clock:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  brain:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2z"/><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2z"/></svg>`,
  warning:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  tools:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
  compass:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg>`,
  star:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
};

function insightWidgetKey(ins, seen) {
  const icon = String(ins?.icon || "star").toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const title = String(ins?.title || "item")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "item";
  const base = `stats_insight_${icon}_${title}`;
  const count = (seen[base] || 0) + 1;
  seen[base] = count;
  return count === 1 ? base : `${base}_${count}`;
}

function renderInsights(insights) {
  const c = $("#insightsRow");
  if (!c) return;
  c.innerHTML = "";
  if (!insights.length) {
    c.innerHTML = `<div class="insight cyan widget" data-widget-key="stats_insight_empty" data-widget-kind="card">
      <div class="insight-h"><div class="insight-icon">${INSIGHT_ICONS.brain}</div>
      <div class="insight-title">Pas encore d'insights</div></div>
      <div class="insight-body">Enregistre plus de trades avec strategie, session et contexte. Les patterns apparaitront automatiquement.</div>
    </div>`;
    if (typeof applyWidgetBoardOrder === "function") applyWidgetBoardOrder(c);
    return;
  }
  const seenKeys = Object.create(null);
  insights.forEach((ins, i) => {
    const el = document.createElement("div");
    el.className = `insight ${ins.color || "cyan"} widget`;
    el.dataset.widgetKey = insightWidgetKey(ins, seenKeys);
    el.dataset.widgetKind = "card";
    el.style.animationDelay = `${i * 60}ms`;
    el.innerHTML = `
      <div class="insight-h">
        <div class="insight-icon">${INSIGHT_ICONS[ins.icon] || INSIGHT_ICONS.star}</div>
        <div class="insight-title">${escapeHtml(ins.title)}</div>
      </div>
      <div class="insight-body">${escapeHtml(ins.body)}</div>`;
    c.appendChild(el);
  });
  if (typeof applyWidgetBoardOrder === "function") applyWidgetBoardOrder(c);
}

