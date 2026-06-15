// ============ 094_v6_footprint_integration.js ============
// Footprint integration: tie together core, parser, renderer

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};
  var FootprintCore = V6OF.Core && V6OF.Core.FootprintCore;
  var FootprintParser = V6OF.Core && V6OF.Core.FootprintParser;
  var FootprintRenderer = V6OF.UI && V6OF.UI.FootprintRenderer;
  var MAX_RENDER_FAILURES = 3;
  var renderFailureCount = 0;
  var renderDisabled = false;
  var renderErrorLogged = false;

  function footprintDebugEnabled() {
    return !!(V6OF.debugFootprint || V6OF.DEBUG_FOOTPRINT);
  }

  function footprintDebugLog() {
    if (!footprintDebugEnabled() || !V6OF.debugLog) return;
    V6OF.debugLog.apply(V6OF, arguments);
  }

  function footprintDebugError() {
    if (!footprintDebugEnabled() || !console || !console.error) return;
    console.error.apply(console, arguments);
  }

  if (!FootprintCore || !FootprintParser || !FootprintRenderer) {
    footprintDebugError('[Footprint Integration] Missing dependencies (Core, Parser, Renderer)');
    return;
  }

  // ===== INTEGRATION ENGINE =====

  /**
   * Process raw server footprints into renderable format
   * @param {Array} rawFootprints - Raw data from server
   * @param {string} timeframe - Target timeframe ('1m', '5m', etc)
   * @param {number} maxCandles - Max candles to keep
   * @param {number} tickSize - Price tick used to merge near-identical levels
   * @returns {Array<FootprintCandle>} - Ready-to-render candles
   */
  function processFootprints(rawFootprints, timeframe, maxCandles, tickSize) {
    if (!Array.isArray(rawFootprints)) return [];

    // Parse raw data
    var parsed = FootprintParser.parseFootprintCandles(rawFootprints);
    if (!parsed.length) return [];

    // If not 1m, aggregate to target timeframe
    if (timeframe && timeframe !== '1m') {
      var aggregated = aggregateByTimeframe(parsed, timeframe, tickSize);
      return aggregated.slice(-(maxCandles || 100));
    }

    // Return most recent N candles
    return parsed.slice(-(maxCandles || 100));
  }

  /**
   * Aggregate 1m candles to target timeframe
   * Naive approach: group by timeframe bucket and aggregate
   */
  function aggregateByTimeframe(oneMinCandles, tf, tickSize) {
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
        return FootprintParser.aggregateFootprints(buckets[bucketTime], tf, tickSize);
      })
      .filter(function(candle) { return candle !== null; });
  }

  /**
   * Convert timeframe string ('1m', '2h', '1d', '1w', '1M') to milliseconds.
   * Keep this aligned with the chart timeframe parser.
   */
  function timeframeToMs(tf) {
    if (!tf) return 0;
    var match = String(tf).match(/^(\d+)([mhdwM])$/);
    if (!match) return 0;
    var val = parseInt(match[1], 10);
    var unit = match[2];
    if (unit === 'm') return val * 60000;
    if (unit === 'h') return val * 3600000;
    if (unit === 'd') return val * 86400000;
    if (unit === 'w') return val * 604800000;
    if (unit === 'M') return val * 2592000000; // ~30d
    return 0;
  }

  /**
   * Main integration: render footprints to canvas
   * Call this from canvas chart renderer
   * DEFENSIVE: multiple validation gates prevent crashes and DOM artifacts
   */
  function renderFootprintsToCanvas(ctx, vp, plot, state, settings) {
    if (renderDisabled) return false;

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

    // Gate 4: Footprints are already validated at ingestion (parseFootprintCandles
    // and aggregateFootprints both call isValidFootprint). Only filter nulls here.
    var validCandles = [];
    for (var i = 0; i < candles.length; i++) {
      if (candles[i]) validCandles.push(candles[i]);
    }

    if (!validCandles.length) return false;

    // Gate 5: Settings validation
    var options = {
      showPOC: settings && settings.showFootprintPOC !== false,
      showVA: settings && settings.showFootprintVA !== false,
      showImbalances: settings && settings.showFootprintImbalances !== false,
      showDelta: settings && settings.showFootprintDelta !== false,
      tickSize: settings && settings.tickSize
    };

    // Gate 6: Safe rendering with error handling
    try {
      FootprintRenderer.renderFootprints(ctx, vp, plot, validCandles, options);
      renderFailureCount = 0;
      renderErrorLogged = false;
      return true;
    } catch (e) {
      renderFailureCount += 1;
      if (!renderErrorLogged) {
        footprintDebugError('[Footprint Integration] Render error; disabling footprint after ' + MAX_RENDER_FAILURES + ' consecutive failures:', e);
        renderErrorLogged = true;
      }
      if (renderFailureCount >= MAX_RENDER_FAILURES) {
        renderDisabled = true;
        V6OF.footprintRenderDisabled = {
          disabled: true,
          failures: renderFailureCount,
          reason: 'render-error',
          updatedAt: Date.now()
        };
      }
      return false;
    }
  }

  /**
   * Determine if footprint should be visible based on zoom
   */
  function shouldShowFootprint(vp, settings) {
    if (renderDisabled) return false;
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
  function resetRenderCircuitBreaker() {
    renderFailureCount = 0;
    renderDisabled = false;
    renderErrorLogged = false;
    V6OF.footprintRenderDisabled = null;
  }

  function resetFootprints() {
    resetRenderCircuitBreaker();
    return [];
  }

  // ===== EXPORTS =====
  V6OF.register('UI', 'FootprintIntegration', {
    processFootprints: processFootprints,
    renderFootprintsToCanvas: renderFootprintsToCanvas,
    shouldShowFootprint: shouldShowFootprint,
    updateFootprintState: updateFootprintState,
    resetFootprints: resetFootprints,
    resetRenderCircuitBreaker: resetRenderCircuitBreaker,
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
      resetRenderCircuitBreaker: resetRenderCircuitBreaker,
      timeframeToMs: timeframeToMs
    };
  }

  footprintDebugLog('[Footprint Integration] Initialized successfully');
})();
