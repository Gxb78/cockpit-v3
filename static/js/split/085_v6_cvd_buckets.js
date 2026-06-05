// ---------- 085_v6_cvd_buckets.js ----------
// Multi-bucket CVD (Cumulative Volume Delta) split by trade $ notional size,
// plus a per-candle Delta-Volume histogram — Tradr/Aggr "Ultra" style.
//
// All aggregation is per-candle and live-only (trades since connect): each
// trade is counted exactly once via addTrade(). The chart engine reads
// V6OF.CvdBuckets state and draws stacked sub-panes under the price chart.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};

  // Size buckets by trade notional ($). For now we display a single "total"
  // CVD line (classic). Size-breakdown can be re-enabled when real trade data
  // with notional info is consistently available from backfill.
  var BUCKETS = [
    { key: 'total', label: 'CVD',    min: 0,        max: 1e12,  color: '#050505' },
  ];

  var INTERVAL_MS = 60000;          // per-candle bucket = 1 minute
  var MAX_POINTS = 200000;           // ~10x the previous 1m CVD retention

  // cvd[bucketKey] = running cumulative delta (across whole session)
  var cvd = {};
  // series[bucketKey] = [{ t, v }] sampled cumulative value per candle close
  var series = {};
  // deltaVol = [{ t, delta }] net delta volume per candle (histogram)
  var deltaVol = [];
  var curBucketStart = 0;
  var curDelta = {};      // per-bucket delta within the current candle
  var curNetDelta = 0;    // net (all sizes) delta within current candle
  var lastTs = 0;

  // Metadata sur la source des données
  var cvdSource = 'real_trades';    // 'real_trades' | 'ohlcv_estimate' | 'mixed'
  var estimatedUntil = 0;           // timestamp ms
  var realTradeCount = 0;

  function reset() {
    cvd = {};
    series = {};
    deltaVol = [];
    curDelta = {};
    curNetDelta = 0;
    curBucketStart = 0;
    cvdSource = 'real_trades';
    estimatedUntil = 0;
    realTradeCount = 0;
    BUCKETS.forEach(function (b) { cvd[b.key] = 0; series[b.key] = []; curDelta[b.key] = 0; });
  }
  reset();

  function bucketFor(notional) {
    for (var i = 0; i < BUCKETS.length; i++) {
      if (notional >= BUCKETS[i].min && notional < BUCKETS[i].max) return BUCKETS[i].key;
    }
    return null;
  }

  function pushPoint(t) {
    BUCKETS.forEach(function (b) {
      cvd[b.key] += curDelta[b.key];
      var arr = series[b.key];
      arr.push({ t: t, v: cvd[b.key] });
      if (arr.length > MAX_POINTS) arr.shift();
      curDelta[b.key] = 0;
    });
    deltaVol.push({ t: t, delta: curNetDelta });
    if (deltaVol.length > MAX_POINTS) deltaVol.shift();
    curNetDelta = 0;
  }

  function addTrade(trade) {
    if (!trade) return;
    var ts = Number(trade.tsExchange) || Number(trade.tsLocal) || Date.now();
    var qty = Number(trade.qty) || 0;
    var price = Number(trade.price) || 0;
    var notional = Number(trade.notional) || (qty * price);
    if (notional <= 0) return;
    var signed = (trade.side === 'sell') ? -qty : qty;

    var bucketStart = Math.floor(ts / INTERVAL_MS) * INTERVAL_MS;
    if (curBucketStart === 0) curBucketStart = bucketStart;
    // Roll over completed candle(s).
    while (bucketStart > curBucketStart) {
      pushPoint(curBucketStart);
      curBucketStart += INTERVAL_MS;
    }

    var k = bucketFor(notional);
    if (k) curDelta[k] += signed;
    curNetDelta += signed;
    lastTs = ts;
  }

  // Live "tip" of each series = committed cvd + the forming candle's delta.
  function snapshot() {
    var out = { buckets: BUCKETS, series: {}, deltaVol: deltaVol.slice(), tip: {}, interval: INTERVAL_MS, lastTs: lastTs,
      cvdSource: cvdSource, estimatedUntil: estimatedUntil, realTradeCount: realTradeCount };
    BUCKETS.forEach(function (b) {
      out.series[b.key] = series[b.key].slice();
      out.tip[b.key] = cvd[b.key] + curDelta[b.key];
    });
    return out;
  }

  V6OF.CvdBuckets = {
  BUCKETS: BUCKETS,
  addTrade: addTrade,
  reset: reset,
  snapshot: snapshot,
  loadHistory: function (data, intervalMs) {
    // data = { series: {s: [{t,v}], m: [{t,v}], l: [{t,v}]},
    //           deltaVol: [{t,delta}],
    //           cvd: {s: num, m: num, l: num} }
    // Chargé depuis le serveur WS au démarrage (message cvd_init).
    // Skip si vide — on garde les trades live déjà accumulés.
    if (!data || !data.series) return;
    var totalPoints = 0;
    for (var k in data.series) {
      if (Array.isArray(data.series[k])) totalPoints += data.series[k].length;
    }
    if (totalPoints === 0 && (!data.deltaVol || data.deltaVol.length === 0)) return;
    if (typeof intervalMs === 'number' && intervalMs > 0) {
        INTERVAL_MS = intervalMs;
      }
      reset();
      if (data.cvd) {
        Object.keys(data.cvd).forEach(function (k) {
          if (cvd.hasOwnProperty(k)) cvd[k] = data.cvd[k];
        });
      }
      if (data.series) {
        Object.keys(data.series).forEach(function (k) {
          var arr = series[k];
          if (arr && data.series[k]) {
            data.series[k].forEach(function (p) { arr.push({ t: Number(p.t), v: Number(p.v) }); });
            if (arr.length > MAX_POINTS) arr.splice(0, arr.length - MAX_POINTS);
          }
        });
        // Recalculer le dernier startTime pour que addTrade continue
        var lastT = 0;
        for (var k in series) {
          var s = series[k];
          if (s.length && s[s.length - 1].t > lastT) lastT = s[s.length - 1].t;
        }
        if (lastT > 0) {
          curBucketStart = Math.floor(lastT / INTERVAL_MS) * INTERVAL_MS + INTERVAL_MS;
        }
      }
      if (data.deltaVol) {
        data.deltaVol.forEach(function (d) { deltaVol.push({ t: Number(d.t), delta: Number(d.delta) }); });
        if (deltaVol.length > MAX_POINTS) deltaVol.splice(0, deltaVol.length - MAX_POINTS);
      }
      // Store metadata about data source
      if (data.cvdSource) cvdSource = data.cvdSource;
      if (data.estimatedUntil) estimatedUntil = Number(data.estimatedUntil);
      if (data.realTradeCount != null) realTradeCount = Number(data.realTradeCount);
    },
    get intervalMs() { return INTERVAL_MS; }
  };
})();
