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
    if (tf !== '1m') return hist.length ? hist : [];
    if (!hist.length) return fp;
    if (!fp.length) return hist;
    var byTime = {};
    var i;
    for (i = 0; i < hist.length; i++) byTime[hist[i].openTime] = hist[i];
    for (i = 0; i < fp.length; i++) byTime[fp[i].openTime] = fp[i];
    var keys = Object.keys(byTime).map(Number).sort(function (a, b) { return a - b; });
    var out = [];
    for (i = 0; i < keys.length; i++) out.push(byTime[keys[i]]);
    var interval = timeframeToMs(tf) || (out.length ? normalizeCandleInterval(out[out.length - 1], 60000) : 60000);
    return fillCandleGaps(out, interval);
  }

  // Price range over only the candles inside the visible time window, so the
  // chart fills vertically at any zoom (TradingView-style autofit).
  function visiblePriceRange(candles, vp, state, showHeatmap) {
    var min = Infinity, max = -Infinity, i;
    for (i = 0; i < candles.length; i++) {
      var c = candles[i];
      var s = candleStartTs(c), e = candleEndTs(c);
      if (e < vp.timeStart || s > vp.timeEnd) continue;
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

  function computeLiveBounds(state, showHeatmap) {
    var frames = showHeatmap && Array.isArray(state.heatmapFrames) ? state.heatmapFrames : [];
    var candles = mergedChartCandles(state);
    var tMin = Infinity, tMax = -Infinity, pMin = Infinity, pMax = -Infinity;

    frames.forEach(function (frame) {
      var ts = frameTs(frame);
      if (ts > 0) { tMin = Math.min(tMin, ts); tMax = Math.max(tMax, ts); }
      if (Number.isFinite(frame.priceMin)) pMin = Math.min(pMin, frame.priceMin);
      if (Number.isFinite(frame.priceMax)) pMax = Math.max(pMax, frame.priceMax);
    });
    candles.forEach(function (candle) {
      var s = candleStartTs(candle), e = candleEndTs(candle);
      if (s > 0) tMin = Math.min(tMin, s);
      if (e > 0) tMax = Math.max(tMax, e);
      if (Number.isFinite(candle.low)) pMin = Math.min(pMin, candle.low);
      if (Number.isFinite(candle.high)) pMax = Math.max(pMax, candle.high);
    });

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
    return bounds;
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
      return pad(d.getDate()) + ' ' + MONTHS_SHORT[d.getMonth()];
    }

    // Step >= 1h → "HH:MM"
    if (step >= 3600000) {
      return pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    // Sub-hour → "HH:MM" (jamais de secondes)
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function timeAxisDate(ts) {
    var d = new Date(ts);
    function pad(n) { return n < 10 ? '0' + n : String(n); }
    return pad(d.getDate()) + ' ' + MONTHS_SHORT[d.getMonth()];
  }

  // Expose time axis helpers for external handling
  V6OF.timeAxisDate = timeAxisDate;

  function drawGridAndScales(ctx, vp, plot, settings) {
    var pTicks = priceTicks(vp.priceMin, vp.priceMax, 6);
    var tInfo = timeTicks(vp.timeStart, vp.timeEnd, 7);

    // Grid lines
    if (settings.showGrid !== false) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.10)';
      pTicks.forEach(function (price) {
        var y = vp.priceToY(price);
        if (y < plot.top - 1 || y > plot.top + plot.height + 1) return;
        ctx.beginPath();
        ctx.moveTo(plot.left, y);
        ctx.lineTo(plot.left + plot.width, y);
        ctx.stroke();
      });
      // Time grid lines (inside the same showGrid block)
      tInfo.ticks.forEach(function (ts) {
      var x = vp.timeToX(ts);
      if (x < plot.left - 1 || x > plot.left + plot.width + 1) return;
      ctx.beginPath();
      ctx.moveTo(x, plot.top);
      ctx.lineTo(x, plot.top + plot.height);
      ctx.stroke();
    });
    } // end showGrid

      // Price scale (right gutter)
    var gx = plot.left + plot.width;
    ctx.fillStyle = 'rgba(9, 13, 20, 0.85)';
    ctx.fillRect(gx, plot.top - PAD_TOP, GUTTER_RIGHT, plot.height + PAD_TOP + GUTTER_BOTTOM);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.beginPath();
    ctx.moveTo(gx + 0.5, plot.top);
    ctx.lineTo(gx + 0.5, plot.top + plot.height);
    ctx.stroke();
    ctx.fillStyle = 'rgba(203, 213, 225, 0.78)';
    ctx.font = '10px JetBrains Mono, Consolas, monospace';
    ctx.textAlign = 'left';
    pTicks.forEach(function (price) {
      var y = vp.priceToY(price);
      if (y < plot.top + 4 || y > plot.top + plot.height - 2) return;
      ctx.fillText(V6OF.format.price(price), gx + 5, y + 3);
    });

    // Time scale (bottom)
    var by = plot.top + plot.height;
    ctx.fillStyle = 'rgba(9, 13, 20, 0.85)';
    ctx.fillRect(plot.left, by, plot.width, GUTTER_BOTTOM);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.beginPath();
    ctx.moveTo(plot.left, by + 0.5);
    ctx.lineTo(plot.left + plot.width, by + 0.5);
    ctx.stroke();
    ctx.fillStyle = 'rgba(203, 213, 225, 0.78)';
    ctx.font = '10px JetBrains Mono, Consolas, monospace';
    ctx.textAlign = 'center';
    var visibleSpan = vp.timeEnd - vp.timeStart;
    var isMultiDay = visibleSpan > 86400000;
    tInfo.ticks.forEach(function (ts, idx) {
      var x = vp.timeToX(ts);
      if (x < plot.left + 16 || x > plot.left + plot.width - 16) return;
      var d = new Date(ts);
      var dayKey = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
      var prevDayKey = idx > 0 ? (function () {
        var pd = new Date(tInfo.ticks[idx - 1]);
        return pd.getFullYear() + '-' + pd.getMonth() + '-' + pd.getDate();
      })() : null;
      var isNewDay = prevDayKey && dayKey !== prevDayKey;
      
      var label;
      // Always show date+time on the first tick (so you always know the day).
      if (idx === 0) {
        label = V6OF.timeAxisDate(ts) + ' ' + timeAxisLabel(ts, tInfo.step);
      } else if (tInfo.step >= 86400000) {
        // Step >= 1 day → always show "DD Mon"
        label = V6OF.timeAxisDate(ts);
      } else if (isMultiDay && isNewDay) {
        // Span covers multiple days → show "DD Mon HH:MM" on day boundaries
        label = V6OF.timeAxisDate(ts) + ' ' + timeAxisLabel(ts, tInfo.step);
      } else if (isNewDay) {
        label = V6OF.timeAxisDate(ts);
      } else {
        label = timeAxisLabel(ts, tInfo.step);
      }
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

    // Dark base so the field reads like a true heatmap, not floating blocks.
    ctx.fillStyle = '#05060b';
    ctx.fillRect(plot.left, plot.top, plot.width, plot.height);

    frames.forEach(function (frame, index) {
      var ts = frameTs(frame);
      var nextTs = index + 1 < count ? frameTs(frames[index + 1]) : ts + emit;
      var x = vp.timeToX(ts);
      var x2 = vp.timeToX(nextTs);
      if (x2 < plot.left || x > plot.left + plot.width) return; // cull offscreen
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
    });
    return true;
  }

  function footprintCellColor(level) {
    var delta = Number(level.delta || 0);
    var total = Math.max(0, Number(level.totalVol || 0));
    var alpha = 0.16 + Math.min(0.72, total > 0 ? 0.42 : 0);
    if (delta > 0) return 'rgba(34, 197, 94, ' + alpha.toFixed(3) + ')';
    if (delta < 0) return 'rgba(239, 68, 68, ' + alpha.toFixed(3) + ')';
    return 'rgba(148, 163, 184, 0.24)';
  }

  function drawFootprintVp(ctx, vp, plot, candles, settings, overlay) {
    if (!settings || settings.showFootprint === false) return false;
    if (!Array.isArray(candles) || !candles.length) return false;
    var scaleY = plot.height / vp.priceSpan();
    var tick = Number(settings.tickSize || 1);
    if (!Number.isFinite(tick) || tick <= 0) tick = 1;

    candles.forEach(function (candle) {
      var x1 = vp.timeToX(candleStartTs(candle));
      var x2 = vp.timeToX(candleEndTs(candle));
      if (x2 < plot.left || x1 > plot.left + plot.width) return; // cull
      var fullW = Math.max(3, x2 - x1);
      var colW = Math.max(3, Math.min(76, fullW * 0.84));
      var xCenter = (x1 + x2) / 2;
      var x = xCenter - colW / 2;
      var levels = Array.isArray(candle.levels) ? candle.levels : [];

      // overlay = candles already drawn underneath -> draw cells only (no column
      // fill, no duplicate OHLC marks) so the candlesticks stay readable.
      if (!overlay) {
        ctx.fillStyle = 'rgba(15, 23, 42, 0.74)';
        ctx.fillRect(x, plot.top, colW, plot.height);

        var yHigh = vp.priceToY(candle.high);
        var yLow = vp.priceToY(candle.low);
        var yOpen = vp.priceToY(candle.open);
        var yClose = vp.priceToY(candle.close);
        var fpUpHex = (settings && settings.upColor) || '#3ddc97';
        var fpDownHex = (settings && settings.downColor) || '#ff5f73';
        var fpCol = candle.close >= candle.open ? hexToRgba(fpUpHex, 0.92) : hexToRgba(fpDownHex, 0.92);
        ctx.strokeStyle = fpCol;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xCenter, yHigh);
        ctx.lineTo(xCenter, yLow);
        ctx.moveTo(xCenter - colW * 0.24, yOpen);
        ctx.lineTo(xCenter, yOpen);
        ctx.moveTo(xCenter, yClose);
        ctx.lineTo(xCenter + colW * 0.24, yClose);
        ctx.stroke();
      }

      var h = Math.max(4, Math.min(16, Math.abs(scaleY * tick) || 8));
      levels.forEach(function (level) {
        var price = Number(level.price);
        if (!Number.isFinite(price) || price < vp.priceMin || price > vp.priceMax) return;
        var y = vp.priceToY(price);
        var isPoc = Number(candle.poc) === price;
        ctx.fillStyle = footprintCellColor(level);
        ctx.fillRect(x + 1, y - h / 2, colW - 2, h);
        if (isPoc) {
          ctx.strokeStyle = 'rgba(248, 195, 93, 0.96)';
          ctx.lineWidth = 1.4;
          ctx.strokeRect(x + 1.5, y - h / 2 + 0.5, colW - 3, h - 1);
        }
        if (colW >= 48 && h >= 9) {
          ctx.fillStyle = 'rgba(248, 250, 252, 0.88)';
          ctx.font = '9px JetBrains Mono, Consolas, monospace';
          ctx.fillText(V6OF.format.signed(Number(level.delta || 0)), x + 4, y + 3);
        }
      });
    });
    return true;
  }

  // Plain candlesticks (base layer) from footprint OHLC, in the viewport space.
  function drawCandlesVp(ctx, vp, plot, candles, settings) {
    if (!Array.isArray(candles) || !candles.length) return false;
    var upHex = (settings && settings.upColor) || '#3ddc97';
    var downHex = (settings && settings.downColor) || '#ff5f73';
    candles.forEach(function (c) {
      if (!Number.isFinite(c.open) || !Number.isFinite(c.close)) return;
      var x1 = vp.timeToX(candleStartTs(c));
      var x2 = vp.timeToX(candleEndTs(c));
      if (x2 < plot.left || x1 > plot.left + plot.width) return; // cull
      var fullW = Math.max(2, x2 - x1);
      var bodyW = Math.max(1, Math.min(28, fullW * 0.6));
      var xc = (x1 + x2) / 2;
      var up = c.close >= c.open;
      var col = up ? upHex : downHex;
      var yOpen = vp.priceToY(c.open);
      var yClose = vp.priceToY(c.close);
      if (c.synthetic) {
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xc - Math.max(2, bodyW * 0.35), yClose);
        ctx.lineTo(xc + Math.max(2, bodyW * 0.35), yClose);
        ctx.stroke();
        return;
      }
      ctx.strokeStyle = hexToRgba(col, 0.96);
      ctx.fillStyle = hexToRgba(col, 0.96);
      ctx.lineWidth = 1;
      // wick
      ctx.beginPath();
      ctx.moveTo(xc, vp.priceToY(c.high));
      ctx.lineTo(xc, vp.priceToY(c.low));
      ctx.stroke();
      // body
      var top = Math.min(yOpen, yClose);
      var bh = Math.max(1, Math.abs(yClose - yOpen));
      ctx.fillRect(xc - bodyW / 2, top, bodyW, bh);
    });
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
    for (i = 0; i < candles.length; i++) {
      c = candles[i];
      var s = candleStartTs(c), e = candleEndTs(c);
      if (e < vp.timeStart || s > vp.timeEnd) continue;
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
    var lh = 15;
    var pw = 156, ph = 4 + lines.length * lh + 6;
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
    var snappedTs = vp.xToTime(snappedX);
    var isMultiDayReadout = (vp.timeEnd - vp.timeStart) > 86400000;
    var timeText = isMultiDayReadout
      ? (V6OF.timeAxisDate(snappedTs) + ' ' + timeAxisLabel(snappedTs, 1000))
      : timeAxisLabel(snappedTs, 1000);
    var tw = isMultiDayReadout ? 100 : 58;
    ctx.fillStyle = 'rgba(56, 211, 238, 0.95)';
    ctx.fillRect(snappedX - tw / 2, plot.top + plot.height, tw, GUTTER_BOTTOM - 2);
    ctx.fillStyle = '#04121a';
    ctx.font = 'bold ' + (isMultiDayReadout ? '9' : '10') + 'px JetBrains Mono, Consolas, monospace';
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
    var showHeatmap = settings.showHeatmap === true;
    var showFootprint = settings.showFootprint === true;
    var showCandles = settings.showCandles !== false;

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
    if (settings.showBubbles === true) {
      drawBubblesVp(ctx, vp, plot, baseCandles);
    }
    if (showCandles && baseCandles.length) drawCandlesVp(ctx, vp, plot, baseCandles, settings);
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
        var lastColor = 'rgba(236, 252, 203, 0.95)';
        // Dashed line spanning chart + extending into price axis
        ctx.strokeStyle = lastColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(plot.left, lastY);
        ctx.lineTo(plot.left + plot.width + GUTTER_RIGHT - 10, lastY);
        ctx.stroke();
        ctx.setLineDash([]);
        // Dot at the price axis endpoint
        ctx.fillStyle = lastColor;
        ctx.beginPath();
        ctx.arc(plot.left + plot.width + GUTTER_RIGHT - 10, lastY, 3, 0, Math.PI * 2);
        ctx.fill();
        // Price label on the axis
        ctx.fillStyle = lastColor;
        ctx.font = 'bold 10px JetBrains Mono, Consolas, monospace';
        ctx.textAlign = 'right';
        ctx.fillText(V6OF.format.price(lastPrice), plot.left + plot.width + GUTTER_RIGHT - 4, lastY + 4);
      }
    }
    if (showFootprint && lastCandle) drawPriceLineVp(ctx, vp, plot, Number(lastCandle.poc), 'rgba(248, 195, 93, 0.94)', 'POC', true);
    // VWAP removed — keep chart clean
    // if (settings.showVwap !== false && state.vwap && Number.isFinite(state.vwap.value)) {
    //   drawPriceLineVp(ctx, vp, plot, Number(state.vwap.value),
    //     state.vwap.isWarm ? 'rgba(245, 158, 11, 0.92)' : 'rgba(245, 158, 11, 0.6)', 'VWAP', true);
    // }

    drawCrosshair(ctx, vp, plot, baseCandles);
    drawLiveInfo(ctx, vp, plot, state, settings);
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
    }
  };

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
