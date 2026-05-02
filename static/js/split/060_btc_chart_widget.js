// ---------- BTC Chart widget — TradingView Lightweight Charts ----------

(function () {
  var chart = null;
  var series = null;
  var currentInterval = '3m';
  var resizeObserver = null;
  var chartReady = false;
  var countdownTimer = null;
  var lastCandleTime = 0;

  // Intervalle en ms pour le countdown
  var INTERVAL_MS = {
    '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000,
    '30m': 1800000, '1h': 3600000, '2h': 7200000, '4h': 14400000,
    '6h': 21600000, '8h': 28800000, '12h': 43200000,
    '1d': 86400000, '3d': 259200000, '1w': 604800000, '1M': 2592000000,
  };

  function _getIntervalMs(interval) {
    var m = INTERVAL_MS[interval];
    if (m) return m;
    // Custom: parser 5m, 2h, 3d etc.
    var match = interval.match(/^(\d+)(m|h|d|w|M)$/);
    if (!match) return 3600000;
    var num = parseInt(match[1], 10);
    var unit = match[2];
    var mult = { m: 60000, h: 3600000, d: 86400000, w: 604800000, M: 2592000000 };
    return num * (mult[unit] || 3600000);
  }

  function _startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    var el = document.getElementById('btcChartCountdown');
    if (!el) return;

    function tick() {
      if (!lastCandleTime) { el.textContent = ''; return; }
      var now = Date.now();
      var ms = _getIntervalMs(currentInterval);
      var elapsed = now - lastCandleTime;
      var remaining = ms - elapsed;
      if (remaining <= 0) {
        el.textContent = '0:00';
        // Nouvelle bougie → refresh auto
        _fetchAndRender();
        return;
      }
      var totalSec = Math.ceil(remaining / 1000);
      var m = Math.floor(totalSec / 60);
      var s = totalSec % 60;
      el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
    }

    tick();
    countdownTimer = setInterval(tick, 500);
  }

  // Auto-refresh periodique : toutes les 15s (petits TF) a 60s (grands TF)
  var refreshTimer = null;
  var currentSymbol = 'btcusdt';
  var ws = null;
  var wsReconnectTimer = null;
  var _wsIntentionalClose = false;

  function _connectWs() {
    // Ne pas fermer une connexion en cours d'etablissement
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
    // Rafraichir toutes les 15s pour les TF < 1h, 30s pour 1-4h, 60s pour > 4h
    var interval = ms < 3600000 ? 15000 : ms < 14400000 ? 30000 : 60000;
    refreshTimer = setInterval(function () {
      // Ne pas refresh si le countdown est en train de le faire
      if (!lastCandleTime) return;
      var now = Date.now();
      var elapsed = now - lastCandleTime;
      if (elapsed < _getIntervalMs(currentInterval) * 0.95) {
        _fetchAndRender(true);
      }
    }, interval);
  }

  function initBtcChart() {
    var container = document.getElementById('btcChartContainer');
    if (!container) {
      // Le widget n'est pas encore dans le DOM — reessayer plus tard
      if (document.querySelector('.page[data-page="today"].active')) {
        setTimeout(initBtcChart, 300);
      }
      return;
    }
    if (chartReady) return;

    // S'assurer que le container a une hauteur
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

    // Essayer plusieurs CDN
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
        },
        timeScale: {
          borderColor: isLight ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.08)',
          timeVisible: true,
          secondsVisible: false,
        },
        handleScroll: { vertTouchDrag: false },
      });

      series = chart.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderDownColor: '#ef4444',
        borderUpColor: '#22c55e',
        wickDownColor: '#ef4444',
        wickUpColor: '#22c55e',
      });

      // Resize observer
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
          // Vider le champ custom
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
          // Valider le format (chiffres + une lettre: m/h/d/w/M)
          if (!/^\d+(m|h|d|w|M)$/.test(val)) {
            this.value = '';
            return;
          }
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
    var url = '/api/market/klines?symbol=BTCUSDT&interval=' + currentInterval + '&limit=200';
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
        if (!keepZoom) chart.timeScale().fitContent();
      })
      .catch(function (err) { console.error('[btc-chart] fetch:', err); });
  }

  // Init: essayer toutes les 500ms pendant 5s max
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

  // Navigation vers Today
  var _origGoPage = window.goPage;
  if (_origGoPage) {
    window.goPage = function (pageName) {
      _origGoPage(pageName);
      if (pageName === 'today') setTimeout(_tryInit, 400);
    };
  }

  window.initBtcChart = initBtcChart;
})();
