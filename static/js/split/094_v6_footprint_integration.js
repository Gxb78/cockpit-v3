// ============ 094_v6_footprint_integration.js ============
// Footprint integration: tie together core, parser, renderer

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};
  var FootprintCore = V6OF.Core && V6OF.Core.FootprintCore;
  var FootprintParser = V6OF.Core && V6OF.Core.FootprintParser;
  var FootprintRenderer = V6OF.UI && V6OF.UI.FootprintRenderer;

  if (!FootprintCore || !FootprintParser || !FootprintRenderer) {
    console.error('[Footprint Integration] Missing dependencies (Core, Parser, Renderer)');
    return;
  }

  // ===== INTEGRATION ENGINE =====

  /**
   * Process raw server footprints into renderable format
   * @param {Array} rawFootprints - Raw data from server
   * @param {string} timeframe - Target timeframe ('1m', '5m', etc)
   * @param {number} maxCandles - Max candles to keep
   * @returns {Array<FootprintCandle>} - Ready-to-render candles
   */
  function processFootprints(rawFootprints, timeframe, maxCandles) {
    if (!Array.isArray(rawFootprints)) return [];

    // Parse raw data
    var parsed = FootprintParser.parseFootprintCandles(rawFootprints);
    if (!parsed.length) return [];

    // If not 1m, aggregate to target timeframe
    if (timeframe && timeframe !== '1m') {
      var aggregated = aggregateByTimeframe(parsed, timeframe);
      return aggregated.slice(-(maxCandles || 100));
    }

    // Return most recent N candles
    return parsed.slice(-(maxCandles || 100));
  }

  /**
   * Aggregate 1m candles to target timeframe
   * Naive approach: group by timeframe bucket and aggregate
   */
  function aggregateByTimeframe(oneMinCandles, tf) {
    if (!oneMinCandles.length) return [];

    var tfMs = timeframeToMs(tf);
    if (!tfMs) return oneMinCandles; // Fallback to 1m

    var buckets = {}; // { bucketTime: [candles] }

    oneMinCandles.forEach(function(candle) {
      var bucketTime = Math.floor(candle.openTime / tfMs) * tfMs;
      if (!buckets[bucketTime]) buckets[bucketTime] = [];
      buckets[bucketTime].push(candle);
    });

    // Aggregate each bucket
    return Object.keys(buckets)
      .sort(function(a, b) { return Number(a) - Number(b); })
      .map(function(bucketTime) {
        return FootprintParser.aggregateFootprints(buckets[bucketTime], tf);
      })
      .filter(function(candle) { return candle !== null; });
  }

  /**
   * Convert timeframe string to milliseconds
   */
  function timeframeToMs(tf) {
    var map = {
      '1m': 60000,
      '5m': 5 * 60000,
      '15m': 15 * 60000,
      '30m': 30 * 60000,
      '1h': 60 * 60000,
      '4h': 4 * 60 * 60000,
      '1d': 24 * 60 * 60000
    };
    return map[String(tf).toLowerCase()];
  }

  /**
   * Main integration: render footprints to canvas
   * Call this from canvas chart renderer
   * DEFENSIVE: multiple validation gates prevent crashes and DOM artifacts
   */
  function renderFootprintsToCanvas(ctx, vp, plot, state, settings) {
    // Gate 1: Basic state validation
    if (!state || typeof state !== 'object') return false;
    if (!state.footprintCandles) return false;

    var candles = state.footprintCandles;
    if (!Array.isArray(candles) || candles.length === 0) return false;

    // Gate 2: Viewport validation
    if (!vp || typeof vp.priceToY !== 'function' || typeof vp.timeToX !== 'function') {
      return false;
    }

    // Gate 3: Plot validation
    if (!plot || !Number.isFinite(plot.left) || !Number.isFinite(plot.width)) {
      return false;
    }

    // Gate 4: Filter and validate footprints
    var validCandles = candles
      .filter(function(c) { return c !== null && c !== undefined; })
      .filter(FootprintParser.isValidFootprint);

    if (!validCandles.length) return false;

    // Gate 5: Settings validation
    var options = {
      showPOC: settings && settings.showFootprintPOC !== false,
      showVA: settings && settings.showFootprintVA !== false,
      showImbalances: settings && settings.showFootprintImbalances !== false,
      showDelta: settings && settings.showFootprintDelta !== false
    };

    // Gate 6: Safe rendering with error handling
    try {
      FootprintRenderer.renderFootprints(ctx, vp, plot, validCandles, options);
      return true;
    } catch (e) {
      console.error('[Footprint Integration] Render error:', e);
      // Don't crash - just skip rendering this frame
      return false;
    }
  }

  /**
   * Determine if footprint should be visible based on zoom
   */
  function shouldShowFootprint(vp, settings) {
    if (!settings || settings.showFootprint !== true) return false;

    // Check zoom level
    var displayMode = FootprintRenderer.recommendDisplayMode(vp);
    return displayMode !== 'ohlc';
  }

  /**
   * Merge new footprints with existing state
   */
  function updateFootprintState(existingCandles, newRawFootprints, maxCandles) {
    var newParsed = FootprintParser.parseFootprintCandles(newRawFootprints);
    if (!newParsed.length) return existingCandles;

    return FootprintParser.mergeFootprints(existingCandles, newParsed, maxCandles);
  }

  /**
   * Reset footprint cache (clear all footprints)
   */
  function resetFootprints() {
    return [];
  }

  // ===== EXPORTS =====
  V6OF.register('UI', 'FootprintIntegration', {
    processFootprints: processFootprints,
    renderFootprintsToCanvas: renderFootprintsToCanvas,
    shouldShowFootprint: shouldShowFootprint,
    updateFootprintState: updateFootprintState,
    resetFootprints: resetFootprints,
    timeframeToMs: timeframeToMs
  });

  if (typeof V6OF.register !== 'function') {
    V6OF.UI = V6OF.UI || {};
    V6OF.UI.FootprintIntegration = {
      processFootprints: processFootprints,
      renderFootprintsToCanvas: renderFootprintsToCanvas,
      shouldShowFootprint: shouldShowFootprint,
      updateFootprintState: updateFootprintState,
      resetFootprints: resetFootprints,
      timeframeToMs: timeframeToMs
    };
  }

  V6OF.debugLog('[Footprint Integration] Initialized successfully');
})();
