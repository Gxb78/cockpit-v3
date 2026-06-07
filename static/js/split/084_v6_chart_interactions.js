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
        V6OF.CanvasChart.draw(chartCanvas, state);
      }
      var cvdCanvas = scope.querySelector ? scope.querySelector('[data-v6-cvd-canvas]') : null;
      var cvdStrip = scope.querySelector ? scope.querySelector('[data-v6-cvd-strip]') : null;
      if (cvdCanvas && V6OF.CvdPanel && !(cvdStrip && cvdStrip.classList.contains('is-collapsed'))) {
        V6OF.CvdPanel.draw(cvdCanvas, state);
      }
    });
  }

  var drag = { active: false, mode: 'pan', startX: 0, startY: 0, clickX: 0, clickY: 0, endX: 0, endY: 0, moved: false, lastDragAt: 0, startViewport: null };
  var clickFitTimer = 0;
  var wheelState = { zoomMode: 'time' };

  // ── Touch / pinch state ──
  var touchState = {
    active: false,
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

  // Check if a point (x,y) is over the price scale (right gutter).
  function isOnPriceAxis(x, y, vp) {
    var plot = vp && vp.plot;
    if (!plot) return false;
    return x >= plot.left + plot.width && x <= plot.left + plot.width + 66;
  }
  // Check if a point (x,y) is over the time scale (bottom gutter).
  function isOnTimeAxis(x, y, vp) {
    var plot = vp && vp.plot;
    if (!plot) return false;
    return y >= plot.top + plot.height && y <= plot.top + plot.height + 24;
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

  function snapTimeToCandle(timeMs, state) {
    if (!state) return timeMs;
    // Use the same merged candle array as the chart renderer so the crosshair
    // snaps to visible candles, not to stray 1m footprint candles on higher TFs.
    var candles = V6OF.CanvasChart && V6OF.CanvasChart.mergedCandles
      ? V6OF.CanvasChart.mergedCandles(state)
      : Array.isArray(state.chartCandles) ? state.chartCandles : [];
    if (!candles.length) return timeMs;

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

    if (lo > 0) {
      var prevCandle = candles[lo - 1];
      var prevTime = Number(prevCandle.openTime || 0);
      var prevClose = Number(prevCandle.closeTime || (prevTime + 60000));
      var prevMid = (prevTime + prevClose) / 2;
      if (Math.abs(prevMid - timeMs) < Math.abs(bestMid - timeMs)) {
        bestMid = prevMid;
      }
    }
    return bestMid;
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
      var cvdCanvas = document.querySelector('[data-v6-cvd-canvas]');
      this.detachCvd(cvdCanvas);
    },

    onMouseMove: function (canvas, event, source) {
      var pt = localPoint(canvas, event);
      var vp = ensureViewport();
      var cross = ensureCrosshair(canvas);
      if (!vp) return;

      var t = vp.xToTime(pt.x);
      var store = storeFor(canvas);
      if (store) {
        t = snapTimeToCandle(t, store.getState());
      }
      var x = vp.timeToX(t);

      cross.visible = cross.enabled;
      cross.x = x;
      cross.time = t;
      cross.hoveringSource = source;

      if (source === 'chart') {
        cross.y = pt.y;
        cross.cy = null;
        cross.price = vp.yToPrice(pt.y);
      } else if (source === 'cvd') {
        cross.y = null;
        cross.cy = pt.y;
        cross.price = null;
      }

      if (!drag.active) redrawAll(canvas);
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
      redrawAll(canvas);
    },

    onWheel: function (canvas, event) {
      event.preventDefault();
      var vp = ensureViewport();
      var cross = ensureCrosshair(canvas);
      if (!vp) return;

      var pt = localPoint(canvas, event);
      var factor = event.deltaY < 0 ? ZOOM_IN : ZOOM_OUT;

      // Horizontal two-finger swipe on touchpad → pan time axis (left/right).
      if (event.deltaX && Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        vp.panByPixels(-event.deltaX * PAN_FACTOR, 0);
        cross.x = pt.x;
        cross.time = vp.xToTime(pt.x);
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
      } else if (event.ctrlKey || event.altKey) {
        wheelState.zoomMode = 'price';
        vp.zoomPrice(factor, pt.y);
      } else if (event.shiftKey) {
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
      cross.visible = cross.enabled;
      redrawAll(canvas);
    },

    onPointerDown: function (canvas, event) {
      if (event.button !== undefined && event.button !== 0) return;
      var vp = ensureViewport();
      if (!vp) return;

      var pt = localPoint(canvas, event);
      drag.clickX = pt.x;
      drag.clickY = pt.y;
      drag.moved = false;

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

      if (drag.mode === 'price') {
        vp.panByPixels(0, dy);
        drag.startY = pt.y;
      } else if (drag.mode === 'pan') {
        vp.panByPixels(dx, dy);
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
      }
      cross.time = vp.xToTime(pt.x);

      redrawAll(canvas);
    },

    onPointerUp: function (canvas, event) {
      if (!drag.active) return;
      drag.active = false;
      if (drag.moved) drag.lastDragAt = Date.now();
      if (canvas) canvas.classList.remove('v6-chart-dragging');
    },

    // ── Touch handlers (pinch-to-zoom + two-finger pan) ──

    onTouchStart: function (canvas, event) {
      if (event.touches.length === 1) {
        // Single finger → delegate to pointer down
        this.onPointerDown(canvas, event.touches[0]);
        touchState.active = false;
        touchState.pinchActive = false;
      } else if (event.touches.length === 2) {
        // Two fingers → prepare pinch
        drag.active = false;
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
        cross.visible = cross.enabled;
        redrawAll(canvas);
        event.preventDefault();
      } else if (event.touches.length === 1 && drag.active) {
        this.onPointerMove(canvas, event.touches[0]);
      }
    },

    onTouchEnd: function (canvas, event) {
      if (event.touches.length === 0) {
        touchState.active = false;
        touchState.pinchActive = false;
        touchState.startVp = null;
        if (drag.active) {
          this.onPointerUp(canvas, null);
        }
        canvas.classList.remove('v6-chart-dragging');
      } else if (event.touches.length === 1 && touchState.active) {
        // Went from 2 fingers to 1 → switch to pan
        touchState.active = false;
        touchState.pinchActive = false;
        touchState.startVp = null;
        drag.active = true;
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
        var factor = event.shiftKey ? 1.25 : 0.8;
        vp.zoomTime(factor, pt2.x);
        redrawAll(canvas);
        return;
      }

      // ── Click in chart body: if no candle at this point, deselect ──
      // Delay deselection by 200ms so double-click can cancel it
      if (clickFitTimer) { clearTimeout(clickFitTimer); clickFitTimer = 0; }

      var store = storeFor(canvas);
      var state = store && store.getState ? store.getState() : {};
      var pick = V6OF.CanvasChart && V6OF.CanvasChart.pickCandle
        ? V6OF.CanvasChart.pickCandle(canvas, state, pt2.x, pt2.y) : null;

      if (!pick || !pick.candle) {
        // Click on empty area or future time — clear selection after delay
        clickFitTimer = setTimeout(function () {
          clickFitTimer = 0;
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
        }, 200);
        return;
      }
      // Single click on a candle does NOT select — double-click is for selection
      redrawAll(canvas);
    },

    // ── Double-click handler (opens candle info panel) ──
    _handleChartDblClick: function (canvas, event) {
      if (!canvas || !event) return;
      if (clickFitTimer) {
        clearTimeout(clickFitTimer);
        clickFitTimer = 0;
      }
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

      function onMove(e) { self.onMouseMove(canvas, e, 'chart'); }
      function onLeave(e) { self.onMouseLeave(canvas); }
      function onDown(e) { self.onPointerDown(canvas, e); }
      function onDragMove(e) { self.onPointerMove(canvas, e); }
      function onUp(e) { self.onPointerUp(canvas, e); }
      function onWheel(e) { self.onWheel(canvas, e); }
      function onClick(e) { self._handleChartClick(canvas, e); }
      function onDblClick(e) { self._handleChartDblClick(canvas, e); }
      function onTouchS(e) { self.onTouchStart(canvas, e); }
      function onTouchM(e) { self.onTouchMove(canvas, e); }
      function onTouchE(e) { self.onTouchEnd(canvas, e); }

      canvas.addEventListener('mousemove', onMove);
      canvas.addEventListener('mousedown', onDown);
      canvas.addEventListener('mouseleave', onLeave);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('click', onClick);
      canvas.addEventListener('dblclick', onDblClick);
      window.addEventListener('mousemove', onDragMove);
      window.addEventListener('mouseup', onUp);
      // Touch events
      canvas.addEventListener('touchstart', onTouchS, { passive: false });
      canvas.addEventListener('touchmove', onTouchM, { passive: false });
      canvas.addEventListener('touchend', onTouchE);
      canvas.addEventListener('touchcancel', onTouchE);

      canvas._v6IxHandlers = {
        move: onMove, down: onDown, leave: onLeave,
        wheel: onWheel, click: onClick, dblClick: onDblClick, dragMove: onDragMove, up: onUp,
        touchS: onTouchS, touchM: onTouchM, touchE: onTouchE
      };
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

      function onMove(e) { self.onMouseMove(canvas, e, 'cvd'); }
      function onLeave(e) { self.onMouseLeave(canvas); }

      canvas.addEventListener('mousemove', onMove);
      canvas.addEventListener('mouseleave', onLeave);

      canvas._v6CvdIxHandlers = {
        move: onMove, leave: onLeave
      };
      canvas._v6CvdIxAttached = true;
    },

    detachCvd: function (canvas) {
      var h = canvas && canvas._v6CvdIxHandlers;
      if (!h) return;
      canvas.removeEventListener('mousemove', h.move);
      canvas.removeEventListener('mouseleave', h.leave);
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
