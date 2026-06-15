// ---------- 083_v6_chart_viewport.js ----------
// Chart viewport: owns the price/time coordinate system for the canvas chart engine.
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
  if (!V6OF.register) {
    ['Core', 'Data', 'Transport', 'UI', 'Studies', 'Page'].forEach(function (name) { V6OF[name] = V6OF[name] || {}; });
    V6OF.register = function (domain, name, value, legacyName) {
      V6OF[domain] = V6OF[domain] || {};
      V6OF[domain][name] = value;
      if (legacyName) V6OF[legacyName] = value;
      return value;
    };
  }

  // Hard limits to avoid degenerate / crashing viewports.
  var MIN_TIME_SPAN_MS = 4000;            // 4s
  // Base max span (1 year) for small timeframes. Larger timeframes get a
  // proportionally larger max so daily charts can zoom out to several years.
  var BASE_MAX_TIME_SPAN_MS = 365 * 24 * 3600 * 1000;
  // Max viewable span for a given candle interval. Target: ~5000 candles.
  // 1m -> ~3.5d, 1h -> ~208d, 1d -> ~13.7y, 1w -> ~96y. Floor: 1 year.
  function maxSpanForInterval(intervalMs) {
    if (!isNum(intervalMs) || intervalMs <= 0) intervalMs = 60000;
    return Math.max(BASE_MAX_TIME_SPAN_MS, intervalMs * 5000);
  }
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
    vp.userInteractionAt = 0;

    vp.userInteractionExpiresAt = 0;

    // Mark a user-initiated interaction so that followLive/autoFit don't fight
    // the user. durationMs: how long the lock should hold after the last
    // interaction. Pan/zoom use a short window (3s); programmatic fits
    // should not lock at all.
    vp.markUserInteraction = function (durationMs) {
      var hold = isNum(durationMs) ? durationMs : 3000;
      vp.userInteractionAt = Date.now();
      vp.userInteractionExpiresAt = vp.userInteractionAt + hold;
    };

    vp.hasRecentUserInteraction = function (windowMs) {
      windowMs = isNum(windowMs) ? windowMs : 3000;
      // Active drag always counts as interaction regardless of timestamp.
      if (!!V6OF.chartIsDragging) return true;
      // Use the per-call windowMs if it's longer than the stored expiry,
      // otherwise use the expiry (respects the duration set by markUserInteraction).
      var threshold = Math.max(vp.userInteractionExpiresAt, vp.userInteractionAt + windowMs);
      return vp.userInteractionAt > 0 && Date.now() < threshold;
    };

    // ---- Explicit range setters (used by interactions / external code) ----
    vp.setTimeRange = function (start, end) {
      if (!isNum(start) || !isNum(end) || end <= start) return;
      var maxSpan = maxSpanForInterval(vp.candleIntervalMs);
      var span = clamp(end - start, MIN_TIME_SPAN_MS, maxSpan);
      var mid = (start + end) / 2;
      if (vp.dataTimeMax > vp.dataTimeMin) {
        var dataSpan = vp.dataTimeMax - vp.dataTimeMin;
        // Asymmetric pan limits: allow generous look-ahead on the right
        // (like TradingView — traders need empty space to project levels)
        // but keep the left tighter (scrolling into ancient empty history
        // is useless and wastes render cycles).
        var leftPad = Math.max(dataSpan * 0.5, span * 1.5, 6 * 3600 * 1000);
        var rightPad = Math.max(dataSpan * 1.0, span * 3.0, 24 * 3600 * 1000);
        mid = clamp(mid, vp.dataTimeMin - leftPad, vp.dataTimeMax + rightPad);
      }
      vp.timeStart = mid - span / 2;
      vp.timeEnd = mid + span / 2;
    };

    vp.setPriceRange = function (min, max) {
      if (!isNum(min) || !isNum(max) || max <= min) return;
      var dataSpan = (vp.dataPriceMax > vp.dataPriceMin) ? (vp.dataPriceMax - vp.dataPriceMin) : 100;
      var minSpan = MIN_PRICE_SPAN;
      var maxSpan = Math.max(dataSpan * 50, 100000);
      var span = clamp(max - min, minSpan, maxSpan);
      var mid = (min + max) / 2;
      if (vp.dataPriceMax > vp.dataPriceMin) {
        var pad = Math.max(dataSpan * 8, span * 2, 1000);
        mid = clamp(mid, vp.dataPriceMin - pad, vp.dataPriceMax + pad);
      }
      vp.priceMin = mid - span / 2;
      vp.priceMax = mid + span / 2;
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
          var span = clamp(interval * TARGET_CANDLES, MIN_TIME_SPAN_MS, maxSpanForInterval(interval));
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

      // Auto fit price to visible data — smooth transitions via lerp.
      if (hasPrice && vp.autoFit) {
        vp.smoothPriceRange(bounds.priceMin, bounds.priceMax);
      }
    };

    // ---- Fit / reset / follow ----
    vp.fitTimeToData = function () {
      if (vp.dataTimeMax > vp.dataTimeMin) {
        var span = clamp(vp.dataTimeMax - vp.dataTimeMin, MIN_TIME_SPAN_MS, maxSpanForInterval(vp.candleIntervalMs));
        var pad = span * LIVE_EDGE_PAD_RATIO;
        vp.timeEnd = vp.dataTimeMax + pad;
        vp.timeStart = vp.timeEnd - span;
      }
    };

    vp.fitPriceToData = function () {
      if (vp.dataPriceMax > vp.dataPriceMin) {
        vp.priceMin = vp.dataPriceMin;
        vp.priceMax = vp.dataPriceMax;
      }
      vp.autoFit = true;
      // Reset lerp target so next smoothPriceRange snaps immediately.
      vp._smoothPriceTarget = null;
      vp._smoothPriceTs = 0;
    };

    // Smooth price-range transitions to avoid vertical jumps when the visible
    // candle set changes (new high/low, forming candle, 18% pad recompute).
    // factor: 0 = no smoothing, 0.25 = slow follow. Default 0.22 per frame (~30fps).
    vp.smoothPriceRange = function (targetMin, targetMax, factor) {
      if (!isNum(targetMin) || !isNum(targetMax) || targetMax <= targetMin) return;
      // Frame-rate independent lerp. The legacy fixed factor (0.22) assumed
      // 60fps. Convert to a per-second rate and derive the actual factor
      // from elapsed time so smoothing is identical at 30/60/144fps.
      // rate = -ln(1 - 0.22) / (1/60) ≈ 16.56 per second.
      var rate = (isNum(factor) && factor > 0 && factor < 1)
        ? -Math.log(1 - factor) * 60   // convert custom factor the same way
        : 16.56;
      var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      var lastTs = vp._smoothPriceTs || 0;
      var dtMs = (lastTs > 0) ? Math.min(100, now - lastTs) : 100; // clamp to avoid huge jumps after tab switch
      vp._smoothPriceTs = now;
      var f = 1 - Math.exp(-rate * dtMs / 1000);
      var prev = vp._smoothPriceTarget;
      // Snap on first call, after reset, or if the target jumped >2x the current span.
      var curSpan = vp.priceMax - vp.priceMin;
      var tgtSpan = targetMax - targetMin;
      var shouldSnap = !prev || curSpan <= 0 || tgtSpan > curSpan * 2.5 || curSpan > tgtSpan * 2.5;
      vp._smoothPriceTarget = { min: targetMin, max: targetMax };
      if (shouldSnap || f >= 1) {
        vp.priceMin = targetMin;
        vp.priceMax = targetMax;
        return;
      }
      // Lerp toward target.
      vp.priceMin = vp.priceMin + (targetMin - vp.priceMin) * f;
      vp.priceMax = vp.priceMax + (targetMax - vp.priceMax) * f;
      // Snap to target when residual delta is sub-pixel: prevents infinite
      // asymptotic micro-redraws on an otherwise idle chart. Epsilon is
      // relative to the current span (works for BTC and sub-cent alts).
      var eps = curSpan * 1e-5;
      if (Math.abs(vp.priceMin - targetMin) < eps && Math.abs(vp.priceMax - targetMax) < eps) {
        vp.priceMin = targetMin;
        vp.priceMax = targetMax;
      }
    };

    vp.fitToData = function () {
      vp.fitTimeToData();
      vp.fitPriceToData();
      vp.followLive = true;
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
      vp._smoothPriceTarget = null;
      vp._smoothPriceTs = 0;
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

    vp.detachLive = function () {
      vp.markUserInteraction();
      vp.followLive = false;
    };

    // ---- Pan (pixels) ----
    // Panning the chart with drag. No auto re-enable of followLive during pan
    // — that was causing the chart to snap back to the live edge. The user must
    // explicitly click "Follow live" to re-enable it.
    vp.panByPixels = function (dx, dy) {
      var p = vp.plot;
      if (dx) {
        var dt = dx / p.width * timeSpan();
        // Direct translation — no setTimeRange to avoid mid-recentering that
        // causes non-linear drag near the edges (elastic feeling).
        // Clamp only the hard limits so the window stops cleanly at bounds.
        var newStart = vp.timeStart - dt;
        var newEnd = vp.timeEnd - dt;
        if (vp.dataTimeMax > vp.dataTimeMin) {
          var dataSpan = vp.dataTimeMax - vp.dataTimeMin;
          var span = timeSpan();
          var leftPad = Math.max(dataSpan * 0.5, span * 1.5, 6 * 3600 * 1000);
          var rightPad = Math.max(dataSpan * 1.0, span * 3.0, 24 * 3600 * 1000);
          var minMid = vp.dataTimeMin - leftPad;
          var maxMid = vp.dataTimeMax + rightPad;
          var mid = (newStart + newEnd) / 2;
          if (mid < minMid) { newStart += (minMid - mid); newEnd += (minMid - mid); }
          else if (mid > maxMid) { newStart += (maxMid - mid); newEnd += (maxMid - mid); }
        }
        vp.timeStart = newStart;
        vp.timeEnd = newEnd;
        vp.markUserInteraction();
        vp.followLive = false;
      }
      if (dy) {
        var dp = dy / p.height * priceSpan();
        var newMin = vp.priceMin + dp;
        var newMax = vp.priceMax + dp;
        if (vp.dataPriceMax > vp.dataPriceMin) {
          var dataSpanP = vp.dataPriceMax - vp.dataPriceMin;
          var pSpan = priceSpan();
          var padP = Math.max(dataSpanP * 8, pSpan * 2, 1000);
          var minMidP = vp.dataPriceMin - padP;
          var maxMidP = vp.dataPriceMax + padP;
          var midP = (newMin + newMax) / 2;
          if (midP < minMidP) { newMin += (minMidP - midP); newMax += (minMidP - midP); }
          else if (midP > maxMidP) { newMin += (maxMidP - midP); newMax += (maxMidP - midP); }
        }
        vp.priceMin = newMin;
        vp.priceMax = newMax;
        vp.markUserInteraction();
      }
    };

    // ---- Zoom (factor < 1 = zoom in, > 1 = zoom out) ----
    vp.zoomTime = function (factor, anchorX) {
      if (!isNum(factor) || factor <= 0) return;
      vp.markUserInteraction();
      var anchorTime = isNum(anchorX) ? vp.xToTime(anchorX) : (vp.timeStart + vp.timeEnd) / 2;
      var newSpan = clamp(timeSpan() * factor, MIN_TIME_SPAN_MS, maxSpanForInterval(vp.candleIntervalMs));
      var leftFrac = (anchorTime - vp.timeStart) / timeSpan();
      vp.setTimeRange(anchorTime - leftFrac * newSpan, anchorTime - leftFrac * newSpan + newSpan);
      // Zoom is a user action: it can only disable follow-live, never
      // re-enable it. A zoom-out from the live edge may push timeEnd past
      // dataTimeMax, but that must not resume auto-following.
      var wasLive = vp.followLive;
      vp.followLive = wasLive ? (vp.timeEnd >= vp.dataTimeMax) : false;
    };

    vp.zoomPrice = function (factor, anchorY) {
      if (!isNum(factor) || factor <= 0) return;
      vp.markUserInteraction();
      var anchorPrice = isNum(anchorY) ? vp.yToPrice(anchorY) : (vp.priceMin + vp.priceMax) / 2;
      var newSpan = Math.max(MIN_PRICE_SPAN, priceSpan() * factor);
      var topFrac = (vp.priceMax - anchorPrice) / priceSpan();
      var targetMax = anchorPrice + topFrac * newSpan;
      vp.setPriceRange(targetMax - newSpan, targetMax);
    };

    return vp;
  }

  V6OF.register('UI', 'ChartViewport', { create: create }, 'ChartViewport');
})();
