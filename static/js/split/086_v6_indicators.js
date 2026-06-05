// ---------- 086_v6_indicators.js ----------
// Phase 18: Generic indicator overlay system for V6 canvas chart.
// Registry + compute + draw for line, dashed, area, and band indicators.
// Extensible: add new indicators via V6OF.Indicators.register().

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};

  // ── Indicator registry ──
  // Each entry: { name, type, compute(candles, params) → [{time, value}], defaults }
  var _registry = {};

  // ── Active instances (per-session, from settings) ──
  // [{ name, params, visible, color, width, dash, fillColor, fillOpacity }]
  var _active = [];

  // ── Computed data cache (keyed by name+params+symbol) ──
  var _cache = {};

  // ── Built-in computes ──
  function computeSMA(candles, params) {
    var period = params.period || 20;
    var src = params.source || 'close';
    var out = [];
    var sum = 0, count = 0;
    for (var i = 0; i < candles.length; i++) {
      var val = Number(candles[i][src]);
      if (!Number.isFinite(val)) continue;
      sum += val;
      count++;
      if (count > period) {
        var old = Number(candles[i - period][src]);
        if (Number.isFinite(old)) sum -= old;
        count--;
      }
      if (count >= period) {
        out.push({ time: candles[i].openTime || candles[i].time, value: sum / count });
      }
    }
    return out;
  }

  function computeEMA(candles, params) {
    var period = params.period || 20;
    var src = params.source || 'close';
    var k = 2 / (period + 1);
    var out = [];
    var prev = null;
    for (var i = 0; i < candles.length; i++) {
      var val = Number(candles[i][src]);
      if (!Number.isFinite(val)) continue;
      if (prev === null) {
        prev = val;
        // Seed with SMA for first value
        var sum = 0, cnt = 0;
        for (var j = Math.max(0, i - period + 1); j <= i; j++) {
          var v = Number(candles[j][src]);
          if (Number.isFinite(v)) { sum += v; cnt++; }
        }
        if (cnt > 0) prev = sum / cnt;
      } else {
        prev = prev + k * (val - prev);
      }
      out.push({ time: candles[i].openTime || candles[i].time, value: prev });
    }
    return out;
  }

  function computeBollinger(candles, params) {
    var period = params.period || 20;
    var mult = params.multiplier || 2;
    var src = params.source || 'close';
    var middle = computeSMA(candles, { period: period, source: src });
    var upper = [], lower = [];
    for (var i = 0; i < middle.length; i++) {
      var t = middle[i].time;
      var sumSq = 0, count = 0;
      // Find candles around this SMA point
      for (var j = 0; j < candles.length; j++) {
        var ct = candles[j].openTime || candles[j].time;
        if (ct > t) break;
      }
      var start = Math.max(0, j - period);
      for (var k = start; k < j && k < candles.length; k++) {
        var v = Number(candles[k][src]);
        if (Number.isFinite(v)) { sumSq += Math.pow(v - middle[i].value, 2); count++; }
      }
      if (count > 0) {
        var std = Math.sqrt(sumSq / count);
        upper.push({ time: t, value: middle[i].value + mult * std });
        lower.push({ time: t, value: middle[i].value - mult * std });
      }
    }
    return { middle: middle, upper: upper, lower: lower };
  }

  // Register built-ins
  _registry['sma'] = {
    name: 'SMA',
    type: 'line',
    compute: computeSMA,
    defaults: { period: 20, source: 'close', color: '#f59e0b', width: 1.5 }
  };
  _registry['ema'] = {
    name: 'EMA',
    type: 'line',
    compute: computeEMA,
    defaults: { period: 20, source: 'close', color: '#3b82f6', width: 1.5 }
  };
  _registry['bollinger'] = {
    name: 'Bollinger Bands',
    type: 'bands',
    compute: computeBollinger,
    defaults: { period: 20, multiplier: 2, source: 'close', color: '#8b5cf6', width: 1, fillOpacity: 0.08 }
  };

  function findFirstVisibleIndex(data, timeStart) {
    if (!data || !data.length) return 0;
    var lo = 0, hi = data.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >>> 1;
      if (data[mid].time < timeStart) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return Math.max(0, lo - 1);
  }

  function drawLineIndicator(ctx, vp, plot, data, color, width, dash) {
    if (!data || !data.length) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 1;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    var started = false;
    var startIdx = findFirstVisibleIndex(data, vp.timeStart);
    for (var i = startIdx; i < data.length; i++) {
      var d = data[i];
      if (d.time > vp.timeEnd) {
        if (Number.isFinite(d.value)) {
          var x = vp.timeToX(d.time);
          var y = vp.priceToY(d.value);
          if (started) ctx.lineTo(x, y);
        }
        break;
      }
      if (!Number.isFinite(d.value)) { started = false; continue; }
      if (d.value < vp.priceMin || d.value > vp.priceMax) { started = false; continue; }
      var x = vp.timeToX(d.time);
      var y = vp.priceToY(d.value);
      if (!started) { ctx.moveTo(x, y); started = true; }
      else { ctx.lineTo(x, y); }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawAreaIndicator(ctx, vp, plot, data, color, fillColor, fillOpacity, width) {
    if (!data || !data.length) return;
    var baseY = vp.priceToY(vp.priceMin);
    ctx.save();
    ctx.beginPath();
    var started = false;
    var startIdx = findFirstVisibleIndex(data, vp.timeStart);
    var lastX = 0;
    for (var i = startIdx; i < data.length; i++) {
      var d = data[i];
      if (d.time > vp.timeEnd) {
        if (Number.isFinite(d.value)) {
          var x = vp.timeToX(d.time);
          var y = vp.priceToY(Math.max(vp.priceMin, Math.min(vp.priceMax, d.value)));
          if (started) {
            ctx.lineTo(x, y);
            lastX = x;
          }
        }
        break;
      }
      if (!Number.isFinite(d.value)) { started = false; continue; }
      var x = vp.timeToX(d.time);
      var y = vp.priceToY(Math.max(vp.priceMin, Math.min(vp.priceMax, d.value)));
      if (!started) { ctx.moveTo(x, baseY); ctx.lineTo(x, y); started = true; }
      else { ctx.lineTo(x, y); }
      lastX = x;
    }
    if (started) {
      ctx.lineTo(lastX, baseY);
      ctx.closePath();
      ctx.fillStyle = fillColor || color.replace(')', ', ' + (fillOpacity || 0.1) + ')').replace('rgb', 'rgba');
      ctx.fill();
      // Also stroke the top edge
      ctx.strokeStyle = color;
      ctx.lineWidth = width || 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawBandsIndicator(ctx, vp, plot, upper, lower, color, fillOpacity, width) {
    if (!upper || !lower || !upper.length) return;
    ctx.save();
    var alpha = fillOpacity || 0.08;
    var fillColor = color.replace(')', ', ' + alpha + ')').replace('rgb', 'rgba');
    if (fillColor === color) fillColor = color; // fallback if regex fails

    var startIdx = findFirstVisibleIndex(upper, vp.timeStart);

    // Fill between upper and lower
    ctx.beginPath();
    var started = false;
    var endIdx = upper.length - 1;
    for (var i = startIdx; i < upper.length; i++) {
      var u = upper[i];
      if (u.time > vp.timeEnd) {
        if (Number.isFinite(u.value)) {
          var x = vp.timeToX(u.time);
          var yu = vp.priceToY(Math.max(vp.priceMin, Math.min(vp.priceMax, u.value)));
          if (started) ctx.lineTo(x, yu);
        }
        endIdx = i;
        break;
      }
      if (!Number.isFinite(u.value)) { started = false; continue; }
      var x = vp.timeToX(u.time);
      var yu = vp.priceToY(Math.max(vp.priceMin, Math.min(vp.priceMax, u.value)));
      if (!started) { ctx.moveTo(x, yu); started = true; }
      else { ctx.lineTo(x, yu); }
    }
    // Trace back along the lower band
    for (var i = endIdx; i >= startIdx; i--) {
      var l = lower[i];
      if (!l || !Number.isFinite(l.value)) continue;
      var x = vp.timeToX(l.time);
      var yl = vp.priceToY(Math.max(vp.priceMin, Math.min(vp.priceMax, l.value)));
      ctx.lineTo(x, yl);
    }
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();

    // Stroke the bands
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 1;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ── Public API ──

  var API = {
    // Register a custom indicator
    register: function (id, def) {
      if (!id || !def || !def.compute) return false;
      _registry[id] = {
        name: def.name || id,
        type: def.type || 'line',
        compute: def.compute,
        defaults: def.defaults || {}
      };
      return true;
    },

    // Add an active indicator instance
    add: function (id, params) {
      var def = _registry[id];
      if (!def) return false;
      params = params || {};
      var cfg = {};
      for (var k in def.defaults) { cfg[k] = def.defaults[k]; }
      for (var k in params) { cfg[k] = params[k]; }
      cfg.id = id;
      cfg.visible = true;
      _active.push(cfg);
      return cfg;
    },

    // Remove an active indicator by id
    remove: function (id) {
      _active = _active.filter(function (a) { return a.id !== id; });
    },

    // Clear all active indicators
    clear: function () {
      _active = [];
      _cache = {};
    },

    // Get list of active indicators
    list: function () {
      return _active.slice();
    },

    // Get registry info
    registry: function () {
      var out = {};
      for (var k in _registry) {
        out[k] = { name: _registry[k].name, type: _registry[k].type, defaults: _registry[k].defaults };
      }
      return out;
    },

    // Compute and cache an indicator
    compute: function (id, candles, params, symbol) {
      var def = _registry[id];
      if (!def || !candles || !candles.length) return null;
      var key = id + ':' + (symbol || '') + ':' + JSON.stringify(params || {});
      if (_cache[key]) return _cache[key];
      var result = def.compute(candles, params || {});
      _cache[key] = result;
      return result;
    },

    // Draw all active indicators on the chart
    drawAll: function (ctx, vp, plot, state, baseCandles) {
      if (!_active.length) return;
      var symbol = state ? state.symbol : '';
      for (var i = 0; i < _active.length; i++) {
        var a = _active[i];
        if (!a.visible) continue;
        var def = _registry[a.id];
        if (!def) continue;

        // Compute or use cached data
        var params = {};
        for (var k in a) { if (k !== 'id' && k !== 'visible') params[k] = a[k]; }
        var data = API.compute(a.id, baseCandles, params, symbol);
        if (!data) continue;

        if (def.type === 'line') {
          drawLineIndicator(ctx, vp, plot, Array.isArray(data) ? data : data.middle || data,
            a.color || def.defaults.color, a.width || def.defaults.width, a.dash);
        } else if (def.type === 'area') {
          drawAreaIndicator(ctx, vp, plot, Array.isArray(data) ? data : data.middle || data,
            a.color || def.defaults.color, a.fillColor, a.fillOpacity, a.width);
        } else if (def.type === 'bands') {
          if (data.upper && data.lower) {
            drawBandsIndicator(ctx, vp, plot, data.upper, data.lower,
              a.color || def.defaults.color, a.fillOpacity || def.defaults.fillOpacity, a.width);
          }
          if (data.middle) {
            drawLineIndicator(ctx, vp, plot, data.middle,
              a.color || def.defaults.color, a.width || 1, [3, 3]);
          }
        }
      }
    }
  };

  V6OF.Indicators = API;
})();
