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
  var vwapSeries = null;

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

  // VWAP period synced from chart page
  var activeVwapPeriod = null;
  try {
    activeVwapPeriod = localStorage.getItem('chartVwapPeriod') || null;
  } catch(e) {}

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
    var result = [];
    for (var i = period - 1; i < candles.length; i++) {
      var sum = 0;
      for (var j = 0; j < period; j++) sum += candles[i - j].close;
      result.push({ time: candles[i].time, value: sum / period });
    }
    return result;
  }

  function _calcEMA(candles, period) {
    var result = [];
    var k = 2 / (period + 1);
    var ema = candles[0].close;
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

  // ── VWAP ──
  function _calcAndDrawVwap(candles) {
    if (!activeVwapPeriod || !candles || !candles.length) {
      if (vwapSeries) { try { chart.removeSeries(vwapSeries); } catch(e) {} vwapSeries = null; }
      return;
    }
    var days = { '1D': 1, '7D': 7, '30D': 30, '90D': 90 }[activeVwapPeriod] || 1;
    var fetchInterval = '1h';
    if (days >= 7 && days <= 14) fetchInterval = '1h';
    else if (days <= 90) fetchInterval = '4h';
    else fetchInterval = '1d';
    var intervalMinutes = { '1m':1,'3m':3,'5m':5,'15m':15,'30m':30,'1h':60,'2h':120,'4h':240,'6h':360,'8h':480,'12h':720,'1d':1440,'3d':4320,'1w':10080,'1M':43200 };
    var minPerCandle = intervalMinutes[fetchInterval] || 60;
    var needed = Math.ceil(days * 1440 / minPerCandle) + 10;
    needed = Math.max(needed, 100);

    var url = '/api/market/klines?symbol=BTCUSDT&interval=' + fetchInterval + '&limit=' + needed;
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error || !data.candles || !data.candles.length) {
          if (vwapSeries) { try { chart.removeSeries(vwapSeries); } catch(e) {} vwapSeries = null; }
          return;
        }
        var vwapCandles = data.candles;
        var now = Math.floor(Date.now() / 1000);
        var cutoff = now - days * 86400;
        var cumTpv = 0, cumVol = 0;
        var vwapData = [];
        for (var i = 0; i < vwapCandles.length; i++) {
          var c = vwapCandles[i];
          if (c.time < cutoff) continue;
          var tp = (c.high + c.low + c.close) / 3;
          cumTpv += tp * c.volume;
          cumVol += c.volume;
          if (cumVol > 0) vwapData.push({ time: c.time, value: cumTpv / cumVol });
        }
        if (!vwapData.length) {
          if (vwapSeries) { try { chart.removeSeries(vwapSeries); } catch(e) {} vwapSeries = null; }
          return;
        }
        if (!vwapSeries) {
          vwapSeries = chart.addLineSeries({
            color: '#f59e0b', lineWidth: 1.5, priceLineVisible: false,
            lastValueVisible: true, crosshairMarkerVisible: false,
            title: 'VWAP ' + activeVwapPeriod,
          });
        }
        vwapSeries.setData(vwapData);
      })
      .catch(function () {
        if (vwapSeries) { try { chart.removeSeries(vwapSeries); } catch(e) {} vwapSeries = null; }
      });
  }

  // ── TIMER ──

  function _startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    function tick() {
      if (!lastCandleTime) { _updateCountdownLabel('—'); return; }
      var now = Date.now();
      var ms = _getIntervalMs(currentInterval);
      var elapsed = now - lastCandleTime;
      var remaining = ms - elapsed;
      if (remaining <= 0) {
        _updateCountdownLabel('0:00');
        if (countdownTimer) clearInterval(countdownTimer);
        countdownTimer = null;
        _fetchAndRender(true);
        return;
      }
      var totalSec = Math.ceil(remaining / 1000);
      var m = Math.floor(totalSec / 60);
      var s = totalSec % 60;
      _updateCountdownLabel(m + ':' + (s < 10 ? '0' : '') + s);
    }
    tick();
    countdownTimer = setInterval(tick, 500);
  }

  function _updateCountdownLabel(timerTxt) {
    if (!countdownPriceLine) return;
    if (timerTxt === undefined) timerTxt = '—';
    try { countdownPriceLine.applyOptions({ title: timerTxt }); } catch(e) {}
  }

  // ── NETWORK ──

  var refreshTimer = null;
  var currentSymbol = 'btcusdt';
  var ws = null;
  var wsReconnectTimer = null;
  var _wsIntentionalClose = false;

  function _connectWs() {
    if (ws && ws.readyState === WebSocket.CONNECTING) return;
    if (ws) { _wsIntentionalClose = true; try { ws.close(); } catch(e) {} _wsIntentionalClose = false; }
    var stream = currentSymbol + '@kline_' + currentInterval;
    var url = 'wss://stream.binance.com:9443/ws/' + stream;
    try {
      ws = new WebSocket(url);
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
          if (k.x) { _fetchAndRender(true); return; }
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
      };
      ws.onerror = function() {};
    } catch(e) { console.error('[btc-chart] ws:', e); }
  }

  function _disconnectWs() {
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    if (ws) { _wsIntentionalClose = true; try { ws.close(); } catch(e) {} ws = null; _wsIntentionalClose = false; }
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
        _fetchAndRender(true);
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
      _fetchAndRender();
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
        _fetchAndRender();
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
        },
        timeScale: {
          borderColor: isLight ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)',
          timeVisible: true,
          secondsVisible: false,
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
          _fetchAndRender();
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
          _fetchAndRender();
        });
        customInput.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { this.blur(); }
        });
      }

    } catch (e) {
      console.error('[btc-chart] createChart error:', e);
    }
  }

  function _fetchAndRender(keepZoom) {
    if (!series) return;

    // Sauvegarder le zoom utilisateur avant refresh (en temps ET en logique)
    var savedRange = null;
    var savedLogical = null;
    if (keepZoom && chart && chart.timeScale()) {
      try { savedRange = chart.timeScale().getVisibleRange(); } catch(e) {}
      try { savedLogical = chart.timeScale().getVisibleLogicalRange(); } catch(e) {}
    }

    var url = '/api/market/klines?symbol=BTCUSDT&interval=' + currentInterval + '&limit=5000';
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { console.error('[btc-chart]', data.error); return; }
        var candles = data.candles || [];
        if (!candles.length) return;
        var last = candles[candles.length - 1];
        lastCandleTime = last.time * 1000;
        _startCountdown();
        _startAutoRefresh();
        _disconnectWs();
        _connectWs();
        var priceEl = document.getElementById('btcChartPrice');
        if (priceEl) priceEl.textContent = '$' + Number(last.close).toLocaleString('fr-FR', { minimumFractionDigits: 2 });
        series.setData(candles);

        // Indicators
        _renderIndicators(candles);

        // VWAP
        _calcAndDrawVwap(candles);

        if (countdownPriceLine) {
          try { countdownPriceLine.applyOptions({ price: last.close }); } catch(e) {}
        }
        _updateCountdownLabel();
        if (!keepZoom) chart.timeScale().fitContent();

        // Restaurer le zoom utilisateur apres setData (logique d'abord, temps en fallback)
        if (keepZoom) {
          if (savedLogical) {
            try { chart.timeScale().setVisibleLogicalRange(savedLogical); } catch(e) {}
          } else if (savedRange) {
            try { chart.timeScale().setVisibleRange(savedRange); } catch(e) {}
          }
        }
      })
      .catch(function (err) { console.error('[btc-chart] fetch:', err); });
  }

  // ── INIT ──

  function _tryInit() {
    if (chartReady) return;
    initBtcChart();
    if (!chartReady) {
      setTimeout(_tryInit, 500);
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(_tryInit, 300);
  });

  var _origGoPage = window.goPage;
  if (_origGoPage) {
    window.goPage = function (pageName) {
      _origGoPage(pageName);
      if (pageName === 'today') setTimeout(_tryInit, 400);
    };
  }

  window.initBtcChart = initBtcChart;
})();
