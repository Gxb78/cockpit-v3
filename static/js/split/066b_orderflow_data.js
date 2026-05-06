// ---------- 066b_orderflow_data.js ----------
// Contrat data unique pour decoupler fetch/merge/rendu.

(function () {
  'use strict';

  var OF = window.OF = window.OF || {};

  function _coverageFromWindow(endMs, windowMs, partial) {
    return {
      start: endMs - windowMs,
      end: endMs,
      complete: !partial,
    };
  }

  function _sourceMeta(klinesMeta, aggTradesMeta) {
    var km = klinesMeta || {};
    var am = aggTradesMeta || {};
    return {
      klines: {
        cache: km.cache || null,
        stale: !!(km.cache && km.cache.stale),
        error: km.upstream_error || null,
      },
      aggTrades: {
        cache: am.cache || null,
        stale: !!(am.cache && am.cache.stale),
        error: am.upstream_error || null,
        count: am.count || (Array.isArray(am.trades) ? am.trades.length : 0),
        pagesUsed: am.limits && am.limits.pagesUsed ? am.limits.pagesUsed : 0,
      },
    };
  }

  OF.DataModel = {
    buildHybridState: function (params) {
      var end = params.requestedEnd || Date.now();
      return {
        symbol: params.symbol,
        interval: params.interval,
        intervalMs: params.intervalMs,
        requestedRange: { start: params.requestedStart, end: end },
        ohlcCandles: params.ohlcCandles || [],
        footprintMap: params.footprintMap || {},
        mergedCandles: params.mergedCandles || [],
        footprintCoverage: _coverageFromWindow(end, params.footprintWindowMs || 900000, !!params.partial),
        source: _sourceMeta(params.klinesMeta, params.aggTradesMeta),
      };
    },

    refreshLiveState: function (prevState, patch) {
      var state = prevState || {};
      var end = Date.now();
      var windowMs = patch.footprintWindowMs || (state.footprintCoverage ? (state.footprintCoverage.end - state.footprintCoverage.start) : 900000);
      return {
        symbol: state.symbol,
        interval: state.interval,
        intervalMs: state.intervalMs,
        requestedRange: state.requestedRange || { start: end - 7200000, end: end },
        ohlcCandles: patch.ohlcCandles || state.ohlcCandles || [],
        footprintMap: patch.footprintMap || state.footprintMap || {},
        mergedCandles: patch.mergedCandles || state.mergedCandles || [],
        footprintCoverage: _coverageFromWindow(end, windowMs, !!patch.partial),
        source: state.source || { klines: {}, aggTrades: {} },
      };
    },
  };
})();
