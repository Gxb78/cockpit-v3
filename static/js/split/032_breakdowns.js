// ---------- Breakdowns ----------

function renderBreakdown(selector, data, opts = {}) {
  const c = document.querySelector(selector);
  if (!c) return;
  c.innerHTML = "";
  const entries = Object.entries(data || {});
  if (!entries.length) {
    c.innerHTML = `<div class="bd-empty">Pas encore de donnees.</div>`;
    return;
  }
  const sortMode = state.breakdownSortMode || "count";
  entries.sort((a, b) => {
    const av = a[1] || {};
    const bv = b[1] || {};
    if (sortMode === "winrate") {
      const d = (Number(bv.winrate || 0) - Number(av.winrate || 0));
      if (d !== 0) return d;
    } else if (sortMode === "avg_rr") {
      const d = (Number(bv.avg_rr || 0) - Number(av.avg_rr || 0));
      if (d !== 0) return d;
    } else if (sortMode === "pnl") {
      const d = (Number(bv.pnl || 0) - Number(av.pnl || 0));
      if (d !== 0) return d;
    } else {
      const d = (Number(bv.count || 0) - Number(av.count || 0));
      if (d !== 0) return d;
    }
    return Number(bv.count || 0) - Number(av.count || 0);
  });
  const labelFn = opts.kind === "dow"
    ? k => (["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"][Number(k)] || `Jour ${k}`)
    : opts.kind === "tag"
    ? k => `#${String(k || "").trim()}`
    : opts.kind === "plan_error"
    ? k => PLAN_ERROR_LABELS[k] || prettify(k)
    : k => prettify(k);

  entries.forEach(([k, v], i) => {
    const wr  = v.winrate || 0;
    const avgRR = Number(v.avg_rr || 0);
    const wrColor  = wr >= 60 ? "lime" : wr >= 40 ? "amber" : "rose";
    const pnlClass = v.pnl > 0 ? "pos" : v.pnl < 0 ? "neg" : "";
    const row = document.createElement("div");
    row.className = "bd-row";
    row.style.animationDelay = `${i * 40}ms`;
    row.innerHTML = `
      <div class="bd-h">
        <span class="bd-name">${escapeHtml(labelFn(k))}</span>
        <span class="bd-meta">
          <span class="muted">${v.count}t</span>
          <span class="pnl ${pnlClass}">${fmtMoney(v.pnl)}</span>
          <span class="muted">${avgRR.toFixed(2)}R</span>
          <span class="wr">${wr.toFixed(0)}%</span>
        </span>
      </div>
      <div class="bd-bar"><div class="fill ${wrColor}" style="transform:scaleX(0)"></div></div>`;
    c.appendChild(row);
    requestAnimationFrame(() => { row.querySelector(".fill").style.transform = `scaleX(${Math.min(wr,100)/100})`; });
  });
}

function renderPlanMatrix(matrix, summary) {
  const c = $("#planMatrix");
  if (!c) return;
  const order = ["in_plan_win", "in_plan_loss", "out_of_plan_win", "out_of_plan_loss", "incomplete", "unknown"];
  const total = order.reduce((sum, key) => sum + Number(matrix?.[key]?.count || 0), 0);
  if (!total) {
    c.innerHTML = `<div class="bd-empty">Pas encore de donnees plan.</div>`;
    return;
  }
  const avg = Number(summary?.avg_score || 0);
  const rate = Number(summary?.in_plan_rate || 0);
  const cards = order.map((key) => {
    const item = matrix?.[key] || {};
    const count = Number(item.count || 0);
    const pnl = Number(item.pnl || 0);
    const cls = key.includes("out_of_plan") ? "warn" : key.includes("in_plan") ? "ok" : "muted";
    return `<div class="plan-matrix-cell ${cls}">
      <span>${escapeHtml(item.label || prettify(key))}</span>
      <strong>${count}</strong>
      <em class="${pnl > 0 ? "pos" : pnl < 0 ? "neg" : ""}">${fmtMoney(pnl)}</em>
    </div>`;
  }).join("");
  c.innerHTML = `
    <div class="plan-summary-strip">
      <div><span>Score moyen</span><strong>${avg.toFixed(0)}/100</strong></div>
      <div><span>Dans le plan</span><strong>${rate.toFixed(0)}%</strong></div>
      <div><span>Trades classes</span><strong>${Number(summary?.scored || 0)}</strong></div>
    </div>
    <div class="plan-matrix-grid">${cards}</div>
  `;
}

function renderInstrumentList(perInstr) {
  const list = $("#pairsList");
  if (!list) return;
  list.innerHTML = "";
  ["BTC","ETH","NQ","ES"].forEach((k, i) => {
    const v = perInstr?.[k];
    if (!v || !v.count) {
      list.insertAdjacentHTML("beforeend", `<div class="bd-row">
        <div class="bd-h"><span class="bd-name">${k}</span><span class="bd-meta muted">-</span></div>
        <div class="bd-empty" style="padding:4px 0">Aucune entree</div></div>`);
      return;
    }
    const wr  = v.winrate || 0;
    const wrColor  = wr >= 60 ? "lime" : wr >= 40 ? "amber" : "rose";
    const pnlClass = v.pnl > 0 ? "pos" : v.pnl < 0 ? "neg" : "";
    const row = document.createElement("div");
    row.className = "bd-row";
    row.style.animationDelay = `${i * 40}ms`;
    row.innerHTML = `
      <div class="bd-h">
        <span class="bd-name">${k}</span>
        <span class="bd-meta">
          <span class="muted">${v.entries}j - ${v.trades}t</span>
          <span class="muted">${Number(v.avg_rr || 0).toFixed(2)}R</span>
          <span class="pnl ${pnlClass}">${fmtMoney(v.pnl)}</span>
          <span class="wr">${wr.toFixed(0)}%</span>
        </span>
      </div>
      <div class="bd-bar"><div class="fill ${wrColor}" style="transform:scaleX(0)"></div></div>`;
    list.appendChild(row);
    requestAnimationFrame(() => { row.querySelector(".fill").style.transform = `scaleX(${Math.min(wr,100)/100})`; });
  });
}

