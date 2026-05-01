// ---------- Chart page — TradingView Lightweight Charts XXL ----------

(function () {
  var chart = null;
  var candlestickSeries = null;
  var volumeSeries = null;
  var vwapSeries = null;
  var activeVwapPeriod = null;
  var currentInterval = '1h';
  var currentSymbol = 'BTCUSDT';
  var countdownTimer = null;
  var lastCandleTime = 0;
  var resizeObserver = null;
  var refreshTimer = null;
  var ws = null;
  var wsReconnectTimer = null;
  var currentSymbol = 'BTCUSDT';

  function _connectWs() {
    if (ws) try { ws.close(); } catch(e) {}
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
          var priceEl = document.getElementById('chartPrice');
          if (priceEl) priceEl.textContent = '$' + candle.close.toLocaleString('fr-FR', { minimumFractionDigits: 2 });
          lastCandleTime = k.t;
          if (k.x) { _fetchAndRender(true); return; }
          if (candlestickSeries) {
            try { candlestickSeries.update(candle); } catch(e) {}
            if (volumeSeries) {
              try { volumeSeries.update({ time: candle.time, value: candle.volume, color: candle.close >= candle.open ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)' }); } catch(e) {}
            }
          }
        } catch(e) {}
      };
      ws.onclose = function () {
        if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
        wsReconnectTimer = setTimeout(_connectWs, 3000);
      };
      ws.onerror = function() {};
    } catch(e) { console.error('[chart] ws:', e); }
  }

  function _disconnectWs() {
    if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
    if (ws) { try { ws.close(); } catch(e) {} ws = null; }
  }

  var INTERVAL_MS = {
    '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000,
    '30m': 1800000, '1h': 3600000, '2h': 7200000, '4h': 14400000,
    '6h': 21600000, '8h': 28800000, '12h': 43200000,
    '1d': 86400000, '3d': 259200000, '1w': 604800000, '1M': 2592000000,
  };

  var PAIR_NAMES = { 'BTCUSDT': 'BTC/USDT', 'ETHUSDT': 'ETH/USDT' };

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
    if (chart) { _fetchAndRender(); return; }

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
    var w = wrap.clientWidth || 900;
    var h = wrap.clientHeight || 500;

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
        handleScroll: { vertTouchDrag: false },
      });

      candlestickSeries = chart.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderDownColor: '#ef4444',
        borderUpColor: '#22c55e',
        wickDownColor: '#ef4444',
        wickUpColor: '#22c55e',
      });

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
          var cw = wrap.clientWidth;
          var ch = wrap.clientHeight;
          if (cw > 0 && ch > 0) chart.applyOptions({ width: cw, height: ch });
        }
      });
      resizeObserver.observe(wrap);

      // VWAP toggle dropdown
      var vwapToggle = document.getElementById('vwapToggle');
      var vwapDropdown = document.getElementById('vwapDropdown');
      if (vwapToggle && vwapDropdown) {
        vwapToggle.addEventListener('click', function (e) {
          e.stopPropagation();
          vwapDropdown.classList.toggle('hidden');
        });
        document.addEventListener('click', function () { vwapDropdown.classList.add('hidden'); }, false);
        vwapDropdown.querySelectorAll('.chart-ind-opt').forEach(function (btn) {
          btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var period = btn.dataset.vwap;
            if (btn.classList.contains('active')) {
              btn.classList.remove('active');
              activeVwapPeriod = null;
              vwapToggle.classList.remove('active');
            } else {
              vwapDropdown.querySelectorAll('.chart-ind-opt').forEach(function (b) { b.classList.remove('active'); });
              btn.classList.add('active');
              activeVwapPeriod = period;
              vwapToggle.classList.add('active');
            }
            vwapDropdown.classList.add('hidden');
            _fetchAndRender(true);
          });
        });
      }

      // Timeframe buttons
      document.querySelectorAll('.chart-tf-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          document.querySelectorAll('.chart-tf-btn').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          currentInterval = btn.dataset.interval;
          _disconnectWs();
          _fetchAndRender();
        });
      });

      // Pair buttons
      document.querySelectorAll('.chart-pair-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
          document.querySelectorAll('.chart-pair-btn').forEach(function (b) { b.classList.remove('active'); });
          btn.classList.add('active');
          currentSymbol = btn.dataset.symbol;
          _disconnectWs();
          _fetchAndRender();
        });
      });

    } catch (e) {
      console.error('[chart] createChart error:', e);
    }
  }

  function _calcAndDrawVwap(candles) {
    if (!activeVwapPeriod || !candles || !candles.length) {
      if (vwapSeries) { try { chart.removeSeries(vwapSeries); } catch(e) {} vwapSeries = null; }
      return;
    }

    var days = { '1D': 1, '7D': 7, '30D': 30, '90D': 90 }[activeVwapPeriod] || 1;
    var now = Math.floor(Date.now() / 1000);
    var cutoff = now - days * 86400;

    var cumTpv = 0, cumVol = 0;
    for (var i = 0; i < candles.length; i++) {
      var c = candles[i];
      if (c.time < cutoff) continue;
      var tp = (c.high + c.low + c.close) / 3;
      cumTpv += tp * c.volume;
      cumVol += c.volume;
    }

    if (cumVol === 0) {
      if (vwapSeries) { try { chart.removeSeries(vwapSeries); } catch(e) {} vwapSeries = null; }
      return;
    }

    var vwap = cumTpv / cumVol;
    if (!vwapSeries) {
      vwapSeries = chart.addLineSeries({
        color: '#f59e0b',
        lineWidth: 1.5,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
      });
    }

    // Ligne horizontale a la valeur VWAP
    var data = candles.map(function (c) { return { time: c.time, value: vwap }; });
    vwapSeries.setData(data);
  }

  function _fetchAndRender(keepZoom) {
    if (!candlestickSeries) return;
    var url = '/api/market/klines?symbol=' + currentSymbol + '&interval=' + currentInterval + '&limit=500';
    fetch(url)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.error) { console.error('[chart]', data.error); return; }
        var candles = data.candles || [];
        if (!candles.length) return;

        var last = candles[candles.length - 1];
        lastCandleTime = last.time * 1000;
        _startCountdown();
        _startAutoRefresh();
        _disconnectWs();
        _connectWs();
        _updateStats(candles);

        candlestickSeries.setData(candles);

        volumeSeries.setData(candles.map(function (c) {
          return { time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)' };
        }));

        if (!keepZoom) chart.timeScale().fitContent();
      })
      .catch(function (err) { console.error('[chart] fetch:', err); });
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

  function _startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    var el = document.getElementById('chartCountdown');
    if (!el) return;
    function tick() {
      if (!lastCandleTime) { el.textContent = ''; return; }
      var now = Date.now();
      var ms = _getIntervalMs(currentInterval);
      var remaining = ms - (now - lastCandleTime);
      if (remaining <= 0) {
        el.textContent = '0:00';
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

  // Init
  function _tryInit() {
    if (document.querySelector('.page[data-page="chart"].active')) {
      initChartPage();
    }
  }

  document.addEventListener('DOMContentLoaded', function () { setTimeout(_tryInit, 500); });

  // Hook dans goPage existante pour init au changement de page
  var _origGoPage = window.goPage;
  if (_origGoPage) {
    window.goPage = function (pageName) {
      _origGoPage(pageName);
      if (pageName === 'chart') {
        setTimeout(function () {
          initChartPage();
          // Force resize apres render
          setTimeout(function () {
            if (chart) {
              var wrap = document.getElementById('chartCanvasWrap');
              if (wrap) chart.applyOptions({ width: wrap.clientWidth, height: wrap.clientHeight });
            }
          }, 100);
        }, 300);
      }
    };
  }

  window.initChartPage = initChartPage;
})();
