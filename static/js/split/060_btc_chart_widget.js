// ---------- BTC Chart widget — TradingView Lightweight Charts ----------

(function () {
  var chart = null;
  var series = null;
  var currentInterval = '1h';

  function initBtcChart() {
    var container = document.getElementById('btcChartContainer');
    if (!container) return;
    if (chart) return; // deja init

    // Charger Lightweight Charts depuis CDN
    if (typeof window.LightweightCharts === 'undefined') {
      var script = document.createElement('script');
      script.src = 'https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js';
      script.onload = function () {
        _createChart(container);
        _fetchAndRender();
      };
      document.head.appendChild(script);
      return;
    }

    _createChart(container);
    _fetchAndRender();
  }

  function _createChart(container) {
    var isLight = document.body.classList.contains('light-mode');
    chart = window.LightweightCharts.createChart(container, {
      width: container.clientWidth,
      height: Math.max(320, Math.min(480, container.clientHeight || 400)),
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: isLight ? '#1e293b' : '#d1d5db',
      },
      grid: {
        vertLines: { color: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)' },
        horzLines: { color: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)' },
      },
      crosshair: {
        mode: window.LightweightCharts.CrosshairMode.Normal,
      },
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

    // Redimmensionnement
    var resizeObserver = new ResizeObserver(function () {
      if (chart) {
        chart.applyOptions({ width: container.clientWidth, height: Math.max(320, Math.min(480, container.clientHeight || 400)) });
      }
    });
    resizeObserver.observe(container);

    // Intervalles
    document.querySelectorAll('.btc-chart-interval').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.btc-chart-interval').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentInterval = btn.dataset.interval;
        _fetchAndRender();
      });
    });
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
        // Mettre a jour le prix
        var last = candles[candles.length - 1];
        var priceEl = document.getElementById('btcChartPrice');
        if (priceEl) priceEl.textContent = '$' + Number(last.close).toLocaleString('fr-FR', { minimumFractionDigits: 2 });
        series.setData(candles);
        chart.timeScale().fitContent();
      })
      .catch(function (err) { console.error('[btc-chart] fetch error:', err); });
  }

  // Initialisation au chargement de la page Today
  document.addEventListener('DOMContentLoaded', function () {
    if (document.querySelector('.page[data-page="today"].active')) {
      initBtcChart();
    }
  });

  // Re-init quand on navigue vers Today
  var _origGoPage = window.goPage;
  if (_origGoPage) {
    window.goPage = function (pageName) {
      _origGoPage(pageName);
      if (pageName === 'today') setTimeout(initBtcChart, 200);
    };
  }

  window.initBtcChart = initBtcChart;
})();
