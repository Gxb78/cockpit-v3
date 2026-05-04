// ---------- Chart View Core — cadrage X+Y canonique ----------
// Module partagé entre 060 (widget BTC) et 062 (chart page).
// Garantit un comportement identique : même calcul de range prix,
// même verrouillage Y, même guards programmatic range.
//
// Configs :
//   WIDGET_VIEW — widget dashboard, follow agressif, compact
//   CHART_VIEW  — page chart classique, plus libre, plus large
//
// Usage :
//   window.ChartViewCore.computePriceRange(candles, visibleBars)
//   window.ChartViewCore.setPriceRange(ps, range, manualPriceRangeRef)
//   window.ChartViewCore.applyBestView(chart, series, candles, config, withProgRangeFn)

(function () {

  // ── CONFIGS ────────────────────────────────────────────
  var WIDGET_VIEW = {
    visibleBars: { '1m':180,'3m':120,'5m':84,'15m':56,'30m':40,'1h':32,'2h':26,'4h':22,'6h':18,'8h':16,'12h':14,'1d':70 },
    futureBars:  { '1m':24,'3m':15,'5m':10,'15m':5,'30m':3,'1h':2,'2h':2,'4h':1,'6h':1,'8h':1,'12h':1,'1d':3 },
    padding: { top: 0.08, bottom: 0.08, minRangeRatio: 0.002 },
  };

  var CHART_VIEW = {
    visibleBars: { '1m':160,'3m':130,'5m':90,'15m':60,'30m':44,'1h':36,'2h':30,'4h':26,'6h':22,'8h':20,'12h':18,'1d':90 },
    futureBars:  { '1m':22,'3m':20,'5m':12,'15m':6,'30m':4,'1h':3,'2h':2,'4h':2,'6h':2,'8h':1,'12h':1,'1d':3 },
    padding: { top: 0.10, bottom: 0.08, minRangeRatio: 0.0025 },
  };

  // ── COMPUTE PRICE RANGE ───────────────────────────────
  // Calcule un range Y sur les N dernières bougies visibles
  function computePriceRange(candles, visibleBars, padding) {
    if (!candles || !candles.length) return null;
    padding = padding || { top: 0.22, bottom: 0.18, minRangeRatio: 0.002 };

    var slice = candles.slice(-visibleBars);
    var high = -Infinity, low = Infinity;

    for (var i = 0; i < slice.length; i++) {
      var c = slice[i];
      if (Number.isFinite(c.high)) high = Math.max(high, c.high);
      if (Number.isFinite(c.low)) low = Math.min(low, c.low);
    }
    if (!Number.isFinite(high) || !Number.isFinite(low)) return null;

    var rawRange = Math.max(high - low, high * padding.minRangeRatio);
    return { from: low - rawRange * padding.bottom, to: high + rawRange * padding.top };
  }

  // ── SET PRICE RANGE ────────────────────────────────────
  // Verrouille l'axe Y via l'API LWC v5 ou fallback v4
  function setPriceRange(priceScale, range, manualPriceRangeRef) {
    if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to <= range.from) return;

    if (manualPriceRangeRef && typeof manualPriceRangeRef === 'object') {
      manualPriceRangeRef.value = range;
    }

    if (typeof priceScale.setAutoScale === 'function' && typeof priceScale.setVisibleRange === 'function') {
      try { priceScale.setAutoScale(false); priceScale.setVisibleRange(range); } catch(e) {}
      return;
    }
    // Fallback v4 : refresh autoscaleInfoProvider
    // (le provider utilise manualPriceRangeRef, donc setVisibleLogicalRange le force à réévaluer)
  }

  // ── APPLY BEST VIEW (X + Y) ────────────────────────────
  // Applique le cadrage X (visibleLogicalRange) ET Y (priceRange)
  // en une seule opération protégée par withProgrammaticRange
  function applyBestView(chart, series, candles, config, withProgRangeFn, manualPriceRangeRef) {
    if (!chart || !series || !candles || !candles.length) return;

    var tf = config.timeframe || '3m';
    var visibleBars = (config.visibleBars || {})[tf] || 120;
    var futureBars = (config.futureBars || {})[tf] || 14;
    var padding = config.padding || { top: 0.22, bottom: 0.18, minRangeRatio: 0.002 };

    var lastIndex = candles.length - 1;

    withProgRangeFn(function () {
      try { chart.timeScale().setVisibleLogicalRange({ from: lastIndex + futureBars - visibleBars, to: lastIndex + futureBars }); } catch(e) {}

      var priceRange = computePriceRange(candles, visibleBars, padding);
      var ps;
      try { ps = series.priceScale(); } catch(e) {}
      if (ps) setPriceRange(ps, priceRange, manualPriceRangeRef);
    });
  }

  // ── AUTOSCALE INFO PROVIDER FACTORY ────────────────────
  // À passer à addCandlestickSeries / addLineSeries
  function makeAutoscaleInfoProvider(manualPriceRangeRef) {
    return function (baseImpl) {
      if (!manualPriceRangeRef || !manualPriceRangeRef.value) return baseImpl ? baseImpl() : null;
      var r = manualPriceRangeRef.value;
      return {
        priceRange: { minValue: r.from, maxValue: r.to },
        margins: { above: 0.06, below: 0.10 },
      };
    };
  }

  // ── EXPOSE ─────────────────────────────────────────────
  window.ChartViewCore = {
    WIDGET_VIEW: WIDGET_VIEW,
    CHART_VIEW: CHART_VIEW,
    computePriceRange: computePriceRange,
    setPriceRange: setPriceRange,
    applyBestView: applyBestView,
    makeAutoscaleInfoProvider: makeAutoscaleInfoProvider,
  };

})();
