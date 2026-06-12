// ---------- 070_v6_orderflow_contract.js ----------
// Cockpit V6 data contract — domain-separated state model.
//
// Architecture domains:
//   trader    — market data (symbol, trades, candles, orderBook, heatmap, footprint, delta, vwap)
//   render    — UI configuration + transient render state (merged settings + ui)
//   transport — connection state (source, freshness, status, isStale, lastMessageAt)
//   workspace — layout profiles and active workspace name (managed by 089_v6_workspace_manager)

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};
  var domains = ['Core', 'Data', 'Transport', 'UI', 'Studies', 'Page'];
  domains.forEach(function (name) {
    V6OF[name] = V6OF[name] || {};
  });

  V6OF.register = function (domain, name, value, legacyName) {
    if (!V6OF[domain]) throw new Error('[V6OF] unknown domain: ' + domain);
    V6OF[domain][name] = value;
    if (legacyName) V6OF[legacyName] = value;
    return value;
  };

  V6OF.registerPage = function (pageName, lifecycle) {
    V6OF.Page[pageName] = Object.assign({ created: false, bound: false, mounted: false }, lifecycle || {});
    return V6OF.Page[pageName];
  };

  V6OF.Page.bootstrap = function (pageName, root) {
    var page = V6OF.Page && V6OF.Page[pageName];
    if (!page) return false;
    var nextRoot = root || page.root || null;
    if (page.mounted && page.root === nextRoot) return true;
    page.root = nextRoot;
    if (!page.created && typeof page.create === 'function') {
      page.create(page.root);
      page.created = true;
    }
    if (typeof page.mount === 'function') page.mount(page.root);
    page.mounted = true;
    if (!page.bound && typeof page.bind === 'function') {
      page.bind(page.root);
      page.bound = true;
    }
    return true;
  };

  V6OF.Page.dispose = function (pageName) {
    var page = V6OF.Page && V6OF.Page[pageName];
    if (!page || (!page.mounted && !page.created)) return false;
    if (typeof page.unmount === 'function') page.unmount(page.root);
    page.mounted = false;
    page.bound = false;
    if (typeof page.destroy === 'function') page.destroy(page.root);
    page.created = false;
    page.root = null;
    return true;
  };

  /**
   * @typedef {Object} V6Trade
   * @property {string} id
   * @property {string} exchange
   * @property {string} symbol
   * @property {number} tsExchange
   * @property {number} tsLocal
   * @property {number} price
   * @property {number} qty
   * @property {'buy'|'sell'} side
   * @property {number} notional
   */

  /**
   * @typedef {Object} V6OrderBookLevel
   * @property {number} price
   * @property {number} size
   * @property {number} orders
   * @property {number} cumulative
   */

  /**
   * @typedef {Object} V6OrderBookSnapshot
   * @property {string} exchange
   * @property {string} symbol
   * @property {number} tsExchange
   * @property {number} tsLocal
   * @property {V6OrderBookLevel[]} bids
   * @property {V6OrderBookLevel[]} asks
   * @property {number} bestBid
   * @property {number} bestAsk
   * @property {number} spread
   * @property {number} mid
   * @property {number} depth
   * @property {string} source
   */

  /**
   * @typedef {Object} V6DeltaBucket
   * @property {string} exchange
   * @property {string} symbol
   * @property {number} intervalMs
   * @property {number} startTime
   * @property {number} endTime
   * @property {number} buyVol
   * @property {number} sellVol
   * @property {number} delta
   * @property {number} cvd
   * @property {boolean} closed
   */

  /**
   * @typedef {Object} V6VWAPState
   * @property {string} exchange
   * @property {string} symbol
   * @property {string} sessionId
   * @property {number} sessionStart
   * @property {number} coverageStart
   * @property {number} lastUpdateTs
   * @property {number} cumPV
   * @property {number} cumVol
   * @property {number} value
   * @property {string} source
   * @property {boolean} isWarm
   */

  /**
   * @typedef {Object} V6Candle
   * @property {string} symbol
   * @property {string} timeframe
   * @property {number} openTime
   * @property {number} closeTime
   * @property {number} open
   * @property {number} high
   * @property {number} low
   * @property {number} close
   * @property {number} volume
   * @property {number} delta
   */

  /**
   * @typedef {Object} V6HeatmapLevel
   * @property {number} price
   * @property {number} bidSize
   * @property {number} askSize
   * @property {number} totalSize
   * @property {number} intensity
   */

  /**
   * @typedef {Object} V6HeatmapFrame
   * @property {string} exchange
   * @property {string} symbol
   * @property {number} tsExchange
   * @property {number} tsLocal
   * @property {number} mid
   * @property {number} bestBid
   * @property {number} bestAsk
   * @property {number} priceMin
   * @property {number} priceMax
   * @property {number} tickSize
   * @property {V6HeatmapLevel[]} levels
   * @property {string} source
   * @property {number} depth
   */

  /**
   * @typedef {Object} V6FootprintLevel
   * @property {number} price
   * @property {number} buyVol
   * @property {number} sellVol
   * @property {number} delta
   * @property {number} totalVol
   * @property {number} trades
   */

  /**
   * @typedef {Object} V6FootprintCandle
   * @property {string} exchange
   * @property {string} symbol
   * @property {number} intervalMs
   * @property {number} openTime
   * @property {number} closeTime
   * @property {number} open
   * @property {number} high
   * @property {number} low
   * @property {number} close
   * @property {number} volume
   * @property {number} buyVol
   * @property {number} sellVol
   * @property {number} delta
   * @property {number} poc
   * @property {boolean} closed
   * @property {V6FootprintLevel[]} levels
   * @property {string} source
   */

  V6OF.register('Core', 'Contract', {
    version: 'v6.orderflow.v1',
    source: 'live',
    createEmptyState: function () {
      return {
        contractVersion: 'v6.orderflow.v1',
        source: 'live',
        dataFreshness: 'offline',
        transportStatus: 'disconnected',
        engineConfigStatus: 'stale',
        engineConfigSyncedAt: 0,
        engineConfigStaleAt: 0,
        engineConfigError: '',
        symbol: 'BTCUSDT',
        timeframe: '1m',
        dataSource: 'binance',
        trades: [],
        tradeHistoryCount: 0,
        orderBook: null,
        lastOrderBookBySymbol: {},
        orderBookCount: 0,
        lastOrderBookTs: 0,
        selectedDomSymbol: '',
        heatmapFrames: [],
        heatmapFrameCount: 0,
        lastHeatmapFrame: null,
        lastHeatmapTs: 0,
        selectedHeatmapSymbol: '',
        footprintCandles: [],
        footprintCandleCount: 0,
        lastFootprintCandle: null,
        lastFootprintTs: 0,
        selectedFootprintSymbol: '',
        candles: [],
        chartCandles: [],
        deltaBuckets: [],
        deltaBucketHistoryCount: 0,
        deltaBucketsByInterval: {},
        latestDeltaByInterval: {},
        vwap: null,
        vwapBySymbol: {},
        _candlesByInterval: {},
        lastMessageAt: 0,
        isStale: false,
        depthHistory: [],
        depthHistoryCount: 0,
        // ── Workspace bridge (fed by 089_v6_workspace_manager) ──
        activeWorkspace: 'Scalping',
        workspaceList: {},
        // ── Render config ──
        settings: {
          minQty: 0,
          maxRows: 5000,
          showTape: true,
          showDOM: true,
          showCVD: true,
          showVwap: true,
          showCandles: true,
          showBubbles: true,
          showHeatmap: false,
          showFootprint: false,
          showLastPrice: true,
          showGrid: true,
          showSessionZones: true,
          sessionProfile: 'global',
          bgColor: '#ffffff',
          upColor: '#089981',
          downColor: '#f23645',
          chartMode: 'both',
          maxTrades: 100000,
          heatmapMaxFrames: 100000,
          footprintMaxCandles: 100000,
          footprintHistoryLookbackMinutes: 10080,
          deltaIntervalMs: 60000,
          domDepth: 5000,
          domRangeLevels: 1000,
          domValueMode: 'coin',
          tickSize: 1,
          inspectorTimeZoneMode: 'utc',
          showFootprintVA: true,
          imbalanceRatio: 3.0,
          imbalanceStack: 3,
          imbalanceMinVolume: 1.0,
          exhaustionFactor: 0.35,
          footprintValueAreaPct: 70,
          minWickTicks: 0
          ,
          theme: 'light-tv',
          indicators: [],
          indicatorSources: []
        },
        ui: {
          seed: 42,
          activeTab: 'dom',
          dockCollapsed: false,
          hoveredCandle: null,
          pinnedCandle: null,
          panelSizes: {},
          layerPreset: 'scalping',
          activeIndicatorId: '',
          indicatorEditorOpen: false,
          indicatorPaneSizes: {},
          indicatorToolbarOpen: '',
          singleClickFitLiveDelayMs: 180,
          activeCandleOpenTime: 0,
          activeCandleCloseTime: 0,
          activeCandleSource: '',
          activeCandleSnapshot: null,
          activeCandleLocked: false,
          activeCandleUpdatedAt: 0
        }
      };
    },
    isTrade: function (value) {
      return !!value &&
        typeof value.id === 'string' &&
        typeof value.symbol === 'string' &&
        Number.isFinite(value.tsExchange) &&
        Number.isFinite(value.price) &&
        Number.isFinite(value.qty) &&
        (value.side === 'buy' || value.side === 'sell');
    },

    // ── Domain accessors: decompose flat state into architectural domains ──

    TRADER_FIELDS: [
      'symbol','timeframe','dataSource','trades','tradeHistoryCount',
      'orderBook','lastOrderBookBySymbol','orderBookCount','lastOrderBookTs','selectedDomSymbol',
      'heatmapFrames','heatmapFrameCount','lastHeatmapFrame','lastHeatmapTs','selectedHeatmapSymbol',
      'footprintCandles','footprintCandleCount','lastFootprintCandle','lastFootprintTs','selectedFootprintSymbol',
      'candles','chartCandles','_candlesByInterval',
      'deltaBuckets','deltaBucketHistoryCount','deltaBucketsByInterval','latestDeltaByInterval',
      'vwap','vwapBySymbol','depthHistory','depthHistoryCount'
    ],
    getTraderState: function (state) {
      var t = {};
      for (var i = 0; i < this.TRADER_FIELDS.length; i++) {
        var k = this.TRADER_FIELDS[i];
        t[k] = state[k];
      }
      return t;
    },

    RENDER_FIELDS: [
      'settings','ui'
    ],
    getRenderState: function (state) {
      // Merge settings + ui into a single render view
      return Object.assign({}, state.settings, state.ui);
    },

    TRANSPORT_FIELDS: [
      'source','dataFreshness','transportStatus','engineConfigStatus',
      'engineConfigSyncedAt','engineConfigStaleAt','engineConfigError',
      'isStale','lastMessageAt'
    ],
    getTransportState: function (state) {
      var t = {};
      for (var i = 0; i < this.TRANSPORT_FIELDS.length; i++) {
        var k = this.TRANSPORT_FIELDS[i];
        t[k] = state[k];
      }
      return t;
    },

    getWorkspaceState: function (state) {
      return {
        activeWorkspace: state.activeWorkspace || '',
        workspaceList: state.workspaceList || {}
      };
    }
  }, 'Contract');

  V6OF.register('Core', 'escapeHtml', function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }, 'escapeHtml');

  V6OF.register('Core', 'format', {
    price: function (value) {
      if (!Number.isFinite(value)) return '--';
      return value.toLocaleString('en-US', {
        minimumFractionDigits: value >= 1000 ? 1 : 2,
        maximumFractionDigits: value >= 1000 ? 1 : 4
      });
    },
    qty: function (value) {
      if (!Number.isFinite(value)) return '--';
      if (value >= 1000) return (value / 1000).toFixed(1) + 'K';
      if (value >= 100) return value.toFixed(0);
      if (value >= 10) return value.toFixed(1);
      return value.toFixed(3);
    },
    signed: function (value) {
      if (!Number.isFinite(value)) return '--';
      var sign = value > 0 ? '+' : '';
      return sign + V6OF.format.qty(value);
    },
    time: function (ts) {
      if (!Number.isFinite(ts)) return '--:--:--';
      return new Date(ts).toLocaleTimeString([], {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    }
  }, 'format');
})();
