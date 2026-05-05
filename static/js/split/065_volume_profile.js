// ---------- Volume Profile v1 — Canvas Overlay ----------
// Draws horizontal volume histogram, POC, VAH, VAL on the chart canvas.
// Independent from drawings — uses its own canvas layer (z-index: 9).

(function () {
  'use strict';

  var STORAGE_KEY = 'chartVolumeProfileSettings';

  // ── DEFAULTS ──
  var DEFAULTS = {
    active: false,
    bucketSize: 10,       // $10 buckets for BTC
    period: 'visible',    // 'visible', '5d', '7d', '30d', '90d', '366d'
    vaPercent: 70,        // Value Area % (68, 70, 80)
    showPOC: true,
    showVAH: true,
    showVAL: true,
    colorPOC: '#f59e0b',  // amber
    colorVAH: '#22c55e',  // green
    colorVAL: '#ef4444',  // red
    colorHvn: '#06b6d4',  // cyan
    colorLvn: 'rgba(255,255,255,0.15)',
  };

  // ── VP SOURCE CONFIG : interval + jours d'historique ──
  // Chaque période fetch via /api/market/klines/history (cache SQLite backend)
  var VP_SOURCE_CONFIG = {
    '5d':   { label: '5D',   interval: '15m', days: 5 },
    '7d':   { label: '7D',   interval: '15m', days: 7 },
    '30d':  { label: '30D',  interval: '30m', days: 30 },
    '90d':  { label: '90D',  interval: '1h',  days: 90 },
    '366d': { label: '366D', interval: '4h',  days: 366 },
  };

  // ── LEGACY MIGRATION ──
  var legacyPeriodMap = {
    day: '5d',
    week: '7d',
    month: '30d',
  };

  // ── STATE ──
  var state = {
    ctx: null,
    chart: null,
    series: null,
    container: null,
    canvas: null,
    candles: [],
    settings: null,
    data: null,           // calculated VP data
    vpCandles: {},        // cache per period (day, week, month)
    vpFetchPending: {},   // prevent concurrent fetches
  };

  // ── INIT ──
  function init(chart, series, container) {
    state.chart = chart;
    state.series = series;
    state.container = container;
    _loadSettings();
    _createCanvas();
    _bindTimeScale();

    // Re-render on time scale change (zoom/pan) — debounce double fire
    if (state.chart && state.chart.timeScale()) {
      var _vpDeb = null;
      function _vpSched() { if (_vpDeb) return; _vpDeb = setTimeout(function () { _vpDeb = null; _renderVP(); }, 16); }
      try {
        state.chart.timeScale().subscribeVisibleTimeRangeChange(_vpSched);
        state.chart.timeScale().subscribeVisibleLogicalRangeChange(_vpSched);
      } catch (e) {}
    }

    // rAF render loop pendant interaction (double rAF pour synchro LWC)
    if (state.container) {
      var _vpLoopId = null, _vpTimer = null;
      function _vpTick() {
        if (!_vpLoopId) return;
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            if (!_vpLoopId) return;
            _resizeCanvas();
            _renderVP();
            _vpLoopId = requestAnimationFrame(_vpTick);
          });
        });
      }
      function _vpStart() {
        if (_vpLoopId) return;
        _vpLoopId = requestAnimationFrame(_vpTick);
      }
      function _vpStop() {
        if (_vpLoopId) { cancelAnimationFrame(_vpLoopId); _vpLoopId = null; }
        // Dernier rendu stabilise
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            _resizeCanvas();
            _renderVP();
          });
        });
      }
      try {
        state.container.addEventListener('mousemove', function () {
          _vpStart(); clearTimeout(_vpTimer); _vpTimer = setTimeout(_vpStop, 200);
        }, { passive: true });
        state.container.addEventListener('wheel', function () {
          _vpStart(); clearTimeout(_vpTimer); _vpTimer = setTimeout(_vpStop, 200);
        }, { passive: true });
        state.container.addEventListener('mouseleave', function () { clearTimeout(_vpTimer); _vpStop(); });
      } catch(e) {}
    }

    _renderVP();
  }

  function destroy() {
    if (state.canvas && state.canvas.parentNode) {
      state.canvas.parentNode.removeChild(state.canvas);
    }
    state.ctx = null;
    state.canvas = null;
    state.chart = null;
    state.series = null;
    state.container = null;
    state.candles = [];
    state.data = null;
  }

  // ── CANVAS ──
  function _createCanvas() {
    if (!state.container) return;
    if (state.canvas) { state.container.removeChild(state.canvas); }

    state.canvas = document.createElement('canvas');
    state.canvas.className = 'vp-overlay';
    state.canvas.style.cssText =
      'position:absolute;z-index:9;pointer-events:none;';
    // Insert before drawings canvas (z-index 10) so VP is behind tools
    var drawingsCanvas = state.container.querySelector('.draw-overlay');
    if (drawingsCanvas) {
      state.container.insertBefore(state.canvas, drawingsCanvas);
    } else {
      state.container.appendChild(state.canvas);
    }
    state.ctx = state.canvas.getContext('2d');
    _resizeCanvas();
  }

  function _resizeCanvas() {
    var c = state.canvas;
    if (!c || !state.container) return;
    var pane = _getLwcPaneRect();
    var rect = pane || state.container.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    c.style.left = rect.left + 'px';
    c.style.top = rect.top + 'px';
    c.style.width = rect.width + 'px';
    c.style.height = rect.height + 'px';
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
    if (state.ctx) state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function _getLwcPaneRect() {
    if (!state.container) return null;
    var containerRect = state.container.getBoundingClientRect();
    var canvases = Array.prototype.slice.call(
      state.container.querySelectorAll('canvas')
    ).filter(function (c) {
      return c !== state.canvas && !c.classList.contains('draw-overlay');
    });
    if (!canvases.length) return null;
    var best = null, bestArea = 0;
    for (var i = 0; i < canvases.length; i++) {
      var r = canvases[i].getBoundingClientRect();
      var area = r.width * r.height;
      if (r.width > 100 && r.height > 100 && area > bestArea) {
        best = r; bestArea = area;
      }
    }
    if (!best) return null;
    return {
      left: best.left - containerRect.left,
      top: best.top - containerRect.top,
      width: best.width,
      height: best.height,
    };
  }

  function _bindTimeScale() {
    // Re-render on resize too
    var ro = new ResizeObserver(function () {
      _resizeCanvas();
      _renderVP();
    });
    if (state.container) ro.observe(state.container);
  }

  // ── SETTINGS ──
  function _loadSettings() {
    try {
      var r = localStorage.getItem(STORAGE_KEY);
      state.settings = r ? Object.assign({}, DEFAULTS, JSON.parse(r)) : Object.assign({}, DEFAULTS);
    } catch (e) {
      state.settings = Object.assign({}, DEFAULTS);
    }
    // Migrate legacy periods to new config
    if (state.settings && legacyPeriodMap[state.settings.period]) {
      state.settings.period = legacyPeriodMap[state.settings.period];
    }
  }

  function saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings)); } catch (e) {}
  }

  function updateSettings(s) {
    Object.assign(state.settings, s);
    saveSettings();
    _calcVP();
    _renderVP();
  }

  function getSettings() { return Object.assign({}, state.settings); }

  // ── SET CANDLES (called after each fetch) ──
  function setCandles(candles) {
    state.candles = candles || [];
    _calcVP();
    _renderVP();
  }

  // ── CALCULATION ──
  function _calcVP() {
    if (!state.settings.active) { state.data = null; return; }
    var s = state.settings;

    // Get candles for the period (cached or empty if pending fetch)
    var filtered = _getPeriodCandles(s.period);
    if (!filtered || filtered.length < 2) { state.data = null; return; }

    var bucketSize = s.bucketSize;

    // Find price range
    var minPrice = Infinity, maxPrice = -Infinity;
    for (var i = 0; i < filtered.length; i++) {
      var c = filtered[i];
      if (c.low < minPrice) minPrice = c.low;
      if (c.high > maxPrice) maxPrice = c.high;
    }

    // Build price buckets
    var step = bucketSize;
    // For sub-dollar assets, scale bucket size down
    if (maxPrice < 10) step = Math.max(step * 0.01, 0.01);
    else if (maxPrice < 100) step = Math.max(step * 0.1, 0.1);
    else if (maxPrice < 1000) step = Math.max(step, 1);

    var buckets = {};

    for (var j = 0; j < filtered.length; j++) {
      var ci = filtered[j];
      var lo = Math.floor(ci.low / step) * step;
      var hi = Math.ceil(ci.high / step) * step;
      var numB = Math.max(1, Math.round((hi - lo) / step));

      for (var k = 0; k < numB; k++) {
        var pp = lo + k * step;
        var key = pp.toFixed(2);
        buckets[key] = (buckets[key] || 0) + (ci.volume / numB);
      }
    }

    // Convert to sorted array
    var bucketArray = [];
    for (var bk in buckets) {
      if (buckets.hasOwnProperty(bk)) {
        bucketArray.push({ price: parseFloat(bk), volume: buckets[bk] });
      }
    }
    bucketArray.sort(function (a, b) { return a.price - b.price; });

    if (bucketArray.length === 0) { state.data = null; return; }

    // POC = bucket with highest volume
    var pocBucket = bucketArray[0];
    var totalVol = 0;
    for (var m = 0; m < bucketArray.length; m++) {
      totalVol += bucketArray[m].volume;
      if (bucketArray[m].volume > pocBucket.volume) pocBucket = bucketArray[m];
    }

    // Value Area: expand from POC outward until we reach VA%
    var vaRatio = s.vaPercent / 100;
    var vaVol = pocBucket.volume;
    var pocIdx = -1;
    for (var n = 0; n < bucketArray.length; n++) {
      if (bucketArray[n].price === pocBucket.price) { pocIdx = n; break; }
    }
    if (pocIdx === -1) { state.data = null; return; }

    var vah = pocBucket.price;
    var val = pocBucket.price;
    var leftIdx = pocIdx - 1;
    var rightIdx = pocIdx + 1;
    var targetVaVol = totalVol * vaRatio;

    while (vaVol < targetVaVol && (leftIdx >= 0 || rightIdx < bucketArray.length)) {
      var leftVol = leftIdx >= 0 ? bucketArray[leftIdx].volume : -1;
      var rightVol = rightIdx < bucketArray.length ? bucketArray[rightIdx].volume : -1;

      if (leftVol >= rightVol) {
        val = bucketArray[leftIdx].price;
        vaVol += leftVol;
        leftIdx--;
      } else {
        vah = bucketArray[rightIdx].price;
        vaVol += rightVol;
        rightIdx++;
      }
    }

    // Compute max volume for normalization
    var maxVol = pocBucket.volume;

    // Store
    state.data = {
      poc: pocBucket.price,
      vah: vah,
      val: val,
      pocVolume: pocBucket.volume,
      totalVolume: totalVol,
      maxVolume: maxVol,
      buckets: bucketArray,
      bucketSize: step,
      candleCount: filtered.length,
    };
  }

  // ── NORMALIZERS ──
  function _numRequired(v) {
    if (v === null || v === undefined || v === '') return NaN;
    var n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }

  function _numOptional(v, fallback) {
    if (v === null || v === undefined || v === '') return fallback;
    var n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function _normalizeVpCandles(rows) {
    return (rows || []).map(function (c) {
      return {
        time: _numRequired(c.time),
        open: _numRequired(c.open),
        high: _numRequired(c.high),
        low: _numRequired(c.low),
        close: _numRequired(c.close),
        volume: _numOptional(c.volume, 0),
      };
    }).filter(function (c) {
      return Number.isFinite(c.time)
        && Number.isFinite(c.open)
        && Number.isFinite(c.high)
        && Number.isFinite(c.low)
        && Number.isFinite(c.close)
        && c.high >= c.low
        && c.high >= Math.max(c.open, c.close)
        && c.low <= Math.min(c.open, c.close);
    }).sort(function (a, b) {
      return a.time - b.time;
    });
  }

  // ── PERIOD CANDLES (cache + fetch) ──
  function _getPeriodCandles(period) {
    if (period === 'visible') {
      return state.candles;
    }

    var cached = state.vpCandles[period];
    if (cached && cached.length >= 2) {
      return cached;
    }

    // Trigger fetch if not already pending
    _fetchVpCandles(period);

    // Return empty until fetch completes
    return [];
  }

  function _fetchVpCandles(period) {
    var cfg = VP_SOURCE_CONFIG[period];
    if (!cfg || state.vpFetchPending[period]) return;

    state.vpFetchPending[period] = true;

    var url = '/api/market/klines/history?symbol=BTCUSDT'
            + '&interval=' + encodeURIComponent(cfg.interval)
            + '&days=' + encodeURIComponent(cfg.days);

    fetch(url)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.candles) return;

        var candles = _normalizeVpCandles(data.candles);
        if (candles.length >= 2) {
          state.vpCandles[period] = candles;
          _calcVP();
          _renderVP();
        }
      })
      .catch(function (e) {
        console.warn('[VP] fetch failed for period=' + period, e);
      })
      .finally(function () {
        state.vpFetchPending[period] = false;
      });
  }

  // ── RENDER ──
  function _renderVP() {
    var ctx = state.ctx;
    if (!ctx || !state.canvas || !state.settings.active || !state.data) {
      _clearCanvas();
      return;
    }

    var dpr = window.devicePixelRatio || 1;
    var cw = state.canvas.width / dpr;
    var ch = state.canvas.height / dpr;
    var s = state.settings;
    var vp = state.data;
    var ser = state.series;

    ctx.clearRect(0, 0, cw, ch);

    // Histogram width (% of canvas width)
    var histWidth = Math.min(80, cw * 0.12);
    var histX = cw - histWidth;

    // Draw vertical background strip for histogram
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(histX, 0, histWidth, ch);
    ctx.restore();

    // Draw each bucket as a horizontal bar
    var minVis = Infinity, maxVis = -Infinity;
    if (ser && ser.coordinateToPrice) {
      minVis = ser.coordinateToPrice(ch);
      maxVis = ser.coordinateToPrice(0);
    }

    ctx.save();
    for (var i = 0; i < vp.buckets.length; i++) {
      var b = vp.buckets[i];

      // Price → y coordinate
      var py = null;
      try {
        if (ser && ser.priceToCoordinate) {
          py = ser.priceToCoordinate(b.price);
        } else {
          py = null;
        }
      } catch (e) { py = null; }
      if (py == null || isNaN(py)) continue;

      // Bar width proportional to volume (max = histWidth)
      var ratio = vp.maxVolume > 0 ? b.volume / vp.maxVolume : 0;
      var barW = Math.max(2, ratio * histWidth);
      var barX = cw - barW;

      // Color: HVN = bright, LVN = dim
      var isPOC = b.price === vp.poc;
      var isVAH = b.price === vp.vah;
      var isVAL = b.price === vp.val;

      var isInVA = b.price <= vp.vah && b.price >= vp.val;
      var alpha = 0.3 + ratio * 0.5;
      var color = isPOC ? s.colorPOC
                : isInVA ? s.colorHvn
                : s.colorLvn;

      // Blend color with alpha
      ctx.globalAlpha = isPOC ? 0.7 : alpha;
      ctx.fillStyle = color;
      ctx.fillRect(barX, py - 1, barW, 2);

      ctx.globalAlpha = isPOC ? 0.4 : alpha * 0.3;
      ctx.fillStyle = color;
      ctx.fillRect(barX, py - 4, barW, 8);
    }
    ctx.restore();

    // ── POC LINE ──
    if (s.showPOC && vp.poc != null) {
      var pocY = null;
      try { pocY = ser.priceToCoordinate(vp.poc); } catch (e) {}
      if (pocY != null && !isNaN(pocY)) {
        ctx.save();
        ctx.strokeStyle = s.colorPOC;
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(0, pocY);
        ctx.lineTo(cw, pocY);
        ctx.stroke();

        // Label
        ctx.fillStyle = s.colorPOC;
        ctx.font = 'bold 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.globalAlpha = 0.9;
        ctx.fillText('POC ' + vp.poc.toFixed(2), 6, pocY - 4);
        ctx.restore();
      }
    }

    // ── VAH LINE ──
    if (s.showVAH && vp.vah != null) {
      var vahY = null;
      try { vahY = ser.priceToCoordinate(vp.vah); } catch (e) {}
      if (vahY != null && !isNaN(vahY)) {
        ctx.save();
        ctx.strokeStyle = s.colorVAH;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.moveTo(0, vahY);
        ctx.lineTo(cw, vahY);
        ctx.stroke();

        ctx.fillStyle = s.colorVAH;
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.globalAlpha = 0.85;
        ctx.fillText('VAH ' + vp.vah.toFixed(2), cw - 4, vahY - 4);
        ctx.restore();
      }
    }

    // ── VAL LINE ──
    if (s.showVAL && vp.val != null) {
      var valY = null;
      try { valY = ser.priceToCoordinate(vp.val); } catch (e) {}
      if (valY != null && !isNaN(valY)) {
        ctx.save();
        ctx.strokeStyle = s.colorVAL;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.globalAlpha = 0.75;
        ctx.beginPath();
        ctx.moveTo(0, valY);
        ctx.lineTo(cw, valY);
        ctx.stroke();

        ctx.fillStyle = s.colorVAL;
        ctx.font = '10px "JetBrains Mono", monospace';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.globalAlpha = 0.85;
        ctx.fillText('VAL ' + vp.val.toFixed(2), cw - 4, valY + 4);
        ctx.restore();
      }
    }

    // ── INFO BADGE ──
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.globalAlpha = 0.5;
    var cfg = VP_SOURCE_CONFIG[s.period];
    var periodLabel = (cfg && cfg.label) || s.period;
    var sourceLabel = cfg ? cfg.interval : 'chart';
    var infoTxt = 'VP ' + periodLabel + ' | ' + sourceLabel + ' | ' + vp.bucketSize + '$ | ' + vp.candleCount + ' candles';
    ctx.fillText(infoTxt, 6, 6);
    ctx.restore();
  }

  function _clearCanvas() {
    var ctx = state.ctx;
    if (!ctx || !state.canvas) return;
    ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
  }

  // ── EXPOSED API ──
  window.VolumeProfile = {
    init: init,
    destroy: destroy,
    setCandles: setCandles,
    updateSettings: updateSettings,
    getSettings: getSettings,
    render: _renderVP,
  };

})();
