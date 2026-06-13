// ---------- 086_v6_cvd_panel_canvas.js ----------
// TradingView-style CVD indicator strip under the price chart.
// Reads V6OF.CvdBuckets.snapshot() — no store dependency.
// Shares the price chart's visible time window so the X axis aligns.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};
  if (!V6OF.register) {
    ['Core', 'Data', 'Transport', 'UI', 'Studies', 'Page'].forEach(function (name) { V6OF[name] = V6OF[name] || {}; });
    V6OF.register = function (domain, name, value, legacyName) {
      V6OF[domain] = V6OF[domain] || {};
      V6OF[domain][name] = value;
      if (legacyName) V6OF[legacyName] = value;
      return value;
    };
  }
  var LABEL_W = 10;
  var VAL_W = 74;
  var GAP = 5;

  // ── CVD Viewport (stable Y-axis + interactive X/Y zoom/pan) ──
  var _cvp = {
    timeStart: 0,
    timeEnd: 0,
    cvdMin: Infinity,
    cvdMax: -Infinity,
    autoFit: true,     // auto-scale Y to visible data (relaxes when user zooms)
    followLive: true,  // track the right edge on X
    initialized: false,
    dragStartX: 0,
    dragStartY: 0,
    dragStartTime: 0,
    dragStartCvdMin: 0,
    dragStartCvdMax: 0,
    wasDragging: false
  };

  var C = {
    bg:       '#f4f6f8',
    scaleBg:  'rgba(244,246,248,0.96)',
    grid:     'rgba(0,0,0,0.07)',
    gridStrong: 'rgba(0,0,0,0.22)',
    sep:      'rgba(0,0,0,0.10)',
    estLine:  'rgba(150,160,180,0.6)',
    estBadge: 'rgba(0,0,0,0.35)',
    mixedBadge: 'rgba(0,0,0,0.25)',
    label:    '#111827',
    timeLabel: 'rgba(0,0,0,0.48)',
    crosshair: 'rgba(0,0,0,0.28)',
    dotFill:  '#050505',
    verSep:   'rgba(0,0,0,0.14)',
    line:      '#050505',
    buy:      '#059669',
    sell:     '#dc2626',
    buyGrad0: 'rgba(5,150,105,0.35)',
    buyGrad1: 'rgba(5,150,105,0.08)',
    sellGrad0: 'rgba(220,38,38,0.35)',
    sellGrad1: 'rgba(220,38,38,0.08)',
  };

  function updateThemeColors(bgColor) {
    var isLight = true;
    if (bgColor) {
      var hex = String(bgColor).replace('#', '');
      if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
      if (hex.length === 6) {
        var r = parseInt(hex.substring(0, 2), 16);
        var g = parseInt(hex.substring(2, 4), 16);
        var b = parseInt(hex.substring(4, 6), 16);
        var brightness = (r * 299 + g * 587 + b * 114) / 1000;
        if (brightness < 128) isLight = false;
      }
    }

    if (isLight) {
      C.bg =       '#ffffff';
      C.scaleBg =  'rgba(255,255,255,0.96)';
      C.grid =     'rgba(0,0,0,0.06)';
      C.gridStrong = 'rgba(0,0,0,0.12)';
      C.sep =      'rgba(0,0,0,0.08)';
      C.estLine =  'rgba(120,130,150,0.6)';
      C.estBadge = 'rgba(0,0,0,0.25)';
      C.mixedBadge = 'rgba(0,0,0,0.20)';
      C.label =    '#131722';
      C.timeLabel = 'rgba(0,0,0,0.48)';
      C.crosshair = 'rgba(0,0,0,0.24)';
      C.dotFill =  '#131722';
      C.verSep =   'rgba(0,0,0,0.08)';
      C.line =      '#131722';
      C.buy =      '#089981';
      C.sell =     '#f23645';
      C.buyGrad0 = 'rgba(8,153,129,0.30)';
      C.buyGrad1 = 'rgba(8,153,129,0.05)';
      C.sellGrad0 = 'rgba(242,54,69,0.30)';
      C.sellGrad1 = 'rgba(242,54,69,0.05)';
    } else {
      C.bg =       bgColor || '#131722';
      C.scaleBg =  'rgba(19,23,34,0.96)';
      C.grid =     'rgba(255,255,255,0.06)';
      C.gridStrong = 'rgba(255,255,255,0.12)';
      C.sep =      'rgba(255,255,255,0.08)';
      C.estLine =  'rgba(180,190,210,0.6)';
      C.estBadge = 'rgba(255,255,255,0.25)';
      C.mixedBadge = 'rgba(255,255,255,0.20)';
      C.label =    '#d1d4dc';
      C.timeLabel = 'rgba(255,255,255,0.48)';
      C.crosshair = 'rgba(255,255,255,0.24)';
      C.dotFill =  '#d1d4dc';
      C.verSep =   'rgba(255,255,255,0.08)';
      C.line =      '#d1d4dc';
      C.buy =      '#089981';
      C.sell =     '#f23645';
      C.buyGrad0 = 'rgba(8,153,129,0.30)';
      C.buyGrad1 = 'rgba(8,153,129,0.05)';
      C.sellGrad0 = 'rgba(242,54,69,0.30)';
      C.sellGrad1 = 'rgba(242,54,69,0.05)';
    }
  }

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
    canvas._cvdRectCache = { left: rect.left, top: rect.top, width: w, height: h };
    var dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, width: w, height: h };
  }

  function cachedRect(canvas, force) {
    if (!canvas) return { left: 0, top: 0, width: 1, height: 1 };
    if (force || !canvas._cvdRectCache) {
      var rect = canvas.getBoundingClientRect();
      canvas._cvdRectCache = {
        left: rect.left,
        top: rect.top,
        width: Math.max(1, rect.width || canvas.clientWidth || 1),
        height: Math.max(1, rect.height || canvas.clientHeight || 1)
      };
    }
    return canvas._cvdRectCache;
  }

  function invalidateRectCache(canvas) {
    if (canvas) canvas._cvdRectCache = null;
  }

  function chartAnchorXFromCvd(mx, rect, vp) {
    if (!vp || !vp.plot || !rect) return mx;
    var gx = Math.max(LABEL_W + 40, rect.width - VAL_W);
    var plotLeft = LABEL_W;
    var plotWidth = Math.max(1, gx - LABEL_W - 1);
    var frac = (mx - plotLeft) / plotWidth;
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;
    return vp.plot.left + frac * vp.plot.width;
  }

  function cleanupCanvas(canvas) {
    canvas = cvdDataCanvas(canvas) || canvas;
    if (!canvas) return;
    if (canvas._cvdInteractAbort) {
      try { canvas._cvdInteractAbort.abort(); } catch (_) {}
      canvas._cvdInteractAbort = null;
    }
    invalidateRectCache(canvas);
    canvas._cvdInteractBound = false;
  }

  function cvdOverlayCanvas(canvas) {
    if (!canvas) return null;
    if (canvas.hasAttribute && canvas.hasAttribute('data-v6-cvd-overlay')) return canvas;
    var stack = canvas.closest && canvas.closest('[data-v6-cvd-stack]');
    return stack && stack.querySelector ? stack.querySelector('[data-v6-cvd-overlay]') : null;
  }

  function cvdDataCanvas(canvas) {
    if (!canvas) return null;
    if (canvas.hasAttribute && canvas.hasAttribute('data-v6-cvd-canvas')) return canvas;
    var stack = canvas.closest && canvas.closest('[data-v6-cvd-stack]');
    return stack && stack.querySelector ? stack.querySelector('[data-v6-cvd-canvas]') : null;
  }

  function timeWindow(snap) {
    // Sync with chart viewport if available (this is the single source of truth for X axis!)
    var vp = V6OF.chart;
    if (vp && vp.timeStart && vp.timeEnd && vp.timeEnd > vp.timeStart) {
      _cvp.timeStart = vp.timeStart;
      _cvp.timeEnd = vp.timeEnd;
      if (!_cvp.initialized) _cvp.initialized = true;
      return { start: vp.timeStart, end: vp.timeEnd };
    }
    // Fallback: compute from data (when no chart viewport)
    var minT = Infinity, maxT = -Infinity;
    snap.buckets.forEach(function (b) {
      var s = snap.series[b.key];
      if (s && s.length) { minT = Math.min(minT, s[0].t); maxT = Math.max(maxT, s[s.length - 1].t); }
    });
    if (!isFinite(minT) || !isFinite(maxT) || maxT <= minT) {
      var now = Date.now();
      return { start: now - 3600000, end: now };
    }
    // Follow-live: pan to keep the right edge at the latest data point
    if (_cvp.followLive) {
      maxT += Math.max((maxT - minT) * 0.03, 60000);
    }
    _cvp.timeStart = minT;
    _cvp.timeEnd = maxT;
    if (!_cvp.initialized) _cvp.initialized = true;
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

  var _fmtTimeCache = new Map();
  function fmtTime(ts) {
    var key = Number(ts) || 0;
    var cached = _fmtTimeCache.get(key);
    if (cached) return cached;
    if (_fmtTimeCache.size >= 2048) {
      var first = _fmtTimeCache.keys().next();
      if (!first.done) _fmtTimeCache.delete(first.value);
    }
    var d = new Date(key);
    var label = d.getUTCHours().toString().padStart(2, '0') + ':' +
      d.getUTCMinutes().toString().padStart(2, '0');
    _fmtTimeCache.set(key, label);
    return label;
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
      var x = Math.round(tx(d.t + interval / 2) - bw / 2);
      var hh = Math.abs(d.delta) / maxAbs * halfH;
      if (hh < 1) hh = 1;
      hh = Math.round(hh);
      var barY = d.delta >= 0 ? Math.round(zy - hh) : Math.round(zy);
      var grd = ctx.createLinearGradient(x, zy, x, d.delta >= 0 ? zy - hh : zy + hh);
      if (d.delta >= 0) {
        grd.addColorStop(0, C.buyGrad0);
        grd.addColorStop(1, C.buyGrad1);
      } else {
        grd.addColorStop(0, C.sellGrad0);
        grd.addColorStop(1, C.sellGrad1);
      }
      ctx.fillStyle = grd;
      ctx.fillRect(x, barY, Math.round(bw), hh);
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

  function sortedFinitePoints(points) {
    return (Array.isArray(points) ? points : []).map(function (p) {
      return { t: Number(p.t), v: Number(p.v) };
    }).filter(function (p) {
      return Number.isFinite(p.t) && Number.isFinite(p.v);
    }).sort(function (a, b) {
      return a.t - b.t;
    });
  }

  function cvdSeriesFromSnapshot(snap) {
    var buckets = snap && Array.isArray(snap.buckets) ? snap.buckets : [];
    var bucket = buckets[0] || { key: 'total', label: 'CVD', color: C.line };
    var raw = snap && snap.series && Array.isArray(snap.series[bucket.key]) ? snap.series[bucket.key].slice() : [];
    var tip = snap && snap.tip ? Number(snap.tip[bucket.key]) : NaN;
    var tipT = snap && Number.isFinite(Number(snap.lastTs)) && Number(snap.lastTs) > 0 ? Number(snap.lastTs) : Date.now();

    if (Number.isFinite(tip)) {
      if (raw.length) {
        var last = raw[raw.length - 1];
        var lastT = Number(last && last.t);
        if (Number.isFinite(lastT) && tipT <= lastT) {
          raw[raw.length - 1] = { t: lastT, v: tip };
        } else {
          raw.push({ t: tipT, v: tip });
        }
      } else {
        raw.push({ t: tipT, v: tip });
      }
    }

    return {
      bucket: bucket,
      points: sortedFinitePoints(raw),
      tip: tip
    };
  }

  function splitPointSegments(points, maxGapMs) {
    var segments = [];
    var current = [];
    maxGapMs = Math.max(1, Number(maxGapMs) || 180000);
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (current.length) {
        var prev = current[current.length - 1];
        if (p.t - prev.t > maxGapMs) {
          segments.push(current);
          current = [];
        }
      }
      current.push(p);
    }
    if (current.length) segments.push(current);
    return segments;
  }

  function drawCvdCandles(ctx, points, intervalMs, tx, ty, plot) {
    if (!Array.isArray(points) || !points.length) return null;
    intervalMs = Math.max(1000, Number(intervalMs) || 60000);
    var spanPx = Math.abs(tx(intervalMs) - tx(0));
    var bodyW = Math.max(2, Math.min(9, spanPx * 0.72));
    var last = null;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      var prev = i > 0 ? points[i - 1] : p;
      var open = Number(prev.v);
      var close = Number(p.v);
      if (!Number.isFinite(open) || !Number.isFinite(close)) continue;
      var x = tx(p.t);
      if (x < plot.left - bodyW || x > plot.left + plot.width + bodyW) continue;
      var yOpen = ty(open);
      var yClose = ty(close);
      var yHigh = Math.min(yOpen, yClose);
      var yLow = Math.max(yOpen, yClose);
      var up = close >= open;
      var color = up ? C.buy : C.sell;
      var bodyTop = Math.min(yOpen, yClose);
      var bodyH = Math.max(1, Math.abs(yClose - yOpen));

      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, yHigh);
      ctx.lineTo(x + 0.5, yLow);
      ctx.stroke();
      ctx.fillRect(Math.round(x - bodyW / 2) + 0.5, Math.round(bodyTop) + 0.5, bodyW, bodyH);
      last = p;
    }
    return last;
  }

  function drawNoData(ctx, plot, gx, H, label, value) {
    var y = plot.top + Math.round(plot.height / 2) + 0.5;
    ctx.strokeStyle = C.gridStrong;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.left + plot.width, y);
    ctx.stroke();

    ctx.fillStyle = C.label;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '800 10px "JetBrains Mono", Consolas, monospace';
    ctx.font = '700 10px "JetBrains Mono", Consolas, monospace';
    ctx.fillText(Number.isFinite(value) ? fmt(value) : 'waiting', gx + 6, H / 2);
  }

  function drawOverlay(canvas) {
    var overlay = cvdOverlayCanvas(canvas) || canvas;
    var model = overlay && overlay._cvdOverlayModel;
    var s = setup(overlay);
    if (!s) return;
    var ctx = s.ctx;
    ctx.clearRect(0, 0, s.width, s.height);
    if (!model) return;
    var cross = V6OF.getChartCrosshair ? V6OF.getChartCrosshair(overlay) : V6OF._fallbackChartCrosshair;
    if (!cross || !cross.visible || !cross.enabled) return;

    var plot = model.plot;
    var win = model.win;
    var span = Math.max(1, win.end - win.start);
    var crossX = Number.isFinite(cross.x)
      ? cross.x
      : (Number.isFinite(cross.time) ? plot.left + (cross.time - win.start) / span * plot.width : NaN);
    if (!Number.isFinite(crossX) || crossX < plot.left || crossX > plot.left + plot.width) return;

    ctx.save();
    ctx.strokeStyle = C.crosshair;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(crossX, 0);
    ctx.lineTo(crossX, s.height);
    ctx.stroke();
    ctx.restore();

    var value = Number.isFinite(model.tip) ? model.tip : model.lastValue;
    if (Number.isFinite(cross.time)) {
      var hval = findNearestValue(model.points || [], cross.time);
      if (hval != null) value = hval;
    }
    ctx.fillStyle = C.scaleBg;
    ctx.fillRect(model.gx, Math.max(0, s.height / 2 - 10), Math.max(0, s.width - model.gx), 20);
    ctx.fillStyle = value >= 0 ? C.buy : C.sell;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '800 10px "JetBrains Mono", Consolas, monospace';
    ctx.fillText(fmt(value), model.gx + 6, s.height / 2);
  }

  function drawSimple(canvas, state) {
    var perfStart = window.performance ? performance.now() : 0;
    updateThemeColors(state && state.settings && state.settings.bgColor);
    var s = setup(canvas);
    if (!s) return;
    var ctx = s.ctx, W = s.width, H = s.height;
    var overlayCanvas = cvdOverlayCanvas(canvas);

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    var gx = Math.max(LABEL_W + 40, W - VAL_W);
    var plot = {
      left: LABEL_W,
      top: 8,
      width: Math.max(1, gx - LABEL_W - 1),
      height: Math.max(24, H - 30)
    };

    ctx.fillStyle = C.scaleBg;
    ctx.fillRect(gx, 0, Math.max(0, W - gx), H);
    ctx.strokeStyle = C.verSep;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(gx + 0.5, 0);
    ctx.lineTo(gx + 0.5, H);
    ctx.stroke();

    var drawPointLimit = Math.max(1200, Math.min(12000, Math.ceil((W || 900) * 3)));
    var snap = V6OF.CvdBuckets && V6OF.CvdBuckets.snapshot ? V6OF.CvdBuckets.snapshot(drawPointLimit) : null;
    if (!snap) {
      drawNoData(ctx, plot, gx, H, 'CVD', NaN);
      if (overlayCanvas) { overlayCanvas._cvdOverlayModel = null; drawOverlay(overlayCanvas); }
      recordPerf('cvd', perfStart);
      return;
    }

    var data = cvdSeriesFromSnapshot(snap);
    var win = timeWindow(snap);
    if (!win || !Number.isFinite(win.start) || !Number.isFinite(win.end) || win.end <= win.start) {
      var now = Date.now();
      win = { start: now - 3600000, end: now };
    }

    var points = data.points;
    var visible = [];
    var startIndex = -1;
    for (var idx = 0; idx < points.length; idx++) {
      if (points[idx].t >= win.start) {
        startIndex = idx;
        break;
      }
    }
    if (startIndex !== -1) {
      var startFrom = Math.max(0, startIndex - 1);
      for (var idx = startFrom; idx < points.length; idx++) {
        if (points[idx].t <= win.end) {
          visible.push(points[idx]);
        } else {
          visible.push(points[idx]); // include one point after the window
          break;
        }
      }
    } else if (points.length) {
      visible.push(points[points.length - 1]);
    }

    if (visible.length < 2 && points.length >= 2) {
      visible = points.slice(Math.max(0, points.length - 900));
      win = { start: visible[0].t, end: visible[visible.length - 1].t };
      if (win.end <= win.start) win.end = win.start + (snap.interval || 60000);
    }
    if (visible.length === 1) {
      var only = visible[0];
      var spanFallback = Math.max(snap.interval || 60000, win.end - win.start || 60000);
      visible = [
        { t: Math.max(win.start, only.t - spanFallback), v: only.v },
        only
      ];
      if (visible[0].t >= visible[1].t) visible[0].t = visible[1].t - spanFallback;
      win.start = Math.min(win.start, visible[0].t);
      win.end = Math.max(win.end, visible[1].t);
    }

    if (!visible.length) {
      drawNoData(ctx, plot, gx, H, data.bucket.label || 'CVD', data.tip);
      if (overlayCanvas) { overlayCanvas._cvdOverlayModel = null; drawOverlay(overlayCanvas); }
      recordPerf('cvd', perfStart);
      return;
    }

    // ── Stable Y-axis range (expansion-only, never shrink) ──
    var rawMin = Infinity;
    var rawMax = -Infinity;
    visible.forEach(function (p) {
      if (p.v < rawMin) rawMin = p.v;
      if (p.v > rawMax) rawMax = p.v;
    });
    if (Number.isFinite(data.tip)) {
      if (data.tip < rawMin) rawMin = data.tip;
      if (data.tip > rawMax) rawMax = data.tip;
    }
    if (!Number.isFinite(rawMin) || !Number.isFinite(rawMax)) {
      rawMin = -1;
      rawMax = 1;
    }
    if (rawMin === rawMax) {
      var centeredPad = Math.max(1, Math.abs(rawMin) * 0.12);
      rawMin -= centeredPad;
      rawMax += centeredPad;
    } else {
      var pad = (rawMax - rawMin) * 0.12;
      rawMin -= pad;
      rawMax += pad;
    }
    // Expansion-only: only grow the range, never shrink (unless autoFit && not zoomed)
    var min, max;
    if (_cvp.autoFit || !_cvp.initialized) {
      min = rawMin;
      max = rawMax;
    } else {
      min = Math.min(_cvp.cvdMin, rawMin);
      max = Math.max(_cvp.cvdMax, rawMax);
    }
    // Clamp to prevent insane ranges
    if (max - min > 1e12) { min = rawMin; max = rawMax; }
    _cvp.cvdMin = min;
    _cvp.cvdMax = max;

    var span = Math.max(1, win.end - win.start);
    function tx(ts) { return plot.left + (ts - win.start) / span * plot.width; }
    function ty(v) { return plot.top + (max - v) / (max - min) * plot.height; }

    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (var g = 1; g <= 3; g++) {
      var gy = plot.top + plot.height * g / 4;
      ctx.beginPath();
      ctx.moveTo(plot.left, gy);
      ctx.lineTo(plot.left + plot.width, gy);
      ctx.stroke();
    }
    if (min < 0 && max > 0) {
      ctx.strokeStyle = C.gridStrong;
      ctx.beginPath();
      ctx.moveTo(plot.left, ty(0));
      ctx.lineTo(plot.left + plot.width, ty(0));
      ctx.stroke();
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.left, plot.top, plot.width, plot.height);
    ctx.clip();
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    var lastPoint = drawCvdCandles(ctx, visible, snap.interval || 60000, tx, ty, plot) || visible[visible.length - 1];
    ctx.restore();

    var cross = V6OF.getChartCrosshair ? V6OF.getChartCrosshair(canvas) : V6OF._fallbackChartCrosshair;
    var value = Number.isFinite(data.tip) ? data.tip : visible[visible.length - 1].v;
    if (cross && cross.visible && Number.isFinite(cross.time)) {
      var hval = findNearestValue(points, cross.time);
      if (hval != null) value = hval;
    }

    ctx.fillStyle = C.line;
    ctx.textAlign = 'left';
    ctx.font = '800 10px "JetBrains Mono", Consolas, monospace';
    ctx.fillText(fmt(value), gx + 6, H / 2);

    if (overlayCanvas) {
      overlayCanvas._cvdState = state;
      overlayCanvas._cvdOverlayModel = {
        plot: plot,
        win: win,
        points: points,
        tip: data.tip,
        lastValue: visible.length ? visible[visible.length - 1].v : data.tip,
        gx: gx
      };
      drawOverlay(overlayCanvas);
    }

    ctx.fillStyle = C.timeLabel;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = '9px "JetBrains Mono", Consolas, monospace';
    var labelCount = Math.min(5, Math.max(2, Math.floor(plot.width / 110)));
    for (var li = 0; li <= labelCount; li++) {
      var t = win.start + span * li / labelCount;
      ctx.fillText(fmtTime(t), plot.left + plot.width * li / labelCount, H - 4);
    }

    if (false && cross && cross.visible && cross.enabled) {
      var crossX = Number.isFinite(cross.x) ? cross.x : (Number.isFinite(cross.time) ? tx(cross.time) : NaN);
      if (Number.isFinite(crossX) && crossX >= plot.left && crossX <= plot.left + plot.width) {
        ctx.save();
        ctx.strokeStyle = C.crosshair;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(crossX, 0);
        ctx.lineTo(crossX, H);
        ctx.stroke();
        ctx.restore();
      }
    }

    recordPerf('cvd', perfStart);
  }

  function drawLegacy(canvas, state) {
    var perfStart = window.performance ? performance.now() : 0;
    updateThemeColors(state && state.settings && state.settings.bgColor);
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

    var cross = V6OF.getChartCrosshair ? V6OF.getChartCrosshair(canvas) : V6OF._fallbackChartCrosshair;
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

  V6OF.register('UI', 'CvdPanel', {
    draw: function (canvas, state) {
      canvas = cvdDataCanvas(canvas) || canvas;
      if (!canvas) return;
      canvas._cvdState = state;
      if (canvas._cvdQueued) return;
      canvas._cvdQueued = true;

      // Bind interactive controls once
      if (!canvas._cvdInteractBound) {
        canvas._cvdInteractBound = true;
        canvas._cvdInteractAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        var listenerOptions = canvas._cvdInteractAbort ? { signal: canvas._cvdInteractAbort.signal } : false;
        var wheelListenerOptions = canvas._cvdInteractAbort ? { passive: false, signal: canvas._cvdInteractAbort.signal } : { passive: false };

        // Wheel zoom: plain wheel = zoom X of main chart, Ctrl+wheel = zoom Y of CVD
        canvas.addEventListener('wheel', function (e) {
          e.preventDefault();
          var rect = cachedRect(canvas, false);
          var mx = e.clientX - rect.left;
          var my = e.clientY - rect.top;
          var zoomFactor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
          var vp = V6OF.chart;

          if (e.ctrlKey || e.metaKey) {
            // Zoom Y of CVD
            var span = _cvp.cvdMax - _cvp.cvdMin;
            if (span < 1) span = 1;
            var ratio = my / rect.height;
            var cvdAtCursor = _cvp.cvdMin + (1 - ratio) * span;
            var newSpan = Math.max(0.1, span * zoomFactor);
            _cvp.cvdMin = cvdAtCursor - (1 - ratio) * newSpan;
            _cvp.cvdMax = _cvp.cvdMin + newSpan;
            _cvp.autoFit = false;
          } else if (e.shiftKey) {
            // Shift+wheel = pan X on main chart
            if (vp) {
              var tSpan = vp.timeEnd - vp.timeStart;
              var pan = tSpan * (e.deltaY > 0 ? 0.08 : -0.08);
              vp.setTimeRange(vp.timeStart + pan, vp.timeEnd + pan);
            }
          } else {
            // Plain wheel = zoom X on main chart
            if (vp) {
              vp.zoomTime(zoomFactor, chartAnchorXFromCvd(mx, rect, vp));
            }
          }
          // Force re-draw
          if (V6OF.ChartInteractions && V6OF.ChartInteractions.redraw) {
            V6OF.ChartInteractions.redraw();
          } else {
            canvas._cvdQueued = false;
            V6OF.CvdPanel.draw(canvas, state || canvas._cvdState);
          }
        }, wheelListenerOptions);

        // Drag pan (horizontal pans time axis of main chart, vertical pans CVD Y axis)
        canvas.addEventListener('pointerdown', function (e) {
          var rect = cachedRect(canvas, true);
          var mx = e.clientX - rect.left;
          var vp = V6OF.chart;

          _cvp.dragStartX = e.clientX;
          _cvp.dragStartY = e.clientY;
          _cvp.dragStartTime = vp ? vp.timeStart : 0;
          _cvp.dragStartCvdMin = _cvp.cvdMin;
          _cvp.dragStartCvdMax = _cvp.cvdMax;
          _cvp.wasDragging = false;

          var W = rect.width;
          var gx = Math.max(LABEL_W + 40, W - VAL_W);
          if (mx >= gx) {
            _cvp.dragMode = 'value-axis';
          } else {
            _cvp.dragMode = 'plot';
          }
          canvas.setPointerCapture(e.pointerId);
        }, listenerOptions);

        canvas.addEventListener('pointermove', function (e) {
          if (!canvas.hasPointerCapture(e.pointerId)) return;
          var dx = e.clientX - _cvp.dragStartX;
          var dy = e.clientY - _cvp.dragStartY;
          if (Math.abs(dx) > 3 || Math.abs(dy) > 3) _cvp.wasDragging = true;
          if (!_cvp.wasDragging) return;

          var rect = cachedRect(canvas, false);
          var vp = V6OF.chart;

          if (_cvp.dragMode === 'value-axis') {
            // Drag on right axis -> Zoom Y range of CVD
            var vSpan = _cvp.dragStartCvdMax - _cvp.dragStartCvdMin;
            var zoomFactor = 1 + dy * 0.005;
            if (zoomFactor < 0.1) zoomFactor = 0.1;
            if (zoomFactor > 10) zoomFactor = 10;
            var newSpan = vSpan * zoomFactor;
            var mid = (_cvp.dragStartCvdMax + _cvp.dragStartCvdMin) / 2;
            _cvp.cvdMin = mid - newSpan / 2;
            _cvp.cvdMax = _cvp.cvdMin + newSpan;
            _cvp.autoFit = false;
          } else {
            // Drag on plot area -> Pan time X of main chart + Pan Y of CVD
            if (vp) {
              vp.panByPixels(-dx * 0.35, 0);
            }
            var vSpan = _cvp.dragStartCvdMax - _cvp.dragStartCvdMin;
            var shift = (dy / rect.height) * vSpan;
            _cvp.cvdMin = _cvp.dragStartCvdMin + shift;
            _cvp.cvdMax = _cvp.dragStartCvdMax + shift;
            _cvp.autoFit = false;
          }

          if (V6OF.ChartInteractions && V6OF.ChartInteractions.redraw) {
            V6OF.ChartInteractions.redraw();
          } else {
            canvas._cvdQueued = false;
            V6OF.CvdPanel.draw(canvas, state || canvas._cvdState);
          }
        }, listenerOptions);

        canvas.addEventListener('pointerup', function (e) {
          canvas.releasePointerCapture(e.pointerId);
          invalidateRectCache(canvas);
        }, listenerOptions);
        canvas.addEventListener('pointercancel', function (e) {
          canvas.releasePointerCapture(e.pointerId);
          invalidateRectCache(canvas);
        }, listenerOptions);

        // Double-click to re-fit
        canvas.addEventListener('dblclick', function () {
          _cvp.cvdMin = Infinity;
          _cvp.cvdMax = -Infinity;
          _cvp.autoFit = true;
          _cvp.followLive = true;
          _cvp.initialized = false;
          var vp = V6OF.chart;
          if (vp) {
            vp.resetView();
          }
          if (V6OF.ChartInteractions && V6OF.ChartInteractions.redraw) {
            V6OF.ChartInteractions.redraw();
          } else {
            canvas._cvdQueued = false;
            V6OF.CvdPanel.draw(canvas, state || canvas._cvdState);
          }
        }, listenerOptions);
      }
      var schedule = typeof requestAnimationFrame === 'function' && !document.hidden
        ? requestAnimationFrame : function (fn) { return setTimeout(fn, 33); };
      schedule(function () { canvas._cvdQueued = false; drawSimple(canvas, canvas._cvdState); });
    },
    drawNow: function (canvas, state) {
      canvas = cvdDataCanvas(canvas) || canvas;
      if (!canvas) return;
      canvas._cvdState = state || canvas._cvdState;
      canvas._cvdQueued = false;
      drawSimple(canvas, canvas._cvdState);
    },
    redrawOverlay: function (canvas) {
      drawOverlay(canvas);
    },
    cleanup: function (canvas) {
      cleanupCanvas(canvas);
    }
  }, 'CvdPanel');
})();
