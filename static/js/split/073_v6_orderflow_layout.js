// ---------- 073_v6_orderflow_layout.js ----------
// Isolated DOM layout for Cockpit V6 orderflow.
// Phase 7: engine bar, status, counters, pause/resume, EngineClient integration.
// Phase 15: full settings panel, panel toggles, buffer controls, stale detection,
//           localStorage persistence via V6OF.Settings.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};

  // ── REST request cache (TTL per endpoint) ──
  var _restCache = {};
  function _cachedFetch(url, ttlMs) {
    var now = Date.now();
    var entry = _restCache[url];
    if (entry && (now - entry.ts) < ttlMs) {
      return Promise.resolve(entry.data);
    }
    return fetch(url).then(function(r) { return r.json(); }).then(function(data) {
      _restCache[url] = { data: data, ts: now };
      return data;
    });
  }

  function shellHtml() {
    return [
      '<div class="v6-shell">',
        '<header class="v6-header">',
          '<div class="v6-brand">',
            '<span class="v6-brand-mark" aria-hidden="true"></span>',
            '<div class="v6-symbol-pill">',
              '<span class="v6-symbol-ticker" data-v6-symbol>BTC</span>',
              '<span class="v6-symbol-meta" data-v6-interval>1m</span>',
            '</div>',
          '</div>',
          '<div class="v6-timeframes" role="group" aria-label="Timeframe">',
            '<button type="button" class="v6-tf-btn active" data-v6-action="timeframe" data-interval="1m">1m</button>',
            '<button type="button" class="v6-tf-btn" data-v6-action="timeframe" data-interval="3m">3m</button>',
            '<button type="button" class="v6-tf-btn" data-v6-action="timeframe" data-interval="5m">5m</button>',
            '<button type="button" class="v6-tf-btn" data-v6-action="timeframe" data-interval="15m">15m</button>',
            '<button type="button" class="v6-tf-btn" data-v6-action="timeframe" data-interval="30m">30m</button>',
            '<button type="button" class="v6-tf-btn" data-v6-action="timeframe" data-interval="1h">1H</button>',
            '<button type="button" class="v6-tf-btn" data-v6-action="timeframe" data-interval="2h">2H</button>',
            '<button type="button" class="v6-tf-btn" data-v6-action="timeframe" data-interval="4h">4H</button>',
            '<button type="button" class="v6-tf-btn" data-v6-action="timeframe" data-interval="8h">8H</button>',
            '<button type="button" class="v6-tf-btn" data-v6-action="timeframe" data-interval="12h">12H</button>',
            '<button type="button" class="v6-tf-btn" data-v6-action="timeframe" data-interval="1d">1D</button>',
          '</div>',
          '<div class="v6-seg" data-v6-layers role="group" aria-label="Chart layers">',
            '<button type="button" class="v6-seg-btn" data-v6-action="layer" data-layer="candles">Candles</button>',
            '<button type="button" class="v6-seg-btn" data-v6-action="layer" data-layer="bubbles">Bubbles</button>',
            '<button type="button" class="v6-seg-btn" data-v6-action="layer" data-layer="heatmap">Heatmap</button>',
            '<button type="button" class="v6-seg-btn" data-v6-action="layer" data-layer="footprint">Footprint</button>',
          '</div>',
          '<div class="v6-workspace-holder" data-v6-workspace-container></div>',
          '<div class="v6-source-select">',
            '<button type="button" class="v6-source-btn" data-v6-action="source" data-source="hyperliquid">HL</button>',
            '<button type="button" class="v6-source-btn active" data-v6-action="source" data-source="binance">BN</button>',
          '</div>',
          '<div class="v6-header-live">',
            '<span class="v6-stat"><em>Last</em><strong data-v6-last>--</strong></span>',
            '<span class="v6-stat"><em>CVD</em><strong data-v6-cvd>--</strong></span>',
          '</div>',
          '<div class="v6-ticket" aria-label="Live quote">',
            '<div class="v6-ticket-side is-sell"><em>BID</em><strong data-v6-ticket-bid>--</strong></div>',
            '<div class="v6-ticket-mid"><em>SPR</em><span data-v6-ticket-spread>--</span></div>',
            '<div class="v6-ticket-side is-buy"><em>ASK</em><strong data-v6-ticket-ask>--</strong></div>',
          '</div>',
          '<div class="v6-header-actions">',
            '<span class="v6-conn" data-v6-conn title="Local engine">',
              '<span class="v6-engine-dot" data-v6-engine-dot></span>',
              '<span class="v6-conn-text" data-v6-engine-status-text>Connecting…</span>',
            '</span>',
          '</div>',
        '</header>',
        '<div class="v6-grid">',
          '<section class="v6-panel v6-panel-tape" data-v6-panel="tape" aria-label="V6 tape">',
            '<div class="v6-panel-head"><span>Tape</span><small>Time and sales</small></div>',
            '<div class="v6-panel-body v6-tape-body">',
              '<div class="v6-tape-list-container" data-v6-tape-list></div>',
              '<div class="v6-lad-foot v6-tape-footer" data-v6-tape-footer>',
                '<label class="v6-lad-group">Min Size ',
                  '<input type="number" class="v6-tape-minqty-input" data-v6-setting="minQty" value="0" min="0" step="0.01" style="width: 55px;" />',
                '</label>',
                '<label class="v6-lad-group">Font Size ',
                  '<input type="number" class="v6-tape-size-input" data-v6-setting="tapeFontSize" value="10" min="8" max="20" step="1" style="width: 40px;" />',
                '</label>',
              '</div>',
            '</div>',
          '</section>',
          '<section class="v6-panel v6-panel-chart" aria-label="V6 chart">',
            '<div class="v6-panel-head"><span>Chart</span><small></small></div>',
            '<canvas class="v6-chart-canvas" data-v6-chart></canvas>',
          '</section>',
          '<section class="v6-panel v6-panel-dom" data-v6-panel="dom" aria-label="V6 DOM">',
            '<div class="v6-panel-head"><span>DOM</span><small></small></div>',
            '<div class="v6-panel-body v6-dom-body">',
              '<div class="v6-dom-table-container" data-v6-dom-list></div>',
              '<div class="v6-lad-foot v6-dom-foot" data-v6-dom-footer>',
                '<span>Spread <strong data-v6-dom-spread>--</strong></span>',
                '<span>Mid <strong data-v6-dom-mid>--</strong></span>',
                '<label class="v6-lad-group">Group ',
                  '<input type="number" class="v6-group-input" data-v6-setting="domGroup" value="1" min="1" max="100" step="1" style="width: 42px;" />',
                '</label>',
                '<span class="is-poc" data-v6-dom-poc-wrap style="display: none;">POC <strong data-v6-dom-poc>--</strong></span>',
                '<span data-v6-dom-time>--</span>',
              '</div>',
            '</div>',
          '</section>',
          '<section class="v6-panel v6-panel-settings" aria-label="V6 settings">',
            '<div class="v6-panel-head"><span>Settings</span><small>Controls</small></div>',
            '<div class="v6-settings" data-v6-settings-body>',
              // -- Chart Mode --
              '<div class="v6-settings-section">',
                '<div class="v6-settings-section-title">Chart</div>',
                '<label class="v6-field">Mode',
                  '<select data-v6-setting="chartMode">',
                    '<option value="both">Both</option>',
                    '<option value="heatmap">Heatmap</option>',
                    '<option value="footprint">Footprint</option>',
                    '<option value="none">None</option>',
                  '</select>',
                '</label>',
                '<label class="v6-check"><input type="checkbox" data-v6-setting="showGrid" /><span>Show Grid</span></label>',
                '<label class="v6-field">Background',
                  '<input type="color" data-v6-setting="bgColor" />',
                '</label>',
                '<label class="v6-field">Up Candle',
                  '<input type="color" data-v6-setting="upColor" />',
                '</label>',
                '<label class="v6-field">Down Candle',
                  '<input type="color" data-v6-setting="downColor" />',
                '</label>',
              '</div>',
              // -- Toggles --
              '<div class="v6-settings-section">',
                '<div class="v6-settings-section-title">Panels</div>',
                '<label class="v6-check"><input type="checkbox" data-v6-setting="showTape" /><span>Show Tape</span></label>',
                '<label class="v6-check"><input type="checkbox" data-v6-setting="showDOM" /><span>Show DOM</span></label>',
                '<label class="v6-check"><input type="checkbox" data-v6-setting="showCVD" /><span>Show Delta/CVD</span></label>',
                '<label class="v6-check"><input type="checkbox" data-v6-setting="showHeatmap" /><span>Show Heatmap</span></label>',
                '<label class="v6-check"><input type="checkbox" data-v6-setting="showFootprint" /><span>Show Footprint</span></label>',
                '<label class="v6-check"><input type="checkbox" data-v6-setting="showLastPrice" /><span>Show Last Price</span></label>',
              '</div>',
              // -- Buffers --
              '<div class="v6-settings-section">',
                '<div class="v6-settings-section-title">Buffers</div>',
                '<label class="v6-field">Max trades',
                  '<input type="number" min="50" max="5000" step="50" data-v6-setting="maxTrades" />',
                '</label>',
                '<label class="v6-field">Max heatmap frames',
                  '<input type="number" min="60" max="1000" step="10" data-v6-setting="maxHeatmapFrames" />',
                '</label>',
                '<label class="v6-field">Max footprint candles',
                  '<input type="number" min="30" max="300" step="10" data-v6-setting="maxFootprintCandles" />',
                '</label>',
                '<label class="v6-field">DOM depth (UI)',
                  '<input type="number" min="5" max="50" step="1" data-v6-setting="domDepth" />',
                '</label>',
                '<label class="v6-field">DOM range',
                  '<input type="number" min="25" max="500" step="25" data-v6-setting="domRangeLevels" />',
                '</label>',
                '<label class="v6-field">Wall ratio',
                  '<input type="number" min="2" max="12" step="1" data-v6-setting="domWallRatio" />',
                '</label>',
                '<label class="v6-check"><input type="checkbox" data-v6-setting="domWallsOnly" /><span>Walls only</span></label>',
              '</div>',
              // -- Tape & DOM --
              '<div class="v6-settings-section">',
                '<div class="v6-settings-section-title">Tape & DOM</div>',
                '<label class="v6-field">Tape font size',
                  '<input type="number" min="8" max="20" step="1" data-v6-setting="tapeFontSize" />',
                '</label>',
                '<label class="v6-field">Min trade size',
                  '<input type="number" min="0" step="0.001" data-v6-setting="minQty" />',
                '</label>',
                '<label class="v6-field">Max tape rows',
                  '<input type="number" min="8" max="500" step="1" data-v6-setting="maxRows" />',
                '</label>',
              '</div>',
              // -- Actions --
              '<div class="v6-settings-section v6-settings-actions">',
                '<div class="v6-settings-section-title">Actions</div>',
                '<button type="button" class="v6-btn v6-btn-sm v6-btn-full" data-v6-action="clear-tape">Clear Tape</button>',
                '<button type="button" class="v6-btn v6-btn-sm v6-btn-full" data-v6-action="clear-heatmap">Clear Heatmap</button>',
                '<button type="button" class="v6-btn v6-btn-sm v6-btn-full" data-v6-action="clear-footprint">Clear Footprint</button>',
                '<button type="button" class="v6-btn v6-btn-sm v6-btn-full v6-btn-warn" data-v6-action="clear-all">Clear All UI Buffers</button>',
                '<button type="button" class="v6-btn v6-btn-sm v6-btn-full v6-btn-danger" data-v6-action="reset-settings">Reset UI Settings</button>',
              '</div>',
            '</div>',
          '</section>',
          '<section class="v6-panel v6-panel-cvd" data-v6-panel="cvd" aria-label="V6 CVD and delta">',
            '<div class="v6-panel-head"><span>CVD / Delta</span><small>Session</small></div>',
            '<div class="v6-panel-body" data-v6-cvd-panel></div>',
          '</section>',
        '</div>',
      '</div>',
      '<div class="v6-legacy-strip">',
        '<span>Legacy orderflow canvas visible</span>',
        '<button type="button" class="v6-btn" data-v6-action="v6">Show V6</button>',
      '</div>'
    ].join('');
  }

  function lastPrice(state) {
    // If live trades exist, use the first (newest) trade price
    var trades = state.trades || [];
    if (trades.length) return trades[0].price;
    var candles = state.candles || [];
    return candles.length ? candles[candles.length - 1].close : NaN;
  }

  function latestCvd(state) {
    var settings = state.settings || {};
    var key = String(settings.deltaIntervalMs || 60000);
    var latestByInterval = state.latestDeltaByInterval || {};
    if (latestByInterval[key]) return latestByInterval[key].cvd;
    var buckets = state.deltaBuckets || [];
    return buckets.length ? buckets[buckets.length - 1].cvd : 0;
  }

  function setText(root, selector, value) {
    var el = root.querySelector(selector);
    if (el) el.textContent = value;
  }

  function syncInputs(root, state) {
    var settings = state.settings || {};
    // Selects
    var chartMode = root.querySelector('[data-v6-setting="chartMode"]');
    if (chartMode && document.activeElement !== chartMode) chartMode.value = settings.chartMode || 'both';

    // Checkboxes
    var toggles = ['showTape', 'showDOM', 'showCVD', 'showHeatmap', 'showFootprint', 'showLastPrice', 'showGrid', 'domWallsOnly'];
    var toggleDefaultsOn = { showTape: 1, showDOM: 1, showCVD: 1, showHeatmap: 1, showFootprint: 1, showLastPrice: 1, showGrid: 1 };
    toggles.forEach(function (key) {
      var el = root.querySelector('[data-v6-setting="' + key + '"]');
      if (el) el.checked = toggleDefaultsOn[key] ? settings[key] !== false : settings[key] === true;
    });

    // Number inputs — only sync if not focused
    // Map from data-v6-setting attribute name to store settings key
    var numberMap = {
      maxTrades: 'maxTrades',
      maxHeatmapFrames: 'heatmapMaxFrames',
      maxFootprintCandles: 'footprintMaxCandles',
      domDepth: 'domDepth',
      domRangeLevels: 'domRangeLevels',
      domWallRatio: 'domWallRatio',
      minQty: 'minQty',
      maxRows: 'maxRows',
      tapeFontSize: 'tapeFontSize',
      bgColor: 'bgColor',
      upColor: 'upColor',
      downColor: 'downColor'
    };
    Object.keys(numberMap).forEach(function (htmlKey) {
      var storeKey = numberMap[htmlKey];
      var el = root.querySelector('[data-v6-setting="' + htmlKey + '"]');
      if (el && document.activeElement !== el) {
        el.value = String(settings[storeKey] != null ? settings[storeKey] : '');
      }
    });
  }

  function syncPanelVisibility(root, settings) {
    var panels = {
      tape: settings.showTape !== false,
      dom: settings.showDOM !== false,
      cvd: settings.showCVD !== false
    };
    Object.keys(panels).forEach(function (panelName) {
      var el = root.querySelector('[data-v6-panel="' + panelName + '"]');
      if (el) {
        el.classList.toggle('v6-panel-hidden', !panels[panelName]);
      }
    });
  }

  function normalizeRestDepthBook(data, source) {
    var isHL = source === 'hyperliquid';
    var book = null;
    if (isHL && data && data.ok) {
      book = {
        bids: (data.bids || []).map(function (b) { return { price: Number(b.px), size: Number(b.sz) }; }),
        asks: (data.asks || []).map(function (a) { return { price: Number(a.px), size: Number(a.sz) }; })
      };
    } else if (!isHL && data && Array.isArray(data.bids) && Array.isArray(data.asks)) {
      book = {
        bids: data.bids.map(function (b) { return { price: parseFloat(b[0]), size: parseFloat(b[1]) }; }),
        asks: data.asks.map(function (a) { return { price: parseFloat(a[0]), size: parseFloat(a[1]) }; })
      };
    }
    if (!book) return null;
    book.bids = book.bids.filter(function (b) { return Number.isFinite(b.price) && Number.isFinite(b.size) && b.price > 0 && b.size >= 0; });
    book.asks = book.asks.filter(function (a) { return Number.isFinite(a.price) && Number.isFinite(a.size) && a.price > 0 && a.size >= 0; });
    if (!book.bids.length || !book.asks.length) return null;
    book.bestBid = book.bids[0].price;
    book.bestAsk = book.asks[0].price;
    book.spread = book.bestAsk - book.bestBid;
    book.mid = (book.bestBid + book.bestAsk) / 2;
    book.source = 'rest-depth';
    book.tsLocal = Date.now();
    return book;
  }

  function prefetchDomDepth(store, reason) {
    if (!store) return;
    var state = store.getState ? store.getState() : {};
    var source = state.dataSource || 'binance';
    var url = source === 'hyperliquid'
      ? '/api/hyperliquid/orderbook?market=BTC'
      : '/api/market/depth?symbol=BTCUSDT&limit=5000';
    _cachedFetch(url, 30000).then(function (data) {
      var book = normalizeRestDepthBook(data, source);
      if (!book || !V6OF.DomLadder) return;
      V6OF.DomLadder.feedOrderBook(book);
      store.setState({
        orderBook: book,
        lastOrderBookTs: book.tsLocal,
        restDepthTs: book.tsLocal,
        restDepthCount: Math.min(book.bids ? book.bids.length : 0, book.asks ? book.asks.length : 0)
      }, 'rest-depth-' + (reason || 'prefetch'));
      console.log('[DOM] REST depth prefetch (' + source + '): bids=' + book.bids.length + ' asks=' + book.asks.length + ' reason=' + (reason || ''));
    }).catch(function (e) {
      console.warn('[DOM] REST depth prefetch failed', e);
    });
  }

  function startDomDepthRefresh(root, store) {
    if (!root || !store) return;
    if (root._v6DomDepthRefreshTimer) clearInterval(root._v6DomDepthRefreshTimer);
    root._v6DomDepthRefreshTimer = setInterval(function () {
      if (!root.isConnected) return;
      if (document.body && document.body.getAttribute('data-current-page') !== 'orderflow') return;
      prefetchDomDepth(store, 'refresh');
    }, 15000);
  }

  function renderEngineBar(root, snapshot, state) {
    if (!root || !snapshot) return;
    var status = snapshot.status || 'disconnected';
    var stats = snapshot.stats || {};

    // Status dot color
    var dot = root.querySelector('[data-v6-engine-dot]');
    if (dot) {
      dot.className = 'v6-engine-dot v6-engine-' + status;
    }

    // Status text (clean, no jargon)
    var statusLabel = status === 'connected' ? 'Live'
      : status === 'connecting' ? 'Connecting…'
      : status === 'error' ? 'Reconnecting…'
      : 'Offline';
    setText(root, '[data-v6-engine-status-text]', statusLabel);

    // Counters
    setText(root, '[data-v6-cnt-trades]', String(stats.tradesReceived || 0));
    setText(root, '[data-v6-cnt-deltas]', String(stats.deltaBucketsReceived || 0));
    setText(root, '[data-v6-cnt-vwaps]', String(stats.vwapsReceived || 0));
    setText(root, '[data-v6-cnt-books]', String(stats.orderBooksReceived || 0));
    setText(root, '[data-v6-cnt-heatmap]', String(stats.heatmapFramesReceived || 0));
    setText(root, '[data-v6-cnt-footprint]', String(stats.footprintCandlesReceived || 0));
    setText(root, '[data-v6-cnt-errors]', String(stats.errorsCount || 0));
    setText(root, '[data-v6-cnt-reconnects]', String(stats.reconnectsCount || 0));

    // Status bar updates
    setText(root, '[data-v6-status-url]', 'ws://127.0.0.1:8765/stream');
    setText(root, '[data-v6-status-reconnects]', String(stats.reconnectsCount || 0));
    if (state) {
      setText(root, '[data-v6-status-buffer-trades]', String((state.trades && state.trades.length) || 0));
      setText(root, '[data-v6-status-buffer-heatmap]', String((state.heatmapFrames && state.heatmapFrames.length) || 0));
      setText(root, '[data-v6-status-buffer-footprint]', String((state.footprintCandles && state.footprintCandles.length) || 0));
    }

    // Last message time
    if (stats.lastMessageTs) {
      var formatted = V6OF.format.time(stats.lastMessageTs);
      setText(root, '[data-v6-cnt-lastmsg]', formatted);
      setText(root, '[data-v6-status-time]', formatted);
    } else {
      setText(root, '[data-v6-cnt-lastmsg]', '--');
      setText(root, '[data-v6-status-time]', '--');
    }

    // Stale warning
    var staleEl = root.querySelector('[data-v6-stale-warning]');
    if (staleEl && state) {
      staleEl.style.display = state.isStale ? 'inline' : 'none';
    }

    // Badge update
    var badge = root.querySelector('[data-v6-badge]');
    if (badge) {
      if (state && state.isStale && status === 'connected') {
        badge.textContent = 'V6 STALE / No data';
        badge.classList.remove('v6-badge-live');
        badge.classList.add('v6-badge-error');
      } else if (status === 'connected') {
        badge.textContent = 'V6 LIVE / Go Engine';
        badge.classList.add('v6-badge-live');
        badge.classList.remove('v6-badge-error');
      } else if (status === 'error') {
        badge.textContent = 'V6 ERROR / Disconnected';
        badge.classList.remove('v6-badge-live');
        badge.classList.add('v6-badge-error');
      } else if (status === 'connecting') {
        badge.textContent = 'V6 CONNECTING...';
        badge.classList.remove('v6-badge-live');
        badge.classList.remove('v6-badge-error');
      } else {
        badge.textContent = 'Not available';
        badge.classList.remove('v6-badge-live');
        badge.classList.remove('v6-badge-error');
      }
    }

    // Pause button
    var pauseBtn = root.querySelector('[data-v6-action="pause-toggle"]');
    if (pauseBtn) {
      pauseBtn.textContent = snapshot.paused ? 'Resume' : 'Pause';
    }
  }

  function render(root, state) {
    if (!root || !state) return;
    root.classList.toggle('v6-legacy-mode', !!(state.ui && state.ui.legacyMode));


    setText(root, '[data-v6-symbol]', state.symbol || '--');
    setText(root, '[data-v6-last]', V6OF.format.price(lastPrice(state)));
    setText(root, '[data-v6-cvd]', V6OF.format.signed(latestCvd(state)));

    var settings = state.settings || {};

    // Live BID/ASK/spread ticket (book first, heatmap fallback).
    var book = state.orderBook;
    var lh = state.lastHeatmapFrame;
    var bid = book && Number.isFinite(book.bestBid) ? book.bestBid : (lh ? lh.bestBid : NaN);
    var ask = book && Number.isFinite(book.bestAsk) ? book.bestAsk : (lh ? lh.bestAsk : NaN);
    var spread = (Number.isFinite(bid) && Number.isFinite(ask)) ? (ask - bid) : NaN;
    setText(root, '[data-v6-ticket-bid]', V6OF.format.price(bid));
    setText(root, '[data-v6-ticket-ask]', V6OF.format.price(ask));
    setText(root, '[data-v6-ticket-spread]', Number.isFinite(spread) ? V6OF.format.price(spread) : '--');

    // Mid price (book.mid preferred, fallback to bid/ask average)
    var mid = (book && Number.isFinite(book.mid)) ? book.mid : (Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : NaN);
    // Chart layer toggles active state.
    var layerKeys = { candles: 'showCandles', bubbles: 'showBubbles', heatmap: 'showHeatmap', footprint: 'showFootprint' };
    var onByDefault = { showCandles: 1 };
    var layerBtns = root.querySelectorAll('[data-v6-action="layer"]');
    Array.prototype.forEach.call(layerBtns, function (btn) {
      var key = layerKeys[btn.getAttribute('data-layer')];
      var on = onByDefault[key] ? settings[key] !== false : settings[key] === true;
      btn.classList.toggle('is-active', on);
    });

    // Timeframe buttons active state.
    var tf = state.timeframe || '1m';
    setText(root, '[data-v6-interval]', tf);
    var tfBtns = root.querySelectorAll('[data-v6-action="timeframe"]');
    Array.prototype.forEach.call(tfBtns, function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-interval') === tf);
    });

    // Data source buttons active state.
    var src = state.dataSource || 'binance';
    var srcBtns = root.querySelectorAll('[data-v6-action="source"]');
    Array.prototype.forEach.call(srcBtns, function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-source') === src);
    });

    syncPanelVisibility(root, settings);

    // Update Info Panel Tab
    var lPrice = lastPrice(state);
    var cvdVal = latestCvd(state);
    setText(root, '[data-v6-info-bid]', V6OF.format.price(bid));
    setText(root, '[data-v6-info-ask]', V6OF.format.price(ask));
    setText(root, '[data-v6-info-spread]', Number.isFinite(spread) ? V6OF.format.price(spread) : '--');
    setText(root, '[data-v6-info-mid]', Number.isFinite(mid) ? V6OF.format.price(mid) : '--');
    setText(root, '[data-v6-info-cvd]', V6OF.format.signed(cvdVal));
    setText(root, '[data-v6-info-last]', V6OF.format.price(lPrice));

    var tapeList = root.querySelector('[data-v6-tape-list]');
    var domList = root.querySelector('[data-v6-dom-list]');
    var cvd = root.querySelector('[data-v6-cvd-panel]');
    if (tapeList && V6OF.Panels && V6OF.Panels.renderTape && settings.showTape !== false) {
      tapeList.innerHTML = V6OF.Panels.renderTape(state.trades, state.settings);
      var tapeTable = tapeList.querySelector('.v6-tape-table');
      if (tapeTable) {
        tapeTable.style.fontSize = (settings.tapeFontSize || 10) + 'px';
      }
    }
    if (domList && V6OF.DomPanel && settings.showDOM !== false) {
      V6OF.DomPanel.render(domList, V6OF.DomLadder ? V6OF.DomLadder.snapshot() : null, state);
      // Wire controls on first render
      V6OF.DomPanel.bindControls(domList, function (group) {
        if (V6OF.DomLadder) {
          V6OF.DomLadder.setGrouping(group);
          var currentState = V6OF.store && V6OF.store.getState ? V6OF.store.getState() : state;
          V6OF.DomPanel.render(domList, V6OF.DomLadder.snapshot(), currentState);
        }
      }, function () {
        // Re-center
        var currentState = V6OF.store && V6OF.store.getState ? V6OF.store.getState() : state;
        V6OF.DomPanel.render(domList, V6OF.DomLadder ? V6OF.DomLadder.snapshot() : null, currentState);
      }, function (patch) {
        if (V6OF.store && V6OF.store.updateSettings) V6OF.store.updateSettings(patch);
      });
      // Wire drag-and-drop on the column headers
      if (V6OF.Panels.wireDomDragDrop) V6OF.Panels.wireDomDragDrop(root, V6OF.store);
    }
    // Old DOM footer — désactivé, les stats sont maintenant dans le header du panel.
    // Keep DOM area clean.
    // Clean — Depth History removed
    if (cvd && V6OF.Panels && V6OF.Panels.renderCvd && settings.showCVD !== false) {
      cvd.innerHTML = V6OF.Panels.renderCvd(state);
    }
    syncInputs(root, state);

    if (V6OF.CanvasChart && V6OF.CanvasChart.draw) {
      V6OF.CanvasChart.draw(root.querySelector('[data-v6-chart]'), state);
    }
  }

  function bind(root, store) {
    var engineClient = null;
    var lastReconnectsSeen = 0;

    // Create the engine client if available
    if (V6OF.EngineClient && V6OF.EngineClient.create) {
      engineClient = V6OF.EngineClient.create(store);
      V6OF._engineClient = engineClient; // expose for debugging

      // Subscribe to engine status changes
      engineClient.subscribe(function (snapshot) {
        renderEngineBar(root, snapshot, store.getState());
        var stats = snapshot && snapshot.stats ? snapshot.stats : {};
        if (snapshot && snapshot.status === 'connected' && Number(stats.reconnectsCount || 0) > lastReconnectsSeen) {
          lastReconnectsSeen = Number(stats.reconnectsCount || 0);
          prefetchDomDepth(store, 'reconnect');
        }
      });
    }

    root.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-v6-action]');
      if (!btn) return;
      var action = btn.getAttribute('data-v6-action');
      var state = store.getState();

      if (action === 'pause-toggle') {
        if (engineClient) {
          if (engineClient.isPaused()) {
            engineClient.resume();
          } else {
            engineClient.pause();
          }
        }
      } else if (action === 'legacy') {
        store.updateUi({ legacyMode: true });
        document.dispatchEvent(new CustomEvent('pageChange', { detail: { page: 'orderflow' } }));
      } else if (action === 'v6') {
        store.updateUi({ legacyMode: false });
        document.dispatchEvent(new CustomEvent('pageChange', { detail: { page: 'orderflow' } }));
      } else if (action === 'layer') {
        var layerKeys = { candles: 'showCandles', bubbles: 'showBubbles', heatmap: 'showHeatmap', footprint: 'showFootprint' };
        var onDefault = { showCandles: 1 };
        var sKey = layerKeys[btn.getAttribute('data-layer')];
        if (sKey) {
          var cur = onDefault[sKey] ? state.settings[sKey] !== false : state.settings[sKey] === true;
          var patch = {}; patch[sKey] = !cur;
          store.updateSettings(patch);
        }
      } else if (action === 'timeframe') {
        var interval = btn.getAttribute('data-interval');
        if (interval && interval !== state.timeframe) {
          // G1: all intervals are pre-loaded by the Go engine. Swap the chart to
          // the cached candles for the chosen interval.
          var cache = state._candlesByInterval || {};
          var tfPatch = { timeframe: interval };
          if (cache[interval] && cache[interval].length) {
            tfPatch.chartCandles = cache[interval];
          }
          store.setState(tfPatch, 'timeframe-change');
          var meta = root.querySelector('[data-v6-interval]');
          if (meta) meta.textContent = interval;
          // Clear stale live overlays so old footprint doesn't mix across TFs.
          if (V6OF.CvdBuckets) V6OF.CvdBuckets.reset();
          // Fetch full depth via REST for deeper DOM ladder
          if (source === 'hyperliquid') {
            fetch('/api/hyperliquid/orderbook?market=BTC')
              .then(function(r) { return r.json(); })
              .then(function(data) {
                if (data.ok && data.bids && data.asks && V6OF.DomLadder) {
                  var book = {
                    bids: data.bids.map(function(b) { return { price: b.px, size: b.sz }; }),
                    asks: data.asks.map(function(a) { return { price: a.px, size: a.sz }; }),
                    bestBid: data.bids[0] ? data.bids[0].px : 0,
                    bestAsk: data.asks[0] ? data.asks[0].px : 0,
                    spread: data.asks[0] && data.bids[0] ? data.asks[0].px - data.bids[0].px : 0,
                    mid: data.asks[0] && data.bids[0] ? (data.asks[0].px + data.bids[0].px) / 2 : 0
                  };
                  V6OF.DomLadder.feedOrderBook(book);
                  console.log('[DOM] REST depth loaded: bids=' + data.bids.length + ' asks=' + data.asks.length);
                }
              })
              .catch(function(e) { console.warn('[DOM] REST depth fetch failed', e); });
          } else if (source === 'binance') {
            fetch('/api/market/depth?symbol=BTCUSDT&limit=5000')
              .then(function(r) { return r.json(); })
              .then(function(data) {
                if (data.bids && data.asks && V6OF.DomLadder) {
                  var book = {
                    bids: data.bids.map(function(b) { return { price: parseFloat(b[0]), size: parseFloat(b[1]) }; }),
                    asks: data.asks.map(function(a) { return { price: parseFloat(a[0]), size: parseFloat(a[1]) }; })
                  };
                  if (book.bids.length) book.bestBid = book.bids[0].price;
                  if (book.asks.length) book.bestAsk = book.asks[0].price;
                  if (book.bestBid && book.bestAsk) {
                    book.spread = book.bestAsk - book.bestBid;
                    book.mid = (book.bestBid + book.bestAsk) / 2;
                  }
                  V6OF.DomLadder.feedOrderBook(book);
                  console.log('[DOM] REST depth loaded (Binance): bids=' + data.bids.length + ' asks=' + data.asks.length);
                }
              })
              .catch(function(e) { console.warn('[DOM] REST depth fetch failed', e); });
          }
          if (engineClient) {
            engineClient.clearFootprint();
            engineClient.clearTrades();
            engineClient.clearHeatmap();
          }
          // Re-fit viewport to the new data range.
          if (V6OF.chart && V6OF.chart.resetOnDataChange) V6OF.chart.resetOnDataChange();
        }
      } else if (action === 'source') {
        var source = btn.getAttribute('data-source');
        if (source && source !== state.dataSource) {
          var oldSource = state.dataSource;
          store.setState({ dataSource: source }, 'source-change');

          // Cache current data before switching
          if (!V6OF._sourceCache) V6OF._sourceCache = {};
          V6OF._sourceCache[oldSource] = {
            trades: (state.trades || []).slice(),
            orderBook: state.orderBook || null,
            heatmapFrames: (state.heatmapFrames || []).slice(),
            footprintCandles: (state.footprintCandles || []).slice(),
            chartCandles: (state.chartCandles || []).slice(),
            deltaBuckets: (state.deltaBuckets || []).slice(),
            deltaBucketsByInterval: state.deltaBucketsByInterval || {},
            latestDeltaByInterval: state.latestDeltaByInterval || {}
          };

          // Restore cached data if available, else keep old data visible
          var cached = V6OF._sourceCache[source];
          if (cached) {
            store.setState({
              trades: cached.trades,
              orderBook: cached.orderBook,
              heatmapFrames: cached.heatmapFrames,
              footprintCandles: cached.footprintCandles,
              chartCandles: cached.chartCandles,
              deltaBuckets: cached.deltaBuckets,
              deltaBucketsByInterval: cached.deltaBucketsByInterval,
              latestDeltaByInterval: cached.latestDeltaByInterval
            }, 'source-switch-restore');
          }

          // ── REST pre-fetch: depth + trades + klines in parallel ──
          var tf = state.timeframe || '1m';
          var isHL = source === 'hyperliquid';

          // 1. Depth → DOM ladder
          var depthUrl = isHL
            ? '/api/hyperliquid/orderbook?market=BTC'
            : '/api/market/depth?symbol=BTCUSDT&limit=5000';
          _cachedFetch(depthUrl, 30000).then(function(data) {
            if (V6OF.DomLadder) {
              var book;
              if (isHL && data.ok) {
                book = {
                  bids: (data.bids || []).map(function(b) { return { price: b.px, size: b.sz }; }),
                  asks: (data.asks || []).map(function(a) { return { price: a.px, size: a.sz }; })
                };
              } else if (!isHL && data.bids) {
                book = {
                  bids: data.bids.map(function(b) { return { price: parseFloat(b[0]), size: parseFloat(b[1]) }; }),
                  asks: data.asks.map(function(a) { return { price: parseFloat(a[0]), size: parseFloat(a[1]) }; })
                };
              }
              if (book && book.bids.length && book.asks.length) {
                book.bestBid = book.bids[0].price;
                book.bestAsk = book.asks[0].price;
                book.spread = book.bestAsk - book.bestBid;
                book.mid = (book.bestBid + book.bestAsk) / 2;
                V6OF.DomLadder.feedOrderBook(book);
                store.setState({
                  orderBook: book,
                  lastOrderBookTs: book.tsLocal,
                  restDepthTs: book.tsLocal,
                  restDepthCount: Math.min(book.bids ? book.bids.length : 0, book.asks ? book.asks.length : 0)
                }, 'rest-depth');
                console.log('[DOM] REST depth: bids=' + book.bids.length + ' asks=' + book.asks.length);
              }
            }
          }).catch(function(e) { console.warn('[DOM] REST depth failed', e); });

          // 2. Trades → fill the tape
          var tradesUrl = isHL
            ? '/api/hyperliquid/trades?market=BTC'
            : '/api/market/aggtrades?symbol=BTCUSDT&limit=500';
          _cachedFetch(tradesUrl, 15000).then(function(data) {
            var trades;
            if (isHL && data.ok) {
              trades = (data.trades || []).map(function(t) {
                return { price: t.px, qty: t.sz, time: t.time, side: t.side, symbol: 'BTC', source: 'hyperliquid_rest' };
              });
            } else if (!isHL && Array.isArray(data)) {
              trades = data.map(function(t) {
                return { price: parseFloat(t.p), qty: parseFloat(t.q), time: t.T, side: t.m ? 'sell' : 'buy', symbol: 'BTCUSDT', source: 'binance_rest' };
              });
            }
            if (trades && trades.length) {
              store.setState({ trades: trades.slice(-500) }, 'rest-trades');
              console.log('[TAPE] REST trades loaded: ' + trades.length);
            }
          }).catch(function(e) { console.warn('[TAPE] REST trades failed', e); });

          // 3. Klines → pre-fill the chart
          var klinesUrl = isHL
            ? '/api/hyperliquid/klines?market=BTC&interval=' + tf + '&limit=500'
            : '/api/market/klines?symbol=BTCUSDT&interval=' + tf + '&limit=500';
          _cachedFetch(klinesUrl, 60000).then(function(data) {
            var candles;
            if (isHL && data.ok) {
              candles = (data.candles || []).filter(function(c) { return c && c.openTime; }).map(function(c) {
                return { openTime: c.openTime, closeTime: c.closeTime, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
              });
            } else if (!isHL && Array.isArray(data.candles)) {
              candles = data.candles.filter(function(c) { return c && c.openTime; });
            }
            if (candles && candles.length) {
              store.setState({ chartCandles: candles }, 'rest-klines');
              if (V6OF.chart && V6OF.chart.resetOnDataChange) V6OF.chart.resetOnDataChange();
              console.log('[CHART] REST klines loaded: ' + candles.length);
            }
          }).catch(function(e) { console.warn('[CHART] REST klines failed', e); });

          // Send source switch to the Go engine
          if (engineClient && engineClient.sendMessage) {
            engineClient.sendMessage({ type: 'source_switch', source: source });
          }
          if (V6OF.CvdBuckets) V6OF.CvdBuckets.reset();
          // Don't reset viewport yet — let klines REST response trigger it
          // Update active button state
          var allSrcBtns = root.querySelectorAll('[data-v6-action="source"]');
          allSrcBtns.forEach(function (b) { b.classList.toggle('active', b === btn); });
        }
      } else if (action === 'clear-tape') {
        if (engineClient) {
          engineClient.clearTrades();
        } else {
          store.setState({ trades: [] }, 'clear-tape');
        }
      } else if (action === 'clear-heatmap') {
        if (engineClient) {
          engineClient.clearHeatmap();
        } else {
          store.clearHeatmap();
        }
      } else if (action === 'clear-footprint') {
        if (engineClient) {
          engineClient.clearFootprint();
        } else {
          store.clearFootprint();
        }
      } else if (action === 'clear-all') {
        if (engineClient) {
          engineClient.clearAllBuffers();
        } else {
          store.clearAllBuffers();
        }
      } else if (action === 'reset-settings') {
        if (V6OF.Settings) {
          var defaults = V6OF.Settings.reset();
          store.updateSettings(defaults);
        }
      }
    });

    root.addEventListener('change', function (event) {
      var input = event.target.closest('[data-v6-setting]');
      if (!input) return;
      var key = input.getAttribute('data-v6-setting');
      var state = store.getState();

      if (key === 'symbol') {
        // Live-only: just record the requested symbol; the engine drives data.
        store.setState({ symbol: input.value }, 'symbol');
      } else if (key === 'chartMode') {
        store.updateSettings({ chartMode: input.value || 'both' });
      } else if (key === 'bgColor') {
        store.updateSettings({ bgColor: input.value || '#080b12' });
      } else if (key === 'upColor') {
        store.updateSettings({ upColor: input.value || '#3ddc97' });
      } else if (key === 'downColor') {
        store.updateSettings({ downColor: input.value || '#ff5f73' });
      } else if (key === 'domGroup') {
        store.updateSettings({ domGroup: Math.max(1, Math.min(100, Number(input.value) || 1)) });
      } else if (key === 'showTape' || key === 'showDOM' || key === 'showCVD' ||
                 key === 'showHeatmap' || key === 'showFootprint' || key === 'showLastPrice' || key === 'showGrid') {
        var patch = {};
        patch[key] = !!input.checked;
        store.updateSettings(patch);
      } else if (key === 'domWallsOnly') {
        store.updateSettings({ domWallsOnly: !!input.checked });
      } else if (key === 'deltaIntervalMs') {
        var intervalMs = Number(input.value) || 60000;
        store.setState(function (prev) {
          var nextSettings = Object.assign({}, prev.settings, { deltaIntervalMs: intervalMs });
          var keyName = String(intervalMs);
          return {
            settings: nextSettings,
            deltaBuckets: (prev.deltaBucketsByInterval && prev.deltaBucketsByInterval[keyName]) || []
          };
        }, 'delta-interval');
      }
    });

    root.addEventListener('input', function (event) {
      var input = event.target.closest('[data-v6-setting]');
      if (!input) return;
      var key = input.getAttribute('data-v6-setting');
      if (key === 'minQty') {
        store.updateSettings({ minQty: Math.max(0, Number(input.value) || 0) });
      } else if (key === 'tapeFontSize') {
        store.updateSettings({ tapeFontSize: Math.max(8, Math.min(20, Number(input.value) || 10)) });
      } else if (key === 'maxRows') {
        store.updateSettings({ maxRows: Math.max(8, Math.min(500, Number(input.value) || 42)) });
      } else if (key === 'maxTrades') {
        store.updateSettings({ maxTrades: Math.max(50, Math.min(5000, Number(input.value) || 500)) });
      } else if (key === 'maxHeatmapFrames') {
        store.updateSettings({ heatmapMaxFrames: Math.max(60, Math.min(1000, Number(input.value) || 360)) });
      } else if (key === 'maxFootprintCandles') {
        store.updateSettings({ footprintMaxCandles: Math.max(30, Math.min(300, Number(input.value) || 120)) });
      } else if (key === 'domDepth') {
        store.updateSettings({ domDepth: Math.max(5, Math.min(50, Number(input.value) || 20)) });
      } else if (key === 'domRangeLevels') {
        store.updateSettings({ domRangeLevels: Math.max(25, Math.min(500, Math.round(Number(input.value) || 100))) });
      } else if (key === 'domWallRatio') {
        store.updateSettings({ domWallRatio: Math.max(2, Math.min(12, Math.round(Number(input.value) || 4))) });
      } else if (key === 'domGroup') {
        store.updateSettings({ domGroup: Math.max(1, Math.min(100, Math.round(Number(input.value) || 1))) });
      }
    });

    // Wire chart pointer interactions (pan/drag, zoom, crosshair) to the canvas.
    function wireChartInteractions(root) {
      if (!V6OF.ChartInteractions) return;
      var canvas = root.querySelector('[data-v6-chart]');
      var cvdCanvas = root.querySelector('[data-v6-cvd-canvas]');
      if (canvas) V6OF.ChartInteractions.attach(canvas);
      if (cvdCanvas) V6OF.ChartInteractions.attachCvd(cvdCanvas);
      V6OF.ChartInteractions.wireToolbar(root, canvas);
    }

    return engineClient;
  }

  V6OF.Layout = {
    init: function (root) {
      if (!root || root.dataset.v6Mounted === '1') return;
      root.dataset.v6Mounted = '1';
      root.innerHTML = shellHtml();

      // Load settings from localStorage. Start from an EMPTY live state — no
      // mock/fake data is ever generated; panels show "not available" until the
      // local engine streams real data.
      var savedSettings = (V6OF.Settings && V6OF.Settings.load) ? V6OF.Settings.load() : {};
      var initial = V6OF.Contract.createEmptyState();
      initial.source = 'live';
      if (savedSettings && Object.keys(savedSettings).length) {
        initial.settings = Object.assign({}, initial.settings, savedSettings);
      }

      var store = V6OF.store = V6OF.createStore(initial);

      // Bind localStorage auto-save
      if (V6OF.Settings && V6OF.Settings.bindStore) {
        V6OF.Settings.bindStore(store);
      }

      var engineClient = bind(root, store);
      store.subscribe(function (state) { render(root, state); });
      render(root, store.getState());

      // Wire chart interactions after the first render so the canvas exists.
      // Try synchronously first (canvas is in the innerHTML); fall back to rAF.
      if (V6OF.ChartInteractions) {
        var wired = false;
        function tryWire() {
          if (wired) return;
          var canvas = root.querySelector('[data-v6-chart]');
          if (canvas) {
            V6OF.ChartInteractions.attach(canvas);
            var cvdCanvas = root.querySelector('[data-v6-cvd-canvas]');
            if (cvdCanvas) V6OF.ChartInteractions.attachCvd(cvdCanvas);
            V6OF.ChartInteractions.wireToolbar(root, canvas);
            wired = true;
          }
        }
        tryWire();
        if (!wired) requestAnimationFrame(tryWire);
      }

      // Auto-connect to the local WS engine (required for live data).
      if (engineClient) {
        renderEngineBar(root, {
          status: 'connecting',
          stats: engineClient.getStats(),
          paused: false
        }, store.getState());
        store.setState({ source: 'live', trades: [] }, 'auto-connect');
        engineClient.connect();
        prefetchDomDepth(store, 'auto-connect');
        startDomDepthRefresh(root, store);
      }

      // Mount the backtest/replay control in the header actions.
      if (V6OF.Backtest && V6OF.Backtest.mount) {
        var actions = root.querySelector('.v6-header-actions');
        if (actions) V6OF.Backtest.mount(actions, store);
      }

      window.addEventListener('resize', function () {
        render(root, store.getState());
      });
      document.addEventListener('pageChange', function (event) {
        if (event.detail && event.detail.page === 'orderflow') {
          requestAnimationFrame(function () {
            render(root, store.getState());
            // Re-wire interactions after page change (canvas may have been replaced).
            if (V6OF.ChartInteractions) {
              var canvas = root.querySelector('[data-v6-chart]');
              if (canvas) V6OF.ChartInteractions.attach(canvas);
            }
          });
        }
      });
    }
  };
})();
