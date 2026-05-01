// ---------- BTC Chart widget — TradingView Lightweight Charts ----------

(function () {
  var chart = null;
  var series = null;
  var currentInterval = '1h';
  var resizeObserver = null;
  var chartReady = false;

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
          vertLines: { color: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)' },
          horzLines: { color: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)' },
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
          _fetchAndRender();
        });
      });

    } catch (e) {
      console.error('[btc-chart] createChart error:', e);
    }
  }

  function _fetchAndRender() {
    if (!series) return;
    var url = '/api/market/klines?symbol=BTCUSDT&interval=' + currentInterval + '&limit=200';
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { console.error('[btc-chart]', data.error); return; }
        var candles = data.candles || [];
        if (!candles.length) return;
        var last = candles[candles.length - 1];
        var priceEl = document.getElementById('btcChartPrice');
        if (priceEl) priceEl.textContent = '$' + Number(last.close).toLocaleString('fr-FR', { minimumFractionDigits: 2 });
        series.setData(candles);
        chart.timeScale().fitContent();
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
