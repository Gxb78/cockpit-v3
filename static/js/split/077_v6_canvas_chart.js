// ---------- 077_v6_canvas_chart.js ----------
// Canvas chart engine for Cockpit V6 orderflow.
// Phase 17: real chart engine — price scale (right), time scale (bottom),
//           grid, crosshair, pan/zoom via V6OF.chart (ChartViewport).
//           Heatmap SD + Footprint V1 render in the shared time/price space.
// The mock path (index-based candles) is preserved unchanged below.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};

  var GUTTER_RIGHT = 66;  // price scale width
  var GUTTER_BOTTOM = 24; // time scale height
  var PAD_TOP = 22;       // header label band
  var PAD_LEFT = 8;
  var DEFAULT_EMIT_MS = 500;

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

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  function setupCanvas(canvas) {
    if (!canvas) return null;
    var rect = canvas.getBoundingClientRect();
    var width = Math.max(1, rect.width || canvas.clientWidth || 1);
    var height = Math.max(1, rect.height || canvas.clientHeight || 1);
    var dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, width: width, height: height };
  }

  // ===================================================================
  // LIVE CHART ENGINE (Phase 17) — viewport-based time/price space
  // ===================================================================

  function clamp01(value) {
    value = Number(value);
    if (!Number.isFinite(value) || value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  function frameTs(frame) {
    var ts = Number(frame.tsExchange);
    if (Number.isFinite(ts) && ts > 0) return ts;
    ts = Number(frame.tsLocal);
    return Number.isFinite(ts) ? ts : 0;
  }

  function candleStartTs(candle) {
    var t = Number(candle.openTime);
    return Number.isFinite(t) ? t : 0;
  }

  function candleEndTs(candle) {
    var t = Number(candle.closeTime);
    if (Number.isFinite(t) && t > 0) return t;
    var start = candleStartTs(candle);
    var interval = Number(candle.intervalMs) || 60000;
    return start + interval;
  }

  function formatCountdown(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '00:00';
    var totalSec = Math.ceil(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    if (h > 0) return h + ':' + pad(m) + ':' + pad(s);
    return pad(m) + ':' + pad(s);
  }

  function candleMidTs(candle) {
    return (candleStartTs(candle) + candleEndTs(candle)) / 2;
  }

  function normalizeCandleInterval(candle, fallback) {
    var interval = Number(candle && candle.intervalMs);
    if (Number.isFinite(interval) && interval >= 1000) return interval;
    var s = candleStartTs(candle);
    var e = candleEndTs(candle);
    if (e > s) return e - s;
    return fallback || 60000;
  }

  // Convert timeframe string ('1m', '1h', '1d', '1w', '1M') to milliseconds.
  function timeframeToMs(tf) {
    if (!tf) return 0;
    var match = tf.match(/^(\d+)([mhdwM])$/);
    if (!match) return 0;
    var val = parseInt(match[1], 10);
    var unit = match[2];
    if (unit === 'm') return val * 60000;
    if (unit === 'h') return val * 3600000;
    if (unit === 'd') return val * 86400000;
    if (unit === 'w') return val * 604800000;
    if (unit === 'M') return val * 2592000000; // ~30d
    return 0;
  }

  function fillCandleGaps(candles, intervalMs) {
    if (!Array.isArray(candles) || candles.length < 2) return candles || [];
    intervalMs = Math.max(1000, Number(intervalMs) || 60000);
    var out = [];
    var maxSynthetic = 240;
    var syntheticCount = 0;
    for (var i = 0; i < candles.length; i++) {
      var current = candles[i];
      if (!current || !Number.isFinite(Number(current.openTime))) continue;
      if (out.length) {
        var prev = out[out.length - 1];
        var prevStart = candleStartTs(prev);
        var currentStart = candleStartTs(current);
        var gap = currentStart - prevStart;
        if (gap > intervalMs * 1.5 && gap < intervalMs * 1000) {
          var nextOpen = prevStart + intervalMs;
          var carry = Number(prev.close);
          if (!Number.isFinite(carry) || carry <= 0) carry = Number(current.open);
          while (nextOpen < currentStart - intervalMs * 0.5 && syntheticCount < maxSynthetic) {
            out.push({
              symbol: current.symbol || prev.symbol || 'BTC',
              timeframe: current.timeframe || prev.timeframe,
              intervalMs: intervalMs,
              openTime: nextOpen,
              closeTime: nextOpen + intervalMs,
              open: carry,
              high: carry,
              low: carry,
              close: carry,
              volume: 0,
              synthetic: true,
              source: 'gap-fill'
            });
            syntheticCount++;
            nextOpen += intervalMs;
          }
        }
      }
      out.push(current);
    }
    V6OF.chartGapFill = { count: syntheticCount, updatedAt: Date.now() };
    return out;
  }

  // Convert hex color (#3ddc97) to rgba string with alpha
  function hexToRgba(hex, alpha) {
    if (!hex || hex.length < 7) return 'rgba(61,220,151,' + alpha + ')';
    var r = parseInt(hex.slice(1, 3), 16) || 0;
    var g = parseInt(hex.slice(3, 5), 16) || 0;
    var b = parseInt(hex.slice(5, 7), 16) || 0;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function emitGuess(frames) {
    var n = frames.length;
    if (n >= 2) {
      var gap = frameTs(frames[n - 1]) - frameTs(frames[n - 2]);
      if (Number.isFinite(gap) && gap > 0) return gap;
    }
    return DEFAULT_EMIT_MS;
  }

  var _mergedCandlesCache = null;
  var _mergedCandlesSrcChart = null;
  var _mergedCandlesSrcFp = null;
  var _mergedCandlesSrcTf = null;
  var _boundsCache = null;
  var _boundsSrcFrames = null;
  var _boundsSrcCandles = null;
  var _boundsSrcHeatmap = null;
  var _heatmapBoundsCache = null;
  var _heatmapBoundsFirst = null;
  var _heatmapBoundsLast = null;
  var _heatmapBoundsLen = 0;

  // Compute combined data extents (time + price) across the visible live data.
  // Candle base = backfilled history (chartCandles) merged with the live
  // forming candle(s) from footprint candles; footprint overrides by openTime.
  function mergedChartCandles(state) {
    var hist = Array.isArray(state.chartCandles) ? state.chartCandles : [];
    var fp = Array.isArray(state.footprintCandles) ? state.footprintCandles : [];
    // Live footprint candles are ALWAYS 1m. Only merge them into the base when
    // the active timeframe is 1m — otherwise higher TFs would show stray 1m
    // candles mixed into the history (wrong bars on 1h/4h/etc).
    var tf = state.timeframe || '1m';

    if (_mergedCandlesCache &&
        _mergedCandlesSrcChart === hist &&
        _mergedCandlesSrcFp === fp &&
        _mergedCandlesSrcTf === tf) {
      return _mergedCandlesCache;
    }

    var out;
    if (tf !== '1m') {
      out = hist.length ? hist : [];
    } else if (!hist.length) {
      out = fp;
    } else if (!fp.length) {
      out = hist;
    } else {
      var byTime = {};
      var i;
      for (i = 0; i < hist.length; i++) byTime[hist[i].openTime] = hist[i];
      for (i = 0; i < fp.length; i++) byTime[fp[i].openTime] = fp[i];
      var keys = Object.keys(byTime).map(Number).sort(function (a, b) { return a - b; });
      out = [];
      for (i = 0; i < keys.length; i++) out.push(byTime[keys[i]]);
      var interval = timeframeToMs(tf) || (out.length ? normalizeCandleInterval(out[out.length - 1], 60000) : 60000);
      out = fillCandleGaps(out, interval);
    }

    _mergedCandlesCache = out;
    _mergedCandlesSrcChart = hist;
    _mergedCandlesSrcFp = fp;
    _mergedCandlesSrcTf = tf;
    return out;
  }

  // Price range over only the candles inside the visible time window, so the
  // chart fills vertically at any zoom (TradingView-style autofit).
  function visiblePriceRange(candles, vp, state, showHeatmap) {
    if (!Array.isArray(candles) || !candles.length) return null;
    var min = Infinity, max = -Infinity, i;

    // Binary search for the first candle ending at or after timeStart
    var lo = 0, hi = candles.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >>> 1;
      if (candleEndTs(candles[mid]) < vp.timeStart) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    for (i = lo; i < candles.length; i++) {
      var c = candles[i];
      var s = candleStartTs(c);
      if (s > vp.timeEnd) break;
      if (Number.isFinite(c.low)) min = Math.min(min, c.low);
      if (Number.isFinite(c.high)) max = Math.max(max, c.high);
    }
    if (showHeatmap && state.lastHeatmapFrame) {
      var f = state.lastHeatmapFrame;
      if (Number.isFinite(f.priceMin)) min = Math.min(min, f.priceMin);
      if (Number.isFinite(f.priceMax)) max = Math.max(max, f.priceMax);
    }
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return null;
    var pad = Math.max((max - min) * 0.18, 1);
    return { min: min - pad, max: max + pad };
  }

  function heatmapBounds(frames) {
    frames = Array.isArray(frames) ? frames : [];
    var len = frames.length;
    if (!len) return null;
    var first = frames[0];
    var last = frames[len - 1];
    var cached = _heatmapBoundsCache;
    if (cached && _heatmapBoundsFirst === first && _heatmapBoundsLast === last && _heatmapBoundsLen === len) {
      return cached;
    }
    var tMin = Infinity, tMax = -Infinity, pMin = Infinity, pMax = -Infinity;
    if (cached && _heatmapBoundsFirst === first && _heatmapBoundsLast === frames[len - 2] && _heatmapBoundsLen === len - 1) {
      tMin = cached.tMin; tMax = cached.tMax; pMin = cached.pMin; pMax = cached.pMax;
      var added = last;
      var addedTs = frameTs(added);
      if (addedTs > 0) { tMin = Math.min(tMin, addedTs); tMax = Math.max(tMax, addedTs); }
      if (Number.isFinite(added.priceMin)) pMin = Math.min(pMin, added.priceMin);
      if (Number.isFinite(added.priceMax)) pMax = Math.max(pMax, added.priceMax);
    } else {
      for (var i = 0; i < len; i++) {
        var frame = frames[i];
        var ts = frameTs(frame);
        if (ts > 0) { tMin = Math.min(tMin, ts); tMax = Math.max(tMax, ts); }
        if (Number.isFinite(frame.priceMin)) pMin = Math.min(pMin, frame.priceMin);
        if (Number.isFinite(frame.priceMax)) pMax = Math.max(pMax, frame.priceMax);
      }
    }
    _heatmapBoundsCache = { tMin: tMin, tMax: tMax, pMin: pMin, pMax: pMax };
    _heatmapBoundsFirst = first;
    _heatmapBoundsLast = last;
    _heatmapBoundsLen = len;
    return _heatmapBoundsCache;
  }

  function computeLiveBounds(state, showHeatmap) {
    var frames = showHeatmap && Array.isArray(state.heatmapFrames) ? state.heatmapFrames : [];
    var candles = mergedChartCandles(state);
    if (_boundsCache &&
        _boundsSrcFrames === frames &&
        _boundsSrcCandles === candles &&
        _boundsSrcHeatmap === showHeatmap) {
      return _boundsCache;
    }
    var hb = showHeatmap ? heatmapBounds(frames) : null;
    var tMin = hb ? hb.tMin : Infinity;
    var tMax = hb ? hb.tMax : -Infinity;
    var pMin = hb ? hb.pMin : Infinity;
    var pMax = hb ? hb.pMax : -Infinity;

    for (var i = 0; i < candles.length; i++) {
      var candle = candles[i];
      var s = candleStartTs(candle), e = candleEndTs(candle);
      if (s > 0) tMin = Math.min(tMin, s);
      if (e > 0) tMax = Math.max(tMax, e);
      if (Number.isFinite(candle.low)) pMin = Math.min(pMin, candle.low);
      if (Number.isFinite(candle.high)) pMax = Math.max(pMax, candle.high);
    }

    var bounds = {};
    if (Number.isFinite(tMin) && Number.isFinite(tMax) && tMax > tMin) {
      bounds.timeMin = tMin;
      bounds.timeMax = tMax;
    }
    if (Number.isFinite(pMin) && Number.isFinite(pMax) && pMax > pMin) {
      var pad = Math.max((pMax - pMin) * 0.15, 1);
      bounds.priceMin = pMin - pad;
      bounds.priceMax = pMax + pad;
    }
    _boundsCache = bounds;
    _boundsSrcFrames = frames;
    _boundsSrcCandles = candles;
    _boundsSrcHeatmap = showHeatmap;
    return bounds;
  }

  function firstFrameIndexAtOrBefore(frames, timeStart) {
    var lo = 0;
    var hi = frames.length;
    while (lo < hi) {
      var mid = (lo + hi) >>> 1;
      if (frameTs(frames[mid]) < timeStart) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(0, lo - 1);
  }

  // ---- Nice ticks ----
  function niceStep(range, target) {
    if (!(range > 0)) return 1;
    var rough = range / Math.max(1, target);
    var pow = Math.pow(10, Math.floor(Math.log10(rough)));
    var norm = rough / pow;
    var step;
    if (norm < 1.5) step = 1;
    else if (norm < 3) step = 2;
    else if (norm < 7) step = 5;
    else step = 10;
    return step * pow;
  }

  function priceTicks(min, max, target) {
    var step = niceStep(max - min, target);
    if (!(step > 0)) return [];
    var start = Math.ceil(min / step) * step;
    var ticks = [];
    for (var p = start; p <= max + step * 0.001 && ticks.length < 60; p += step) {
      ticks.push(p);
    }
    return ticks;
  }

  var TIME_STEPS = [
    1000, 2000, 5000, 10000, 15000, 30000,
    60000, 120000, 300000, 600000, 900000, 1800000,
    3600000, 7200000, 14400000, 21600000, 43200000, 86400000
  ];

  function timeTicks(start, end, target) {
    var span = end - start;
    if (!(span > 0)) return { ticks: [], step: 60000 };
    var step = TIME_STEPS[TIME_STEPS.length - 1];
    for (var i = 0; i < TIME_STEPS.length; i++) {
      if (span / TIME_STEPS[i] <= target) { step = TIME_STEPS[i]; break; }
    }
    var first = Math.ceil(start / step) * step;
    var ticks = [];
    for (var t = first; t <= end && ticks.length < 60; t += step) {
      ticks.push(t);
    }
    return { ticks: ticks, step: step };
  }

  var MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function timeAxisLabel(ts, step) {
    var d = new Date(ts);
    function pad(n) { return n < 10 ? '0' + n : String(n); }

    // Step >= 24h → date format "03 Jun"
    if (step >= 86400000) {
      return pad(d.getUTCDate()) + ' ' + MONTHS_SHORT[d.getUTCMonth()];
    }

    // Sub-minute (step < 60000) → "HH:MM:SS"
    if (step < 60000) {
      return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
    }

    // Step >= 1m → "HH:MM"
    return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
  }

  function timeAxisDate(ts) {
    var d = new Date(ts);
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return pad(d.getUTCDate()) + ' ' + MONTHS_SHORT[d.getUTCMonth()];
  }

  // Expose time axis helpers for external handling
  V6OF.timeAxisDate = timeAxisDate;

  function drawGridAndScales(ctx, vp, plot, settings) {
    var pTicks = priceTicks(vp.priceMin, vp.priceMax, 6);
    var tInfo = timeTicks(vp.timeStart, vp.timeEnd, 7);

      // Price scale (right gutter)
    var gx = plot.left + plot.width;
    ctx.fillStyle = settings.bgColor || '#ffffff';
    ctx.fillRect(gx, plot.top - PAD_TOP, GUTTER_RIGHT, plot.height + PAD_TOP + GUTTER_BOTTOM);
    ctx.strokeStyle = 'rgba(19, 23, 34, 0.18)';
    ctx.beginPath();
    ctx.moveTo(gx + 0.5, plot.top);
    ctx.lineTo(gx + 0.5, plot.top + plot.height);
    ctx.stroke();
    ctx.fillStyle = 'rgba(19, 23, 34, 0.70)';
    ctx.font = '10px JetBrains Mono, Consolas, monospace';
    ctx.textAlign = 'left';
    pTicks.forEach(function (price) {
      var y = vp.priceToY(price);
      if (y < plot.top + 4 || y > plot.top + plot.height - 2) return;
      ctx.fillText(V6OF.format.price(price), gx + 5, y + 3);
    });

    // Time scale (bottom)
    var by = plot.top + plot.height;
    ctx.fillStyle = settings.bgColor || '#ffffff';
    ctx.fillRect(plot.left, by, plot.width, GUTTER_BOTTOM);
    ctx.strokeStyle = 'rgba(19, 23, 34, 0.18)';
    ctx.beginPath();
    ctx.moveTo(plot.left, by + 0.5);
    ctx.lineTo(plot.left + plot.width, by + 0.5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(19, 23, 34, 0.70)';
    ctx.font = '10px JetBrains Mono, Consolas, monospace';
    ctx.textAlign = 'center';
    tInfo.ticks.forEach(function (ts, idx) {
      var x = vp.timeToX(ts);
      if (x < plot.left + 16 || x > plot.left + plot.width - 16) return;
      var d = new Date(ts);
      var dayKey = d.getUTCFullYear() + '-' + d.getUTCMonth() + '-' + d.getUTCDate();
      var prevDayKey = idx > 0 ? (function () {
        var pd = new Date(tInfo.ticks[idx - 1]);
        return pd.getUTCFullYear() + '-' + pd.getUTCMonth() + '-' + pd.getUTCDate();
      })() : null;
      var isNewDay = prevDayKey && dayKey !== prevDayKey;
      
      var label;
      // Always show date+time on the first tick (so you always know the day).
      if (tInfo.step >= 86400000 || isNewDay) {
        label = V6OF.timeAxisDate(ts);
      } else if (tInfo.step >= 86400000) {
        // Step >= 1 day → always show "DD Mon"
        label = V6OF.timeAxisDate(ts);
      } else if (false) {
        // Span covers multiple days → show "DD Mon HH:MM" on day boundaries
        label = V6OF.timeAxisDate(ts) + ' ' + timeAxisLabel(ts, tInfo.step);
      } else if (isNewDay) {
        label = V6OF.timeAxisDate(ts);
      } else {
        label = timeAxisLabel(ts, tInfo.step);
      }
      ctx.beginPath();
      ctx.moveTo(x, by);
      ctx.lineTo(x, by + 4);
      ctx.stroke();
      ctx.fillText(label, x, by + 15);
    });
    ctx.textAlign = 'left';
  }

  // Viridis-style colormap (perceptual): intensity 0..1 -> [r,g,b].
  // Dark indigo (cold/empty) -> blue -> teal -> green -> bright yellow (hot).
  var VIRIDIS = [
    [68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]
  ];
  function viridis(t) {
    if (!(t > 0)) return VIRIDIS[0];
    if (t >= 1) return VIRIDIS[VIRIDIS.length - 1];
    var s = t * (VIRIDIS.length - 1);
    var i = Math.floor(s);
    var f = s - i;
    var a = VIRIDIS[i], b = VIRIDIS[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  // Pro liquidity-heatmap field: dense time x price grid, viridis-coloured by
  // resting-liquidity intensity. Candles render on top of this background.
  function drawHeatmapVp(ctx, vp, plot, frames, settings) {
    if (!Array.isArray(frames) || !frames.length) return false;
    var count = frames.length;
    var emit = emitGuess(frames);
    var scaleY = plot.height / vp.priceSpan();

    // Light base
    ctx.fillStyle = '#e8eaed';
    ctx.fillRect(plot.left, plot.top, plot.width, plot.height);

    var startIndex = firstFrameIndexAtOrBefore(frames, vp.timeStart);
    var hardEnd = vp.timeEnd + emit * 2;
    var endIndex = startIndex;
    while (endIndex < count && frameTs(frames[endIndex]) <= hardEnd) endIndex++;
    endIndex = Math.min(count, Math.max(startIndex + 1, endIndex));
    var visibleFrames = Math.max(1, endIndex - startIndex);
    var maxColumns = Math.max(120, Math.floor(plot.width * 1.25));
    var step = Math.max(1, Math.ceil(visibleFrames / maxColumns));

    for (var index = startIndex; index < endIndex; index += step) {
      var frame = frames[index];
      var ts = frameTs(frame);
      var nextIndex = Math.min(endIndex - 1, index + step);
      var nextTs = nextIndex > index ? frameTs(frames[nextIndex]) : (index + 1 < count ? frameTs(frames[index + 1]) : ts + emit);
      var x = vp.timeToX(ts);
      var x2 = vp.timeToX(nextTs);
      if (x2 < plot.left || x > plot.left + plot.width) continue; // cull offscreen
      var rectW = Math.max(1, Math.ceil(x2 - x + 0.6));
      var levels = Array.isArray(frame.levels) ? frame.levels : [];
      var tick = Number(frame.tickSize || settings.tickSize || 1);
      if (!Number.isFinite(tick) || tick <= 0) tick = 1;
      var h = Math.max(1, Math.ceil(tick * scaleY) + 1);
      levels.forEach(function (level) {
        var price = Number(level.price);
        if (!Number.isFinite(price) || price < vp.priceMin || price > vp.priceMax) return;
        // Gamma-boost the low end so faint liquidity is still visible.
        var t = Math.pow(clamp01(level.intensity), 0.55);
        var c = viridis(t);
        var alpha = 0.4 + t * 0.58;
        ctx.fillStyle = 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + alpha.toFixed(3) + ')';
        ctx.fillRect(x, vp.priceToY(price) - h / 2, rectW, h);
      });
    }
    return true;
  }

  // ─── Footprint imbalance detection ───
  function imbalanceRatio(buyVol, sellVol, settings) {
    var ratio = Number(settings.imbalanceRatio) || 3.0;
    if (ratio <= 0) ratio = 3.0;
    var maxV = Math.max(buyVol, sellVol);
    var minV = Math.min(buyVol, sellVol);
    if (minV <= 0 && maxV > 0) return Infinity;
    if (minV <= 0) return 0;
    return maxV / minV;
  }

  function stackedImbalanceCount(levels, idx, buyVol, sellVol, settings) {
    var ratio = Number(settings.imbalanceRatio) || 3.0;
    var stack = Number(settings.imbalanceStack) || 3;
    if (stack <= 0) return 0;
    var count = 0;
    if (buyVol > sellVol * ratio) {
      // Bid imbalance — count consecutive bid imbalances going UP
      for (var i = idx - 1; i >= 0 && count < stack; i--) {
        var lv = levels[i];
        var bv = Number(lv.buyVol || 0), sv = Number(lv.sellVol || 0);
        if (bv > sv * ratio) count++;
        else break;
      }
    } else if (sellVol > buyVol * ratio) {
      // Ask imbalance — count consecutive ask imbalances going DOWN
      for (var i = idx + 1; i < levels.length && count < stack; i++) {
        var la = levels[i];
        var bva = Number(la.buyVol || 0), sva = Number(la.sellVol || 0);
        if (sva > bva * ratio) count++;
        else break;
      }
    }
    return count;
  }

  // ── Adaptive Footprint Renderer ─────────────────────────────────────────────
  // 3 modes selon le zoom : small (candle+delta), compact (heatmap sans texte),
  // full (bid/ask + POC + imbalance).
  // Ne force jamais le chart — s'adapte a la place disponible.

  var FP_MODE_SMALL   = 0;
  var FP_MODE_COMPACT = 1;
  var FP_MODE_FULL    = 2;

  function fpMode(barWidth, rowHeight) {
    if (barWidth < 28 || rowHeight < 4) return FP_MODE_SMALL;
    if (barWidth < 65 || rowHeight < 8) return FP_MODE_COMPACT;
    return FP_MODE_FULL;
  }

  // Groupement visuel des ticks quand rowHeight < MIN_ROW_HEIGHT
  function visualTickGroup(tickSize, rowHeight) {
    var MIN_ROW_HEIGHT = 7;
    if (rowHeight >= MIN_ROW_HEIGHT) return 1;
    return Math.max(1, Math.ceil(MIN_ROW_HEIGHT / Math.max(1, rowHeight)));
  }

  function drawAdaptiveFootprint(ctx, vp, plot, candles, settings, overlay) {
    if (!settings || settings.showFootprint === false) return false;
    if (!Array.isArray(candles) || !candles.length) return false;
    var tick = Number(settings.tickSize || 1);
    if (!Number.isFinite(tick) || tick <= 0) tick = 1;

    // --- Compute dimensions from viewport ---
    // barWidth: width of one candle in px
    // rowHeight: px per tick in price space
    var refCandle = candles[Math.floor(candles.length / 2)] || candles[0];
    var cx1 = vp.timeToX(candleStartTs(refCandle));
    var cx2 = vp.timeToX(candleEndTs(refCandle));
    var barWidth = Math.max(3, Math.abs(cx2 - cx1));

    var py1 = vp.priceToY(0);
    var py2 = vp.priceToY(tick);
    var rowHeight = Math.max(0.5, Math.abs(py1 - py2));

    var mode = fpMode(barWidth, rowHeight);
    var tickGroup = visualTickGroup(tick, rowHeight);
    var displayTick = tick * tickGroup;

    // --- Global max volumes for bar scaling (all modes except small) ---
    var globalMaxBuy = 1, globalMaxSell = 1;
    if (mode !== FP_MODE_SMALL) {
      var lo = 0, hi = candles.length - 1;
      while (lo < hi) { var mid = (lo+hi)>>>1; if (candleEndTs(candles[mid]) < vp.timeStart) lo = mid+1; else hi = mid; }
      for (var i = lo; i < candles.length; i++) {
        var c = candles[i];
        if (candleStartTs(c) > vp.timeEnd) break;
        var lvs = Array.isArray(c.levels) ? c.levels : [];
        for (var j = 0; j < lvs.length; j++) {
          var bv = Number(lvs[j].buyVol||0), sv = Number(lvs[j].sellVol||0);
          if (bv > globalMaxBuy) globalMaxBuy = bv;
          if (sv > globalMaxSell) globalMaxSell = sv;
        }
      }
    }

    // --- Iterate candles ---
    var lo2 = 0, hi2 = candles.length - 1;
    while (lo2 < hi2) { var mid2 = (lo2+hi2)>>>1; if (candleEndTs(candles[mid2]) < vp.timeStart) lo2 = mid2+1; else hi2 = mid2; }

    for (var i2 = lo2; i2 < candles.length; i2++) {
      var candle = candles[i2];
      if (candleStartTs(candle) > vp.timeEnd) break;
      var x1 = vp.timeToX(candleStartTs(candle));
      var x2 = vp.timeToX(candleEndTs(candle));
      var fullW = Math.max(3, x2 - x1);
      var bodyWidth = Math.max(3, Math.min(12, fullW * 0.18));
      var xCenter = (x1 + x2) / 2;
      var sideW = (fullW - bodyWidth) / 2;
      var colW = fullW * 0.84;
      var x = xCenter - colW / 2;

      // OHLC coordinates
      var yHigh = vp.priceToY(candle.high);
      var yLow = vp.priceToY(candle.low);
      var yOpen = vp.priceToY(candle.open);
      var yClose = vp.priceToY(candle.close);
      var upHex = (settings && settings.upColor) || '#3ddc97';
      var downHex = (settings && settings.downColor) || '#ff5f73';
      var candleCol = candle.close >= candle.open ? hexToRgba(upHex, 0.92) : hexToRgba(downHex, 0.92);
      var delta = Number(candle.delta || 0);

      // ── MODE SMALL : candle + delta badge ──
      if (mode === FP_MODE_SMALL) {
        // Wick
        ctx.strokeStyle = candleCol;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xCenter, yHigh);
        ctx.lineTo(xCenter, yLow);
        ctx.stroke();
        // Body
        var bodyTop = Math.min(yOpen, yClose);
        var bodyH = Math.max(1, Math.abs(yClose - yOpen));
        ctx.fillStyle = candleCol;
        ctx.fillRect(xCenter - bodyWidth/2, bodyTop, bodyWidth, Math.max(1, bodyH));
        // Delta badge (above candle)
        if (delta !== 0) {
          var dbY = yHigh - 10;
          ctx.fillStyle = delta > 0 ? 'rgba(34,197,94,0.85)' : 'rgba(239,68,68,0.85)';
          ctx.font = '8px JetBrains Mono, monospace';
          ctx.textAlign = 'center';
          ctx.fillText((delta>0?'+':'')+V6OF.format.qty(Math.abs(delta)), xCenter, dbY);
          ctx.textAlign = 'left';
        }
        continue;
      }

      // ── Background column (compact + full) ──
      ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
      ctx.fillRect(x, plot.top, colW, plot.height);

      // ── OHLC body + wick ──
      ctx.strokeStyle = candleCol;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xCenter, yHigh);
      ctx.lineTo(xCenter, yLow);
      ctx.moveTo(xCenter - bodyWidth * 0.4, yOpen);
      ctx.lineTo(xCenter, yOpen);
      ctx.moveTo(xCenter, yClose);
      ctx.lineTo(xCenter + bodyWidth * 0.4, yClose);
      ctx.stroke();

      // ── Levels (compact or full) ──
      var levels = Array.isArray(candle.levels) ? candle.levels : [];
      // Group levels visually if needed
      var grouped = [];
      if (tickGroup > 1 && levels.length) {
        var byBucket = {};
        levels.forEach(function (lv) {
          var price = Number(lv.price);
          if (!Number.isFinite(price)) return;
          var bucket = Math.round(price / displayTick) * displayTick;
          var k = bucket.toFixed(displayTick < 1 ? 2 : 0);
          if (!byBucket[k]) byBucket[k] = { price: bucket, buyVol:0, sellVol:0, delta:0, isPoc: false };
          byBucket[k].buyVol += Number(lv.buyVol||0);
          byBucket[k].sellVol += Number(lv.sellVol||0);
          byBucket[k].delta += Number(lv.delta||0);
          if (Number(candle.poc) === Number(lv.price)) byBucket[k].isPoc = true;
        });
        grouped = Object.values(byBucket).sort(function(a,b){ return b.price - a.price; });
      } else {
        grouped = levels.slice();
      }

      var groupH = tickGroup > 1 ? Math.max(2, rowHeight * tickGroup) : Math.max(4, Math.min(16, rowHeight));
      var halfW = Math.max(1, (colW - 3) / 2);
      var imbalanceColor = Number(settings.imbalanceRatio) || 3.0;

      grouped.forEach(function (level) {
        var buyVol = Number(level.buyVol||0);
        var sellVol = Number(level.sellVol||0);
        if (buyVol <= 0 && sellVol <= 0) return;
        var price = Number(level.price);
        if (!Number.isFinite(price) || price < vp.priceMin || price > vp.priceMax) return;
        var y = vp.priceToY(price);
        var isPoc = level.isPoc || (Number(candle.poc) === price);

        var buyW = Math.max(0, halfW * Math.min(1, buyVol / globalMaxBuy));
        var sellW = Math.max(0, halfW * Math.min(1, sellVol / globalMaxSell));
        var ratio = 0;
        if (buyVol > 0 && sellVol > 0) ratio = Math.max(buyVol, sellVol) / Math.min(buyVol, sellVol);
        else if (buyVol > 0 || sellVol > 0) ratio = Infinity;
        var isBidImb = buyVol > sellVol && ratio >= imbalanceColor;
        var isAskImb = sellVol > buyVol && ratio >= imbalanceColor;

        if (mode === FP_MODE_COMPACT) {
          // Compact: heatmap bars only, no text
          if (buyW > 0.3) {
            ctx.fillStyle = isBidImb ? 'rgba(239,68,68,0.72)' : 'rgba(239,68,68,0.28)';
            ctx.fillRect(x + 1 + halfW - buyW, y - groupH/2, buyW, groupH);
          }
          if (sellW > 0.3) {
            ctx.fillStyle = isAskImb ? 'rgba(34,197,94,0.72)' : 'rgba(34,197,94,0.28)';
            ctx.fillRect(x + 1 + halfW, y - groupH/2, sellW, groupH);
          }
          // POC dot
          if (isPoc) {
            ctx.fillStyle = 'rgba(248,195,93,0.94)';
            ctx.fillRect(xCenter - 2, y - 1.5, 4, 3);
          }
        } else {
          // Full: bid/ask bars + text + POC frame + imbalance
          if (buyW > 0.3) {
            ctx.fillStyle = isBidImb ? 'rgba(239,68,68,0.72)' : 'rgba(239,68,68,0.28)';
            ctx.fillRect(x + 1 + halfW - buyW, y - groupH/2, buyW, groupH);
          }
          if (sellW > 0.3) {
            ctx.fillStyle = isAskImb ? 'rgba(34,197,94,0.72)' : 'rgba(34,197,94,0.28)';
            ctx.fillRect(x + 1 + halfW, y - groupH/2, sellW, groupH);
          }
          // Center separator
          ctx.strokeStyle = 'rgba(148,163,184,0.10)';
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(x + 1 + halfW, y - groupH/2);
          ctx.lineTo(x + 1 + halfW, y + groupH/2);
          ctx.stroke();
          // POC frame
          if (isPoc) {
            ctx.strokeStyle = 'rgba(248,195,93,0.94)';
            ctx.lineWidth = 1.4;
            ctx.strokeRect(x + 1.5, y - groupH/2 + 0.5, colW - 3, groupH - 1);
          }
          // Stacked imbalance
          var stackCount = stackedImbalanceCount(levels, levels.indexOf(level), buyVol, sellVol, settings);
          var stackThresh = Number(settings.imbalanceStack) || 3;
          if (stackCount >= stackThresh - 1 && colW >= 18) {
            ctx.strokeStyle = buyVol > sellVol ? 'rgba(239,68,68,0.55)' : 'rgba(34,197,94,0.55)';
            ctx.lineWidth = 0.8;
            ctx.setLineDash([2, 2]);
            ctx.strokeRect(x + 1.5, y - groupH/2 + 0.5, colW - 3, groupH - 1);
            ctx.setLineDash([]);
          }
          // Delta text
          if (colW >= 40 && groupH >= 9) {
            var lvDelta = Number(level.delta||0);
            ctx.fillStyle = lvDelta > 0 ? 'rgba(34,197,94,0.82)' : lvDelta < 0 ? 'rgba(239,68,68,0.82)' : 'rgba(148,163,184,0.55)';
            ctx.font = '8px JetBrains Mono, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(V6OF.format.signed(lvDelta), x + colW/2, y + 2.5);
            ctx.textAlign = 'left';
          }
        }
      });

      // ── Bottom summary bar ──
      var GUTTER_BOTTOM = 20;
      var summaryY = plot.top + plot.height + 1;
      var summaryH = Math.min(18, GUTTER_BOTTOM - 3);
      if (summaryH >= 10) {
        var cd = Number(candle.delta||0);
        var cv = Number(candle.volume||0);
        var durMs = candleEndTs(candle) - candleStartTs(candle);
        var durSec = Math.round(Math.max(0, durMs) / 1000);
        var durLabel = durSec >= 3600 ? Math.floor(durSec/3600)+'h' : durSec >= 60 ? Math.floor(durSec/60)+'m' : durSec+'s';
        ctx.textAlign = 'center';
        // Delta
        var deltaColor = cd > 0 ? '#22c55e' : cd < 0 ? '#ef4444' : '#94a3b8';
        ctx.fillStyle = deltaColor;
        ctx.font = '8px JetBrains Mono, monospace';
        ctx.fillText((cd>=0?'+':'')+V6OF.format.qty(Math.abs(cd)), xCenter, summaryY + summaryH - 2);
        // Volume (if wide enough)
        if (colW >= 30) {
          ctx.fillStyle = 'rgba(203,213,225,0.62)';
          ctx.fillText(V6OF.format.qty(cv), xCenter, summaryY + 6);
        }
        // Duration
        if (colW >= 48) {
          ctx.fillStyle = 'rgba(148,163,184,0.46)';
          ctx.font = '7px JetBrains Mono, monospace';
          ctx.fillText(durLabel, xCenter, summaryY + summaryH + 1);
        }
        ctx.textAlign = 'left';
      }
    }
    return true;
  }

  // Backward-compat alias
  function drawFootprintVp(ctx, vp, plot, candles, settings, overlay) {
    return drawAdaptiveFootprint(ctx, vp, plot, candles, settings, overlay);
  }

  // Plain candlesticks (base layer) from footprint OHLC, in the viewport space.
  function drawCandlesVp(ctx, vp, plot, candles, settings, state) {
    if (!Array.isArray(candles) || !candles.length) return false;
    var upHex = (settings && settings.upColor) || '#3ddc97';
    var downHex = (settings && settings.downColor) || '#ff5f73';
    var activeOpenTime = Number(state && state.ui && state.ui.activeCandleLocked ? state.ui.activeCandleOpenTime : 0);

    var lo = 0, hi = candles.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >>> 1;
      if (candleEndTs(candles[mid]) < vp.timeStart) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    for (var i = lo; i < candles.length; i++) {
      var c = candles[i];
      if (candleStartTs(c) > vp.timeEnd) break;
      if (!Number.isFinite(c.open) || !Number.isFinite(c.close)) continue;
      var x1 = vp.timeToX(candleStartTs(c));
      var x2 = vp.timeToX(candleEndTs(c));
      var fullW = Math.max(2, x2 - x1);
      var bodyW = Math.max(1, Math.min(28, fullW * 0.6));
      var xc = (x1 + x2) / 2;
      var up = c.close >= c.open;
      var selected = activeOpenTime > 0 && Number(c.openTime || 0) === activeOpenTime;
      var col = selected ? '#facc15' : (up ? upHex : downHex);
      var yOpen = vp.priceToY(c.open);
      var yClose = vp.priceToY(c.close);
      if (c.synthetic) {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xc - Math.max(2, bodyW * 0.35), yClose);
        ctx.lineTo(xc + Math.max(2, bodyW * 0.35), yClose);
        ctx.stroke();
        continue;
      }
      ctx.strokeStyle = hexToRgba(col, 0.96);
      ctx.fillStyle = hexToRgba(col, 0.96);
      ctx.lineWidth = selected ? 1.8 : 1;
      // wick
      ctx.beginPath();
      ctx.moveTo(xc, vp.priceToY(c.high));
      ctx.lineTo(xc, vp.priceToY(c.low));
      ctx.stroke();
      // body
      var top = Math.min(yOpen, yClose);
      var bh = Math.max(1, Math.abs(yClose - yOpen));
      ctx.fillRect(xc - bodyW / 2, top, bodyW, bh);
      if (selected) {
        ctx.strokeStyle = 'rgba(113, 63, 18, 0.92)';
        ctx.strokeRect(xc - bodyW / 2 - 1, top - 1, bodyW + 2, bh + 2);
      }
    }
    return true;
  }

  function moneyShort(v) {
    v = Math.abs(v);
    if (v >= 1e9) return (v / 1e9).toFixed(v >= 1e10 ? 0 : 1) + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K';
    return v.toFixed(0);
  }

  // Volume Bubbles / Trade Pulse: one bubble per candle, radius scaled by the
  // candle's $ notional relative to the largest visible candle, coloured by
  // delta (footprint) or candle direction (backfill kline). Small candles fall
  // below the min radius and are skipped, so only notable volume shows.
  function drawBubblesVp(ctx, vp, plot, candles) {
    if (!Array.isArray(candles) || !candles.length) return;
    var i, c, mid, notional, maxNotional = 0;
    var visible = [];
    var lo = 0, hi = candles.length - 1;
    while (lo < hi) {
      var midIdx = (lo + hi) >>> 1;
      if (candleEndTs(candles[midIdx]) < vp.timeStart) {
        lo = midIdx + 1;
      } else {
        hi = midIdx;
      }
    }
    for (i = lo; i < candles.length; i++) {
      c = candles[i];
      var s = candleStartTs(c), e = candleEndTs(c);
      if (s > vp.timeEnd) break;
      mid = (Number(c.open) + Number(c.close)) / 2;
      if (!Number.isFinite(mid)) mid = Number(c.close);
      notional = (Number(c.volume) || 0) * (Number.isFinite(mid) ? mid : 0);
      if (notional <= 0) continue;
      visible.push({ c: c, mid: mid, notional: notional, s: s, e: e });
      if (notional > maxNotional) maxNotional = notional;
    }
    if (maxNotional <= 0) return;

    // Selective: only the larger candles get a bubble (like ATAS/Tradr). Scale
    // by sqrt of notional relative to the visible max; small ones fall under the
    // min radius and are skipped, keeping the chart readable.
    var maxR = Math.max(10, Math.min(34, plot.width / Math.max(visible.length, 1) * 1.1));
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (i = 0; i < visible.length; i++) {
      var v = visible[i];
      var ratio = v.notional / maxNotional;
      var r = maxR * Math.pow(ratio, 0.7);
      if (r < 7) continue; // auto-threshold: skip minor candles
      var price = Number.isFinite(v.mid) ? v.mid : Number(v.c.close);
      if (!Number.isFinite(price) || price < vp.priceMin || price > vp.priceMax) continue;
      var x = vp.timeToX((v.s + v.e) / 2);
      var y = vp.priceToY(price);
      var delta = Number(v.c.delta);
      var buy = Number.isFinite(delta) ? delta >= 0 : (Number(v.c.close) >= Number(v.c.open));
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = buy ? 'rgba(61, 220, 151, 0.15)' : 'rgba(255, 95, 115, 0.15)';
      ctx.fill();
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = buy ? 'rgba(61, 220, 151, 0.72)' : 'rgba(255, 95, 115, 0.72)';
      ctx.stroke();
      if (r >= 12) {
        ctx.fillStyle = 'rgba(245, 250, 252, 0.96)';
        ctx.font = 'bold ' + (r >= 22 ? 12 : 10) + 'px JetBrains Mono, Consolas, monospace';
        ctx.fillText(moneyShort(v.notional), x, y);
      }
    }
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.restore();
  }

  function drawPriceLineVp(ctx, vp, plot, price, color, label, dash) {
    if (!Number.isFinite(price) || price <= 0) return;
    if (price < vp.priceMin || price > vp.priceMax) return;
    var y = vp.priceToY(price);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash(dash ? [5, 4] : []);
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(plot.left + plot.width, y);
    ctx.stroke();
    ctx.setLineDash([]);
    // label tag in the right gutter
    ctx.fillStyle = color;
    ctx.font = '10px JetBrains Mono, Consolas, monospace';
    ctx.fillText(label, plot.left + plot.width + 5, y - 3);
  }

  // Find the nearest candle to a given time position (binary search).
  function nearestCandleAt(candles, timeMs) {
    if (!Array.isArray(candles) || !candles.length) return null;
    var lo = 0, hi = candles.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >>> 1;
      if (candleStartTs(candles[mid]) < timeMs) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    // Check the found candle and the one before it
    var best = candles[lo];
    var bestDist = Math.abs(candleMidTs(best) - timeMs);
    if (lo > 0) {
      var prev = candles[lo - 1];
      var prevDist = Math.abs(candleMidTs(prev) - timeMs);
      if (prevDist < bestDist) { best = prev; }
    }
    return best;
  }

  function findCandleByOpenTime(candles, openTime) {
    if (!Array.isArray(candles) || !openTime) return null;
    for (var i = 0; i < candles.length; i++) {
      if (candleStartTs(candles[i]) === openTime) return candles[i];
    }
    return null;
  }

  function indexOfCandle(candles, candle) {
    if (!Array.isArray(candles) || !candle) return -1;
    var target = candleStartTs(candle);
    for (var i = 0; i < candles.length; i++) {
      if (candleStartTs(candles[i]) === target) return i;
    }
    return -1;
  }

  function pickCandleAtPoint(canvas, state, x, y) {
    var vp = V6OF.chart;
    if (!canvas || !vp || !vp.plot || !state) return null;
    var plot = vp.plot;
    if (x < plot.left || x > plot.left + plot.width || y < plot.top || y > plot.top + plot.height) {
      return null;
    }
    var candles = mergedChartCandles(state);
    if (!candles.length) return null;
    var candle = nearestCandleAt(candles, vp.xToTime(x));
    if (!candle) return null;
    return {
      candle: candle,
      index: indexOfCandle(candles, candle),
      source: candle.source || (Array.isArray(candle.levels) && candle.levels.length ? 'footprint' : 'chart')
    };
  }

  function drawActiveCandleVp(ctx, vp, plot, candles, state) {
    var ui = state && state.ui ? state.ui : {};
    var locked = !!ui.activeCandleLocked;
    if (!locked) return; // Only draw when clicked/locked!

    var openTime = Number(ui.activeCandleOpenTime || 0);
    if (!Number.isFinite(openTime) || openTime <= 0) return;
    var candle = findCandleByOpenTime(candles, openTime);
    if (!candle) return;
    var x1 = vp.timeToX(candleStartTs(candle));
    var x2 = vp.timeToX(candleEndTs(candle));
    if (x2 < plot.left || x1 > plot.left + plot.width) return;
    x1 = Math.max(plot.left, x1);
    x2 = Math.min(plot.left + plot.width, x2);
    var w = Math.max(3, x2 - x1);
    ctx.save();
    ctx.fillStyle = 'rgba(8, 145, 178, 0.12)';
    ctx.fillRect(x1, plot.top, w, plot.height);
    ctx.strokeStyle = 'rgba(8, 145, 178, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x1 + 0.5, plot.top + 0.5, Math.max(1, w - 1), Math.max(1, plot.height - 1));
    ctx.restore();
  }

  function drawCrosshairTooltip(ctx, x, y, vp, plot, candle) {
    if (!candle) return;
    var isUp = candle.close >= candle.open;
    var col = isUp ? '#22c55e' : '#ef4444';
    var lines = [
      'O ' + V6OF.format.price(candle.open) + '  H ' + V6OF.format.price(candle.high),
      'L ' + V6OF.format.price(candle.low) + '  C ' + V6OF.format.price(candle.close),
      'Vol ' + V6OF.format.qty(candle.volume || 0)
    ];
    if (Number.isFinite(candle.delta)) {
      var d = Number(candle.delta);
      lines.push('Δ ' + (d >= 0 ? '+' : '') + d.toFixed(1));
    }
    if (candle.priceOnly) {
      lines.push('Price-only REST');
    }
    var lh = 15;
    var pw = candle.priceOnly ? 174 : 156, ph = 4 + lines.length * lh + 6;
    var px = x + 14;
    var py = y - ph / 2;
    // Keep tooltip inside the plot bounds
    if (px + pw > plot.left + plot.width) px = x - pw - 14;
    if (py < plot.top) py = plot.top + 4;
    if (py + ph > plot.top + plot.height) py = plot.top + plot.height - ph - 4;

    ctx.save();
    ctx.fillStyle = 'rgba(8, 11, 18, 0.94)';
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, pw, ph);
    ctx.fillStyle = 'rgba(226, 232, 240, 0.96)';
    ctx.font = 'bold 10px JetBrains Mono, Consolas, monospace';
    lines.forEach(function (line, i) {
      ctx.fillText(line, px + 8, py + 4 + i * lh + lh - 4);
    });
    ctx.restore();
  }

  function drawCrosshair(ctx, vp, plot, candles) {
    var cross = V6OF.chartCrosshair;
    if (!cross || !cross.visible || !cross.enabled) return;
    var x = cross.x;
    var y = cross.y;

    // Snap to nearest candle (time axis only) if candles are available.
    var snappedX = x;
    var snappedCandle = null;
    if (Array.isArray(candles) && candles.length) {
      var mouseTime = vp.xToTime(x);
      snappedCandle = nearestCandleAt(candles, mouseTime);
      if (snappedCandle) {
        snappedX = vp.timeToX(candleMidTs(snappedCandle));
      }
    }
    
    if (snappedX < plot.left || snappedX > plot.left + plot.width) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    
    // Vertical line (snapped to candle center — always drawn)
    ctx.beginPath();
    ctx.moveTo(snappedX, plot.top);
    ctx.lineTo(snappedX, plot.top + plot.height);
    ctx.stroke();

    // Horizontal line & Price readout (only when hovering on the chart area)
    if (cross.hoveringSource === 'chart' && Number.isFinite(y) && y >= plot.top && y <= plot.top + plot.height) {
      ctx.beginPath();
      ctx.moveTo(plot.left, y);
      ctx.lineTo(plot.left + plot.width, y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Price readout (right gutter)
      var price = vp.yToPrice(y);
      var priceText = V6OF.format.price(price);
      ctx.fillStyle = 'rgba(56, 211, 238, 0.95)';
      ctx.fillRect(plot.left + plot.width, y - 8, GUTTER_RIGHT, 16);
      ctx.fillStyle = '#04121a';
      ctx.font = 'bold 10px JetBrains Mono, Consolas, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(priceText, plot.left + plot.width + 5, y + 3);
    } else {
      ctx.setLineDash([]);
    }

    // Time readout (bottom axis) — snapped to candle time
    // Toujours afficher la date (DD Mon HH:MM:SS) pour savoir exactement
    // quel jour on survole, même sur un viewport < 24h.
    var snappedTs = vp.xToTime(snappedX);
    var timeText = V6OF.timeAxisDate(snappedTs) + ' ' + timeAxisLabel(snappedTs, 1000);
    var tw = 130;
    ctx.fillStyle = 'rgba(56, 211, 238, 0.95)';
    ctx.fillRect(snappedX - tw / 2, plot.top + plot.height, tw, GUTTER_BOTTOM - 2);
    ctx.fillStyle = '#04121a';
    ctx.font = 'bold 9px JetBrains Mono, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(timeText, snappedX, plot.top + plot.height + 15);
    ctx.restore();

    // Tooltip disabled — user doesn't want the OHLC rectangle
    // if (cross.hoveringSource === 'chart') {
    //   drawCrosshairTooltip(ctx, snappedX, y, vp, plot, snappedCandle);
    // }
  }

  function drawLiveInfo(ctx, vp, plot, state, settings) {
    settings = settings || {};
    var layers = [];
    if (settings.showCandles !== false) layers.push('Candles');
    if (settings.showHeatmap === true) layers.push('Heatmap');
    if (settings.showFootprint === true) layers.push('Footprint');
    var modeLabel = layers.length ? layers.join(' + ') : 'No layers';

    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(203, 213, 225, 0.70)';
    ctx.font = '10px JetBrains Mono, Consolas, monospace';
    ctx.fillText((state.symbol || 'BTC') + '  ' + modeLabel, plot.left, 14);

    // Follow-live state badge / button
    var follow = !!vp.followLive;
    if (follow) {
      ctx.font = 'bold 9px JetBrains Mono, Consolas, monospace';
      ctx.fillStyle = 'rgba(69, 209, 143, 0.85)';
      ctx.fillText('LIVE', plot.left + 138, 14);
      V6OF._followLiveBtn = null;
    } else {
      // Clickable pill button to re-enter live mode
      var btnW = 54, btnH = 18, btnX = plot.left + plot.width - btnW - 8, btnY = 4;
      ctx.fillStyle = 'rgba(245, 158, 11, 0.10)';
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.42)';
      ctx.lineWidth = 1;
      roundRect(ctx, btnX, btnY, btnW, btnH, 4);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(245, 158, 11, 0.86)';
      ctx.font = 'bold 9px JetBrains Mono, Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('GO LIVE', btnX + btnW / 2, btnY + 12);
      ctx.textAlign = 'left';
      V6OF._followLiveBtn = { x: btnX, y: btnY, w: btnW, h: btnH };
    }

    if (state.isStale) {
      ctx.fillStyle = 'rgba(239, 99, 117, 0.86)';
      ctx.font = 'bold 10px JetBrains Mono, Consolas, monospace';
      ctx.fillText('STALE', plot.left + plot.width - 56, 14);
    }
  }

  function drawNonePlaceholder(ctx, setup, state) {
    var width = setup.width;
    var height = setup.height;
    var heatmapFrames = state && Array.isArray(state.heatmapFrames) ? state.heatmapFrames : [];
    var footprintCandles = state && Array.isArray(state.footprintCandles) ? state.footprintCandles : [];
    var vwap = state && state.vwap;
    var book = state && state.orderBook;
    var mid = book ? book.mid : 0;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = (state.settings && state.settings.bgColor) || '#080b12';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.06)';
    ctx.lineWidth = 1;
    for (var gx = 0; gx < width; gx += 60) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, height); ctx.stroke(); }
    for (var gy = 0; gy < height; gy += 40) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(width, gy); ctx.stroke(); }

    var cx = width / 2;
    var cy = height / 2 - 40;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(226, 232, 240, 0.72)';
    ctx.font = 'bold 14px Inter, system-ui, sans-serif';
    ctx.fillText('Chart Mode: None', cx, cy);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.72)';
    ctx.font = '12px JetBrains Mono, Consolas, monospace';
    ctx.fillText(state.symbol || 'BTC', cx, cy + 28);
    ctx.font = '11px JetBrains Mono, Consolas, monospace';
    ctx.fillText('Mid: ' + V6OF.format.price(mid), cx, cy + 50);
    ctx.fillText('Heatmap frames: ' + heatmapFrames.length, cx, cy + 68);
    ctx.fillText('Footprint candles: ' + footprintCandles.length, cx, cy + 86);
    if (vwap && Number.isFinite(vwap.value)) {
      ctx.fillStyle = vwap.isWarm ? 'rgba(245, 158, 11, 0.82)' : 'rgba(245, 158, 11, 0.55)';
      ctx.fillText('VWAP: ' + V6OF.format.price(vwap.value) + (vwap.isWarm ? '' : '  (not warm)'), cx, cy + 106);
    }
    if (state && state.isStale) {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.85)';
      ctx.font = 'bold 12px JetBrains Mono, Consolas, monospace';
      ctx.fillText('⚠ STALE — no data received', cx, cy + 130);
    }
    ctx.textAlign = 'left';
  }

  function drawWaiting(ctx, state) {
    ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
    ctx.font = '13px Inter, system-ui, sans-serif';
    ctx.fillText('Not available', 18, 32);
  }

  function drawLive(ctx, setup, state) {
    var width = setup.width;
    var height = setup.height;
    var settings = (state && state.settings) || {};
    var heatmapFrames = Array.isArray(state.heatmapFrames) ? state.heatmapFrames : [];
    var footprintCandles = Array.isArray(state.footprintCandles) ? state.footprintCandles : [];
    var baseCandles = mergedChartCandles(state);

    // Independent layers (TradingView/ATAS model): candles are the base,
    // heatmap is an optional background, footprint is an optional cell overlay.
    var showHeatmap = settings.showHeatmap === true || (settings.chartMode === 'heatmap');
    var showFootprint = settings.showFootprint === true || (settings.chartMode === 'footprint');
    var showCandles = settings.showCandles !== false && settings.chartMode !== 'footprint';  // footprint-only = no candles underneath

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = settings.bgColor || '#080b12';
    ctx.fillRect(0, 0, width, height);

    var bounds = computeLiveBounds(state, showHeatmap);
    // Pass candle interval so the viewport can compute a candle-count-based
    // initial span (e.g. 80 candles for any timeframe).
    // Use the selected timeframe string FIRST (always correct for viewport sizing),
    // fall back to gap between last two candles if parsing fails.
    bounds.candleIntervalMs = timeframeToMs(state.timeframe) ||
      (baseCandles.length >= 2 ? Math.max(1000,
        candleStartTs(baseCandles[baseCandles.length - 1]) -
        candleStartTs(baseCandles[baseCandles.length - 2])) : 60000);
    var haveData = baseCandles.length || (showHeatmap && heatmapFrames.length);
    if (!haveData || (bounds.timeMax == null && bounds.priceMax == null)) {
      drawWaiting(ctx, state);
      return;
    }

    // Viewport: persist across frames so pan/zoom survive redraws.
    var vp = V6OF.chart || (V6OF.chart = V6OF.ChartViewport.create());
    var plot = {
      left: PAD_LEFT,
      top: PAD_TOP,
      width: Math.max(1, width - PAD_LEFT - GUTTER_RIGHT),
      height: Math.max(1, height - PAD_TOP - GUTTER_BOTTOM)
    };
    vp.setPlot(plot);
    vp.syncToData(bounds);
    // Re-fit the price axis to the candles actually visible in the time window.
    if (vp.autoFit && baseCandles.length) {
      var visRange = visiblePriceRange(baseCandles, vp, state, showHeatmap);
      if (visRange) { vp.priceMin = visRange.min; vp.priceMax = visRange.max; }
    }

    drawGridAndScales(ctx, vp, plot, settings);

    // Data layers (clipped to the plot rect): heatmap behind, candles, then
    // footprint cells as an overlay so the candlesticks stay readable.
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.left, plot.top, plot.width, plot.height);
    ctx.clip();
    if (showHeatmap) drawHeatmapVp(ctx, vp, plot, heatmapFrames, settings);
    // Bubbles behind candles so they don't obscure price action
    if (false && settings.showBubbles === true) {
      drawBubblesVp(ctx, vp, plot, baseCandles);
    }
    if (showCandles && baseCandles.length) drawCandlesVp(ctx, vp, plot, baseCandles, settings, state);
    if (showFootprint && footprintCandles.length) {
      drawFootprintVp(ctx, vp, plot, footprintCandles, settings, showCandles);
    }
    ctx.restore();

    // ── Indicator overlays (EMA, SMA, Bollinger, etc.) ──
    if (V6OF.Indicators && V6OF.Indicators.drawAll) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(plot.left, plot.top, plot.width, plot.height);
      ctx.clip();
      V6OF.Indicators.drawAll(ctx, vp, plot, state, baseCandles);
      ctx.restore();
    }

    // Reference price lines (mid / bid / ask / poc / vwap)
    var lastFrame = heatmapFrames.length ? heatmapFrames[heatmapFrames.length - 1] : null;
    var lastCandle = footprintCandles.length ? footprintCandles[footprintCandles.length - 1] : null;
    var book = state.orderBook;
    var mid = book && Number.isFinite(book.mid) ? book.mid : (lastFrame ? lastFrame.mid : NaN);
    var bestBid = book && Number.isFinite(book.bestBid) ? book.bestBid : (lastFrame ? lastFrame.bestBid : NaN);
    var bestAsk = book && Number.isFinite(book.bestAsk) ? book.bestAsk : (lastFrame ? lastFrame.bestAsk : NaN);
    // MID removed — keep chart clean
    // drawPriceLineVp(ctx, vp, plot, Number(mid), 'rgba(56, 211, 238, 0.92)', 'MID', false);
    // BID / ASK removed — keep chart clean
    // drawPriceLineVp(ctx, vp, plot, Number(bestBid), 'rgba(61, 220, 151, 0.86)', 'BID', true);
    // drawPriceLineVp(ctx, vp, plot, Number(bestAsk), 'rgba(255, 95, 115, 0.86)', 'ASK', true);
    // Last price marker (current price) — dashed, anchored to price axis
    if (settings.showLastPrice !== false) {
      var lastPrice = 0;
      var trades = state.trades || [];
      if (trades.length) {
        var last = trades[0];
        if (Number.isFinite(last.price)) lastPrice = last.price;
      }
      if (!lastPrice && Number.isFinite(mid)) lastPrice = mid;
      if (lastPrice && Number.isFinite(lastPrice) && lastPrice >= vp.priceMin && lastPrice <= vp.priceMax) {
        var lastY = vp.priceToY(lastPrice);
        
        // Dotted line spanning chart (up to the price axis)
        ctx.save();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([1, 2]);
        ctx.beginPath();
        ctx.moveTo(plot.left, lastY);
        ctx.lineTo(plot.left + plot.width, lastY);
        ctx.stroke();
        ctx.restore();

        // Price scale badge (right gutter)
        var gx = plot.left + plot.width;
        var badgeH = 32;
        var badgeY = lastY - badgeH / 2;

        ctx.save();
        // Badge Background: Pitch black matching the dark theme
        ctx.fillStyle = '#000000';
        roundRect(ctx, gx + 1, badgeY, GUTTER_RIGHT - 2, badgeH, 3);
        ctx.fill();

        // Subtle borders to give it a premium finish
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Set alignment and text settings
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // 1. Bold price label in white
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px JetBrains Mono, Consolas, monospace';
        ctx.fillText(V6OF.format.price(lastPrice), gx + GUTTER_RIGHT / 2, lastY - 6);

        // 2. Countdown label below price in slate gray
        var countdownText = '00:00';
        if (baseCandles && baseCandles.length) {
          var lastCandleObj = baseCandles[baseCandles.length - 1];
          var closeTime = candleEndTs(lastCandleObj);
          var nowMs = window.BtcMarketClock ? window.BtcMarketClock.now() : Date.now();
          var ms = Math.max(0, closeTime - nowMs);
          countdownText = formatCountdown(ms);
        }
        ctx.fillStyle = '#94a3b8';
        ctx.font = '10px JetBrains Mono, Consolas, monospace';
        ctx.fillText(countdownText, gx + GUTTER_RIGHT / 2, lastY + 7);

        ctx.restore();
      }
    }
    if (false && showFootprint && lastCandle) drawPriceLineVp(ctx, vp, plot, Number(lastCandle.poc), 'rgba(248, 195, 93, 0.94)', 'POC', true);
    // VWAP removed — keep chart clean
    // if (settings.showVwap !== false && state.vwap && Number.isFinite(state.vwap.value)) {
    //   drawPriceLineVp(ctx, vp, plot, Number(state.vwap.value),
    //     state.vwap.isWarm ? 'rgba(245, 158, 11, 0.92)' : 'rgba(245, 158, 11, 0.6)', 'VWAP', true);
    // }

    // Selection is shown by coloring the selected candle yellow in drawCandlesVp.
    drawCrosshair(ctx, vp, plot, baseCandles);
    V6OF._followLiveBtn = null;
  }

  function internalDraw(canvas, state) {
    var perfStart = window.performance ? performance.now() : 0;
    var setup = setupCanvas(canvas);
    if (!setup) return;
    var ctx = setup.ctx;
    var width = setup.width;
    var height = setup.height;
    // Live-only: always render the live chart engine. No mock path.
    drawLive(ctx, setup, state || {});
    recordPerf('chart', perfStart);
  }

  V6OF.CanvasChart = {
    draw: function (canvas, state) {
      if (!canvas) return;
      if (state) canvas._v6PendingState = state;
      if (canvas._v6DrawQueued) return;
      canvas._v6DrawQueued = true;
      var schedule = typeof requestAnimationFrame === 'function' && !document.hidden
        ? requestAnimationFrame
        : function (fn) { return setTimeout(fn, 33); };
      schedule(function () {
        canvas._v6DrawQueued = false;
        internalDraw(canvas, canvas._v6PendingState);
      });
    },
    pickCandle: function (canvas, state, x, y) {
      return pickCandleAtPoint(canvas, state || {}, x, y);
    },
    // Exposed so snapTimeToCandle in interactions.js uses the same
    // merged candle array as the chart renderer, preventing crosshair
    // from snapping to 1m footprint candles on higher timeframes.
    mergedCandles: mergedChartCandles
  };

  // Periodic ticker to refresh the canvas chart every 1s for the countdown clock
  setInterval(function () {
    var canvas = document.querySelector('[data-v6-chart]');
    if (canvas && canvas._v6PendingState) {
      if (canvas.offsetWidth > 0 && canvas.offsetHeight > 0) {
        V6OF.CanvasChart.draw(canvas);
      }
    }
  }, 1000);

  function bootV6Orderflow() {
    var root = document.getElementById('v6-orderflow-root');
    if (!root || !V6OF.Layout || typeof V6OF.Layout.init !== 'function') return;
    V6OF.Layout.init(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootV6Orderflow);
  } else {
    setTimeout(bootV6Orderflow, 0);
  }
})();
