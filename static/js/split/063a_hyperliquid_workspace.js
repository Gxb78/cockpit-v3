// ---------- Hyperliquid workspace: integrated FOOTPRINT / HEATMAP layers ----------
(function () {
  'use strict';

  var STORAGE_KEY = 'chartWorkspaceSettings';
  var WS_URL = 'wss://api.hyperliquid.xyz/ws';
  var settings = {
    mode: 'profile',
    metric: 'notional',
    profileType: 'session',
    rowSize: 'auto',
    vaPercent: 70,
  };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')); } catch (e) {}

  var state = {
    chart: null,
    series: null,
    container: null,
    canvas: null,
    ctx: null,
    coin: 'BTC',
    interval: '3m',
    candles: [],
    profile: null,
    footprint: null,
    heatmap: null,
    requestId: 0,
    resizeObserver: null,
    refreshTimer: null,
    tradeRefreshTimer: null,
    bookPollTimer: null,
    liveWs: null,
    liveGeneration: 0,
    liveCoin: null,
    liveConnected: false,
    liveBooks: [],
    liveTrades: [],
    liveTradesSeen: 0,
    reconnectTimer: null,
  };

  function _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) {}
  }

  function _status(text, type) {
    var el = document.getElementById('chartDataStatus');
    if (!el) return;
    el.className = 'workspace-data-status' + (type ? ' ' + type : '');
    el.textContent = text;
  }

  function _syncStatus() {
    if (settings.mode === 'profile') return;
    var live = state.liveConnected ? 'LIVE' : 'CONNECTING';
    if (settings.mode === 'heatmap') {
      _status('HEATMAP | ' + live + ' L2 snapshots | archive gap', 'partial');
      return;
    }
    _status('FOOTPRINT | ' + live + ' trades | history partial', 'partial');
  }

  function _ensureCanvas() {
    if (!state.container) return;
    if (!state.canvas) {
      state.canvas = document.createElement('canvas');
      state.canvas.className = 'hl-workspace-overlay';
      state.container.appendChild(state.canvas);
      state.ctx = state.canvas.getContext('2d');
    }
    _resize();
  }

  function _resize() {
    if (!state.canvas || !state.container) return;
    var rect = state.container.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    state.canvas.width = Math.round(rect.width * dpr);
    state.canvas.height = Math.round(rect.height * dpr);
    state.canvas.style.width = rect.width + 'px';
    state.canvas.style.height = rect.height + 'px';
    state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  function init(chart, series, container) {
    state.chart = chart;
    state.series = series;
    state.container = container;
    _ensureCanvas();
    if (state.resizeObserver) state.resizeObserver.disconnect();
    state.resizeObserver = new ResizeObserver(_resize);
    state.resizeObserver.observe(container);
    setMode(settings.mode);
  }

  function setContext(context) {
    context = context || {};
    var priorCoin = state.coin;
    state.coin = context.coin || state.coin;
    state.interval = context.interval || state.interval;
    state.candles = context.candles || state.candles;
    if (priorCoin !== state.coin && settings.mode !== 'profile') {
      _disconnectLive();
      state.liveBooks = [];
      state.liveTrades = [];
      state.liveTradesSeen = 0;
      _startLive();
    }
    if (settings.mode !== 'profile') refresh();
  }

  function _range() {
    var end = state.candles.length
      ? Math.max(state.candles[state.candles.length - 1].time * 1000 + 1, Date.now())
      : Date.now();
    var start = state.candles.length
      ? state.candles[Math.max(0, state.candles.length - 150)].time * 1000
      : end - 6 * 60 * 60 * 1000;
    return { start: start, end: end };
  }

  function _baseParams(range) {
    return 'coin=' + encodeURIComponent(state.coin)
      + '&startTime=' + Math.floor(range.start) + '&endTime=' + Math.floor(range.end)
      + '&metric=' + encodeURIComponent(settings.metric)
      + '&rowSize=' + encodeURIComponent(settings.rowSize);
  }

  function refresh() {
    if (settings.mode === 'profile') return;
    var range = _range();
    var token = ++state.requestId;
    var base = _baseParams(range);
    var profileUrl = '/api/hyperliquid/analytics/volume-profile?' + base
      + '&vaPercent=' + settings.vaPercent + '&profileType=' + settings.profileType;
    var dataUrl = settings.mode === 'footprint'
      ? '/api/hyperliquid/analytics/footprint?' + base + '&interval=' + encodeURIComponent(state.interval) + '&imbalanceRatio=3&stack=3'
      : '/api/hyperliquid/analytics/heatmap?' + base + '&resolution=5s';
    Promise.all([
      fetch(profileUrl).then(function (r) { return r.json(); }),
      fetch(dataUrl).then(function (r) { return r.json(); }),
    ]).then(function (responses) {
      if (token !== state.requestId) return;
      state.profile = responses[0];
      if (settings.mode === 'footprint') state.footprint = responses[1];
      else state.heatmap = responses[1];
      _syncStatus();
      render();
    }).catch(function () {
      if (token !== state.requestId) return;
      _status('Hyperliquid analytics unavailable', 'gap');
      render();
    });
  }

  function _disconnectLive() {
    state.liveGeneration++;
    state.liveConnected = false;
    state.liveCoin = null;
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    var socket = state.liveWs;
    state.liveWs = null;
    if (!socket) return;
    try {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) {
        socket.close(1000, 'workspace-mode-change');
      }
    } catch (e) {}
  }

  function _scheduleTradeRefresh() {
    if (state.tradeRefreshTimer) return;
    state.tradeRefreshTimer = setTimeout(function () {
      state.tradeRefreshTimer = null;
      if (settings.mode === 'footprint') refresh();
    }, 350);
  }

  function _pushBookSnapshot(rows, timeMs) {
    if (!rows.length) return;
    state.liveBooks.push({ timeMs: timeMs || Date.now(), rows: rows });
    if (state.liveBooks.length > 120) state.liveBooks.splice(0, state.liveBooks.length - 120);
    render();
  }

  function _normalizeWsTrade(row) {
    if (!row) return null;
    var timeMs = Number(row.timeMs || row.time || Date.now());
    var price = Number(row.price || row.px);
    var size = Number(row.sizeBase || row.sz || row.size);
    if (!Number.isFinite(timeMs) || !Number.isFinite(price) || !Number.isFinite(size) || price <= 0 || size <= 0) {
      return null;
    }
    var rawSide = String(row.aggressorSide || row.side || '').toUpperCase();
    var side = rawSide === 'B' || rawSide === 'BUY' ? 'buy'
      : rawSide === 'A' || rawSide === 'S' || rawSide === 'SELL' ? 'sell'
      : null;
    return {
      timeMs: timeMs,
      price: price,
      sizeBase: size,
      notionalUsd: price * size,
      aggressorSide: side,
    };
  }

  function _pushTrades(rows) {
    var added = 0;
    (rows || []).forEach(function (row) {
      var normalized = _normalizeWsTrade(row);
      if (!normalized) return;
      state.liveTrades.push(normalized);
      added++;
    });
    if (!added) return;
    state.liveTradesSeen += added;
    if (state.liveTrades.length > 1200) state.liveTrades.splice(0, state.liveTrades.length - 1200);
    render();
  }

  function _ingestWsBook(book) {
    var levels = book && book.levels || [[], []];
    var rows = {};
    [[0, 'bidSize'], [1, 'askSize']].forEach(function (side) {
      (levels[side[0]] || []).forEach(function (level) {
        var px = Number(level.px);
        var sz = Number(level.sz);
        if (!Number.isFinite(px) || !Number.isFinite(sz)) return;
        if (!rows[px]) rows[px] = { price: px, bidSize: 0, askSize: 0 };
        rows[px][side[1]] = sz;
      });
    });
    _pushBookSnapshot(Object.keys(rows).map(function (key) { return rows[key]; }), Number(book.time) || Date.now());
  }

  function _primeBook() {
    if (settings.mode !== 'heatmap') return;
    fetch('/api/hyperliquid/orderbook?market=' + encodeURIComponent(state.coin) + '&force=1')
      .then(function (response) { return response.json(); })
      .then(function (book) {
        var rows = {};
        [['bids', 'bidSize'], ['asks', 'askSize']].forEach(function (side) {
          (book[side[0]] || []).forEach(function (level) {
            var px = Number(level.price);
            var sz = Number(level.size);
            if (!Number.isFinite(px) || !Number.isFinite(sz)) return;
            if (!rows[px]) rows[px] = { price: px, bidSize: 0, askSize: 0 };
            rows[px][side[1]] = sz;
          });
        });
        _pushBookSnapshot(Object.keys(rows).map(function (key) { return rows[key]; }), Number(book.time) || Date.now());
      }).catch(function () {});
  }

  function _startLive() {
    if (settings.mode === 'profile') return;
    if (state.liveWs && state.liveCoin === state.coin
        && (state.liveWs.readyState === WebSocket.CONNECTING || state.liveWs.readyState === WebSocket.OPEN)) {
      return;
    }
    _disconnectLive();
    state.liveCoin = state.coin;
    var generation = ++state.liveGeneration;
    var socket;
    try {
      socket = new WebSocket(WS_URL);
    } catch (e) {
      _syncStatus();
      return;
    }
    state.liveWs = socket;
    socket.onopen = function () {
      if (generation !== state.liveGeneration || state.liveWs !== socket) return;
      state.liveConnected = true;
      socket.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'trades', coin: state.coin } }));
      socket.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'l2Book', coin: state.coin } }));
      _syncStatus();
    };
    socket.onmessage = function (event) {
      if (generation !== state.liveGeneration || state.liveWs !== socket) return;
      var payload;
      try { payload = JSON.parse(event.data); } catch (e) { return; }
      if (payload.channel === 'trades' && Array.isArray(payload.data)) {
        _pushTrades(payload.data);
        _scheduleTradeRefresh();
      } else if (payload.channel === 'l2Book' && payload.data) {
        _ingestWsBook(payload.data);
      }
    };
    socket.onerror = function () {
      if (generation !== state.liveGeneration || state.liveWs !== socket) return;
      state.liveConnected = false;
      _syncStatus();
    };
    socket.onclose = function () {
      if (generation !== state.liveGeneration || state.liveWs !== socket) return;
      state.liveConnected = false;
      state.liveWs = null;
      _syncStatus();
      state.reconnectTimer = setTimeout(function () {
        if (generation === state.liveGeneration && settings.mode !== 'profile') _startLive();
      }, 2000);
    };
  }

  function _startModeRuntime() {
    if (state.refreshTimer) clearInterval(state.refreshTimer);
    if (state.bookPollTimer) clearInterval(state.bookPollTimer);
    state.refreshTimer = null;
    state.bookPollTimer = null;
    if (settings.mode === 'profile') {
      _disconnectLive();
      return;
    }
    _startLive();
    state.refreshTimer = setInterval(function () {
      if (settings.mode !== 'profile') refresh();
    }, settings.mode === 'footprint' ? 1800 : 8000);
    if (settings.mode === 'heatmap') {
      _primeBook();
      state.bookPollTimer = setInterval(_primeBook, 2000);
    }
  }

  function setMode(mode) {
    mode = String(mode || 'profile').toLowerCase();
    if (['profile', 'footprint', 'heatmap'].indexOf(mode) < 0) mode = 'profile';
    settings.mode = mode;
    _save();
    document.querySelectorAll('.workspace-mode').forEach(function (button) {
      button.classList.toggle('active', button.dataset.workspaceMode === mode);
    });
    _ensureCanvas();
    state.canvas.style.display = mode === 'profile' ? 'none' : 'block';
    if (window.VolumeProfile && window.VolumeProfile.setMode) window.VolumeProfile.setMode(mode);
    _startModeRuntime();
    if (mode !== 'profile') {
      _syncStatus();
      refresh();
    } else {
      render();
    }
  }

  function updateSettings(patch) {
    Object.assign(settings, patch || {});
    _save();
    if (settings.mode !== 'profile') refresh();
  }

  function _fmt(value) {
    if (!Number.isFinite(Number(value))) return '-';
    var abs = Math.abs(Number(value));
    if (abs >= 1000000) return (Number(value) / 1000000).toFixed(1) + 'M';
    if (abs >= 1000) return (Number(value) / 1000).toFixed(1) + 'k';
    if (abs >= 10) return Number(value).toFixed(0);
    return Number(value).toFixed(1);
  }

  function _priceY(value) {
    try { return state.series && state.series.priceToCoordinate(Number(value)); } catch (e) { return null; }
  }

  function _timeX(timeMs) {
    try { return state.chart && state.chart.timeScale().timeToCoordinate(Number(timeMs) / 1000); } catch (e) { return null; }
  }

  function _intervalMs(interval) {
    var match = String(interval || '3m').match(/^(\d+)([mhdw])$/);
    if (!match) return 180000;
    var value = Number(match[1]) || 3;
    var unit = match[2];
    if (unit === 'm') return value * 60000;
    if (unit === 'h') return value * 3600000;
    if (unit === 'd') return value * 86400000;
    return value * 7 * 86400000;
  }

  function _timeXInterpolated(timeMs) {
    var direct = _timeX(timeMs);
    if (direct != null) return direct;
    var candles = state.candles || [];
    var tSec = Number(timeMs) / 1000;
    if (!candles.length || !Number.isFinite(tSec)) return null;
    for (var i = 1; i < candles.length; i++) {
      var prev = candles[i - 1];
      var next = candles[i];
      if (tSec >= prev.time && tSec <= next.time) {
        var x0 = _timeX(prev.time * 1000);
        var x1 = _timeX(next.time * 1000);
        if (x0 != null && x1 != null && next.time !== prev.time) {
          return x0 + (x1 - x0) * ((tSec - prev.time) / (next.time - prev.time));
        }
      }
    }
    var spacing = _barSpacing();
    var intervalSec = Math.max(1, _intervalMs(state.interval) / 1000);
    var first = candles[0];
    var last = candles[candles.length - 1];
    if (tSec < first.time) {
      var firstX = _timeX(first.time * 1000);
      return firstX == null ? null : firstX - ((first.time - tSec) / intervalSec) * spacing;
    }
    var lastX = _timeX(last.time * 1000);
    return lastX == null ? null : lastX + ((tSec - last.time) / intervalSec) * spacing;
  }

  function _barSpacing() {
    if (state.candles.length < 2) return 44;
    var current = _timeX(state.candles[state.candles.length - 1].time * 1000);
    var prior = _timeX(state.candles[state.candles.length - 2].time * 1000);
    return current != null && prior != null ? Math.abs(current - prior) : 44;
  }

  function _label(ctx, x, y, text, color) {
    ctx.font = '700 10px "JetBrains Mono", monospace';
    var width = ctx.measureText(text).width + 16;
    ctx.fillStyle = 'rgba(8, 15, 21, 0.92)';
    ctx.fillRect(x, y, width, 21);
    ctx.strokeStyle = 'rgba(113, 137, 154, 0.16)';
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, 20);
    ctx.fillStyle = color;
    ctx.fillText(text, x + 8, y + 14);
    return width;
  }

  function render() {
    if (!state.ctx || !state.canvas || settings.mode === 'profile') return;
    var dpr = window.devicePixelRatio || 1;
    var width = state.canvas.width / dpr;
    var height = state.canvas.height / dpr;
    var ctx = state.ctx;
    ctx.clearRect(0, 0, width, height);

    var top = 40;
    var bottom = height - 42;
    var profileWidth = Math.min(270, Math.max(180, width * 0.20));
    var right = width - 56;
    var profileLeft = right - profileWidth;
    var plotRight = profileLeft - 22;

    ctx.fillStyle = 'rgba(6, 13, 19, 0.64)';
    ctx.fillRect(profileLeft - 12, 0, profileWidth + 20, bottom);
    ctx.strokeStyle = 'rgba(56, 211, 238, 0.08)';
    ctx.beginPath();
    ctx.moveTo(profileLeft - 12, top);
    ctx.lineTo(profileLeft - 12, bottom);
    ctx.stroke();

    var title = settings.mode === 'footprint'
      ? 'FOOTPRINT  /  SELL x BUY (AGGRESSIVE)'
      : 'HEATMAP  /  OBSERVED L2 LIQUIDITY';
    _label(ctx, 18, 14, title, '#b4cbd8');
    if (state.liveConnected) _label(ctx, 18, 42, 'LIVE  ' + state.coin + '-PERP', '#22d3ee');
    else _label(ctx, 18, 42, 'CONNECTING LIVE  ' + state.coin + '-PERP', '#f6c366');

    if (settings.mode === 'heatmap') _drawHeatmap(ctx, plotRight, top, bottom);
    else _drawFootprint(ctx, plotRight, top, bottom);
    _drawProfile(ctx, profileLeft, right, top, bottom);
  }

  function _drawHeatmapModern(ctx, plotRight, top, bottom) {
    var tiles = state.heatmap && state.heatmap.tiles || [];
    var snapshots = state.liveBooks || [];
    var allBooks = [];
    var tileGroup = {};

    tiles.forEach(function (tile) {
      if (!tileGroup[tile.timeMs]) tileGroup[tile.timeMs] = [];
      tileGroup[tile.timeMs].push(tile);
    });
    Object.keys(tileGroup).forEach(function (key) {
      allBooks.push({
        timeMs: Number(key),
        rows: tileGroup[key].map(function (tile) {
          return {
            price: Number(tile.price),
            bidSize: Number(tile.bidSize) || 0,
            askSize: Number(tile.askSize) || 0,
          };
        }),
      });
    });
    snapshots.forEach(function (book) {
      allBooks.push({
        timeMs: Number(book.timeMs) || Date.now(),
        rows: (book.rows || []).map(function (row) {
          return {
            price: Number(row.price),
            bidSize: Number(row.bidSize) || 0,
            askSize: Number(row.askSize) || 0,
          };
        }),
      });
    });
    allBooks.sort(function (a, b) { return a.timeMs - b.timeMs; });

    if (!allBooks.length) {
      _label(ctx, 18, 72, 'WAITING FOR L2 BOOK DATA  /  HISTORICAL ARCHIVE NOT LOADED', '#f6c366');
      return true;
    }

    var timeline = allBooks.map(function (book) {
      return { book: book, x: _timeXInterpolated(book.timeMs), synthetic: false };
    }).filter(function (item) {
      return item.x != null && item.x >= -80 && item.x <= plotRight + 80;
    });

    var syntheticMode = false;
    var timelineWidth = timeline.length ? timeline[timeline.length - 1].x - timeline[0].x : 0;
    if (((!tiles.length && snapshots.length) || (snapshots.length > 4 && timelineWidth < 160))) {
      var live = snapshots.slice(-96);
      var left = Math.max(76, plotRight - Math.min(560, Math.max(180, plotRight - 110)));
      var rightEdge = plotRight - 96;
      var span = Math.max(80, rightEdge - left);
      timeline = live.map(function (book, index) {
        var ratio = live.length <= 1 ? 1 : index / (live.length - 1);
        return { book: book, x: left + span * ratio, synthetic: true };
      });
      syntheticMode = true;
    }

    if (!timeline.length) {
      _label(ctx, 18, 72, 'L2 DATA OUTSIDE CURRENT VIEW  /  PAN TO LIVE BOOK', '#f6c366');
      return true;
    }

    var maxL2Size = 1;
    timeline.forEach(function (item) {
      (item.book.rows || []).forEach(function (row) {
        maxL2Size = Math.max(maxL2Size, Number(row.bidSize) || 0, Number(row.askSize) || 0);
      });
    });

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top, plotRight, bottom - top);
    ctx.clip();

    for (var idx = 0; idx < timeline.length; idx++) {
      var item = timeline[idx];
      var next = timeline[idx + 1];
      var x = item.x;
      var w = next ? Math.max(2, Math.min(18, next.x - x + 0.75))
        : (item.synthetic ? 5 : Math.max(4, Math.min(16, _barSpacing() * 0.18)));
      var rows = (item.book.rows || []).slice().sort(function (a, b) { return b.price - a.price; });

      for (var rIdx = 0; rIdx < rows.length; rIdx++) {
        var row = rows[rIdx];
        var y = _priceY(row.price);
        if (y == null || y < top - 20 || y > bottom + 20) continue;
        var nextRow = rows[rIdx + 1];
        var nextY = nextRow ? _priceY(nextRow.price) : null;
        var h = nextY != null && nextY > y ? nextY - y : 6;
        h = Math.max(1.5, Math.min(14, h + 0.5));

        var bid = Number(row.bidSize) || 0;
        var ask = Number(row.askSize) || 0;
        if (bid > 0) {
          var bidAlpha = 0.035 + Math.min(0.76, Math.log1p(bid) / Math.log1p(maxL2Size) * 0.70);
          ctx.fillStyle = 'rgba(34, 211, 238, ' + bidAlpha + ')';
          ctx.fillRect(x, y - h / 2, w, h);
        }
        if (ask > 0) {
          var askAlpha = 0.035 + Math.min(0.76, Math.log1p(ask) / Math.log1p(maxL2Size) * 0.70);
          ctx.fillStyle = 'rgba(251, 113, 133, ' + askAlpha + ')';
          ctx.fillRect(x, y - h / 2, w, h);
        }
      }
    }

    var oldestLive = snapshots.length ? snapshots[0].timeMs : null;
    var newestLive = snapshots.length ? snapshots[snapshots.length - 1].timeMs : null;
    var liveLeft = Math.max(76, plotRight - 560);
    var liveRight = plotRight - 98;
    var maxTradeSize = Math.max.apply(null, [1].concat((state.liveTrades || []).map(function (trade) {
      return Number(trade.sizeBase) || 0;
    })));
    (state.liveTrades || []).slice(-260).forEach(function (trade) {
      var x = _timeXInterpolated(trade.timeMs);
      if ((x == null || x < -50 || x > plotRight + 50) && oldestLive && newestLive && newestLive > oldestLive) {
        var ratio = Math.max(0, Math.min(1, (trade.timeMs - oldestLive) / (newestLive - oldestLive)));
        x = liveLeft + (liveRight - liveLeft) * ratio;
      }
      var y = _priceY(trade.price);
      if (x == null || y == null || x < -30 || x > plotRight + 30 || y < top || y > bottom) return;
      var radius = Math.max(2, Math.min(11, 2 + Math.log1p(trade.sizeBase) / Math.log1p(maxTradeSize) * 8));
      ctx.fillStyle = trade.aggressorSide === 'buy' ? 'rgba(34, 211, 238, 0.88)' : 'rgba(251, 113, 133, 0.86)';
      ctx.strokeStyle = 'rgba(4, 10, 15, 0.72)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });

    if (state.heatmap && state.heatmap.partial) {
      ctx.strokeStyle = 'rgba(246, 195, 102, 0.10)';
      ctx.lineWidth = 1;
      for (var hatch = -bottom; hatch < plotRight; hatch += 22) {
        ctx.beginPath();
        ctx.moveTo(hatch, bottom);
        ctx.lineTo(hatch + 80, bottom - 80);
        ctx.stroke();
      }
    }
    ctx.restore();

    var currentBook = snapshots.length ? snapshots[snapshots.length - 1] : allBooks[allBooks.length - 1];
    if (currentBook) {
      ctx.save();
      var domWidth = 92;
      var domLeft = plotRight - domWidth;
      ctx.fillStyle = 'rgba(7, 14, 20, 0.48)';
      ctx.fillRect(domLeft, top, domWidth, bottom - top);
      ctx.fillStyle = '#647887';
      ctx.font = '700 8px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText('LIVE DOM', domLeft + 6, top + 12);

      var currentRows = (currentBook.rows || []).slice().sort(function (a, b) { return b.price - a.price; });
      var maxDomSize = Math.max.apply(null, [1].concat(currentRows.map(function (row) {
        return Math.max(Number(row.bidSize) || 0, Number(row.askSize) || 0);
      })));
      currentRows.forEach(function (row) {
        var y = _priceY(row.price);
        if (y == null || y < top || y > bottom) return;
        var bid = Number(row.bidSize) || 0;
        var ask = Number(row.askSize) || 0;
        var size = Math.max(bid, ask);
        if (size <= 0) return;
        var barW = Math.min(domWidth - 6, (size / maxDomSize) * (domWidth - 6));
        var xStart = plotRight - barW;
        ctx.fillStyle = bid >= ask ? 'rgba(34, 211, 238, 0.30)' : 'rgba(251, 113, 133, 0.28)';
        ctx.fillRect(xStart, y - 2, barW, 4);
        ctx.fillStyle = bid >= ask ? '#22d3ee' : '#fb7185';
        ctx.fillRect(xStart, y - 2, 2, 4);
        if (size >= maxDomSize * 0.08 && barW > 30) {
          ctx.font = 'bold 8px "JetBrains Mono", monospace';
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'right';
          ctx.fillText(Math.round(size), plotRight - 4, y + 3);
        }
      });
      ctx.restore();
    }

    var totalBidSize = 0;
    var totalAskSize = 0;
    var maxBidWall = { price: 0, size: 0 };
    var maxAskWall = { price: 0, size: 0 };
    if (currentBook) {
      (currentBook.rows || []).forEach(function (row) {
        var bid = Number(row.bidSize) || 0;
        var ask = Number(row.askSize) || 0;
        totalBidSize += bid;
        totalAskSize += ask;
        if (bid > maxBidWall.size) maxBidWall = { price: Number(row.price) || 0, size: bid };
        if (ask > maxAskWall.size) maxAskWall = { price: Number(row.price) || 0, size: ask };
      });
    }

    var totalBook = totalBidSize + totalAskSize || 1;
    var bidPct = Math.round(totalBidSize / totalBook * 100);
    var askPct = 100 - bidPct;
    ctx.save();
    ctx.fillStyle = 'rgba(7, 13, 20, 0.82)';
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.fillRect(18, 72, 398, 52);
    ctx.strokeRect(18, 72, 398, 52);
    ctx.fillStyle = 'rgba(255,255,255,0.34)';
    ctx.font = 'bold 8px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('BOOK IMBALANCE', 30, 84);
    ctx.fillStyle = 'rgba(251,113,133,0.28)';
    ctx.fillRect(30, 90, 124, 5);
    ctx.fillStyle = '#22d3ee';
    ctx.fillRect(30, 90, 124 * (bidPct / 100), 5);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(bidPct + '% Bids / ' + askPct + '% Asks', 30, 108);
    ctx.fillStyle = 'rgba(255,255,255,0.34)';
    ctx.fillText('LIQUIDITY WALLS (DOM)', 184, 84);
    ctx.fillStyle = '#22d3ee';
    ctx.fillText('BUY WALL  $' + maxBidWall.price.toFixed(1) + '  ' + Math.round(maxBidWall.size), 184, 98);
    ctx.fillStyle = '#fb7185';
    ctx.fillText('SELL WALL $' + maxAskWall.price.toFixed(1) + '  ' + Math.round(maxAskWall.size), 184, 112);
    ctx.restore();

    var modeText = syntheticMode ? 'LIVE L2 BOOK STRIP' : 'TIME-ALIGNED L2 BOOK';
    _label(ctx, 18, bottom - 28, modeText + '  /  TRADES AS BUBBLES  /  NO LIQUIDITY INTERPOLATION', '#f6c366');
    return true;
  }

  function _drawHeatmap(ctx, plotRight, top, bottom) {
    if (_drawHeatmapModern(ctx, plotRight, top, bottom)) return;
    var tiles = state.heatmap && state.heatmap.tiles || [];
    var snapshots = state.liveBooks || [];

    // Unifier les tuiles historiques et les snapshots live dans une seule chronologie
    var allBooks = [];

    // 1. Ajouter les tuiles historiques (groupées par timeMs)
    var tileGroup = {};
    tiles.forEach(function(tile) {
      if (!tileGroup[tile.timeMs]) tileGroup[tile.timeMs] = [];
      tileGroup[tile.timeMs].push(tile);
    });
    Object.keys(tileGroup).forEach(function(tStr) {
      var tMs = Number(tStr);
      allBooks.push({
        timeMs: tMs,
        rows: tileGroup[tStr].map(function(tile) {
          return {
            price: Number(tile.price),
            bidSize: Number(tile.bidSize) || 0,
            askSize: Number(tile.askSize) || 0
          };
        })
      });
    });

    // 2. Ajouter les snapshots live L2
    snapshots.forEach(function(book) {
      allBooks.push({
        timeMs: book.timeMs,
        rows: book.rows.map(function(row) {
          return {
            price: Number(row.price),
            bidSize: Number(row.bidSize) || 0,
            askSize: Number(row.askSize) || 0
          };
        })
      });
    });

    // Trier chronologiquement par timeMs croissant
    allBooks.sort(function(a, b) { return a.timeMs - b.timeMs; });

    if (allBooks.length === 0) {
      _label(ctx, 18, 72, 'WAITING FOR L2 BOOK DATA  /  HISTORICAL ARCHIVE NOT LOADED', '#f6c366');
      return;
    }

    // Trouver la taille maximale de l'orderbook dans le range visible pour calibrer la brillance (opacité)
    var maxL2Size = 1;
    var visibleBooks = allBooks.filter(function(b) {
      var x = _timeX(b.timeMs);
      return x != null && x >= -50 && x <= plotRight + 50;
    });

    visibleBooks.forEach(function(b) {
      b.rows.forEach(function(r) {
        var size = Math.max(r.bidSize, r.askSize);
        if (size > maxL2Size) maxL2Size = size;
      });
    });

    // 3. RESSORT DE LA HEATMAP EN ARRIÈRE-PLAN CONTINU (INTEGRATED BACKGROUND)
    for (var idx = 0; idx < allBooks.length; idx++) {
      var book = allBooks[idx];
      var x = _timeX(book.timeMs);
      if (x == null || x < -50 || x > plotRight + 50) continue;

      var nextBook = allBooks[idx + 1];
      var nextX = nextBook ? _timeX(nextBook.timeMs) : null;
      var w = (nextX != null && nextX > x) ? (nextX - x) : 10; // par défaut 10px
      w = Math.max(1, w + 0.5); // léger overlap pour éviter les lignes de découpe blanches

      var sortedRows = book.rows.slice().sort(function(a, b) { return b.price - a.price; });

      for (var rIdx = 0; rIdx < sortedRows.length; rIdx++) {
        var row = sortedRows[rIdx];
        var y = _priceY(row.price);
        if (y == null || y < top - 20 || y > bottom + 20) continue;

        var nextRow = sortedRows[rIdx + 1];
        var nextY = nextRow ? _priceY(nextRow.price) : null;
        var h = (nextY != null && nextY > y) ? (nextY - y) : 6; // par défaut 6px
        h = Math.max(1, h + 0.5); // overlap

        var bid = row.bidSize;
        var ask = row.askSize;
        var size = Math.max(bid, ask);
        if (size < 0.01) continue;

        // Échelle logarithmique pour faire ressortir les "murs" de liquidité de manière néon intense
        var ratio = size / maxL2Size;
        var alpha = 0.03 + Math.min(0.85, Math.log1p(ratio * 9) / Math.log1p(9) * 0.70);

        if (bid >= ask) {
          ctx.fillStyle = 'rgba(6, 182, 212, ' + alpha + ')'; // Bleu / Cyan néon pour les Bids
        } else {
          ctx.fillStyle = 'rgba(236, 72, 153, ' + alpha + ')'; // Rose / Magenta néon pour les Asks
        }
        ctx.fillRect(x, y - h / 2, w, h);
      }
    }

    // 4. DRAW DYNAMIC DOM SIDEBAR (DEPTH OF MARKET) DIRECTLY AT THE RIGHT EDGE
    var currentBook = snapshots.length ? snapshots[snapshots.length - 1] : (allBooks.length ? allBooks[allBooks.length - 1] : null);
    if (currentBook) {
      ctx.save();
      // Fond transparent de la zone DOM
      var domWidth = 85; 
      var domLeft = plotRight - domWidth;
      ctx.fillStyle = 'rgba(7, 14, 20, 0.40)';
      ctx.fillRect(domLeft, top, domWidth, bottom - top);

      var sortedCurrent = currentBook.rows.slice().sort(function(a, b) { return b.price - a.price; });
      var maxDomSize = Math.max.apply(null, sortedCurrent.map(function(r) { return Math.max(r.bidSize, r.askSize); })) || 1;

      sortedCurrent.forEach(function (row, rowIndex) {
        var y = _priceY(row.price);
        if (y == null || y < top || y > bottom) return;

        var bid = Number(row.bidSize) || 0;
        var ask = Number(row.askSize) || 0;
        var size = Math.max(bid, ask);
        if (size < 0.01) return;

        var barW = Math.min(domWidth - 4, (size / maxDomSize) * (domWidth - 4));
        var xStart = plotRight - barW;

        // Remplissage horizontal néon aligné sur le prix
        ctx.fillStyle = bid >= ask ? 'rgba(6, 182, 212, 0.28)' : 'rgba(236, 72, 153, 0.25)';
        ctx.fillRect(xStart, y - 2, barW, 4);

        // Bord néon lumineux à l'extrémité
        ctx.fillStyle = bid >= ask ? '#06b6d4' : '#ec4899';
        ctx.fillRect(xStart, y - 2, 2, 4);

        // Afficher les valeurs numériques des gros blocs sur le DOM
        if (size >= maxDomSize * 0.08 && barW > 30) {
          ctx.font = 'bold 8px "JetBrains Mono", monospace';
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'right';
          ctx.fillText(Math.round(size), plotRight - 4, y + 3);
        }
      });
      ctx.restore();
    }

    // 5. HUD METRICS OVERLAY AT TOP-LEFT
    ctx.save();
    var totalBidSize = 0;
    var totalAskSize = 0;
    var maxBidWall = { price: 0, size: 0 };
    var maxAskWall = { price: 0, size: 0 };

    if (currentBook) {
      currentBook.rows.forEach(function (row) {
        var bid = Number(row.bidSize) || 0;
        var ask = Number(row.askSize) || 0;
        totalBidSize += bid;
        totalAskSize += ask;
        if (bid > maxBidWall.size) maxBidWall = { price: row.price, size: bid };
        if (ask > maxAskWall.size) maxAskWall = { price: row.price, size: ask };
      });
    }

    var totalBook = totalBidSize + totalAskSize || 1;
    var bidPct = Math.round(totalBidSize / totalBook * 100);
    var askPct = 100 - bidPct;

    ctx.fillStyle = 'rgba(7, 13, 20, 0.82)';
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.fillRect(18, 72, 380, 48);
    ctx.strokeRect(18, 72, 380, 48);

    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = 'bold 8px "JetBrains Mono", monospace';
    ctx.fillText('BOOK IMBALANCE', 30, 84);
    
    ctx.fillStyle = 'rgba(236,72,153,0.3)'; // magenta asks
    ctx.fillRect(30, 89, 120, 5);
    ctx.fillStyle = '#06b6d4'; // cyan bids
    ctx.fillRect(30, 89, 120 * (bidPct / 100), 5);

    ctx.fillStyle = '#ffffff';
    ctx.fillText(bidPct + '% Bids / ' + askPct + '% Asks', 30, 105);

    if (maxBidWall.size > 0 || maxAskWall.size > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillText('LIQUIDITY WALLS (DOM)', 180, 84);

      ctx.fillStyle = '#06b6d4';
      ctx.fillText('BUY WALL: $' + maxBidWall.price.toFixed(1) + ' (' + Math.round(maxBidWall.size) + ')', 180, 94);
      ctx.fillStyle = '#ec4899';
      ctx.fillText('SELL WALL: $' + maxAskWall.price.toFixed(1) + ' (' + Math.round(maxAskWall.size) + ')', 180, 104);
    }
    ctx.restore();

    _label(ctx, 18, bottom - 28, 'HEATMAP INTEGRATED  /  ACTIVE REAL-TIME L2 ORDERBOOK', '#f6c366');
  }

  function _liveRowSize(trades) {
    var prices = trades.map(function (trade) { return trade.price; });
    if (!prices.length) return 1;
    var high = Math.max.apply(null, prices);
    var low = Math.min.apply(null, prices);
    var tick = high >= 10000 ? 1 : high >= 1000 ? 0.1 : high >= 10 ? 0.01 : 0.0001;
    var desired = Math.max(tick, (high - low) / 36);
    return Math.max(tick, Math.ceil(desired / tick) * tick);
  }

  function _liveFootprintCandles() {
    var trades = (state.liveTrades || []).slice(-900);
    if (!trades.length) return { candles: [], cvd: 0 };
    var intervalMs = _intervalMs(state.interval);
    var rowSize = _liveRowSize(trades);
    var buckets = {};

    trades.forEach(function (trade) {
      var bucketMs = Math.floor(trade.timeMs / intervalMs) * intervalMs;
      var candle = buckets[bucketMs];
      if (!candle) {
        candle = buckets[bucketMs] = {
          time: Math.floor(bucketMs / 1000),
          openTime: bucketMs,
          open: trade.price,
          high: trade.price,
          low: trade.price,
          close: trade.price,
          levels: {},
          buyVolume: 0,
          sellVolume: 0,
          delta: 0,
        };
      }
      candle.high = Math.max(candle.high, trade.price);
      candle.low = Math.min(candle.low, trade.price);
      candle.close = trade.price;
      var price = Math.floor((trade.price + rowSize * 1e-9) / rowSize) * rowSize;
      price = Math.round(price * 100000000) / 100000000;
      var level = candle.levels[price];
      if (!level) {
        level = candle.levels[price] = { price: price, buyVolume: 0, sellVolume: 0, totalVolume: 0, delta: 0 };
      }
      var volume = settings.metric === 'base' ? trade.sizeBase : trade.notionalUsd;
      if (trade.aggressorSide === 'buy') {
        level.buyVolume += volume;
        candle.buyVolume += volume;
      } else if (trade.aggressorSide === 'sell') {
        level.sellVolume += volume;
        candle.sellVolume += volume;
      }
      level.totalVolume += volume;
      level.delta = level.buyVolume - level.sellVolume;
      candle.delta += trade.aggressorSide === 'buy' ? volume : trade.aggressorSide === 'sell' ? -volume : 0;
    });

    var cvd = 0;
    var candles = Object.keys(buckets).sort().map(function (key) {
      var candle = buckets[key];
      cvd += candle.delta;
      candle.cvd = cvd;
      candle.levels = Object.keys(candle.levels).map(function (price) { return candle.levels[price]; })
        .sort(function (a, b) { return a.price - b.price; });
      return candle;
    });
    return { candles: candles, cvd: cvd };
  }

  function _mergeFootprintCandles(serverCandles, liveCandles) {
    var merged = {};
    (serverCandles || []).forEach(function (candle) {
      merged[candle.openTime || candle.time * 1000] = candle;
    });
    (liveCandles || []).forEach(function (candle) {
      merged[candle.openTime || candle.time * 1000] = candle;
    });
    return Object.keys(merged).sort(function (a, b) { return Number(a) - Number(b); }).map(function (key) { return merged[key]; });
  }

  function _drawFootprintDomContext(ctx, plotRight, top, bottom) {
    var book = state.liveBooks.length ? state.liveBooks[state.liveBooks.length - 1] : null;
    if (!book || !book.rows || !book.rows.length) return;
    var width = 72;
    var left = plotRight - width;
    var rows = book.rows.slice().sort(function (a, b) { return b.price - a.price; });
    var maxSize = Math.max.apply(null, [1].concat(rows.map(function (row) {
      return Math.max(Number(row.bidSize) || 0, Number(row.askSize) || 0);
    })));
    ctx.save();
    ctx.fillStyle = 'rgba(7, 14, 20, 0.38)';
    ctx.fillRect(left, top, width, bottom - top);
    ctx.font = '700 8px "JetBrains Mono", monospace';
    ctx.fillStyle = '#647887';
    ctx.textAlign = 'left';
    ctx.fillText('DOM CTX', left + 6, top + 12);
    rows.forEach(function (row) {
      var y = _priceY(row.price);
      if (y == null || y < top || y > bottom) return;
      var bid = Number(row.bidSize) || 0;
      var ask = Number(row.askSize) || 0;
      var size = Math.max(bid, ask);
      if (size <= 0) return;
      var bar = Math.max(2, (size / maxSize) * (width - 8));
      ctx.fillStyle = bid >= ask ? 'rgba(34, 211, 238, 0.24)' : 'rgba(251, 113, 133, 0.22)';
      ctx.fillRect(plotRight - bar, y - 1.5, bar, 3);
    });
    ctx.restore();
  }

  function _drawFootprint(ctx, plotRight, top, bottom) {
    var livePack = _liveFootprintCandles();
    var serverCandles = state.footprint && state.footprint.candles || [];
    var candles = _mergeFootprintCandles(serverCandles, livePack.candles);
    if (!candles.length) {
      _label(ctx, 18, 72, 'WAITING FOR EXECUTED TRADES  /  HISTORY NOT IMPORTED', '#f6c366');
      _drawFootprintDomContext(ctx, plotRight, top, bottom);
      return;
    }
    var spacing = _barSpacing();
    var shown = candles.slice(-Math.max(1, Math.floor(plotRight / 62)));
    var cellWidth = shown.length <= 3 ? Math.max(132, Math.min(168, spacing * 3.4)) : Math.max(46, Math.min(82, spacing * 1.35));

    shown.forEach(function (candle, index) {
      var centerX = _timeX(candle.openTime || candle.time * 1000);
      if (centerX == null) centerX = plotRight - (shown.length - index) * (cellWidth + 4);
      if (centerX < 0 || centerX > plotRight + cellWidth) return;
      var x = Math.min(plotRight - cellWidth - 8, Math.max(56, centerX - cellWidth / 2));
      var levels = candle.levels || [];
      var naturalStep = levels.length > 1 ? Math.abs((_priceY(levels[1].price) || 0) - (_priceY(levels[0].price) || 0)) : 0;
      var magnified = shown.length <= 3 && naturalStep < 13;
      var rowHeight = magnified ? 22 : Math.max(12, Math.min(20, naturalStep || 14));
      var centerY = _priceY(candle.close);
      if (centerY == null) centerY = (top + bottom) / 2;

      ctx.strokeStyle = candle.close >= candle.open ? 'rgba(34,211,238,0.40)' : 'rgba(251,113,133,0.40)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(centerX, _priceY(candle.high) || centerY);
      ctx.lineTo(centerX, _priceY(candle.low) || centerY);
      ctx.stroke();

      if (levels.length === 0) return;

      var sortedLevels = levels.slice().sort(function(a, b) { return b.price - a.price; });

      var maxVol = 0;
      var maxLvlVol = 0;
      var pocLevel = null;
      for (var li = 0; li < sortedLevels.length; li++) {
        var lv = sortedLevels[li];
        var totalVol = (lv.buyVolume || 0) + (lv.sellVolume || 0);
        if (totalVol > maxLvlVol) {
          maxLvlVol = totalVol;
          pocLevel = lv;
        }
        if (lv.buyVolume > maxVol) maxVol = lv.buyVolume;
        if (lv.sellVolume > maxVol) maxVol = lv.sellVolume;
      }
      if (maxVol < 1) maxVol = 1;

      var imbalanceRatio = 3.0;
      for (var li = 0; li < sortedLevels.length; li++) {
        var lv = sortedLevels[li];
        lv.buyImbalance = false;
        lv.sellImbalance = false;

        if (li < sortedLevels.length - 1) {
          var belowBid = sortedLevels[li + 1].sellVolume;
          if (lv.buyVolume >= (belowBid || 0.01) * imbalanceRatio) {
            lv.buyImbalance = true;
          }
        }
        if (li > 0) {
          var aboveAsk = sortedLevels[li - 1].buyVolume;
          if (lv.sellVolume >= (aboveAsk || 0.01) * imbalanceRatio) {
            lv.sellImbalance = true;
          }
        }
      }

      var stackedBuyZones = [];
      var stackedSellZones = [];
      var consecutiveBuys = [];
      var consecutiveSells = [];
      var stackCount = 3;

      for (var li = 0; li < sortedLevels.length; li++) {
        var lv = sortedLevels[li];
        
        if (lv.buyImbalance) consecutiveBuys.push(lv);
        else {
          if (consecutiveBuys.length >= stackCount) stackedBuyZones.push(consecutiveBuys.slice());
          consecutiveBuys = [];
        }

        if (lv.sellImbalance) consecutiveSells.push(lv);
        else {
          if (consecutiveSells.length >= stackCount) stackedSellZones.push(consecutiveSells.slice());
          consecutiveSells = [];
        }
      }
      if (consecutiveBuys.length >= stackCount) stackedBuyZones.push(consecutiveBuys);
      if (consecutiveSells.length >= stackCount) stackedSellZones.push(consecutiveSells);

      var halfW = cellWidth / 2;
      var splitX = x + halfW;

      if (shown.length <= 3) {
        var matrixTop = centerY - sortedLevels.length * rowHeight / 2 - 18;
        var matrixHeight = sortedLevels.length * rowHeight + 38;
        ctx.fillStyle = 'rgba(5, 12, 18, 0.72)';
        ctx.fillRect(x - 7, matrixTop, cellWidth + 14, matrixHeight);
        ctx.strokeStyle = 'rgba(56, 211, 238, 0.18)';
        ctx.strokeRect(x - 7.5, matrixTop + 0.5, cellWidth + 15, matrixHeight - 1);
        ctx.font = '800 8px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#fb7185';
        ctx.fillText('SELL', x + halfW / 2, matrixTop + 12);
        ctx.fillStyle = '#22d3ee';
        ctx.fillText('BUY', splitX + halfW / 2, matrixTop + 12);
      }

      sortedLevels.forEach(function (level, levelIndex) {
        var levelY = magnified
          ? centerY + (sortedLevels.length / 2 - levelIndex - 0.5) * rowHeight
          : _priceY(level.price);
        if (levelY == null || levelY < top || levelY > bottom) return;

        var cellX = x;
        var cellY = levelY - rowHeight / 2;

        var bidAlpha = Math.min(0.85, 0.05 + (level.sellVolume / maxVol) * 0.5);
        ctx.fillStyle = 'rgba(251,113,133,' + bidAlpha + ')';
        ctx.fillRect(cellX, cellY, halfW, rowHeight - 1);

        var askAlpha = Math.min(0.85, 0.05 + (level.buyVolume / maxVol) * 0.5);
        ctx.fillStyle = 'rgba(34,211,238,' + askAlpha + ')';
        ctx.fillRect(splitX, cellY, halfW, rowHeight - 1);

        if (level.buyImbalance) {
          ctx.fillStyle = 'rgba(34,211,238,0.42)';
          ctx.fillRect(splitX, cellY, halfW, rowHeight - 1);
        }
        if (level.sellImbalance) {
          ctx.fillStyle = 'rgba(251,113,133,0.42)';
          ctx.fillRect(cellX, cellY, halfW, rowHeight - 1);
        }

        if (pocLevel && level.price === pocLevel.price) {
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1.2;
          ctx.strokeRect(cellX + 0.5, cellY + 0.5, cellWidth - 1, rowHeight - 2);
        } else {
          ctx.strokeStyle = 'rgba(255,255,255,0.06)';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(cellX, cellY, cellWidth, rowHeight - 1);
        }

        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.beginPath();
        ctx.moveTo(splitX, cellY);
        ctx.lineTo(splitX, cellY + rowHeight - 1);
        ctx.stroke();

        if (rowHeight >= 11 && cellWidth >= 75) {
          ctx.save();
          ctx.font = shown.length <= 3 ? 'bold 10px "JetBrains Mono", monospace' : 'bold 9px "JetBrains Mono", monospace';
          ctx.textBaseline = 'middle';

          ctx.textAlign = 'right';
          ctx.fillStyle = level.sellImbalance ? '#fda4af' : '#ffffff';
          ctx.fillText(_fmt(level.sellVolume), splitX - 4, levelY);

          ctx.textAlign = 'left';
          ctx.fillStyle = level.buyImbalance ? '#67e8f9' : '#ffffff';
          ctx.fillText(_fmt(level.buyVolume), splitX + 4, levelY);

          ctx.restore();
        }
      });

      stackedBuyZones.forEach(function (zone) {
        var topLvl = zone[0];
        var botLvl = zone[zone.length - 1];
        var yTop = (magnified ? centerY + (sortedLevels.length / 2 - sortedLevels.indexOf(topLvl) - 0.5) * rowHeight : _priceY(topLvl.price)) - rowHeight / 2;
        var yBot = (magnified ? centerY + (sortedLevels.length / 2 - sortedLevels.indexOf(botLvl) - 0.5) * rowHeight : _priceY(botLvl.price)) + rowHeight / 2;

        ctx.strokeStyle = '#22d3ee';
        ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(34,211,238,0.13)';
        ctx.fillRect(x, yTop, cellWidth, yBot - yTop);
        ctx.strokeRect(x, yTop, cellWidth, yBot - yTop);
      });

      stackedSellZones.forEach(function (zone) {
        var topLvl = zone[0];
        var botLvl = zone[zone.length - 1];
        var yTop = (magnified ? centerY + (sortedLevels.length / 2 - sortedLevels.indexOf(topLvl) - 0.5) * rowHeight : _priceY(topLvl.price)) - rowHeight / 2;
        var yBot = (magnified ? centerY + (sortedLevels.length / 2 - sortedLevels.indexOf(botLvl) - 0.5) * rowHeight : _priceY(botLvl.price)) + rowHeight / 2;

        ctx.strokeStyle = '#fb7185';
        ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(251,113,133,0.13)';
        ctx.fillRect(x, yTop, cellWidth, yBot - yTop);
        ctx.strokeRect(x, yTop, cellWidth, yBot - yTop);
      });

      ctx.save();
      ctx.font = 'bold 8px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = candle.delta >= 0 ? '#22d3ee' : '#fb7185';
      var labelY = Math.min(bottom - 8, centerY + sortedLevels.length * rowHeight / 2 + 18);
      ctx.fillText((candle.delta >= 0 ? '+' : '') + _fmt(candle.delta), x + cellWidth / 2, labelY);
      ctx.restore();
    });

    ctx.textAlign = 'left';
    _drawFootprintDomContext(ctx, plotRight, top, bottom);
    var cvdValue = (state.footprint && Number.isFinite(Number(state.footprint.cvd))) ? Number(state.footprint.cvd) : 0;
    cvdValue += livePack.cvd || 0;
    _label(ctx, 18, bottom - 28, 'CVD  ' + _fmt(cvdValue) + '  /  EXECUTED TRADES + LIVE DOM CONTEXT', '#f6c366');
  }

  function _drawProfile(ctx, left, right, top, bottom) {
    var profile = state.profile;
    var levels = profile && profile.levels || [];
    ctx.font = '700 9px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#647887';
    ctx.fillText('INTEGRATED VOLUME PROFILE', left, 26);
    if (!levels.length) {
      ctx.fillStyle = '#f6c366';
      ctx.fillText('NO TRADE COVERAGE', left, 44);
      return;
    }
    var maximum = Math.max.apply(null, levels.map(function (level) { return level.totalVolume; })) || 1;
    var width = right - left;
    levels.forEach(function (level) {
      var yy = _priceY(level.price);
      if (yy == null || yy < top || yy > bottom) return;
      var bar = level.totalVolume / maximum * width;
      var sell = level.totalVolume ? bar * level.sellVolume / level.totalVolume : 0;
      ctx.globalAlpha = level.price >= profile.val && level.price <= profile.vah ? 0.88 : 0.35;
      ctx.fillStyle = '#fb7185';
      ctx.fillRect(right - bar, yy - 3, sell, 6);
      ctx.fillStyle = '#22d3ee';
      ctx.fillRect(right - bar + sell, yy - 3, bar - sell, 6);
    });
    ctx.globalAlpha = 1;
    [[profile.poc, '#f59e0b', 'POC'], [profile.vah, '#38d3ee', 'VAH'], [profile.val, '#fb7185', 'VAL']].forEach(function (item) {
      if (item[0] == null) return;
      var yy = _priceY(item[0]);
      if (yy == null || yy < top || yy > bottom) return;
      ctx.strokeStyle = item[1];
      ctx.globalAlpha = item[2] === 'POC' ? 0.90 : 0.48;
      ctx.beginPath();
      ctx.moveTo(left - 8, yy);
      ctx.lineTo(right, yy);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = item[1];
      ctx.fillText(item[2] + ' ' + Number(item[0]).toFixed(2), left, yy - 6);
    });
  }

  window.HyperliquidWorkspace = {
    init: init,
    setContext: setContext,
    setMode: setMode,
    updateSettings: updateSettings,
    getSettings: function () { return Object.assign({}, settings); },
    refresh: refresh,
  };
})();
