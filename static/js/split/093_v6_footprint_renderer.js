// ============ 093_v6_footprint_renderer.js ============
// Footprint rendering: correct visualization of order flow

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};
  var FootprintCore = V6OF.Core && V6OF.Core.FootprintCore;

  if (!FootprintCore) {
    console.error('[Footprint Renderer] FootprintCore not available');
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

    // Draw each price level
    candle.levels.forEach(function(level) {
      var y = vp.priceToY(level.price);
      var levelHeight = Math.max(MIN_LEVEL_HEIGHT, vp.priceToY(level.price - (vp.priceMax - vp.priceMin) / 100));

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
        drawImbalanceHighlight(ctx, x, x + width, level.price, vp);
      });
    }
  }

  /**
   * Draw a single volume bar
   */
  function drawBar(ctx, x, y, width, height, color, delta) {
    if (width <= 0 || height <= 0) return;

    // Vary opacity based on delta strength
    var opacity = Math.min(1, 0.3 + Math.abs(delta) / 1000);
    ctx.fillStyle = color.replace('rgb(', 'rgba(').replace(')', ', ' + opacity + ')');
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
  function drawImbalanceHighlight(ctx, x, x2, price, vp) {
    var y = Math.round(vp.priceToY(price));
    var levelHeight = Math.max(2, Math.abs(vp.priceToY(price - 1) - y));

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
    if (!vp) return 'ohlc';

    var timeSpan = vp.timeEnd - vp.timeStart;
    var oneDay = 86400000; // 24h in ms

    // Show OHLC only if zoomed out
    if (timeSpan > oneDay * 30) return 'ohlc';

    // Show simple footprint if moderately zoomed
    if (timeSpan > oneDay) return 'footprint-simple';

    // Show full footprint if well zoomed
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
