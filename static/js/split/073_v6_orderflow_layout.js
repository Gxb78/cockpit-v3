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
  function fetchJson(url) {
    return fetch(url).then(function (r) {
      var statusMsg = "HTTP " + r.status + " " + r.statusText;
      console.log("[fetch network response] endpoint: " + url + " | status: " + statusMsg + " | source: orderflow_layout");
      if (!r.ok) {
        throw new Error("HTTP error " + r.status + " (" + url + ")");
      }
      return r.json();
    });
  }

  function normalizeSymbol(symbol, source) {
    if (!symbol) symbol = 'BTCUSDT';
    symbol = symbol.toUpperCase();
    if (source === 'hyperliquid') {
      return symbol.replace(/USDT$/, '');
    } else {
      if (!symbol.endsWith('USDT')) {
        return symbol + 'USDT';
      }
      return symbol;
    }
  }

  function timeframeToMs(tf) {
    if (!tf) return 60000;
    var match = tf.match(/^(\d+)([mhdwM])$/);
    if (!match) return 60000;
    var val = parseInt(match[1], 10);
    var unit = match[2];
    if (unit === 'm') return val * 60 * 1000;
    if (unit === 'h') return val * 3600 * 1000;
    if (unit === 'd') return val * 86400 * 1000;
    if (unit === 'w') return val * 7 * 86400 * 1000;
    if (unit === 'M') return val * 30 * 86400 * 1000;
    return 60000;
  }

  // Cap (rows fetched + retained) for the REST trade prefill of the tape.
  // Configurable via settings.restTradePrefillLimit; mirrors the clamp in
  // V6OF.Settings so a live store value stays in the supported range.
  function restTradePrefillLimit(settings) {
    settings = settings || {};
    var n = Math.round(Number(settings.restTradePrefillLimit));
    if (!Number.isFinite(n)) n = 500;
    return Math.max(50, Math.min(5000, n));
  }

  function uiBuildMetaLabel() {
    var version = (window.COCKPIT_ASSET_VERSION || '').toString();
    return version ? 'UI ' + version.slice(0, 12) : 'UI dev';
  }

  function replayStatusLabel(replay) {
    if (!replay || !replay.state || replay.state === 'idle') return '';
    if (replay.error) return 'Replay error: ' + replay.error;
    var label = 'Replay ' + replay.state;
    if (replay.total) {
      label += ', ' + (replay.index || 0) + ' of ' + replay.total;
      if (replay.speed != null) label += ', speed ' + (replay.speed === 0 ? 'max' : replay.speed + 'x');
    }
    return label + '.';
  }

  function announceStatus(root, message) {
    root = root || document.getElementById('v6-orderflow-root');
    if (!root || !message) return;
    if (root._v6LastLiveStatus === message) return;
    root._v6LastLiveStatus = message;
    setText(root, '[data-v6-live-status]', message);
  }

  V6OF.announceStatus = announceStatus;

  function hydrateThemeVars(root, settings) {
    if (!root) return;
    settings = settings || {};
    var theme = settings.theme === 'dark-tv' ? 'dark-tv' : 'light-tv';
    var vars = theme === 'dark-tv'
      ? {
          '--v6-bg': '#131722',
          '--v6-bg-2': '#171b22',
          '--v6-surface': '#1e222d',
          '--v6-surface-2': '#222733',
          '--v6-surface-3': '#2a2e39',
          '--v6-text': '#d1d4dc',
          '--v6-text-dim': '#b2b5be',
          '--v6-text-mute': '#868993',
          '--v6-text-faint': '#5f636e',
          '--v6-hairline': 'rgba(120, 130, 150, 0.20)',
          '--v6-hairline-strong': 'rgba(120, 130, 150, 0.32)'
        }
      : {
          '--v6-bg': '#f8f9fa',
          '--v6-bg-2': '#f0f3fa',
          '--v6-surface': '#ffffff',
          '--v6-surface-2': '#f5f7fb',
          '--v6-surface-3': '#e6e9ef',
          '--v6-text': '#131722',
          '--v6-text-dim': '#434651',
          '--v6-text-mute': '#6b7280',
          '--v6-text-faint': '#9aa0aa',
          '--v6-hairline': 'rgba(19, 23, 34, 0.14)',
          '--v6-hairline-strong': 'rgba(19, 23, 34, 0.24)'
        };
    root.dataset.v6Theme = theme;
    Object.keys(vars).forEach(function (key) {
      root.style.setProperty(key, vars[key]);
    });
  }

  function _cachedFetch(url, ttlMs, bypassCache) {
    var now = Date.now();
    var entry = _restCache[url];
    if (!bypassCache && entry && (now - entry.ts) < ttlMs) {
      var age = now - entry.ts;
      console.log("[fetch cache hit] endpoint: " + url + " | age: " + age + "ms | source: orderflow_layout");
      return Promise.resolve(entry.data);
    }
    console.log("[fetch network start] endpoint: " + url + " | source: orderflow_layout");
    return fetchJson(url)
      .then(function(data) {
        _restCache[url] = { data: data, ts: now };
        return data;
      })
      .catch(function(err) {
        console.error("[fetch network error] endpoint: " + url + " | error: " + err.message + " | source: orderflow_layout");
        // Notifier selon gravité
        try {
          if (typeof toast === "function") {
            toast("REST load failed: " + url + " (" + err.message + ")", "warning");
          }
        } catch (_) {}
        throw err;
      });
  }

  function shellHtml() {
    return [
      '<div class="v6-shell" data-orderflow-slot="v6" role="region" aria-label="Orderflow trading terminal" data-testid="orderflow-v6-slot">',
        '<div class="v6-demo-banner" data-v6-demo-banner style="display: none;">',
          '<span>⚠️ Live Engine Offline — Running in Demo Mode (Mock Data)</span>',
        '</div>',
        '<header class="v6-header">',
          '<div class="v6-brand">',
            '<span class="v6-brand-mark" aria-hidden="true"></span>',
            '<div class="v6-symbol-pill">',
              '<select class="v6-symbol-select" data-v6-action="symbol-select" data-v6-symbol aria-label="Select instrument">',
                '<option value="BTCUSDT">BTC</option>',
                '<option value="ETHUSDT">ETH</option>',
                '<option value="SOLUSDT">SOL</option>',
              '</select>',
              '<span class="v6-symbol-meta" data-v6-interval>1m</span>',
            '</div>',
            '<span class="v6-badge" data-v6-badge>Not available</span>',
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
          '<div class="v6-build-meta" data-testid="orderflow-build-meta" title="UI build metadata">' + uiBuildMetaLabel() + '</div>',
          '<div class="sr-only" data-v6-live-status role="status" aria-live="polite" aria-atomic="true" data-testid="orderflow-live-status">Orderflow loading.</div>',
          '<div class="v6-header-disclosure-toggle">',
            '<button type="button" class="v6-btn v6-btn-sm" data-v6-action="toggle-disclosure" aria-expanded="false" aria-controls="v6-header-disclosure-panel" title="Show/hide live metrics">Metrics ▾</button>',
          '</div>',
          '<div class="v6-header-disclosure-panel" id="v6-header-disclosure-panel">',
            '<div class="v6-header-live">',
              '<span class="v6-stat"><em>Last</em><strong data-v6-last>--</strong></span>',
              '<span class="v6-stat"><em>CVD</em><strong data-v6-cvd>--</strong></span>',
              '<span class="v6-stat"><em>Lag</em><strong data-v6-health-lag>--</strong></span>',
              '<span class="v6-stat"><em>Queue</em><strong data-v6-health-queue>0</strong></span>',
              '<span class="v6-stat"><em>Drops</em><strong data-v6-health-drops>0</strong></span>',
            '</div>',
            '<div class="v6-ticket" aria-label="Live quote">',
              '<div class="v6-ticket-side is-sell"><em>BID</em><strong data-v6-ticket-bid>--</strong></div>',
              '<div class="v6-ticket-mid"><em>SPR</em><span data-v6-ticket-spread>--</span></div>',
              '<div class="v6-ticket-side is-buy"><em>ASK</em><strong data-v6-ticket-ask>--</strong></div>',
            '</div>',
          '</div>',
          '<div class="v6-header-actions">',
            '<button type="button" class="v6-btn v6-btn-icon v6-fullscreen-slot" data-v6-action="fullscreen-slot" data-testid="orderflow-fullscreen-slot" aria-label="Fullscreen slot reserved" title="Fullscreen slot reserved" disabled>⛶</button>',
            '<button type="button" class="v6-conn" data-v6-action="toggle-connection" title="Toggle local engine connection">',
              '<span class="v6-engine-dot" data-v6-engine-dot></span>',
              '<span class="v6-conn-text" data-v6-engine-status-text>Offline</span>',
            '</button>',
          '</div>',
        '</header>',
        '<div class="v6-mount-error-region" data-v6-mount-error role="status" aria-live="polite" data-testid="orderflow-mount-error" hidden>',
          '<strong>Engine unavailable</strong>',
          '<span data-v6-mount-error-text>Unable to connect to the orderflow engine.</span>',
        '</div>',
        '<div class="v6-grid" role="region" aria-label="Orderflow market data panels" data-testid="orderflow-market-panels">',
          '<section class="v6-panel v6-panel-tape" data-v6-panel="tape" aria-label="V6 tape">',
            '<div class="v6-panel-head"><span>Tape</span><small class="v6-panel-freshness" data-v6-freshness="tape">No data</small></div>',
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
          '<section class="v6-panel v6-panel-chart" data-v6-panel="chart" aria-label="V6 chart">',
            '<div class="v6-panel-head"><span>Chart</span><small class="v6-panel-freshness" data-v6-freshness="chart">No data</small></div>',
            '<canvas class="v6-chart-canvas" data-v6-chart></canvas>',
          '</section>',
          '<section class="v6-panel v6-panel-dom" data-v6-panel="dom" aria-label="V6 DOM">',
            '<div class="v6-panel-head"><span>DOM</span><small class="v6-panel-freshness" data-v6-freshness="dom">No data</small></div>',
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
          '<section class="v6-panel v6-panel-settings" data-v6-panel="settings" aria-label="V6 settings">',
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
                '<label class="v6-check"><input type="checkbox" data-v6-setting="showVwap" /><span>Show VWAP</span></label>',
                '<label class="v6-check"><input type="checkbox" data-v6-setting="showHeatmap" /><span>Show Heatmap</span></label>',
                '<label class="v6-check"><input type="checkbox" data-v6-setting="showFootprint" /><span>Show Footprint</span></label>',
                '<label class="v6-check"><input type="checkbox" data-v6-setting="showLastPrice" /><span>Show Last Price</span></label>',
              '</div>',
              // -- Studies --
              '<div class="v6-settings-section">',
                '<div class="v6-settings-section-title">Studies</div>',
                '<label class="v6-check"><input type="checkbox" data-v6-setting="showVwapBands" /><span>VWAP bands</span></label>',
                '<label class="v6-field">VWAP band 1',
                  '<input type="number" min="0.1" max="5" step="0.1" data-v6-setting="vwapBand1" />',
                '</label>',
                '<label class="v6-field">VWAP band 2',
                  '<input type="number" min="0.1" max="8" step="0.1" data-v6-setting="vwapBand2" />',
                '</label>',
                '<label class="v6-check"><input type="checkbox" data-v6-setting="alertsEnabled" /><span>Alerts enabled</span></label>',
                '<label class="v6-field">Large trade alert',
                  '<input type="number" min="0" step="0.1" data-v6-setting="largeTradeAlertQty" />',
                '</label>',
                '<label class="v6-field">Delta alert',
                  '<input type="number" min="0" step="1" data-v6-setting="deltaAlertThreshold" />',
                '</label>',
                '<label class="v6-field">Imbalance ratio',
                  '<input type="number" min="1.5" max="8" step="0.1" data-v6-setting="imbalanceRatio" />',
                '</label>',
                '<label class="v6-field">Imbalance stack',
                  '<input type="number" min="2" max="6" step="1" data-v6-setting="imbalanceStack" />',
                '</label>',
                '<label class="v6-field">Min wick ticks',
                  '<input type="number" min="0" max="10" step="1" data-v6-setting="minWickTicks" />',
                '</label>',
                '<label class="v6-check"><input type="checkbox" data-v6-setting="showFootprintVA" /><span>Footprint value area</span></label>',
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
                '<label class="v6-field">Min display ($)',
                  '<input type="number" min="0" max="10000000" step="10" data-v6-setting="domMinNotionalUsd" />',
                '</label>',
                '<label class="v6-field">Follow threshold',
                  '<input type="number" min="1" max="20" step="1" data-v6-setting="domFollowThresholdTicks" />',
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
                '<label class="v6-field">REST trade prefill',
                  '<input type="number" min="50" max="5000" step="50" data-v6-setting="restTradePrefillLimit" />',
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
            '<div class="v6-panel-head"><span>CVD / Delta</span><small class="v6-panel-freshness" data-v6-freshness="cvd">No data</small></div>',
            '<div class="v6-panel-body" data-v6-cvd-panel></div>',
          '</section>',
        '</div>',
      '</div>',
      '<div class="v6-legacy-strip" data-orderflow-slot="legacy" role="region" aria-label="Legacy orderflow view" data-testid="orderflow-legacy-slot">',
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

  function latestTsFromList(list, key) {
    if (!Array.isArray(list) || !list.length) return 0;
    for (var i = list.length - 1; i >= 0; i--) {
      var item = list[i] || {};
      var ts = Number(item[key] || item.time || item.ts || item.openTime || item.closeTime);
      if (Number.isFinite(ts) && ts > 0) return ts < 1000000000000 ? ts * 1000 : ts;
    }
    return 0;
  }

  function freshnessAgeLabel(ts) {
    ts = Number(ts) || 0;
    if (!ts) return 'No data';
    var ageMs = Math.max(0, Date.now() - ts);
    if (ageMs < 2000) return 'now';
    if (ageMs < 60000) return Math.round(ageMs / 1000) + 's';
    if (ageMs < 3600000) return Math.round(ageMs / 60000) + 'm';
    return Math.round(ageMs / 3600000) + 'h';
  }

  function freshnessState(ts, ttlMs) {
    ts = Number(ts) || 0;
    if (!ts) return 'empty';
    return (Date.now() - ts) > ttlMs ? 'stale' : 'fresh';
  }

  function formatEngineLag(ms) {
    ms = Number(ms) || 0;
    if (!ms) return '--';
    if (ms < 1000) return Math.round(ms) + 'ms';
    if (ms < 60000) return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's';
    return Math.round(ms / 60000) + 'm';
  }

  function setPanelFreshness(root, panel, label, status) {
    var el = root.querySelector('[data-v6-freshness="' + panel + '"]');
    if (!el) return;
    el.textContent = label;
    el.classList.toggle('is-fresh', status === 'fresh');
    el.classList.toggle('is-stale', status === 'stale');
    el.classList.toggle('is-empty', status === 'empty');
  }

  function renderPanelFreshness(root, state) {
    if (state && state.dataFreshness === 'warming') {
      setPanelFreshness(root, 'tape', 'Warming', 'empty');
      setPanelFreshness(root, 'chart', 'Warming', 'empty');
      setPanelFreshness(root, 'dom', 'Warming', 'empty');
      setPanelFreshness(root, 'cvd', 'Warming', 'empty');
      return;
    }
    var live = state.transportStatus === 'connected' && state.dataFreshness !== 'rest-fallback';
    var tapeTs = Number(state.restTradesTs) || latestTsFromList(state.trades, 'time');
    var chartTs = Number(state.restKlinesTs) || latestTsFromList(state.chartCandles, 'closeTime');
    var domTs = Number(state.restDepthTs || state.lastOrderBookTs) || 0;
    var cvdTs = latestTsFromList(state.deltaBuckets, 'ts');
    setPanelFreshness(root, 'tape', live && tapeTs ? 'Live ' + freshnessAgeLabel(tapeTs) : 'REST ' + freshnessAgeLabel(tapeTs), freshnessState(tapeTs, live ? 15000 : 30000));
    setPanelFreshness(root, 'chart', live && chartTs ? 'Live ' + freshnessAgeLabel(chartTs) : 'REST ' + freshnessAgeLabel(chartTs), freshnessState(chartTs, live ? 120000 : 180000));
    setPanelFreshness(root, 'dom', live && domTs ? 'Live ' + freshnessAgeLabel(domTs) : 'REST ' + freshnessAgeLabel(domTs), freshnessState(domTs, live ? 15000 : 15000));
    setPanelFreshness(root, 'cvd', live && cvdTs ? 'Live ' + freshnessAgeLabel(cvdTs) : 'REST ' + freshnessAgeLabel(cvdTs), freshnessState(cvdTs, live ? 60000 : 120000));
  }

  function setText(root, selector, value) {
    var el = root.querySelector(selector);
    if (el) {
      if (el.tagName === 'SELECT') {
        if (el.value !== String(value)) {
          el.value = value;
        }
      } else {
        var str = String(value);
        if (el.textContent !== str) {
          el.textContent = str;
        }
      }
    }
  }

  function deepCloneCachePayload(value) {
    if (value == null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      return value.map(deepCloneCachePayload);
    }
    var out = {};
    Object.keys(value).forEach(function (key) {
      out[key] = deepCloneCachePayload(value[key]);
    });
    return out;
  }

  function sourceCachePayload(state) {
    return {
      trades: deepCloneCachePayload(state.trades || []),
      orderBook: deepCloneCachePayload(state.orderBook || null),
      heatmapFrames: deepCloneCachePayload(state.heatmapFrames || []),
      footprintCandles: deepCloneCachePayload(state.footprintCandles || []),
      chartCandles: deepCloneCachePayload(state.chartCandles || []),
      deltaBuckets: deepCloneCachePayload(state.deltaBuckets || []),
      deltaBucketsByInterval: deepCloneCachePayload(state.deltaBucketsByInterval || {}),
      latestDeltaByInterval: deepCloneCachePayload(state.latestDeltaByInterval || {}),
      restDepthTs: deepCloneCachePayload(state.restDepthTs || 0),
      restTradesTs: deepCloneCachePayload(state.restTradesTs || 0),
      restKlinesTs: deepCloneCachePayload(state.restKlinesTs || 0)
    };
  }

  function sourceWarmingPayload(source) {
    return {
      dataSource: source,
      source: 'live',
      dataFreshness: 'warming',
      trades: [],
      orderBook: null,
      orderBookCount: 0,
      lastOrderBookTs: 0,
      heatmapFrames: [],
      heatmapFrameCount: 0,
      lastHeatmapFrame: null,
      lastHeatmapTs: 0,
      footprintCandles: [],
      footprintCandleCount: 0,
      lastFootprintCandle: null,
      lastFootprintTs: 0,
      chartCandles: [],
      deltaBuckets: [],
      depthHistory: [],
      restDepthTs: 0,
      restTradesTs: 0,
      restKlinesTs: 0
    };
  }

  function syncInputs(root, state) {
    var settings = state.settings || {};
    // Selects
    var chartMode = root.querySelector('[data-v6-setting="chartMode"]');
    if (chartMode && document.activeElement !== chartMode) chartMode.value = settings.chartMode || 'both';

    // Checkboxes
    var toggles = ['showTape', 'showDOM', 'showCVD', 'showVwap', 'showHeatmap', 'showFootprint', 'showLastPrice', 'showGrid', 'showVwapBands', 'alertsEnabled', 'showFootprintVA'];
    var toggleDefaultsOn = { showTape: 1, showDOM: 1, showCVD: 1, showFootprint: 1, showLastPrice: 1, showGrid: 1, showFootprintVA: 1 };
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
      domMinNotionalUsd: 'domMinNotionalUsd',
      domFollowThresholdTicks: 'domFollowThresholdTicks',
      minQty: 'minQty',
      maxRows: 'maxRows',
      restTradePrefillLimit: 'restTradePrefillLimit',
      tapeFontSize: 'tapeFontSize',
      vwapBand1: 'vwapBand1',
      vwapBand2: 'vwapBand2',
      largeTradeAlertQty: 'largeTradeAlertQty',
      deltaAlertThreshold: 'deltaAlertThreshold',
      imbalanceRatio: 'imbalanceRatio',
      imbalanceStack: 'imbalanceStack',
      minWickTicks: 'minWickTicks',
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

  function normalizeIngressOrderBook(data, source) {
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

  function normalizeRestDepthBook(data, source) {
    return normalizeIngressOrderBook(data, source);
  }

  function normalizeIngressTrades(data, source, symbol) {
    var isHL = source === 'hyperliquid';
    var normSymbol = normalizeSymbol(symbol, source);
    var raw = null;
    if (isHL && data && data.ok) {
      raw = data.trades || [];
    } else if (!isHL && Array.isArray(data)) {
      raw = data;
    }
    if (!raw) return [];
    return raw.map(function (t) {
      var price = isHL ? Number(t.px) : Number(t.p);
      var qty = isHL ? Number(t.sz) : Number(t.q);
      var time = Number(isHL ? t.time : t.T);
      var side = isHL ? t.side : (t.m ? 'sell' : 'buy');
      return {
        price: price,
        qty: qty,
        time: time,
        side: side,
        symbol: normSymbol,
        source: isHL ? 'hyperliquid_rest' : 'binance_rest'
      };
    }).filter(function (t) {
      return Number.isFinite(t.price) && Number.isFinite(t.qty) && t.price > 0 && t.qty >= 0;
    });
  }

  function normalizeIngressCandles(data, source, timeframe) {
    var isHL = source === 'hyperliquid';
    var intervalMs = timeframeToMs(timeframe) || 60000;
    var raw = null;
    if (isHL && data && data.ok) {
      raw = data.candles || [];
    } else if (!isHL && data && Array.isArray(data.candles)) {
      raw = data.candles;
    }
    if (!raw) return [];
    return raw.map(function (c) {
      if (!c) return null;
      var openTime = Number(c.openTime || c.time);
      if (!Number.isFinite(openTime) || openTime <= 0) return null;
      if (openTime < 1000000000000) openTime *= 1000;
      var closeTime = Number(c.closeTime);
      if (!Number.isFinite(closeTime) || closeTime <= 0) {
        closeTime = openTime + intervalMs - 1;
      } else if (closeTime < 1000000000000) {
        closeTime *= 1000;
      }
      var candle = {
        openTime: openTime,
        closeTime: closeTime,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: Number(c.volume) || 0,
        priceOnly: true,
        analyticsSource: 'price-only-rest',
        source: isHL ? 'hyperliquid_rest_klines' : 'binance_rest_klines'
      };
      if (!Number.isFinite(candle.open) || !Number.isFinite(candle.high) ||
          !Number.isFinite(candle.low) || !Number.isFinite(candle.close)) {
        return null;
      }
      return candle;
    }).filter(Boolean);
  }

  function applyRestOrderBook(store, data, source, reason) {
    var book = normalizeIngressOrderBook(data, source);
    if (!book || !V6OF.DomLadder) return null;
    V6OF.DomLadder.feedOrderBook(book);
    store.setState(function (prev) {
      var patch = {
        orderBook: book,
        lastOrderBookTs: book.tsLocal,
        restDepthTs: book.tsLocal,
        restDepthCount: Math.min(book.bids ? book.bids.length : 0, book.asks ? book.asks.length : 0)
      };
      if (prev.transportStatus !== 'connected' || prev.dataFreshness === 'warming') {
        patch.dataFreshness = 'rest-fallback';
      }
      return patch;
    }, reason || 'rest-depth');
    return book;
  }

  function applyRestTrades(store, data, source, symbol, reason) {
    var trades = normalizeIngressTrades(data, source, symbol);
    if (!trades.length) return [];
    var limit = restTradePrefillLimit(store.getState ? store.getState().settings : null);
    store.setState(function (prev) {
      var patch = { trades: trades.slice(-limit), restTradesTs: Date.now() };
      if (prev.transportStatus !== 'connected' || prev.dataFreshness === 'warming') {
        patch.dataFreshness = 'rest-fallback';
      }
      return patch;
    }, reason || 'rest-trades');
    return trades;
  }

  function applyRestCandles(store, data, source, timeframe, reason) {
    var candles = normalizeIngressCandles(data, source, timeframe);
    if (!candles.length) return [];
    store.setState(function (prev) {
      var patch = { chartCandles: candles, restKlinesTs: Date.now() };
      if (prev.transportStatus !== 'connected' || prev.dataFreshness === 'warming') {
        patch.dataFreshness = 'rest-fallback';
      }
      return patch;
    }, reason || 'rest-klines');
    if (V6OF.chart && V6OF.chart.resetOnDataChange) V6OF.chart.resetOnDataChange();
    return candles;
  }

  V6OF.LayoutIngress = Object.freeze({
    normalizeSymbol: normalizeSymbol,
    normalizeOrderBook: normalizeIngressOrderBook,
    normalizeTrades: normalizeIngressTrades,
    normalizeCandles: normalizeIngressCandles
  });

  function prefetchDomDepth(store, reason) {
    if (!store) return;
    var state = store.getState ? store.getState() : {};
    var source = state.dataSource || 'binance';
    var symbol = normalizeSymbol(state.symbol, source);
    var url = source === 'hyperliquid'
      ? '/api/hyperliquid/orderbook?market=' + symbol
      : '/api/market/depth?symbol=' + symbol + '&limit=5000';
    var bypass = (reason === 'refresh' || reason === 'symbol-change' || reason === 'reconnect' || reason === 'auto-connect');
    _cachedFetch(url, 5000, bypass).then(function (data) {
      var book = applyRestOrderBook(store, data, source, 'rest-depth-' + (reason || 'prefetch'));
      if (!book) return;
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
      dot.className = 'v6-engine-dot v6-engine-' + ((state && state.source === 'mock') ? 'disconnected' : status);
    }

    var freshness = state && state.dataFreshness;
    var statusLabel = (state && state.source === 'mock') ? 'Mock'
      : freshness === 'warming' ? 'Warming'
      : status === 'connected' ? 'Live'
      : status === 'connecting' ? 'Connecting…'
      : status === 'error' ? 'Reconnecting…'
      : freshness === 'rest-fallback' ? 'Offline (REST Fallback)'
      : 'Offline';
    setText(root, '[data-v6-engine-status-text]', statusLabel);
    announceStatus(root, 'Orderflow ' + statusLabel + '. ' + (replayStatusLabel(state && state.replay) || 'Replay idle.'));

    // Counters
    setText(root, '[data-v6-cnt-trades]', String(stats.tradesReceived || 0));
    setText(root, '[data-v6-cnt-deltas]', String(stats.deltaBucketsReceived || 0));
    setText(root, '[data-v6-cnt-vwaps]', String(stats.vwapsReceived || 0));
    setText(root, '[data-v6-cnt-books]', String(stats.orderBooksReceived || 0));
    setText(root, '[data-v6-cnt-heatmap]', String(stats.heatmapFramesReceived || 0));
    setText(root, '[data-v6-cnt-footprint]', String(stats.footprintCandlesReceived || 0));
    setText(root, '[data-v6-cnt-errors]', String(stats.errorsCount || 0));
    setText(root, '[data-v6-cnt-reconnects]', String(stats.reconnectsCount || 0));
    setText(root, '[data-v6-health-lag]', formatEngineLag(stats.lagMs));
    setText(root, '[data-v6-health-queue]', String(stats.queueDepth || 0));
    setText(root, '[data-v6-health-drops]', String(stats.droppedCount || 0));

    // Status bar updates
    setText(root, '[data-v6-status-url]', 'ws://127.0.0.1:8765/stream');
    setText(root, '[data-v6-status-reconnects]', String(stats.reconnectsCount || 0));
    setText(root, '[data-v6-status-lag]', formatEngineLag(stats.lagMs));
    setText(root, '[data-v6-status-queue]', String(stats.queueDepth || 0));
    setText(root, '[data-v6-status-drops]', String(stats.droppedCount || 0));
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
      if (state && state.source === 'mock') {
        badge.textContent = 'V6 MOCK / No live data';
        badge.className = 'v6-badge';
      } else if (state && state.dataFreshness === 'warming') {
        badge.textContent = 'V6 WARMING / Loading source';
        badge.className = 'v6-badge';
      } else if (status === 'connected') {
        if (state && state.isStale) {
          badge.textContent = 'V6 STALE / No data';
          badge.className = 'v6-badge v6-badge-error';
        } else {
          badge.textContent = 'V6 LIVE / Go Engine';
          badge.className = 'v6-badge v6-badge-live';
        }
      } else if (status === 'connecting') {
        badge.textContent = 'V6 CONNECTING...';
        badge.className = 'v6-badge';
      } else if (status === 'error') {
        badge.textContent = 'V6 ERROR / Disconnected';
        badge.className = 'v6-badge v6-badge-error';
      } else if (state && state.dataFreshness === 'rest-fallback') {
        badge.textContent = 'V6 REST FALLBACK / Offline';
        badge.className = 'v6-badge v6-badge-error';
      } else {
        badge.textContent = 'Offline';
        badge.className = 'v6-badge';
      }
    }

    // Pause button
    var pauseBtn = root.querySelector('[data-v6-action="pause-toggle"]');
    if (pauseBtn) {
      pauseBtn.textContent = snapshot.paused ? 'Resume' : 'Pause';
    }

    renderMountErrorRegion(root, snapshot, state);
  }

  function renderMountErrorRegion(root, snapshot, state) {
    var region = root && root.querySelector('[data-v6-mount-error]');
    if (!region || !snapshot) return;
    var status = snapshot.status || 'disconnected';
    var stats = snapshot.stats || {};
    var freshness = state && state.dataFreshness;
    var shouldShow = state && state.source !== 'mock' && (status === 'error' || (status === 'disconnected' && freshness === 'offline'));
    region.hidden = !shouldShow;
    region.classList.toggle('is-visible', !!shouldShow);
    if (!shouldShow) return;
    var text = stats.lastError || (status === 'error'
      ? 'WebSocket engine error. Retrying connection.'
      : 'Local engine is offline. Start marketd or reconnect.');
    setText(region, '[data-v6-mount-error-text]', text);
  }

  function shouldRender(root, panelName, slice, force) {
    if (force) {
      if (!root._v6Cache) root._v6Cache = {};
      root._v6Cache[panelName] = slice;
      return true;
    }
    if (!root._v6Cache) root._v6Cache = {};
    var last = root._v6Cache[panelName];
    if (last === undefined) {
      root._v6Cache[panelName] = slice;
      return true;
    }
    var storeEqual = V6OF.shallowEqual;
    if (storeEqual && storeEqual(last, slice)) {
      return false;
    }
    root._v6Cache[panelName] = slice;
    return true;
  }

  function render(root, state, force) {
    if (!root || !state) return;
    root.classList.toggle('v6-legacy-mode', !!(state.ui && state.ui.legacyMode));

    var engineClient = root._v6EngineClient;
    if (engineClient) {
      renderEngineBar(root, {
        status: engineClient.getStatus(),
        stats: engineClient.getStats(),
        paused: engineClient.isPaused()
      }, state);
    }

    if (state.symbol) {
      document.title = state.symbol + ' - Cockpit V6';
    }

    var banner = root.querySelector('[data-v6-demo-banner]');
    if (banner) {
      banner.style.display = (state.source === 'mock') ? 'block' : 'none';
    }

    setText(root, '[data-v6-symbol]', state.symbol || '--');
    setText(root, '[data-v6-last]', V6OF.format.price(lastPrice(state)));
    setText(root, '[data-v6-cvd]', V6OF.format.signed(latestCvd(state)));

    var settings = state.settings || {};
    hydrateThemeVars(root, settings);

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
    renderPanelFreshness(root, state);

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

    var tapeSlice = {
      trades: state.trades,
      showTape: settings.showTape,
      tapeFontSize: settings.tapeFontSize,
      minQty: settings.minQty,
      maxRows: settings.maxRows,
      restTradesTs: state.restTradesTs,
      transportStatus: state.transportStatus,
      dataFreshness: state.dataFreshness
    };

    var domSlice = {
      orderBookCount: state.orderBookCount,
      lastOrderBookTs: state.lastOrderBookTs,
      restDepthTs: state.restDepthTs,
      transportStatus: state.transportStatus,
      dataFreshness: state.dataFreshness,
      showDOM: settings.showDOM,
      selectedDomSymbol: state.selectedDomSymbol,
      symbol: state.symbol
    };

    var cvdSlice = {
      deltaIntervalMs: settings.deltaIntervalMs,
      deltaBuckets: state.deltaBuckets,
      latestDeltaByInterval: state.latestDeltaByInterval,
      source: state.source,
      dataFreshness: state.dataFreshness,
      transportStatus: state.transportStatus,
      showCVD: settings.showCVD
    };

    var chartSlice = {
      chartCandles: state.chartCandles,
      restKlinesTs: state.restKlinesTs,
      transportStatus: state.transportStatus,
      dataFreshness: state.dataFreshness,
      trades: state.trades,
      heatmapFrames: state.heatmapFrames,
      footprintCandles: state.footprintCandles,
      showCandles: settings.showCandles !== false,
      showBubbles: settings.showBubbles === true,
      showHeatmap: settings.showHeatmap === true,
      showFootprint: settings.showFootprint === true
    };

    if (tapeList && V6OF.Panels && V6OF.Panels.renderTapeInto && settings.showTape !== false) {
      if (shouldRender(root, 'tape', tapeSlice, force)) {
        // Incremental, virtualized update: keeps a stable shell and only
        // rewrites the visible window of rows, preserving scroll position.
        // A full-innerHTML rebuild thrashed the DOM and reset scroll at high
        // trade rates (~1000 trades/min).
        V6OF.Panels.renderTapeInto(tapeList, state.trades, state.settings);
      }
    }
    if (domList && V6OF.DomPanel && settings.showDOM !== false) {
      if (shouldRender(root, 'dom', domSlice, force)) {
        V6OF.DomPanel.render(domList, V6OF.DomLadder ? V6OF.DomLadder.snapshot() : null, state);
      }
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
    if (cvd && V6OF.Panels && V6OF.Panels.renderCvdInto && settings.showCVD !== false) {
      if (shouldRender(root, 'cvd', cvdSlice, force)) {
        // Incremental update: stable shell preserves the interval <select>;
        // only badges and the delta histogram are patched.
        V6OF.Panels.renderCvdInto(cvd, state);
      }
    }
    syncInputs(root, state);

    if (V6OF.CanvasChart && V6OF.CanvasChart.draw) {
      if (shouldRender(root, 'chart', chartSlice, force)) {
        V6OF.CanvasChart.draw(root.querySelector('[data-v6-chart]'), state);
      }
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
      } else if (action === 'toggle-connection') {
        if (engineClient) {
          var currentStatus = engineClient.getStatus();
          if (currentStatus === 'connected' || currentStatus === 'connecting' || currentStatus === 'error') {
            engineClient.disconnect();
          } else {
              store.setState({ source: 'live', dataFreshness: 'offline', transportStatus: 'connecting', trades: [] }, 'manual-connect');
            engineClient.connect();
          }
        }
      } else if (action === 'toggle-disclosure') {
        var panel = root.querySelector('#v6-header-disclosure-panel');
        if (panel) {
          var expanded = panel.classList.toggle('v6-expanded');
          btn.setAttribute('aria-expanded', String(expanded));
          btn.innerHTML = 'Metrics ' + (expanded ? '▴' : '▾');
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
          // G1: all intervals are pre-loaded by the Go engine. Reset every
          // timeframe-dependent live surface before swapping the chart data.
          var cache = state._candlesByInterval || {};
          var intervalMs = timeframeToMs(interval) || 60000;
          var deltaKey = String(intervalMs);
          var tfPatch = {
            timeframe: interval,
            chartCandles: (cache[interval] && cache[interval].length) ? cache[interval] : [],
            heatmapFrames: [],
            heatmapFrameCount: 0,
            lastHeatmapFrame: null,
            lastHeatmapTs: 0,
            footprintCandles: [],
            footprintCandleCount: 0,
            lastFootprintCandle: null,
            lastFootprintTs: 0,
            deltaBuckets: (state.deltaBucketsByInterval && state.deltaBucketsByInterval[deltaKey]) || [],
            restTradesTs: 0,
            restKlinesTs: 0,
            depthHistory: []
          };
          store.setState(tfPatch, 'timeframe-change');
          var meta = root.querySelector('[data-v6-interval]');
          if (meta) meta.textContent = interval;
          if (V6OF.CvdBuckets) V6OF.CvdBuckets.reset();
          if (V6OF.chart && V6OF.chart.resetOnDataChange) V6OF.chart.resetOnDataChange();
          // Fetch full depth via REST for deeper DOM ladder
          var source = state.dataSource || 'binance';
          var normSymbol = normalizeSymbol(state.symbol, source);
          var depthUrl = source === 'hyperliquid'
            ? '/api/hyperliquid/orderbook?market=' + normSymbol
            : '/api/market/depth?symbol=' + normSymbol + '&limit=5000';
          _cachedFetch(depthUrl, 5000, true).then(function (data) {
            var book = applyRestOrderBook(store, data, source, 'rest-depth-timeframe');
            if (book) console.log('[DOM] REST depth loaded (' + source + '): bids=' + book.bids.length + ' asks=' + book.asks.length);
          }).catch(function(e) { console.warn('[DOM] REST depth fetch failed', e); });
          if (engineClient) {
            engineClient.clearFootprint();
            engineClient.clearTrades();
            engineClient.clearHeatmap();
          }
        }
      } else if (action === 'source') {
        var source = btn.getAttribute('data-source');
        if (source && (source !== state.dataSource || state.source === 'mock')) {
          var oldSource = state.dataSource;
          var patch = { dataSource: source };
          if (state.source === 'mock') {
            patch.source = 'live';
            patch.dataFreshness = 'offline';
            patch.transportStatus = 'disconnected';
          }
          store.setState(patch, 'source-change');

          if (state.source === 'mock' && engineClient) {
            renderEngineBar(root, {
              status: 'disconnected',
              stats: engineClient.getStats(),
              paused: false
            }, store.getState());
            startDomDepthRefresh(root, store);
          }

          // Cache current data before switching
          if (!V6OF._sourceCache) V6OF._sourceCache = {};
          V6OF._sourceCache[oldSource] = sourceCachePayload(state);

          // Restore cached data if available. Without cache, clear source-bound
          // visuals so the old exchange is not shown as current data.
          var cached = V6OF._sourceCache[source];
          if (cached) {
            store.setState(sourceCachePayload(cached), 'source-switch-restore');
          } else {
            store.setState(sourceWarmingPayload(source), 'source-switch-warming');
            if (V6OF.CvdBuckets) V6OF.CvdBuckets.reset();
            if (V6OF.chart && V6OF.chart.resetOnDataChange) V6OF.chart.resetOnDataChange();
          }

          // ── REST pre-fetch: depth + trades + klines in parallel ──
          var tf = state.timeframe || '1m';
          var isHL = source === 'hyperliquid';
          var normSymbol = normalizeSymbol(state.symbol, source);

          // 1. Depth → DOM ladder
          var depthUrl = isHL
            ? '/api/hyperliquid/orderbook?market=' + normSymbol
            : '/api/market/depth?symbol=' + normSymbol + '&limit=5000';
          _cachedFetch(depthUrl, 5000, true).then(function(data) {
            var book = applyRestOrderBook(store, data, source, 'rest-depth');
            if (book) console.log('[DOM] REST depth: bids=' + book.bids.length + ' asks=' + book.asks.length);
          }).catch(function(e) { console.warn('[DOM] REST depth failed', e); });

          // 2. Trades → fill the tape
          var tradesPrefill = restTradePrefillLimit(state.settings);
          var tradesUrl = isHL
            ? '/api/hyperliquid/trades?market=' + normSymbol + '&limit=' + tradesPrefill
            : '/api/market/aggtrades?symbol=' + normSymbol + '&limit=' + tradesPrefill;
          _cachedFetch(tradesUrl, 15000, true).then(function(data) {
            var trades = applyRestTrades(store, data, source, normSymbol, 'rest-trades');
            if (trades.length) console.log('[TAPE] REST trades loaded: ' + trades.length);
          }).catch(function(e) { console.warn('[TAPE] REST trades failed', e); });

          // 3. Klines → pre-fill the chart
          var klinesUrl = isHL
            ? '/api/hyperliquid/klines?market=' + normSymbol + '&interval=' + tf + '&limit=500'
            : '/api/market/klines?symbol=' + normSymbol + '&interval=' + tf + '&limit=500';
          _cachedFetch(klinesUrl, 60000, true).then(function(data) {
            var candles = applyRestCandles(store, data, source, tf, 'rest-klines');
            if (candles.length) console.log('[CHART] REST klines loaded: ' + candles.length);
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
      var symbolSelect = event.target.closest('[data-v6-action="symbol-select"]');
      if (symbolSelect) {
        var symbol = symbolSelect.value;
        var state = store.getState();
        if (state.source === 'mock') {
          var mockState = V6OF.Mock.createState({ symbol: symbol, timeframe: state.timeframe });
          store.setState(mockState, 'symbol-change-mock');
        } else {
          store.setState({ symbol: symbol }, 'symbol-change');
          if (engineClient) {
            engineClient.clearTrades();
            engineClient.clearHeatmap();
            engineClient.clearFootprint();
            if (engineClient.sendMessage) {
              engineClient.sendMessage({ type: 'symbol_switch', symbol: symbol });
            }
          }
          prefetchDomDepth(store, 'symbol-change');
          var tf = state.timeframe || '1m';
          var source = state.dataSource || 'binance';
          var isHL = source === 'hyperliquid';
          var normSymbol = normalizeSymbol(symbol, source);

          var depthUrl = isHL
            ? '/api/hyperliquid/orderbook?market=' + normSymbol
            : '/api/market/depth?symbol=' + normSymbol + '&limit=5000';
          _cachedFetch(depthUrl, 5000).then(function(data) {
            applyRestOrderBook(store, data, source, 'rest-depth');
          }).catch(function(e) { console.warn('[DOM] REST depth failed', e); });

          var tradesPrefill = restTradePrefillLimit(state.settings);
          var tradesUrl = isHL
            ? '/api/hyperliquid/trades?market=' + normSymbol + '&limit=' + tradesPrefill
            : '/api/market/aggtrades?symbol=' + normSymbol + '&limit=' + tradesPrefill;
          _cachedFetch(tradesUrl, 15000).then(function(data) {
            applyRestTrades(store, data, source, normSymbol, 'rest-trades');
          }).catch(function(e) { console.warn('[TAPE] REST trades failed', e); });

          var klinesUrl = isHL
            ? '/api/hyperliquid/klines?market=' + normSymbol + '&interval=' + tf + '&limit=500'
            : '/api/market/klines?symbol=' + normSymbol + '&interval=' + tf + '&limit=500';
          _cachedFetch(klinesUrl, 60000).then(function(data) {
            applyRestCandles(store, data, source, tf, 'rest-klines');
          }).catch(function(e) { console.warn('[CHART] REST klines failed', e); });
        }
        return;
      }

      var input = event.target.closest('[data-v6-setting]');
      if (!input) return;
      var key = input.getAttribute('data-v6-setting');
      var state = store.getState();

      if (key === 'symbol') {
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
                 key === 'showVwap' || key === 'showHeatmap' || key === 'showFootprint' ||
                 key === 'showLastPrice' || key === 'showGrid' || key === 'showVwapBands' ||
                 key === 'alertsEnabled' || key === 'showFootprintVA') {
        var patch = {};
        patch[key] = !!input.checked;
        store.updateSettings(patch);
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
      } else if (key === 'restTradePrefillLimit') {
        store.updateSettings({ restTradePrefillLimit: Math.max(50, Math.min(5000, Math.round(Number(input.value) || 500))) });
      } else if (key === 'maxTrades') {
        store.updateSettings({ maxTrades: Math.max(50, Math.min(5000, Number(input.value) || 500)) });
      } else if (key === 'maxHeatmapFrames') {
        store.updateSettings({ heatmapMaxFrames: Math.max(60, Math.min(1000, Number(input.value) || 360)) });
      } else if (key === 'maxFootprintCandles') {
        store.updateSettings({ footprintMaxCandles: Math.max(30, Math.min(300, Number(input.value) || 120)) });
      } else if (key === 'domDepth') {
        store.updateSettings({ domDepth: Math.max(5, Math.min(50, Number(input.value) || 20)) });
      } else if (key === 'domMinNotionalUsd') {
        store.updateSettings({ domMinNotionalUsd: Math.max(0, Math.min(10000000, Number(input.value) || 100)) });
      } else if (key === 'domFollowThresholdTicks') {
        store.updateSettings({ domFollowThresholdTicks: Math.max(1, Math.min(20, Math.round(Number(input.value) || 1))) });
      } else if (key === 'domGroup') {
        store.updateSettings({ domGroup: Math.max(1, Math.min(100, Math.round(Number(input.value) || 1))) });
      } else if (key === 'vwapBand1') {
        store.updateSettings({ vwapBand1: Math.max(0.1, Math.min(5, Number(input.value) || 1)) });
      } else if (key === 'vwapBand2') {
        store.updateSettings({ vwapBand2: Math.max(0.1, Math.min(8, Number(input.value) || 2)) });
      } else if (key === 'largeTradeAlertQty') {
        store.updateSettings({ largeTradeAlertQty: Math.max(0, Number(input.value) || 0) });
      } else if (key === 'deltaAlertThreshold') {
        store.updateSettings({ deltaAlertThreshold: Math.max(0, Number(input.value) || 0) });
      } else if (key === 'imbalanceRatio') {
        store.updateSettings({ imbalanceRatio: Math.max(1.5, Math.min(8, Number(input.value) || 3)) });
      } else if (key === 'imbalanceStack') {
        store.updateSettings({ imbalanceStack: Math.max(2, Math.min(6, Math.round(Number(input.value) || 3))) });
      } else if (key === 'minWickTicks') {
        store.updateSettings({ minWickTicks: Math.max(0, Math.min(10, Math.round(Number(input.value) || 0))) });
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
      var savedSettings = (V6OF.Settings && V6OF.Settings.load) ? V6OF.Settings.load() : {};
      hydrateThemeVars(root, savedSettings);
      root.innerHTML = shellHtml();
      root.setAttribute('aria-busy', 'false');

      // Load settings from localStorage. Start from an EMPTY live state — no
      // mock/fake data is ever generated unless data-v6-mode="mock" is set.
      var initial;
      var isMockMode = root.getAttribute('data-v6-mode') === 'mock';
      if (isMockMode && V6OF.Mock && typeof V6OF.Mock.createState === 'function') {
        initial = V6OF.Mock.createState({ symbol: 'BTCUSDT' });
      } else {
        initial = V6OF.Contract.createEmptyState();
        initial.source = 'live';
        initial.dataFreshness = 'offline';
        initial.transportStatus = 'disconnected';
      }
      if (savedSettings && Object.keys(savedSettings).length) {
        initial.settings = Object.assign({}, initial.settings, savedSettings);
      }

      var store = V6OF.store = V6OF.createStore(initial);

      // Bind localStorage auto-save
      if (V6OF.Settings && V6OF.Settings.bindStore) {
        V6OF.Settings.bindStore(store);
      }

      var engineClient = bind(root, store);
      root._v6EngineClient = engineClient;
      store.subscribe(function (state) { render(root, state); });
      render(root, store.getState(), true);

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

      // Initialize and auto-connect the WebSocket engine client on startup
      if (engineClient) {
        renderEngineBar(root, {
          status: 'connecting',
          stats: engineClient.getStats(),
          paused: false
        }, store.getState());
        if (store.getState().source !== 'mock') {
          store.setState({ source: 'live', dataFreshness: 'offline', transportStatus: 'connecting', trades: [] }, 'init-connect');
          prefetchDomDepth(store, 'init-connect');
          startDomDepthRefresh(root, store);
          if (typeof engineClient.connect === 'function') {
            engineClient.connect();
          }
        }
      }

      // Mount the backtest/replay control in the header actions.
      if (V6OF.Backtest && V6OF.Backtest.mount) {
        var actions = root.querySelector('.v6-header-actions');
        if (actions) V6OF.Backtest.mount(actions, store);
      }

      window.addEventListener('resize', function () {
        render(root, store.getState(), true);
      });
      document.addEventListener('pageChange', function (event) {
        if (event.detail && event.detail.page === 'orderflow') {
          requestAnimationFrame(function () {
            render(root, store.getState(), true);
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
