// 077a_v6_canvas_enhancements.js
// Grid-aware rendering enhancements for chart display.
// Patches existing canvas chart with grid snapping and visual improvements.
// Enable debug mode: V6OF.DEBUG_RENDER = true

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};

  /**
   * Draw debug grid overlay (when enabled).
   * Visualizes cell boundaries for alignment verification.
   */
  function drawDebugGridOverlay(ctx, vp, plot, cellWidth, cellHeight) {
    if (!V6OF.DEBUG_RENDER) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(100, 200, 255, 0.15)';
    ctx.lineWidth = 1;

    // Vertical grid lines (time axis)
    var x = plot.left;
    while (x < plot.left + plot.width) {
      ctx.beginPath();
      ctx.moveTo(x, plot.top);
      ctx.lineTo(x, plot.top + plot.height);
      ctx.stroke();
      x += cellWidth;
    }

    // Horizontal grid lines (price axis)
    var y = plot.top;
    while (y < plot.top + plot.height) {
      ctx.beginPath();
      ctx.moveTo(plot.left, y);
      ctx.lineTo(plot.left + plot.width, y);
      ctx.stroke();
      y += cellHeight;
    }

    ctx.restore();
  }

  /**
   * Snap a coordinate to grid (ensure integer pixels).
   */
  function snapToPixel(value) {
    return Math.round(value);
  }

  /**
   * Enhanced candle rendering with grid snapping.
   * Can be used to wrap existing drawCandlesVp calls.
   */
  function enhanceCandleRendering(ctx, candles, vp, plot, upColor, downColor, gridSystem) {
    if (!Array.isArray(candles) || !candles.length) return;

    ctx.save();
    candles.forEach(function (candle) {
      var x1 = snapToPixel(vp.timeToX(Number(candle.openTime || 0)));
      var x2 = snapToPixel(vp.timeToX(Number(candle.closeTime || 0)));
      var yOpen = snapToPixel(vp.priceToY(Number(candle.open || 0)));
      var yClose = snapToPixel(vp.priceToY(Number(candle.close || 0)));
      var yHigh = snapToPixel(vp.priceToY(Number(candle.high || 0)));
      var yLow = snapToPixel(vp.priceToY(Number(candle.low || 0)));

      // Wick (1px wide)
      ctx.strokeStyle = (candle.close >= candle.open) ? upColor : downColor;
      ctx.lineWidth = 1;
      var xMid = Math.round((x1 + x2) / 2);
      ctx.beginPath();
      ctx.moveTo(xMid, yHigh);
      ctx.lineTo(xMid, yLow);
      ctx.stroke();

      // Body (snapped to grid)
      var bodyWidth = Math.max(2, Math.abs(x2 - x1) * 0.6);
      var bodyLeft = xMid - Math.round(bodyWidth / 2);
      var bodyTop = Math.min(yOpen, yClose);
      var bodyHeight = Math.abs(yClose - yOpen);

      ctx.fillStyle = (candle.close >= candle.open) ? upColor : downColor;
      ctx.fillRect(bodyLeft, bodyTop, bodyWidth, Math.max(1, bodyHeight));
    });
    ctx.restore();
  }

  /**
   * Create heatmap colorRamp and apply to canvas rendering.
   */
  function createHeatmapRamp() {
    if (!ColorRamp) return null;
    return new ColorRamp('#001a4d', '#ff6600'); // dark blue (cold) to orange (hot)
  }

  /**
   * Enhance footprint rendering with even row spacing.
   */
  function enhanceFootprintRowSpacing(container, visibleLevels) {
    if (!container) return;
    var rowHeight = container.clientHeight / Math.max(1, visibleLevels);
    var rows = container.querySelectorAll('[data-footprint-row]');
    rows.forEach(function (row, idx) {
      row.style.top = (idx * rowHeight) + 'px';
      row.style.height = rowHeight + 'px';
      // Center text vertically
      var textEl = row.querySelector('[data-footprint-text]');
      if (textEl) {
        textEl.style.lineHeight = rowHeight + 'px';
      }
    });
  }

  // Export helpers
  V6OF.CanvasEnhancements = {
    drawDebugGridOverlay: drawDebugGridOverlay,
    snapToPixel: snapToPixel,
    enhanceCandleRendering: enhanceCandleRendering,
    createHeatmapRamp: createHeatmapRamp,
    enhanceFootprintRowSpacing: enhanceFootprintRowSpacing
  };

  // Hook into existing canvas chart if available
  if (V6OF.CanvasChart && V6OF.CanvasChart.draw) {
    var origDraw = V6OF.CanvasChart.draw;
    V6OF.CanvasChart.draw = function(canvas, state) {
      var result = origDraw.call(this, canvas, state);
      // Could add debug overlay here if needed
      return result;
    };
  }
})();
