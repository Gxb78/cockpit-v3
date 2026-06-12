// 076_v6_grid_system.js
// Pixel-perfect grid system for chart rendering.
// Provides grid snapping, cell calculations, and alignment helpers
// for candles, footprint, heatmap, bubbles, CVD, and crosshair layers.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};

  /**
   * GridSystem: Manages pixel-perfect grid for chart rendering.
   * All visual elements snap to grid for alignment and consistency.
   *
   * @constructor
   * @param {number} canvasWidth - Canvas width in CSS pixels
   * @param {number} canvasHeight - Canvas height in CSS pixels
   * @param {number} cellWidth - Width of each grid cell (time axis)
   * @param {number} cellHeight - Height of each grid cell (price axis)
   * @param {number} [dpr=1] - Device pixel ratio (for HiDPI)
   */
  function GridSystem(canvasWidth, canvasHeight, cellWidth, cellHeight, dpr) {
    this.canvasWidth = Math.max(1, canvasWidth);
    this.canvasHeight = Math.max(1, canvasHeight);
    this.cellWidth = Math.max(1, cellWidth);
    this.cellHeight = Math.max(1, cellHeight);
    this.dpr = dpr || (window.devicePixelRatio || 1);
  }

  /**
   * Snap a coordinate to the nearest grid point.
   * @param {number} x - X coordinate (CSS pixels)
   * @param {number} y - Y coordinate (CSS pixels)
   * @returns {{x: number, y: number}} - Snapped coordinates
   */
  GridSystem.prototype.snapToGrid = function(x, y) {
    return {
      x: Math.round(x / this.cellWidth) * this.cellWidth,
      y: Math.round(y / this.cellHeight) * this.cellHeight
    };
  };

  /**
   * Snap a width to grid cell width.
   * @param {number} w - Width to snap
   * @returns {number} - Snapped width
   */
  GridSystem.prototype.snapWidth = function(w) {
    return Math.round(w / this.cellWidth) * this.cellWidth;
  };

  /**
   * Snap a height to grid cell height.
   * @param {number} h - Height to snap
   * @returns {number} - Snapped height
   */
  GridSystem.prototype.snapHeight = function(h) {
    return Math.round(h / this.cellHeight) * this.cellHeight;
  };

  /**
   * Get grid cell bounds at (row, col) index.
   * @param {number} colIndex - Column index (time)
   * @param {number} rowIndex - Row index (price)
   * @returns {{x: number, y: number, width: number, height: number}} - Cell bounds
   */
  GridSystem.prototype.getCellAt = function(colIndex, rowIndex) {
    return {
      x: colIndex * this.cellWidth,
      y: rowIndex * this.cellHeight,
      width: this.cellWidth,
      height: this.cellHeight
    };
  };

  /**
   * Get center of a grid cell.
   * @param {number} colIndex - Column index
   * @param {number} rowIndex - Row index
   * @returns {{x: number, y: number}} - Cell center
   */
  GridSystem.prototype.getCellCenter = function(colIndex, rowIndex) {
    return {
      x: colIndex * this.cellWidth + this.cellWidth / 2,
      y: rowIndex * this.cellHeight + this.cellHeight / 2
    };
  };

  /**
   * Get all grid lines (for debug rendering).
   * @returns {{vertical: number[], horizontal: number[]}} - X and Y coordinates of grid lines
   */
  GridSystem.prototype.getGridLines = function() {
    var vertical = [];
    var horizontal = [];
    var x, y;

    for (x = 0; x <= this.canvasWidth; x += this.cellWidth) {
      vertical.push(x);
    }
    for (y = 0; y <= this.canvasHeight; y += this.cellHeight) {
      horizontal.push(y);
    }

    return { vertical: vertical, horizontal: horizontal };
  };

  /**
   * Get price from pixel Y coordinate (inverse of Y mapping).
   * Requires viewport context (min/max price, height).
   * @param {number} pixelY - Pixel Y (0 = top)
   * @param {number} minPrice - Minimum price (bottom)
   * @param {number} maxPrice - Maximum price (top)
   * @returns {number} - Price at pixel Y
   */
  GridSystem.prototype.getPriceFromPixelY = function(pixelY, minPrice, maxPrice) {
    var priceDiff = maxPrice - minPrice;
    var price = maxPrice - (pixelY / this.canvasHeight) * priceDiff;
    return price;
  };

  /**
   * Get pixel Y from price (map price to canvas Y).
   * @param {number} price - Price level
   * @param {number} minPrice - Minimum price (bottom)
   * @param {number} maxPrice - Maximum price (top)
   * @returns {number} - Pixel Y coordinate
   */
  GridSystem.prototype.getPixelYFromPrice = function(price, minPrice, maxPrice) {
    var priceDiff = maxPrice - minPrice;
    var pixelY = (1 - (price - minPrice) / priceDiff) * this.canvasHeight;
    return pixelY;
  };

  /**
   * Get time from pixel X coordinate.
   * @param {number} pixelX - Pixel X
   * @param {number} totalCandles - Total number of candles in chart
   * @returns {number} - Time index (candle index)
   */
  GridSystem.prototype.getTimeFromPixelX = function(pixelX, totalCandles) {
    var candleIndex = Math.round(pixelX / this.cellWidth);
    return Math.max(0, Math.min(candleIndex, totalCandles - 1));
  };

  /**
   * Get pixel X from time index.
   * @param {number} candleIndex - Candle index
   * @returns {number} - Pixel X coordinate
   */
  GridSystem.prototype.getPixelXFromTime = function(candleIndex) {
    return candleIndex * this.cellWidth;
  };

  /**
   * Check if a coordinate is within canvas bounds.
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   * @returns {boolean}
   */
  GridSystem.prototype.isWithinBounds = function(x, y) {
    return x >= 0 && x <= this.canvasWidth && y >= 0 && y <= this.canvasHeight;
  };

  /**
   * Get visible grid cells range (for culling).
   * @param {number} visibleColStart - First visible column
   * @param {number} visibleColEnd - Last visible column
   * @param {number} visibleRowStart - First visible row
   * @param {number} visibleRowEnd - Last visible row
   * @returns {{cols: {start: number, end: number}, rows: {start: number, end: number}}}
   */
  GridSystem.prototype.getVisibleCellRange = function(visibleColStart, visibleColEnd, visibleRowStart, visibleRowEnd) {
    var colStart = Math.max(0, Math.floor(visibleColStart / this.cellWidth));
    var colEnd = Math.ceil(visibleColEnd / this.cellWidth);
    var rowStart = Math.max(0, Math.floor(visibleRowStart / this.cellHeight));
    var rowEnd = Math.ceil(visibleRowEnd / this.cellHeight);

    return {
      cols: { start: colStart, end: colEnd },
      rows: { start: rowStart, end: rowEnd }
    };
  };

  // Export
  if (!V6OF.register) {
    V6OF.Core = V6OF.Core || {};
    V6OF.Core.GridSystem = GridSystem;
  } else {
    V6OF.register('Core', 'GridSystem', GridSystem);
  }
})();