function renderRRDist(buckets) {
  const c = $("#rrDist");
  if (!c) return;
  c.innerHTML = "";
  const labels = ["<0","0-1","1-2","2-3","3-5","5+"];
  const zones  = ["loss","meh","meh","ok","great","great"];
  const max    = Math.max(1, ...buckets);
  buckets.forEach((count, i) => {
    const el = document.createElement("div");
    el.className = "rr-bucket";
    el.innerHTML = `
      <div class="rr-bar-wrap">
        <div class="rr-bar" data-zone="${zones[i]}" style="transform:scaleY(0)">
          ${count > 0 ? `<span class="rr-bar-count">${count}</span>` : ""}
        </div>
      </div>
      <span class="rr-bucket-label">${labels[i]}</span>`;
    c.appendChild(el);
    requestAnimationFrame(() => {
      el.querySelector(".rr-bar").style.transform = `scaleY(${(count/max)})`;
    });
  });
}

function fmtPeriodRange(fromKey, toKey) {
  if (!fromKey || !toKey) return "-";
  const from = String(fromKey).slice(5);
  const to = String(toKey).slice(5);
  return `${from} -> ${to}`;
}

function setSignedClass(el, value) {
  if (!el) return;
  el.classList.remove("pos", "neg");
  if (value > 0) el.classList.add("pos");
  if (value < 0) el.classList.add("neg");
}

function renderPeriodCompare(periodCompare) {
  const curRange = $("#periodCurrentRange");
  const curPnl = $("#periodCurrentPnl");
  const curMeta = $("#periodCurrentMeta");
  const prevRange = $("#periodPreviousRange");
  const prevPnl = $("#periodPreviousPnl");
  const prevMeta = $("#periodPreviousMeta");
  const deltaPnl = $("#periodDeltaPnl");
  const deltaMeta = $("#periodDeltaMeta");
  if (!curRange || !curPnl || !curMeta || !prevRange || !prevPnl || !prevMeta || !deltaPnl || !deltaMeta) return;

  const cur = periodCompare?.current || {};
  const prev = periodCompare?.previous || {};
  const delta = periodCompare?.delta || {};

  curRange.textContent = fmtPeriodRange(cur.from, cur.to);
  prevRange.textContent = fmtPeriodRange(prev.from, prev.to);

  curPnl.textContent = fmtMoney(cur.pnl || 0);
  prevPnl.textContent = fmtMoney(prev.pnl || 0);
  deltaPnl.textContent = fmtMoney(delta.pnl || 0);

  setSignedClass(curPnl, Number(cur.pnl || 0));
  setSignedClass(prevPnl, Number(prev.pnl || 0));
  setSignedClass(deltaPnl, Number(delta.pnl || 0));

  curMeta.textContent = `${Number(cur.num_trades || 0)} trade${Number(cur.num_trades || 0) > 1 ? "s" : ""} - ${(Number(cur.winrate || 0)).toFixed(0)}%`;
  prevMeta.textContent = `${Number(prev.num_trades || 0)} trade${Number(prev.num_trades || 0) > 1 ? "s" : ""} - ${(Number(prev.winrate || 0)).toFixed(0)}%`;

  const tradesDelta = Number(delta.num_trades || 0);
  const wrDelta = Number(delta.winrate || 0);
  const wrPrefix = wrDelta > 0 ? "+" : "";
  deltaMeta.textContent = `${tradesDelta > 0 ? "+" : ""}${tradesDelta} trade${Math.abs(tradesDelta) > 1 ? "s" : ""} - ${wrPrefix}${wrDelta.toFixed(1)} pts`;
  setSignedClass(deltaMeta, Number(delta.pnl || 0));
}

function renderPnlHistogram(buckets) {
  const c = $("#pnlHist");
  if (!c) return;
  c.innerHTML = "";
  if (!Array.isArray(buckets) || buckets.length === 0) {
    c.innerHTML = `<div class="bd-empty">Pas assez de donnees.</div>`;
    return;
  }
  const maxCount = Math.max(1, ...buckets.map(b => Number(b.count || 0)));
  buckets.forEach((b, idx) => {
    const count = Number(b.count || 0);
    const center = Number(b.center || 0);
    const el = document.createElement("div");
    el.className = "pnl-hist-bin";
    el.innerHTML = `
      <div class="pnl-hist-bar-wrap">
        <div class="pnl-hist-bar ${center >= 0 ? "pos" : "neg"}" style="transform:scaleY(0)">
          ${count > 0 ? `<span class="pnl-hist-count">${count}</span>` : ""}
        </div>
      </div>
      <span class="pnl-hist-label">${escapeHtml(String(b.label || ""))}</span>
    `;
    c.appendChild(el);
    requestAnimationFrame(() => {
      const bar = el.querySelector(".pnl-hist-bar");
      if (bar) bar.style.transform = `scaleY(${(count / maxCount)})`;
    });
    el.style.animationDelay = `${idx * 24}ms`;
  });
}

