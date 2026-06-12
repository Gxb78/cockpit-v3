// ============ 091_v6_footprint_core.js ============
// Footprint core engine: data structures & calculations
// NO rendering logic here - pure data & math

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};

  // ===== DATA STRUCTURES =====

  /**
   * PriceLevel: Buy/sell volume at a specific price
   * @param {number} price - Price level
   * @param {number} buyVol - Volume bought at this price (aggressive buyers lifting offers)
   * @param {number} sellVol - Volume sold at this price (aggressive sellers hitting bids)
   */
  function PriceLevel(price, buyVol, sellVol) {
    this.price = Number(price) || 0;
    this.buyVol = Math.max(0, Number(buyVol) || 0);
    this.sellVol = Math.max(0, Number(sellVol) || 0);
    this.delta = this.buyVol - this.sellVol; // Positive = bullish, negative = bearish
    this.totalVol = this.buyVol + this.sellVol;
  }

  /**
   * FootprintCandle: Complete footprint for one candle
   * @param {number} openTime - Candle open timestamp
   * @param {number} closeTime - Candle close timestamp
   * @param {Array<PriceLevel>} levels - Price levels with buy/sell volume
   * @param {number} open - OHLC open
   * @param {number} high - OHLC high
   * @param {number} low - OHLC low
   * @param {number} close - OHLC close
   */
  function FootprintCandle(openTime, closeTime, levels, ohlc) {
    this.openTime = Number(openTime) || 0;
    this.closeTime = Number(closeTime) || 0;

    // Sort levels by price (descending for easier rendering)
    this.levels = Array.isArray(levels) ? levels.sort(function(a, b) {
      return b.price - a.price;
    }) : [];

    // OHLC
    this.open = Number(ohlc && ohlc.open) || 0;
    this.high = Number(ohlc && ohlc.high) || 0;
    this.low = Number(ohlc && ohlc.low) || 0;
    this.close = Number(ohlc && ohlc.close) || 0;

    // Calculate metrics
    this._calculateMetrics();
  }

  FootprintCandle.prototype._calculateMetrics = function() {
    var totalBuy = 0, totalSell = 0, maxVol = 0, pocPrice = null, pocVol = 0;
    var allVolumes = [];

    this.levels.forEach(function(level) {
      totalBuy += level.buyVol;
      totalSell += level.sellVol;
      maxVol = Math.max(maxVol, level.totalVol);

      if (level.totalVol > pocVol) {
        pocVol = level.totalVol;
        pocPrice = level.price;
      }

      allVolumes.push(level.totalVol);
    });

    // Totals
    this.totalBuyVol = totalBuy;
    this.totalSellVol = totalSell;
    this.totalVol = totalBuy + totalSell;
    this.totalDelta = totalBuy - totalSell;

    // Point of Control: price level with highest volume
    this.poc = pocPrice;
    this.pocVol = pocVol;

    // Value Area: ~70% of total volume
    this.va = calculateValueArea(this.levels, this.totalVol);

    // Max volume at any single price level
    this.maxPriceLevelVol = maxVol;
  };

  /**
   * Calculate Value Area (70% of volume)
   * Returns { high, low, volume }
   */
  function calculateValueArea(levels, totalVol) {
    if (!levels || !levels.length) return { high: 0, low: 0, volume: 0 };

    var targetVol = totalVol * 0.7;
    var accum = 0;
    var startIdx = null, endIdx = null;

    // Find the range that contains 70% volume, centered on POC
    var sortedByVol = levels.slice().sort(function(a, b) {
      return b.totalVol - a.totalVol;
    });

    var vaVol = 0;
    var vaPrices = [];

    for (var i = 0; i < sortedByVol.length && vaVol < targetVol; i++) {
      vaPrices.push(sortedByVol[i].price);
      vaVol += sortedByVol[i].totalVol;
    }

    if (vaPrices.length === 0) {
      return { high: 0, low: 0, volume: 0 };
    }

    var vaHigh = Math.max.apply(null, vaPrices);
    var vaLow = Math.min.apply(null, vaPrices);

    return {
      high: vaHigh,
      low: vaLow,
      volume: vaVol,
      numLevels: vaPrices.length
    };
  }

  /**
   * Identify volume imbalances (3-to-1 ratio)
   * Returns array of price levels with significant imbalance
   */
  function findImbalances(levels, minRatio) {
    minRatio = Math.max(1.5, Number(minRatio) || 3);
    return levels.filter(function(level) {
      if (level.totalVol === 0) return false;
      var buyRatio = level.buyVol / level.totalVol;
      var sellRatio = level.sellVol / level.totalVol;
      // Imbalance if one side is > minRatio% of total
      return buyRatio > (1 / minRatio) || sellRatio > (1 / minRatio);
    });
  }

  /**
   * Determine aggression side (who's pushing the market)
   * Returns 'buy', 'sell', or 'balanced'
   */
  function aggressionSide(candle) {
    if (!candle) return 'balanced';
    var ratio = Math.abs(candle.totalDelta) / Math.max(1, candle.totalVol);

    if (ratio < 0.1) return 'balanced';
    return candle.totalDelta > 0 ? 'buy' : 'sell';
  }

  // ===== EXPORTS =====
  V6OF.register('Core', 'FootprintCore', {
    PriceLevel: PriceLevel,
    FootprintCandle: FootprintCandle,
    calculateValueArea: calculateValueArea,
    findImbalances: findImbalances,
    aggressionSide: aggressionSide
  });

  if (typeof V6OF.register !== 'function') {
    V6OF.Core = V6OF.Core || {};
    V6OF.Core.FootprintCore = {
      PriceLevel: PriceLevel,
      FootprintCandle: FootprintCandle,
      calculateValueArea: calculateValueArea,
      findImbalances: findImbalances,
      aggressionSide: aggressionSide
    };
  }
})();
