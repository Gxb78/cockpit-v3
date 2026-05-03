// ---------- BTC Chart widget — TradingView Lightweight Charts ----------
// v2.0 — Indicators: SMA, EMA, Bollinger, RSI (synced from chart settings)

(function () {
  var chart = null;
  var series = null;
  var countdownPriceLine = null;
  var currentInterval = '3m';
  var resizeObserver = null;
  var chartReady = false;
  var countdownTimer = null;
  var lastCandleTime = 0;

  // Indicator series
  var indicatorSeries = {};
  var rsiSeries = null;
  var vwapSeriesMap = {};
  var activeVwapPeriods = [];
  try { var s = JSON.parse(localStorage.getItem('chartVwapPeriods')); if (Array.isArray(s)) activeVwapPeriods = s; } catch(e) {}
  var _lastVwapFetch = 0;
  var VWAP_COLORS = { '1D': '#f59e0b', '7D': '#06b6d4', '30D': '#a78bfa', '90D': '#f472b6' };
  var VWAP_INTERVALS = { '1D': '1h', '7D': '1h', '30D': '4h', '90D': '1d' };
  var VWAP_DAYS = { '1D': 1, '7D': 7, '30D': 30, '90D': 90 };
  var VWAP_LIMITS = { '1D': 24, '7D': 168, '30D': 190, '90D': 100 };
  var INTERVAL_MINUTES = { '1m':1,'3m':3,'5m':5,'15m':15,'30m':30,'1h':60,'2h':120,'4h':240,'6h':360,'8h':480,'12h':720,'1d':1440,'3d':4320,'1w':10080,'1M':43200 };

  var INTERVAL_MS = {
    '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000,
    '30m': 1800000, '1h': 3600000, '2h': 7200000, '4h': 14400000,
    '6h': 21600000, '8h': 28800000, '12h': 43200000,
    '1d': 86400000, '3d': 259200000, '1w': 604800000, '1M': 2592000000,
  };

  // Read settings from same localStorage as chart page
  var indSettings = {
    sma: { active: false, period: 20, color: '#f59e0b' },
    ema: { active: false, period: 20, color: '#06b6d4' },
    boll: { active: false, period: 20, color: '#a78bfa' },
    rsi: { active: false, period: 14, color: '#f472b6' },
  };

  try {
    var saved = JSON.parse(localStorage.getItem('chartIndSettings'));
    if (saved) {
      Object.keys(saved).forEach(function (k) {
        if (indSettings[k]) Object.assign(indSettings[k], saved[k]);
      });
    }
  } catch(e) {}

  // VWAP period read from chartVwapPeriods (array, multi-select)

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

  // ── INDICATOR CALCULATIONS (same as 062) ──

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
    // Warmup : SMA des period premieres bougies
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
      var idx = i + period - 1;
      var sumSq = 0;
      for (var j = 0; j < period; j++) {
        var diff = candles[idx - j].close - smaData[i].value;
        sumSq += diff * diff;
      }
      var std = Math.sqrt(sumSq / period);
      result.push({
        time: smaData[i].time,
        middle: smaData[i].value,
        upper: smaData[i].value + 2 * std,
        lower: smaData[i].value - 2 * std,
      });
    }
    return result;
  }

  function _calcRSI(candles, period) {
    if (candles.length < period + 1) return [];
    var gains = [], losses = [];
    for (var i = 1; i < candles.length; i++) {
      var diff = candles[i].close - candles[i - 1].close;
      gains.push(diff > 0 ? diff : 0);
      losses.push(diff < 0 ? -diff : 0);
    }
    var avgGain = 0, avgLoss = 0;
    for (var j = 0; j < period; j++) {
      avgGain += gains[j];
      avgLoss += losses[j];
    }
    avgGain /= period;
    avgLoss /= period;
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
    if (!chart) return;
    Object.keys(indicatorSeries).forEach(function (key) {
      try { chart.removeSeries(indicatorSeries[key]); } catch(e) {}
    });
    indicatorSeries = {};
    if (rsiSeries) {
      try { chart.removeSeries(rsiSeries); } catch(e) {}
      rsiSeries = null;
    }
  }

  function _renderIndicators(candles) {
    _clearIndicators();
    if (!chart || !candles || !candles.length) return;

    var s = indSettings;

    if (s.sma.active && candles.length >= s.sma.period) {
      var smaData = _calcSMA(candles, s.sma.period);
      indicatorSeries.sma = chart.addLineSeries({
        color: s.sma.color, lineWidth: 1.5, priceLineVisible: false,
        lastValueVisible: true, crosshairMarkerVisible: false,
        title: 'SMA ' + s.sma.period,
      });
      indicatorSeries.sma.setData(smaData);
    }

    if (s.ema.active && candles.length >= s.ema.period) {
      var emaData = _calcEMA(candles, s.ema.period);
      indicatorSeries.ema = chart.addLineSeries({
        color: s.ema.color, lineWidth: 1.5, priceLineVisible: false,
        lastValueVisible: true, crosshairMarkerVisible: false,
        title: 'EMA ' + s.ema.period,
      });
      indicatorSeries.ema.setData(emaData);
    }

    if (s.boll.active && candles.length >= s.boll.period) {
      var bollData = _calcBollinger(candles, s.boll.period);
      indicatorSeries.bollMid = chart.addLineSeries({
        color: s.boll.color, lineWidth: 1, priceLineVisible: false,
        lastValueVisible: true, crosshairMarkerVisible: false,
        title: 'BB ' + s.boll.period,
      });
      indicatorSeries.bollUpper = chart.addLineSeries({
        color: s.boll.color, lineWidth: 1, priceLineVisible: false,
        lastValueVisible: false, crosshairMarkerVisible: false, lineStyle: 2,
      });
      indicatorSeries.bollLower = chart.addLineSeries({
        color: s.boll.color, lineWidth: 1, priceLineVisible: false,
        lastValueVisible: false, crosshairMarkerVisible: false, lineStyle: 2,
      });
      indicatorSeries.bollMid.setData(bollData.map(function (d) { return { time: d.time, value: d.middle }; }));
      indicatorSeries.bollUpper.setData(bollData.map(function (d) { return { time: d.time, value: d.upper }; }));
      indicatorSeries.bollLower.setData(bollData.map(function (d) { return { time: d.time, value: d.lower }; }));
    }

    if (s.rsi.active && candles.length >= s.rsi.period + 1) {
      try {
        rsiSeries = chart.addLineSeries({
          color: s.rsi.color, lineWidth: 1.5, priceLineVisible: false,
          lastValueVisible: true, crosshairMarkerVisible: false,
          priceScaleId: 'rsi_pane',
          title: 'RSI ' + s.rsi.period,
        });
        chart.priceScale('rsi_pane').applyOptions({
          scaleMargins: { top: 0.7, bottom: 0 },
          visible: true,
        });
        var rsiData = _calcRSI(candles, s.rsi.period);
        rsiSeries.setData(rsiData);
      } catch(e) { console.error('[btc-chart] RSI:', e); }
    }
  }

  // ── VWAP (multi-periode) ──
  var _vwapInFlight = false;

  function _removeVwapSeries(key) {
    var s = vwapSeriesMap[key];
    if (s) {
      try {
        var ts = chart.timeScale();
        var saved;
        try { saved = ts.getVisibleRange(); } catch(e2) {}
        s.applyOptions({ visible: false, lastValueVisible: false });
        s.setData([]);
        if (saved) { try { ts.setVisibleRange({ from: saved.from, to: saved.to }); } catch(e2) {} }
      } catch(e) {}
    }
  }
  function _calcAndDrawVwap(zoomTarget) {
    console.log('[VWAP] triggered by:', new Error().stack.split('\n')[2]);
    console.log('[VWAP] _calcAndDrawVwap periods=', activeVwapPeriods, 'range before=', chart && chart.timeScale() ? JSON.stringify(chart.timeScale().getVisibleLogicalRange()) : 'no chart');
    console.log('[VWAP] full stack:', new Error().stack);
    // Nettoyer les periodes desactivees
    Object.keys(vwapSeriesMap).forEach(function (k) {
      if (activeVwapPeriods.indexOf(k) < 0) _removeVwapSeries(k);
    });
    if (!activeVwapPeriods.length) return Promise.resolve();
    // Skip si un appel est deja en vol (evite la cascade auto-refresh)
    if (_vwapInFlight) return Promise.resolve();
    _vwapInFlight = true;

    // Helper: compute VWAP from candleArray pour une periode donnee
    function _computeVwap(period, candleArray) {
      var days = VWAP_DAYS[period] || 1;
      var color = VWAP_COLORS[period] || '#f59e0b';
      var fetchInterval = VWAP_INTERVALS[period] || '1h';
      var label = 'VWAP ' + period + ' (' + fetchInterval + ')';
      var now = Math.floor(Date.now() / 1000);
      var todayStart = Math.floor(now / 86400) * 86400;
      var cutoff = todayStart - (days - 1) * 86400;
      var cumTpv = 0, cumVol = 0;
      var vwapData = [];
      for (var i = 0; i < candleArray.length; i++) {
        var c = candleArray[i];
        if (c.time < cutoff) continue;
        var tp = (c.high + c.low + c.close) / 3;
        cumTpv += tp * c.volume;
        cumVol += c.volume;
        if (cumVol > 0) vwapData.push({ time: c.time, value: cumTpv / cumVol });
      }
      if (!vwapData.length) { _removeVwapSeries(period); return; }
      var s = vwapSeriesMap[period];
      if (s) {
        s.applyOptions({ visible: true, color: color, title: label, lastValueVisible: true });
        s.setData(vwapData);
      }
      console.log('[VWAP] after setData period=', period, 'range=', JSON.stringify(chart.timeScale().getVisibleLogicalRange()));
    }

    // Regrouper les periodes par fetchInterval pour dedoublonner les fetchs
    // p.ex. 1D+7D utilisent 1h → 1 seul fetch avec limit=max(24,168)=168
    var groups = {};
    activeVwapPeriods.forEach(function (p) {
      var fi = VWAP_INTERVALS[p] || '1h';
      if (!groups[fi]) groups[fi] = { periods: [], maxLimit: 0 };
      groups[fi].periods.push(p);
      var needed = VWAP_LIMITS[p] || Math.max(Math.ceil((VWAP_DAYS[p]||1) * 1440 / (INTERVAL_MINUTES[fi] || 60)) + 10, 100);
      if (needed > groups[fi].maxLimit) groups[fi].maxLimit = needed;
    });

    // Lancer tous les fetchs groupes en parallele (2-3 max, bien sous la limite Chrome)
    var fetches = Object.keys(groups).map(function (fi) {
      var grp = groups[fi];
      var limit = grp.maxLimit;
      var url = '/api/market/klines?symbol=BTCUSDT&interval=' + fi + '&limit=' + limit;
      return fetch(url)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) {
          if (data.error || !data.candles || !data.candles.length) {
            console.warn('[btc-chart] VWAP (' + fi + ') pas de donnees');
            grp.periods.forEach(function (p) { _removeVwapSeries(p); });
            return;
          }
          grp.periods.forEach(function (p) { _computeVwap(p, data.candles); });
        })
        .catch(function (err) {
          console.warn('[btc-chart] VWAP (' + fi + ') erreur:', err && err.message);
          grp.periods.forEach(function (p) { _removeVwapSeries(p); });
        });
    });

    // Fin du VWAP — appliquer le zoom
    return Promise.all(fetches).finally(function () {
      _vwapInFlight = false;

      // Appliquer le zoom synchrone (timestamps invariants)
      if (zoomTarget && chart && chart.timeScale()) {
        try { chart.timeScale().setVisibleRange({ from: zoomTarget.from, to: zoomTarget.to }); } catch(e) {}
      }

      console.log('[VWAP] range APRÈS finally:', JSON.stringify(chart.timeScale().getVisibleRange()));

      // rAF-retry pour les micro-shifts residuels
      if (zoomTarget) _applyZoomWithRetry(zoomTarget);
    });
  }

  // ── TIMER ──

  function _startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    // Petit delai pour laisser LWC finir son rendu initial
    setTimeout(function () {
    function tick() {
      if (!countdownPriceLine) { _updateCountdownLabel('—'); return; }
      if (!lastCandleTime) { _updateCountdownLabel('—'); return; }
      var now = Date.now();
      var ms = _getIntervalMs(currentInterval);
      var elapsed = now - lastCandleTime;
      var remaining = ms - elapsed;
      if (remaining <= 0) {
        _updateCountdownLabel('0:00');
        if (countdownTimer) clearInterval(countdownTimer);
        countdownTimer = null;
        // Laisser le WS reconnecter sans re-fetcher (preserve le zoom)
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          // WS en cours de reconnexion — ne pas refetcher, le zoom serait ecrase
        } else {
          _fetchAndRender(true, 'auto');
        }
        return;
      }
      var totalSec = Math.ceil(remaining / 1000);
      var m = Math.floor(totalSec / 60);
      var s = totalSec % 60;
      _updateCountdownLabel(m + ':' + (s < 10 ? '0' : '') + s);
    }
    tick();
    countdownTimer = setInterval(tick, 500);
    }, 300);
  }

  function _updateCountdownLabel(timerTxt) {
    if (!countdownPriceLine || !chart) return;
    if (timerTxt === undefined) timerTxt = '—';
    try { countdownPriceLine.applyOptions({ title: timerTxt }); } catch(e) {}
  }

  // ── NETWORK ──

  var refreshTimer = null;
  var currentSymbol = 'btcusdt';
  var ws = null;
  var wsReconnectTimer = null;
  var _wsIntentionalClose = false;

  // Guards anti-boucle
  var _isFetching = false;
  var _lastFetchTs = 0;
  var _FETCH_COOLDOWN_MS = 5000;

  // Flag interaction utilisateur (evite override WS pendant scroll)
  var _userIsInteracting = false;
  // Timestamp du premier fetch (evite de sauvegarder un zoom pas encore stabilise)
  var _firstFetchMs = 0;

  // ── rAF-retry pour setVisibleRange (timestamps, stables meme avec VWAP) ──
  function _applyZoomWithRetry(targetRange, maxAttempts) {
    if (!chart || !chart.timeScale()) return;
    console.log('[ZOOM] _applyZoomWithRetry target=', JSON.stringify(targetRange), 'current=', JSON.stringify(chart.timeScale().getVisibleRange()));
    maxAttempts = maxAttempts || 10;
    // Tolérance = 2 barres de l'intervalle courant (pour 3m → 360s)
    var barSec = Math.floor(_getIntervalMs(currentInterval) / 1000);
    var tol = Math.max(60, barSec * 2);
    var attempts = 0;
    function tryApply() {
      if (++attempts > maxAttempts) {
        console.warn('[ZOOM] abandon après', attempts, 'tentatives. Range final:', JSON.stringify(chart.timeScale().getVisibleRange()));
        return;
      }
      try {
        chart.timeScale().setVisibleRange({ from: targetRange.from, to: targetRange.to });
        try { chart.timeScale().scrollToRealTime(); } catch(e) {}
        var actual = chart.timeScale().getVisibleRange();
        console.log('[ZOOM] tentative', attempts, '→ actual:', JSON.stringify(actual), 'target:', JSON.stringify(targetRange));
        if (actual && Math.abs(actual.from - targetRange.from) <= tol && Math.abs(actual.to - targetRange.to) <= tol) {
          console.log('[ZOOM] ✅ stabilisé en', attempts, 'tentatives');
          return;
        }
      } catch(e) {}
      requestAnimationFrame(tryApply);
    }
    requestAnimationFrame(tryApply);
  }

  function _connectWs() {
    if (ws && ws.readyState === WebSocket.CONNECTING) return;
    if (ws) { _wsIntentionalClose = true; try { ws.close(); } catch(e) {} _wsIntentionalClose = false; }
    var stream = currentSymbol + '@kline_' + currentInterval;
    var url = 'wss://stream.binance.com:9443/ws/' + stream;
    try {
      ws = new WebSocket(url);
      ws.onopen = function() { _hideWsError(); };
      ws.onmessage = function (msg) {
        try {
          var d = JSON.parse(msg.data);
          var k = d && d.k;
          if (!k) return;
          var candle = {
            time: Math.floor(k.t / 1000),
            open: parseFloat(k.o),
            high: parseFloat(k.h),
            low: parseFloat(k.l),
            close: parseFloat(k.c),
            volume: parseFloat(k.v),
          };
          var priceEl = document.getElementById('btcChartPrice');
          if (priceEl) priceEl.textContent = '$' + candle.close.toLocaleString('fr-FR', { minimumFractionDigits: 2 });
          lastCandleTime = k.t;
          if (series) {
            try { series.update(candle); } catch(e) {}
          }
          if (countdownPriceLine) {
            try { countdownPriceLine.applyOptions({ price: candle.close }); } catch(e) {}
          }
        } catch(e) {}
      };
      ws.onclose = function () {
        if (_wsIntentionalClose) return;
        if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
        wsReconnectTimer = setTimeout(_connectWs, 3000);
        _showWsError();
      };
      ws.onerror = function() { _showWsError(); };
    } catch(e) { console.error('[btc-chart] ws:', e); }
  }

  function _showWsError() {
    var el = document.getElementById("btcChartWsStatus");
    if (el) { el.className = "btc-chart-ws-error visible"; }
  }
  function _hideWsError() {
    var el = document.getElementById("btcChartWsStatus");
    if (el) { el.className = "btc-chart-ws-error"; }
  }
  function _disconnectWs() {
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    if (ws) {
      if (ws.readyState === WebSocket.CONNECTING) { ws = null; return; }
      _wsIntentionalClose = true; try { ws.close(); } catch(e) {} ws = null; _wsIntentionalClose = false;
    }
  }

  function _startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    var ms = _getIntervalMs(currentInterval);
    var interval = ms < 3600000 ? 15000 : ms < 14400000 ? 30000 : 60000;
    refreshTimer = setInterval(function () {
      if (!lastCandleTime) return;
      var now = Date.now();
      var elapsed = now - lastCandleTime;
      if (elapsed < _getIntervalMs(currentInterval) * 0.95) {
        _fetchAndRender(true, 'auto');
      }
    }, interval);
  }

  // ── CHART ──

  function initBtcChart() {
    var container = document.getElementById('btcChartContainer');
    if (!container) {
      if (document.querySelector('.page[data-page="today"].active')) {
        setTimeout(initBtcChart, 300);
      }
      return;
    }
    if (chartReady) return;
    if (container.clientHeight < 50) {
      container.style.minHeight = '320px';
    }
    loadLibrary(container);
  }

  function loadLibrary(container) {
    if (typeof window.LightweightCharts !== 'undefined') {
      _createChart(container);
      _fetchAndRender(false, 'user');
      return;
    }
    var urls = [
      'https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js',
      'https://cdn.jsdelivr.net/npm/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js',
      'https://cdnjs.cloudflare.com/ajax/libs/lightweight-charts/4.1.3/lightweight-charts.standalone.production.js',
    ];
    function tryCdn(idx) {
      if (idx >= urls.length) {
        console.error('[btc-chart] aucun CDN disponible');
        container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:13px">Impossible de charger le graphique (CDN bloque)</div>';
        return;
      }
      var script = document.createElement('script');
      script.src = urls[idx];
      script.onload = function () {
        _createChart(container);
        _fetchAndRender(false, 'user');
      };
      script.onerror = function () { tryCdn(idx + 1); };
      document.head.appendChild(script);
    }
    tryCdn(0);
  }

  function _createChart(container) {
    if (chartReady) return;
    chartReady = true;
    if (!container || !container.parentElement) return;

    var isLight = document.body.classList.contains('light-mode');
    var w = container.clientWidth || 600;
    var h = container.clientHeight || 360;

    try {
      chart = window.LightweightCharts.createChart(container, {
        width: w,
        height: Math.max(240, h),
        layout: {
          background: { type: 'solid', color: 'transparent' },
          textColor: isLight ? '#1e293b' : '#d1d5db',
        },
        grid: {
          vertLines: { color: 'transparent' },
          horzLines: { color: 'transparent' },
        },
        crosshair: { mode: 0 },
        rightPriceScale: {
          borderColor: isLight ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)',
          borderVisible: false,
          scaleMargins: { top: 0.05, bottom: 0.25 },
          autoScale: true,
        },
        timeScale: {
          borderColor: isLight ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)',
          timeVisible: true,
          secondsVisible: false,
          rightOffset: 20,
          shiftVisibleRangeOnNewBar: false,
          lockVisibleTimeRangeOnResize: true,
        },
        handleScroll: { vertTouchDrag: true, horzTouchDrag: true, pressedMouseMove: true },
      });

      series = chart.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderDownColor: '#ef4444',
        borderUpColor: '#22c55e',
        wickDownColor: '#ef4444',
        wickUpColor: '#22c55e',
        lastValueVisible: false,
        priceLineVisible: false,
      });

      countdownPriceLine = series.createPriceLine({
        price: 0,
        color: '#22c55e',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: '—',
      });

      // Pré-créer les 4 séries VWAP — visibles dès le départ avec données vides
      Object.keys(VWAP_COLORS).forEach(function (p) {
        vwapSeriesMap[p] = chart.addLineSeries({
          color: VWAP_COLORS[p], lineWidth: 1.5,
          priceLineVisible: false, lastValueVisible: false,
          crosshairMarkerVisible: false,
          title: 'VWAP ' + p,
          visible: true,
        });
        vwapSeriesMap[p].setData([]); // données vides = pas de rendu, mais LWC sait que la série existe
      });

      if (resizeObserver) resizeObserver.disconnect();
      resizeObserver = new ResizeObserver(function () {
        if (chart && container) {
          var cw = container.clientWidth;
          var ch = Math.max(240, container.clientHeight || 360);
          if (cw > 0 && ch > 0) chart.applyOptions({ width: cw, height: ch });
        }
      });
      resizeObserver.observe(container);

      // Interval buttons
      document.querySelectorAll('.btc-chart-interval').forEach(function (btn) {
        btn.addEventListener('click', function () {
          document.querySelectorAll('.btc-chart-interval').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          currentInterval = btn.dataset.interval;
          _disconnectWs();
          var ci = document.getElementById('btcChartCustom');
          if (ci) ci.value = '';
          _fetchAndRender(false, 'user');
        });
      });

      // Custom interval input
      var customInput = document.getElementById('btcChartCustom');
      if (customInput) {
        customInput.addEventListener('change', function () {
          var val = this.value.trim().toLowerCase();
          if (!/^\d+(m|h|d|w|M)$/.test(val)) {
            this.classList.add("jedit-field-error");
            this.title = "Format attendu: chiffre + m/h/d/w/M (ex: 45m, 4h, 7d)";
            return;
          }
          this.classList.remove("jedit-field-error");
          this.title = "";
          document.querySelectorAll('.btc-chart-interval').forEach(function (b) { b.classList.remove('active'); });
          currentInterval = val;
          _disconnectWs();
          _fetchAndRender(false, 'user');
        });
        customInput.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { this.blur(); }
        });
      }

    } catch (e) {
      console.error('[btc-chart] createChart error:', e);
      container.innerHTML = '<div class="chart-error-state">'
        + '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
        + '<div>Erreur graphique</div>'
        + '<span>Impossible de creer le graphique</span></div>';
    }
  }

  function _fetchAndRender(keepZoom, _source) {
    if (!series) return;
    // Guard anti-appels simultanés
    if (_isFetching) return;
    // Debounce 5s sur les appels automatiques (WS, countdown, auto-refresh)
    if (_source !== 'user') {
      var now = Date.now();
      if (_lastFetchTs && (now - _lastFetchTs) < _FETCH_COOLDOWN_MS) return;
      _lastFetchTs = now;
    }
    _isFetching = true;
    if (!_firstFetchMs) _firstFetchMs = Date.now();

    // Sauvegarder le zoom en timestamps (stables meme apres ajout series VWAP)
    var savedTarget = null;
    if (keepZoom && !_userIsInteracting && chart && chart.timeScale()) {
      if (_source === 'user' || Date.now() - _firstFetchMs > 2000) {
        try {
          var timeRange = chart.timeScale().getVisibleRange();
          if (timeRange) {
            var rangeWidth = timeRange.to - timeRange.from;
            var barSec = Math.floor(_getIntervalMs(currentInterval) / 1000);
            // Ne sauvegarder que si le range est raisonnable (> 50 barres)
            if (rangeWidth >= barSec * 80) {
              savedTarget = { from: timeRange.from, to: timeRange.to };
            }
          }
        } catch(e) {}
      }
      try { chart.priceScale('right').applyOptions({ autoScale: false }); } catch(e) {}
    }

    var url = '/api/market/klines?symbol=BTCUSDT&interval=' + currentInterval + '&limit=300';
    fetch(url)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        if (data.error) { console.error('[btc-chart]', data.error); toast(data.error, 'error'); return; }
        var candles = data.candles || [];
        if (!candles.length) {
          console.warn('[btc-chart] fetch OK mais 0 candles pour ' + currentInterval
            + ' | chartReady=' + chartReady + ' | series=' + (series ? 'ok' : 'null')
            + ' | container=' + (document.getElementById('btcChartContainer') ? 'ok' : 'null'));
          toast('Aucune donnee disponible pour ' + currentInterval, 'error'); return;
        }
        var last = candles[candles.length - 1];
        lastCandleTime = last.time * 1000;
        _startCountdown();
        _startAutoRefresh();
        if (_source !== 'ws') {
          _disconnectWs();
          _connectWs();
        }
        var priceEl = document.getElementById('btcChartPrice');
        if (priceEl) priceEl.textContent = '$' + Number(last.close).toLocaleString('fr-FR', { minimumFractionDigits: 2 });
        series.setData(candles);

        // Point fantôme pour étendre le range autorisé par LWC (marge droite)
        var intervalSec = Math.floor(_getIntervalMs(currentInterval) / 1000);
        var phantomTime = last.time + intervalSec * 25;
        try { series.update({ time: phantomTime, open: last.close, high: last.close, low: last.close, close: last.close }); } catch(e) {}

        // Indicators
        _renderIndicators(candles);

        // VWAP — avec TTL 5min pour éviter les re-fetchs inutiles
        var zoomTarget = null;
        if (savedTarget) {
          zoomTarget = { from: savedTarget.from, to: savedTarget.to, hasSavedTarget: true };
        } else if (!keepZoom) {
          // Premier chargement : calculer en timestamps (invariant VWAP)
          var intervalSec = Math.floor(_getIntervalMs(currentInterval) / 1000);
          var firstIdx = Math.max(0, candles.length - 100);
          var fromTime = candles[firstIdx].time;
          var phantomTime = candles[candles.length - 1].time + intervalSec * 25;
          zoomTarget = { from: fromTime, to: phantomTime, hasSavedTarget: false };
        }
        if (!_lastVwapFetch || Date.now() - _lastVwapFetch > 300000) {
          _lastVwapFetch = Date.now();
          _calcAndDrawVwap(zoomTarget).finally(function () {
            _isFetching = false;
          });
        } else {
          _isFetching = false;
          if (zoomTarget) _applyZoomWithRetry(zoomTarget);
        }

        if (countdownPriceLine) {
          try { countdownPriceLine.applyOptions({ price: last.close }); } catch(e) {}
        }
        _updateCountdownLabel();
        setTimeout(function() {
          try { chart.priceScale('right').applyOptions({ autoScale: false }); } catch(e) {}
        }, 50);
        // Subscribe aux changements de range pour debug
        try {
          chart.timeScale().subscribeVisibleLogicalRangeChange(function(range) {
            if (range) console.log('[RANGE CHANGE]', JSON.stringify(range), (new Error()).stack.split('\n').slice(1,4).join(' | '));
          });
        } catch(e) {}
      })
      .catch(function (err) {
        console.error('[btc-chart] fetch:', err);
        _isFetching = false;
        var container = document.getElementById('btcChartContainer');
        if (container && !chartReady) {
          container.innerHTML = '<div class="chart-error-state">'
            + '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
            + '<div>Marche indisponible</div>'
            + '<span>API Binance injoignable</span></div>';
        }
      });
  }

  // ── INIT ──

  // Interaction listeners pour _userIsInteracting
  document.addEventListener('mousedown', function() { _userIsInteracting = true; }, { passive: true });
  document.addEventListener('mouseup', function() { _userIsInteracting = false; }, { passive: true });
  document.addEventListener('touchstart', function() { _userIsInteracting = true; }, { passive: true });
  document.addEventListener('touchend', function() { _userIsInteracting = false; }, { passive: true });

  function _waitForContainer(callback, maxRetries, interval) {
    maxRetries = maxRetries || 20;
    interval = interval || 50;
    var retries = 0;
    function poll() {
      if (document.getElementById('btcChartContainer')) {
        callback();
        return;
      }
      retries++;
      if (retries >= maxRetries) {
        console.warn('[btc-chart] #btcChartContainer introuvable apres ' + (maxRetries * interval) + 'ms');
        return;
      }
      setTimeout(poll, interval);
    }
    poll();
  }

  function _tryInit() {
    if (chartReady) return;
    _waitForContainer(initBtcChart);
  }

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(_tryInit, 50);
  });

  var _origGoPage = window.goPage;
  if (_origGoPage) {
    window.goPage = function (pageName) {
      _origGoPage(pageName);
      if (pageName === 'today') _waitForContainer(initBtcChart);
    };
  }

  window.initBtcChart = initBtcChart;
})();
