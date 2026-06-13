// ---------- 077_v6_canvas_chart.js ----------
// Canvas chart engine: price scale (right), time scale (bottom), grid, crosshair,
// pan/zoom via V6OF.chart (ChartViewport). Heatmap SD + Footprint render in shared
// time/price space.
// The mock path (index-based candles) is preserved unchanged below.

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

  // Layout tokens — source unique dans le CSS (084_v6_exocharts_clean.css).
  // Lus au runtime pour rester synchronises avec le design system.
  function _readLayoutToken(name, fallback) {
    try {
      var el = document.getElementById('v6-orderflow-root') || document.body;
      var v = window.getComputedStyle(el).getPropertyValue(name).trim();
      if (v && v !== '') { var px = parseFloat(v); if (Number.isFinite(px)) return px; }
    } catch (e) { /* DOM pas encore pret, fallback */ }
    return fallback;
  }
  var GUTTER_RIGHT  = _readLayoutToken('--exo-gutter-right', 66);
  var GUTTER_BOTTOM = _readLayoutToken('--exo-gutter-bottom', 24);
  var PAD_TOP       = _readLayoutToken('--exo-pad-top', 22);
  var PAD_LEFT = 8;
  var DEFAULT_EMIT_MS = 500;
  var RENDER_WINDOW_PAD_RATIO = 0.35;
  var MAX_RENDER_CANDLES = 1800;
  var MAX_RENDER_FOOTPRINTS = 1400;

  // Pre-built 8×8 diagonal hatch pattern for synthetic (gap-fill) candles.
  // Replaces the per-frame stroke loop at drawCandlesVp.
  var _synthPatternCanvas = null;
  function _ensureSynthPattern() {
    if (_synthPatternCanvas) return _synthPatternCanvas;
    var pc = document.createElement('canvas');
    pc.width = 8; pc.height = 8;
    var pctx = pc.getContext('2d');
    pctx.strokeStyle = 'rgba(148, 163, 184, 0.32)';
    pctx.lineWidth = 1;
    pctx.beginPath();
    pctx.moveTo(0, 8);
    pctx.lineTo(8, 0);
    pctx.stroke();
    _synthPatternCanvas = pc;
    return pc;
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

  // Snap a text anchor point to the device-pixel grid so glyphs render crisp
  // at any devicePixelRatio (avoids sub-pixel blur on fractional CSS coords).
  function snapTextPos(x, y) {
    var dpr = window.devicePixelRatio || 1;
    return {
      x: Math.round(x * dpr) / dpr,
      y: Math.round(y * dpr) / dpr
    };
  }

  // Rounded rectangle path — native ctx.roundRect() when available, manual arcTo fallback.
  var roundRect = (typeof CanvasRenderingContext2D !== 'undefined'
    && CanvasRenderingContext2D.prototype.roundRect)
    ? function (ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
      }
    : function (ctx, x, y, w, h, r) {
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
      };

  function updateCanvasSizeCache(canvas, width, height) {
    if (!canvas) return null;
    width = Math.max(1, Number(width) || 1);
    height = Math.max(1, Number(height) || 1);
    canvas._v6SizeCache = { width: width, height: height };
    return canvas._v6SizeCache;
  }

  function ensureCanvasSizeObserver(canvas) {
    if (!canvas || canvas._v6SizeObserverBound) return;
    canvas._v6SizeObserverBound = true;
    if (typeof ResizeObserver === 'function') {
      canvas._v6SizeObserver = new ResizeObserver(function (entries) {
        var entry = entries && entries[0];
        var box = entry && entry.contentRect;
        if (box) updateCanvasSizeCache(canvas, box.width, box.height);
      });
      canvas._v6SizeObserver.observe(canvas);
    }
  }

  function getCanvasCachedSize(canvas) {
    ensureCanvasSizeObserver(canvas);
    var cached = canvas._v6SizeCache;
    if (cached && cached.width > 0 && cached.height > 0) return cached;
    return updateCanvasSizeCache(canvas, canvas.clientWidth || 1, canvas.clientHeight || 1);
  }

  function setupCanvas(canvas) {
    if (!canvas) return null;
    var size = getCanvasCachedSize(canvas);
    var width = size.width;
    var height = size.height;
    var dpr = window.devicePixelRatio || 1;
    canvas._v6LastDpr = dpr;
    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, width: width, height: height };
  }

  function chartLayerCanvas(canvas, name) {
    if (!canvas) return null;
    if (name === 'overlay') return canvas;
    var stack = canvas.closest && canvas.closest('[data-v6-chart-stack]');
    return stack && stack.querySelector ? stack.querySelector('[data-v6-chart-layer="' + name + '"]') : null;
  }

  function setupChartLayers(canvas) {
    var overlay = setupCanvas(canvas);
    if (!overlay) return null;
    var staticCanvas = chartLayerCanvas(canvas, 'static');
    var dataCanvas = chartLayerCanvas(canvas, 'data');
    var staticSetup = staticCanvas ? setupCanvas(staticCanvas) : overlay;
    var dataSetup = dataCanvas ? setupCanvas(dataCanvas) : overlay;
    return {
      width: overlay.width,
      height: overlay.height,
      overlay: overlay,
      data: dataSetup,
      statik: staticSetup
    };
  }

  // ===================================================================
  // LIVE CHART ENGINE â€” viewport-based time/price space
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
    var totalGaps = 0;      // all gaps detected (before cap)
    var truncated = false;  // true if cap was hit
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
          var gapCandles = Math.round(gap / intervalMs) - 1;
          totalGaps += gapCandles;
          while (nextOpen < currentStart - intervalMs * 0.5) {
            if (syntheticCount >= maxSynthetic) { truncated = true; break; }
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
    V6OF.chartGapFill = { count: syntheticCount, totalGaps: totalGaps, truncated: truncated, updatedAt: Date.now() };
    if (truncated) {
      console.warn('fillCandleGaps: capped at ' + maxSynthetic + ' synthetics, ' + totalGaps + ' gaps total — data may have holes');
    }
    return out;
  }

  function mergeFootprintLevels(target, source) {
    target = target || {};
    (Array.isArray(source) ? source : []).forEach(function (lv) {
      var price = Number(lv && lv.price);
      if (!Number.isFinite(price)) return;
      var key = String(price);
      var cur = target[key] || { price: price, buyVol: 0, sellVol: 0, delta: 0, totalVol: 0, trades: 0 };
      var buy = Number(lv.buyVol || 0);
      var sell = Number(lv.sellVol || 0);
      var total = Number(lv.totalVol);
      cur.buyVol += Number.isFinite(buy) ? buy : 0;
      cur.sellVol += Number.isFinite(sell) ? sell : 0;
      cur.totalVol += Number.isFinite(total) ? total : ((Number.isFinite(buy) ? buy : 0) + (Number.isFinite(sell) ? sell : 0));
      cur.delta = cur.buyVol - cur.sellVol;
      cur.trades += Number(lv.trades || 0) || 0;
      target[key] = cur;
    });
    return target;
  }

  function aggregateFootprintsToTimeframe(footprints, tf) {
    var interval = timeframeToMs(tf);
    if (!interval || interval <= 60000) return Array.isArray(footprints) ? footprints : [];
    var buckets = {};
    (Array.isArray(footprints) ? footprints : []).forEach(function (fp) {
      var openTime = candleStartTs(fp);
      if (!openTime) return;
      var bucketOpen = Math.floor(openTime / interval) * interval;
      var close = Number(fp.close);
      var high = Number(fp.high);
      var low = Number(fp.low);
      var volume = Number(fp.volume || fp.totalVol || 0) || 0;
      var buyVol = Number(fp.buyVol || 0) || 0;
      var sellVol = Number(fp.sellVol || 0) || 0;
      var bucket = buckets[bucketOpen];
      if (!bucket) {
        bucket = {
          exchange: fp.exchange || '',
          symbol: fp.symbol || '',
          intervalMs: interval,
          openTime: bucketOpen,
          closeTime: bucketOpen + interval - 1,
          open: Number(fp.open),
          high: Number.isFinite(high) ? high : close,
          low: Number.isFinite(low) ? low : close,
          close: close,
          volume: 0,
          buyVol: 0,
          sellVol: 0,
          delta: 0,
          closed: false,
          source: 'live-aggregate',
          analyticsSource: 'live-footprint-aggregate',
          tsLocal: Number(fp.tsLocal || 0) || Date.now(),
          _lastSourceOpenTime: openTime,
          _levelsByPrice: {}
        };
        if (!Number.isFinite(bucket.open)) bucket.open = close;
        buckets[bucketOpen] = bucket;
      }
      if (Number.isFinite(high)) bucket.high = Math.max(bucket.high, high);
      if (Number.isFinite(low)) bucket.low = Math.min(bucket.low, low);
      if (openTime >= bucket._lastSourceOpenTime) {
        bucket.close = close;
        bucket._lastSourceOpenTime = openTime;
      }
      bucket.volume += volume;
      bucket.buyVol += buyVol;
      bucket.sellVol += sellVol;
      bucket.delta = bucket.buyVol - bucket.sellVol;
      bucket.tsLocal = Math.max(bucket.tsLocal || 0, Number(fp.tsLocal || 0) || 0);
      bucket.closed = bucket.closed && fp.closed === true;
      mergeFootprintLevels(bucket._levelsByPrice, fp.levels);
    });
    return Object.keys(buckets).map(Number).sort(function (a, b) { return a - b; }).map(function (key) {
      var bucket = buckets[key];
      bucket.levels = Object.keys(bucket._levelsByPrice).map(function (priceKey) { return bucket._levelsByPrice[priceKey]; })
        .sort(function (a, b) { return b.price - a.price; });
      delete bucket._levelsByPrice;
      delete bucket._lastSourceOpenTime;
      return bucket;
    });
  }

  // Graft footprint analytics (levels, delta, buy/sell volume) onto an
  // authoritative history kline without touching its OHLC.
  function graftFootprintOntoKline(hist, live) {
    var merged = {};
    for (var k in hist) { if (Object.prototype.hasOwnProperty.call(hist, k)) merged[k] = hist[k]; }
    if (Array.isArray(live.levels) && live.levels.length) merged.levels = live.levels;
    if (Number.isFinite(Number(live.buyVol))) merged.buyVol = Number(live.buyVol);
    if (Number.isFinite(Number(live.sellVol))) merged.sellVol = Number(live.sellVol);
    if (Number.isFinite(Number(live.delta))) merged.delta = Number(live.delta);
    if (Number.isFinite(Number(live.poc))) merged.poc = Number(live.poc);
    return merged;
  }

  function resolveHistoryLiveCandle(hist, live, lastHistOpen) {
    if (!hist) return live;
    if (!live) return hist;
    if (Number(live.openTime) >= lastHistOpen || live.closed === false) {
      var forming = graftFootprintOntoKline(live, live);
      var lh = Number(live.high), ll = Number(live.low);
      var hh = Number(hist.high), hl = Number(hist.low);
      if (Number.isFinite(hh)) forming.high = Number.isFinite(lh) ? Math.max(lh, hh) : hh;
      if (Number.isFinite(hl)) forming.low = Number.isFinite(ll) ? Math.min(ll, hl) : hl;
      if (Number.isFinite(Number(hist.open))) forming.open = Number(hist.open);
      return forming;
    }
    var histRange = Math.abs(Number(hist.high) - Number(hist.low));
    var liveRange = Math.abs(Number(live.high) - Number(live.low));
    var histVol = Number(hist.volume) || 0;
    var liveVol = Number(live.volume) || 0;
    var liveComplete = Number.isFinite(liveRange) && Number.isFinite(histRange) &&
      liveRange >= histRange * 0.5 && (histVol <= 0 || liveVol >= histVol * 0.5);
    return liveComplete ? live : graftFootprintOntoKline(hist, live);
  }

  function mergeCandlesByOpenTime(history, liveCandles, tf) {
    history = Array.isArray(history) ? history : [];
    liveCandles = Array.isArray(liveCandles) ? liveCandles : [];
    if (!history.length) return liveCandles;
    if (!liveCandles.length) return history;
    var out = [];
    var i = 0;
    var j = 0;
    var lastHistOpen = Number(history[history.length - 1] && history[history.length - 1].openTime) || 0;
    while (i < history.length && j < liveCandles.length) {
      var hist = history[i];
      var live = liveCandles[j];
      var ht = Number(hist && hist.openTime);
      var lt = Number(live && live.openTime);
      if (ht === lt) {
        out.push(resolveHistoryLiveCandle(hist, live, lastHistOpen));
        i++;
        j++;
      } else if (!Number.isFinite(lt) || (Number.isFinite(ht) && ht < lt)) {
        out.push(hist);
        i++;
      } else {
        out.push(live);
        j++;
      }
    }
    while (i < history.length) out.push(history[i++]);
    while (j < liveCandles.length) out.push(liveCandles[j++]);
    var interval = timeframeToMs(tf) || (out.length ? normalizeCandleInterval(out[out.length - 1], 60000) : 60000);
    return fillCandleGaps(out, interval);
  }

  // Convert hex color (#3ddc97) to rgba string with alpha
  function hexToRgba(hex, alpha) {
    if (!hex || hex.length < 7) return 'rgba(61,220,151,' + alpha + ')';
    var r = parseInt(hex.slice(1, 3), 16) || 0;
    var g = parseInt(hex.slice(3, 5), 16) || 0;
    var b = parseInt(hex.slice(5, 7), 16) || 0;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  // Pre-computed candle palette — avoids hexToRgba per candle per frame.
  // Recomputed only when upColor/downColor settings change.
  var _paletteCache = null;
  var _paletteSig = '';

  function getCandlePalette(settings) {
    var up = (settings && settings.upColor) || '#3ddc97';
    var down = (settings && settings.downColor) || '#ff5f73';
    var sig = up + '|' + down;
    if (_paletteCache && _paletteSig === sig) return _paletteCache;
    _paletteCache = {
      up: hexToRgba(up, 0.96),
      down: hexToRgba(down, 0.96),
      selected: hexToRgba('#facc15', 0.96)
    };
    _paletteSig = sig;
    return _paletteCache;
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
  var _mergedCandlesSig = '';
  var _mergedCandlesVersion = -1;
  var _aggregatedFpSrc = null;
  var _aggregatedFpTf = '';
  var _aggregatedFpCache = null;
  var _boundsCache = null;
  var _boundsSrcFrames = null;
  var _boundsSrcCandles = null;
  var _boundsSrcHeatmap = null;
  var _boundsVersion = -1;
  var _heatmapBoundsCache = null;
  var _heatmapBoundsFirst = null;
  var _heatmapBoundsLast = null;
  var _heatmapBoundsLen = 0;

  function candleListSignature(list) {
    if (!Array.isArray(list) || !list.length) return '0';
    var first = list[0] || {};
    var last = list[list.length - 1] || {};
    return [
      list.length,
      candleStartTs(first),
      candleStartTs(last),
      candleEndTs(last),
      Number(last.tsLocal || last.tsExchange || last.updatedAt || 0) || 0,
      Number(last.volume || last.totalVol || 0) || 0,
      Number(last.close || 0) || 0
    ].join(':');
  }

  function aggregateFootprintsToTimeframeCached(footprints, tf) {
    if (tf === '1m') return Array.isArray(footprints) ? footprints : [];
    if (_aggregatedFpCache && _aggregatedFpSrc === footprints && _aggregatedFpTf === tf) {
      return _aggregatedFpCache;
    }
    _aggregatedFpCache = aggregateFootprintsToTimeframe(footprints, tf);
    _aggregatedFpSrc = footprints;
    _aggregatedFpTf = tf;
    return _aggregatedFpCache;
  }

  function lowerBoundByTime(list, target, timeFn) {
    list = Array.isArray(list) ? list : [];
    var lo = 0;
    var hi = list.length;
    while (lo < hi) {
      var mid = (lo + hi) >>> 1;
      if (timeFn(list[mid]) < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  function sliceByTimeWindow(list, start, end, startFn, endFn, maxItems) {
    list = Array.isArray(list) ? list : [];
    if (!list.length) return [];
    startFn = startFn || candleStartTs;
    endFn = endFn || startFn;
    var first = Math.max(0, lowerBoundByTime(list, start, endFn) - 1);
    var out = [];
    for (var i = first; i < list.length; i++) {
      var item = list[i];
      var s = startFn(item);
      if (s > end) break;
      if (endFn(item) >= start) out.push(item);
    }
    if (maxItems && out.length > maxItems) {
      return out.slice(out.length - maxItems);
    }
    return out;
  }

  function downsampleCandlesForRender(candles, maxPoints) {
    candles = Array.isArray(candles) ? candles : [];
    maxPoints = Math.max(100, Number(maxPoints) || MAX_RENDER_CANDLES);
    if (candles.length <= maxPoints) return candles;
    var bucketSize = Math.ceil(candles.length / maxPoints);
    var out = [];
    for (var i = 0; i < candles.length; i += bucketSize) {
      var first = candles[i];
      if (!first) continue;
      var last = first;
      var high = Number(first.high);
      var low = Number(first.low);
      var volume = 0;
      var buyVol = 0;
      var sellVol = 0;
      var delta = 0;
      for (var j = i; j < Math.min(candles.length, i + bucketSize); j++) {
        var c = candles[j];
        if (!c) continue;
        last = c;
        if (Number.isFinite(Number(c.high))) high = Number.isFinite(high) ? Math.max(high, Number(c.high)) : Number(c.high);
        if (Number.isFinite(Number(c.low))) low = Number.isFinite(low) ? Math.min(low, Number(c.low)) : Number(c.low);
        volume += Number(c.volume || c.totalVol || 0) || 0;
        buyVol += Number(c.buyVol || 0) || 0;
        sellVol += Number(c.sellVol || 0) || 0;
        delta += Number(c.delta || 0) || 0;
      }
      out.push(Object.assign({}, first, {
        closeTime: candleEndTs(last),
        close: Number(last.close),
        high: high,
        low: low,
        volume: volume,
        buyVol: buyVol,
        sellVol: sellVol,
        delta: delta,
        levels: null,
        lod: true,
        lodCount: Math.min(candles.length - i, bucketSize)
      }));
    }
    return out;
  }

  function renderTimeWindow(vp) {
    var start = Number(vp && vp.timeStart);
    var end = Number(vp && vp.timeEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return { start: -Infinity, end: Infinity };
    }
    var pad = (end - start) * RENDER_WINDOW_PAD_RATIO;
    return { start: start - pad, end: end + pad };
  }

  function buildRenderData(state, vp, baseCandles, heatmapFrames, footprintCandles) {
    var win = renderTimeWindow(vp);
    var visibleCandles = sliceByTimeWindow(baseCandles, win.start, win.end, candleStartTs, candleEndTs);
    var visibleHeatmap = sliceByTimeWindow(heatmapFrames, win.start, win.end, frameTs, frameTs);
    var visibleFootprints = sliceByTimeWindow(footprintCandles, win.start, win.end, candleStartTs, candleEndTs, MAX_RENDER_FOOTPRINTS);
    var drawCandles = downsampleCandlesForRender(visibleCandles, MAX_RENDER_CANDLES);
    return {
      fullCandles: baseCandles,
      candles: visibleCandles,
      drawCandles: drawCandles,
      heatmapFrames: visibleHeatmap,
      footprintCandles: visibleFootprints,
      state: Object.assign({}, state || {}, {
        chartCandles: visibleCandles,
        heatmapFrames: visibleHeatmap,
        footprintCandles: visibleFootprints,
        _fullChartCandles: baseCandles,
        _fullHeatmapFrames: heatmapFrames,
        _fullFootprintCandles: footprintCandles,
        _renderLod: {
          candles: visibleCandles.length,
          drawCandles: drawCandles.length,
          heatmapFrames: visibleHeatmap.length,
          footprintCandles: visibleFootprints.length
        }
      })
    };
  }

  // Compute combined data extents (time + price) across the visible live data.
  // Candle base = backfilled history (chartCandles) merged with the live
  // forming candle(s) from footprint candles; footprint overrides by openTime.
  function mergedChartCandles(state) {
    var hist = Array.isArray(state.chartCandles) ? state.chartCandles : [];
    var fp = Array.isArray(state.footprintCandles) ? state.footprintCandles : [];
    // Live footprint candles are emitted as 1m bars. Aggregate them to the
    // active chart timeframe before merging so HTF views get the forming bar.
    var tf = state.timeframe || '1m';
    var ver = state._stateVersion || 0;
    // Fast-path: version unchanged → no data could have changed.
    if (_mergedCandlesCache && _mergedCandlesVersion === ver) {
      return _mergedCandlesCache;
    }
    var sig = tf + '|' + candleListSignature(hist) + '|' + candleListSignature(fp);

    if (_mergedCandlesCache && _mergedCandlesSig === sig) {
      _mergedCandlesVersion = ver;
      return _mergedCandlesCache;
    }

    var liveCandles = aggregateFootprintsToTimeframeCached(fp, tf);
    var out = mergeCandlesByOpenTime(hist, liveCandles, tf);

    _mergedCandlesCache = out;
    _mergedCandlesSig = sig;
    _mergedCandlesVersion = ver;
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
    var ver = state._stateVersion || 0;
    // Fast-path: version + refs unchanged → nothing could have changed.
    if (_boundsCache && _boundsVersion === ver &&
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
    _boundsVersion = ver;
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
  var TIME_LABEL_CACHE_LIMIT = 4096;
  var _timeLabelCache = new Map();
  var _timeDateCache = new Map();
  var _timeDayKeyCache = new Map();
  var _priceLabelCache = new Map();

  function cacheSet(cache, key, value, limit) {
    if (cache.size >= limit) {
      var first = cache.keys().next();
      if (!first.done) cache.delete(first.value);
    }
    cache.set(key, value);
    return value;
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function timeDayKey(ts) {
    var key = Number(ts) || 0;
    var cached = _timeDayKeyCache.get(key);
    if (cached) return cached;
    var d = new Date(key);
    return cacheSet(_timeDayKeyCache, key,
      d.getUTCFullYear() + '-' + d.getUTCMonth() + '-' + d.getUTCDate(),
      TIME_LABEL_CACHE_LIMIT);
  }

  function timeAxisLabel(ts, step) {
    var key = (Number(ts) || 0) + '|' + (Number(step) || 0);
    var cached = _timeLabelCache.get(key);
    if (cached) return cached;
    var d = new Date(ts);
    var label;

    // Step >= 24h â†’ date format "03 Jun"
    if (step >= 86400000) {
      label = pad2(d.getUTCDate()) + ' ' + MONTHS_SHORT[d.getUTCMonth()];
      return cacheSet(_timeLabelCache, key, label, TIME_LABEL_CACHE_LIMIT);
    }

    // Sub-minute (step < 60000) â†’ "HH:MM:SS"
    if (step < 60000) {
      label = pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
      return cacheSet(_timeLabelCache, key, label, TIME_LABEL_CACHE_LIMIT);
    }

    // Step >= 1m â†’ "HH:MM"
    label = pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes());
    return cacheSet(_timeLabelCache, key, label, TIME_LABEL_CACHE_LIMIT);
  }

  function timeAxisDate(ts) {
    var key = Number(ts) || 0;
    var cached = _timeDateCache.get(key);
    if (cached) return cached;
    var d = new Date(key);
    return cacheSet(_timeDateCache, key,
      pad2(d.getUTCDate()) + ' ' + MONTHS_SHORT[d.getUTCMonth()],
      TIME_LABEL_CACHE_LIMIT);
  }

  function priceAxisLabel(price) {
    var key = Math.round(Number(price) * 1000000) / 1000000;
    var cached = _priceLabelCache.get(key);
    if (cached) return cached;
    return cacheSet(_priceLabelCache, key, V6OF.format.price(price), 2048);
  }

  // Expose time axis helpers for external handling
  V6OF.timeAxisDate = timeAxisDate;

  // V6 dark-cockpit canvas tokens (mirrors the CSS custom properties in
  // 072_v6_orderflow_refactor.css — canvas can't read CSS vars, so the same
  // values are hard-coded here for the axis/grid layer).
  var AXIS_GRID_LINE   = 'rgba(255, 255, 255, 0.045)';  // faint plot gridlines
  var AXIS_BORDER_LINE = 'rgba(255, 255, 255, 0.10)';   // gutter separators
  var AXIS_TEXT        = 'rgba(154, 160, 171, 0.92)';   // --v6-text-dim
  var AXIS_TEXT_NOW    = '#d7d9de';                     // --v6-text (now line)
  var AXIS_FONT        = '600 10px JetBrains Mono, Consolas, monospace';

  function drawGridAndScales(ctx, vp, plot, settings) {
    var pTicks = priceTicks(vp.priceMin, vp.priceMax, 6);
    var tInfo = timeTicks(vp.timeStart, vp.timeEnd, 7);
    if (vp) vp._timeAxisStep = tInfo.step;
    var effectiveGB = (vp && vp._gutterBottom != null) ? vp._gutterBottom : GUTTER_BOTTOM;
    var gx = plot.left + plot.width;
    var by = plot.top + plot.height;

    // ── Plot gridlines (faint, behind candles) ─────────────────────────────
    if (settings.showGrid !== false) {
      ctx.save();
      ctx.strokeStyle = AXIS_GRID_LINE;
      ctx.lineWidth = 1;
      pTicks.forEach(function (price) {
        var y = Math.round(vp.priceToY(price)) + 0.5;
        if (y < plot.top || y > plot.top + plot.height) return;
        ctx.beginPath();
        ctx.moveTo(plot.left, y);
        ctx.lineTo(plot.left + plot.width, y);
        ctx.stroke();
      });
      ctx.restore();
    }

    // ── Price scale (right gutter) ─────────────────────────────────────────
    ctx.fillStyle = settings.bgColor || '#0a0b0d';
    ctx.fillRect(gx, plot.top - PAD_TOP, GUTTER_RIGHT, plot.height + PAD_TOP + effectiveGB);
    ctx.strokeStyle = AXIS_BORDER_LINE;
    ctx.beginPath();
    ctx.moveTo(gx + 0.5, plot.top - PAD_TOP);
    ctx.lineTo(gx + 0.5, plot.top + plot.height + effectiveGB);
    ctx.stroke();
    ctx.fillStyle = AXIS_TEXT;
    ctx.font = AXIS_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    pTicks.forEach(function (price) {
      var y = vp.priceToY(price);
      if (y < plot.top + 4 || y > plot.top + plot.height - 2) return;
      ctx.fillText(priceAxisLabel(price), gx + 8, y + 1);
    });
    ctx.textBaseline = 'alphabetic';

    // ── Time scale (bottom) — skip when gutter is suppressed (sub-pane owns it) ──
    if (effectiveGB > 0) {
      ctx.fillStyle = settings.bgColor || '#0a0b0d';
      ctx.fillRect(plot.left, by, plot.width + GUTTER_RIGHT, effectiveGB);
      ctx.strokeStyle = AXIS_BORDER_LINE;
      ctx.beginPath();
      ctx.moveTo(plot.left, by + 0.5);
      ctx.lineTo(plot.left + plot.width + GUTTER_RIGHT, by + 0.5);
      ctx.stroke();
      ctx.fillStyle = AXIS_TEXT;
      ctx.font = AXIS_FONT;
      ctx.textAlign = 'center';
      ctx.strokeStyle = AXIS_BORDER_LINE;
      tInfo.ticks.forEach(function (ts, idx) {
        var x = vp.timeToX(ts);
        if (x < plot.left + 16 || x > plot.left + plot.width - 16) return;
        var dayKey = timeDayKey(ts);
        var prevDayKey = idx > 0 ? timeDayKey(tInfo.ticks[idx - 1]) : null;
        var isNewDay = prevDayKey && dayKey !== prevDayKey;

        var label;
        // Always show date+time on the first tick (so you always know the day).
        if (tInfo.step >= 86400000 || isNewDay) {
          label = V6OF.timeAxisDate(ts);
        } else {
          label = timeAxisLabel(ts, tInfo.step);
        }
        ctx.beginPath();
        ctx.moveTo(x + 0.5, by);
        ctx.lineTo(x + 0.5, by + 4);
        ctx.stroke();
        ctx.fillText(label, x, by + 16);
      });
    }
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

  // Pre-rendered viridis RGBA lookup (64 steps) so drawHeatmapVp doesn't
  // build rgba strings per level per frame.
  var VIRIDIS_RGBA = [];
  for (var _vi = 0; _vi < 64; _vi++) {
    var _vt = _vi / 63;
    var _vc = viridis(_vt);
    VIRIDIS_RGBA[_vi] = 'rgba(' + (_vc[0]|0) + ',' + (_vc[1]|0) + ',' + (_vc[2]|0) + ',';
  }

  // Offscreen heatmap canvas for incremental rendering.
  // Full re-rasterize only on price-range change or significant pan;
  // live follow (right-shift) just shifts + draws the new column(s).
  var _hmCache = null; // { canvas, ctx, timeStart, timeEnd, priceMin, priceMax, plotW, plotH }

  function drawHeatmapVp(ctx, vp, plot, frames, settings) {
    if (!Array.isArray(frames) || !frames.length) return false;
    var dpr = window.devicePixelRatio || 1;
    var plotW = Math.round(plot.width);
    var plotH = Math.round(plot.height);
    if (plotW < 1 || plotH < 1) return false;

    var count = frames.length;
    var emit = emitGuess(frames);
    var scaleY = plotH / vp.priceSpan();
    var bgColor = settings.bgColor || '#0a0b0d';

    // ── Offscreen canvas lifecycle ──────────────────────────────────────────
    var offW = Math.round(plotW * dpr);
    var offH = Math.round(plotH * dpr);
    var needFull = !_hmCache
      || _hmCache.plotW !== plotW || _hmCache.plotH !== plotH
      || _hmCache.priceMin !== vp.priceMin || _hmCache.priceMax !== vp.priceMax;
    var needRecreate = needFull || (_hmCache.canvas.width !== offW || _hmCache.canvas.height !== offH);

    if (!_hmCache) _hmCache = {};
    if (needRecreate) {
      var oc = document.createElement('canvas');
      oc.width = offW; oc.height = offH;
      _hmCache.canvas = oc;
      _hmCache.ctx = oc.getContext('2d');
      _hmCache.plotW = plotW; _hmCache.plotH = plotH;
      needFull = true;
    }

    var offCtx = _hmCache.ctx;
    var offCanvas = _hmCache.canvas;

    // ── Right-shift detection (live follow) ─────────────────────────────────
    var isRightShift = !needFull
      && _hmCache.timeEnd != null && vp.timeEnd > _hmCache.timeEnd
      && _hmCache.timeStart != null && vp.timeStart > _hmCache.timeStart;
    var shiftPxCSS = 0;
    if (isRightShift) {
      var timeSpanCSS = vp.timeEnd - vp.timeStart;
      if (timeSpanCSS > 0) {
        shiftPxCSS = Math.round((vp.timeEnd - _hmCache.timeEnd) / timeSpanCSS * plotW);
      }
      isRightShift = shiftPxCSS > 0 && shiftPxCSS < plotW;
    }

    if (isRightShift) {
      var shiftPhys = Math.round(shiftPxCSS * dpr);
      // Shift existing content left in physical pixel space (identity CTM).
      offCtx.save();
      offCtx.setTransform(1, 0, 0, 1, 0, 0);
      offCtx.drawImage(offCanvas, shiftPhys, 0, offW - shiftPhys, offH, 0, 0, offW - shiftPhys, offH);
      offCtx.clearRect(offW - shiftPhys, 0, shiftPhys, offH);
      offCtx.restore();
    }

    // ── Draw columns ────────────────────────────────────────────────────────
    offCtx.save();
    offCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (needFull) {
      offCtx.fillStyle = bgColor;
      offCtx.fillRect(0, 0, plotW, plotH);
    }

    // Determine which frames to draw.
    var startIndex, endIndex;
    if (isRightShift && !needFull) {
      // Draw only new frames at the right edge. We need to find frames whose
      // X position falls in the exposed right strip [plotW - shiftPxCSS, plotW].
      // Translate that to data space: find frames with ts in [vp.timeEnd - shiftPxCSS*span/plotW, vp.timeEnd].
      var newStartMs = vp.timeEnd - (shiftPxCSS / plotW) * (vp.timeEnd - vp.timeStart);
      startIndex = firstFrameIndexAtOrBefore(frames, newStartMs);
      endIndex = Math.min(count, startIndex + Math.ceil(1.5 * shiftPxCSS / Math.max(1, Math.round(vp.timeToX(frameTs(frames[Math.min(startIndex + 1, count - 1)])) - vp.timeToX(frameTs(frames[startIndex]))))) + 2);
      endIndex = Math.min(count, Math.max(startIndex + 1, endIndex));
    } else {
      startIndex = firstFrameIndexAtOrBefore(frames, vp.timeStart);
      var hardEnd = vp.timeEnd + emit * 2;
      endIndex = startIndex;
      while (endIndex < count && frameTs(frames[endIndex]) <= hardEnd) endIndex++;
      endIndex = Math.min(count, Math.max(startIndex + 1, endIndex));
    }

    var visibleFrames = Math.max(1, endIndex - startIndex);
    var maxColumns = Math.max(120, Math.floor(plotW * 1.25));
    var step = Math.max(1, Math.ceil(visibleFrames / maxColumns));

    for (var index = startIndex; index < endIndex; index += step) {
      var frame = frames[index];
      var ts = frameTs(frame);
      var nextIndex = Math.min(endIndex - 1, index + step);
      var nextTs = nextIndex > index ? frameTs(frames[nextIndex]) : (index + 1 < count ? frameTs(frames[index + 1]) : ts + emit);
      var x = Math.round(vp.timeToX(ts));
      var x2 = Math.round(vp.timeToX(nextTs));
      if (x2 < 0 || x > plotW) continue;
      var rectW = Math.max(1, x2 - x);
      var levels = Array.isArray(frame.levels) ? frame.levels : [];
      var tick = Number(frame.tickSize || settings.tickSize || 1);
      if (!Number.isFinite(tick) || tick <= 0) tick = 1;
      var h = Math.max(1, Math.round(tick * scaleY));
      for (var li = 0; li < levels.length; li++) {
        var level = levels[li];
        var price = Number(level.price);
        if (!Number.isFinite(price) || price < vp.priceMin || price > vp.priceMax) continue;
        var t = Math.pow(clamp01(level.intensity), 0.55);
        var ci = Math.min(63, Math.round(t * 63));
        var alpha = (0.4 + t * 0.58).toFixed(3);
        offCtx.fillStyle = VIRIDIS_RGBA[ci] + alpha + ')';
        var cellY = Math.round(vp.priceToY(price) - h / 2);
        offCtx.fillRect(x, cellY, rectW, h);
      }
    }

    offCtx.restore();

    // ── Update cache state ──────────────────────────────────────────────────
    _hmCache.timeStart = vp.timeStart;
    _hmCache.timeEnd = vp.timeEnd;
    _hmCache.priceMin = vp.priceMin;
    _hmCache.priceMax = vp.priceMax;

    // ── Blit offscreen to main canvas ───────────────────────────────────────
    ctx.drawImage(offCanvas, plot.left, plot.top);
    return true;
  }
  // Plain candlesticks (base layer) from footprint OHLC, in the viewport space.
  function drawCandlesVp(ctx, vp, plot, candles, settings, state) {
    if (!Array.isArray(candles) || !candles.length) return false;
    var upHex = (settings && settings.upColor) || '#3ddc97';
    var downHex = (settings && settings.downColor) || '#ff5f73';
    var style = (settings && settings.ohlcBodyStyle) || 'candles';
    var bodyWidthFactor = Math.max(0.2, Math.min(1, Number(settings && settings.ohlcBodyWidth) || 0.72));
    var lineWidth = Math.max(1, Math.min(4, Number(settings && settings.ohlcLineWidth) || 1));
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
      var bodyW = Math.max(1, fullW * bodyWidthFactor);
      var xc = (x1 + x2) / 2;
      var up = c.close >= c.open;
      var selected = activeOpenTime > 0 && Number(c.openTime || 0) === activeOpenTime;
      var palette = getCandlePalette(settings);
      var colRgba = selected ? palette.selected : (up ? palette.up : palette.down);
      var yOpen = vp.priceToY(c.open);
      var yClose = vp.priceToY(c.close);
      if (c.synthetic) {
        var synthX = Math.max(plot.left, x1 + 1);
        var synthW = Math.max(2, Math.min(plot.left + plot.width, x2 - 1) - synthX);
        ctx.fillStyle = 'rgba(148, 163, 184, 0.08)';
        ctx.fillRect(synthX, plot.top, synthW, plot.height);
        // Diagonal hatch via pre-built pattern — avoids per-frame stroke loop.
        ctx.save();
        ctx.beginPath();
        ctx.rect(synthX, plot.top, synthW, plot.height);
        ctx.clip();
        ctx.fillStyle = ctx._synthHatchPattern || (ctx._synthHatchPattern = ctx.createPattern(_ensureSynthPattern(), 'repeat'));
        ctx.fillRect(synthX, plot.top, synthW, plot.height);
        ctx.restore();
        // Draw synthetic candle marker line (use dark color, not white)
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = 'rgba(107, 114, 128, 0.45)';  // Dark gray instead of white
        ctx.beginPath();
        ctx.moveTo(synthX, yClose);
        ctx.lineTo(synthX + synthW, yClose);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(107, 114, 128, 0.55)';  // Dark gray instead of white
        ctx.fillRect(xc - 1, yClose - 1, 2, 2);
        continue;
      }
      ctx.strokeStyle = colRgba;
      ctx.fillStyle = colRgba;
      ctx.lineWidth = selected ? Math.max(1.8, lineWidth + 0.75) : lineWidth;
      // wick (snap to pixel, 1px width for crisp rendering)
      var xc_snap = Math.round(xc);
      var yHigh_snap = Math.round(vp.priceToY(c.high));
      var yLow_snap = Math.round(vp.priceToY(c.low));
      ctx.beginPath();
      ctx.moveTo(xc_snap + 0.5, yHigh_snap);
      ctx.lineTo(xc_snap + 0.5, yLow_snap);
      ctx.stroke();
      if (style === 'bars') {
        var tickW = Math.max(3, Math.round(bodyW * 0.45));
        ctx.beginPath();
        ctx.moveTo(Math.round(xc - tickW) + 0.5, Math.round(yOpen) + 0.5);
        ctx.lineTo(Math.round(xc) + 0.5, Math.round(yOpen) + 0.5);
        ctx.moveTo(Math.round(xc) + 0.5, Math.round(yClose) + 0.5);
        ctx.lineTo(Math.round(xc + tickW) + 0.5, Math.round(yClose) + 0.5);
        ctx.stroke();
      } else {
        // body (snap to pixel grid for alignment)
        var top = Math.min(yOpen, yClose);
        var bh = Math.max(1, Math.abs(yClose - yOpen));
        var body_left = Math.round(xc - bodyW / 2);
        var body_top = Math.round(top);
        if (style === 'hollow' && up && !selected) {
          ctx.strokeRect(body_left, body_top, Math.round(bodyW), Math.round(bh));
        } else {
          ctx.fillRect(body_left, body_top, Math.round(bodyW), Math.round(bh));
        }
        // Doji / tiny candle: body < 3px is ambiguous — draw open/close ticks so
        // direction remains readable even when the body blends into the wick.
        if (bh < 3) {
          var tickW = Math.max(2, Math.round(bodyW * 0.35));
          ctx.beginPath();
          ctx.moveTo(Math.round(xc - tickW), Math.round(yOpen) + 0.5);
          ctx.lineTo(Math.round(xc), Math.round(yOpen) + 0.5);
          ctx.moveTo(Math.round(xc), Math.round(yClose) + 0.5);
          ctx.lineTo(Math.round(xc + tickW), Math.round(yClose) + 0.5);
          ctx.stroke();
        }
        if (selected) {
          ctx.strokeStyle = 'rgba(113, 63, 18, 0.92)';
          ctx.strokeRect(xc - bodyW / 2 - 1, top - 1, bodyW + 2, bh + 2);
        }
      }
    }
    return true;
  }

  function drawOhlcLegend(ctx, plot, candles, settings) {
    if (!Array.isArray(candles) || !candles.length) return;
    var last = candles[candles.length - 1];
    if (!last || !Number.isFinite(Number(last.close))) return;
    var up = Number(last.close) >= Number(last.open);
    var color = up ? ((settings && settings.upColor) || '#089981') : ((settings && settings.downColor) || '#f23645');
    var label = [
      'OHLC',
      V6OF.format.price(last.open),
      V6OF.format.price(last.high),
      V6OF.format.price(last.low),
      V6OF.format.price(last.close)
    ].join('  ');
    ctx.save();
    ctx.font = '700 12px JetBrains Mono, Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(201, 206, 209, 0.96)';
    ctx.fillText(label, plot.left + 8, Math.max(14, plot.top - 9));
    ctx.fillStyle = color;
    ctx.fillRect(plot.left + 8, Math.max(4, plot.top - 18), 24, 2);
    ctx.restore();
  }

  function hasChartIndicator(settings, id) {
    var list = settings && Array.isArray(settings.chartIndicators) ? settings.chartIndicators : ['ohlc'];
    var hidden = settings && Array.isArray(settings.hiddenChartIndicators) ? settings.hiddenChartIndicators : [];
    return list.indexOf(id) >= 0 && hidden.indexOf(id) < 0;
  }

  function drawIndicatorLine(ctx, vp, points, color, width) {
    if (!Array.isArray(points) || points.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 1.25;
    ctx.beginPath();
    var started = false;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (!p || p.time < vp.timeStart) continue;
      if (p.time > vp.timeEnd) break;
      if (!Number.isFinite(p.value) || p.value < vp.priceMin || p.value > vp.priceMax) {
        started = false;
        continue;
      }
      var x = vp.timeToX(p.time);
      var y = vp.priceToY(p.value);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  // Incremental EMA cache — avoids O(n) recompute every frame for the
  // 300+ candles visible at 1m. Only the forming candle changes frame-to-frame,
  // so we recompute a single point per period.
  var _emaCache = {};

  function emaPointsCached(candles, period) {
    if (!Array.isArray(candles) || !candles.length) return [];
    var key = String(period);
    var cache = _emaCache[key];
    var len = candles.length;
    var k = 2 / (period + 1);

    // Full recompute: cache miss, count dropped (timeframe change), or first call.
    if (!cache || cache.count > len || cache.count === 0) {
      var prev = null;
      var out = new Array(len);
      for (var i = 0; i < len; i++) {
        var close = Number(candles[i] && candles[i].close);
        if (!Number.isFinite(close)) { out[i] = null; continue; }
        prev = prev == null ? close : prev + k * (close - prev);
        out[i] = { time: candleMidTs(candles[i]), value: prev };
      }
      _emaCache[key] = { count: len, lastEma: prev, points: out };
      return out;
    }

    // Count grew: new candle(s) appended → resume from last known EMA.
    if (cache.count < len) {
      var prev = cache.lastEma;
      var points = cache.points.slice();
      for (var i = cache.count; i < len; i++) {
        var close = Number(candles[i] && candles[i].close);
        if (!Number.isFinite(close)) { points.push(null); continue; }
        prev = prev == null ? close : prev + k * (close - prev);
        points.push({ time: candleMidTs(candles[i]), value: prev });
      }
      _emaCache[key] = { count: len, lastEma: prev, points: points };
      return points;
    }

    // Same count: only the forming candle (last) changed → recompute last only.
    var points = cache.points.slice();
    var i = len - 1;
    var prev = i > 0 && points[i - 1] ? points[i - 1].value : null;
    var close = Number(candles[i] && candles[i].close);
    if (Number.isFinite(close)) {
      prev = prev == null ? close : prev + k * (close - prev);
      points[i] = { time: candleMidTs(candles[i]), value: prev };
    } else {
      points[i] = null;
    }
    _emaCache[key] = { count: len, lastEma: prev, points: points };
    return points;
  }

  // Backward-compat alias — still used by V6OF.Studies if external code calls it.
  function emaPoints(candles, period) {
    return emaPointsCached(candles, period);
  }

  // Incremental VWAP cache — tracks cumulative price*volume and volume
  // per candle so same-count updates are O(1), not O(n).
  var _vwapCache = null;

  function vwapPointsCached(candles, state) {
    // Pre-computed VWAP from the state (back-end provides it) → trivial O(1).
    if (state && state.vwap && Number.isFinite(Number(state.vwap.value)) && candles && candles.length) {
      var vwapVal = Number(state.vwap.value);
      if (_vwapCache && _vwapCache.vwapVal === vwapVal && _vwapCache.count === candles.length) {
        return _vwapCache.points;
      }
      var out = new Array(candles.length);
      for (var i = 0; i < candles.length; i++) {
        out[i] = { time: candleMidTs(candles[i]), value: vwapVal };
      }
      _vwapCache = { vwapVal: vwapVal, count: candles.length, points: out, cumPv: null, cumVol: null };
      return out;
    }

    var len = (candles || []).length;
    if (!len) { _vwapCache = null; return []; }

    // Helper: contribution of a single candle to the HLC3*Vol / Vol accumulator.
    function candleContrib(c) {
      var h = Number(c.high), l = Number(c.low), cl = Number(c.close);
      var v = Number(c.volume || 0);
      if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(cl) || !(v > 0)) return null;
      return { pv: ((h + l + cl) / 3) * v, vol: v };
    }

    // Full recompute: cache miss, count shrunk, or previously had pre-computed VWAP.
    if (!_vwapCache || _vwapCache.count > len || _vwapCache.count === 0 || _vwapCache.vwapVal != null) {
      var cumPv = [], cumVol = [];
      var pv = 0, vol = 0;
      var out = [];
      for (var i = 0; i < len; i++) {
        var contrib = candleContrib(candles[i]);
        if (contrib) {
          pv += contrib.pv; vol += contrib.vol;
          cumPv.push(pv); cumVol.push(vol);
          out.push({ time: candleMidTs(candles[i]), value: pv / vol });
        } else {
          // Candle with no volume: carry forward last known value, keep arrays aligned.
          cumPv.push(pv); cumVol.push(vol);
          out.push(out.length ? out[out.length - 1] : null);
        }
      }
      _vwapCache = { vwapVal: null, count: len, points: out, cumPv: cumPv, cumVol: cumVol };
      return out;
    }

    // Count grew: append new candles incrementally.
    if (_vwapCache.count < len) {
      var pv = _vwapCache.cumPv.length ? _vwapCache.cumPv[_vwapCache.cumPv.length - 1] : 0;
      var vol = _vwapCache.cumVol.length ? _vwapCache.cumVol[_vwapCache.cumVol.length - 1] : 0;
      var out = _vwapCache.points.slice();
      var cumPv = _vwapCache.cumPv.slice();
      var cumVol = _vwapCache.cumVol.slice();
      for (var i = _vwapCache.count; i < len; i++) {
        var contrib = candleContrib(candles[i]);
        if (contrib) {
          pv += contrib.pv; vol += contrib.vol;
        }
        cumPv.push(pv); cumVol.push(vol);
        out.push(vol > 0 ? { time: candleMidTs(candles[i]), value: pv / vol } : (out.length ? out[out.length - 1] : null));
      }
      _vwapCache = { vwapVal: null, count: len, points: out, cumPv: cumPv, cumVol: cumVol };
      return out;
    }

    // Same count: only last candle changed (forming) — O(1) recompute.
    var out = _vwapCache.points.slice();
    var cumPv = _vwapCache.cumPv.slice();
    var cumVol = _vwapCache.cumVol.slice();
    var last = len - 1;
    var prevPv = last > 0 ? cumPv[last - 1] : 0;
    var prevVol = last > 0 ? cumVol[last - 1] : 0;
    var contrib = candleContrib(candles[last]);
    if (contrib) {
      cumPv[last] = prevPv + contrib.pv;
      cumVol[last] = prevVol + contrib.vol;
      out[last] = cumVol[last] > 0 ? { time: candleMidTs(candles[last]), value: cumPv[last] / cumVol[last] } : null;
    } else {
      cumPv[last] = prevPv;
      cumVol[last] = prevVol;
      out[last] = last > 0 ? out[last - 1] : null;
    }
    _vwapCache = { vwapVal: null, count: len, points: out, cumPv: cumPv, cumVol: cumVol };
    return out;
  }

  // Backward-compat alias.
  function vwapPoints(candles, state) {
    return vwapPointsCached(candles, state);
  }

  function drawBuiltInChartIndicators(ctx, vp, candles, state, settings) {
    if (!Array.isArray(candles) || !candles.length) return;
    if (hasChartIndicator(settings, 'vwap')) drawIndicatorLine(ctx, vp, vwapPoints(candles, state), '#d6bd47', 1.25);
    if (hasChartIndicator(settings, 'ema9')) drawIndicatorLine(ctx, vp, emaPoints(candles, 9), '#39c77a', 1.25);
    if (hasChartIndicator(settings, 'ema21')) drawIndicatorLine(ctx, vp, emaPoints(candles, 21), '#55aee8', 1.25);
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

    // Proportional sizing: radius = sqrt(volumePercent) * maxRadius (power scaling),
    // clamped to [minR, maxR] so every visible candle gets a readable bubble.
    var minR = 3;
    var maxR = Math.max(minR + 1, Math.min(20, plot.width / Math.max(visible.length, 1) * 1.1));
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (i = 0; i < visible.length; i++) {
      var v = visible[i];
      var ratio = v.notional / maxNotional;
      var r = Math.max(minR, Math.min(maxR, Math.sqrt(ratio) * maxR));
      // Opacity ramp: fade-in curve so small volumes stay faintly visible
      // (30-50% at the low end) and large volumes reach full opacity.
      var opacity = Math.max(0.3, Math.min(1, Math.pow(ratio, 0.4)));
      var price = Number.isFinite(v.mid) ? v.mid : Number(v.c.close);
      if (!Number.isFinite(price) || price < vp.priceMin || price > vp.priceMax) continue;
      var x = Math.round(vp.timeToX((v.s + v.e) / 2));
      var y = Math.round(vp.priceToY(price));
      var delta = Number(v.c.delta);
      var buy = Number.isFinite(delta) ? delta >= 0 : (Number(v.c.close) >= Number(v.c.open));
      ctx.globalAlpha = opacity;
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
    ctx.globalAlpha = 1;
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
    var idx = indexOfCandleOpenTime(candles, openTime);
    return idx >= 0 ? candles[idx] : null;
  }

  function indexOfCandleOpenTime(candles, openTime) {
    if (!Array.isArray(candles) || !candles.length) return -1;
    var target = Number(openTime);
    if (!Number.isFinite(target)) return -1;
    var lo = 0, hi = candles.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >>> 1;
      var t = candleStartTs(candles[mid]);
      if (t === target) return mid;
      if (t < target) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }

  function nearestCandlePick(candles, timeMs) {
    if (!Array.isArray(candles) || !candles.length) return null;
    var lo = 0, hi = candles.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >>> 1;
      if (candleStartTs(candles[mid]) < timeMs) lo = mid + 1;
      else hi = mid;
    }
    var bestIndex = lo;
    var best = candles[bestIndex];
    var bestDist = Math.abs(candleMidTs(best) - timeMs);
    if (lo > 0) {
      var prev = candles[lo - 1];
      var prevDist = Math.abs(candleMidTs(prev) - timeMs);
      if (prevDist < bestDist) {
        bestIndex = lo - 1;
        best = prev;
      }
    }
    return { candle: best, index: bestIndex };
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
    var pick = nearestCandlePick(candles, vp.xToTime(x));
    var candle = pick && pick.candle;
    if (!candle) return null;
    return {
      candle: candle,
      index: pick.index,
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
      lines.push('Î” ' + (d >= 0 ? '+' : '') + d.toFixed(1));
    }
    if (candle.priceOnly) {
      lines.push('Price-only REST');
    }
    if (candle.synthetic) {
      lines.push('Synthetic gap-fill');
    }
    var lh = 15;
    var pw = (candle.priceOnly || candle.synthetic) ? 174 : 156, ph = 4 + lines.length * lh + 6;
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

  function drawCrosshair(ctx, vp, plot, candles, ref) {
    var cross = V6OF.getChartCrosshair ? V6OF.getChartCrosshair(ref) : V6OF._fallbackChartCrosshair;
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
    
    // Vertical line (snapped to candle center â€” always drawn)
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

    // Time readout (bottom axis) â€” snapped to candle time
    // Toujours afficher la date (DD Mon HH:MM:SS) pour savoir exactement
    // quel jour on survole, mÃªme sur un viewport < 24h.
    var snappedTs = vp.xToTime(snappedX);
    var axisStep = (vp && Number.isFinite(vp._timeAxisStep) && vp._timeAxisStep > 0)
      ? vp._timeAxisStep
      : timeTicks(vp.timeStart, vp.timeEnd, 7).step;
    var timeText = V6OF.timeAxisDate(snappedTs) + ' ' + timeAxisLabel(snappedTs, axisStep);
    var tw = 130;
    var xhairGB = (vp && vp._gutterBottom != null) ? vp._gutterBottom : GUTTER_BOTTOM;
    ctx.fillStyle = 'rgba(56, 211, 238, 0.95)';
    if (xhairGB > 2) ctx.fillRect(snappedX - tw / 2, plot.top + plot.height, tw, xhairGB - 2);
    ctx.fillStyle = '#04121a';
    ctx.font = 'bold 9px JetBrains Mono, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(timeText, snappedX, plot.top + plot.height + 15);
    ctx.restore();

    // Tooltip disabled â€” user doesn't want the OHLC rectangle
    // if (cross.hoveringSource === 'chart') {
    //   drawCrosshairTooltip(ctx, snappedX, y, vp, plot, snappedCandle);
    // }
  }

  function drawLiveInfo(ctx, vp, plot, state, settings) {
    settings = settings || {};
    var layers = [];
    if (settings.showOhlc !== false && settings.showCandles !== false) layers.push('OHLC');
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

    // Data gap: fillCandleGaps hit its synthetic cap — some gaps are unfilled.
    var gf = V6OF.chartGapFill;
    if (gf && gf.truncated) {
      ctx.fillStyle = 'rgba(245, 158, 11, 0.88)';
      ctx.font = 'bold 9px JetBrains Mono, Consolas, monospace';
      ctx.fillText('DATA GAP', plot.left + plot.width - 72, 28);
    }
  }

  function countdownTextForCloseTime(closeTime) {
    var nowMs = window.BtcMarketClock ? window.BtcMarketClock.now() : Date.now();
    return formatCountdown(Math.max(0, Number(closeTime) - nowMs));
  }

  function lastCandleCloseTime(candles) {
    if (!candles || !candles.length) return 0;
    return candleEndTs(candles[candles.length - 1]);
  }

  function drawLastPriceBadge(ctx, canvas, plot, lastPrice, lastY, closeTime) {
    var gx = plot.left + plot.width;
    var badgeH = 32;
    var badgeY = lastY - badgeH / 2;
    var badgeX = gx + 1;
    var badgeW = GUTTER_RIGHT - 2;
    var textX = gx + GUTTER_RIGHT / 2;
    var countdownY = lastY + 7;

    ctx.save();
    ctx.fillStyle = '#000000';
    roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 3);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px JetBrains Mono, Consolas, monospace';
    ctx.fillText(V6OF.format.price(lastPrice), textX, lastY - 6);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px JetBrains Mono, Consolas, monospace';
    ctx.fillText(closeTime ? countdownTextForCloseTime(closeTime) : '00:00', textX, countdownY);
    ctx.restore();

    if (canvas) {
      canvas._v6CountdownLabel = {
        x: badgeX,
        y: lastY - 1,
        w: badgeW,
        h: 15,
        textX: textX,
        textY: countdownY,
        closeTime: closeTime || 0
      };
    }
  }

  function drawCountdownLabelOnly(canvas) {
    var label = canvas && canvas._v6CountdownLabel;
    if (!label || !label.closeTime || !canvas.isConnected) return false;
    var size = getCanvasCachedSize(canvas);
    if (!(size.width > 0) || !(size.height > 0)) return false;
    var dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.floor(size.width * dpr) ||
        canvas.height !== Math.floor(size.height * dpr)) {
      return false;
    }

    var ctx = canvas.getContext('2d');
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000000';
    ctx.fillRect(label.x, label.y, label.w, label.h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px JetBrains Mono, Consolas, monospace';
    ctx.fillText(countdownTextForCloseTime(label.closeTime), label.textX, label.textY);
    ctx.restore();
    return true;
  }

  function drawNonePlaceholder(ctx, setup, state) {
    var width = setup.width;
    var height = setup.height;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = (state && state.settings && state.settings.bgColor) || '#080b12';
    ctx.fillRect(0, 0, width, height);

    // Subtle grid
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.04)';
    ctx.lineWidth = 1;
    for (var gx = 0; gx < width; gx += 80) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, height); ctx.stroke(); }
    for (var gy = 0; gy < height; gy += 50) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(width, gy); ctx.stroke(); }

    var cx = width / 2;
    var cy = height / 2;
    var now = Date.now();

    // Animated spinner ring
    var spinnerR = 18;
    var spinnerAngle = (now % 1400) / 1400 * Math.PI * 2;
    ctx.save();
    ctx.translate(cx, cy - 24);
    ctx.lineWidth = 2.5;
    // Track ring
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.10)';
    ctx.beginPath();
    ctx.arc(0, 0, spinnerR, 0, Math.PI * 2);
    ctx.stroke();
    // Spinning arc
    var arcLen = 1.2 + Math.sin(now / 600) * 0.5;
    ctx.strokeStyle = 'rgba(56, 211, 238, 0.70)';
    ctx.beginPath();
    ctx.arc(0, 0, spinnerR, spinnerAngle, spinnerAngle + arcLen);
    ctx.stroke();
    ctx.restore();

    // Label
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(203, 213, 225, 0.55)';
    ctx.font = '13px Inter, system-ui, sans-serif';
    ctx.fillText('Loading market data\u2026', cx, cy + 10);

    ctx.textAlign = 'left';
  }

  function hasMarketPermission(state) {
    if (!state) return true;
    if (state.permissionDenied === true || state.marketPermission === 'denied') return false;
    var p = state.permissions || {};
    if (p.marketData === false || p.orderflow === false || p.chart === false) return false;
    return true;
  }

  function emptyChartCause(state, bounds, haveData) {
    state = state || {};
    var source = String(state.source || '').toLowerCase();
    var freshness = String(state.dataFreshness || '').toLowerCase();
    var transport = String(state.transportStatus || '').toLowerCase();
    var chartCandles = Array.isArray(state.chartCandles) ? state.chartCandles : [];
    var footprintCandles = Array.isArray(state.footprintCandles) ? state.footprintCandles : [];
    var heatmapFrames = Array.isArray(state.heatmapFrames) ? state.heatmapFrames : [];

    if (!hasMarketPermission(state)) {
      return {
        title: 'No chart permissions',
        detail: 'Market data access is disabled for this workspace or account.'
      };
    }
    if (!source || source === 'unavailable' || source === 'none' || transport === 'disabled') {
      return {
        title: 'No market source',
        detail: 'Select or reconnect a data source before rendering candles.'
      };
    }
    if (state.isStale || freshness === 'stale') {
      return {
        title: 'Market data stale',
        detail: 'The last valid update is too old; waiting for a fresh tick or fallback.'
      };
    }
    if (haveData && bounds && bounds.timeMax == null && bounds.priceMax == null) {
      return {
        title: 'No data in visible range',
        detail: 'The current timeframe or viewport is outside the loaded market data.'
      };
    }
    if (!chartCandles.length && !footprintCandles.length) {
      return {
        title: 'No backfill loaded',
        detail: 'Historical candles are empty for ' + (state.symbol || 'symbol') + ' ' + (state.timeframe || 'timeframe') + '.'
      };
    }
    if (!chartCandles.length && heatmapFrames.length) {
      return {
        title: 'No candle backfill',
        detail: 'Depth frames exist, but candle history is missing for this timeframe.'
      };
    }
    return {
      title: 'Waiting for chart data',
      detail: 'The chart has a source, but no renderable candles are available yet.'
    };
  }

  function drawWaiting(ctx, state, bounds, haveData) {
    var cause = emptyChartCause(state, bounds, haveData);
    ctx.fillStyle = 'rgba(226, 232, 240, 0.82)';
    ctx.font = 'bold 13px Inter, system-ui, sans-serif';
    ctx.fillText(cause.title, 18, 32);
    ctx.fillStyle = 'rgba(148, 163, 184, 0.72)';
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.fillText(cause.detail, 18, 52);
  }

  function drawLive(ctx, setup, state, canvas) {
    var width = setup.width;
    var height = setup.height;
    var staticCtx = setup.statik && setup.statik.ctx ? setup.statik.ctx : ctx;
    var dataCtx = setup.data && setup.data.ctx ? setup.data.ctx : ctx;
    var overlayCtx = setup.overlay && setup.overlay.ctx ? setup.overlay.ctx : ctx;
    var settings = (state && state.settings) || {};
    var heatmapFrames = Array.isArray(state.heatmapFrames) ? state.heatmapFrames : [];
    var footprintCandles = Array.isArray(state.footprintCandles) ? state.footprintCandles : [];
    var baseCandles = mergedChartCandles(state);

    // Independent layers (TradingView/ATAS model): candles are the base,
    // heatmap is an optional background, footprint is an optional cell overlay.
    var showHeatmap = settings.showHeatmap === true;
    var showFootprint = false;  // resolved after viewport init below
    var showCandles = settings.showOhlc !== false && settings.showCandles !== false;  // Always show OHLC unless explicitly disabled

    staticCtx.clearRect(0, 0, width, height);
    dataCtx.clearRect(0, 0, width, height);
    overlayCtx.clearRect(0, 0, width, height);
    staticCtx.fillStyle = settings.bgColor || '#080b12';
    staticCtx.fillRect(0, 0, width, height);

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
      var cause = emptyChartCause(state, bounds, haveData);
      // Loading / waiting states → spinner; hard errors → message.
      var isError = cause && (cause.title.indexOf('permission') >= 0
        || cause.title.indexOf('source') >= 0
        || cause.title.indexOf('stale') >= 0
        || cause.title.indexOf('Stale') >= 0);
      if (isError) {
        drawWaiting(dataCtx, state, bounds, haveData);
      } else {
        drawNonePlaceholder(staticCtx, setup, state);
      }
      return;
    }

    // Viewport: persist across frames so pan/zoom survive redraws.
    var vp = V6OF.chart || (V6OF.chart = V6OF.ChartViewport.create());
    // Expose viewport on the canvas element so sub-panes (CVD) can share it.
    if (canvas) canvas._v6vp = vp;
    // Allow caller to suppress the bottom time-axis gutter (e.g. when a
    // time-synced sub-pane below owns the time-axis row instead).
    var suppressBottomGutter = canvas && canvas._v6suppressBottomGutter;
    var effectiveGutterBottom = suppressBottomGutter ? 0 : GUTTER_BOTTOM;
    // Store on vp so helper functions (drawGridAndScales, drawCrosshair) can
    // read the effective value without needing an extra parameter.
    vp._gutterBottom = effectiveGutterBottom;
    var plot = {
      left: PAD_LEFT,
      top: PAD_TOP,
      width: Math.max(1, width - PAD_LEFT - GUTTER_RIGHT),
      height: Math.max(1, height - PAD_TOP - effectiveGutterBottom)
    };
    vp.setPlot(plot);
    vp.syncToData(bounds);

    // Resolve footprint visibility now that vp is initialized.
    showFootprint = V6OF.UI && V6OF.UI.FootprintIntegration
      ? V6OF.UI.FootprintIntegration.shouldShowFootprint(vp, settings)
      : false;
    var renderData = buildRenderData(state, vp, baseCandles, heatmapFrames, footprintCandles);
    var renderState = renderData.state;
    var renderCandles = renderData.candles;
    var drawCandles = renderData.drawCandles;
    var renderHeatmapFrames = renderData.heatmapFrames;
    // Re-fit the price axis to the candles actually visible in the time window.
    // Use lerp-based smoothing to avoid vertical jumps when a new candle
    // appears or the 18% pad shifts the visible range.
    if (vp.autoFit && baseCandles.length) {
      var visRange = visiblePriceRange(renderCandles.length ? renderCandles : baseCandles, vp, renderState, showHeatmap);
      if (visRange) { vp.smoothPriceRange(visRange.min, visRange.max); }
    }

    drawGridAndScales(staticCtx, vp, plot, settings);

    var isInteractiveDrag = !!V6OF.chartIsDragging;

    // Data layers (clipped to the plot rect): heatmap behind, candles, then
    // footprint cells as an overlay so the candlesticks stay readable.
    dataCtx.save();
    dataCtx.beginPath();
    dataCtx.rect(plot.left, plot.top, plot.width, plot.height);
    dataCtx.clip();
    // Heatmap: during drag, blit the frozen offscreen snapshot to avoid the
    // expensive full rasterize; on release, drawHeatmapVp resumes live.
    if (showHeatmap) {
      if (isInteractiveDrag && _hmCache && _hmCache.canvas) {
        dataCtx.drawImage(_hmCache.canvas, plot.left, plot.top);
      } else {
        drawHeatmapVp(dataCtx, vp, plot, renderHeatmapFrames, settings);
      }
    }
    // Bubbles behind candles so they don't obscure price action
    if (false && settings.showBubbles === true) {
      drawBubblesVp(dataCtx, vp, plot, drawCandles);
    }
    if (showCandles && drawCandles.length) drawCandlesVp(dataCtx, vp, plot, drawCandles, settings, renderState);
    // Footprint overlay via the new v6 pipeline (091-095).
    if (showFootprint && !isInteractiveDrag) {
      V6OF.UI.FootprintIntegration.renderFootprintsToCanvas(dataCtx, vp, plot, renderState, settings);
    }
    dataCtx.restore();

    // â”€â”€ Indicator overlays (EMA, SMA, Bollinger, etc.) â”€â”€
    if (V6OF.Indicators && V6OF.Indicators.drawAll) {
      dataCtx.save();
      dataCtx.beginPath();
      dataCtx.rect(plot.left, plot.top, plot.width, plot.height);
      dataCtx.clip();
      V6OF.Indicators.drawAll(dataCtx, vp, plot, renderState, drawCandles);
      dataCtx.restore();
    }
    drawBuiltInChartIndicators(dataCtx, vp, drawCandles, renderState, settings);

    // Reference price lines (mid / bid / ask / poc / vwap)
    var lastFrame = heatmapFrames.length ? heatmapFrames[heatmapFrames.length - 1] : null;
    var lastCandle = footprintCandles.length ? footprintCandles[footprintCandles.length - 1] : null;
    var book = state.orderBook;
    var mid = book && Number.isFinite(book.mid) ? book.mid : (lastFrame ? lastFrame.mid : NaN);
    var bestBid = book && Number.isFinite(book.bestBid) ? book.bestBid : (lastFrame ? lastFrame.bestBid : NaN);
    var bestAsk = book && Number.isFinite(book.bestAsk) ? book.bestAsk : (lastFrame ? lastFrame.bestAsk : NaN);
    // MID removed â€” keep chart clean
    // drawPriceLineVp(ctx, vp, plot, Number(mid), 'rgba(56, 211, 238, 0.92)', 'MID', false);
    // BID / ASK removed â€” keep chart clean
    // drawPriceLineVp(ctx, vp, plot, Number(bestBid), 'rgba(61, 220, 151, 0.86)', 'BID', true);
    // drawPriceLineVp(ctx, vp, plot, Number(bestAsk), 'rgba(255, 95, 115, 0.86)', 'ASK', true);
    // Last price marker (current price) â€” dashed, anchored to price axis
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
        overlayCtx.save();
        overlayCtx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
        overlayCtx.lineWidth = 1;
        overlayCtx.setLineDash([1, 2]);
        overlayCtx.beginPath();
        overlayCtx.moveTo(plot.left, lastY);
        overlayCtx.lineTo(plot.left + plot.width, lastY);
        overlayCtx.stroke();
        overlayCtx.restore();

        drawLastPriceBadge(overlayCtx, canvas, plot, lastPrice, lastY, lastCandleCloseTime(baseCandles));
      } else if (canvas) {
        canvas._v6CountdownLabel = null;
      }
    } else if (canvas) {
      canvas._v6CountdownLabel = null;
    }
    if (false && showFootprint && lastCandle) drawPriceLineVp(overlayCtx, vp, plot, Number(lastCandle.poc), 'rgba(248, 195, 93, 0.94)', 'POC', true);
    // VWAP removed â€” keep chart clean
    // if (settings.showVwap !== false && state.vwap && Number.isFinite(state.vwap.value)) {
    //   drawPriceLineVp(ctx, vp, plot, Number(state.vwap.value),
    //     state.vwap.isWarm ? 'rgba(245, 158, 11, 0.92)' : 'rgba(245, 158, 11, 0.6)', 'VWAP', true);
    // }

    // Selection is shown by coloring the selected candle yellow in drawCandlesVp.
    drawVolumeProfile(overlayCtx, vp, plot, renderState, canvas);
    drawTimelineBookmarks(overlayCtx, vp, plot, renderState, canvas);
    drawCrosshair(overlayCtx, vp, plot, renderCandles.length ? renderCandles : baseCandles, canvas);

    // Debug grid overlay (when V6OF.DEBUG_RENDER = true)
    if (V6OF.DEBUG_RENDER && V6OF.CanvasEnhancements && typeof V6OF.CanvasEnhancements.drawDebugGridOverlay === 'function') {
      try {
        V6OF.CanvasEnhancements.drawDebugGridOverlay(overlayCtx, vp, plot, 40, 16);
      } catch (e) {
        // Debug overlay failed silently to prevent breaking chart render
      }
    }

    if (typeof V6OF.updateViewportToolbarState === 'function') {
      V6OF.updateViewportToolbarState();
    }
    V6OF._followLiveBtn = null;

    // Status badges (LIVE, STALE, DATA GAP, etc.) on the overlay layer.
    drawLiveInfo(overlayCtx, vp, plot, state, settings);
  }

  function internalDraw(canvas, state) {
    var perfStart = window.performance ? performance.now() : 0;
    var setup = setupChartLayers(canvas);
    if (!setup) return;
    var ctx = setup.overlay.ctx;
    var width = setup.width;
    var height = setup.height;
    // Live-only: always render the live chart engine. No mock path.
    drawLive(ctx, setup, state || {}, canvas);
    recordPerf('chart', perfStart);
  }

  function internalDrawOverlay(canvas, state) {
    var setup = setupCanvas(canvas);
    if (!setup) return;
    var ctx = setup.ctx;
    var width = setup.width;
    var height = setup.height;
    var vp = V6OF.chart;
    var plot = vp && vp.plot;
    if (!vp || !plot) return;
    state = state || canvas._v6PendingState || {};
    var baseCandles = mergedChartCandles(state);
    var heatmapFrames = Array.isArray(state.heatmapFrames) ? state.heatmapFrames : [];
    var footprintCandles = Array.isArray(state.footprintCandles) ? state.footprintCandles : [];
    var settings = state.settings || {};

    ctx.clearRect(0, 0, width, height);

    var lastFrame = heatmapFrames.length ? heatmapFrames[heatmapFrames.length - 1] : null;
    var book = state.orderBook;
    var mid = book && Number.isFinite(book.mid) ? book.mid : (lastFrame ? lastFrame.mid : NaN);
    if (settings.showLastPrice !== false) {
      var lastPrice = 0;
      var trades = state.trades || [];
      if (trades.length && Number.isFinite(trades[0].price)) lastPrice = trades[0].price;
      if (!lastPrice && Number.isFinite(mid)) lastPrice = mid;
      if (lastPrice && Number.isFinite(lastPrice) && lastPrice >= vp.priceMin && lastPrice <= vp.priceMax) {
        var lastY = vp.priceToY(lastPrice);
        ctx.save();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([1, 2]);
        ctx.beginPath();
        ctx.moveTo(plot.left, lastY);
        ctx.lineTo(plot.left + plot.width, lastY);
        ctx.stroke();
        ctx.restore();
        drawLastPriceBadge(ctx, canvas, plot, lastPrice, lastY, lastCandleCloseTime(baseCandles));
      } else {
        canvas._v6CountdownLabel = null;
      }
    } else {
      canvas._v6CountdownLabel = null;
    }

    drawVolumeProfile(ctx, vp, plot, state, canvas);
    drawTimelineBookmarks(ctx, vp, plot, state, canvas);
    drawCrosshair(ctx, vp, plot, baseCandles, canvas);
  }

  var countdownTickerId = null;
  var countdownTickerCanvas = null;
  var activeChartCanvas = null;
  var dprMediaQuery = null;
  var dprMediaHandler = null;

  function isOrderflowPageActive(canvas) {
    if (!canvas || !canvas.isConnected) return false;
    var page = document.body && document.body.getAttribute('data-current-page');
    return page === 'orderflow';
  }

  function stopCountdownTicker() {
    if (countdownTickerId != null) {
      clearInterval(countdownTickerId);
      countdownTickerId = null;
    }
    countdownTickerCanvas = null;
  }

  function ensureCountdownTicker(canvas) {
    if (!isOrderflowPageActive(canvas)) {
      stopCountdownTicker();
      return;
    }
    countdownTickerCanvas = canvas;
    if (countdownTickerId != null) return;
    countdownTickerId = setInterval(function () {
      if (document.hidden) return;  // pause in background tabs
      var cv = countdownTickerCanvas;
      if (!isOrderflowPageActive(cv)) {
        stopCountdownTicker();
        return;
      }
      if (V6OF.chartIsDragging) return;
      if (cv._v6PendingState && cv.offsetWidth > 0 && cv.offsetHeight > 0) {
        drawCountdownLabelOnly(cv);
      }
    }, 1000);
  }

  function removeDprWatcher() {
    if (!dprMediaQuery || !dprMediaHandler) return;
    if (typeof dprMediaQuery.removeEventListener === 'function') {
      dprMediaQuery.removeEventListener('change', dprMediaHandler);
    } else if (typeof dprMediaQuery.removeListener === 'function') {
      dprMediaQuery.removeListener(dprMediaHandler);
    }
    dprMediaQuery = null;
    dprMediaHandler = null;
  }

  function redrawAfterDprChange() {
    var canvas = activeChartCanvas;
    installDprWatcher(canvas);
    if (!isOrderflowPageActive(canvas) || !canvas._v6PendingState) return;
    canvas._v6LastDpr = 0;
    V6OF.CanvasChart.draw(canvas);
  }

  function installDprWatcher(canvas) {
    activeChartCanvas = canvas || activeChartCanvas;
    if (!window.matchMedia) return;
    var dpr = window.devicePixelRatio || 1;
    var query = '(resolution: ' + dpr + 'dppx)';
    if (dprMediaQuery && dprMediaQuery.media === query) return;
    removeDprWatcher();
    dprMediaHandler = redrawAfterDprChange;
    dprMediaQuery = window.matchMedia(query);
    if (typeof dprMediaQuery.addEventListener === 'function') {
      dprMediaQuery.addEventListener('change', dprMediaHandler);
    } else if (typeof dprMediaQuery.addListener === 'function') {
      dprMediaQuery.addListener(dprMediaHandler);
    }
  }

  V6OF.register('UI', 'CanvasChart', {
    draw: function (canvas, state) {
      if (!canvas) return;
      activeChartCanvas = canvas;
      installDprWatcher(canvas);
      ensureCountdownTicker(canvas);
      if (state) canvas._v6PendingState = state;
      if (canvas._v6DrawQueued) return;
      canvas._v6DrawQueued = true;
      var schedule = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame  // RAF auto-pauses when tab is hidden
        : function (fn) { return setTimeout(fn, 33); };
      schedule(function () {
        canvas._v6DrawQueued = false;
        internalDraw(canvas, canvas._v6PendingState);
      });
    },
    drawNow: function (canvas, state) {
      if (!canvas) return;
      activeChartCanvas = canvas;
      installDprWatcher(canvas);
      ensureCountdownTicker(canvas);
      if (state) canvas._v6PendingState = state;
      canvas._v6DrawQueued = false;
      internalDraw(canvas, canvas._v6PendingState);
    },
    redrawOverlay: function (canvas, state) {
      if (!canvas) return;
      if (state) canvas._v6PendingState = state;
      internalDrawOverlay(canvas, canvas._v6PendingState);
    },
    pickCandle: function (canvas, state, x, y) {
      return pickCandleAtPoint(canvas, state || {}, x, y);
    },
    // Exposed so snapTimeToCandle in interactions.js uses the same
    // merged candle array as the chart renderer, preventing crosshair
    // from snapping to 1m footprint candles on higher timeframes.
    mergedCandles: mergedChartCandles,

    // Release all canvas-attached state and module-level references.
    // Call on page unmount to prevent _v6PendingState leaks.
    cleanup: function (canvas) {
      stopCountdownTicker();
      removeDprWatcher();
      activeChartCanvas = null;
      if (canvas) {
        // Canvas-attached state
        canvas._v6PendingState = null;
        canvas._v6DrawQueued = false;
        canvas._v6CountdownLabel = null;
        canvas._v6vp = null;
        canvas._v6suppressBottomGutter = false;
        canvas._v6LastDpr = 0;
        // ResizeObserver
        if (canvas._v6SizeObserver) {
          try { canvas._v6SizeObserver.disconnect(); } catch (_) {}
          canvas._v6SizeObserver = null;
        }
        canvas._v6SizeObserverBound = false;
        canvas._v6SizeCache = null;
      }
      // Global state
      V6OF.chart = null;
      V6OF.chartIsDragging = false;
      _hmCache = null;
      _heatmapBoundsCache = null;
      _heatmapBoundsFirst = null;
      _heatmapBoundsLast = null;
      _heatmapBoundsLen = 0;
      _mergedCandlesCache = null;
      _mergedCandlesSig = '';
      _mergedCandlesVersion = -1;
      _aggregatedFpCache = null;
      _aggregatedFpSrc = null;
      _aggregatedFpTf = '';
      _boundsCache = null;
      _boundsSrcFrames = null;
      _boundsSrcCandles = null;
      _boundsSrcHeatmap = null;
      _boundsVersion = -1;
      _emaCache = {};
      _vwapCache = null;
      _paletteCache = null;
      _paletteSig = '';
    }
  }, 'CanvasChart');

  function drawTimelineBookmarks(ctx, vp, plot, state, canvas) {
    var settings = state.settings || {};
    var r = V6OF.resolveSettings(settings);
    var bookmarks = [];

    // 1. User Markers
    var userMarkers = r.markers || [];
    userMarkers.forEach(function (m) {
      bookmarks.push({
        ts: Number(m.ts),
        text: String(m.text),
        type: 'user',
        color: '#06b6d4'
      });
    });

    // 2. Setup Tags (Journal Trades)
    var journalTrades = state.journalTrades || [];
    journalTrades.forEach(function (t) {
      var label = (t.strategy || 'Trade') + (t.tags ? ' [' + t.tags + ']' : '');
      if (t.direction) label = t.direction.toUpperCase() + ': ' + label;
      if (t.pnl != null) label += ' (' + (t.pnl >= 0 ? '+' : '') + Number(t.pnl).toFixed(0) + '$)';
      bookmarks.push({
        ts: Date.parse(t.created_at),
        text: label,
        type: 'setup',
        color: '#a855f7'
      });
    });

    // 3. Replay Events
    var replayEvents = state.replayEvents || [];
    replayEvents.forEach(function (e) {
      bookmarks.push({
        ts: Number(e.ts),
        text: String(e.text),
        type: 'replay',
        color: '#f97316'
      });
    });

    // 4. Engine Signals
    var footprintCandles = state.footprintCandles || [];
    footprintCandles.forEach(function (c) {
      var signals = [];
      if (c.hasBuyAbsorption) signals.push('Buy Absorption');
      if (c.hasSellAbsorption) signals.push('Sell Absorption');
      if (c.isExhaustionHigh) signals.push('Exhaustion High');
      if (c.isExhaustionLow) signals.push('Exhaustion Low');
      if (c.isUnfinishedHigh) signals.push('Unfinished High');
      if (c.isUnfinishedLow) signals.push('Unfinished Low');
      if (signals.length > 0) {
        bookmarks.push({
          ts: Number(c.openTime),
          text: 'Engine: ' + signals.join(', '),
          type: 'engine',
          color: '#10b981'
        });
      }
    });

    if (!bookmarks.length) return;

    var by = plot.top + plot.height;
    var cross = V6OF.getChartCrosshair ? V6OF.getChartCrosshair(canvas) : V6OF._fallbackChartCrosshair;
    var hoveredBookmark = null;

    ctx.save();

    bookmarks.forEach(function (b) {
      if (!Number.isFinite(b.ts)) return;
      var x = vp.timeToX(b.ts);
      if (x < plot.left || x > plot.left + plot.width) return;

      // Vertical dashed line in chart area
      ctx.save();
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.moveTo(x, plot.top);
      ctx.lineTo(x, by);
      ctx.stroke();
      ctx.restore();

      // Line indicator on timeline top
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, by);
      ctx.lineTo(x, by + 8);
      ctx.stroke();

      // Dot on timeline
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(x, by + 4, 3, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#080b12';
      ctx.lineWidth = 1;
      ctx.stroke();

      if (cross && cross.visible && Math.abs(cross.x - x) <= 12) {
        hoveredBookmark = b;
      }
    });

    // Draw floating tooltip card on hover
    if (hoveredBookmark && cross && cross.visible) {
      var b = hoveredBookmark;
      var titleText = b.type.toUpperCase() + ' BOOKMARK';
      var contentText = b.text;
      var timeText = V6OF.format.time(b.ts);
      var lines = [titleText, contentText, 'Time: ' + timeText];

      ctx.font = '10px JetBrains Mono, Consolas, monospace';
      var pw = Math.max(160, Math.max(ctx.measureText(contentText).width + 16, ctx.measureText(titleText).width + 24));
      var ph = 8 + lines.length * 16 + 4;
      var px = cross.x + 14;
      var py = (cross.y != null ? cross.y : by - 60) - ph / 2;

      if (px + pw > plot.left + plot.width) px = cross.x - pw - 14;
      if (py < plot.top) py = plot.top + 4;
      if (py + ph > plot.top + plot.height) py = plot.top + plot.height - ph - 4;

      ctx.fillStyle = 'rgba(8, 11, 18, 0.94)';
      ctx.fillRect(px, py, pw, ph);

      ctx.strokeStyle = b.color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(px, py, pw, ph);

      ctx.fillStyle = b.color;
      ctx.font = 'bold 10px Inter, system-ui, sans-serif';
      ctx.fillText(titleText, px + 8, py + 16);

      ctx.fillStyle = '#f8fafc';
      ctx.font = '11px Inter, system-ui, sans-serif';
      ctx.fillText(contentText, px + 8, py + 32);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '10px JetBrains Mono, Consolas, monospace';
      ctx.fillText('Time: ' + timeText, px + 8, py + 48);
    }

    ctx.restore();
  }

  function findClosestCandleTime(timeMs, candles) {
    if (!candles || !candles.length) return timeMs;
    var closest = candles[0];
    var minDist = Math.abs(candleStartTs(closest) - timeMs);
    for (var i = 1; i < candles.length; i++) {
      var dist = Math.abs(candleStartTs(candles[i]) - timeMs);
      if (dist < minDist) {
        minDist = dist;
        closest = candles[i];
      }
    }
    return candleStartTs(closest);
  }

  function drawVolumeProfile(ctx, vp, plot, state, canvas) {
    var settings = state.settings || {};
    if (!settings.showVolumeProfile) return;

    var volumeProfileType = settings.volumeProfileType || 'visible';
    var volumeProfileSide = settings.volumeProfileSide || 'right';
    var volumeProfileStyle = settings.volumeProfileStyle || 'volume';
    var volumeProfileValueArea = settings.volumeProfileValueArea || 70;
    var volumeProfileFixedStart = settings.volumeProfileFixedStart || 0;
    var volumeProfileFixedEnd = settings.volumeProfileFixedEnd || 0;
    var volumeProfileShowPocTrail = settings.volumeProfileShowPocTrail === true;

    // Check if dragging is active in ChartInteractions
    var drag = V6OF.ChartInteractions && V6OF.ChartInteractions.state && V6OF.ChartInteractions.state.drag;
    if (drag && drag.active && drag.fixedStart != null && drag.fixedEnd != null) {
      volumeProfileFixedStart = drag.fixedStart;
      volumeProfileFixedEnd = drag.fixedEnd;
    }

    var candles = state.footprintCandles || [];
    if (!candles.length) return;

    var filteredCandles = [];
    if (volumeProfileType === 'visible') {
      for (var i = 0; i < candles.length; i++) {
        var c = candles[i];
        var cS = candleStartTs(c);
        var cE = candleEndTs(c);
        if (cE >= vp.timeStart && cS <= vp.timeEnd) {
          filteredCandles.push(c);
        }
      }
    } else if (volumeProfileType === 'session') {
      var refCandle = null;
      for (var i = candles.length - 1; i >= 0; i--) {
        var c = candles[i];
        if (candleEndTs(c) >= vp.timeStart && candleStartTs(c) <= vp.timeEnd) {
          refCandle = c;
          break;
        }
      }
      if (!refCandle) refCandle = candles[candles.length - 1];
      var refDate = new Date(candleStartTs(refCandle));
      var refDay = refDate.getUTCDate();
      var refMonth = refDate.getUTCMonth();
      var refYear = refDate.getUTCFullYear();

      for (var i = 0; i < candles.length; i++) {
        var c = candles[i];
        var d = new Date(candleStartTs(c));
        if (d.getUTCDate() === refDay && d.getUTCMonth() === refMonth && d.getUTCFullYear() === refYear) {
          filteredCandles.push(c);
        }
      }
    } else if (volumeProfileType === 'fixed') {
      var fStart = volumeProfileFixedStart;
      var fEnd = volumeProfileFixedEnd;
      if (!fStart || !fEnd) {
        var span = vp.timeEnd - vp.timeStart;
        fStart = vp.timeStart + span * 0.25;
        fEnd = vp.timeStart + span * 0.75;
        fStart = findClosestCandleTime(fStart, candles);
        fEnd = findClosestCandleTime(fEnd, candles);
      }
      for (var i = 0; i < candles.length; i++) {
        var c = candles[i];
        var cS = candleStartTs(c);
        if (cS >= fStart && cS <= fEnd) {
          filteredCandles.push(c);
        }
      }
    } else {
      // composite
      filteredCandles = candles;
    }

    if (!filteredCandles.length) return;

    var tick = Number(settings.tickSize || 1);
    if (!Number.isFinite(tick) || tick <= 0) tick = 1;

    // Dynamic Binning
    var minPrice = Infinity;
    var maxPrice = -Infinity;
    filteredCandles.forEach(function (c) {
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
    });
    if (minPrice === Infinity || maxPrice === -Infinity) return;

    var diff = maxPrice - minPrice;
    var tickCount = diff / tick;
    var binFactor = 1;
    if (tickCount > 200) {
      binFactor = Math.ceil(tickCount / 200);
    }
    var stepSize = tick * binFactor;

    var precision = 0;
    if (stepSize < 1) {
      var s = String(stepSize);
      var dot = s.indexOf('.');
      if (dot >= 0) precision = s.length - dot - 1;
    }

    // Aggregating
    var profile = {}; // key -> { price: number, buyVol: number, sellVol: number, totalVol: number }
    filteredCandles.forEach(function (c) {
      var lvs = Array.isArray(c.levels) ? c.levels : [];
      lvs.forEach(function (lv) {
        var price = Number(lv.price);
        if (!Number.isFinite(price)) return;
        var roundedPrice = Math.round(price / stepSize) * stepSize;
        var key = roundedPrice.toFixed(precision);
        if (!profile[key]) {
          profile[key] = { price: roundedPrice, buyVol: 0, sellVol: 0, totalVol: 0 };
        }
        profile[key].buyVol += Number(lv.buyVol || 0);
        profile[key].sellVol += Number(lv.sellVol || 0);
        profile[key].totalVol += Number(lv.buyVol || 0) + Number(lv.sellVol || 0);
      });
    });

    var levels = Object.values(profile).sort(function (a, b) { return a.price - b.price; });
    if (!levels.length) return;

    var maxVol = 0;
    var pocLevel = null;
    levels.forEach(function (lv) {
      if (lv.totalVol > maxVol) {
        maxVol = lv.totalVol;
        pocLevel = lv;
      }
    });
    if (!pocLevel) return;
    var pocPrice = pocLevel.price;

    // Value Area Expansion
    var totalVolume = 0;
    levels.forEach(function (lv) { totalVolume += lv.totalVol; });
    var targetVolume = totalVolume * (volumeProfileValueArea / 100);

    var pocIdx = levels.indexOf(pocLevel);
    var valIdx = pocIdx;
    var vahIdx = pocIdx;
    var currentVolume = pocLevel.totalVol;

    while (currentVolume < targetVolume && (valIdx > 0 || vahIdx < levels.length - 1)) {
      var prevVol = 0;
      if (valIdx > 0) prevVol = levels[valIdx - 1].totalVol;
      var nextVol = 0;
      if (vahIdx < levels.length - 1) nextVol = levels[vahIdx + 1].totalVol;

      if (valIdx > 0 && (vahIdx >= levels.length - 1 || prevVol >= nextVol)) {
        valIdx--;
        currentVolume += prevVol;
      } else if (vahIdx < levels.length - 1) {
        vahIdx++;
        currentVolume += nextVol;
      } else {
        break;
      }
    }

    var valPrice = levels[valIdx] ? levels[valIdx].price : levels[0].price;
    var vahPrice = levels[vahIdx] ? levels[vahIdx].price : levels[levels.length - 1].price;

    var profileWidth = Math.min(265, Math.max(170, plot.width * 0.23));
    var left, right;
    if (volumeProfileSide === 'left') {
      left = plot.left;
      right = left + profileWidth;
    } else {
      right = plot.left + plot.width;
      left = right - profileWidth;
    }

    // Shading container background
    ctx.save();
    ctx.fillStyle = settings.theme === 'dark-tv' ? 'rgba(30, 34, 45, 0.45)' : 'rgba(255, 255, 255, 0.6)';
    ctx.fillRect(left, plot.top, profileWidth, plot.height);

    ctx.strokeStyle = settings.theme === 'dark-tv' ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (volumeProfileSide === 'left') {
      ctx.moveTo(right, plot.top);
      ctx.lineTo(right, plot.top + plot.height);
    } else {
      ctx.moveTo(left, plot.top);
      ctx.lineTo(left, plot.top + plot.height);
    }
    ctx.stroke();
    ctx.restore();

    // Render title
    ctx.save();
    ctx.fillStyle = settings.theme === 'dark-tv' ? 'rgba(209, 212, 220, 0.45)' : 'rgba(67, 70, 81, 0.55)';
    ctx.font = '700 9px "JetBrains Mono", Consolas, monospace';
    ctx.fillText(volumeProfileType.toUpperCase() + ' PROFILE (' + volumeProfileStyle.toUpperCase() + ')', left + 8, plot.top + 16);
    ctx.restore();

    // Clip profile drawing to plot rect
    ctx.save();
    ctx.beginPath();
    ctx.rect(plot.left, plot.top, plot.width, plot.height);
    ctx.clip();

    var upHex = settings.upColor || '#089981';
    var downHex = settings.downColor || '#f23645';

    levels.forEach(function (lv) {
      var y = vp.priceToY(lv.price);
      if (y < plot.top - 10 || y > plot.top + plot.height + 10) return;

      var yTop = vp.priceToY(lv.price + stepSize);
      var rowHeight = Math.max(1, Math.abs(y - yTop));
      var rowPixels = Math.max(1, Math.min(18, rowHeight));

      var totalWidth = maxVol ? (lv.totalVol / maxVol) * profileWidth : 0;
      if (totalWidth <= 0) return;

      var inValue = lv.price >= valPrice && lv.price <= vahPrice;
      ctx.save();

      if (volumeProfileStyle === 'volume') {
        var buyWidth = lv.totalVol ? totalWidth * (lv.buyVol / lv.totalVol) : 0;
        var sellWidth = lv.totalVol ? totalWidth * (lv.sellVol / lv.totalVol) : 0;

        ctx.globalAlpha = inValue ? 0.55 : 0.20;

        if (volumeProfileSide === 'right') {
          ctx.fillStyle = downHex;
          ctx.fillRect(right - totalWidth, y - rowPixels / 2, sellWidth, rowPixels - 0.5);
          ctx.fillStyle = upHex;
          ctx.fillRect(right - totalWidth + sellWidth, y - rowPixels / 2, buyWidth, rowPixels - 0.5);
        } else {
          ctx.fillStyle = downHex;
          ctx.fillRect(left, y - rowPixels / 2, sellWidth, rowPixels - 0.5);
          ctx.fillStyle = upHex;
          ctx.fillRect(left + sellWidth, y - rowPixels / 2, buyWidth, rowPixels - 0.5);
        }
      } else if (volumeProfileStyle === 'delta') {
        var delta = lv.buyVol - lv.sellVol;
        var deltaPercent = lv.totalVol ? Math.abs(delta) / maxVol : 0;
        var deltaWidth = deltaPercent * profileWidth;

        ctx.globalAlpha = inValue ? 0.65 : 0.22;

        if (delta === 0) {
          ctx.fillStyle = '#64748b'; // Gray for neutral
          if (volumeProfileSide === 'right') {
            ctx.fillRect(right - 2, y - rowPixels / 2, 2, rowPixels - 0.5);
          } else {
            ctx.fillRect(left, y - rowPixels / 2, 2, rowPixels - 0.5);
          }
        } else {
          ctx.fillStyle = delta > 0 ? upHex : downHex;
          if (volumeProfileSide === 'right') {
            ctx.fillRect(right - deltaWidth, y - rowPixels / 2, deltaWidth, rowPixels - 0.5);
          } else {
            ctx.fillRect(left, y - rowPixels / 2, deltaWidth, rowPixels - 0.5);
          }
        }
      } else if (volumeProfileStyle === 'split') {
        var center = left + profileWidth / 2;
        var maxHalfWidth = (profileWidth - 6) / 2;
        var buyWidth = maxVol ? (lv.buyVol / maxVol) * maxHalfWidth * 2 : 0;
        var sellWidth = maxVol ? (lv.sellVol / maxVol) * maxHalfWidth * 2 : 0;

        ctx.globalAlpha = inValue ? 0.55 : 0.20;

        ctx.fillStyle = upHex;
        ctx.fillRect(center - buyWidth, y - rowPixels / 2, buyWidth, rowPixels - 0.5);
        ctx.fillStyle = downHex;
        ctx.fillRect(center, y - rowPixels / 2, sellWidth, rowPixels - 0.5);

        ctx.fillStyle = 'rgba(148, 163, 184, 0.2)';
        ctx.fillRect(center - 0.5, y - rowPixels / 2, 1, rowPixels - 0.5);
      }

      ctx.restore();
    });
    ctx.restore(); // restore clipping

    // Draw reference lines
    function drawValLabel(labelX, labelY, text, color, align) {
      ctx.save();
      ctx.font = 'bold 9px "JetBrains Mono", Consolas, monospace';
      var w = ctx.measureText(text).width + 8;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      var lx = align === 'right' ? labelX - w : labelX;
      ctx.fillRect(lx, labelY - 7, w, 14);
      ctx.fillStyle = color;
      ctx.fillText(text, lx + 4, labelY + 3);
      ctx.restore();
    }

    if (pocPrice >= vp.priceMin && pocPrice <= vp.priceMax) {
      var pocY = vp.priceToY(pocPrice);
      ctx.save();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(plot.left, pocY);
      ctx.lineTo(plot.left + plot.width, pocY);
      ctx.stroke();
      ctx.restore();

      drawValLabel(volumeProfileSide === 'right' ? right : left, pocY, 'POC ' + pocPrice.toFixed(precision), '#f59e0b', volumeProfileSide);
    }

    if (vahPrice >= vp.priceMin && vahPrice <= vp.priceMax) {
      var vahY = vp.priceToY(vahPrice);
      ctx.save();
      ctx.strokeStyle = '#38d3ee';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(plot.left, vahY);
      ctx.lineTo(plot.left + plot.width, vahY);
      ctx.stroke();
      ctx.restore();

      drawValLabel(volumeProfileSide === 'right' ? right : left, vahY, 'VAH ' + vahPrice.toFixed(precision), '#38d3ee', volumeProfileSide);
    }

    if (valPrice >= vp.priceMin && valPrice <= vp.priceMax) {
      var valY = vp.priceToY(valPrice);
      ctx.save();
      ctx.strokeStyle = '#fb7185';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(plot.left, valY);
      ctx.lineTo(plot.left + plot.width, valY);
      ctx.stroke();
      ctx.restore();

      drawValLabel(volumeProfileSide === 'right' ? right : left, valY, 'VAL ' + valPrice.toFixed(precision), '#fb7185', volumeProfileSide);
    }

    // POC Trail (restricted to visible viewport)
    if (volumeProfileShowPocTrail) {
      var trailCandles = [];
      for (var i = 0; i < candles.length; i++) {
        var c = candles[i];
        var tS = candleStartTs(c);
        var tE = candleEndTs(c);
        if (tE >= vp.timeStart && tS <= vp.timeEnd) {
          trailCandles.push(c);
        }
      }
      if (trailCandles.length > 1) {
        ctx.save();
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        var started = false;
        trailCandles.forEach(function (c) {
          var pocVal = Number(c.poc);
          if (!Number.isFinite(pocVal) || pocVal < vp.priceMin || pocVal > vp.priceMax) return;
          var cx = vp.timeToX((candleStartTs(c) + candleEndTs(c)) / 2);
          var cy = vp.priceToY(pocVal);
          if (!started) {
            ctx.moveTo(cx, cy);
            started = true;
          } else {
            ctx.lineTo(cx, cy);
          }
        });
        ctx.stroke();
        ctx.restore();
      }
    }

    // Fixed Range Interactive lines
    if (volumeProfileType === 'fixed') {
      var fStart = volumeProfileFixedStart;
      var fEnd = volumeProfileFixedEnd;
      if (!fStart || !fEnd) {
        var span = vp.timeEnd - vp.timeStart;
        fStart = vp.timeStart + span * 0.25;
        fEnd = vp.timeStart + span * 0.75;
        fStart = findClosestCandleTime(fStart, candles);
        fEnd = findClosestCandleTime(fEnd, candles);
      }

      var startX = vp.timeToX(fStart);
      var endX = vp.timeToX(fEnd);

      // Range Shading
      ctx.save();
      ctx.fillStyle = settings.theme === 'dark-tv' ? 'rgba(245, 158, 11, 0.03)' : 'rgba(245, 158, 11, 0.02)';
      ctx.fillRect(Math.min(startX, endX), plot.top, Math.abs(endX - startX), plot.height);
      ctx.restore();

      // Dashed vertical bounds
      ctx.save();
      ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 4]);

      ctx.beginPath();
      ctx.moveTo(startX, plot.top);
      ctx.lineTo(startX, plot.top + plot.height);
      ctx.moveTo(endX, plot.top);
      ctx.lineTo(endX, plot.top + plot.height);
      ctx.stroke();
      ctx.restore();

      // Handles on Bottom Scale
      var handleY = plot.top + plot.height + 10;
      ctx.save();
      [startX, endX].forEach(function (hx) {
        ctx.fillStyle = '#f59e0b';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(hx, handleY, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
      ctx.restore();
    }
  }
})();
