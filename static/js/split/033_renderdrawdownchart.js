function renderDrawdownChart(drawdown, opts = {}) {
  const canvas = $("#drawdownChart");
  const meta = $("#drawdownMeta");
  if (!canvas || !meta) return;

  const series = Array.isArray(drawdown?.series) ? drawdown.series : [];
  const maxDrawdown = Number(drawdown?.max_drawdown || 0);
  const currentDrawdown = Number(drawdown?.current_drawdown || 0);
  meta.textContent = `Max ${fmtMoney(maxDrawdown)} · Courant ${fmtMoney(currentDrawdown)}`;
  setSignedClass(meta, currentDrawdown);

  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;

  // Cached getBoundingClientRect — refresh only on window resize
  if (!renderDrawdownChart._cachedRect || renderDrawdownChart._dirty) {
    renderDrawdownChart._cachedRect = canvas.getBoundingClientRect();
    renderDrawdownChart._dirty = false;
  }
  const rect = renderDrawdownChart._cachedRect;
  canvas.width = rect.width * dpr;
  canvas.height = 260 * dpr;
  ctx.scale(dpr, dpr);
  const w = rect.width;
  const h = 260;

  if (!series.length) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#7e85a3";
    ctx.font = "13px Inter,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Aucune donnée", w / 2, h / 2);
    return;
  }

  const pad = { l: 56, r: 22, t: 20, b: 36 };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;
  const values = series.map(d => Number(d.drawdown || 0));
  const minV = Math.min(...values, -1);
  const maxV = 0;
  const range = maxV - minV || 1;
  const n = series.length;
  const xStep = n === 1 ? cw : cw / (n - 1);
  const yFor = v => pad.t + ch - ((v - minV) / range) * ch;
  const zeroY = yFor(0);
  const points = series.map((d, i) => ({
    x: pad.l + i * xStep,
    y: yFor(Number(d.drawdown || 0)),
  }));

  function draw(progress) {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#7e85a3";
    ctx.font = "11px Inter,sans-serif";
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i += 1) {
      const v = minV + (range * i / 4);
      const y = yFor(v);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + cw, y);
      ctx.stroke();
      ctx.fillText(`${v.toFixed(0)}$`, pad.l - 8, y + 3);
    }

    const maxIdx = Math.max(0, Math.floor((n - 1) * progress));
    const t = (n - 1) * progress - maxIdx;
    const visible = points.slice(0, maxIdx + 1);
    if (maxIdx < n - 1) {
      const a = points[maxIdx];
      const b = points[maxIdx + 1];
      visible.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
    if (visible.length < 2) return;

    const fillGrad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ch);
    fillGrad.addColorStop(0, "rgba(255,78,107,0.30)");
    fillGrad.addColorStop(1, "rgba(255,78,107,0.02)");
    ctx.beginPath();
    ctx.moveTo(visible[0].x, zeroY);
    visible.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(visible[visible.length - 1].x, zeroY);
    ctx.closePath();
    ctx.fillStyle = fillGrad;
    ctx.fill();

    ctx.strokeStyle = "#ff4e6b";
    ctx.lineWidth = 2.2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(255,78,107,0.45)";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    visible.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  if (opts.animate && n > 1) {
    const duration = Math.min(900, 220 + n * 20);
    const start = performance.now();
    (function frame(now) {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      draw(eased);
      if (p < 1) requestAnimationFrame(frame);
    })(performance.now());
  } else {
    draw(1);
  }
}

// Invalidate cached rect on window resize
if (!renderDrawdownChart._listenerAttached) {
  window.addEventListener("resize", () => { renderDrawdownChart._dirty = true; });
  renderDrawdownChart._listenerAttached = true;
}
