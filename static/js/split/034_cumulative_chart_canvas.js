// ---------- Cumulative chart (canvas) ----------

function renderCumChart(data, opts = {}) {
  const canvas = $("#cumChart");
  if (!canvas) return;
  const ctx  = canvas.getContext("2d");
  const dpr  = window.devicePixelRatio || 1;

  // Cached getBoundingClientRect — refresh only on window resize
  if (!renderCumChart._cachedRect || renderCumChart._dirty) {
    renderCumChart._cachedRect = canvas.getBoundingClientRect();
    renderCumChart._dirty = false;
  }
  const rect = renderCumChart._cachedRect;
  canvas.width  = rect.width * dpr;
  canvas.height = 320 * dpr;
  ctx.scale(dpr, dpr);
  const w = rect.width, h = 320;

  if (!data.length) {
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = "#7e85a3"; ctx.font = "13px Inter,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Aucune donnée", w/2, h/2);
    canvas.onmousemove = null;
    canvas.onmouseleave = null;
    const tt = $("#cumChartTooltip");
    if (tt) tt.style.display = "none";
    return;
  }

  const pad = { l:60, r:24, t:24, b:44 };
  const cw  = w - pad.l - pad.r;
  const ch  = h - pad.t - pad.b;
  const values = data.map(d => d.cumulative);
  let minV = Math.min(0, ...values), maxV = Math.max(0, ...values);
  if (minV === maxV) { minV -= 1; maxV += 1; }
  const range = maxV - minV;
  const zeroY = pad.t + ch - ((0 - minV) / range) * ch;
  const n     = data.length;
  const xStep = n === 1 ? cw : cw / (n-1);
  const points = data.map((d, i) => ({
    x: pad.l + i * xStep,
    y: pad.t + ch - ((d.cumulative - minV) / range) * ch,
    date: d.date, cum: d.cumulative,
  }));

  function drawBackground() {
    ctx.clearRect(0,0,w,h);
    ctx.strokeStyle = "rgba(255,255,255,0.04)"; ctx.lineWidth = 1;
    ctx.fillStyle = "#7e85a3"; ctx.font = "11px Inter,sans-serif"; ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
      const v = minV + (range * i / 4);
      const y = pad.t + ch - (i/4) * ch;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l+cw, y); ctx.stroke();
      ctx.fillText(fmtMoney(v), pad.l - 8, y + 3);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(pad.l, zeroY); ctx.lineTo(pad.l+cw, zeroY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#7e85a3"; ctx.textAlign = "center";
    const every = Math.max(1, Math.floor(n/6));
    points.forEach((p, i) => {
      if (i % every === 0 || i === n-1) ctx.fillText(p.date.slice(5), p.x, pad.t+ch+22);
    });
  }

  function drawCurveTo(progress) {
    drawBackground();
    if (progress <= 0) return;
    const idxF   = (n-1) * progress;
    const idx    = Math.floor(idxF);
    const t      = idxF - idx;
    const visible = points.slice(0, idx+1);
    if (idx < n-1) {
      const a = points[idx], b = points[idx+1];
      visible.push({ x: a.x+(b.x-a.x)*t, y: a.y+(b.y-a.y)*t });
    }
    if (visible.length < 2) return;

    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t+ch);
    grad.addColorStop(0, "rgba(0,229,255,0.30)");
    grad.addColorStop(1, "rgba(255,46,196,0.02)");
    ctx.beginPath();
    ctx.moveTo(visible[0].x, zeroY);
    visible.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(visible[visible.length-1].x, zeroY);
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill();

    const lineGrad = ctx.createLinearGradient(pad.l, 0, pad.l+cw, 0);
    lineGrad.addColorStop(0, "#00E5FF"); lineGrad.addColorStop(1, "#FF2EC4");
    ctx.strokeStyle = lineGrad; ctx.lineWidth = 2.4;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.shadowColor = "rgba(0,229,255,0.5)"; ctx.shadowBlur = 8;
    ctx.beginPath();
    visible.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    ctx.stroke(); ctx.shadowBlur = 0;
    points.slice(0, idx+1).forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 3.2, 0, Math.PI*2);
      ctx.fillStyle = "#0b0c16"; ctx.fill();
      ctx.strokeStyle = "#00E5FF"; ctx.lineWidth = 2; ctx.stroke();
    });
  }

  if (opts.animate && n > 1) {
    const duration = Math.min(900, 200 + n*25);
    const start = performance.now();
    (function frame(now) {
      const eased = 1 - Math.pow(1 - Math.min(1, (now-start)/duration), 3);
      drawCurveTo(eased);
      if (eased < 1) requestAnimationFrame(frame);
    })(performance.now());
  } else {
    drawCurveTo(1);
  }

  function hideTooltip() {
    const tt = $("#cumChartTooltip");
    if (tt) tt.style.display = "none";
  }
  function showTooltip(point, clientX, clientY) {
    let tt = $("#cumChartTooltip");
    if (!tt) {
      tt = document.createElement("div");
      tt.id = "cumChartTooltip";
      tt.className = "chart-tooltip";
      document.body.appendChild(tt);
    }
    const pnlClass = point.cum > 0 ? "pos" : point.cum < 0 ? "neg" : "";
    tt.innerHTML = `<div class="chart-tt-date">${point.date}</div><div class="chart-tt-value ${pnlClass}">${fmtMoney(point.cum)}</div>`;
    tt.style.left = `${clientX}px`;
    tt.style.top = `${clientY - 10}px`;
    tt.style.display = "block";
  }

  canvas.onmouseleave = hideTooltip;
  canvas.onmousemove = evt => {
    if (!points.length) return;
    const cRect = canvas.getBoundingClientRect();
    const x = evt.clientX - cRect.left;
    if (x < pad.l || x > pad.l + cw) {
      hideTooltip();
      return;
    }
    let nearest = points[0];
    let minDx = Math.abs(x - nearest.x);
    for (let i = 1; i < points.length; i += 1) {
      const dx = Math.abs(x - points[i].x);
      if (dx < minDx) {
        minDx = dx;
        nearest = points[i];
      }
    }
    if (minDx > Math.max(18, xStep * 1.4)) {
      hideTooltip();
      return;
    }
    showTooltip(nearest, evt.clientX, evt.clientY);
  };
}

// Invalidate cached rect on window resize
if (!renderCumChart._listenerAttached) {
  window.addEventListener("resize", () => { renderCumChart._dirty = true; });
  renderCumChart._listenerAttached = true;
}

// =============================================================
//  BLOCK SYSTEM, MARKDOWN, HASHTAGS, CUSTOM BLOCKS
// =============================================================

const BLOCK_STATE_KEY = "cockpit:blockCollapsed";

function loadCollapsedBlocks() {
  try { return JSON.parse(localStorage.getItem(BLOCK_STATE_KEY) || "{}"); } catch { return {}; }
}
function saveCollapsedBlocks(state) {
  try { localStorage.setItem(BLOCK_STATE_KEY, JSON.stringify(state)); } catch {}
}
function slugify(s) {
  return String(s||"").toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");
}

