// ---------- 072_v6_orderflow_mock.js ----------
// Deterministic BTC/ETH/SOL mock data. This module does not fetch or stream.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};

  function makeRng(seed) {
    var s = Math.max(1, seed || 1) % 2147483647;
    return function () {
      s = (s * 16807) % 2147483647;
      return (s - 1) / 2147483646;
    };
  }

  function round(value, digits) {
    var m = Math.pow(10, digits || 0);
    return Math.round(value * m) / m;
  }

  function baseForSymbol(symbol) {
    if (symbol === 'ETHUSDT') return { price: 4200, tick: 0.5, qty: 14 };
    if (symbol === 'SOLUSDT') return { price: 184, tick: 0.05, qty: 240 };
    return { price: 104200, tick: 1, qty: 1.8 };
  }

  function createCandles(symbol, timeframe, now, rng, meta) {
    var candles = [];
    var intervalMs = 60000;
    var price = meta.price;
    var start = now - intervalMs * 47;

    for (var i = 0; i < 48; i++) {
      var open = price;
      var drift = (rng() - 0.47) * meta.tick * 95;
      var close = Math.max(meta.tick, open + drift);
      var wick = meta.tick * (18 + rng() * 55);
      var high = Math.max(open, close) + wick * rng();
      var low = Math.min(open, close) - wick * rng();
      var buyVol = meta.qty * (18 + rng() * 62);
      var sellVol = meta.qty * (18 + rng() * 62);
      var delta = buyVol - sellVol;

      candles.push({
        symbol: symbol,
        timeframe: timeframe,
        openTime: start + i * intervalMs,
        closeTime: start + (i + 1) * intervalMs,
        open: round(open, 4),
        high: round(high, 4),
        low: round(Math.max(meta.tick, low), 4),
        close: round(close, 4),
        volume: round(buyVol + sellVol, 3),
        delta: round(delta, 3)
      });

      price = close;
    }
    return candles;
  }

  function createTrades(symbol, now, rng, candles, meta) {
    var trades = [];
    var idBase = Math.floor(now / 1000);

    for (var i = 0; i < 150; i++) {
      var candle = candles[Math.max(0, candles.length - 1 - Math.floor(i / 4))];
      var side = rng() > 0.48 ? 'buy' : 'sell';
      var qty = meta.qty * (0.08 + Math.pow(rng(), 2) * 8.5);
      if (rng() > 0.94) qty *= 5.5;
      var priceSpan = Math.max(meta.tick, candle.high - candle.low);
      var price = candle.low + priceSpan * rng();
      var ts = now - i * (650 + Math.floor(rng() * 2400));

      trades.push({
        id: 'mock-' + symbol + '-' + (idBase - i),
        exchange: 'mock',
        symbol: symbol,
        tsExchange: ts,
        tsLocal: ts + 12,
        price: round(price, 4),
        qty: round(qty, 4),
        side: side,
        notional: round(price * qty, 2)
      });
    }
    return trades.sort(function (a, b) { return b.tsExchange - a.tsExchange; });
  }

  function createOrderBook(symbol, now, rng, lastPrice, meta) {
    var levels = 14;
    var bids = [];
    var asks = [];
    var bidCum = 0;
    var askCum = 0;
    var spread = meta.tick * 2;
    var bestBid = Math.floor((lastPrice - spread / 2) / meta.tick) * meta.tick;
    var bestAsk = bestBid + spread;

    for (var i = 0; i < levels; i++) {
      var bidSize = meta.qty * (5 + rng() * 48) * (1 + i * 0.09);
      var askSize = meta.qty * (5 + rng() * 48) * (1 + i * 0.09);
      bidCum += bidSize;
      askCum += askSize;
      bids.push({
        price: round(bestBid - i * meta.tick, 4),
        size: round(bidSize, 4),
        orders: 1 + Math.floor(rng() * 8),
        cumulative: round(bidCum, 4)
      });
      asks.push({
        price: round(bestAsk + i * meta.tick, 4),
        size: round(askSize, 4),
        orders: 1 + Math.floor(rng() * 8),
        cumulative: round(askCum, 4)
      });
    }

    return {
      exchange: 'mock',
      symbol: symbol,
      tsExchange: now,
      tsLocal: now + 10,
      bids: bids,
      asks: asks,
      bestBid: round(bestBid, 4),
      bestAsk: round(bestAsk, 4),
      spread: round(bestAsk - bestBid, 4),
      mid: round((bestBid + bestAsk) / 2, 4),
      depth: levels,
      source: 'mock'
    };
  }

  function createDeltaBuckets(symbol, candles) {
    var cvd = 0;
    return candles.map(function (c) {
      var buyVol = Math.max(0, (c.volume + c.delta) / 2);
      var sellVol = Math.max(0, (c.volume - c.delta) / 2);
      cvd += c.delta;
      return {
        symbol: symbol,
        timeframe: c.timeframe,
        startTime: c.openTime,
        endTime: c.closeTime,
        buyVol: round(buyVol, 3),
        sellVol: round(sellVol, 3),
        delta: round(c.delta, 3),
        cvd: round(cvd, 3)
      };
    });
  }

  function createVwap(symbol, now, trades) {
    var cumPV = 0;
    var cumVol = 0;
    trades.forEach(function (trade) {
      cumPV += trade.price * trade.qty;
      cumVol += trade.qty;
    });
    return {
      symbol: symbol,
      sessionId: 'mock-utc-' + new Date(now).toISOString().slice(0, 10),
      sessionStart: Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()),
      ts: now,
      cumPV: round(cumPV, 4),
      cumVol: round(cumVol, 4),
      value: cumVol > 0 ? round(cumPV / cumVol, 4) : 0
    };
  }

  V6OF.Mock = {
    createState: function (opts) {
      opts = opts || {};
      var symbol = opts.symbol || 'BTCUSDT';
      var seed = opts.seed || 42;
      var timeframe = opts.timeframe || '1m';
      var now = opts.now || Date.now();
      var meta = baseForSymbol(symbol);
      var rng = makeRng(seed + symbol.length * 17);
      var candles = createCandles(symbol, timeframe, now, rng, meta);
      var trades = createTrades(symbol, now, rng, candles, meta);
      var last = candles[candles.length - 1] ? candles[candles.length - 1].close : meta.price;

      return Object.assign(V6OF.Contract.createEmptyState(), {
        source: 'mock',
        symbol: symbol,
        timeframe: timeframe,
        trades: trades,
        orderBook: createOrderBook(symbol, now, rng, last, meta),
        candles: candles,
        deltaBuckets: createDeltaBuckets(symbol, candles),
        vwap: createVwap(symbol, now, trades),
        settings: {
          minQty: 0,
          maxRows: 42,
          showVwap: true,
          showHeatmap: true,
          showFootprint: true,
          chartMode: 'both',
          heatmapMaxFrames: 360,
          footprintMaxCandles: 160,
          tickSize: meta.tick
        },
        ui: {
          legacyMode: false,
          seed: seed
        }
      });
    }
  };
})();
