// ---------- Orderflow viewport guard ----------
// Runtime guard for the custom orderflow canvas.
// Keeps the price viewport finite and replaces the unstable direct price-axis drag.
(function () {
  'use strict';

  if (window.__OF_VIEWPORT_GUARD_INSTALLED__) return;
  window.__OF_VIEWPORT_GUARD_INSTALLED__ = true;

  var lastEngine = null;

  function finite(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  function clamp(v, min, max) {
    if (!finite(v)) return min;
    return Math.max(min, Math.min(max, v));
  }

  function stashEngine(engine) {
    if (!engine || !engine.priceScale || !engine.timeScale) return null;
    lastEngine = engine;
    try {
      if (engine.canvas) engine.canvas.__orderflowEngine = engine;
    } catch (_) {}
    return engine;
  }

  function discoverEngine() {
    if (lastEngine && lastEngine.priceScale && lastEngine.timeScale) return lastEngine;

    var canvas = document.getElementById('ofCanvas');
    if (canvas && canvas.__orderflowEngine) return stashEngine(canvas.__orderflowEngine);

    var direct = [
      window.orderflowEngine,
      window.ofEngine,
      window.ofOrderflowEngine,
      window.__orderflowEngine,
      window.__OF_ORDERFLOW_ENGINE__,
    ];
    for (var i = 0; i < direct.length; i++) {
      if (direct[i] && direct[i].priceScale && direct[i].timeScale) return stashEngine(direct[i]);
    }

    // Last resort: scan globals. This is bounded and only used while debugging/interaction.
    try {
      for (var key in window) {
        var v = window[key];
        if (v && v.priceScale && v.timeScale && v.canvas && v.canvas.id === 'ofCanvas') {
          return stashEngine(v);
        }
      }
    } catch (_) {}

    return null;
  }

  function chartYBounds(engine) {
    var ps = engine.priceScale || {};
    var h = Number(ps.height);
    if (!finite(h) || h <= 0) {
      h = engine.canvas ? (engine.canvas.height / (engine.dpr || window.devicePixelRatio || 1)) : 1;
    }
    var top = finite(Number(ps.topMargin)) ? Number(ps.topMargin) : ((engine.layout && engine.layout.topMargin) || 30);
    var bottomMargin = finite(Number(ps.bottomMargin)) ? Number(ps.bottomMargin) : ((engine.layout && engine.layout.bottomMargin) || 40);
    var bottom = Math.max(top + 1, h - bottomMargin);
    return { top: top, bottom: bottom, usable: Math.max(1, bottom - top) };
  }

  function candleNumber(c, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = c && c[keys[i]];
      if (finite(Number(v))) return Number(v);
    }
    return NaN;
  }

  function dataPriceBounds(engine) {
    var min = Infinity;
    var max = -Infinity;
    var candles = engine && engine._candles;

    if (Array.isArray(candles)) {
      for (var i = 0; i < candles.length; i++) {
        var c = candles[i];
        var lo = candleNumber(c, ['low', 'l', 'min', 'priceLow']);
        var hi = candleNumber(c, ['high', 'h', 'max', 'priceHigh']);
        var o = candleNumber(c, ['open', 'o']);
        var cl = candleNumber(c, ['close', 'c', 'price']);
        if (finite(lo)) min = Math.min(min, lo);
        if (finite(hi)) max = Math.max(max, hi);
        if (finite(o)) { min = Math.min(min, o); max = Math.max(max, o); }
        if (finite(cl)) { min = Math.min(min, cl); max = Math.max(max, cl); }
      }
    }

    var ps = engine && engine.priceScale;
    if (!finite(min) || !finite(max) || max <= min) {
      if (ps && finite(Number(ps.minPrice)) && finite(Number(ps.maxPrice)) && Number(ps.maxPrice) > Number(ps.minPrice)) {
        min = Number(ps.minPrice);
        max = Number(ps.maxPrice);
      }
    }

    if (!finite(min) || !finite(max) || max <= min) return null;
    return { min: min, max: max, span: Math.max(1e-9, max - min) };
  }

  function clampPriceRange(engine, from, to) {
    if (!engine || !engine.priceScale) return null;

    from = Number(from);
    to = Number(to);
    if (!finite(from) || !finite(to)) return null;
    if (from === to) return null;
    if (from > to) {
      var tmp = from;
      from = to;
      to = tmp;
    }

    var ps = engine.priceScale;
    var tick = Math.abs(Number(engine._tickSize)) || 1;
    var bounds = dataPriceBounds(engine);
    var currentSpan = finite(Number(ps.maxPrice - ps.minPrice)) && ps.maxPrice > ps.minPrice ? (ps.maxPrice - ps.minPrice) : tick * 100;
    var dataSpan = bounds ? bounds.span : currentSpan;

    var minSpan = Math.max(tick * 3, dataSpan * 0.002, 1e-6);
    var maxSpan = Math.max(tick * 1000, dataSpan * 50, 100000);
    var span = clamp(to - from, minSpan, maxSpan);

    var center = (from + to) / 2;
    if (bounds) {
      // Prevent the classic explosion: finite span but center drifting to astronomical values.
      var pad = Math.max(dataSpan * 8, span * 2, tick * 200);
      center = clamp(center, bounds.min - pad, bounds.max + pad);
    } else if (!finite(center)) {
      center = finite(Number(ps.minPrice + currentSpan / 2)) ? Number(ps.minPrice + currentSpan / 2) : 0;
    }

    return {
      from: center - span / 2,
      to: center + span / 2,
    };
  }

  function forceClampEngine(engine) {
    engine = stashEngine(engine || discoverEngine());
    if (!engine || !engine.priceScale) return;

    var ps = engine.priceScale;
    var r = clampPriceRange(engine, Number(ps.minPrice), Number(ps.maxPrice));
    if (!r) {
      if (typeof engine._fitPrice === 'function') {
        try { engine._fitPrice(0.05); } catch (_) {}
      }
      return;
    }

    if (ps.minPrice !== r.from || ps.maxPrice !== r.to) {
      ps.minPrice = r.from;
      ps.maxPrice = r.to;
      engine._dirty = true;
    }
  }

  function microClamp() {
    var runner = function () { forceClampEngine(); };
    if (typeof queueMicrotask === 'function') queueMicrotask(runner);
    else setTimeout(runner, 0);
  }

  function patchViewportPrototype(proto) {
    if (!proto || proto.__ofGuardPatched) return;
    proto.__ofGuardPatched = true;

    var originalTouch = proto._touch;
    if (typeof originalTouch === 'function') {
      proto._touch = function (reason) {
        stashEngine(this.engine);
        return originalTouch.call(this, reason);
      };
    }

    proto.applyPriceRange = function (from, to) {
      var engine = stashEngine(this.engine);
      var r = clampPriceRange(engine, from, to);
      if (!r) return;
      this.priceRange = { from: r.from, to: r.to };
      if (engine) engine._dirty = true;
    };

    proto.applyTimeRange = function (from, to) {
      var engine = stashEngine(this.engine);
      from = Number(from);
      to = Number(to);
      if (!finite(from) || !finite(to) || to <= from) return;

      var span = to - from;
      var minSpan = Math.max(1000, Number(engine && engine._intervalMs) || 1000);
      var maxSpan = 45 * 24 * 60 * 60 * 1000; // hard safety, keeps pixelsPerMs sane
      span = clamp(span, minSpan, maxSpan);

      var mid = (from + to) / 2;
      if (!finite(mid)) mid = Date.now();
      this.timeRange = { from: mid - span / 2, to: mid + span / 2 };
      if (engine) engine._dirty = true;
    };
  }

  function wrapViewportController(VC) {
    if (typeof VC !== 'function') return VC;
    if (VC.__ofGuardWrapped) {
      patchViewportPrototype(VC.prototype);
      return VC;
    }

    patchViewportPrototype(VC.prototype);

    function GuardedViewportController(engine) {
      stashEngine(engine);
      var instance = new VC(engine);
      stashEngine(engine);
      return instance;
    }

    GuardedViewportController.prototype = VC.prototype;
    GuardedViewportController.__ofGuardWrapped = true;
    GuardedViewportController.__ofOriginal = VC;

    try {
      Object.keys(VC).forEach(function (k) { GuardedViewportController[k] = VC[k]; });
    } catch (_) {}

    return GuardedViewportController;
  }

  function patchEnginePrototype(Engine) {
    if (typeof Engine !== 'function' || !Engine.prototype || Engine.prototype.__ofGuardEnginePatched) return;
    Engine.prototype.__ofGuardEnginePatched = true;

    var oldYToPrice = Engine.prototype.yToPrice;
    if (typeof oldYToPrice === 'function') {
      Engine.prototype.yToPrice = function (y) {
        stashEngine(this);
        var b = chartYBounds(this);
        return oldYToPrice.call(this, clamp(Number(y), b.top, b.bottom));
      };
    }

    var oldPriceToY = Engine.prototype.priceToY;
    if (typeof oldPriceToY === 'function') {
      Engine.prototype.priceToY = function (price) {
        stashEngine(this);
        var y = oldPriceToY.call(this, price);
        return finite(Number(y)) ? y : chartYBounds(this).bottom;
      };
    }
  }

  function safeAxisDrag(engine, e) {
    engine = stashEngine(engine);
    if (!engine || !engine.priceScale || !engine.scrollStart || !engine.dragStart) return false;
    if (!engine._isPointerDown || e.shiftKey) return false;
    if (!engine.layout || !(e.offsetX > engine.layout.chartRight)) return false;

    var dx = Number(e.offsetX) - Number(engine.dragStart.x || 0);
    var dy = Number(e.offsetY) - Number(engine.dragStart.y || 0);
    var threshold = Number(engine._dragThreshold) || 4;
    if (Math.sqrt(dx * dx + dy * dy) < threshold) return false;

    var baseMin = Number(engine.scrollStart.priceMin);
    var baseMax = Number(engine.scrollStart.priceMax);
    var baseRange = baseMax - baseMin;
    if (!finite(baseMin) || !finite(baseMax) || !finite(baseRange) || baseRange <= 0) return false;

    engine.mousePos.x = Number(e.offsetX);
    engine.mousePos.y = Number(e.offsetY);
    engine.inCanvas = true;
    engine._hasMoved = true;

    if (engine.viewport && typeof engine.viewport._touch === 'function') {
      engine.viewport._touch('drag-price-zoom-safe');
    }

    var yb = chartYBounds(engine);
    var anchorY = clamp(Number(engine.dragStart.y), yb.top, yb.bottom);
    var centerPrice = baseMax - ((anchorY - yb.top) / yb.usable) * baseRange;

    var zoomFactor = 1 - dy * 0.0015; // drag up = zoom in, drag down = zoom out
    zoomFactor = clamp(zoomFactor, 0.3, 3);

    var newRange = baseRange * (1 / zoomFactor);
    var ratio = newRange / baseRange;
    var nextMin = centerPrice - (centerPrice - baseMin) * ratio;
    var nextMax = nextMin + newRange;

    if (engine.viewport && typeof engine.viewport.applyPriceRange === 'function') {
      engine.viewport.applyPriceRange(nextMin, nextMax);
    } else {
      var r = clampPriceRange(engine, nextMin, nextMax);
      if (r) {
        engine.priceScale.minPrice = r.from;
        engine.priceScale.maxPrice = r.to;
        engine._dirty = true;
      }
    }

    return true;
  }

  function bindCanvasGuard() {
    var canvas = document.getElementById('ofCanvas');
    if (!canvas || canvas.__ofViewportGuardBound) return;
    canvas.__ofViewportGuardBound = true;

    // Capture phase: when we can identify the engine, replace the old direct axis-drag.
    // If the engine is not discoverable yet, let the original listener run, then clamp in a microtask.
    canvas.addEventListener('pointermove', function (e) {
      var engine = discoverEngine();
      if (safeAxisDrag(engine, e)) {
        if (e.preventDefault) e.preventDefault();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        return;
      }
      microClamp();
    }, true);

    canvas.addEventListener('wheel', function () {
      microClamp();
    }, true);

    canvas.addEventListener('pointerup', microClamp, true);
    canvas.addEventListener('lostpointercapture', microClamp, true);
  }

  function installSetter(obj, prop, patcher) {
    if (!obj) return;
    var current = obj[prop];
    try {
      Object.defineProperty(obj, prop, {
        configurable: true,
        enumerable: true,
        get: function () { return current; },
        set: function (value) {
          current = patcher(value) || value;
        },
      });
      if (current) obj[prop] = current;
    } catch (_) {
      if (current) obj[prop] = patcher(current) || current;
    }
  }

  function installHooks() {
    window.OF = window.OF || {};
    installSetter(window.OF, 'ViewportController', wrapViewportController);
    installSetter(window, 'OrderflowEngine', function (Engine) {
      patchEnginePrototype(Engine);
      return Engine;
    });
  }

  function patchAvailableNow() {
    if (window.OF && window.OF.ViewportController) {
      window.OF.ViewportController = wrapViewportController(window.OF.ViewportController);
    }
    if (window.OrderflowEngine) patchEnginePrototype(window.OrderflowEngine);
    bindCanvasGuard();
    forceClampEngine(discoverEngine());
  }

  installHooks();
  patchAvailableNow();

  document.addEventListener('DOMContentLoaded', patchAvailableNow);
  window.addEventListener('load', patchAvailableNow);

  var tries = 0;
  var timer = setInterval(function () {
    tries += 1;
    patchAvailableNow();
    if (tries > 40 || discoverEngine()) clearInterval(timer);
  }, 100);
})();
