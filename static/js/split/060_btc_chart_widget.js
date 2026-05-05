// ---------- BTC Chart widget — TradingView Lightweight Charts ----------
// v3.0 — Premium widget: custom viewport, free pan, follow mode, state isolation

(function () {
  // ──────────────────────────────────────────────
  //  CONFIG
  // ──────────────────────────────────────────────
  var BTC_WIDGET_VIEW = {
    visibleBars: { '1m':180,'3m':120,'5m':84,'15m':56,'30m':40,'1h':32,'2h':26,'4h':22,'6h':18,'8h':16,'12h':14,'1d':70 },
    futureBars:  { '1m':24,'3m':15,'5m':10,'15m':5,'30m':3,'1h':2,'2h':2,'4h':1,'6h':1,'8h':1,'12h':1,'1d':3 },
    barSpacing:  { '1m':6,'3m':8,'5m':8,'15m':9,'30m':10,'1h':11,'2h':12,'4h':13,'6h':14,'8h':14,'12h':15,'1d':10 },
  };

  var VWAP_COLORS = { 'D-NY': '#f59e0b', '24H': '#eab308', '7D': '#06b6d4', '30D': '#a78bfa', '90D': '#f472b6' };
  var INTERVAL_MS = {
    '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000,
    '30m': 1800000, '1h': 3600000, '2h': 7200000, '4h': 14400000,
    '6h': 21600000, '8h': 28800000, '12h': 43200000,
    '1d': 86400000, '3d': 259200000, '1w': 604800000, '1M': 2592000000,
  };

  // ──────────────────────────────────────────────
  //  STATE (isolé, ne partage rien avec 062)
  // ──────────────────────────────────────────────
  var S = {
    chart: null,
    container: null,
    candleSeries: null,
    countdownPriceLine: null,
    vwapSeriesMap: {},
    indicatorSeries: {},
    rsiSeries: null,
    candles: [],
    timeframe: '3m',
    follow: true,
    userDetached: false,
    hovered: false,
    userDragging: false,
    userGestureActive: false,
    programmaticRangeDepth: 0,
    suppressRangeEventsUntil: 0,
    listenersBound: false,
    _gestureTimer: null,
    renderToken: 0,
    manualPriceRange: null,
    // VWAP
    activeVwapPeriods: [],
    // Timers
    countdownTimer: null,
    countdownAnchor: null,
    refreshTimer: null,
    lastCandleTime: 0,
    lastCountdownFetchAt: 0,
    lastLiveYAdjustAt: 0,
    // WS
    ws: null,
    wsGeneration: 0,
    wsClosing: false,
    wsReconnectTimer: null,
    wsReconnectAttempts: 0,
    wsConnected: false,
    wsError: false,
    lastWsConnectAt: 0,
    activeWsKey: null,
    // Flags
    chartReady: false,
    userIsInteracting: false,
    lastFetchTs: 0,
    FETCH_COOLDOWN_MS: 5000,
    firstFetchMs: 0,
    liveYSuppressUntil: 0,
    renderInFlight: false,
    // Resize
    resizeObserver: null,
  };

  // VWAP periods from localStorage
  try { S.activeVwapPeriods = (window.BtcVwap && window.BtcVwap.readActiveVwapPeriods) ? window.BtcVwap.readActiveVwapPeriods() : []; } catch(e) {}

  // Indicator settings from localStorage
  var indSettings = {
    sma: { active: false, period: 20, color: '#f59e0b' },
    ema: { active: false, period: 20, color: '#06b6d4' },
    boll: { active: false, period: 20, color: '#a78bfa' },
    rsi: { active: false, period: 14, color: '#f472b6' },
  };
  try { var saved = JSON.parse(localStorage.getItem('chartIndSettings')); if (saved) { Object.keys(saved).forEach(function (k) { if (indSettings[k]) Object.assign(indSettings[k], saved[k]); }); } } catch(e) {}

  // ──────────────────────────────────────────────
  //  HELPERS
  // ──────────────────────────────────────────────
  function _getIntervalMs(interval) {
    var m = INTERVAL_MS[interval];
    if (m) return m;
    var match = interval.match(/^(\d+)(m|h|d|w|M)$/);
    if (!match) return 3600000;
    var num = parseInt(match[1], 10);
    var unit = match[2];
    var mult = { m: 60000, h: 3600000, d: 86400000, w: 604800000, M: 2592000000 };
    return num * (mult[unit] || 3600000);
  }

  function _normalizeCandles(rows) {
    return (rows || []).map(function (c) { return {
      time: Number(c.time), open: Number(c.open), high: Number(c.high),
      low: Number(c.low), close: Number(c.close), volume: Number(c.volume),
    }; }).filter(function (c) { return Number.isFinite(c.time) && Number.isFinite(c.open) && Number.isFinite(c.close); });
  }

  function _waitFrame() {
    return new Promise(function (resolve) { requestAnimationFrame(resolve); });
  }

  // ──────────────────────────────────────────────
  //  COMPAT LWC v4/v5
  // ──────────────────────────────────────────────
  function _addCandleSeries(api, opts) {
    if (typeof api.addSeries === 'function') return api.addSeries(window.LightweightCharts.CandlestickSeries, opts);
    return api.addCandlestickSeries(opts);
  }
  function _addLineSeries(api, opts) {
    if (typeof api.addSeries === 'function') return api.addSeries(window.LightweightCharts.LineSeries, opts);
    return api.addLineSeries(opts);
  }

  // ──────────────────────────────────────────────
  //  INDICATORS (idem 062)
  // ──────────────────────────────────────────────
  function _calcSMA(candles, period) {
    var result = [], sum = 0;
    for (var i = 0; i < candles.length; i++) {
      sum += candles[i].close;
      if (i >= period) sum -= candles[i - period].close;
      if (i >= period - 1) result.push({ time: candles[i].time, value: sum / period });
    }
    return result;
  }
  function _calcEMA(candles, period) {
    var result = [];
    var k = 2 / (period + 1);
    var ema = 0;
    for (var w = 0; w < period; w++) ema += candles[w].close;
    ema /= period;
    for (var i = 0; i < candles.length; i++) {
      ema = (candles[i].close - ema) * k + ema;
      if (i >= period - 1) result.push({ time: candles[i].time, value: ema });
    }
    return result;
  }
  function _calcBollinger(candles, period) {
    var smaData = _calcSMA(candles, period);
    var result = [];
    for (var i = 0; i < smaData.length; i++) {
      var idx = i + period - 1, sumSq = 0;
      for (var j = 0; j < period; j++) { var diff = candles[idx - j].close - smaData[i].value; sumSq += diff * diff; }
      var std = Math.sqrt(sumSq / period);
      result.push({ time: smaData[i].time, middle: smaData[i].value, upper: smaData[i].value + 2 * std, lower: smaData[i].value - 2 * std });
    }
    return result;
  }
  function _calcRSI(candles, period) {
    if (candles.length < period + 1) return [];
    var gains = [], losses = [];
    for (var i = 1; i < candles.length; i++) { var diff = candles[i].close - candles[i - 1].close; gains.push(diff > 0 ? diff : 0); losses.push(diff < 0 ? -diff : 0); }
    var avgGain = 0, avgLoss = 0;
    for (var j = 0; j < period; j++) { avgGain += gains[j]; avgLoss += losses[j]; }
    avgGain /= period; avgLoss /= period;
    var result = [];
    var rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push({ time: candles[period].time, value: 100 - (100 / (1 + rs)) });
    for (var k = period; k < gains.length; k++) {
      avgGain = (avgGain * (period - 1) + gains[k]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[k]) / period;
      rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      result.push({ time: candles[k + 1].time, value: 100 - (100 / (1 + rs)) });
    }
    return result;
  }
  function _clearIndicators() {
    if (!S.chart) return;
    Object.keys(S.indicatorSeries).forEach(function (key) { try { S.chart.removeSeries(S.indicatorSeries[key]); } catch(e) {} });
    S.indicatorSeries = {};
    if (S.rsiSeries) { try { S.chart.removeSeries(S.rsiSeries); } catch(e) {} S.rsiSeries = null; }
  }
  function _renderIndicators(candles) {
    _clearIndicators();
    if (!S.chart || !candles || !candles.length) return;
    var s = indSettings;
    if (s.sma.active && candles.length >= s.sma.period) {
      var smaData = _calcSMA(candles, s.sma.period);
      S.indicatorSeries.sma = _addLineSeries(S.chart, { color: s.sma.color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, title: 'SMA ' + s.sma.period });
      S.indicatorSeries.sma.setData(smaData);
    }
    if (s.ema.active && candles.length >= s.ema.period) {
      var emaData = _calcEMA(candles, s.ema.period);
      S.indicatorSeries.ema = _addLineSeries(S.chart, { color: s.ema.color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, title: 'EMA ' + s.ema.period });
      S.indicatorSeries.ema.setData(emaData);
    }
    if (s.boll.active && candles.length >= s.boll.period) {
      var bollData = _calcBollinger(candles, s.boll.period);
      S.indicatorSeries.bollMid = _addLineSeries(S.chart, { color: s.boll.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, title: 'BB ' + s.boll.period });
      S.indicatorSeries.bollUpper = _addLineSeries(S.chart, { color: s.boll.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, lineStyle: 2 });
      S.indicatorSeries.bollLower = _addLineSeries(S.chart, { color: s.boll.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, lineStyle: 2 });
      S.indicatorSeries.bollMid.setData(bollData.map(function (d) { return { time: d.time, value: d.middle }; }));
      S.indicatorSeries.bollUpper.setData(bollData.map(function (d) { return { time: d.time, value: d.upper }; }));
      S.indicatorSeries.bollLower.setData(bollData.map(function (d) { return { time: d.time, value: d.lower }; }));
    }
    if (s.rsi.active && candles.length >= s.rsi.period + 1) {
      try {
        S.rsiSeries = _addLineSeries(S.chart, { color: s.rsi.color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceScaleId: 'rsi_pane', title: 'RSI ' + s.rsi.period });
        S.chart.priceScale('rsi_pane').applyOptions({ scaleMargins: { top: 0.7, bottom: 0 }, visible: true });
        S.rsiSeries.setData(_calcRSI(candles, s.rsi.period));
      } catch(e) { console.error('[btc-widget] RSI:', e); }
    }
  }

  // ──────────────────────────────────────────────
  //  VWAP
  // ──────────────────────────────────────────────
  function _removeVwapSeries(key) {
    var s = S.vwapSeriesMap[key];
    if (s) {
      try {
        var saved;
        try { saved = S.chart.timeScale().getVisibleRange(); } catch(e2) {}
        s.applyOptions({ visible: false, lastValueVisible: false });
        s.setData([]);
        if (saved) { try { S.chart.timeScale().setVisibleRange({ from: saved.from, to: saved.to }); } catch(e2) {} }
      } catch(e) {}
    }
  }

  // Délègue à BtcVwap (055) — cache global, source canonique, dedup
  async function _calcAndDrawVwap() {
    var token = S.renderToken;
    var tf = S.timeframe;
    try { S.activeVwapPeriods = (window.BtcVwap && window.BtcVwap.readActiveVwapPeriods) ? window.BtcVwap.readActiveVwapPeriods() : []; } catch(e) {}
    Object.keys(S.vwapSeriesMap).forEach(function (k) { if (S.activeVwapPeriods.indexOf(k) < 0) _removeVwapSeries(k); });
    if (!S.activeVwapPeriods.length) return;
    if (!window.BtcVwap) return;

    try {
      try { S.chart.applyOptions({ handleScroll: false, handleScale: false }); } catch(e) {}
      try { S.chart.timeScale().applyOptions({ shiftVisibleRangeOnNewBar: false }); } catch(e) {}

      var state = {
        symbol: 'BTCUSDT',
        candles: S.candles,
        vwapSeriesMap: S.vwapSeriesMap,
      };

      var vwapOrder = ['D-NY', '24H', '7D', '30D', '90D'];
      for (var vi = 0; vi < vwapOrder.length; vi++) {
        var p = vwapOrder[vi];
        if (S.activeVwapPeriods.indexOf(p) < 0) continue;
        if (token !== S.renderToken || tf !== S.timeframe) return;
        await window.BtcVwap.drawVwapForChart(state, p, function () {
          return token !== S.renderToken || tf !== S.timeframe;
        });
        if (token !== S.renderToken || tf !== S.timeframe) return;
        await _waitFrame();
      }
    } finally {
      try { S.chart.applyOptions({ handleScroll: true, handleScale: true }); } catch(e) {}
      try { S.chart.timeScale().applyOptions({ shiftVisibleRangeOnNewBar: true, rightBarStaysOnScroll: true }); } catch(e) {}
    }

    if (S.follow && !S.userDetached && !S.userDragging && token === S.renderToken && tf === S.timeframe) {
      [0, 50, 150, 400, 1000].forEach(function (delay) {
        setTimeout(function () {
          if (token !== S.renderToken || tf !== S.timeframe) return;
          if (!S.follow || S.userDetached || S.userDragging) return;
          _withProgrammaticRange(function () {
            var priceRange = computeBtcWidgetPriceRange(S.candles, S.timeframe);
            setBtcWidgetPriceRange(priceRange);
          });
        }, delay);
      });
    }
  }

  function _refreshWidgetVwapFromPrefs() {
    if (window.BtcVwap && window.BtcVwap.readActiveVwapPeriods) {
      S.activeVwapPeriods = window.BtcVwap.readActiveVwapPeriods();
    } else {
      try {
        var raw = JSON.parse(localStorage.getItem('chartVwapPeriods'));
        S.activeVwapPeriods = Array.isArray(raw) ? raw : [];
      } catch(e) {
        S.activeVwapPeriods = [];
      }
    }

    if (!S.chartReady || !S.candles || !S.candles.length) return;

    _calcAndDrawVwap().catch(function (e) {
      console.warn('[BTC-WIDGET] refresh VWAP failed', e);
    });
  }

  window.addEventListener('chart:vwap-periods-changed', function () {
    _refreshWidgetVwapFromPrefs();
  });

  window.addEventListener('storage', function (e) {
    if (e.key === 'chartVwapPeriods') {
      _refreshWidgetVwapFromPrefs();
    }
  });
  // ──────────────────────────────────────────────
  //  PRICE RANGE MANAGEMENT
  // ──────────────────────────────────────────────
  function computeBtcWidgetPriceRange(candles, tf) {
    if (!window.ChartViewCore) return null;
    var vb = BTC_WIDGET_VIEW.visibleBars[tf || S.timeframe] || 100;
    return window.ChartViewCore.computePriceRange(candles, vb, { top: 0.08, bottom: 0.08, minRangeRatio: 0.002 });
  }

  function getBtcWidgetCurrentPriceRange() {
    if (S.follow && S.manualPriceRange) return S.manualPriceRange;
    if (!S.candleSeries) return S.manualPriceRange;
    var ps = S.candleSeries.priceScale();
    if (typeof ps.getVisibleRange === 'function') {
      try { var r = ps.getVisibleRange(); if (r) return r; } catch(e) {}
    }
    return S.manualPriceRange;
  }

  function setBtcWidgetPriceRange(range) {
    if (!range || !Number.isFinite(range.from) || !Number.isFinite(range.to) || range.to <= range.from) return;
    S.manualPriceRange = range;
    var ps = S.candleSeries.priceScale();
    if (typeof ps.setVisibleRange === 'function' && typeof ps.setAutoScale === 'function') {
      try { ps.setAutoScale(false); ps.setVisibleRange(range); } catch(e) {}
      return;
    }
    // Fallback LWC 4.x: force via autoscaleInfoProvider + logical range reset
    var lr;
    try { lr = S.chart.timeScale().getVisibleLogicalRange(); } catch(e) {}
    if (lr) {
      try { S.chart.timeScale().setVisibleLogicalRange({ from: lr.from, to: lr.to }); } catch(e) {}
    }
  }

  function _applyLiveXRangeNoWrap() {
    var candles = S.candles;
    if (!candles || !candles.length) return;
    var tf = S.timeframe;
    var visibleBars = BTC_WIDGET_VIEW.visibleBars[tf] || 100;
    var futureBars = BTC_WIDGET_VIEW.futureBars[tf] || 14;
    var lastIndex = candles.length - 1;
    try { S.chart.timeScale().setVisibleLogicalRange({ from: lastIndex + futureBars - visibleBars, to: lastIndex + futureBars }); } catch(e) {}
  }

  function _withProgrammaticRange(fn) {
    S.programmaticRangeDepth++;
    S.suppressRangeEventsUntil = performance.now() + 250;
    try { fn(); } finally {
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          S.programmaticRangeDepth = Math.max(0, S.programmaticRangeDepth - 1);
          S.suppressRangeEventsUntil = performance.now() + 100;
        });
      });
    }
  }

  function applyBtcWidgetBestView() {
    if (!S.candles || !S.candles.length || !S.chart) return;
    _withProgrammaticRange(function () {
      _applyLiveXRangeNoWrap();
      var priceRange = computeBtcWidgetPriceRange(S.candles, S.timeframe);
      setBtcWidgetPriceRange(priceRange);
    });
    S.liveYSuppressUntil = performance.now() + 2500;
    _updateBtcWidgetLiveButton();
  }

  // ──────────────────────────────────────────────
  //  LIVE STATE MANAGEMENT
  // ──────────────────────────────────────────────
  function _detachFromLive(reason) {
    if (!S.follow && S.userDetached) return;
    S.follow = false;
    S.userDetached = true;
    console.log('[BTC WIDGET] detached:', reason);
    _updateBtcWidgetLiveButton();
  }

  function _returnToLive(reason) {
    S.follow = true;
    S.userDetached = false;
    S.userDragging = false;
    S.userGestureActive = false;
    console.log('[BTC WIDGET] return to live:', reason);
    _withProgrammaticRange(function () { applyBtcWidgetBestView(); });
    _updateBtcWidgetLiveButton();
  }

  function _resetLiveState() {
    S.follow = true;
    S.userDetached = false;
    S.hovered = false;
    S.userDragging = false;
    S.userGestureActive = false;
    S.programmaticRangeDepth = 0;
    S.suppressRangeEventsUntil = performance.now() + 500;
    _updateBtcWidgetLiveButton();
  }

  function _updateBtcWidgetLiveButton() {
    var btn = document.getElementById('btc-widget-live-btn');
    if (!btn) return;
    var show = S.hovered && S.userDetached && !S.follow;
    btn.classList.toggle('hidden', !show);
  }

  // ──────────────────────────────────────────────
  //  EVENT BINDINGS (one-shot)
  // ──────────────────────────────────────────────
  function _bindHover() {
    var el = S.container;
    el.addEventListener('mouseenter', function () { S.hovered = true; _updateBtcWidgetLiveButton(); });
    el.addEventListener('mouseleave', function () { S.hovered = false; _updateBtcWidgetLiveButton(); });
  }

  function _bindUserIntent() {
    var el = S.container;
    el.addEventListener('wheel', function () {
      S.userGestureActive = true;
      _detachFromLive('wheel');
      if (S._gestureTimer) clearTimeout(S._gestureTimer);
      S._gestureTimer = setTimeout(function () { S.userGestureActive = false; }, 200);
    }, { passive: true });
  }

  function _bindRangeWatcher() {
    try {
      S.chart.timeScale().subscribeVisibleLogicalRangeChange(function () {
        if (S.programmaticRangeDepth > 0) return;
        if (performance.now() < S.suppressRangeEventsUntil) return;
        if (!S.userGestureActive && !S.userDragging) return;
        _detachFromLive('range-user-change');
      });
    } catch(e) {}
  }

  function bindBtcWidgetFreePan() {
    var el = S.container;
    if (!el) return;
    var gesture = null;
    var DRAG_THRESHOLD = 5;

    function resetGesture() {
      if (gesture && gesture.pointerId != null) {
        try { if (el.hasPointerCapture && el.hasPointerCapture(gesture.pointerId)) el.releasePointerCapture(gesture.pointerId); } catch(e) {}
      }
      gesture = null;
      S.userDragging = false;
      S.userGestureActive = false;
      el.classList.remove('btc-widget-dragging');
      _updateBtcWidgetLiveButton();
    }

    el.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (e.target.closest('button, .tf-btn, .widget-btn, .btc-chart-interval, #btcChartCustom, #btc-widget-live-btn')) return;
      var logicalRange;
      try { logicalRange = S.chart.timeScale().getVisibleLogicalRange(); } catch(e) {}
      var priceRange = getBtcWidgetCurrentPriceRange();
      if (!logicalRange || !priceRange) return;
      gesture = {
        pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
        logicalRange: { from: logicalRange.from, to: logicalRange.to },
        priceRange: { from: priceRange.from, to: priceRange.to },
        dragging: false,
      };
    });

    window.addEventListener('pointermove', function (e) {
      if (!gesture || e.pointerId !== gesture.pointerId) return;
      var dx = e.clientX - gesture.startX;
      var dy = e.clientY - gesture.startY;
      var dist = Math.hypot(dx, dy);
      if (!gesture.dragging) {
        if (dist < DRAG_THRESHOLD) return;
        gesture.dragging = true;
        S.userDragging = true;
        S.userGestureActive = true;
        _detachFromLive('drag');
        try { el.setPointerCapture(gesture.pointerId); } catch(e) {}
        el.classList.add('btc-widget-dragging');
      }
      e.preventDefault();
      var rect = el.getBoundingClientRect();
      var plotW = Math.max(1, rect.width - 70);
      var plotH = Math.max(1, rect.height - 30);
      var logicalW = gesture.logicalRange.to - gesture.logicalRange.from;
      var priceH = gesture.priceRange.to - gesture.priceRange.from;
      var barsPerPx = logicalW / plotW;
      var pricePerPx = priceH / plotH;
      _withProgrammaticRange(function () {
        try { S.chart.timeScale().setVisibleLogicalRange({ from: gesture.logicalRange.from + (-dx * barsPerPx), to: gesture.logicalRange.to + (-dx * barsPerPx) }); } catch(e) {}
        setBtcWidgetPriceRange({ from: gesture.priceRange.from + (dy * pricePerPx), to: gesture.priceRange.to + (dy * pricePerPx) });
      });
    }, { passive: false });

    window.addEventListener('pointerup', resetGesture);
    window.addEventListener('pointercancel', resetGesture);
    window.addEventListener('blur', resetGesture);
    el.addEventListener('lostpointercapture', resetGesture);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') resetGesture(); });

    el.addEventListener('dblclick', function () {
      resetGesture();
      _returnToLive('dblclick');
    });
  }

  function _bindListenersOnce() {
    if (S.listenersBound) return;
    S.listenersBound = true;
    _bindHover();
    _bindUserIntent();
    bindBtcWidgetFreePan();
    _bindRangeWatcher();
    var btn = document.getElementById('btc-widget-live-btn');
    if (btn) {
      btn.addEventListener('click', function (e) { e.stopPropagation(); _returnToLive('button'); });
    }
  }

  // ──────────────────────────────────────────────
  //  TIMER & COUNTDOWN
  // ──────────────────────────────────────────────
  function _getLiveYZone(tf) {
    if (tf === '1m') return { low: 0.18, high: 0.82 };
    if (tf === '3m') return { low: 0.18, high: 0.82 };
    if (tf === '5m') return { low: 0.20, high: 0.80 };
    return { low: 0.24, high: 0.76 };
  }

  function maybeFollowBtcWidgetPriceY(force) {
    if (S.userGestureActive) return;
    if (!force && !S.follow) return;
    if (!force && S.userDragging) return;
    if (!force && performance.now() < (S.liveYSuppressUntil || 0)) return;
    var candles = S.candles;
    if (!candles || !candles.length) return;
    var last = candles[candles.length - 1];
    if (!last) return;

    var now = performance.now();

    var currentRange = getBtcWidgetCurrentPriceRange();
    if (!currentRange) {
      S.lastLiveYAdjustAt = now;
      _withProgrammaticRange(function () { setBtcWidgetPriceRange(computeBtcWidgetPriceRange(candles, S.timeframe)); });
      return;
    }

    var height = currentRange.to - currentRange.from;
    if (!Number.isFinite(height) || height <= 0) return;

    var buffer = height * 0.035;

    // Ne bouge que si la bougie live sort du cadre (avec marge)
    var breaksTop = Number.isFinite(last.high) && last.high > currentRange.to - buffer;
    var breaksBottom = Number.isFinite(last.low) && last.low < currentRange.from + buffer;

    if (!force && !breaksTop && !breaksBottom) return;

    // Throttle lent : pas à chaque tick WS
    if (!force && now - (S.lastLiveYAdjustAt || 0) < 1000) return;

    var desiredRange = computeBtcWidgetPriceRange(candles, S.timeframe);
    if (!desiredRange) return;

    S.lastLiveYAdjustAt = now;
    _withProgrammaticRange(function () { setBtcWidgetPriceRange(desiredRange); });
  }

  // ── COUNTDOWN ANCHOR (basé sur candleCloseMs + performance.now()) ──

  function _toMs(t) {
    if (t == null) return NaN;
    var n = Number(t);
    if (!Number.isFinite(n)) return NaN;
    return n > 1e12 ? n : n * 1000;
  }

  function _getCandleCloseMs(candle, intervalMs) {
    if (candle.closeTime != null) return _toMs(candle.closeTime);
    if (candle.T != null) return _toMs(candle.T);
    if (candle.time != null) return _toMs(candle.time) + intervalMs;
    return NaN;
  }

  function _updateCountdownAnchor(candle, source, nowMsOverride) {
    if (!candle) return;
    var intervalMs = _getIntervalMs(S.timeframe);
    if (!intervalMs) return;
    var openMs = _toMs(candle.time != null ? (candle.openTime != null ? candle.openTime : candle.time) : (candle.t != null ? candle.t : 0));
    var closeMs = _getCandleCloseMs(candle, intervalMs);
    if (!Number.isFinite(openMs) || !Number.isFinite(closeMs)) return;

    var overrideNow = Number(nowMsOverride);
    var hasOverrideNow = Number.isFinite(overrideNow);

    var clockSynced = hasOverrideNow ||
      (window.BtcMarketClock && window.BtcMarketClock.isSynced && window.BtcMarketClock.isSynced());

    var marketNow = hasOverrideNow
      ? overrideNow
      : (window.BtcMarketClock ? window.BtcMarketClock.now() : Date.now());

    // Pas de reject si clock pas sync et source pas WS — on attend la sync
    if (!clockSynced && source !== 'ws') return;

    var remaining = closeMs - marketNow;
    if (remaining < -intervalMs) {
      console.warn('[COUNTDOWN] stale candle anchor, forcing latest fetch', { source, tf: S.timeframe, openMs, closeMs, marketNow, remaining });
      S.countdownAnchor = {
        candleOpenMs: openMs,
        candleCloseMs: closeMs,
        remainingAtAnchorMs: 0,
        perfAtAnchor: performance.now(),
        source: 'stale-' + (source || 'unknown'),
      };
      if (Date.now() - (S.lastCountdownFetchAt || 0) > 5000) {
        S.lastCountdownFetchAt = Date.now();
        _fetchLatestCandleOnly();
      }
      return;
    }
    if (remaining > intervalMs * 2) {
      console.warn('[COUNTDOWN] future candle anchor rejected', { source, tf: S.timeframe, openMs, closeMs, marketNow, remaining });
      return;
    }
    remaining = Math.max(0, Math.min(remaining, intervalMs));
    S.countdownAnchor = {
      candleOpenMs: openMs,
      candleCloseMs: closeMs,
      remainingAtAnchorMs: remaining,
      perfAtAnchor: performance.now(),
      source: source || 'unknown',
    };
  }

  function _formatCountdown(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '0:00';
    var totalSec = Math.ceil(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    if (h > 0) return h + ':' + pad(m) + ':' + pad(s);
    return m + ':' + pad(s);
  }

  function _startCountdown() {
    if (S.countdownTimer) clearInterval(S.countdownTimer);
    S.countdownTimer = setInterval(function () {
      if (!S.countdownPriceLine) { _updateCountdownLabel('—'); return; }
      var anchor = S.countdownAnchor;
      if (!anchor) {
        var intervalMs = _getIntervalMs(S.timeframe);
        var nowMs = window.BtcMarketClock ? window.BtcMarketClock.now() : Date.now();
        var estimated = intervalMs ? intervalMs - (nowMs % intervalMs) : 0;
        _updateCountdownLabel(estimated > 0 ? _formatCountdown(estimated) : '—');

        if (S.renderInFlight) return;

        var clockReady = window.BtcMarketClock && window.BtcMarketClock.isSynced && window.BtcMarketClock.isSynced();
        if (S.chartReady && clockReady && !S.wsConnected && Date.now() - (S.lastCountdownFetchAt || 0) > 5000) {
          S.lastCountdownFetchAt = Date.now();
          _fetchLatestCandleOnly();
        }
        return;
      }
      var elapsed = performance.now() - anchor.perfAtAnchor;
      var remaining = anchor.remainingAtAnchorMs - elapsed;
      if (remaining <= 0) {
        _updateCountdownLabel('0:00');
        if (!S.wsConnected && Date.now() - (S.lastCountdownFetchAt || 0) > 10000) {
          S.lastCountdownFetchAt = Date.now();
          _fetchLatestCandleOnly();
        }
        return;
      }
      _updateCountdownLabel(_formatCountdown(remaining));
    }, 250);
  }

  function _updateCountdownLabel(txt) {
    if (!S.countdownPriceLine || !S.chart) return;
    try { S.countdownPriceLine.applyOptions({ title: txt === undefined ? '—' : txt }); } catch(e) {}
  }

  function _startAutoRefresh() {
    if (S.refreshTimer) clearInterval(S.refreshTimer);
    var ms = _getIntervalMs(S.timeframe);
    var interval = Math.min(60000, Math.max(15000, Math.floor(ms / 4)));
    S.refreshTimer = setInterval(function () {
      if (!S.chartReady) return;
      if (S.renderInFlight) return;
      if (!S.countdownAnchor) return;
      // Si WS fonctionne, pas besoin de REST refresh
      if (S.wsConnected && !S.wsError) return;
      // Fallback REST seulement proche de la cloture
      var elapsed = performance.now() - S.countdownAnchor.perfAtAnchor;
      if (elapsed < S.countdownAnchor.remainingAtAnchorMs + 1500) return;
      _fetchLatestCandleOnly();
    }, interval);
  }

  // REST fallback léger — update la dernière bougie, pas de full render
  function _fetchLatestCandleOnly() {
    if (S.renderInFlight) return Promise.resolve();
    var token = S.renderToken;
    var tf = S.timeframe;
    return fetch('/api/market/klines?symbol=BTCUSDT&interval=' + tf + '&limit=3')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        if (token !== S.renderToken) return;
        if (tf !== S.timeframe) return;

        if (data.serverTime != null && window.BtcMarketClock && Number.isFinite(Number(data.serverTime))) {
          window.BtcMarketClock.sync(Number(data.serverTime), 'klines-latest');
        }

        var raw = data.candles || [];
        if (!raw.length) return;
        var candles = _normalizeCandles(raw);
        var latest = candles[candles.length - 1];
        if (!latest || !latest.time) return;
        var last = S.candles && S.candles.length > 0 ? S.candles[S.candles.length - 1] : null;
        if (last && latest.time === last.time) {
          // Même bougie — update
          S.candles[S.candles.length - 1] = latest;
        } else if (latest.time > (last ? last.time : 0)) {
          // Nouvelle bougie — push
          S.candles.push(latest);
          if (S.candles.length > 300) S.candles = S.candles.slice(-300);
        }
        S.lastCandleTime = latest.time * 1000;
        _updateCountdownAnchor(latest, 'rest-fallback');
        S.candleSeries.update(latest);
        if (S.follow && !S.userDragging) {
          _withProgrammaticRange(function () { maybeFollowBtcWidgetPriceY(); });
        }
      })
      .catch(function (e) {
        console.warn('[BTC-WIDGET] REST fallback failed', e);
      });
  }

  // ──────────────────────────────────────────────
  //  WS — Architecture générationnelle
  //  Un seul propriétaire du cycle data.
  //  Seul init/user/timeframe reset le WS.
  // ──────────────────────────────────────────────

  function _getWsKey() {
    return 'BTCUSDT:' + (S.timeframe || '3m');
  }

  function _normalizeTfForBinance(tf) {
    var map = {
      '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
      '1h': '1h', '2h': '2h', '4h': '4h', '6h': '6h', '8h': '8h', '12h': '12h',
      '1d': '1d', '3d': '3d', '1w': '1w', '1M': '1M',
      '1H': '1h', '2H': '2h', '4H': '4h', '6H': '6h', '8H': '8h', '12H': '12h',
      '1D': '1d', '3D': '3d', '1W': '1w',
    };
    return map[tf] || String(tf || '3m').toLowerCase();
  }

  function _disconnectWs(reason) {
    S.wsGeneration++;
    if (S.wsReconnectTimer) { clearTimeout(S.wsReconnectTimer); S.wsReconnectTimer = null; }
    S.wsConnected = false;
    S.wsClosing = true;
    var ws = S.ws;
    S.ws = null;
    S.activeWsKey = null;
    if (ws) {
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, reason || 'intentional');
        }
      } catch(e) { console.warn('[BTC-WIDGET][WS] close error', e); }
    }
    setTimeout(function () { S.wsClosing = false; }, 500);
  }

  function _connectWs(reason, opts) {
    opts = opts || {};
    var force = !!opts.force;
    var wsKey = _getWsKey();
    var now = Date.now();

    // Déjà connecté au bon flux ?
    if (S.ws && S.activeWsKey === wsKey) {
      var alive = S.ws.readyState === WebSocket.OPEN || S.ws.readyState === WebSocket.CONNECTING;
      if (alive) return;
    }

    // Throttle 10s — sauf si force (timeframe/user)
    if (!force && now - S.lastWsConnectAt < 10000) { return; }
    S.lastWsConnectAt = now;

    S.wsGeneration++;
    var generation = S.wsGeneration;

    if (S.wsReconnectTimer) { clearTimeout(S.wsReconnectTimer); S.wsReconnectTimer = null; }

    var symbol = 'btcusdt';
    var interval = _normalizeTfForBinance(S.timeframe || '3m');
    var url = 'wss://stream.binance.com:9443/ws/' + symbol + '@kline_' + interval;

    S.wsClosing = false;
    S.wsError = false;
    S.wsConnected = false;
    S.activeWsKey = wsKey;

    var ws = new WebSocket(url);
    S.ws = ws;

    ws.onopen = function () {
      if (generation !== S.wsGeneration || ws !== S.ws) return;
      S.wsConnected = true;
      S.wsError = false;
      S.wsReconnectAttempts = 0;
      _hideWsError();
    };

    ws.onmessage = function (event) {
      if (generation !== S.wsGeneration || ws !== S.ws) return;
      try { _handleWsMessage(event.data); } catch(e) { console.warn('[BTC-WIDGET][WS] msg', e); }
    };

    ws.onerror = function () {
      if (generation !== S.wsGeneration || ws !== S.ws) return;
      S.wsError = true;
      _showWsError();
    };

    ws.onclose = function (event) {
      if (generation !== S.wsGeneration || ws !== S.ws) return;
      S.wsConnected = false;
      var intentional = S.wsClosing || event.code === 1000 || event.code === 1001;
      if (intentional) return;
      S.wsError = true;
      _scheduleWsReconnect('unexpected-close');
      _showWsError();
    };
  }

  function _scheduleWsReconnect(reason) {
    if (S.wsReconnectTimer) return;
    S.wsReconnectAttempts = Math.min((S.wsReconnectAttempts || 0) + 1, 6);
    var delay = Math.min(60000, 2000 * Math.pow(2, S.wsReconnectAttempts - 1));
    S.wsReconnectTimer = setTimeout(function () {
      S.wsReconnectTimer = null;
      _connectWs('reconnect:' + reason);
    }, delay);
  }

  function _upsertLiveCandle(candle) {
    if (!candle || !Number.isFinite(candle.time)) return;
    if (!Array.isArray(S.candles)) S.candles = [];
    var last = S.candles[S.candles.length - 1];
    if (last && last.time === candle.time) {
      Object.assign(last, candle);
    } else {
      S.candles.push(candle);
      if (S.candles.length > 300) S.candles = S.candles.slice(-300);
    }
  }

  function _handleWsMessage(raw) {
    var d = JSON.parse(raw), k = d && d.k;
    if (!k) return;
    var candle = { time: Math.floor(k.t / 1000), openTime: k.t, closeTime: k.T, open: parseFloat(k.o), high: parseFloat(k.h), low: parseFloat(k.l), close: parseFloat(k.c), volume: parseFloat(k.v) };
    _upsertLiveCandle(candle);
    var priceEl = document.getElementById('btcChartPrice');
    if (priceEl) priceEl.textContent = '$' + candle.close.toLocaleString('fr-FR', { minimumFractionDigits: 2 });
    S.lastCandleTime = k.t;

    var eventMs = Number(d.E);
    if (window.BtcMarketClock && Number.isFinite(eventMs)) {
      window.BtcMarketClock.sync(eventMs, 'ws-event');
    }
    _updateCountdownAnchor(candle, 'ws', Number.isFinite(eventMs) ? eventMs : undefined);
    if (S.candleSeries) { try { S.candleSeries.update(candle); } catch(e) {} }
    if (S.countdownPriceLine) { try { S.countdownPriceLine.applyOptions({ price: candle.close }); } catch(e) {} }
    _withProgrammaticRange(function () { maybeFollowBtcWidgetPriceY(); });
  }

  function _showWsError() { var el = document.getElementById('btcChartWsStatus'); if (el) el.className = 'btc-chart-ws-error visible'; }
  function _hideWsError() { var el = document.getElementById('btcChartWsStatus'); if (el) el.className = 'btc-chart-ws-error'; }

  // ──────────────────────────────────────────────
  //  CHART CREATION
  // ──────────────────────────────────────────────
  function createBtcWidgetChart(container) {
    if (S.chartReady) return;
    S.chartReady = true;
    S.container = container;
    if (!container || !container.parentElement) return;
    var isLight = document.body.classList.contains('light-mode');
    var tf = S.timeframe;
    S.chart = window.LightweightCharts.createChart(container, {
      autoSize: true,
      layout: { background: { type: 'solid', color: 'transparent' }, textColor: isLight ? '#1e293b' : '#d1d5db' },
      grid: { vertLines: { color: 'transparent' }, horzLines: { color: 'transparent' } },
      crosshair: { mode: 0 },
      rightPriceScale: { visible: true, autoScale: true, borderVisible: false, scaleMargins: { top: 0.04, bottom: 0.05 } },
      timeScale: {
        rightOffset: BTC_WIDGET_VIEW.futureBars[tf] || 14,
        barSpacing: BTC_WIDGET_VIEW.barSpacing[tf] || 9,
        minBarSpacing: 3,
        fixLeftEdge: false, fixRightEdge: false,
        lockVisibleTimeRangeOnResize: true,
        rightBarStaysOnScroll: false,
        timeVisible: true, secondsVisible: false, borderVisible: false,
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: false, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      kineticScroll: { mouse: false, touch: false },
    });

    // Candle series
    S.candleSeries = _addCandleSeries(S.chart, {
      priceScaleId: 'right',
      upColor: '#22c55e', downColor: '#ef4444',
      borderVisible: false, wickUpColor: '#22c55e', wickDownColor: '#ef4444',
      lastValueVisible: false, priceLineVisible: false,
      autoscaleInfoProvider: window.ChartViewCore
        ? window.ChartViewCore.makeAutoscaleInfoProvider({ get value() { return S.manualPriceRange; }, set value(v) { S.manualPriceRange = v; } })
        : undefined,
    });

    // Countdown price line
    S.countdownPriceLine = S.candleSeries.createPriceLine({ price: 0, color: '#22c55e', lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: '—' });

    // VWAP series
    Object.keys(VWAP_COLORS).forEach(function (p) {
      S.vwapSeriesMap[p] = _addLineSeries(S.chart, {
        color: VWAP_COLORS[p], lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false, title: 'VWAP ' + p, visible: true,
        autoscaleInfoProvider: function () { return null; },
      });
      S.vwapSeriesMap[p].setData([]);
    });

    // Resize observer
    if (S.resizeObserver) S.resizeObserver.disconnect();
    S.resizeObserver = new ResizeObserver(function () {
      if (S.chart && container) {
        var cw = container.clientWidth, ch = Math.max(240, container.clientHeight || 360);
        if (cw > 0 && ch > 0) S.chart.applyOptions({ width: cw, height: ch });
      }
    });
    S.resizeObserver.observe(container);

    // Event bindings (one-shot)
    _bindListenersOnce();

    // Interval buttons
    document.querySelectorAll('.btc-chart-interval').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.btc-chart-interval').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        S.timeframe = btn.dataset.interval;
        S.countdownAnchor = null;
        _updateCountdownLabel('—');
        _startCountdown();
        _disconnectWs('timeframe');
        var ci = document.getElementById('btcChartCustom');
        if (ci) ci.value = '';
        _fetchAndRender(false, 'user');
      });
    });

    // Custom interval
    var customInput = document.getElementById('btcChartCustom');
    if (customInput) {
      customInput.addEventListener('change', function () {
        var val = this.value.trim().toLowerCase();
        if (!/^\d+(m|h|d|w|M)$/.test(val)) { this.classList.add('jedit-field-error'); this.title = 'Format: chiffre + m/h/d/w/M'; return; }
        this.classList.remove('jedit-field-error'); this.title = '';
        document.querySelectorAll('.btc-chart-interval').forEach(function (b) { b.classList.remove('active'); });
        S.timeframe = val;
        S.countdownAnchor = null;
        _updateCountdownLabel('—');
        _startCountdown();
        _disconnectWs('timeframe');
        _fetchAndRender(false, 'user');
      });
      customInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') this.blur(); });
    }
  }

  // ──────────────────────────────────────────────
  //  FETCH & RENDER
  // ──────────────────────────────────────────────
  function _clearAllSeries() {
    if (S.candleSeries) S.candleSeries.setData([]);
    Object.keys(S.vwapSeriesMap).forEach(function (k) { if (S.vwapSeriesMap[k]) S.vwapSeriesMap[k].setData([]); });
  }

  async function _fetchWidgetCandles(tf) {
    var url = '/api/market/klines?symbol=BTCUSDT&interval=' + tf + '&limit=300';
    var r = await fetch(url);

    if (!r.ok) throw new Error('HTTP ' + r.status);

    var data = await r.json();
    var candles = _normalizeCandles(data.candles || []);

    if (!candles.length) throw new Error('empty candles');

    if (data.serverTime != null && window.BtcMarketClock && Number.isFinite(Number(data.serverTime))) {
      window.BtcMarketClock.sync(Number(data.serverTime), 'klines-fetch');
    }

    return candles;
  }

  async function _fetchAndRender(keepZoom, _source) {
    if (!S.candleSeries) return;
    var token = ++S.renderToken;
    S.renderInFlight = true;
    console.log('[BTC-WIDGET] render start token=', token, 'tf=', S.timeframe, 'source=', _source);

    // Reset live state au chargement (follow ON)
    if (!keepZoom) _resetLiveState();

    // Debounce auto-refresh
    if (_source !== 'user') {
      var now = Date.now();
      if (S.lastFetchTs && (now - S.lastFetchTs) < S.FETCH_COOLDOWN_MS) { S.renderInFlight = (token === S.renderToken) ? false : S.renderInFlight; return; }
      S.lastFetchTs = now;
    }
    if (!S.firstFetchMs) S.firstFetchMs = Date.now();

    // WS reset : UNIQUEMENT sur init/user/timeframe
    var shouldResetWs = _source === 'init' || _source === 'user' || _source === 'timeframe';
    if (shouldResetWs) _disconnectWs('render:' + _source);

    // Cache sessionStorage : affiche les dernieres bougies immediatement
    if (keepZoom === false) {
      try {
        var cachedRaw = sessionStorage.getItem('btcWidgetCandles:' + S.timeframe);
        if (cachedRaw) {
          var cachedCandles = _normalizeCandles(JSON.parse(cachedRaw));
          if (cachedCandles && cachedCandles.length >= 2) {
            S.candleSeries.setData(cachedCandles);
            S.candles = cachedCandles;
            requestAnimationFrame(function () {
              if (token !== S.renderToken) return;
              _withProgrammaticRange(function () { applyBtcWidgetBestView(); });
            });
          }
        }
      } catch(e) {}
    }

    try {
      var candles = await _fetchWidgetCandles(S.timeframe);

      if (token !== S.renderToken) { console.warn('[BTC-WIDGET] stale candles ignored'); return; }

      var last = candles[candles.length - 1];
      var candleTimeMs = last.time * 1000;
      S.lastCandleTime = candleTimeMs;
      _updateCountdownAnchor(last, 'fetch');
      S.candles = candles;

      // Cache en sessionStorage pour prochain reload
      try { if (candles && candles.length >= 2) { sessionStorage.setItem('btcWidgetCandles:' + S.timeframe, JSON.stringify(candles)); } } catch(e) {}

      _startCountdown();
      _startAutoRefresh();

      var priceEl = document.getElementById('btcChartPrice');
      if (priceEl) priceEl.textContent = '$' + Number(last.close).toLocaleString('fr-FR', { minimumFractionDigits: 2 });

      // DEBUG 060: attraper Value is null
      try { S.candleSeries.setData(candles); } catch (e) { console.error('[DEBUG 060 setData] Value is null!', e.message, 'len:', candles.length, 'first3:', JSON.stringify(candles.slice(0,3))); var ok = candles.filter(function(c) { return c && c.time && c.open != null && c.high != null && c.low != null && c.close != null; }); if (ok.length) S.candleSeries.setData(ok); candles = ok; }
      _renderIndicators(candles);

      // VWAP — seulement sur init/user/timeframe (pas sur auto)
      if (S.activeVwapPeriods.length > 0 && shouldResetWs) {
        _calcAndDrawVwap().finally(function () {});
      }

      // WS : connecter APRES setData
      if (shouldResetWs) {
        setTimeout(function () {
          if (token !== S.renderToken) return;
          _connectWs('after-render:' + _source, { force: true });
        }, 250);
      }

      // Best view (range horizontal + vertical)
      if (S.follow || !keepZoom) {
        requestAnimationFrame(function () {
          if (token !== S.renderToken) return;
          _withProgrammaticRange(function () { applyBtcWidgetBestView(); });
        });
      }

      if (S.countdownPriceLine) { try { S.countdownPriceLine.applyOptions({ price: last.close }); } catch(e) {} }
      _updateCountdownLabel();

      S.chartReady = true;
    } catch (err) {
      console.warn('[BTC-WIDGET] render failed:', err);

      // Si on a deja des bougies, on les garde (ne pas casser le chart sur un 502)
      if (S.candles && S.candles.length) {
        S.chartReady = true;
        _updateCountdownLabel('—');
      } else if (!S.chartReady) {
        // Premier chargement sans cache : afficher etat erreur
        var container = document.getElementById('btcChartContainer');
        if (container) container.innerHTML = '<div class="chart-error-state">'
          + '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
          + '<div>Marche indisponible</div><span>API Binance injoignable</span></div>';
      }
    } finally {
      if (token === S.renderToken) {
        S.renderInFlight = false;
      }
    }
  }

  // ──────────────────────────────────────────────
  //  INIT
  // ──────────────────────────────────────────────
  document.addEventListener('mousedown', function() { S.userIsInteracting = true; }, { passive: true });
  document.addEventListener('mouseup', function() { S.userIsInteracting = false; }, { passive: true });
  document.addEventListener('touchstart', function() { S.userIsInteracting = true; }, { passive: true });
  document.addEventListener('touchend', function() { S.userIsInteracting = false; }, { passive: true });

  function loadLibrary() {
    var container = document.getElementById('btcChartContainer');
    if (!container) { setTimeout(loadLibrary, 100); return; }
    if (S.chartReady) return;
    if (container.clientHeight < 50) container.style.minHeight = '320px';

    if (typeof window.LightweightCharts !== 'undefined') {
      createBtcWidgetChart(container);
      _fetchAndRender(false, 'user');
      return;
    }
    var urls = [
      '/static/vendor/lightweight-charts.standalone.production.js',
      'https://unpkg.com/lightweight-charts@5.0.7/dist/lightweight-charts.standalone.production.js',
      'https://cdn.jsdelivr.net/npm/lightweight-charts@5.0.7/dist/lightweight-charts.standalone.production.js',
      'https://cdnjs.cloudflare.com/ajax/libs/lightweight-charts/5.0.7/lightweight-charts.standalone.production.js',
    ];
    function tryCdn(idx) {
      if (idx >= urls.length) { container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">Impossible de charger le graphique (CDN bloque)</div>'; return; }
      var script = document.createElement('script');
      script.src = urls[idx];
      script.onload = function () { createBtcWidgetChart(container); _fetchAndRender(false, 'user'); };
      script.onerror = function () { tryCdn(idx + 1); };
      document.head.appendChild(script);
    }
    tryCdn(0);
  }

  document.addEventListener('DOMContentLoaded', function () { setTimeout(loadLibrary, 50); });

  var _origGoPage = window.goPage;
  if (_origGoPage) {
    window.goPage = function (pageName) {
      _origGoPage(pageName);
      if (pageName === 'today') setTimeout(loadLibrary, 50);
    };
  }

  window.initBtcChart = loadLibrary;
})();
