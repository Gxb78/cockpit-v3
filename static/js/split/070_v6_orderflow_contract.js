// ---------- 070_v6_orderflow_contract.js ----------
// Cockpit V6 mock data contract. No live data, no network access.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};

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

  V6OF.Contract = {
    version: 'v6.orderflow.v1',
    source: 'mock',
    createEmptyState: function () {
      return {
        contractVersion: 'v6.orderflow.v1',
        source: 'mock',
        dataFreshness: 'mock',
        transportStatus: 'disconnected',
        symbol: 'BTCUSDT',
        timeframe: '1m',
        dataSource: 'binance',
        trades: [],
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
        deltaBucketsByInterval: {},
        latestDeltaByInterval: {},
        vwap: null,
        vwapBySymbol: {},
        _candlesByInterval: {},
        lastMessageAt: 0,
        isStale: false,
        settings: {
          minQty: 0,
          maxRows: 42,
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
          bgColor: '#080b12',
          upColor: '#3ddc97',
          downColor: '#ff5f73',
          chartMode: 'both',
          maxTrades: 500,
          heatmapMaxFrames: 360,
          footprintMaxCandles: 120,
          deltaIntervalMs: 60000,
          domDepth: 20,
          tickSize: 1
        },
        ui: {
          legacyMode: false,
          seed: 42
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
    }
  };

  V6OF.escapeHtml = function (value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  V6OF.format = {
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
  };
})();
