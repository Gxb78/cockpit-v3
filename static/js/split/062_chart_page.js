// ---------- Chart page — TradingView Lightweight Charts XXL ----------
// v2.0 — Indicators: SMA, EMA, Bollinger, RSI + Settings panel

(function () {
  var chart = null;
  var candlestickSeries = null;
  var volumeSeries = null;

  // Indicator series
  var indicatorSeries = {};
  var rsiSeries = null;
  var rsiPaneId = 'rsi_pane';

  // VWAP (multi-periode)
  var vwapSeriesMap = {};
  var activeVwapPeriods = [];
  try {
    var savedVwap = JSON.parse(localStorage.getItem('chartVwapPeriods'));
    if (Array.isArray(savedVwap)) activeVwapPeriods = savedVwap;
  } catch(e) {}
  var VWAP_COLORS = { '1D': '#f59e0b', '7D': '#06b6d4', '30D': '#a78bfa', '90D': '#f472b6' };
  var VWAP_INTERVALS = { '1D': '1h', '7D': '1h', '30D': '4h', '90D': '1d' };
  var VWAP_DAYS = { '1D': 1, '7D': 7, '30D': 30, '90D': 90 };

  // State
  var countdownPriceLine = null;
  var currentInterval = localStorage.getItem('chartDefInterval') || '3m';
  var currentSymbol = localStorage.getItem('chartDefSymbol') || 'BTCUSDT';
  var chartStyle = localStorage.getItem('chartDefStyle') || 'candlestick';
  var countdownTimer = null;
  var lastCandleTime = 0;
  var lastPrice = 0;
  var resizeObserver = null;
  var refreshTimer = null;
  var ws = null;
  var wsReconnectTimer = null;
  var _wsIntentionalClose = false;
  var _lastCandles = null; // dernieres bougies fetchees (pour VWAP 1D/7D temps reel)

  // Settings state
  var indSettings = {
    sma: { active: false, period: 20, color: '#f59e0b' },
    ema: { active: false, period: 20, color: '#06b6d4' },
    boll: { active: false, period: 20, color: '#a78bfa' },
    rsi: { active: false, period: 14, color: '#f472b6' },
  };

  // Load saved settings
  try {
    var savedInd = JSON.parse(localStorage.getItem('chartIndSettings'));
    if (savedInd) {
      Object.keys(savedInd).forEach(function (k) {
        if (indSettings[k]) Object.assign(indSettings[k], savedInd[k]);
      });
    }
  } catch(e) {}

  var INTERVAL_MS = {
    '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000,
    '30m': 1800000, '1h': 3600000, '2h': 7200000, '4h': 14400000,
    '6h': 21600000, '8h': 28800000, '12h': 43200000,
    '1d': 86400000, '3d': 259200000, '1w': 604800000, '1M': 2592000000,
  };

  var PAIR_NAMES = { 'BTCUSDT': 'BTC/USDT', 'ETHUSDT': 'ETH/USDT' };
  function getPairName(s) { return PAIR_NAMES[s] || s; }

  // ── INDICATOR CALCULATIONS ──

  function calcSMA(candles, period) {
    var result = [], sum = 0;
    for (var i = 0; i < candles.length; i++) {
      sum += candles[i].close;
      if (i >= period) sum -= candles[i - period].close;
      if (i >= period - 1) result.push({ time: candles[i].time, value: sum / period });
    }
    return result;
  }

  function calcEMA(candles, period) {
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

  function calcBollinger(candles, period) {
    var smaData = calcSMA(candles, period);
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

  function calcRSI(candles, period) {
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
    // First RSI starts at index 'period' in gains/losses (candle index = period)
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

    // SMA
    if (s.sma.active && candles.length >= s.sma.period) {
      var smaData = calcSMA(candles, s.sma.period);
      indicatorSeries.sma = chart.addLineSeries({
        color: s.sma.color, lineWidth: 1.5, priceLineVisible: false,
        lastValueVisible: true, crosshairMarkerVisible: false,
        title: 'SMA ' + s.sma.period,
      });
      indicatorSeries.sma.setData(smaData);
    }

    // EMA
    if (s.ema.active && candles.length >= s.ema.period) {
      var emaData = calcEMA(candles, s.ema.period);
      indicatorSeries.ema = chart.addLineSeries({
        color: s.ema.color, lineWidth: 1.5, priceLineVisible: false,
        lastValueVisible: true, crosshairMarkerVisible: false,
        title: 'EMA ' + s.ema.period,
      });
      indicatorSeries.ema.setData(emaData);
    }

    // Bollinger Bands
    if (s.boll.active && candles.length >= s.boll.period) {
      var bollData = calcBollinger(candles, s.boll.period);
      indicatorSeries.bollMid = chart.addLineSeries({
        color: s.boll.color, lineWidth: 1, priceLineVisible: false,
        lastValueVisible: true, crosshairMarkerVisible: false,
        title: 'BB ' + s.boll.period,
      });
      indicatorSeries.bollUpper = chart.addLineSeries({
        color: s.boll.color, lineWidth: 1, priceLineVisible: false,
        lastValueVisible: false, crosshairMarkerVisible: false,
        lineStyle: 2, // dashed
      });
      indicatorSeries.bollLower = chart.addLineSeries({
        color: s.boll.color, lineWidth: 1, priceLineVisible: false,
        lastValueVisible: false, crosshairMarkerVisible: false,
        lineStyle: 2,
      });
      indicatorSeries.bollMid.setData(bollData.map(function (d) { return { time: d.time, value: d.middle }; }));
      indicatorSeries.bollUpper.setData(bollData.map(function (d) { return { time: d.time, value: d.upper }; }));
      indicatorSeries.bollLower.setData(bollData.map(function (d) { return { time: d.time, value: d.lower }; }));
    }

    // RSI (separate pane)
    if (s.rsi.active && candles.length >= s.rsi.period + 1) {
      try {
        rsiSeries = chart.addLineSeries({
          color: s.rsi.color, lineWidth: 1.5, priceLineVisible: false,
          lastValueVisible: true, crosshairMarkerVisible: false,
          priceScaleId: rsiPaneId,
          title: 'RSI ' + s.rsi.period,
        });
        chart.priceScale(rsiPaneId).applyOptions({
          scaleMargins: { top: 0.7, bottom: 0 },
          visible: true,
        });
        var rsiData = calcRSI(candles, s.rsi.period);
        rsiSeries.setData(rsiData);
      } catch(e) {
        console.error('[chart] RSI pane error:', e);
      }
    }
  }

  // ── WEBSOCKET ──

  function _connectWs() {
    if (ws && ws.readyState === WebSocket.CONNECTING) return;
    if (ws) { _wsIntentionalClose = true; try { ws.close(); } catch(e) {} _wsIntentionalClose = false; }
    var stream = currentSymbol.toLowerCase() + '@kline_' + currentInterval;
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
          lastPrice = candle.close;
          var priceEl = document.getElementById('chartPrice');
          if (priceEl) priceEl.textContent = '$' + candle.close.toLocaleString('fr-FR', { minimumFractionDigits: 2 });
          lastCandleTime = k.t;
          if (k.x) { _fetchAndRender(true); return; }
          if (candlestickSeries) {
            try {
              if (chartStyle === 'candlestick') {
                candlestickSeries.update(candle);
              } else {
                candlestickSeries.update({ time: candle.time, value: candle.close });
              }
            } catch(e) {}
            if (volumeSeries) {
              try { volumeSeries.update({ time: candle.time, value: candle.volume, color: candle.close >= candle.open ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)' }); } catch(e) {}
            }
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
    } catch(e) { console.error('[chart] ws:', e); }
  }

  function _disconnectWs() {
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    if (ws) {
      if (ws.readyState === WebSocket.CONNECTING) { ws = null; return; }
      _wsIntentionalClose = true; try { ws.close(); } catch(e) {} ws = null; _wsIntentionalClose = false;
    }
  }

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

  function _loadLibrary(cb) {
    if (typeof window.LightweightCharts !== 'undefined') { cb(); return; }
    var urls = [
      'https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js',
      'https://cdn.jsdelivr.net/npm/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js',
    ];
    function tryCdn(idx) {
      if (idx >= urls.length) { console.error('[chart] CDN indisponible'); return; }
      var s = document.createElement('script');
      s.src = urls[idx];
      s.onload = cb;
      s.onerror = function () { tryCdn(idx + 1); };
      document.head.appendChild(s);
    }
    tryCdn(0);
  }

  function initChartPage() {
    var container = document.getElementById('chartCanvas');
    if (!container) return;
    if (chart) {
      // Nettoyer avant refresh : WebSocket, timers, drawings
      _disconnectWs();
      if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
      if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
      _fetchAndRender(true);
      return;
    }

    _loadLibrary(function () {
      _createChart(container);
      _fetchAndRender();
    });
  }

  function _createChart(container) {
    if (chart) return;
    var wrap = document.getElementById('chartCanvasWrap');
    if (!wrap) return;

    var isLight = document.body.classList.contains('light-mode');
    var w = container.clientWidth || wrap.clientWidth || 900;
    var h = container.clientHeight || wrap.clientHeight || 500;

    try {
      chart = window.LightweightCharts.createChart(container, {
        width: w,
        height: h,
        layout: {
          background: { type: 'solid', color: 'transparent' },
          textColor: isLight ? '#1e293b' : '#9ca3af',
          fontSize: 11,
        },
        grid: {
          vertLines: { color: 'transparent' },
          horzLines: { color: 'transparent' },
        },
        crosshair: { mode: 0 },
        rightPriceScale: {
          borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)',
          borderVisible: false,
        },
        timeScale: {
          borderColor: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)',
          timeVisible: true,
          secondsVisible: false,
          borderVisible: false,
        },
        handleScroll: { vertTouchDrag: true, horzTouchDrag: true, pressedMouseMove: true },
      });

      // Candlestick series
      var seriesOpts = {
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderDownColor: '#ef4444',
        borderUpColor: '#22c55e',
        wickDownColor: '#ef4444',
        wickUpColor: '#22c55e',
        lastValueVisible: false,
        priceLineVisible: false,
      };

      // Handle chart style
      if (chartStyle === 'line') {
        candlestickSeries = chart.addLineSeries({
          color: '#22c55e',
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
        });
      } else if (chartStyle === 'area') {
        candlestickSeries = chart.addAreaSeries({
          lineColor: '#22c55e',
          topColor: 'rgba(34,197,94,0.3)',
          bottomColor: 'rgba(34,197,94,0.02)',
          lineWidth: 2,
          lastValueVisible: false,
          priceLineVisible: false,
        });
      } else {
        candlestickSeries = chart.addCandlestickSeries(seriesOpts);
      }

      // Price line + countdown
      countdownPriceLine = candlestickSeries.createPriceLine({
        price: 0,
        color: '#22c55e',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: '—',
      });

      // Volume
      volumeSeries = chart.addHistogramSeries({
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.85, bottom: 0 },
      });

      // Resize
      if (resizeObserver) resizeObserver.disconnect();
      resizeObserver = new ResizeObserver(function () {
        if (chart && wrap) {
          var cw = container.clientWidth || wrap.clientWidth;
          var ch = container.clientHeight || wrap.clientHeight;
          if (cw > 0 && ch > 0) chart.applyOptions({ width: cw, height: ch });
          if (window.ChartDrawings && window.ChartDrawings.onResize) {
            window.ChartDrawings.onResize();
          }
        }
      });
      resizeObserver.observe(wrap);

      // ── BIND UI EVENTS ──

      _bindVpDropdown();
      _bindVwap();
      _bindTimeframes();
      _bindPairs();
      _bindSettingsPanel();

      // ── DRAWING TOOLS ──
      _initDrawingTools();

      // ── VOLUME PROFILE ──
      _initVolumeProfile();

    } catch (e) {
      console.error('[chart] createChart error:', e);
    }
  }

  // ── DRAWING TOOLS ──

  function _initDrawingTools() {
    var wrap = document.getElementById('chartCanvasWrap');
    if (!wrap || !window.ChartDrawings) return;

    // Create toolbar buttons
    var toolbar = document.getElementById('drawToolbar');
    if (!toolbar) return;

    var tools = window.ChartDrawings.tools;
    toolbar.innerHTML = '';
    tools.forEach(function (t) {
      var btn = document.createElement('button');
      btn.type = 'button';
      if (t.id === 'cursor') {
        // Cursor = toggle snap: 🧲 = snap actif (OHLC), ⊹ = curseur libre
        btn.className = 'draw-toolbar-btn is-active' + (!window.ChartDrawings.getSnapEnabled() ? ' draw-snap-on' : '');
        btn.dataset.tool = 'cursor';
        btn.dataset.label = !window.ChartDrawings.getSnapEnabled() ? 'Snap ON' : 'Curseur';
        btn.textContent = !window.ChartDrawings.getSnapEnabled() ? '🧲' : '⊹';
        btn.addEventListener('click', function () {
          var snapOn = !window.ChartDrawings.getSnapEnabled();
          window.ChartDrawings.setSnapEnabled(snapOn);
          btn.textContent = !snapOn ? '🧲' : '⊹';
          btn.dataset.label = !snapOn ? 'Snap ON' : 'Curseur';
          btn.classList.toggle('draw-snap-on', !snapOn);
          // Sync LWC crosshair mode avec snap
          try { chart.applyOptions({ crosshair: { mode: snapOn ? 0 : 1 } }); } catch(e) {}
          // Toujours passer en mode curseur
          toolbar.querySelectorAll('.draw-toolbar-btn').forEach(function (b) { b.classList.remove('is-active'); });
          btn.classList.add('is-active');
          window.ChartDrawings.setTool('cursor');
        });
      } else {
        btn.className = 'draw-toolbar-btn';
        btn.dataset.tool = t.id;
        btn.dataset.label = t.label;
        btn.textContent = t.icon;
        btn.addEventListener('click', function () {
          toolbar.querySelectorAll('.draw-toolbar-btn').forEach(function (b) { b.classList.remove('is-active'); });
          btn.classList.add('is-active');
          window.ChartDrawings.setTool(t.id);
        });
      }
      toolbar.appendChild(btn);
    });

    // Clear button
    var clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'draw-toolbar-btn draw-clear';
    clearBtn.dataset.label = 'Tout effacer';
    clearBtn.textContent = '✕';
    clearBtn.addEventListener('click', function () {
      if (confirm('Effacer tous les dessins ?')) {
        window.ChartDrawings.clearAll();
      }
    });
    toolbar.appendChild(clearBtn);

    // Init drawing engine
    var isLight = document.body.classList.contains('light-mode');
    window.ChartDrawings.init(chart, candlestickSeries, wrap, isLight);
  }

  // ── VOLUME PROFILE ──

  function _initVolumeProfile() {
    var wrap = document.getElementById('chartCanvasWrap');
    if (!wrap || !window.VolumeProfile) return;
    window.VolumeProfile.init(chart, candlestickSeries, wrap);
  }

  // ── VWAP ──

  function _bindVpDropdown() {
    var toggle = document.getElementById('vpToggle');
    var dropdown = document.getElementById('vpDropdown');
    if (!toggle || !dropdown) return;
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      dropdown.classList.toggle('hidden');
      var panel = document.getElementById('chartSettingsPanel');
      if (panel) panel.classList.add('hidden');
      var vwap = document.getElementById('vwapDropdown');
      if (vwap) vwap.classList.add('hidden');
      // Sync UI from VP state
      if (!dropdown.classList.contains('hidden')) {
        var s = window.VolumeProfile ? window.VolumeProfile.getSettings() : null;
        if (s) {
          document.getElementById('vpActive').checked = !!s.active;
          toggle.classList.toggle('active', !!s.active);
          document.getElementById('vpBucketSize').value = s.bucketSize;
          document.getElementById('vpPeriod').value = s.period;
          document.getElementById('vpVaPercent').value = s.vaPercent;
          document.getElementById('vpShowPOC').checked = !!s.showPOC;
          document.getElementById('vpShowVAH').checked = !!s.showVAH;
          document.getElementById('vpShowVAL').checked = !!s.showVAL;
          if (document.getElementById('vpColorPOC')) document.getElementById('vpColorPOC').value = s.colorPOC;
          if (document.getElementById('vpColorVAH')) document.getElementById('vpColorVAH').value = s.colorVAH;
          if (document.getElementById('vpColorVAL')) document.getElementById('vpColorVAL').value = s.colorVAL;
          if (document.getElementById('vpColorHvn')) document.getElementById('vpColorHvn').value = s.colorHvn;
        }
      }
    });
    document.addEventListener('click', function (e) {
      if (!dropdown.contains(e.target) && e.target !== toggle) dropdown.classList.add('hidden');
    }, false);
    // Apply on change
    dropdown.addEventListener('change', function () {
      _readVpSettingsFromUI();
      // Sync toggle active state
      var active = document.getElementById('vpActive');
      toggle.classList.toggle('active', active && active.checked);
    });
    // Init toggle state from saved settings
    setTimeout(function () {
      var s = window.VolumeProfile ? window.VolumeProfile.getSettings() : null;
      if (s) toggle.classList.toggle('active', !!s.active);
    }, 100);
  }

  function _bindVwap() {
    var vwapToggle = document.getElementById('vwapToggle');
    var vwapDropdown = document.getElementById('vwapDropdown');
    if (!vwapToggle || !vwapDropdown) return;

    vwapToggle.addEventListener('click', function (e) {
      e.stopPropagation();
      vwapDropdown.classList.toggle('hidden');
      // Close settings if open
      var panel = document.getElementById('chartSettingsPanel');
      if (panel) panel.classList.add('hidden');
    });
    document.addEventListener('click', function () { vwapDropdown.classList.add('hidden'); }, false);
    vwapDropdown.querySelectorAll('.chart-ind-opt').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var period = btn.dataset.vwap;
        btn.classList.toggle('active');
        var idx = activeVwapPeriods.indexOf(period);
        if (idx >= 0) { activeVwapPeriods.splice(idx, 1); }
        else { activeVwapPeriods.push(period); }
        vwapToggle.classList.toggle('active', activeVwapPeriods.length > 0);
        try { localStorage.setItem('chartVwapPeriods', JSON.stringify(activeVwapPeriods)); } catch(e) {}
        vwapDropdown.classList.add('hidden');
        _fetchAndRender(true);
      });
    });
    // Restaurer l'etat des boutons depuis activeVwapPeriods
    vwapDropdown.querySelectorAll('.chart-ind-opt').forEach(function (btn) {
      if (activeVwapPeriods.indexOf(btn.dataset.vwap) >= 0) btn.classList.add('active');
    });
    if (activeVwapPeriods.length > 0) vwapToggle.classList.add('active');
  }

  var VWAP_COLORS = { '1D': '#f59e0b', '7D': '#06b6d4', '30D': '#a78bfa', '90D': '#f472b6' };
  var VWAP_INTERVALS = { '1D': '1h', '7D': '1h', '30D': '4h', '90D': '1d' };
  var VWAP_DAYS = { '1D': 1, '7D': 7, '30D': 30, '90D': 90 };
  var INTERVAL_MINUTES = { '1m':1,'3m':3,'5m':5,'15m':15,'30m':30,'1h':60,'2h':120,'4h':240,'6h':360,'8h':480,'12h':720,'1d':1440,'3d':4320,'1w':10080,'1M':43200 };

  function _removeVwapSeries(key) {
    var s = vwapSeriesMap[key];
    if (s) { try { chart.removeSeries(s); } catch(e) {} delete vwapSeriesMap[key]; }
  }

  function _calcAndDrawVwap() {
    // Supprimer les series VWAP pour les periodes desactivees
    Object.keys(vwapSeriesMap).forEach(function (k) {
      if (activeVwapPeriods.indexOf(k) < 0) _removeVwapSeries(k);
    });
    if (!activeVwapPeriods.length) return;

    var _savedRange = null, _savedLogical = null;
    try { _savedRange = chart.timeScale().getVisibleRange(); } catch(e) {}
    try { _savedLogical = chart.timeScale().getVisibleLogicalRange(); } catch(e) {}

    activeVwapPeriods.forEach(function (period) {
      var days = VWAP_DAYS[period] || 1;
      var fetchInterval = VWAP_INTERVALS[period] || '1h';
      var color = VWAP_COLORS[period] || '#f59e0b';
      var label = 'VWAP ' + period + ' (' + fetchInterval + ')';

      // Helper: compute cumulative VWAP from candles
      function _computeVwap(candleArray, callback) {
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
        if (!vwapData.length) { _removeVwapSeries(period); callback(); return; }
        if (!vwapSeriesMap[period]) {
          vwapSeriesMap[period] = chart.addLineSeries({
            color: color, lineWidth: 1.5, priceLineVisible: false,
            lastValueVisible: true, crosshairMarkerVisible: false,
            title: label,
          });
        }
        var _lv = vwapData[vwapData.length - 1];
        if (_lv) vwapData.push({ time: Math.floor(Date.now() / 1000), value: _lv.value });
        vwapSeriesMap[period].setData(vwapData);
        callback();
      }

      // 1D et 7D : utiliser les bougies du chart (temps reel, fluide)
      if ((period === '1D' || period === '7D') && _lastCandles && _lastCandles.length) {
        _computeVwap(_lastCandles, function () {});
        return;
      }

      // 30D et 90D : fetch au bon intervalle
      var minPerCandle = INTERVAL_MINUTES[fetchInterval] || 60;
      var needed = Math.max(Math.ceil(days * 1440 / minPerCandle) + 10, 100);
      var url = '/api/market/klines?symbol=' + currentSymbol + '&interval=' + fetchInterval + '&limit=' + needed;
      fetch(url)
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data.error || !data.candles || !data.candles.length) {
            _removeVwapSeries(period);
            return;
          }
          _computeVwap(data.candles, function () {});
        })
        .catch(function () { _removeVwapSeries(period); });
    });

    // Restaurer le range visible
    if (_savedLogical) { try { chart.timeScale().setVisibleLogicalRange(_savedLogical); } catch(e) {} }
    else if (_savedRange) { try { chart.timeScale().setVisibleRange(_savedRange); } catch(e) {} }
  }

  // ── TIMEFRAMES ──

  function _bindTimeframes() {
    var btns = document.querySelectorAll('.chart-tf-btn');
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        btns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentInterval = btn.dataset.interval;
        _disconnectWs();
        _fetchAndRender();
      });
    });
    // Activer le bon bouton
    btns.forEach(function (b) {
      if (b.dataset.interval === currentInterval) b.classList.add('active');
    });
  }

  // ── PAIRS ──

  function _bindPairs() {
    document.querySelectorAll('.chart-pair-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.chart-pair-btn').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentSymbol = btn.dataset.symbol;
        _disconnectWs();
        _fetchAndRender();
      });
    });
  }

  // ── SETTINGS PANEL ──

  function _bindSettingsPanel() {
    var btn = document.getElementById('chartSettingsBtn');
    var panel = document.getElementById('chartSettingsPanel');
    var close = document.getElementById('chartSettingsClose');
    var save = document.getElementById('chartSettingsSave');
    var reset = document.getElementById('chartSettingsReset');
    if (!btn || !panel) return;

    // Open / close
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      panel.classList.toggle('hidden');
      // Close VWAP if open
      var vwap = document.getElementById('vwapDropdown');
      if (vwap) vwap.classList.add('hidden');
      if (!panel.classList.contains('hidden')) {
        _syncSettingsUI();
      }
    });

    if (close) {
      close.addEventListener('click', function () { panel.classList.add('hidden'); });
    }

    document.addEventListener('click', function (e) {
      if (!panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
        panel.classList.add('hidden');
      }
    });

    // Sync UI from state
    function _syncSettingsUI() {
      var s = indSettings;
      _setChecked('indSmaActive', s.sma.active);
      _setVal('indSmaPeriod', s.sma.period);
      _setColor('indSmaColor', s.sma.color);
      _setChecked('indEmaActive', s.ema.active);
      _setVal('indEmaPeriod', s.ema.period);
      _setColor('indEmaColor', s.ema.color);
      _setChecked('indBollActive', s.boll.active);
      _setVal('indBollPeriod', s.boll.period);
      _setColor('indBollColor', s.boll.color);
      _setChecked('indRsiActive', s.rsi.active);
      _setVal('indRsiPeriod', s.rsi.period);
      _setColor('indRsiColor', s.rsi.color);
      _setVal('chartDefInterval', currentInterval);
      _setVal('chartDefSymbol', currentSymbol);
      _setVal('chartDefStyle', chartStyle);
      _renderSessionControls();
    }

    // Render session zone controls dynamically
    function _renderSessionControls() {
      var container = document.getElementById('chartSessionControls');
      if (!container || !window.ChartDrawings) return;
      var sessions = window.ChartDrawings.getSessionSettings();
      if (!sessions || !sessions.length) return;

      container.innerHTML = '';
      sessions.forEach(function (sess) {
        var row = document.createElement('div');
        row.className = 'chart-settings-row';
        row.innerHTML =
          '<div class="chart-settings-label">' +
            '<span class="chart-session-dot" style="background:' + sess.color + '"></span> ' +
            '<span>' + sess.name + '</span>' +
            '<span class="chart-session-hours">' + sess.startHour + 'h–' + sess.endHour + 'h UTC</span>' +
          '</div>' +
          '<div class="chart-settings-controls">' +
            '<input type="color" class="chart-settings-color chart-session-color" data-sess-id="' + sess.id + '" value="' + sess.color + '">' +
            '<label class="chart-toggle">' +
              '<input type="checkbox" class="chart-session-active" data-sess-id="' + sess.id + '"' + (sess.active ? ' checked' : '') + '>' +
              '<span class="chart-toggle-track"><span class="chart-toggle-thumb"></span></span>' +
            '</label>' +
          '</div>';
        container.appendChild(row);
      });
    }

    // Read session settings from UI and push to drawing engine
    function _readSessionSettingsFromUI() {
      if (!window.ChartDrawings) return;
      var sessions = window.ChartDrawings.getSessionSettings();
      if (!sessions || !sessions.length) return;

      sessions.forEach(function (sess) {
        var cb = document.querySelector('.chart-session-active[data-sess-id="' + sess.id + '"]');
        if (cb) sess.active = cb.checked;
        var colorInput = document.querySelector('.chart-session-color[data-sess-id="' + sess.id + '"]');
        if (colorInput) sess.color = colorInput.value;
      });

      window.ChartDrawings.updateSessions(sessions);
    }

    function _setChecked(id, val) {
      var el = document.getElementById(id);
      if (el) el.checked = !!val;
    }
    function _setVal(id, val) {
      var el = document.getElementById(id);
      if (el) el.value = val;
    }
    function _setColor(id, val) {
      var el = document.getElementById(id);
      if (el) el.value = val;
    }

    // Save
    if (save) {
      save.addEventListener('click', function () {
        _readSettingsFromUI();
        _readSessionSettingsFromUI();
        _saveSettings();
        _applySettings();
        panel.classList.add('hidden');
        toast('Paramètres du chart sauvegardés', 'success');
      });
    }

    // Reset
    if (reset) {
      reset.addEventListener('click', function () {
        localStorage.removeItem('chartIndSettings');
        localStorage.removeItem('chartDefInterval');
        localStorage.removeItem('chartDefSymbol');
        localStorage.removeItem('chartDefStyle');
        localStorage.removeItem('chartSessionSettings');
        indSettings = {
          sma: { active: false, period: 20, color: '#f59e0b' },
          ema: { active: false, period: 20, color: '#06b6d4' },
          boll: { active: false, period: 20, color: '#a78bfa' },
          rsi: { active: false, period: 14, color: '#f472b6' },
        };
        currentInterval = '3m';
        currentSymbol = 'BTCUSDT';
        chartStyle = 'candlestick';
        _syncSettingsUI();
        _applySettings();
        // Reset sessions to defaults
        if (window.ChartDrawings) {
          var defaultSess = [
            { id: 'asian', name: 'Asie', startHour: 0, endHour: 8, color: '#ffdd00', active: true, opacity: 0.12 },
            { id: 'london', name: 'Londres', startHour: 8, endHour: 16, color: '#0066ff', active: true, opacity: 0.12 },
            { id: 'newyork', name: 'New York', startHour: 13, endHour: 22, color: '#ff0066', active: true, opacity: 0.12 },
          ];
          window.ChartDrawings.updateSessions(defaultSess);
        }
        // Reset VP
        localStorage.removeItem('chartVolumeProfileSettings');
        if (window.VolumeProfile) {
          window.VolumeProfile.init(chart, candlestickSeries, document.getElementById('chartCanvasWrap'));
        }
        panel.classList.add('hidden');
        toast('Paramètres réinitialisés', 'info');
      });
    }
  }

  function _readSettingsFromUI() {
    function _gv(id) {
      var el = document.getElementById(id);
      return el ? el.value : null;
    }
    function _gc(id) {
      var el = document.getElementById(id);
      return el ? el.checked : false;
    }

    indSettings.sma.active = _gc('indSmaActive');
    indSettings.sma.period = parseInt(_gv('indSmaPeriod')) || 20;
    indSettings.sma.color = _gv('indSmaColor') || '#f59e0b';
    indSettings.ema.active = _gc('indEmaActive');
    indSettings.ema.period = parseInt(_gv('indEmaPeriod')) || 20;
    indSettings.ema.color = _gv('indEmaColor') || '#06b6d4';
    indSettings.boll.active = _gc('indBollActive');
    indSettings.boll.period = parseInt(_gv('indBollPeriod')) || 20;
    indSettings.boll.color = _gv('indBollColor') || '#a78bfa';
    indSettings.rsi.active = _gc('indRsiActive');
    indSettings.rsi.period = parseInt(_gv('indRsiPeriod')) || 14;
    indSettings.rsi.color = _gv('indRsiColor') || '#f472b6';
    currentInterval = _gv('chartDefInterval') || currentInterval;
    currentSymbol = _gv('chartDefSymbol') || currentSymbol;
    chartStyle = _gv('chartDefStyle') || chartStyle;
  }

  function _readVpSettingsFromUI() {
    if (!window.VolumeProfile) return;
    var s = {};
    function gc(id) { var el = document.getElementById(id); return el ? el.checked : false; }
    function gv(id) { var el = document.getElementById(id); return el ? el.value : null; }
    s.active = gc('vpActive');
    s.bucketSize = parseInt(gv('vpBucketSize')) || 10;
    s.period = gv('vpPeriod') || 'visible';
    s.vaPercent = parseInt(gv('vpVaPercent')) || 70;
    s.showPOC = gc('vpShowPOC');
    s.showVAH = gc('vpShowVAH');
    s.showVAL = gc('vpShowVAL');
    s.colorPOC = gv('vpColorPOC') || '#f59e0b';
    s.colorVAH = gv('vpColorVAH') || '#22c55e';
    s.colorVAL = gv('vpColorVAL') || '#ef4444';
    s.colorHvn = gv('vpColorHvn') || '#06b6d4';
    window.VolumeProfile.updateSettings(s);
  }

  function _syncVpSettingsUI() {
    if (!window.VolumeProfile) return;
    var s = window.VolumeProfile.getSettings();
    function sc(id, val) { var el = document.getElementById(id); if (el) el.checked = !!val; }
    function sv(id, val) { var el = document.getElementById(id); if (el) el.value = val; }
    sc('vpActive', s.active);
    sv('vpBucketSize', s.bucketSize);
    sv('vpPeriod', s.period);
    sv('vpVaPercent', s.vaPercent);
    sc('vpShowPOC', s.showPOC);
    sc('vpShowVAH', s.showVAH);
    sc('vpShowVAL', s.showVAL);
    sv('vpColorPOC', s.colorPOC);
    sv('vpColorVAH', s.colorVAH);
    sv('vpColorVAL', s.colorVAL);
    sv('vpColorHvn', s.colorHvn);
  }

  function _saveSettings() {
    try {
      localStorage.setItem('chartIndSettings', JSON.stringify({
        sma: { active: indSettings.sma.active, period: indSettings.sma.period, color: indSettings.sma.color },
        ema: { active: indSettings.ema.active, period: indSettings.ema.period, color: indSettings.ema.color },
        boll: { active: indSettings.boll.active, period: indSettings.boll.period, color: indSettings.boll.color },
        rsi: { active: indSettings.rsi.active, period: indSettings.rsi.period, color: indSettings.rsi.color },
      }));
      localStorage.setItem('chartDefInterval', currentInterval);
      localStorage.setItem('chartDefSymbol', currentSymbol);
      localStorage.setItem('chartDefStyle', chartStyle);
      localStorage.setItem('chartVwapPeriods', JSON.stringify(activeVwapPeriods));
    } catch(e) {}
  }

  function _applySettings() {
    // Rebuild chart with new style if needed
    // For indicators, just re-render with current data
    if (chart) _fetchAndRender(true);
  }

  // ── FETCH & RENDER ──

  function _fetchAndRender(keepZoom) {
    if (!candlestickSeries) return;

    // Sauvegarder le zoom utilisateur avant refresh (en temps ET en logique)
    var savedRange = null;
    var savedLogical = null;
    if (keepZoom && chart && chart.timeScale()) {
      try { savedRange = chart.timeScale().getVisibleRange(); } catch(e) {}
      try { savedLogical = chart.timeScale().getVisibleLogicalRange(); } catch(e) {}
      // Freeze price scale BEFORE setData to prevent auto-jump on new candles
      try { chart.priceScale('right').applyOptions({ autoScale: false }); } catch(e) {}
    }

    var url = '/api/market/klines?symbol=' + currentSymbol + '&interval=' + currentInterval + '&limit=500';
    fetch(url)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        if (data.error) { console.error('[chart]', data.error); toast(data.error, 'error'); return; }
        var candles = data.candles || [];
        if (!candles.length) return;
        _lastCandles = candles;

        var last = candles[candles.length - 1];
        lastCandleTime = last.time * 1000;
        lastPrice = last.close;
        _startCountdown();
        _startAutoRefresh();
        _disconnectWs();
        _connectWs();
        _updateStats(candles);

        candlestickSeries.setData(chartStyle === 'candlestick' ? candles : candles.map(function (c) { return { time: c.time, value: c.close }; }));

        // VWAP
        _calcAndDrawVwap();

        // Volume Profile (passe les bougies pour recalcul)
        if (window.VolumeProfile) {
          window.VolumeProfile.setCandles(candles);
        }

        // Indicators
        _renderIndicators(candles);

        // Price line
        if (countdownPriceLine) {
          try { countdownPriceLine.applyOptions({ price: last.close }); } catch(e) {}
        }
        _updateCountdownLabel();

        volumeSeries.setData(candles.map(function (c) {
          return { time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)' };
        }));

        if (!keepZoom) {
          // Show last ~80 candles instead of ALL data (fitContent zooms too far out)
          var total = candles.length;
          var to = total;
          var from = Math.max(0, total - 80);
          try { chart.timeScale().setVisibleLogicalRange({ from: from, to: to }); } catch(e) { chart.timeScale().fitContent(); }
          // Unlock vertical scroll by disabling autoScale AFTER data is visible
          setTimeout(function() {
            try { chart.priceScale('right').applyOptions({ autoScale: false }); } catch(e) {}
          }, 50);
        }

        // Restaurer le zoom utilisateur apres setData (logique d'abord, temps en fallback)
        if (keepZoom) {
          // Le logical range est plus stable que le time range car base sur l'index
          if (savedLogical) {
            try { chart.timeScale().setVisibleLogicalRange(savedLogical); } catch(e) {}
          } else if (savedRange) {
            try { chart.timeScale().setVisibleRange(savedRange); } catch(e) {}
          }
          // Keep price scale unlocked for vertical scroll
          try { chart.priceScale('right').applyOptions({ autoScale: false }); } catch(e) {}
        }
      })
      .catch(function (err) { console.error('[chart] fetch error:', err); });
  }

  function _updateStats(candles) {
    if (!candles.length) return;
    var last = candles[candles.length - 1];
    var first = candles[0];
    var change = last.close - first.close;
    var changePct = (change / first.close) * 100;

    var priceEl = document.getElementById('chartPrice');
    if (priceEl) priceEl.textContent = '$' + Number(last.close).toLocaleString('fr-FR', { minimumFractionDigits: 2 });

    var changeEl = document.getElementById('chartChange');
    if (changeEl) {
      var sign = change >= 0 ? '+' : '';
      changeEl.textContent = sign + change.toFixed(2) + ' (' + sign + changePct.toFixed(2) + '%)';
      changeEl.style.color = change >= 0 ? 'var(--win)' : 'var(--loss)';
    }

    var setStat = function (id, val) {
      var el = document.getElementById(id);
      if (el) el.textContent = val != null ? Number(val).toLocaleString('fr-FR', { minimumFractionDigits: 2 }) : '—';
    };
    setStat('chartOpen', last.open);
    setStat('chartHigh', last.high);
    setStat('chartLow', last.low);
    setStat('chartClose', last.close);
    setStat('chartVol', last.volume);
  }

  // ── COUNTDOWN ──
  function _startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    setTimeout(function () {
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
      var txt = m + ':' + (s < 10 ? '0' : '') + s;
      _updateCountdownLabel(txt);
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

  // ── AUTO REFRESH ──

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

  // ── INIT ──

  // Polling robuste : attend que #chartCanvas soit dans le DOM avant de lancer le callback
  // maxRetries × interval ms (par défaut 20 × 50ms = 1s max)
  function _waitForContainer(callback, maxRetries, interval) {
    maxRetries = maxRetries || 20;
    interval = interval || 50;
    var retries = 0;
    function poll() {
      if (document.getElementById('chartCanvas')) {
        callback();
        return;
      }
      retries++;
      if (retries >= maxRetries) {
        console.warn('[chart] #chartCanvas introuvable apres ' + (maxRetries * interval) + 'ms');
        return;
      }
      setTimeout(poll, interval);
    }
    poll();
  }

  function _tryInit() {
    if (document.querySelector('.page[data-page="chart"].active')) {
      _waitForContainer(initChartPage);
    }
  }

  document.addEventListener('DOMContentLoaded', function () { setTimeout(_tryInit, 50); });

  // Hook dans goPage existante
  var _origGoPage = window.goPage;
  if (_origGoPage) {
    window.goPage = function (pageName) {
      _origGoPage(pageName);
      if (pageName === 'chart') {
        _waitForContainer(function () {
          initChartPage();
          _waitForContainer(function () {
            if (chart) {
              var wrap = document.getElementById('chartCanvasWrap');
              if (wrap) chart.applyOptions({ width: wrap.clientWidth, height: wrap.clientHeight });
            }
          }, 10, 100);
        });
      }
    };
  }

  window.initChartPage = initChartPage;
})();
