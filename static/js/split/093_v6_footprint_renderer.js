// ============ 093_v6_footprint_renderer.js ============
// Footprint rendering: correct visualization of order flow

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};
  var FootprintCore = V6OF.Core && V6OF.Core.FootprintCore;

  function footprintDebugEnabled() {
    return !!(V6OF.debugFootprint || V6OF.DEBUG_FOOTPRINT);
  }

  function footprintDebugError() {
    if (!footprintDebugEnabled() || !console || !console.error) return;
    console.error.apply(console, arguments);
  }

  if (!FootprintCore) {
    footprintDebugError('[Footprint Renderer] FootprintCore not available');
    return;
  }

  // ===== COLOR SCHEME =====
  var COLORS = {
    buy: '#39c77a',        // Green: bullish/buy volume
    sell: '#d85b66',       // Red: bearish/sell volume
    neutral: '#555d6f',    // Gray: balanced
    poc: '#facc15',        // Yellow: Point of Control
    va: 'rgba(255, 193, 7, 0.1)',  // Value Area background
    imbalance: 'rgba(255, 193, 7, 0.3)' // Imbalance highlight
  };

  // ===== SIZING =====
  var MIN_LEVEL_HEIGHT = 2;
  var COLUMN_GAP = 1;
  var POC_WIDTH = 3;

  function normalizeTickSize(options, candle) {
    var tick = Number(options && options.tickSize);
    if (Number.isFinite(tick) && tick > 0) return tick;

    var levels = candle && Array.isArray(candle.levels) ? candle.levels : [];
    var prices = levels.map(function(level) { return Number(level && level.price); })
      .filter(function(price) { return Number.isFinite(price); })
      .sort(function(a, b) { return a - b; });
    var minStep = Infinity;
    for (var i = 1; i < prices.length; i++) {
      var step = Math.abs(prices[i] - prices[i - 1]);
      if (step > 0 && step < minStep) minStep = step;
    }
    return Number.isFinite(minStep) ? minStep : 1;
  }

  function priceLevelHeight(vp, price, tickSize) {
    price = Number(price);
    tickSize = Number(tickSize);
    if (!vp || typeof vp.priceToY !== 'function' || !Number.isFinite(price) || !Number.isFinite(tickSize) || tickSize <= 0) {
      return MIN_LEVEL_HEIGHT;
    }
    var y = vp.priceToY(price);
    var yTick = vp.priceToY(price + tickSize);
    var h = Math.abs(y - yTick);
    return Math.max(MIN_LEVEL_HEIGHT, Number.isFinite(h) ? h : 0);
  }

  /**
   * Render single footprint candle
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - Candle x position
   * @param {number} width - Candle width in pixels
   * @param {object} vp - Viewport (has priceToY for mapping)
   * @param {FootprintCandle} candle - The footprint candle
   * @param {object} options - Rendering options
   */
  function renderFootprintCandle(ctx, x, width, vp, candle, options) {
    // DEFENSIVE: strict validation before rendering
    if (!candle) return;
    if (!candle.levels || !Array.isArray(candle.levels)) return;
    if (candle.levels.length === 0) return;

    // Skip if no volume at all
    var hasVolume = candle.levels.some(function(level) {
      return level && level.totalVol > 0;
    });
    if (!hasVolume) return;

    // Skip if maxVol is invalid (prevents render artifacts)
    if (!Number.isFinite(candle.maxPriceLevelVol) || candle.maxPriceLevelVol <= 0) return;

    options = options || {};
    var showPOC = options.showPOC !== false;
    var showVA = options.showVA !== false;
    var showImbalances = options.showImbalances !== false;
    var showDelta = options.showDelta !== false;

    // Calculate available width for bid/ask columns
    var innerWidth = Math.max(4, width - 2);
    var columnWidth = (innerWidth - COLUMN_GAP) / 2;

    // Find max volume at any level for scaling
    var maxVol = candle.maxPriceLevelVol || 1;
    var tickSize = normalizeTickSize(options, candle);

    // Draw each price level
    candle.levels.forEach(function(level) {
      var y = vp.priceToY(level.price);
      var levelHeight = priceLevelHeight(vp, level.price, tickSize);

      // Scale volume: proportion of max volume × column width
      var buyWidth = (level.buyVol / maxVol) * columnWidth;
      var sellWidth = (level.sellVol / maxVol) * columnWidth;

      // Buy side (left)
      if (level.buyVol > 0) {
        drawBar(ctx, x + (columnWidth - buyWidth), y - levelHeight / 2, buyWidth, levelHeight, COLORS.buy, level.delta);
      }

      // Sell side (right)
      if (level.sellVol > 0) {
        drawBar(ctx, x + innerWidth / 2 + COLUMN_GAP / 2, y - levelHeight / 2, sellWidth, levelHeight, COLORS.sell, level.delta);
      }
    });

    // Draw POC (Point of Control) marker
    if (showPOC && candle.poc) {
      drawPOC(ctx, x, x + width, candle.poc, vp);
    }

    // Draw Value Area
    if (showVA && candle.va && candle.va.high) {
      drawValueArea(ctx, x, x + width, candle.va, vp);
    }

    // Highlight imbalances
    if (showImbalances) {
      var imbalances = FootprintCore.findImbalances(candle.levels, 3);
      imbalances.forEach(function(level) {
        drawImbalanceHighlight(ctx, x, x + width, level.price, vp, tickSize);
      });
    }
  }

  /**
   * Draw a single volume bar
   */
  function colorWithAlpha(color, alpha) {
    alpha = Math.max(0, Math.min(1, Number(alpha)));
    color = String(color || '').trim();

    var hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      var raw = hex[1];
      if (raw.length === 3) {
        raw = raw.charAt(0) + raw.charAt(0) + raw.charAt(1) + raw.charAt(1) + raw.charAt(2) + raw.charAt(2);
      }
      var n = parseInt(raw, 16);
      var r = (n >> 16) & 255;
      var g = (n >> 8) & 255;
      var b = n & 255;
      return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }

    var rgb = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*[\d.]+)?\s*\)$/i);
    if (rgb) {
      return 'rgba(' + Number(rgb[1]) + ',' + Number(rgb[2]) + ',' + Number(rgb[3]) + ',' + alpha + ')';
    }

    return color || 'rgba(85,93,111,' + alpha + ')';
  }

  function drawBar(ctx, x, y, width, height, color, delta) {
    if (width <= 0 || height <= 0) return;

    // Vary opacity based on delta strength
    var opacity = Math.min(1, 0.3 + Math.abs(delta) / 1000);
    ctx.fillStyle = colorWithAlpha(color, opacity);
    ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  }

  /**
   * Draw Point of Control marker line
   */
  function drawPOC(ctx, x, x2, pocPrice, vp) {
    var pocY = Math.round(vp.priceToY(pocPrice));

    ctx.strokeStyle = COLORS.poc;
    ctx.lineWidth = POC_WIDTH;
    ctx.beginPath();
    ctx.moveTo(x, pocY);
    ctx.lineTo(x2, pocY);
    ctx.stroke();
  }

  /**
   * Draw Value Area background
   */
  function drawValueArea(ctx, x, x2, va, vp) {
    var vaHigh = vp.priceToY(va.high);
    var vaLow = vp.priceToY(va.low);
    var vaHeight = Math.abs(vaLow - vaHigh);

    ctx.fillStyle = COLORS.va;
    ctx.fillRect(
      Math.round(x),
      Math.round(Math.min(vaHigh, vaLow)),
      Math.round(x2 - x),
      Math.round(vaHeight)
    );
  }

  /**
   * Highlight imbalance at specific price level
   */
  function drawImbalanceHighlight(ctx, x, x2, price, vp, tickSize) {
    var y = Math.round(vp.priceToY(price));
    var levelHeight = priceLevelHeight(vp, price, tickSize);

    ctx.fillStyle = COLORS.imbalance;
    ctx.fillRect(
      Math.round(x),
      Math.round(y - levelHeight / 2),
      Math.round(x2 - x),
      Math.round(levelHeight)
    );
  }

  /**
   * Render footprint candles to canvas
   * @param {CanvasRenderingContext2D} ctx
   * @param {Viewport} vp - Viewport with timeToX, priceToY
   * @param {object} plot - Plot area bounds {left, top, width, height}
   * @param {Array<FootprintCandle>} candles - Footprints to render
   * @param {object} options - Rendering options
   */
  function renderFootprints(ctx, vp, plot, candles, options) {
    if (!Array.isArray(candles) || !candles.length) return;

    options = options || {};

    candles.forEach(function(candle) {
      var x1 = vp.timeToX(candle.openTime);
      var x2 = vp.timeToX(candle.closeTime);

      if (x2 < plot.left || x1 > plot.left + plot.width) return; // Off-screen

      var candleWidth = Math.max(2, x2 - x1);
      var candleX = Math.max(plot.left, x1);

      renderFootprintCandle(ctx, candleX, candleWidth, vp, candle, options);
    });
  }

  /**
   * Get recommended footprint display mode based on zoom level
   * Returns: 'ohlc', 'footprint-simple', 'footprint-full'
   */
  function recommendDisplayMode(vp) {
    if (!vp || !vp.plot || !vp.plot.width) return 'ohlc';

    // Base visibility on pixels-per-candle, not absolute time spans.
    // A 1m candle at 40px and a 1h candle at 40px are equally readable;
    // absolute time thresholds (30d, 1d) don't reflect that.
    var intervalMs = vp.candleIntervalMs || 60000;
    var span = vp.timeEnd - vp.timeStart;
    if (!span || span <= 0) return 'ohlc';
    var candlesInView = span / intervalMs;
    if (candlesInView <= 0) return 'ohlc';
    var pxCandle = vp.plot.width / candlesInView;

    // Too narrow for any footprint text — OHLC only
    if (pxCandle < 40) return 'ohlc';

    // Moderate width — simplified footprint (POC + delta only)
    if (pxCandle < 80) return 'footprint-simple';

    // Wide enough for full footprint (levels, imbalances, VA)
    return 'footprint-full';
  }

  // ===== EXPORTS =====
  V6OF.register('UI', 'FootprintRenderer', {
    renderFootprintCandle: renderFootprintCandle,
    renderFootprints: renderFootprints,
    recommendDisplayMode: recommendDisplayMode,
    COLORS: COLORS
  });

  if (typeof V6OF.register !== 'function') {
    V6OF.UI = V6OF.UI || {};
    V6OF.UI.FootprintRenderer = {
      renderFootprintCandle: renderFootprintCandle,
      renderFootprints: renderFootprints,
      recommendDisplayMode: recommendDisplayMode,
      COLORS: COLORS
    };
  }
})();
