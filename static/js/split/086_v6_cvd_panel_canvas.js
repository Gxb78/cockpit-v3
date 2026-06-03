// ---------- 086_v6_cvd_panel_canvas.js ----------
// TradingView-style CVD indicator strip under the price chart.
// Reads V6OF.CvdBuckets.snapshot() — no store dependency.
// Shares the price chart's visible time window so the X axis aligns.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};
  var LABEL_W = 10;
  var VAL_W = 66;
  var GAP = 5;

  var C = {
    bg:       '#f8f9fa',
    scaleBg:  'rgba(248, 249, 250, 0.9)',
    grid:     'rgba(0,0,0,0.04)',
    gridStrong: 'rgba(0,0,0,0.12)',
    sep:      'rgba(0,0,0,0.08)',
    estLine:  'rgba(150,160,180,0.6)',
    estBadge: 'rgba(0,0,0,0.35)',
    mixedBadge: 'rgba(0,0,0,0.25)',
    label:    'rgba(0,0,0,0.5)',
    timeLabel: 'rgba(0,0,0,0.3)',
    crosshair: 'rgba(0,0,0,0.15)',
    dotFill:  '#1a1d23',
    verSep:   'rgba(0,0,0,0.08)',
    buy:      '#059669',
    sell:     '#dc2626',
    buyGrad0: 'rgba(5,150,105,0.35)',
    buyGrad1: 'rgba(5,150,105,0.08)',
    sellGrad0: 'rgba(220,38,38,0.35)',
    sellGrad1: 'rgba(220,38,38,0.08)',
  };

  function recordPerf(name, startedAt) {
    if (!window.performance || !startedAt) return;
    var ms = performance.now() - startedAt;
    var perf = V6OF.perf || (V6OF.perf = {});
    var slot = perf[name] || (perf[name] = { count: 0, totalMs: 0, lastMs: 0, avgMs: 0 });
    slot.count += 1;
    slot.totalMs += ms;
    slot.lastMs = ms;
    slot.avgMs = slot.totalMs / slot.count;
    slot.updatedAt = Date.now();
  }

  function setup(canvas) {
    if (!canvas) return null;
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, rect.width || canvas.clientWidth || 1);
    var h = Math.max(1, rect.height || canvas.clientHeight || 1);
    var dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, width: w, height: h };
  }

  function timeWindow(snap) {
    var vp = V6OF.chart;
    if (vp && vp.timeStart && vp.timeEnd && vp.timeEnd > vp.timeStart) {
      var span = vp.timeEnd - vp.timeStart;
      return { start: vp.timeStart - span * 0.02, end: vp.timeEnd + span * 0.02 };
    }
    var minT = Infinity, maxT = -Infinity;
    snap.buckets.forEach(function (b) {
      var s = snap.series[b.key];
      if (s && s.length) { minT = Math.min(minT, s[0].t); maxT = Math.max(maxT, s[s.length - 1].t); }
    });
    if (!isFinite(minT) || !isFinite(maxT) || maxT <= minT) {
      var now = Date.now();
      return { start: now - 3600000, end: now };
    }
    return { start: minT, end: maxT };
  }

  function fmt(v) {
    if (v == null || !Number.isFinite(Number(v))) return '\u2014';
    v = Number(v);
    var a = Math.abs(v);
    var s = a >= 1000000 ? (a / 1e6).toFixed(2) + 'M'
          : a >= 1000 ? (a / 1e3).toFixed(1) + 'K'
          : a.toFixed(a >= 10 ? 0 : 1);
    return (v >= 0 ? '+' : '') + s;
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    return d.getHours().toString().padStart(2, '0') + ':' +
           d.getMinutes().toString().padStart(2, '0');
  }

  function drawPaneBg(ctx, pane) {
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pane.left, pane.top + 0.5);
    ctx.lineTo(pane.left + pane.width, pane.top + 0.5);
    ctx.stroke();
  }

  function drawSeries(ctx, pane, win, points, tip, color, hoveredTime, estimatedUntil) {
    var x0 = pane.left, x1 = pane.left + pane.width;
    var span = win.end - win.start;
    function tx(ts) { return x0 + (ts - win.start) / span * pane.width; }

    var min = Infinity, max = -Infinity;
    var i, p;
    for (i = 0; i < points.length; i++) {
      p = points[i];
      if (p.t < win.start || p.t > win.end) continue;
      if (p.v < min) min = p.v; if (p.v > max) max = p.v;
    }
    if (Number.isFinite(tip)) { if (tip < min) min = tip; if (tip > max) max = tip; }
    if (!Number.isFinite(min) || !Number.isFinite(max)) { min = -1; max = 1; }
    if (min === max) { min -= 1; max += 1; }
    var pad = (max - min) * 0.15;
    min -= pad; max += pad;

    function ty(v) { return pane.top + (max - v) / (max - min) * pane.height; }

    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (var g = 1; g <= 2; g++) {
      var gy = pane.top + pane.height * g / 3;
      ctx.beginPath(); ctx.moveTo(x0, gy); ctx.lineTo(x1, gy); ctx.stroke();
    }

    if (min < 0 && max > 0) {
      ctx.strokeStyle = C.gridStrong;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, ty(0)); ctx.lineTo(x1, ty(0)); ctx.stroke();
    }

    var visible = [];
    for (i = 0; i < points.length; i++) {
      p = points[i];
      if (p.t < win.start || p.t > win.end) continue;
      visible.push({ x: tx(p.t), y: ty(p.v), v: p.v, t: p.t });
    }
    if (visible.length < 2) return;

    var est = [], real = [];
    var splitX = null;
    if (estimatedUntil > 0) {
      splitX = tx(estimatedUntil);
      for (i = 0; i < visible.length; i++) {
        if (visible[i].t < estimatedUntil) est.push(visible[i]);
        else real.push(visible[i]);
      }
    } else {
      real = visible;
    }

    function drawLineSegment(pts, lineColor, lineWidth, dashed, glowAlpha) {
      if (pts.length < 2) return;
      if (glowAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = glowAlpha;
        ctx.strokeStyle = dashed ? C.estLine : lineColor;
        ctx.lineWidth = (dashed ? 2 : 6);
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (var idx = 1; idx < pts.length; idx++) ctx.lineTo(pts[idx].x, pts[idx].y);
        ctx.stroke();
        ctx.restore();
      }
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = lineWidth;
      ctx.lineJoin = 'round';
      if (dashed) ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var idx = 1; idx < pts.length; idx++) ctx.lineTo(pts[idx].x, pts[idx].y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (est.length >= 2) {
      drawLineSegment(est, C.estLine, 1.2, true, 0.06);
    }
    if (real.length >= 2) {
      drawLineSegment(real, color, 1.5, false, 0.12);
    }

    if (splitX != null && splitX >= x0 && splitX <= x1) {
      ctx.save();
      ctx.strokeStyle = C.gridStrong;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(splitX, pane.top);
      ctx.lineTo(splitX, pane.top + pane.height);
      ctx.stroke();
      ctx.restore();
    }

    var lastPoints = real.length > 0 ? real : est;
    if (lastPoints.length > 0) {
      var last = lastPoints[lastPoints.length - 1];
      var dotColor = real.length > 0 ? color : C.estLine;
      ctx.fillStyle = dotColor;
      ctx.beginPath();
      ctx.arc(last.x, last.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = real.length > 0 ? C.dotFill : C.estLine;
      ctx.beginPath();
      ctx.arc(last.x, last.y, 1, 0, Math.PI * 2);
      ctx.fill();
    }

    if (Number.isFinite(hoveredTime) && real.length > 0) {
      var nearest = null, minDiff = Infinity;
      for (i = 0; i < real.length; i++) {
        var diff = Math.abs(real[i].t - hoveredTime);
        if (diff < minDiff) { minDiff = diff; nearest = real[i]; }
      }
      if (nearest && minDiff <= 300000) {
        ctx.save();
        ctx.fillStyle = C.dotFill;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(nearest.x, nearest.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    return { min: min, max: max };
  }

  function drawHistogram(ctx, pane, win, deltaVol, interval) {
    var x0 = pane.left;
    var span = win.end - win.start;
    function tx(ts) { return x0 + (ts - win.start) / span * pane.width; }

    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (var g = 1; g <= 2; g++) {
      var gy = pane.top + pane.height * g / 3;
      ctx.beginPath(); ctx.moveTo(x0, gy); ctx.lineTo(x0 + pane.width, gy); ctx.stroke();
    }

    var zy = pane.top + pane.height / 2;
    ctx.strokeStyle = C.gridStrong;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x0, zy); ctx.lineTo(x0 + pane.width, zy); ctx.stroke();

    var maxAbs = 1, i;
    for (i = 0; i < deltaVol.length; i++) {
      if (deltaVol[i].t < win.start || deltaVol[i].t > win.end) continue;
      maxAbs = Math.max(maxAbs, Math.abs(deltaVol[i].delta));
    }

    var bw = Math.max(2, Math.min(6, pane.width / span * interval * 0.7));
    var halfH = pane.height / 2 - 3;

    for (i = 0; i < deltaVol.length; i++) {
      var d = deltaVol[i];
      if (d.t < win.start || d.t > win.end) continue;
      var x = tx(d.t + interval / 2) - bw / 2;
      var hh = Math.abs(d.delta) / maxAbs * halfH;
      if (hh < 1) hh = 1;
      var grd = ctx.createLinearGradient(x, zy, x, d.delta >= 0 ? zy - hh : zy + hh);
      if (d.delta >= 0) {
        grd.addColorStop(0, C.buyGrad0);
        grd.addColorStop(1, C.buyGrad1);
      } else {
        grd.addColorStop(0, C.sellGrad0);
        grd.addColorStop(1, C.sellGrad1);
      }
      ctx.fillStyle = grd;
      ctx.fillRect(x, d.delta >= 0 ? zy - hh : zy, bw, Math.max(hh, 1));
    }
  }

  function findNearestValue(points, targetTime) {
    if (!points || !points.length) return null;
    var nearest = null, minDiff = Infinity;
    for (var i = 0; i < points.length; i++) {
      var diff = Math.abs(points[i].t - targetTime);
      if (diff < minDiff) { minDiff = diff; nearest = points[i].v; }
    }
    return minDiff <= 300000 ? nearest : null;
  }

  function draw(canvas, state) {
    var perfStart = window.performance ? performance.now() : 0;
    var s = setup(canvas);
    if (!s || !V6OF.CvdBuckets) return;
    var ctx = s.ctx, W = s.width, H = s.height;

    // Light background
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    var snap = V6OF.CvdBuckets.snapshot();
    var win = timeWindow(snap);
    var rows = snap.buckets.length + 1;
    var plotLeft = LABEL_W;
    var plotW = Math.max(1, W - LABEL_W - VAL_W);
    var paneH = Math.max(12, (H - GAP * (rows + 1)) / rows);

    var cross = V6OF.chartCrosshair;
    var hoveredTime = cross && cross.visible ? cross.time : null;

    // Right scale background
    var gx = W - VAL_W;
    ctx.fillStyle = C.scaleBg;
    ctx.fillRect(gx, 0, VAL_W, H);

    // Vertical separator
    ctx.strokeStyle = C.verSep;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gx + 0.5, 0);
    ctx.lineTo(gx + 0.5, H);
    ctx.stroke();

    ctx.font = '9px "JetBrains Mono", Consolas, monospace';
    ctx.textBaseline = 'middle';

    var y = GAP;

    snap.buckets.forEach(function (b) {
      var pane = { left: plotLeft, top: y, width: plotW, height: paneH };
      drawPaneBg(ctx, pane);
      drawSeries(ctx, pane, win, snap.series[b.key], snap.tip[b.key], b.color, hoveredTime, snap.estimatedUntil);

      // Label
      ctx.fillStyle = b.color;
      ctx.textAlign = 'left';
      ctx.globalAlpha = 0.7;
      ctx.fillText(b.label, plotLeft + 8, y + 10);
      if (snap.cvdSource === 'ohlcv_estimate') {
        ctx.fillStyle = C.estBadge;
        ctx.font = '7px "JetBrains Mono", monospace';
        ctx.fillText('EST', plotLeft + 8 + ctx.measureText(b.label).width + 8, y + 10);
        ctx.font = '9px "JetBrains Mono", monospace';
      } else if (snap.cvdSource === 'mixed') {
        ctx.fillStyle = C.mixedBadge;
        ctx.font = '7px "JetBrains Mono", monospace';
        ctx.fillText('EST\u2192REAL', plotLeft + 8 + ctx.measureText(b.label).width + 8, y + 10);
        ctx.font = '9px "JetBrains Mono", monospace';
      }
      ctx.globalAlpha = 1;

      var currentVal = snap.tip[b.key] || 0;
      if (hoveredTime != null) {
        var hval = findNearestValue(snap.series[b.key], hoveredTime);
        if (hval != null) currentVal = hval;
      }
      ctx.fillStyle = currentVal >= 0 ? C.buy : C.sell;
      ctx.textAlign = 'left';
      ctx.font = 'bold 10px "JetBrains Mono", Consolas, monospace';
      ctx.fillText(fmt(currentVal), gx + 6, y + paneH / 2);
      ctx.font = '9px "JetBrains Mono", Consolas, monospace';

      y += paneH + GAP;
    });

    var hpane = { left: plotLeft, top: y, width: plotW, height: paneH };
    drawPaneBg(ctx, hpane);
    drawHistogram(ctx, hpane, win, snap.deltaVol, snap.interval);

    ctx.fillStyle = C.label;
    ctx.textAlign = 'left';
    ctx.fillText('Delta Vol', plotLeft + 8, y + 10);

    var lastDelta = snap.deltaVol.length ? snap.deltaVol[snap.deltaVol.length - 1].delta : 0;
    if (hoveredTime != null) {
      var nearestDPoint = null, minDDiff = Infinity;
      for (var k = 0; k < snap.deltaVol.length; k++) {
        var diff = Math.abs(snap.deltaVol[k].t - hoveredTime);
        if (diff < minDDiff) { minDDiff = diff; nearestDPoint = snap.deltaVol[k]; }
      }
      if (nearestDPoint && minDDiff <= 300000) lastDelta = nearestDPoint.delta;
    }
    ctx.fillStyle = lastDelta >= 0 ? C.buy : C.sell;
    ctx.textAlign = 'left';
    ctx.font = 'bold 10px "JetBrains Mono", Consolas, monospace';
    ctx.fillText(fmt(lastDelta), gx + 6, y + paneH / 2);
    ctx.font = '9px "JetBrains Mono", Consolas, monospace';

    ctx.fillStyle = C.timeLabel;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    var spanS = win.end - win.start;
    var labelCount = Math.min(5, Math.max(2, Math.floor(plotW / 100)));
    for (var li = 0; li <= labelCount; li++) {
      var t = win.start + spanS * li / labelCount;
      ctx.fillText(fmtTime(t), plotLeft + plotW * li / labelCount, H - 4);
    }

    if (cross && cross.visible && cross.enabled && cross.x >= plotLeft && cross.x <= plotLeft + plotW) {
      ctx.save();
      ctx.strokeStyle = C.crosshair;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(cross.x, 0);
      ctx.lineTo(cross.x, H);
      ctx.stroke();
      ctx.restore();
    }
    recordPerf('cvd', perfStart);
  }

  V6OF.CvdPanel = {
    draw: function (canvas, state) {
      if (!canvas) return;
      canvas._cvdState = state;
      if (canvas._cvdQueued) return;
      canvas._cvdQueued = true;
      var schedule = typeof requestAnimationFrame === 'function' && !document.hidden
        ? requestAnimationFrame : function (fn) { return setTimeout(fn, 33); };
      schedule(function () { canvas._cvdQueued = false; draw(canvas, canvas._cvdState); });
    }
  };
})();
