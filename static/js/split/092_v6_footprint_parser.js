// ============ 092_v6_footprint_parser.js ============
// Footprint data parsing: convert server data → FootprintCandles

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};
  var FootprintCore = V6OF.Core && V6OF.Core.FootprintCore;

  if (!FootprintCore) {
    console.error('[Footprint Parser] FootprintCore not available');
    return;
  }

  var PriceLevel = FootprintCore.PriceLevel;
  var FootprintCandle = FootprintCore.FootprintCandle;

  // ===== PARSING =====

  /**
   * Parse raw server footprint data → FootprintCandle
   * Server format: { openTime, closeTime, ohlc, levels: [{price, buyVol, sellVol}, ...] }
   */
  function parseFootprintCandle(rawData) {
    if (!rawData) return null;

    var levels = [];
    if (Array.isArray(rawData.levels)) {
      levels = rawData.levels.map(function(lvl) {
        return new PriceLevel(
          lvl.price,
          lvl.buyVol || lvl.buy || 0,
          lvl.sellVol || lvl.sell || 0
        );
      });
    }

    var ohlc = rawData.ohlc || {
      open: rawData.open || 0,
      high: rawData.high || 0,
      low: rawData.low || 0,
      close: rawData.close || 0
    };

    return new FootprintCandle(
      rawData.openTime,
      rawData.closeTime,
      levels,
      ohlc
    );
  }

  /**
   * Parse array of raw candles → array of FootprintCandles
   */
  function parseFootprintCandles(rawCandles) {
    if (!Array.isArray(rawCandles)) return [];

    return rawCandles
      .map(parseFootprintCandle)
      .filter(function(candle) { return candle !== null; });
  }

  /**
   * Validate footprint candle has required data
   */
  function isValidFootprint(candle) {
    return candle &&
           typeof candle === 'object' &&
           Array.isArray(candle.levels) &&
           candle.levels.length > 0 &&
           Number.isFinite(candle.open) &&
           Number.isFinite(candle.close);
  }

  /**
   * Aggregate footprints from 1m to target timeframe
   * Takes array of 1m candles, returns aggregated candle
   */
  function aggregateFootprints(oneMinCandles, targetTf) {
    if (!Array.isArray(oneMinCandles) || !oneMinCandles.length) {
      return null;
    }

    // Filter valid candles
    var validCandles = oneMinCandles.filter(isValidFootprint);
    if (!validCandles.length) return null;

    // Aggregate price levels: merge all levels, sum volumes
    var levelMap = {}; // { price: PriceLevel }

    validCandles.forEach(function(candle) {
      candle.levels.forEach(function(level) {
        var key = level.price.toFixed(8); // Use string key for precision
        if (!levelMap[key]) {
          levelMap[key] = new PriceLevel(level.price, 0, 0);
        }
        levelMap[key].buyVol += level.buyVol;
        levelMap[key].sellVol += level.sellVol;
        levelMap[key].delta = levelMap[key].buyVol - levelMap[key].sellVol;
        levelMap[key].totalVol = levelMap[key].buyVol + levelMap[key].sellVol;
      });
    });

    // Convert map back to array
    var aggregatedLevels = Object.keys(levelMap).map(function(key) {
      return levelMap[key];
    });

    // Use first and last candle for time/OHLC
    var first = validCandles[0];
    var last = validCandles[validCandles.length - 1];

    var aggregatedOhlc = {
      open: first.open,
      high: Math.max.apply(null, validCandles.map(function(c) { return c.high; })),
      low: Math.min.apply(null, validCandles.map(function(c) { return c.low; })),
      close: last.close
    };

    return new FootprintCandle(
      first.openTime,
      last.closeTime,
      aggregatedLevels,
      aggregatedOhlc
    );
  }

  /**
   * Merge footprints intelligently: update existing or append new
   * Keeps max N candles
   */
  function mergeFootprints(existingCandles, newCandles, maxCandles) {
    if (!Array.isArray(existingCandles)) existingCandles = [];
    if (!Array.isArray(newCandles)) newCandles = [];

    maxCandles = Math.max(1, Number(maxCandles) || 100);

    // Create a map for fast lookup
    var candleMap = {};
    existingCandles.forEach(function(candle) {
      candleMap[candle.openTime] = candle;
    });

    // Merge new candles (update or add)
    newCandles.forEach(function(candle) {
      candleMap[candle.openTime] = candle;
    });

    // Convert back to array, sort by time, limit to maxCandles
    var merged = Object.keys(candleMap)
      .map(function(key) { return candleMap[key]; })
      .sort(function(a, b) { return a.openTime - b.openTime; })
      .slice(-maxCandles); // Keep most recent

    return merged;
  }

  /**
   * Sanitize footprint: remove invalid/empty levels
   */
  function sanitizeFootprint(candle) {
    if (!isValidFootprint(candle)) return null;

    // Remove levels with zero volume
    candle.levels = candle.levels.filter(function(level) {
      return level.totalVol > 0;
    });

    if (candle.levels.length === 0) return null;

    // Recalculate metrics after filtering
    candle._calculateMetrics();

    return candle;
  }

  // ===== EXPORTS =====
  V6OF.register('Core', 'FootprintParser', {
    parseFootprintCandle: parseFootprintCandle,
    parseFootprintCandles: parseFootprintCandles,
    isValidFootprint: isValidFootprint,
    aggregateFootprints: aggregateFootprints,
    mergeFootprints: mergeFootprints,
    sanitizeFootprint: sanitizeFootprint
  });

  if (typeof V6OF.register !== 'function') {
    V6OF.Core = V6OF.Core || {};
    V6OF.Core.FootprintParser = {
      parseFootprintCandle: parseFootprintCandle,
      parseFootprintCandles: parseFootprintCandles,
      isValidFootprint: isValidFootprint,
      aggregateFootprints: aggregateFootprints,
      mergeFootprints: mergeFootprints,
      sanitizeFootprint: sanitizeFootprint
    };
  }
})();
