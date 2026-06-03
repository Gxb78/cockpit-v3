// ---------- 083_v6_chart_viewport.js ----------
// Phase 17: Chart viewport model for Cockpit V6 orderflow.
// Owns the price/time coordinate system used by the canvas chart engine.
// UI-only. No network, no engine changes. Canvas 2D coordinates.
//
// A viewport maps a (time, price) data window onto a pixel "plot" rectangle.
//   timeStart..timeEnd  -> plot.left..plot.left+plot.width   (X, time grows right)
//   priceMax..priceMin  -> plot.top..plot.top+plot.height    (Y, price grows up)
//
// followLive: keep the current time span but slide the right edge to the newest
//             data timestamp. Disabled automatically when the user pans/zooms back.
// autoFit:    recompute the price range from visible data each frame. Disabled
//             automatically when the user zooms/pans the price axis.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};

  // Hard limits to avoid degenerate / crashing viewports.
  var MIN_TIME_SPAN_MS = 4000;            // 4s
  var MAX_TIME_SPAN_MS = 365 * 24 * 3600 * 1000; // 1an (pour daily 1440 bougies)
  var MIN_PRICE_SPAN = 0.5;               // absolute price units
  var LIVE_EDGE_PAD_RATIO = 0.04;         // keep newest data slightly off the right edge

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  function create(options) {
    options = options || {};

    var vp = {
      // Data window
      timeStart: 0,
      timeEnd: 0,
      priceMin: 0,
      priceMax: 1,
      // Behaviour flags
      followLive: true,
      autoFit: true,
      // Pixel plot rect (set every draw by the renderer)
      plot: { left: 0, top: 0, width: 1, height: 1 },
      // Last data extents seen (for fit / reset / follow)
      dataTimeMin: 0,
      dataTimeMax: 0,
      dataPriceMin: 0,
      dataPriceMax: 1,
      // True once the viewport has been seeded from real data at least once.
      initialized: false
    };

    function timeSpan() {
      var span = vp.timeEnd - vp.timeStart;
      return span > 0 ? span : MIN_TIME_SPAN_MS;
    }

    function priceSpan() {
      var span = vp.priceMax - vp.priceMin;
      return span > 0 ? span : MIN_PRICE_SPAN;
    }

    // ---- Coordinate transforms ----
    vp.timeToX = function (ts) {
      var p = vp.plot;
      return p.left + (ts - vp.timeStart) / timeSpan() * p.width;
    };
    vp.xToTime = function (x) {
      var p = vp.plot;
      return vp.timeStart + (x - p.left) / p.width * timeSpan();
    };
    vp.priceToY = function (price) {
      var p = vp.plot;
      return p.top + (vp.priceMax - price) / priceSpan() * p.height;
    };
    vp.yToPrice = function (y) {
      var p = vp.plot;
      return vp.priceMax - (y - p.top) / p.height * priceSpan();
    };

    vp.setPlot = function (rect) {
      if (!rect) return;
      vp.plot = {
        left: isNum(rect.left) ? rect.left : 0,
        top: isNum(rect.top) ? rect.top : 0,
        width: Math.max(1, isNum(rect.width) ? rect.width : 1),
        height: Math.max(1, isNum(rect.height) ? rect.height : 1)
      };
    };

    vp.timeSpan = timeSpan;
    vp.priceSpan = priceSpan;

    // ---- Explicit range setters (used by interactions / external code) ----
    vp.setTimeRange = function (start, end) {
      if (!isNum(start) || !isNum(end) || end <= start) return;
      var span = clamp(end - start, MIN_TIME_SPAN_MS, MAX_TIME_SPAN_MS);
      vp.timeStart = end - span;
      vp.timeEnd = end;
    };

    vp.setPriceRange = function (min, max) {
      if (!isNum(min) || !isNum(max) || max <= min) return;
      if (max - min < MIN_PRICE_SPAN) {
        var mid = (min + max) / 2;
        min = mid - MIN_PRICE_SPAN / 2;
        max = mid + MIN_PRICE_SPAN / 2;
      }
      vp.priceMin = min;
      vp.priceMax = max;
      vp.autoFit = false;
    };

    // ---- Data sync (called by the renderer each frame) ----
    // bounds = { timeMin, timeMax, priceMin, priceMax }
    vp.syncToData = function (bounds) {
      if (!bounds) return;
      var hasTime = isNum(bounds.timeMin) && isNum(bounds.timeMax) && bounds.timeMax > bounds.timeMin;
      var hasPrice = isNum(bounds.priceMin) && isNum(bounds.priceMax) && bounds.priceMax > bounds.priceMin;

      if (hasTime) {
        vp.dataTimeMin = bounds.timeMin;
        vp.dataTimeMax = bounds.timeMax;
      }
      // Store candle interval for snap-to-candle panning
      if (isNum(bounds.candleIntervalMs) && bounds.candleIntervalMs >= 1000) {
        vp.candleIntervalMs = bounds.candleIntervalMs;
      }
      if (hasPrice) {
        vp.dataPriceMin = bounds.priceMin;
        vp.dataPriceMax = bounds.priceMax;
      }

      // First real data: seed a default window showing ~80 candles.
      // For 1m data that's ~1h20, for 1h data ~3.3d, for 1d data ~3mo.
      if (!vp.initialized && (hasTime || hasPrice)) {
        if (hasTime) {
          var TARGET_CANDLES = 80;
          // Estimate candle interval, default to 1m. This ensures a stable
          // 80-candle view regardless of how much data has been loaded so far.
          var interval = Math.max(1000, Number(bounds.candleIntervalMs) || 60000);
          var span = clamp(interval * TARGET_CANDLES, MIN_TIME_SPAN_MS, MAX_TIME_SPAN_MS);
          var pad = span * LIVE_EDGE_PAD_RATIO;
          vp.timeEnd = bounds.timeMax + pad;
          vp.timeStart = vp.timeEnd - span;
        }
        if (hasPrice) {
          // Zoom prix serré: utiliser un pourcentage du range total plutôt que
          // le min-max complet, sinon les bougies sont écrasées.
          // On prend les ~20 dernières bougies pour un cadrage tight (max 30% du range total).
          var totalRange = bounds.priceMax - bounds.priceMin;
          var tightRange = totalRange * 0.30;
          if (tightRange < MIN_PRICE_SPAN) tightRange = MIN_PRICE_SPAN;
          var mid = (bounds.priceMax + bounds.priceMin) / 2;
          vp.priceMin = mid - tightRange / 2;
          vp.priceMax = mid + tightRange / 2;
        }
        vp.initialized = true;
        return;
      }

      // Follow live: keep current span, slide right edge to newest data.
      if (hasTime && vp.followLive) {
        var keep = timeSpan();
        var pad2 = keep * LIVE_EDGE_PAD_RATIO;
        vp.timeEnd = bounds.timeMax + pad2;
        vp.timeStart = vp.timeEnd - keep;
      }

      // Auto fit price to visible data.
      if (hasPrice && vp.autoFit) {
        vp.priceMin = bounds.priceMin;
        vp.priceMax = bounds.priceMax;
      }
    };

    // ---- Fit / reset / follow ----
    vp.fitToData = function () {
      if (vp.dataTimeMax > vp.dataTimeMin) {
        var span = clamp(vp.dataTimeMax - vp.dataTimeMin, MIN_TIME_SPAN_MS, MAX_TIME_SPAN_MS);
        var pad = span * LIVE_EDGE_PAD_RATIO;
        vp.timeEnd = vp.dataTimeMax + pad;
        vp.timeStart = vp.timeEnd - span;
      }
      if (vp.dataPriceMax > vp.dataPriceMin) {
        vp.priceMin = vp.dataPriceMin;
        vp.priceMax = vp.dataPriceMax;
      }
      vp.followLive = true;
      vp.autoFit = true;
    };

    // Reset viewport initialization so the next syncToData() re-computes
    // the initial view from scratch. Used when changing timeframe/symbol
    // where the new data has a completely different time range.
    vp.resetOnDataChange = function () {
      vp.initialized = false;
      vp.autoFit = true;
      vp.followLive = true;
      vp.dataTimeMin = 0;
      vp.dataTimeMax = 0;
      vp.dataPriceMin = 0;
      vp.dataPriceMax = 1;
    };

    vp.resetView = function () {
      vp.fitToData();
    };

    vp.goLive = function () {
      vp.followLive = true;
      if (vp.dataTimeMax > vp.dataTimeMin) {
        var keep = timeSpan();
        var pad = keep * LIVE_EDGE_PAD_RATIO;
        vp.timeEnd = vp.dataTimeMax + pad;
        vp.timeStart = vp.timeEnd - keep;
      }
    };

    // ---- Pan (pixels) ----
    // Panning the chart with drag. No auto re-enable of followLive during pan
    // — that was causing the chart to snap back to the live edge. The user must
    // explicitly click "Follow live" to re-enable it.
    vp.panByPixels = function (dx, dy) {
      var p = vp.plot;
      if (dx) {
        var dt = dx / p.width * timeSpan();
        // Snap to candle interval to get candle-by-candle movement.
        var ci = Math.max(1000, vp.candleIntervalMs || 60000);
        var snapped = Math.round(dt / ci) * ci;
        vp.timeStart -= snapped;
        vp.timeEnd -= snapped;
        // Any pan disables follow-live (user is exploring history).
        vp.followLive = false;
      }
      if (dy) {
        var dp = dy / p.height * priceSpan();
        vp.priceMin += dp;
        vp.priceMax += dp;
        vp.autoFit = false;
      }
    };

    // ---- Zoom (factor < 1 = zoom in, > 1 = zoom out) ----
    vp.zoomTime = function (factor, anchorX) {
      if (!isNum(factor) || factor <= 0) return;
      var anchorTime = isNum(anchorX) ? vp.xToTime(anchorX) : (vp.timeStart + vp.timeEnd) / 2;
      var newSpan = clamp(timeSpan() * factor, MIN_TIME_SPAN_MS, MAX_TIME_SPAN_MS);
      var leftFrac = (anchorTime - vp.timeStart) / timeSpan();
      vp.timeStart = anchorTime - leftFrac * newSpan;
      vp.timeEnd = vp.timeStart + newSpan;
      // Zooming keeps follow-live only if the newest data is still at the edge.
      if (vp.timeEnd < vp.dataTimeMax) vp.followLive = false;
    };

    vp.zoomPrice = function (factor, anchorY) {
      if (!isNum(factor) || factor <= 0) return;
      var anchorPrice = isNum(anchorY) ? vp.yToPrice(anchorY) : (vp.priceMin + vp.priceMax) / 2;
      var newSpan = Math.max(MIN_PRICE_SPAN, priceSpan() * factor);
      var topFrac = (vp.priceMax - anchorPrice) / priceSpan();
      vp.priceMax = anchorPrice + topFrac * newSpan;
      vp.priceMin = vp.priceMax - newSpan;
      vp.autoFit = false;
    };

    return vp;
  }

  V6OF.ChartViewport = { create: create };
})();
