// ---------- BTC Chart widget — TradingView Lightweight Charts ----------
// v3.0 — Premium widget: custom viewport, free pan, follow mode, state isolation

(function () {
  // ──────────────────────────────────────────────
  //  CONFIG
  // ──────────────────────────────────────────────
  var BTC_WIDGET_VIEW = {
    visibleBars: { '1m':200,'3m':120,'5m':110,'15m':96,'30m':90,'1h':84,'2h':78,'4h':72,'6h':60,'8h':50,'12h':40,'1d':90 },
    futureBars:  { '1m':24,'3m':18,'5m':18,'15m':16,'30m':14,'1h':12,'2h':12,'4h':10,'6h':10,'8h':8,'12h':8,'1d':8 },
    barSpacing:  { '1m':6,'3m':8,'5m':8,'15m':10,'30m':10,'1h':12,'2h':14,'4h':14,'6h':16,'8h':16,'12h':18,'1d':10 },
  };

  var VWAP_COLORS = { '1D': '#f59e0b', '7D': '#06b6d4', '30D': '#a78bfa', '90D': '#f472b6' };
  var VWAP_SECONDS = { '1D': 86400, '7D': 604800, '30D': 2592000, '90D': 7776000 };
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
    vwapInFlight: false,
    lastVwapFetch: 0,
    // Timers
    countdownTimer: null,
    refreshTimer: null,
    lastCandleTime: 0,
    // WS
    ws: null,
    wsReconnectTimer: null,
    wsIntentionalClose: false,
    // Flags
    chartReady: false,
    userIsInteracting: false,
    lastFetchTs: 0,
    FETCH_COOLDOWN_MS: 5000,
    firstFetchMs: 0,
    // Resize
    resizeObserver: null,
  };

  // VWAP periods from localStorage
  try { var s = JSON.parse(localStorage.getItem('chartVwapPeriods')); if (Array.isArray(s)) S.activeVwapPeriods = s; } catch(e) {}

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
  function _computeVwap(candles, periodSec) {
    if (!candles || !candles.length) return [];
    var lastTime = candles[candles.length - 1].time, cutoff = lastTime - periodSec;
    var cumVP = 0, cumV = 0, result = [];
    for (var i = 0; i < candles.length; i++) {
      var c = candles[i];
      if (c.time < cutoff) continue;
      var tp = (c.high + c.low + c.close) / 3;
      cumVP += tp * c.volume; cumV += c.volume;
      if (cumV > 0) result.push({ time: c.time, value: cumVP / cumV });
    }
    return result;
  }
  function _alignIndicatorToCandles(points, mainCandles) {
    if (!points || !points.length || !mainCandles || !mainCandles.length) return [];
    var sorted = points.slice().filter(function(p) { return p && Number.isFinite(p.time) && Number.isFinite(p.value); }).sort(function(a, b) { return a.time - b.time; });
    var out = [], j = 0;
    for (var ci = 0; ci < mainCandles.length; ci++) {
      var t = mainCandles[ci].time;
      while (j + 1 < sorted.length && sorted[j + 1].time <= t) j++;
      if (sorted[j] && sorted[j].time <= t) out.push({ time: t, value: sorted[j].value });
    }
    return out;
  }
  async function _calcAndDrawVwap() {
    var currentRenderToken = S.renderToken;
    try { var s = JSON.parse(localStorage.getItem('chartVwapPeriods')); if (Array.isArray(s)) S.activeVwapPeriods = s; } catch(e) {}
    Object.keys(S.vwapSeriesMap).forEach(function (k) { if (S.activeVwapPeriods.indexOf(k) < 0) _removeVwapSeries(k); });
    if (!S.activeVwapPeriods.length) return;
    if (S.vwapInFlight) return;
    S.vwapInFlight = true;

    function _fetchKlines(interval, limit) {
      return fetch('/api/market/klines?symbol=BTCUSDT&interval=' + interval + '&limit=' + limit)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) { return data.candles || []; });
    }

    try { S.chart.applyOptions({ handleScroll: false, handleScale: false }); } catch(e) {}
    try { S.chart.timeScale().applyOptions({ shiftVisibleRangeOnNewBar: false }); } catch(e) {}

    var candles = S.candles;
    var lastTime = candles.length ? candles[candles.length - 1].time : 0;
    var firstTime = candles.length ? candles[0].time : 0;
    var coveredSecs = lastTime - firstTime;
    var vwapOrder = ['1D', '7D', '30D', '90D'];

    for (var vi = 0; vi < vwapOrder.length; vi++) {
      var p = vwapOrder[vi];
      if (S.activeVwapPeriods.indexOf(p) < 0) continue;
      var periodSec = VWAP_SECONDS[p] || 86400;
      var src;

      if (coveredSecs >= periodSec) {
        src = candles;
      } else {
        var interval, limit;
        if (periodSec <= 604800) { interval = '15m'; limit = Math.min(Math.ceil(periodSec / 900) + 10, 1000); }
        else if (periodSec <= 2592000) { interval = '1h'; limit = Math.min(Math.ceil(periodSec / 3600) + 10, 1000); }
        else { interval = '4h'; limit = Math.min(Math.ceil(periodSec / 14400) + 10, 1000); }
        src = await _fetchKlines(interval, limit);
        if (S.renderToken !== currentRenderToken) {
          S.vwapInFlight = false;
          return;
        }
      }

      var vw = _computeVwap(src, periodSec);
      if (src !== candles) vw = _alignIndicatorToCandles(vw, candles);
      if (vw.length < 2) { _removeVwapSeries(p); continue; }
      var s = S.vwapSeriesMap[p];
      if (s) {
        s.applyOptions({ visible: true, color: VWAP_COLORS[p] || '#f59e0b', title: 'VWAP ' + p, lastValueVisible: true });
        s.setData(vw);
      }
      await _waitFrame();
    }
    S.vwapInFlight = false;
    if (S.chart) {
      try { S.chart.applyOptions({ handleScroll: true, handleScale: true }); } catch(e) {}
      try { S.chart.timeScale().applyOptions({ shiftVisibleRangeOnNewBar: true, rightBarStaysOnScroll: false }); } catch(e) {}
      if (S.renderToken === currentRenderToken) {
        try { S.chart.timeScale().applyOptions({ rightBarStaysOnScroll: true }); } catch(e) {}
      }
    }
  }

  // ──────────────────────────────────────────────
  //  PRICE RANGE MANAGEMENT
  // ──────────────────────────────────────────────
  function computeBtcWidgetPriceRange(candles, tf) {
    if (!candles || !candles.length) return null;
    var visibleBars = BTC_WIDGET_VIEW.visibleBars[tf] || 100;
    var slice = candles.slice(-visibleBars);
    var high = -Infinity, low = Infinity;
    for (var i = 0; i < slice.length; i++) {
      var c = slice[i];
      if (Number.isFinite(c.high)) high = Math.max(high, c.high);
      if (Number.isFinite(c.low)) low = Math.min(low, c.low);
    }
    if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
    var rawRange = Math.max(high - low, high * 0.002);
    return { from: low - rawRange * 0.22, to: high + rawRange * 0.18 };
  }

  function getBtcWidgetCurrentPriceRange() {
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
    // LWC 5.x: setVisibleRange direct
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
  function maybeFollowBtcWidgetPriceY() {
    if (!S.follow || S.userDragging) return;
    var candles = S.candles;
    if (!candles || !candles.length) return;
    var last = candles[candles.length - 1];
    var price = last.close;
    var currentRange = getBtcWidgetCurrentPriceRange();
    if (!currentRange) {
      _withProgrammaticRange(function () { setBtcWidgetPriceRange(computeBtcWidgetPriceRange(candles, S.timeframe)); });
      return;
    }
    var height = currentRange.to - currentRange.from;
    var topZone = currentRange.to - height * 0.16;
    var bottomZone = currentRange.from + height * 0.16;
    if (price < topZone && price > bottomZone) return;
    _withProgrammaticRange(function () { setBtcWidgetPriceRange(computeBtcWidgetPriceRange(candles, S.timeframe)); });
  }

  function _startCountdown() {
    if (S.countdownTimer) clearInterval(S.countdownTimer);
    setTimeout(function () {
      function tick() {
        if (!S.countdownPriceLine) { _updateCountdownLabel('—'); return; }
        if (!S.lastCandleTime) { _updateCountdownLabel('—'); return; }
        var now = Date.now();
        var ms = _getIntervalMs(S.timeframe);
        var elapsed = now - S.lastCandleTime;
        var remaining = ms - elapsed;
        if (remaining <= 0) {
          _updateCountdownLabel('0:00');
          if (S.countdownTimer) clearInterval(S.countdownTimer);
          S.countdownTimer = null;
          if (!S.ws || S.ws.readyState !== WebSocket.OPEN) { /* WS en reconnexion */ }
          else { _fetchAndRender(true, 'auto'); }
          return;
        }
        var totalSec = Math.ceil(remaining / 1000);
        _updateCountdownLabel(Math.floor(totalSec / 60) + ':' + (totalSec % 60 < 10 ? '0' : '') + (totalSec % 60));
      }
      tick();
      S.countdownTimer = setInterval(tick, 500);
    }, 300);
  }
  function _updateCountdownLabel(txt) {
    if (!S.countdownPriceLine || !S.chart) return;
    try { S.countdownPriceLine.applyOptions({ title: txt === undefined ? '—' : txt }); } catch(e) {}
  }
  function _startAutoRefresh() {
    if (S.refreshTimer) clearInterval(S.refreshTimer);
    var ms = _getIntervalMs(S.timeframe);
    var interval = ms < 3600000 ? 15000 : ms < 14400000 ? 30000 : 60000;
    S.refreshTimer = setInterval(function () {
      if (!S.lastCandleTime) return;
      if (Date.now() - S.lastCandleTime < _getIntervalMs(S.timeframe) * 0.95) {
        _fetchAndRender(true, 'auto');
      }
    }, interval);
  }

  // ──────────────────────────────────────────────
  //  NETWORK (WS)
  // ──────────────────────────────────────────────
  var currentSymbol = 'btcusdt';
  function _connectWs() {
    if (S.ws && S.ws.readyState === WebSocket.CONNECTING) return;
    if (S.ws) { S.wsIntentionalClose = true; try { S.ws.close(); } catch(e) {} S.wsIntentionalClose = false; }
    var url = 'wss://stream.binance.com:9443/ws/' + currentSymbol + '@kline_' + S.timeframe;
    try {
      S.ws = new WebSocket(url);
      S.ws.onopen = function() { _hideWsError(); };
      S.ws.onmessage = function (msg) {
        try {
          var d = JSON.parse(msg.data), k = d && d.k;
          if (!k) return;
          var candle = { time: Math.floor(k.t / 1000), open: parseFloat(k.o), high: parseFloat(k.h), low: parseFloat(k.l), close: parseFloat(k.c), volume: parseFloat(k.v) };
          var priceEl = document.getElementById('btcChartPrice');
          if (priceEl) priceEl.textContent = '$' + candle.close.toLocaleString('fr-FR', { minimumFractionDigits: 2 });
          S.lastCandleTime = k.t;
          if (S.candleSeries) {
            try { S.candleSeries.update(candle); } catch(e) {}
          }
          if (S.countdownPriceLine) {
            try { S.countdownPriceLine.applyOptions({ price: candle.close }); } catch(e) {}
          }
          // Follow Y si actif
          if (S.follow && !S.userDragging) {
            _withProgrammaticRange(function () { maybeFollowBtcWidgetPriceY(); });
          }
        } catch(e) {}
      };
      S.ws.onclose = function () {
        if (S.wsIntentionalClose) return;
        if (S.wsReconnectTimer) clearTimeout(S.wsReconnectTimer);
        S.wsReconnectTimer = setTimeout(_connectWs, 3000);
        _showWsError();
      };
      S.ws.onerror = function() { _showWsError(); };
    } catch(e) { console.error('[btc-widget] ws:', e); }
  }
  function _showWsError() { var el = document.getElementById('btcChartWsStatus'); if (el) el.className = 'btc-chart-ws-error visible'; }
  function _hideWsError() { var el = document.getElementById('btcChartWsStatus'); if (el) el.className = 'btc-chart-ws-error'; }
  function _disconnectWs() {
    if (S.wsReconnectTimer) { clearTimeout(S.wsReconnectTimer); S.wsReconnectTimer = null; }
    if (S.ws) {
      if (S.ws.readyState === WebSocket.CONNECTING) { S.ws = null; return; }
      S.wsIntentionalClose = true; try { S.ws.close(); } catch(e) {} S.ws = null; S.wsIntentionalClose = false;
    }
  }

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
      rightPriceScale: { visible: true, autoScale: true, borderVisible: false, scaleMargins: { top: 0.08, bottom: 0.14 } },
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
      autoscaleInfoProvider: function (baseImpl) {
        if (!S.manualPriceRange) return baseImpl();
        return { priceRange: { minValue: S.manualPriceRange.from, maxValue: S.manualPriceRange.to }, margins: { above: 0.06, below: 0.10 } };
      },
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
        _disconnectWs();
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
        _disconnectWs();
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

  function _fetchAndRender(keepZoom, _source) {
    if (!S.candleSeries) return;
    var token = ++S.renderToken;
    console.log('[BTC-WIDGET] render start token=', token, 'tf=', S.timeframe, 'source=', _source);

    // Reset live state au chargement (follow ON)
    if (!keepZoom) _resetLiveState();

    // Debounce auto-refresh
    if (_source !== 'user') {
      var now = Date.now();
      if (S.lastFetchTs && (now - S.lastFetchTs) < S.FETCH_COOLDOWN_MS) return;
      S.lastFetchTs = now;
    }
    if (!S.firstFetchMs) S.firstFetchMs = Date.now();

    _clearAllSeries();

    var url = '/api/market/klines?symbol=BTCUSDT&interval=' + S.timeframe + '&limit=300';
    fetch(url)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        if (data.error) { console.error('[btc-widget]', data.error); toast(data.error, 'error'); return; }
        var raw = data.candles || [];
        if (!raw.length) { toast('Aucune donnee pour ' + S.timeframe, 'error'); return; }

        if (token !== S.renderToken) { console.warn('[BTC-WIDGET] stale candles ignored'); return; }

        var candles = _normalizeCandles(raw);
        var last = candles[candles.length - 1];
        S.lastCandleTime = last.time * 1000;
        S.candles = candles;

        _startCountdown();
        _startAutoRefresh();
        if (_source !== 'ws') { _disconnectWs(); _connectWs(); }

        var priceEl = document.getElementById('btcChartPrice');
        if (priceEl) priceEl.textContent = '$' + Number(last.close).toLocaleString('fr-FR', { minimumFractionDigits: 2 });

        S.candleSeries.setData(candles);
        _renderIndicators(candles);

        // VWAP
        if (S.activeVwapPeriods.length > 0 && (!S.lastVwapFetch || Date.now() - S.lastVwapFetch > 300000)) {
          S.lastVwapFetch = Date.now();
          _calcAndDrawVwap().finally(function () {});
        } else if (!S.activeVwapPeriods.length) {
          S.lastVwapFetch = 0;
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
      })
      .catch(function (err) {
        console.error('[btc-widget] fetch:', err);
        if (!S.chartReady) {
          var container = document.getElementById('btcChartContainer');
          if (container) container.innerHTML = '<div class="chart-error-state">'
            + '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
            + '<div>Marche indisponible</div><span>API Binance injoignable</span></div>';
        }
      });
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
