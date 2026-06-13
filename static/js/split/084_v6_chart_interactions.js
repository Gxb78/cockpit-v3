// ---------- 084_v6_chart_interactions.js ----------
// Chart interactions: pointer handlers (pan/zoom/crosshair) for V6 chart, synchronized
// across price and CVD canvases. Touch/pinch-to-zoom + momentum/inertia on pan.

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
  function _readLayoutToken(name, fallback) {
    try {
      var el = document.getElementById('v6-orderflow-root') || document.body;
      var v = window.getComputedStyle(el).getPropertyValue(name).trim();
      if (v && v !== '') { var px = parseFloat(v); if (Number.isFinite(px)) return px; }
    } catch (e) { /* DOM pas pret */ }
    return fallback;
  }
  var GUTTER_RIGHT  = _readLayoutToken('--exo-gutter-right', 66);
  var GUTTER_BOTTOM = _readLayoutToken('--exo-gutter-bottom', 24);
  var CVD_LABEL_W = 10;
  var CVD_VAL_W = 74;

  var ZOOM_IN = 0.93;   // wheel up (less sensitive — was 0.88)
  var ZOOM_OUT = 1.0 / ZOOM_IN;
  var PAN_FACTOR = 0.5;  // touchpad pan speed multiplier (less sensitive)
  var PINCH_THRESHOLD = 8;     // px change before pinch activates

  function storeFor(ref) {
    return V6OF.getStore ? V6OF.getStore(ref) : null;
  }

  function ensureViewport() {
    if (!V6OF.chart && V6OF.ChartViewport && V6OF.ChartViewport.create) {
      V6OF.chart = V6OF.ChartViewport.create();
    }
    return V6OF.chart;
  }

  function ensureCrosshair(ref) {
    if (V6OF.getChartCrosshair) return V6OF.getChartCrosshair(ref);
    V6OF._fallbackChartCrosshair = V6OF._fallbackChartCrosshair || {
      enabled: true,
      visible: false,
      x: 0,
      y: 0,
      cy: null,
      hoveringSource: null, // 'chart' | 'cvd'
      time: null,
      price: null
    };
    return V6OF._fallbackChartCrosshair;
  }

  function localPoint(canvas, event) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function chartAnchorXFromCvd(canvas, x, vp) {
    if (!canvas || !vp || !vp.plot) return x;
    var rect = canvas.getBoundingClientRect();
    var gx = Math.max(CVD_LABEL_W + 40, rect.width - CVD_VAL_W);
    var plotWidth = Math.max(1, gx - CVD_LABEL_W - 1);
    var frac = (x - CVD_LABEL_W) / plotWidth;
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;
    return vp.plot.left + frac * vp.plot.width;
  }

  var redrawQueued = false;
  function rootFor(ref) {
    if (ref && ref.dataset && ref.dataset.v6Mounted === '1') return ref;
    if (ref && ref.closest) return ref.closest('[data-v6-mounted="1"]') || null;
    return document.querySelector('[data-v6-mounted="1"]');
  }

  function redrawAll(ref) {
    if (redrawQueued) return;
    redrawQueued = true;
    var root = rootFor(ref);
    var schedule = typeof requestAnimationFrame === 'function' && !document.hidden
      ? requestAnimationFrame
      : function (fn) { return setTimeout(fn, 33); };
    schedule(function () {
      redrawQueued = false;
      var scope = root || document;
      var chartCanvas = scope.querySelector ? scope.querySelector('[data-v6-chart]') : null;
      var store = storeFor(chartCanvas);
      if (!store) return;
      var state = store.getState();
      if (chartCanvas && V6OF.CanvasChart) {
        if (V6OF.CanvasChart.drawNow) {
          V6OF.CanvasChart.drawNow(chartCanvas, state);
        } else {
          V6OF.CanvasChart.draw(chartCanvas, state);
        }
      }
      var cvdCanvas = scope.querySelector ? scope.querySelector('[data-v6-cvd-canvas]') : null;
      var cvdStrip = scope.querySelector ? scope.querySelector('[data-v6-cvd-strip]') : null;
      var cvdRenderer = V6OF.Panels && V6OF.Panels.CvdPanel;
      var cross = ensureCrosshair(chartCanvas || cvdCanvas || scope);
      if (cvdCanvas && cvdRenderer && cvdRenderer.draw && !(cvdStrip && cvdStrip.classList.contains('is-collapsed'))) {
        if (cvdRenderer.drawNow) {
          cvdRenderer.drawNow(cvdCanvas, state);
        } else {
          cvdRenderer.draw(cvdCanvas, state, chartCanvas && chartCanvas._v6Viewport, {
            crosshairTs: cross && cross.visible ? cross.time : null,
            showTimeAxis: false
          });
        }
      }
    });
  }

  function redrawOverlayAll(ref) {
    var root = rootFor(ref);
    var scope = root || document;
    var chartCanvas = scope.querySelector ? scope.querySelector('[data-v6-chart]') : null;
    var store = storeFor(chartCanvas);
    if (!store) return;
    var state = store.getState();
    if (chartCanvas && V6OF.CanvasChart && V6OF.CanvasChart.redrawOverlay) {
      V6OF.CanvasChart.redrawOverlay(chartCanvas, state);
    } else if (chartCanvas && V6OF.CanvasChart) {
      V6OF.CanvasChart.draw(chartCanvas, state);
    }
    var cvdCanvas = scope.querySelector ? scope.querySelector('[data-v6-cvd-overlay]') : null;
    var cvdStrip = scope.querySelector ? scope.querySelector('[data-v6-cvd-strip]') : null;
    var cvdRenderer = V6OF.Panels && V6OF.Panels.CvdPanel;
    var cross = ensureCrosshair(chartCanvas || cvdCanvas || scope);
    if (cvdCanvas && cvdRenderer && !(cvdStrip && cvdStrip.classList.contains('is-collapsed'))) {
      if (cvdRenderer.redrawOverlay) {
        cvdRenderer.redrawOverlay(cvdCanvas);
      } else if (cvdRenderer.draw) {
        cvdRenderer.draw(cvdCanvas, state, chartCanvas && chartCanvas._v6Viewport, {
          crosshairTs: cross && cross.visible ? cross.time : null,
          showTimeAxis: false
        });
      }
    }
  }

  var drag = { active: false, mode: 'pan', startX: 0, startY: 0, clickX: 0, clickY: 0, endX: 0, endY: 0, moved: false, lastDragAt: 0, startViewport: null, lastMoveAt: 0, velocityX: 0, velocityY: 0 };
  var wheelState = { zoomMode: 'time' };
  var TOUCH_PAN_THRESHOLD = 8;
  var MOMENTUM_MIN_VELOCITY = 0.035; // px/ms
  var MOMENTUM_FRICTION = 0.92;
  var momentum = { raf: 0, vx: 0, vy: 0, lastAt: 0, canvas: null };

  // ── Touch / pinch state ──
  var touchState = {
    active: false,
    singlePending: false,
    startTouchX: 0,
    startTouchY: 0,
    startTouchEvent: null,
    startDist: 0,
    startMidX: 0,
    startMidY: 0,
    pinchActive: false,
    startVp: null
  };

  function touchDist(t1, t2) {
    var dx = t1.clientX - t2.clientX;
    var dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function touchMid(t1, t2) {
    return {
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2
    };
  }

  function isMomentumPanMode(mode) {
    return mode === 'pan' || mode === 'price' || mode === 'time-pan';
  }

  function stopMomentum() {
    if (momentum.raf) {
      try { cancelAnimationFrame(momentum.raf); } catch (_) {}
    }
    momentum.raf = 0;
    momentum.vx = 0;
    momentum.vy = 0;
    momentum.lastAt = 0;
    momentum.canvas = null;
  }

  function recordMomentum(dx, dy, mode) {
    if (!isMomentumPanMode(mode)) return;
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    var dt = drag.lastMoveAt ? Math.max(8, now - drag.lastMoveAt) : 16;
    drag.lastMoveAt = now;
    drag.velocityX = dx / dt;
    drag.velocityY = dy / dt;
  }

  function startMomentum(canvas, mode) {
    if (!canvas || !isMomentumPanMode(mode) || !drag.moved) return;
    var vx = mode === 'price' ? 0 : drag.velocityX;
    var vy = mode === 'time-pan' ? 0 : drag.velocityY;
    if (Math.hypot(vx, vy) < MOMENTUM_MIN_VELOCITY) return;
    stopMomentum();
    momentum.canvas = canvas;
    momentum.vx = vx;
    momentum.vy = vy;
    momentum.lastAt = (window.performance && performance.now) ? performance.now() : Date.now();
    var step = function () {
      var vp = ensureViewport();
      if (!vp || drag.active || !momentum.canvas || !momentum.canvas.isConnected) {
        stopMomentum();
        return;
      }
      var now = (window.performance && performance.now) ? performance.now() : Date.now();
      var dt = Math.min(34, Math.max(8, now - momentum.lastAt));
      momentum.lastAt = now;
      var dx = momentum.vx * dt;
      var dy = momentum.vy * dt;
      vp.panByPixels(dx, dy);
      redrawAll(momentum.canvas);
      var damping = Math.pow(MOMENTUM_FRICTION, dt / 16.67);
      momentum.vx *= damping;
      momentum.vy *= damping;
      if (Math.hypot(momentum.vx, momentum.vy) < MOMENTUM_MIN_VELOCITY) {
        stopMomentum();
        return;
      }
      momentum.raf = requestAnimationFrame(step);
    };
    momentum.raf = requestAnimationFrame(step);
  }

  // Check if a point (x,y) is over the price scale (right gutter).
  function isOnPriceAxis(x, y, vp) {
    var plot = vp && vp.plot;
    if (!plot) return false;
    return x >= plot.left + plot.width && x <= plot.left + plot.width + GUTTER_RIGHT;
  }
  // Check if a point (x,y) is over the time scale (bottom gutter).
  function isOnTimeAxis(x, y, vp) {
    var plot = vp && vp.plot;
    if (!plot) return false;
    return y >= plot.top + plot.height && y <= plot.top + plot.height + GUTTER_BOTTOM;
  }

  function setActiveCandleFromEvent(canvas, event, locked) {
    var store = storeFor(canvas);
    if (!canvas || !event || !store || !V6OF.CanvasChart || !V6OF.CanvasChart.pickCandle) return false;
    var state = store.getState();
    var ui = (state && state.ui) || {};
    if (!locked && ui.activeCandleLocked) return false;
    var pt = localPoint(canvas, event);
    var pick = V6OF.CanvasChart.pickCandle(canvas, state, pt.x, pt.y);
    if (!pick || !pick.candle) return false;
    var candle = pick.candle;
    var openTime = Number(candle.openTime || 0);
    if (!Number.isFinite(openTime) || openTime <= 0) return false;
    var closeTime = Number(candle.closeTime || 0);
    var nextLocked = !!locked;
    if (ui.activeCandleOpenTime === openTime && ui.activeCandleLocked === nextLocked) return false;
    store.updateUi({
      activeCandleOpenTime: openTime,
      activeCandleCloseTime: Number.isFinite(closeTime) ? closeTime : 0,
      activeCandleSource: pick.source || '',
      activeCandleSnapshot: Object.assign({}, candle),
      activeCandleLocked: nextLocked,
      activeCandleUpdatedAt: Date.now()
    });
    return true;
  }

  function nearestCandleForTime(timeMs, state) {
    if (!state) return null;
    // Use the same merged candle array as the chart renderer so the crosshair
    // snaps to visible candles, not to stray 1m footprint candles on higher TFs.
    var candles = V6OF.CanvasChart && V6OF.CanvasChart.mergedCandles
      ? V6OF.CanvasChart.mergedCandles(state)
      : Array.isArray(state.chartCandles) ? state.chartCandles : [];
    if (!candles.length) return null;

    var lo = 0, hi = candles.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >>> 1;
      var midTime = Number(candles[mid].openTime || 0);
      if (midTime < timeMs) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    var bestCandle = candles[lo];
    var bestTime = Number(bestCandle.openTime || 0);
    var bestClose = Number(bestCandle.closeTime || (bestTime + 60000));
    var bestMid = (bestTime + bestClose) / 2;
    var best = { candle: bestCandle, mid: bestMid };

    if (lo > 0) {
      var prevCandle = candles[lo - 1];
      var prevTime = Number(prevCandle.openTime || 0);
      var prevClose = Number(prevCandle.closeTime || (prevTime + 60000));
      var prevMid = (prevTime + prevClose) / 2;
      if (Math.abs(prevMid - timeMs) < Math.abs(bestMid - timeMs)) {
        best = { candle: prevCandle, mid: prevMid };
      }
    }
    return best;
  }

  function snapTimeToCandle(timeMs, state) {
    var nearest = nearestCandleForTime(timeMs, state);
    return nearest ? nearest.mid : timeMs;
  }

  function snapOhlcPrice(rawPrice, candle, mode) {
    mode = mode || 'off';
    if (!candle || mode === 'off') return rawPrice;
    var high = Number(candle.high);
    var low = Number(candle.low);
    var close = Number(candle.close);
    if (mode === 'high') return Number.isFinite(high) ? high : rawPrice;
    if (mode === 'low') return Number.isFinite(low) ? low : rawPrice;
    if (mode === 'close') return Number.isFinite(close) ? close : rawPrice;
    if (mode !== 'nearest') return rawPrice;
    var candidates = [
      { price: high, dist: Math.abs(rawPrice - high) },
      { price: low, dist: Math.abs(rawPrice - low) },
      { price: close, dist: Math.abs(rawPrice - close) }
    ].filter(function (item) {
      return Number.isFinite(item.price) && Number.isFinite(item.dist);
    });
    if (!candidates.length) return rawPrice;
    candidates.sort(function (a, b) { return a.dist - b.dist; });
    return candidates[0].price;
  }

  V6OF.register('UI', 'ChartInteractions', {
    state: {
      crosshair: ensureCrosshair(),
      drag: drag,
      wheel: wheelState
    },
    redraw: redrawAll,

    init: function (canvas, viewport, store) {
      if (viewport) V6OF.chart = viewport;
      if (store && V6OF.setRootStore) V6OF.setRootStore(canvas && canvas.closest ? canvas.closest('[data-v6-mounted="1"]') : null, store);
      this.attach(canvas);
    },

    destroy: function () {
      var canvas = document.querySelector('[data-v6-chart]');
      this.detach(canvas);
      var cvdCanvas = document.querySelector('[data-v6-cvd-overlay]') || document.querySelector('[data-v6-cvd-canvas]');
      this.detachCvd(cvdCanvas);
    },

    onMouseMove: function (canvas, event, source) {
      var pt = localPoint(canvas, event);
      var vp = ensureViewport();
      var cross = ensureCrosshair(canvas);
      if (!vp) return;

      var t = vp.xToTime(pt.x);
      var store = storeFor(canvas);
      var state = null;
      var nearest = null;
      if (store) {
        state = store.getState();
        nearest = nearestCandleForTime(t, state);
        if (nearest) t = nearest.mid;
      }
      var x = vp.timeToX(t);

      cross.visible = cross.enabled;
      cross.x = x;
      cross.time = t;
      vp.crosshairTs = t;
      cross.hoveringSource = source;

      if (source === 'chart') {
        cross.cy = null;
        var rawPrice = vp.yToPrice(pt.y);
        var snapMode = state && state.settings ? (state.settings.crosshairSnapOhlc || 'off') : 'off';
        var snappedPrice = snapOhlcPrice(rawPrice, nearest && nearest.candle, snapMode);
        cross.price = snappedPrice;
        cross.y = vp.priceToY(snappedPrice);
      } else if (source === 'cvd') {
        cross.y = null;
        cross.cy = pt.y;
        cross.price = null;
      }

      if (!drag.active) redrawOverlayAll(canvas);
    },

    onMouseLeave: function (canvas) {
      var cross = ensureCrosshair(canvas);
      cross.visible = false;
      cross.hoveringSource = null;
      cross.x = 0;
      cross.y = 0;
      cross.cy = null;
      cross.time = null;
      cross.price = null;
      var vp = ensureViewport();
      if (vp) vp.crosshairTs = null;
      redrawOverlayAll(canvas);
    },

    onWheel: function (canvas, event) {
      event.preventDefault();
      stopMomentum();
      var vp = ensureViewport();
      var cross = ensureCrosshair(canvas);
      if (!vp) return;

      var pt = localPoint(canvas, event);
      var factor = event.deltaY < 0 ? ZOOM_IN : ZOOM_OUT;

      if (event.shiftKey) {
        var panDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
        wheelState.zoomMode = 'pan';
        vp.panByPixels(-panDelta * PAN_FACTOR, 0);
        cross.x = pt.x;
        cross.time = vp.xToTime(pt.x);
        vp.crosshairTs = cross.time;
        cross.visible = cross.enabled;
        redrawAll(canvas);
        return;
      }

      if (event.ctrlKey || event.metaKey) {
        wheelState.zoomMode = 'price';
        vp.zoomPrice(factor, pt.y);
        cross.x = pt.x;
        if (cross.hoveringSource === 'chart') {
          cross.y = pt.y;
          cross.price = vp.yToPrice(pt.y);
        }
        cross.time = vp.xToTime(pt.x);
        vp.crosshairTs = cross.time;
        cross.visible = cross.enabled;
        redrawAll(canvas);
        return;
      }

      // Horizontal two-finger swipe on touchpad → pan time axis (left/right).
      if (event.deltaX && Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        vp.panByPixels(-event.deltaX * PAN_FACTOR, 0);
        cross.x = pt.x;
        cross.time = vp.xToTime(pt.x);
        vp.crosshairTs = cross.time;
        cross.visible = cross.enabled;
        redrawAll(canvas);
        return;
      }

      // Wheel over price axis → zoom price only
      if (isOnPriceAxis(pt.x, pt.y, vp)) {
        wheelState.zoomMode = 'price';
        vp.zoomPrice(factor, pt.y);
      } else if (isOnTimeAxis(pt.x, pt.y, vp)) {
        wheelState.zoomMode = 'time';
        vp.zoomTime(factor, pt.x);
      } else {
        wheelState.zoomMode = 'time';
        vp.zoomTime(factor, pt.x);
      }

      cross.x = pt.x;
      if (cross.hoveringSource === 'chart') {
        cross.y = pt.y;
        cross.price = vp.yToPrice(pt.y);
      }
      cross.time = vp.xToTime(pt.x);
      vp.crosshairTs = cross.time;
      cross.visible = cross.enabled;
      redrawAll(canvas);
    },

    onCvdWheel: function (canvas, event) {
      event.preventDefault();
      stopMomentum();
      var vp = ensureViewport();
      var cross = ensureCrosshair(canvas);
      if (!vp) return;
      var pt = localPoint(canvas, event);
      var factor = event.deltaY < 0 ? ZOOM_IN : ZOOM_OUT;
      if (event.deltaX && Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        vp.panByPixels(-event.deltaX * PAN_FACTOR, 0);
      } else {
        vp.zoomTime(factor, chartAnchorXFromCvd(canvas, pt.x, vp));
      }
      wheelState.zoomMode = 'time';
      cross.x = pt.x;
      cross.cy = pt.y;
      cross.y = null;
      cross.price = null;
      cross.time = vp.xToTime(pt.x);
      vp.crosshairTs = cross.time;
      cross.hoveringSource = 'cvd';
      cross.visible = cross.enabled;
      redrawAll(canvas);
    },

    onPointerDown: function (canvas, event) {
      if (event.button !== undefined && event.button !== 0) return;
      stopMomentum();
      var vp = ensureViewport();
      if (!vp) return;

      var pt = localPoint(canvas, event);
      drag.clickX = pt.x;
      drag.clickY = pt.y;
      drag.moved = false;
      drag.lastMoveAt = 0;
      drag.velocityX = 0;
      drag.velocityY = 0;

      var store = storeFor(canvas);
      var state = store && store.getState();
      var s = state && state.settings;
      if (s && s.showVolumeProfile && s.volumeProfileType === 'fixed') {
        var fStart = s.volumeProfileFixedStart;
        var fEnd = s.volumeProfileFixedEnd;
        if (!fStart || !fEnd) {
          var span = vp.timeEnd - vp.timeStart;
          fStart = vp.timeStart + span * 0.25;
          fEnd = vp.timeStart + span * 0.75;
          fStart = snapTimeToCandle(fStart, state);
          fEnd = snapTimeToCandle(fEnd, state);
        }
        var startX = vp.timeToX(fStart);
        var endX = vp.timeToX(fEnd);
        var threshold = 12; // px

        if (Math.abs(pt.x - startX) <= threshold) {
          drag.active = true;
          drag.mode = 'vp-fixed-start';
          drag.clickX = pt.x;
          drag.fixedStart = fStart;
          drag.fixedEnd = fEnd;
          canvas.classList.add('v6-chart-dragging');
          V6OF.chartIsDragging = true;
          event.preventDefault();
          return;
        }
        if (Math.abs(pt.x - endX) <= threshold) {
          drag.active = true;
          drag.mode = 'vp-fixed-end';
          drag.clickX = pt.x;
          drag.fixedStart = fStart;
          drag.fixedEnd = fEnd;
          canvas.classList.add('v6-chart-dragging');
          V6OF.chartIsDragging = true;
          event.preventDefault();
          return;
        }
        var minX = Math.min(startX, endX);
        var maxX = Math.max(startX, endX);
        if (pt.x > minX && pt.x < maxX && pt.y < vp.plot.top + vp.plot.height) {
          drag.active = true;
          drag.mode = 'vp-fixed-block';
          drag.clickX = pt.x;
          drag.fixedStart = fStart;
          drag.fixedEnd = fEnd;
          drag.blockOffsetStart = fStart - vp.xToTime(pt.x);
          drag.blockOffsetEnd = fEnd - vp.xToTime(pt.x);
          canvas.classList.add('v6-chart-dragging');
          V6OF.chartIsDragging = true;
          event.preventDefault();
          return;
        }
      }

      // Detect axis click — zoom the corresponding axis.
      if (isOnPriceAxis(pt.x, pt.y, vp)) {
        drag.active = true;
        drag.mode = event.shiftKey ? 'price-zoom-out' : 'price-zoom';
        drag.startX = pt.x;
        drag.startY = pt.y;
        drag.startViewport = {
          timeStart: vp.timeStart, timeEnd: vp.timeEnd,
          priceMin: vp.priceMin, priceMax: vp.priceMax
        };
        canvas.classList.add('v6-chart-dragging');
        V6OF.chartIsDragging = true;
        event.preventDefault();
        return;
      }
      if (isOnTimeAxis(pt.x, pt.y, vp)) {
        drag.active = true;
        drag.mode = event.shiftKey ? 'time-zoom-out' : 'time-zoom';
        drag.startX = pt.x;
        drag.startY = pt.y;
        drag.startViewport = {
          timeStart: vp.timeStart, timeEnd: vp.timeEnd,
          priceMin: vp.priceMin, priceMax: vp.priceMax
        };
        canvas.classList.add('v6-chart-dragging');
        V6OF.chartIsDragging = true;
        event.preventDefault();
        return;
      }

      // Normal pan on the chart area
      drag.active = true;
      drag.mode = event.shiftKey ? 'price' : 'pan';
      drag.startX = pt.x;
      drag.startY = pt.y;
      drag.startViewport = {
        timeStart: vp.timeStart,
        timeEnd: vp.timeEnd,
        priceMin: vp.priceMin,
        priceMax: vp.priceMax
      };

      canvas.classList.add('v6-chart-dragging');
      V6OF.chartIsDragging = true;
      event.preventDefault();
    },

    onPointerMove: function (canvas, event) {
      if (!drag.active) return;
      var vp = ensureViewport();
      var cross = ensureCrosshair(canvas);
      if (!vp) return;

      var pt = localPoint(canvas, event);
      var dx = pt.x - drag.startX;
      var dy = pt.y - drag.startY;
      if (Math.abs(pt.x - drag.clickX) > 3 || Math.abs(pt.y - drag.clickY) > 3) {
        drag.moved = true;
      }

      if (drag.mode === 'vp-fixed-start') {
        var t = vp.xToTime(pt.x);
        var store = storeFor(canvas);
        if (store) {
          t = snapTimeToCandle(t, store.getState());
          if (t < drag.fixedEnd) {
            drag.fixedStart = t;
          }
        }
      } else if (drag.mode === 'vp-fixed-end') {
        var t = vp.xToTime(pt.x);
        var store = storeFor(canvas);
        if (store) {
          t = snapTimeToCandle(t, store.getState());
          if (t > drag.fixedStart) {
            drag.fixedEnd = t;
          }
        }
      } else if (drag.mode === 'vp-fixed-block') {
        var store = storeFor(canvas);
        if (store) {
          var tCurrent = vp.xToTime(pt.x);
          var newStart = tCurrent + drag.blockOffsetStart;
          var newEnd = tCurrent + drag.blockOffsetEnd;
          drag.fixedStart = snapTimeToCandle(newStart, store.getState());
          drag.fixedEnd = snapTimeToCandle(newEnd, store.getState());
        }
      } else if (drag.mode === 'price') {
        vp.panByPixels(0, dy);
        recordMomentum(0, dy, drag.mode);
        drag.startY = pt.y;
      } else if (drag.mode === 'time-pan') {
        vp.panByPixels(dx, 0);
        recordMomentum(dx, 0, drag.mode);
        drag.startX = pt.x;
      } else if (drag.mode === 'pan') {
        vp.panByPixels(dx, dy);
        recordMomentum(dx, dy, drag.mode);
        drag.startX = pt.x;
        drag.startY = pt.y;
      } else if (drag.mode === 'price-zoom' || drag.mode === 'price-zoom-out') {
        var totalDy = pt.y - drag.clickY;
        var baseMin = drag.startViewport.priceMin;
        var baseMax = drag.startViewport.priceMax;
        var baseRange = baseMax - baseMin;

        var plot = vp.plot;
        var anchorY = drag.clickY;
        if (anchorY < plot.top) anchorY = plot.top;
        if (anchorY > plot.top + plot.height) anchorY = plot.top + plot.height;
        var centerPrice = baseMax - ((anchorY - plot.top) / plot.height) * baseRange;

        var zoomFactor = 1 - totalDy * 0.002;
        if (drag.mode === 'price-zoom-out') {
          zoomFactor = 1 + totalDy * 0.002;
        }
        if (zoomFactor < 0.1) zoomFactor = 0.1;
        if (zoomFactor > 10) zoomFactor = 10;

        var newRange = baseRange * (1 / zoomFactor);
        var ratio = newRange / baseRange;
        var nextMin = centerPrice - (centerPrice - baseMin) * ratio;
        var nextMax = nextMin + newRange;

        vp.setPriceRange(nextMin, nextMax);
      } else if (drag.mode === 'time-zoom' || drag.mode === 'time-zoom-out') {
        var totalDx = pt.x - drag.clickX;
        var baseStart = drag.startViewport.timeStart;
        var baseEnd = drag.startViewport.timeEnd;
        var baseSpan = baseEnd - baseStart;

        var plot = vp.plot;
        var anchorX = drag.clickX;
        if (anchorX < plot.left) anchorX = plot.left;
        if (anchorX > plot.left + plot.width) anchorX = plot.left + plot.width;
        var centerTime = baseStart + ((anchorX - plot.left) / plot.width) * baseSpan;

        var zoomFactor = 1 + totalDx * 0.002;
        if (drag.mode === 'time-zoom-out') {
          zoomFactor = 1 - totalDx * 0.002;
        }
        if (zoomFactor < 0.1) zoomFactor = 0.1;
        if (zoomFactor > 10) zoomFactor = 10;

        var newSpan = baseSpan * (1 / zoomFactor);
        var ratio = newSpan / baseSpan;
        var nextStart = centerTime - (centerTime - baseStart) * ratio;
        var nextEnd = nextStart + newSpan;

        vp.setTimeRange(nextStart, nextEnd);
      }

      cross.x = pt.x;
      if (cross.hoveringSource === 'chart') {
        cross.y = pt.y;
        cross.price = vp.yToPrice(pt.y);
      } else if (cross.hoveringSource === 'cvd') {
        cross.y = null;
        cross.cy = pt.y;
        cross.price = null;
      }
      cross.time = vp.xToTime(pt.x);
      vp.crosshairTs = cross.time;

      redrawAll(canvas);
    },

    onCvdPointerDown: function (canvas, event) {
      if (event.button !== undefined && event.button !== 0) return;
      stopMomentum();
      var vp = ensureViewport();
      if (!vp) return;
      var pt = localPoint(canvas, event);
      var cross = ensureCrosshair(canvas);
      drag.active = true;
      drag.mode = 'time-pan';
      drag.startX = pt.x;
      drag.startY = pt.y;
      drag.clickX = pt.x;
      drag.clickY = pt.y;
      drag.moved = false;
      drag.lastMoveAt = 0;
      drag.velocityX = 0;
      drag.velocityY = 0;
      drag.startViewport = {
        timeStart: vp.timeStart,
        timeEnd: vp.timeEnd,
        priceMin: vp.priceMin,
        priceMax: vp.priceMax
      };
      canvas.classList.add('v6-chart-dragging');
      V6OF.chartIsDragging = true;
      cross.visible = cross.enabled;
      cross.hoveringSource = 'cvd';
      cross.x = pt.x;
      cross.y = null;
      cross.cy = pt.y;
      cross.price = null;
      cross.time = vp.xToTime(pt.x);
      vp.crosshairTs = cross.time;
      event.preventDefault();
    },

    onPointerUp: function (canvas, event) {
      if (!drag.active) return;
      var mode = drag.mode;
      drag.active = false;
      if (drag.moved) drag.lastDragAt = Date.now();
      if (canvas) canvas.classList.remove('v6-chart-dragging');
      V6OF.chartIsDragging = false;

      if (drag.mode === 'vp-fixed-start' || drag.mode === 'vp-fixed-end' || drag.mode === 'vp-fixed-block') {
        var store = storeFor(canvas);
        if (store && drag.fixedStart != null && drag.fixedEnd != null) {
          store.updateSettings({
            volumeProfileFixedStart: drag.fixedStart,
            volumeProfileFixedEnd: drag.fixedEnd
          });
        }
        drag.fixedStart = null;
        drag.fixedEnd = null;
      }
      redrawAll(canvas);
      startMomentum(canvas, mode);
    },

    // ── Touch handlers (pinch-to-zoom + two-finger pan) ──

    onTouchStart: function (canvas, event) {
      if (event.touches.length === 1) {
        // Single finger: keep page scroll available until a chart pan really starts.
        var t = event.touches[0];
        touchState.singlePending = true;
        touchState.startTouchX = t.clientX;
        touchState.startTouchY = t.clientY;
        touchState.startTouchEvent = {
          clientX: t.clientX,
          clientY: t.clientY,
          button: 0,
          shiftKey: !!event.shiftKey,
          preventDefault: function () {}
        };
        touchState.active = false;
        touchState.pinchActive = false;
      } else if (event.touches.length === 2) {
        // Two fingers → prepare pinch
        stopMomentum();
        touchState.singlePending = false;
        touchState.startTouchEvent = null;
        drag.active = false;
        V6OF.chartIsDragging = true;
        touchState.active = true;
        touchState.pinchActive = false;
        touchState.startDist = touchDist(event.touches[0], event.touches[1]);
        var mid = touchMid(event.touches[0], event.touches[1]);
        touchState.startMidX = mid.x;
        touchState.startMidY = mid.y;
        var vp = ensureViewport();
        if (vp) {
          touchState.startVp = {
            timeStart: vp.timeStart, timeEnd: vp.timeEnd,
            priceMin: vp.priceMin, priceMax: vp.priceMax
          };
        }
        canvas.classList.add('v6-chart-dragging');
        V6OF.chartIsDragging = true;
        event.preventDefault();
      }
    },

    onTouchMove: function (canvas, event) {
      if (event.touches.length === 2 && touchState.active) {
        var vp = ensureViewport();
        if (!vp) return;
        var dist = touchDist(event.touches[0], event.touches[1]);
        var mid = touchMid(event.touches[0], event.touches[1]);
        var dDist = dist - touchState.startDist;

        if (!touchState.pinchActive && Math.abs(dDist) > PINCH_THRESHOLD) {
          touchState.pinchActive = true;
        }

        // Two-finger pan (midpoint movement)
        var dmx = mid.x - touchState.startMidX;
        var dmy = mid.y - touchState.startMidY;
        if (Math.abs(dmx) > 1 || Math.abs(dmy) > 1) {
          // Restore saved viewport and apply pan from start position
          if (touchState.startVp) {
            vp.timeStart = touchState.startVp.timeStart;
            vp.timeEnd = touchState.startVp.timeEnd;
            vp.priceMin = touchState.startVp.priceMin;
            vp.priceMax = touchState.startVp.priceMax;
          }
          vp.panByPixels(-dmx, -dmy);
        }

        // Pinch zoom (both time and price)
        if (touchState.pinchActive && touchState.startDist > 0) {
          var scale = dist / touchState.startDist;
          if (Math.abs(scale - 1) > 0.005) {
            // Convert midpoint to chart coordinates
            var pt = localPoint(canvas, { clientX: mid.x, clientY: mid.y });
            vp.zoomTime(scale, pt.x);
            vp.zoomPrice(scale, pt.y);
            // Reset baseline so zoom feels continuous
            touchState.startDist = dist;
          }
        }

        var cross = ensureCrosshair(canvas);
        var pt = localPoint(canvas, { clientX: mid.x, clientY: mid.y });
        cross.x = pt.x;
        cross.time = vp.xToTime(pt.x);
        vp.crosshairTs = cross.time;
        cross.visible = cross.enabled;
        redrawAll(canvas);
        event.preventDefault();
      } else if (event.touches.length === 1) {
        var t = event.touches[0];
        if (touchState.singlePending && !drag.active) {
          var dx = t.clientX - touchState.startTouchX;
          var dy = t.clientY - touchState.startTouchY;
          if (Math.sqrt(dx * dx + dy * dy) < TOUCH_PAN_THRESHOLD) return;
          touchState.singlePending = false;
          this.onPointerDown(canvas, touchState.startTouchEvent || t);
        }
        if (drag.active) {
          this.onPointerMove(canvas, t);
          event.preventDefault();
        }
      }
    },

    onTouchEnd: function (canvas, event) {
      if (event.touches.length === 0) {
        touchState.singlePending = false;
        touchState.startTouchEvent = null;
        touchState.active = false;
        touchState.pinchActive = false;
        touchState.startVp = null;
        if (drag.active) {
          this.onPointerUp(canvas, null);
        }
        canvas.classList.remove('v6-chart-dragging');
        V6OF.chartIsDragging = false;
      } else if (event.touches.length === 1 && touchState.active) {
        // Went from 2 fingers to 1 → switch to pan
        touchState.singlePending = false;
        touchState.startTouchEvent = null;
        touchState.active = false;
        touchState.pinchActive = false;
        touchState.startVp = null;
        drag.active = true;
        V6OF.chartIsDragging = true;
        drag.mode = 'pan';
        var pt = localPoint(canvas, event.touches[0]);
        drag.startX = pt.x;
        drag.startY = pt.y;
      }
    },

    // ── Click handler (axis zoom + followLive button) ──
    _handleChartClick: function (canvas, event) {
      var vp = ensureViewport();
      if (!vp) return;
      if (drag.lastDragAt && Date.now() - drag.lastDragAt < 180) return;

      // Check if click is on the "▶ LIVE" button
      var btn = V6OF._followLiveBtn;
      if (btn) {
        var pt = localPoint(canvas, event);
        if (pt.x >= btn.x && pt.x <= btn.x + btn.w && pt.y >= btn.y && pt.y <= btn.y + btn.h) {
          if (vp.goLive) vp.goLive();
          redrawAll(canvas);
          return;
        }
      }

      // Axis click zoom
      var pt2 = localPoint(canvas, event);
      if (isOnPriceAxis(pt2.x, pt2.y, vp)) {
        var factor = event.shiftKey ? 1.25 : 0.8;
        vp.zoomPrice(factor, pt2.y);
        redrawAll(canvas);
        return;
      } else if (isOnTimeAxis(pt2.x, pt2.y, vp)) {
        var store = storeFor(canvas);
        var state = store && store.getState ? store.getState() : {};
        var settings = state.settings || {};
        var markers = settings.markers || [];

        // 1. Check if clicked near an existing user marker
        var clickedMarker = null;
        for (var i = 0; i < markers.length; i++) {
          var mx = vp.timeToX(markers[i].ts);
          if (Math.abs(pt2.x - mx) <= 12) {
            clickedMarker = markers[i];
            break;
          }
        }

        if (clickedMarker) {
          var newText = prompt("Modifier le marqueur utilisateur (laisser vide pour supprimer) :", clickedMarker.text);
          if (newText === null) return; // cancelled
          var nextMarkers = markers.filter(function (m) { return m.ts !== clickedMarker.ts; });
          if (newText.trim() !== '') {
            nextMarkers.push({ ts: clickedMarker.ts, text: newText.trim(), type: 'user' });
          }
          store.updateSettings({ markers: nextMarkers });
          redrawAll(canvas);
          return;
        }

        // 2. Ctrl+Click or Alt+Click to add a new user marker
        if (event.ctrlKey || event.altKey) {
          var ts = vp.xToTime(pt2.x);
          ts = snapTimeToCandle(ts, state);
          var text = prompt("Ajouter un marqueur utilisateur à " + V6OF.format.time(ts) + " :");
          if (text && text.trim() !== '') {
            var nextMarkers = markers.slice();
            nextMarkers.push({ ts: ts, text: text.trim(), type: 'user' });
            store.updateSettings({ markers: nextMarkers });
            redrawAll(canvas);
          }
          return;
        }

        var factor = event.shiftKey ? 1.25 : 0.8;
        vp.zoomTime(factor, pt2.x);
        redrawAll(canvas);
        return;
      }

      // ── Click in chart body: if no candle at this point, deselect ──
      var store = storeFor(canvas);
      var state = store && store.getState ? store.getState() : {};
      var pick = V6OF.CanvasChart && V6OF.CanvasChart.pickCandle
        ? V6OF.CanvasChart.pickCandle(canvas, state, pt2.x, pt2.y) : null;

      if (!pick || !pick.candle) {
        // Click on empty area or future time: clear selection immediately.
        if (store && store.updateUi) store.updateUi({
          activeCandleOpenTime: 0,
          activeCandleCloseTime: 0,
          activeCandleSource: '',
          activeCandleSnapshot: null,
          activeCandleLocked: false,
          activeCandleUpdatedAt: Date.now(),
          pinnedCandle: null
        });
        redrawAll(canvas);
        return;
      }
      // Single click on a candle does NOT select — double-click is for selection
      redrawAll(canvas);
    },

      // ── Double-click handler (opens candle info panel) ──
      _handleChartDblClick: function (canvas, event) {
        if (!canvas || !event) return;
        var vp = ensureViewport();
      if (vp) {
        var pt = localPoint(canvas, event);
        if (isOnPriceAxis(pt.x, pt.y, vp)) {
          if (vp.fitPriceToData) vp.fitPriceToData();
          else vp.autoFit = true;
          redrawAll(canvas);
          return;
        }
        if (isOnTimeAxis(pt.x, pt.y, vp)) {
          if (vp.fitTimeToData) vp.fitTimeToData();
          redrawAll(canvas);
          return;
        }
      }
      if (setActiveCandleFromEvent(canvas, event, true)) {
        try {
          var store = storeFor(canvas);
          var state = store && store.getState ? store.getState() : {};
          var ui = (state && state.ui) || {};
          if (store && store.updateUi) {
            store.updateUi({
              pinnedCandle: ui.activeCandleSnapshot || {
                openTime: ui.activeCandleOpenTime,
                closeTime: ui.activeCandleCloseTime,
                source: ui.activeCandleSource
              }
            });
          }
        } catch (_) {}
        var infoTab = document.querySelector('[data-v6-rtab="info"]');
        if (infoTab) infoTab.click();
      } else if (vp && vp.goLive) {
        vp.goLive();
      }
      redrawAll(canvas);
    },

    attach: function (canvas) {
      if (!canvas) return;
      if (canvas._v6IxAttached) return; // idempotent
      var self = this;
      var handlers = {
        move: function (e) { self.onMouseMove(canvas, e, 'chart'); },
        leave: function (e) { self.onMouseLeave(canvas); },
        down: function (e) { self.onPointerDown(canvas, e); },
        dragMove: function (e) { self.onPointerMove(canvas, e); },
        up: function (e) { self.onPointerUp(canvas, e); },
        wheel: function (e) { self.onWheel(canvas, e); },
        click: function (e) { self._handleChartClick(canvas, e); },
        dblClick: function (e) { self._handleChartDblClick(canvas, e); },
        touchS: function (e) { self.onTouchStart(canvas, e); },
        touchM: function (e) { self.onTouchMove(canvas, e); },
        touchE: function (e) { self.onTouchEnd(canvas, e); }
      };

      canvas._v6IxHandlers = handlers;
      canvas.addEventListener('mousemove', handlers.move);
      canvas.addEventListener('mousedown', handlers.down);
      canvas.addEventListener('mouseleave', handlers.leave);
      canvas.addEventListener('wheel', handlers.wheel, { passive: false });
      canvas.addEventListener('click', handlers.click);
      canvas.addEventListener('dblclick', handlers.dblClick);
      window.addEventListener('mousemove', handlers.dragMove);
      window.addEventListener('mouseup', handlers.up);
      // Touch events
      canvas.addEventListener('touchstart', handlers.touchS, { passive: false });
      canvas.addEventListener('touchmove', handlers.touchM, { passive: false });
      canvas.addEventListener('touchend', handlers.touchE);
      canvas.addEventListener('touchcancel', handlers.touchE);
      canvas._v6IxAttached = true;
      if (!document._v6OrderflowEscBound) {
        document._v6OrderflowEscBound = true;
        document.addEventListener('keydown', function (e) {
          if (e.key !== 'Escape') return;
          var root = document.getElementById('v6-orderflow-root');
          var store = storeFor(root);
          if (!store || !store.updateUi) return;
          var state = store.getState ? store.getState() : {};
          var ui = (state && state.ui) || {};
          if (!ui.activeCandleLocked && !ui.activeCandleOpenTime) return;
          store.updateUi({
            activeCandleOpenTime: 0,
            activeCandleCloseTime: 0,
            activeCandleSource: '',
            activeCandleSnapshot: null,
            activeCandleLocked: false,
            activeCandleUpdatedAt: Date.now(),
            pinnedCandle: null
          });
          redrawAll(root);
        });
      }
    },

    detach: function (canvas) {
      var h = canvas && canvas._v6IxHandlers;
      if (!h) return;
      if (momentum.canvas === canvas) stopMomentum();
      canvas.removeEventListener('mousemove', h.move);
      canvas.removeEventListener('mousedown', h.down);
      canvas.removeEventListener('mouseleave', h.leave);
      canvas.removeEventListener('wheel', h.wheel);
      canvas.removeEventListener('click', h.click);
      canvas.removeEventListener('dblclick', h.dblClick);
      window.removeEventListener('mousemove', h.dragMove);
      window.removeEventListener('mouseup', h.up);
      canvas.removeEventListener('touchstart', h.touchS);
      canvas.removeEventListener('touchmove', h.touchM);
      canvas.removeEventListener('touchend', h.touchE);
      canvas.removeEventListener('touchcancel', h.touchE);
      canvas._v6IxHandlers = null;
      canvas._v6IxAttached = false;
    },

    attachCvd: function (canvas) {
      if (!canvas) return;
      if (canvas._v6CvdIxAttached) return;
      var self = this;
      var handlers = {
        move: function (e) { self.onMouseMove(canvas, e, 'cvd'); },
        leave: function (e) { self.onMouseLeave(canvas); },
        down: function (e) { self.onCvdPointerDown(canvas, e); },
        dragMove: function (e) { self.onPointerMove(canvas, e); },
        up: function (e) { self.onPointerUp(canvas, e); },
        wheel: function (e) { self.onCvdWheel(canvas, e); }
      };

      canvas._v6CvdIxHandlers = handlers;
      canvas.addEventListener('mousemove', handlers.move);
      canvas.addEventListener('mouseleave', handlers.leave);
      canvas.addEventListener('mousedown', handlers.down);
      canvas.addEventListener('wheel', handlers.wheel, { passive: false });
      window.addEventListener('mousemove', handlers.dragMove);
      window.addEventListener('mouseup', handlers.up);
      canvas._v6CvdIxAttached = true;
    },

    detachCvd: function (canvas) {
      var h = canvas && canvas._v6CvdIxHandlers;
      if (!h) return;
      if (momentum.canvas === canvas) stopMomentum();
      canvas.removeEventListener('mousemove', h.move);
      canvas.removeEventListener('mouseleave', h.leave);
      canvas.removeEventListener('mousedown', h.down);
      canvas.removeEventListener('wheel', h.wheel);
      window.removeEventListener('mousemove', h.dragMove);
      window.removeEventListener('mouseup', h.up);
      canvas._v6CvdIxHandlers = null;
      canvas._v6CvdIxAttached = false;
    },

    wireToolbar: function (root, canvas) {
      if (!root || root._v6ToolbarWired) return;
      var vp = ensureViewport();
      var cross = ensureCrosshair(root);

      function setActiveTool(name) {
        var tools = root.querySelectorAll('[data-v6-tool]');
        Array.prototype.forEach.call(tools, function (btn) {
          btn.classList.toggle('is-active', btn.getAttribute('data-v6-tool') === name);
        });
      }

      function updateViewportButtons() {
        var current = ensureViewport();
        var followBtn = root.querySelector('[data-v6-tool="follow"]');
        var detachBtn = root.querySelector('[data-v6-tool="detach"]');
        var fitBtn = root.querySelector('[data-v6-tool="fit"]');
        var resetBtn = root.querySelector('[data-v6-tool="reset"]');
        var follow = !!(current && current.followLive);
        var autoFit = !!(current && current.autoFit);
        if (followBtn) {
          followBtn.classList.toggle('is-active', follow);
          followBtn.classList.toggle('is-muted', !follow);
          followBtn.setAttribute('aria-pressed', follow ? 'true' : 'false');
        }
        if (detachBtn) {
          detachBtn.classList.toggle('is-active', !follow);
          detachBtn.classList.toggle('is-muted', follow);
          detachBtn.setAttribute('aria-pressed', follow ? 'false' : 'true');
        }
        if (fitBtn) {
          fitBtn.classList.toggle('is-active', autoFit);
          fitBtn.setAttribute('aria-pressed', autoFit ? 'true' : 'false');
        }
        if (resetBtn) {
          resetBtn.classList.toggle('is-active', follow && autoFit);
          resetBtn.setAttribute('aria-pressed', follow && autoFit ? 'true' : 'false');
        }
        Array.prototype.forEach.call(root.querySelectorAll('[data-v6-price-zoom="auto"]'), function (btn) {
          btn.classList.toggle('is-active', autoFit);
          btn.setAttribute('aria-pressed', autoFit ? 'true' : 'false');
        });
      }

      root.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-v6-tool]');
        var priceZoomBtn = event.target.closest('[data-v6-price-zoom]');
        if (priceZoomBtn && root.contains(priceZoomBtn)) {
          var action = priceZoomBtn.getAttribute('data-v6-price-zoom');
          var current = ensureViewport();
          if (!current) return;
          var anchorY = current.plot ? current.plot.top + current.plot.height / 2 : null;
          if (action === 'in') {
            current.zoomPrice(0.86, anchorY);
          } else if (action === 'out') {
            current.zoomPrice(1.16, anchorY);
          } else if (action === 'auto') {
            current.autoFit = true;
          } else {
            return;
          }
          updateViewportButtons();
          redrawAll(root);
          return;
        }
        if (!btn || !root.contains(btn)) return;
        var tool = btn.getAttribute('data-v6-tool');
        if (tool === 'cursor') {
          cross.enabled = false;
          cross.visible = false;
          setActiveTool('cursor');
        } else if (tool === 'crosshair') {
          cross.enabled = true;
          setActiveTool('crosshair');
        } else if (tool === 'fit') {
          if (vp) vp.fitToData();
        } else if (tool === 'reset') {
          if (vp) vp.resetView();
        } else if (tool === 'follow') {
          if (vp) vp.goLive();
        } else if (tool === 'detach') {
          if (vp && vp.detachLive) vp.detachLive();
          else if (vp) vp.followLive = false;
        } else {
          return;
        }
        updateViewportButtons();
        redrawAll(root);
      });

      setActiveTool(cross.enabled ? 'crosshair' : 'cursor');
      updateViewportButtons();
      V6OF.updateViewportToolbarState = updateViewportButtons;
      root._v6ToolbarWired = true;
    }
  }, 'ChartInteractions');
})();
