// ---------- 066a_orderflow_viewport.js ----------
// ViewportController orderflow: machine d'etat + setters uniques.

(function () {
  'use strict';

  var OF = window.OF = window.OF || {};

  OF.ViewportController = function (engine) {
    this.engine = engine;
    this.mode = 'auto'; // 'auto' | 'manual'
    this.userDetached = false;

    Object.defineProperty(this, 'timeRange', {
      get: function () { return { from: engine.timeScale.startTime, to: engine.timeScale.endTime }; },
      set: function (r) { engine.timeScale.startTime = r.from; engine.timeScale.endTime = r.to; engine._dirty = true; },
    });
    Object.defineProperty(this, 'priceRange', {
      get: function () { return { from: engine.priceScale.minPrice, to: engine.priceScale.maxPrice }; },
      set: function (r) { engine.priceScale.minPrice = r.from; engine.priceScale.maxPrice = r.to; engine._dirty = true; },
    });
  };

  OF.ViewportController.prototype._touch = function (reason) {
    if (this.mode === 'auto') {
      this.mode = 'manual';
      this.userDetached = true;
    }
  };

  OF.ViewportController.prototype.setDataRange = function (reason) {
    if (this.mode === 'manual') return;
    this.engine._fitToData();
  };

  OF.ViewportController.prototype.fitPrice = function (reason, margin) {
    this._touch(reason);
    this.engine._fitPrice(margin || 0.05);
  };

  OF.ViewportController.prototype.fitTime = function (reason) {
    this._touch(reason || 'fit-time');
    this.engine._fitToData();
  };

  OF.ViewportController.prototype.reset = function (reason) {
    this._touch(reason);
    this.engine._resetDefaultView();
  };

  OF.ViewportController.prototype.pan = function (dx, dy, reason) {
    this._touch(reason || 'pan');
    this.engine._pan(dx, dy);
  };

  OF.ViewportController.prototype.scrollTime = function (dir, pixels, reason) {
    this._touch(reason || 'scroll');
    this.engine._scrollTime(dir, pixels);
  };

  OF.ViewportController.prototype.zoomPrice = function (y, factor, reason) {
    this._touch(reason || 'zoom');
    this.engine._zoomPrice(y, factor);
  };

  OF.ViewportController.prototype.zoomGlobal = function (y, factor, reason) {
    this._touch(reason || 'zoom');
    this.engine._zoomGlobal(y, factor);
  };

  OF.ViewportController.prototype.zoomTime = function (factor, reason) {
    this._touch(reason || 'zoom-time');
    this.engine._zoomTime(factor);
  };

  OF.ViewportController.prototype.nudgeTime = function (dtMs, reason) {
    this._touch(reason || 'nudge-time');
    var r = this.timeRange;
    this.applyTimeRange(r.from + dtMs, r.to + dtMs);
  };

  OF.ViewportController.prototype.nudgePrice = function (dPrice, reason) {
    this._touch(reason || 'nudge-price');
    var r = this.priceRange;
    this.applyPriceRange(r.from + dPrice, r.to + dPrice);
  };

  OF.ViewportController.prototype.setMode = function (mode, userDetached) {
    this.mode = mode === 'auto' ? 'auto' : 'manual';
    this.userDetached = !!userDetached;
  };

  OF.ViewportController.prototype.applyTimeRange = function (from, to) {
    this.timeRange = { from: from, to: to };
  };
  OF.ViewportController.prototype.applyPriceRange = function (from, to) {
    this.priceRange = { from: from, to: to };
  };

  // Extensions utiles debug/ops
  OF.ViewportController.prototype.getState = function () {
    return {
      mode: this.mode,
      userDetached: !!this.userDetached,
      timeRange: this.timeRange,
      priceRange: this.priceRange,
    };
  };

  OF.ViewportController.prototype.enableAuto = function (reason) {
    this.setMode('auto', false);
    this.setDataRange(reason || 'auto-enable');
  };

  OF.ViewportController.prototype.onLiveTrade = function (_trade) {
    if (this.mode !== 'auto' || this.userDetached) return;
  };
})();
