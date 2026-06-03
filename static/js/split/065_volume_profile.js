// ---------- Hyperliquid Volume Profile - integrated chart overlay ----------
// Source of truth: executed Hyperliquid trades through analytics APIs.

(function () {
  'use strict';

  var STORAGE_KEY = 'chartVolumeProfileSettings';
  var DEFAULTS = {
    active: true,
    metric: 'notional',
    profileType: 'session',
    rowSize: 'auto',
    vaPercent: 70,
    showPOC: true,
    showVAH: true,
    showVAL: true,
    colorPOC: '#f59e0b',
    colorVAH: '#38d3ee',
    colorVAL: '#fb7185',
    colorHvn: '#22c7d8',
    showNodes: true,
    vpPeakN: 9,      // window size %
    vpTroughN: 7,    // window size %
    vpThreshold: 10, // % of max volume
    colorPeak: '#22d3ee',
    colorTrough: '#64748b'
  };

  var state = {
    chart: null,
    series: null,
    container: null,
    canvas: null,
    ctx: null,
    settings: null,
    candles: [],
    coin: 'BTC',
    interval: '3m',
    mode: 'profile',
    data: null,
    requestId: 0,
    resizeObserver: null,
    scaleBound: false,
  };

  function _loadSettings() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (saved.bucketSize != null && saved.rowSize == null) saved.rowSize = String(saved.bucketSize);
      if (saved.period != null && saved.profileType == null) saved.profileType = saved.period === 'visible' ? 'visible' : 'session';
      state.settings = Object.assign({}, DEFAULTS, saved);
    } catch (e) {
      state.settings = Object.assign({}, DEFAULTS);
    }
  }

  function _saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings)); } catch (e) {}
  }

  function _createCanvas() {
    if (!state.container) return;
    if (state.canvas && state.canvas.parentNode) state.canvas.parentNode.removeChild(state.canvas);
    state.canvas = document.createElement('canvas');
    state.canvas.className = 'vp-overlay';
    state.container.appendChild(state.canvas);
    state.ctx = state.canvas.getContext('2d');
    _resize();
  }

  function _paneRect() {
    if (!state.container) return null;
    var parent = state.container.getBoundingClientRect();
    var canvases = state.container.querySelectorAll('#chartCanvas canvas');
    var best = null;
    var area = 0;
    Array.prototype.forEach.call(canvases, function (canvas) {
      var rect = canvas.getBoundingClientRect();
      if (rect.width * rect.height > area) {
        area = rect.width * rect.height;
        best = rect;
      }
    });
    if (!best) return { left: 0, top: 0, width: parent.width, height: parent.height };
    return {
      left: best.left - parent.left,
      top: best.top - parent.top,
      width: best.width,
      height: best.height,
    };
  }

  function _resize() {
    if (!state.canvas || !state.container) return;
    var rect = _paneRect();
    var dpr = window.devicePixelRatio || 1;
    state.canvas.style.left = rect.left + 'px';
    state.canvas.style.top = rect.top + 'px';
    state.canvas.style.width = rect.width + 'px';
    state.canvas.style.height = rect.height + 'px';
    state.canvas.width = Math.round(rect.width * dpr);
    state.canvas.height = Math.round(rect.height * dpr);
    state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function init(chart, series, container) {
    state.chart = chart;
    state.series = series;
    state.container = container;
    if (!state.settings) _loadSettings();
    _createCanvas();
    if (state.resizeObserver) state.resizeObserver.disconnect();
    state.resizeObserver = new ResizeObserver(function () {
      _resize();
      render();
    });
    state.resizeObserver.observe(container);
    if (!state.scaleBound && chart && chart.timeScale()) {
      state.scaleBound = true;
      var schedule = function () {
        render();
        if (state.settings.profileType === 'visible') refresh();
      };
      try { chart.timeScale().subscribeVisibleTimeRangeChange(schedule); } catch (e) {}
    }
    render();
  }

  function destroy() {
    if (state.resizeObserver) state.resizeObserver.disconnect();
    if (state.canvas && state.canvas.parentNode) state.canvas.parentNode.removeChild(state.canvas);
    state.canvas = null;
    state.ctx = null;
    state.data = null;
  }

  function _range() {
    var latest = state.candles.length ? state.candles[state.candles.length - 1].time * 1000 : Date.now();
    var liveEnd = Math.max(latest + 1, Date.now());
    if (state.settings.profileType === 'visible' && state.chart) {
      try {
        var visible = state.chart.timeScale().getVisibleRange();
        if (visible && visible.from && visible.to) {
          return { start: Number(visible.from) * 1000, end: Number(visible.to) * 1000 };
        }
      } catch (e) {}
    }
    if (state.settings.profileType === 'fixed' || state.settings.profileType === 'composite') {
      if (state.candles.length) {
        return { start: state.candles[0].time * 1000, end: latest + 1 };
      }
    }
    var utc = new Date(latest);
    var start = Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
    return { start: start, end: Math.max(start + 1, liveEnd) };
  }

  function _status(text, className) {
    var el = document.getElementById('chartDataStatus');
    if (!el) return;
    el.className = 'workspace-data-status' + (className ? ' ' + className : '');
    el.textContent = text;
  }

  function refresh() {
    if (!state.settings || !state.settings.active || state.mode !== 'profile') {
      state.data = null;
      render();
      return;
    }
    var range = _range();
    var requestId = ++state.requestId;
    var params = [
      'coin=' + encodeURIComponent(state.coin),
      'startTime=' + Math.floor(range.start),
      'endTime=' + Math.floor(range.end),
      'metric=' + encodeURIComponent(state.settings.metric),
      'rowSize=' + encodeURIComponent(state.settings.rowSize),
      'vaPercent=' + encodeURIComponent(state.settings.vaPercent),
      'profileType=' + encodeURIComponent(state.settings.profileType),
    ].join('&');
    _status('Hyperliquid trades: loading profile', 'partial');
    fetch('/api/hyperliquid/analytics/volume-profile?' + params)
      .then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(function (data) {
        if (requestId !== state.requestId) return;
        state.data = data;
        if (data.partial) {
          _status('Partial coverage | profile from available trades', 'partial');
        } else {
          _status('Full trade coverage | exact delta', '');
        }
        render();
      })
      .catch(function () {
        if (requestId !== state.requestId) return;
        state.data = null;
        _status('Hyperliquid profile unavailable', 'gap');
        render();
      });
  }

  function setCandles(candles) {
    state.candles = candles || [];
    refresh();
  }

  function setContext(context) {
    context = context || {};
    if (context.coin) state.coin = context.coin;
    if (context.interval) state.interval = context.interval;
    if (context.candles) state.candles = context.candles;
    refresh();
  }

  function setMode(mode) {
    state.mode = mode || 'profile';
    if (state.canvas) state.canvas.style.display = state.mode === 'profile' ? '' : 'none';
    if (state.mode === 'profile') refresh();
  }

  function updateSettings(settings) {
    var normalized = Object.assign({}, settings);
    if (normalized.bucketSize != null) normalized.rowSize = String(normalized.bucketSize);
    if (normalized.period != null) normalized.profileType = normalized.period;
    Object.assign(state.settings, normalized);
    _saveSettings();
    refresh();
  }

  function getSettings() {
    var output = Object.assign({}, state.settings || DEFAULTS);
    output.bucketSize = output.rowSize;
    output.period = output.profileType;
    return output;
  }

  function _priceY(price) {
    try { return state.series && state.series.priceToCoordinate(Number(price)); } catch (e) { return null; }
  }

  function _timeX(timeMs) {
    try { return state.chart && state.chart.timeScale().timeToCoordinate(Number(timeMs) / 1000); } catch (e) { return null; }
  }

  function _label(ctx, x, y, text, color) {
    ctx.font = '700 10px "JetBrains Mono", monospace';
    var width = ctx.measureText(text).width + 12;
    ctx.fillStyle = 'rgba(7, 13, 18, 0.90)';
    ctx.fillRect(x - width, y - 10, width, 18);
    ctx.fillStyle = color;
    ctx.fillText(text, x - width + 6, y + 3);
  }

  function _detectVolumeNodes(levels, maxVolume) {
    var sorted = levels.slice().sort(function (a, b) { return a.price - b.price; });
    var len = sorted.length;
    if (len < 5) return { peaks: [], troughs: [] };

    var peakPercent = state.settings.vpPeakN || 9;
    var troughPercent = state.settings.vpTroughN || 7;
    var threshPercent = state.settings.vpThreshold || 10;

    var peakN = Math.max(1, Math.floor(len * (peakPercent / 100)));
    var troughN = Math.max(1, Math.floor(len * (troughPercent / 100)));
    var minVolThreshold = maxVolume * (threshPercent / 100);

    var peaks = [];
    var troughs = [];

    for (var i = 0; i < len; i++) {
      var vol = sorted[i].totalVolume;

      var isPeak = true;
      var startP = Math.max(0, i - peakN);
      var endP = Math.min(len - 1, i + peakN);
      for (var j = startP; j <= endP; j++) {
        if (sorted[j].totalVolume > vol) {
          isPeak = false;
          break;
        }
      }
      if (isPeak && vol >= minVolThreshold) {
        peaks.push(sorted[i]);
      }

      if (i > troughN && i < len - 1 - troughN) {
        var isTrough = true;
        var startT = Math.max(0, i - troughN);
        var endT = Math.min(len - 1, i + troughN);
        for (var j = startT; j <= endT; j++) {
          if (sorted[j].totalVolume < vol) {
            isTrough = false;
            break;
          }
        }
        if (isTrough) {
          troughs.push(sorted[i]);
        }
      }
    }
    return { peaks: peaks, troughs: troughs };
  }

  function render() {
    if (!state.ctx || !state.canvas) return;
    var dpr = window.devicePixelRatio || 1;
    var width = state.canvas.width / dpr;
    var height = state.canvas.height / dpr;
    var ctx = state.ctx;
    ctx.clearRect(0, 0, width, height);
    if (state.mode !== 'profile' || !state.settings.active || !state.data) return;
    var levels = state.data.levels || [];
    if (!levels.length) {
      ctx.fillStyle = 'rgba(246,195,102,0.8)';
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.fillText('NO TRADE COVERAGE FOR RANGE', width - 270, 30);
      return;
    }

    var profileWidth = Math.min(265, Math.max(170, width * 0.23));
    var right = width - 44;
    var left = right - profileWidth;
    var maxVolume = Math.max.apply(null, levels.map(function (level) { return level.totalVolume; })) || 1;
    var rowPixels = Math.max(2, Math.min(13, Math.abs((_priceY(levels[0].price + state.data.rowSize) || 0) - (_priceY(levels[0].price) || 0)) || 4));

    ctx.fillStyle = 'rgba(5, 11, 16, 0.42)';
    ctx.fillRect(left - 10, 0, profileWidth + 18, height);
    ctx.fillStyle = 'rgba(132,226,244,0.45)';
    ctx.font = '700 9px "JetBrains Mono", monospace';
    ctx.fillText(state.data.profileType.toUpperCase() + ' VP / ' + state.data.metric.toUpperCase(), left, 16);

    levels.forEach(function (level) {
      var y = _priceY(level.price);
      if (y == null || y < -10 || y > height + 10) return;
      var totalWidth = (level.totalVolume / maxVolume) * profileWidth;
      var sellWidth = level.totalVolume ? totalWidth * level.sellVolume / level.totalVolume : 0;
      var buyWidth = level.totalVolume ? totalWidth * level.buyVolume / level.totalVolume : 0;
      var inValue = level.price >= state.data.val && level.price <= state.data.vah;
      ctx.globalAlpha = inValue ? 0.86 : 0.42;
      ctx.fillStyle = '#fb7185';
      ctx.fillRect(right - totalWidth, y - rowPixels / 2, sellWidth, rowPixels - 1);
      ctx.fillStyle = '#22d3ee';
      ctx.fillRect(right - totalWidth + sellWidth, y - rowPixels / 2, buyWidth, rowPixels - 1);
      if (level.unknownVolume > 0) {
        ctx.fillStyle = 'rgba(148,163,184,0.7)';
        ctx.fillRect(right - totalWidth, y - 1, totalWidth, 1);
      }
    });
    ctx.globalAlpha = 1;

    var developing = state.data.developing || [];
    if (developing.length > 1) {
      ctx.strokeStyle = 'rgba(245,158,11,0.62)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      developing.forEach(function (point, index) {
        var x = _timeX(point.timeMs);
        var y = _priceY(point.poc);
        if (x == null || y == null) return;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (state.data.previousLevels) {
      ['poc', 'vah', 'val'].forEach(function (key) {
        var levelY = _priceY(state.data.previousLevels[key]);
        if (levelY == null) return;
        ctx.strokeStyle = 'rgba(148,163,184,0.30)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(left - 60, levelY);
        ctx.lineTo(right, levelY);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    }

    [
      { enabled: state.settings.showPOC, price: state.data.poc, color: state.settings.colorPOC, tag: 'POC', dash: [] },
      { enabled: state.settings.showVAH, price: state.data.vah, color: state.settings.colorVAH, tag: 'VAH', dash: [5, 5] },
      { enabled: state.settings.showVAL, price: state.data.val, color: state.settings.colorVAL, tag: 'VAL', dash: [5, 5] },
    ].forEach(function (line) {
      if (!line.enabled || line.price == null) return;
      var y = _priceY(line.price);
      if (y == null) return;
      ctx.strokeStyle = line.color;
      ctx.lineWidth = line.tag === 'POC' ? 1.6 : 1;
      ctx.globalAlpha = line.tag === 'POC' ? 0.86 : 0.64;
      ctx.setLineDash(line.dash);
      ctx.beginPath();
      ctx.moveTo(line.tag === 'POC' ? 0 : left - 40, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      _label(ctx, right, y, line.tag + ' ' + Number(line.price).toFixed(2), line.color);
    });

    // --- LuxAlgo Node Detection Highlights ---
    if (state.settings.showNodes) {
      var nodes = _detectVolumeNodes(levels, maxVolume);

      // Peaks (HVN)
      nodes.peaks.forEach(function (node) {
        var y = _priceY(node.price);
        if (y == null || y < 0 || y > height) return;

        // Draw Peak line
        ctx.save();
        ctx.strokeStyle = state.settings.colorPeak || '#22d3ee';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();

        // Left marker text
        ctx.font = 'bold 8px "JetBrains Mono", monospace';
        ctx.fillStyle = state.settings.colorPeak || '#22d3ee';
        ctx.textAlign = 'right';
        ctx.fillText('HVN ' + Number(node.price).toFixed(1), left - 5, y + 3);
        ctx.restore();
      });

      // Troughs (LVN)
      nodes.troughs.forEach(function (node) {
        var y = _priceY(node.price);
        if (y == null || y < 0 || y > height) return;

        // Draw Trough line
        ctx.save();
        ctx.strokeStyle = state.settings.colorTrough || '#64748b';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();

        // Left marker text
        ctx.font = '8px "JetBrains Mono", monospace';
        ctx.fillStyle = state.settings.colorTrough || '#64748b';
        ctx.textAlign = 'right';
        ctx.fillText('LVN ' + Number(node.price).toFixed(1), left - 5, y + 3);
        ctx.restore();
      });
    }
  }

  window.VolumeProfile = {
    init: init,
    destroy: destroy,
    setCandles: setCandles,
    setContext: setContext,
    setMode: setMode,
    updateSettings: updateSettings,
    getSettings: getSettings,
    refresh: refresh,
    render: render,
  };
})();
