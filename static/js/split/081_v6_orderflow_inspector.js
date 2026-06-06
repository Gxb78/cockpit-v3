// ---------- 081_v6_orderflow_inspector.js ----------
// Candle inspector and visible replay strip for the V6 orderflow shell.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};
  var REPLAY_URL = 'http://127.0.0.1:8765/replay';
  var missingFootprintLoads = {};
  var missingFootprintFailures = {};
  var AGGTRADES_FOOTPRINT_PAGE_LIMIT = 8000;
  var AGGTRADES_FOOTPRINT_MAX_SPLIT_DEPTH = 6;

  function esc(value) {
    return V6OF.escapeHtml ? V6OF.escapeHtml(value) : String(value == null ? '' : value);
  }

  function num(value, fallback) {
    value = Number(value);
    return Number.isFinite(value) ? value : (fallback == null ? 0 : fallback);
  }

  function fmtPrice(value) {
    return V6OF.format && V6OF.format.price ? V6OF.format.price(value) : String(num(value));
  }

  function fmtQty(value) {
    return V6OF.format && V6OF.format.qty ? V6OF.format.qty(value) : num(value).toFixed(2);
  }

  function fmtSigned(value) {
    return V6OF.format && V6OF.format.signed ? V6OF.format.signed(value) : ((num(value) >= 0 ? '+' : '') + num(value).toFixed(2));
  }

  function fmtTime(ms) {
    ms = num(ms);
    if (!ms) return '--:--:--';
    var d = new Date(ms);
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    // UTC — all exchange timestamps are UTC
    return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
  }

  function fmtDate(ms) {
    ms = num(ms);
    if (!ms) return '----.--.--';
    var d = new Date(ms);
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
  }

  function fmtDateTime(ms) {
    return fmtDate(ms) + ' ' + fmtTime(ms);
  }

  function intervalMsToTf(ms) {
    ms = num(ms);
    if (ms <= 0) return '';
    if (ms % 3600000 === 0) return (ms / 3600000) + 'h';
    if (ms % 60000 === 0) return (ms / 60000) + 'm';
    if (ms % 1000 === 0) return (ms / 1000) + 's';
    return ms + 'ms';
  }

  function candleTimeframe(candle, state) {
    // Use candle's own timeframe if available
    if (candle && candle.timeframe) return candle.timeframe;
    // Derive from intervalMs
    if (candle && candle.intervalMs) return intervalMsToTf(candle.intervalMs);
    // Fallback: compute from openTime/closeTime
    var o = openTime(candle);
    var c = closeTime(candle);
    if (o > 0 && c > o) return intervalMsToTf(c - o + 1);
    // Absolute fallback
    return (state && state.timeframe) || '1m';
  }

  function yesterdayISO() {
    var d = new Date(Date.now() - 86400000);
    return d.toISOString().slice(0, 10);
  }

  function openTime(candle) {
    return num(candle && candle.openTime);
  }

  function closeTime(candle) {
    return num(candle && candle.closeTime);
  }

  function timeframeToMs(tf) {
    tf = String(tf || '1m');
    var match = tf.match(/^(\d+)([mhd])$/i);
    if (!match) return 60000;
    var value = parseInt(match[1], 10);
    var unit = match[2].toLowerCase();
    if (unit === 'm') return value * 60000;
    if (unit === 'h') return value * 3600000;
    if (unit === 'd') return value * 86400000;
    return 60000;
  }

  function candleIndex(list, candle) {
    var target = openTime(candle);
    for (var i = 0; i < list.length; i++) {
      if (openTime(list[i]) === target) return i;
    }
    return -1;
  }

  function findByOpenTime(list, target) {
    target = num(target);
    if (!target || !Array.isArray(list)) return null;
    for (var i = 0; i < list.length; i++) {
      if (openTime(list[i]) === target) return list[i];
    }
    return null;
  }

  function findActiveCandle(state) {
    state = state || {};
    var ui = state.ui || {};
    var fp = Array.isArray(state.footprintCandles) ? state.footprintCandles : [];
    var chart = Array.isArray(state.chartCandles) ? state.chartCandles : [];
    var target = num(ui.activeCandleOpenTime);

    // No active selection — return null (don't fall back to last candle)
    if (!target) return null;

    var fpMatch = findByOpenTime(fp, target);
    var chartMatch = findByOpenTime(chart, target);
    var snapshot = ui.activeCandleSnapshot && num(ui.activeCandleSnapshot.openTime) === target ? ui.activeCandleSnapshot : null;
    var candle = fpMatch || chartMatch || snapshot;
    var source = fpMatch ? 'footprint' : (chartMatch ? 'chart' : (snapshot ? (ui.activeCandleSource || snapshot.source || 'chart') : ''));
    if (!candle) return null;
    var list = source === 'footprint' ? fp : chart;
    return {
      candle: candle,
      source: source,
      index: candleIndex(list, candle),
      total: list.length,
      locked: !!ui.activeCandleLocked
    };
  }

  function levelVolume(level) {
    return num(level.totalVol, num(level.buyVol) + num(level.sellVol));
  }

  function ratioText(value) {
    if (value === Infinity) return 'inf';
    if (!Number.isFinite(value) || value <= 0) return '--';
    return value.toFixed(value >= 10 ? 0 : 1) + 'x';
  }

  function nearestLevelIndex(levels, price) {
    if (!levels || !levels.length || !Number.isFinite(Number(price))) return -1;
    var bestIdx = -1;
    var bestDist = Infinity;
    var target = Number(price);
    for (var i = 0; i < levels.length; i++) {
      var dist = Math.abs(Number(levels[i].price) - target);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function deriveMetrics(candle, state) {
    var settings = (state && state.settings) || {};
    var levels = Array.isArray(candle.levels) ? candle.levels.slice() : [];
    
    // Sort levels ascending by price (correcting b.price bug)
    levels.sort(function (a, b) { return num(a.price) - num(b.price); });
    
    var buy = num(candle.buyVol);
    var sell = num(candle.sellVol);
    var delta = num(candle.delta);
    var volume = num(candle.volume);
    
    if ((!buy && !sell) && levels.length) {
      levels.forEach(function (level) {
        buy += num(level.buyVol);
        sell += num(level.sellVol);
      });
    }
    if (!volume && (buy || sell)) volume = buy + sell;
    if (!delta && (buy || sell)) delta = buy - sell;
    var buySellDerived = false;
    if ((!buy && !sell) && volume) {
      // No measured aggressor flow (partial candle / price-only source): split
      // total volume by delta. This is a synthesized decomposition, NOT real
      // buy/sell data — flag it so the UI can mark the metric "derived" and
      // avoid implying false sentiment.
      buy = Math.max(0, (volume + delta) / 2);
      sell = Math.max(0, (volume - delta) / 2);
      buySellDerived = true;
    }
    
    var imbRatio = num(settings.imbalanceRatio, 3.0);
    var minStack = num(settings.imbalanceStack, 3);
    var minVolume = 1.0; // Filter to avoid tiny calculations
    
    // Initialize properties
    levels.forEach(function (lvl) {
      lvl.buyImbalance = false;
      lvl.sellImbalance = false;
      lvl.buyRatio = 0;
      lvl.sellRatio = 0;
      lvl.totalVol = num(lvl.buyVol) + num(lvl.sellVol);
      lvl.delta = num(lvl.buyVol) - num(lvl.sellVol);
    });
    
    // Calculate diagonal imbalances (Standard Orderflow comparison)
    var maxRatio = 0;
    for (var i = 0; i < levels.length; i++) {
      var lvl = levels[i];
      // 1. Buy Imbalance (Ask side at P vs Bid side at P-1)
      if (i > 0) {
        var diagSell = num(levels[i - 1].sellVol);
        var curBuy = num(lvl.buyVol);
        if (diagSell > minVolume && curBuy > minVolume) {
          lvl.buyRatio = curBuy / diagSell;
          if (lvl.buyRatio >= imbRatio) {
            lvl.buyImbalance = true;
          }
          if (lvl.buyRatio > maxRatio) maxRatio = lvl.buyRatio;
        }
      }
      // 2. Sell Imbalance (Bid side at P vs Ask side at P+1)
      if (i < levels.length - 1) {
        var diagBuy = num(levels[i + 1].buyVol);
        var curSell = num(lvl.sellVol);
        if (diagBuy > minVolume && curSell > minVolume) {
          lvl.sellRatio = curSell / diagBuy;
          if (lvl.sellRatio >= imbRatio) {
            lvl.sellImbalance = true;
          }
          if (lvl.sellRatio > maxRatio) maxRatio = lvl.sellRatio;
        }
      }
    }
    
    // Calculate stacked imbalances
    var buyRun = 0, sellRun = 0;
    var maxBuyRun = 0, maxSellRun = 0;
    var buyImb = 0, sellImb = 0;
    
    levels.forEach(function (lvl) {
      if (lvl.buyImbalance) {
        buyImb++;
        buyRun++;
        sellRun = 0;
      } else if (lvl.sellImbalance) {
        sellImb++;
        sellRun++;
        buyRun = 0;
      } else {
        buyRun = 0;
        sellRun = 0;
      }
      if (buyRun > maxBuyRun) maxBuyRun = buyRun;
      if (sellRun > maxSellRun) maxSellRun = sellRun;
    });
    
    // Calculate Value Area (VAH / VAL / POC)
    var poc = 0, vah = 0, val = 0;
    var vaSet = new Set();
    if (levels.length) {
      var totalVol = levels.reduce(function (sum, l) { return sum + l.totalVol; }, 0);
      var sortedByVol = levels.slice().sort(function (a, b) { return b.totalVol - a.totalVol; });
      var pocLevel = sortedByVol[0];
      poc = pocLevel.price;
      
      var pocIdx = levels.findIndex(function (l) { return l.price === poc; });
      vaSet.add(poc);
      
      var accumVol = pocLevel.totalVol;
      var targetVol = totalVol * 0.70;
      
      var up = pocIdx + 1;
      var down = pocIdx - 1;
      
      while (accumVol < targetVol && (up < levels.length || down >= 0)) {
        var upVol = up < levels.length ? levels[up].totalVol : 0;
        var downVol = down >= 0 ? levels[down].totalVol : 0;
        if (upVol === 0 && downVol === 0) break;
        
        if (upVol >= downVol) {
          accumVol += upVol;
          vaSet.add(levels[up].price);
          up++;
        } else {
          accumVol += downVol;
          vaSet.add(levels[down].price);
          down--;
        }
      }
      
      var prices = Array.from(vaSet);
      val = Math.min.apply(null, prices);
      vah = Math.max.apply(null, prices);
    }
    
    // Locate price indices closest to Open and Close
    var openIdx = nearestLevelIndex(levels, candle.open);
    var closeIdx = nearestLevelIndex(levels, candle.close);
    
    // Low / High absorption & exhaustion
    var avgLevelVol = levels.length ? levels.reduce(function (sum, l) { return sum + l.totalVol; }, 0) / levels.length : 0;
    var lowLevel = levels.length ? levels[0] : null;
    var highLevel = levels.length ? levels[levels.length - 1] : null;
    var lowTotal = lowLevel ? lowLevel.totalVol : 0;
    var highTotal = highLevel ? highLevel.totalVol : 0;
    var lowBuyRatio = lowLevel ? (num(lowLevel.sellVol) > 0 ? num(lowLevel.buyVol) / num(lowLevel.sellVol) : (num(lowLevel.buyVol) > 0 ? Infinity : 0)) : 0;
    var highSellRatio = highLevel ? (num(highLevel.buyVol) > 0 ? num(highLevel.sellVol) / num(highLevel.buyVol) : (num(highLevel.sellVol) > 0 ? Infinity : 0)) : 0;
    
    return {
      buyVol: buy,
      sellVol: sell,
      buySellDerived: buySellDerived,
      volume: volume,
      delta: delta,
      cvd: cvdAtCandle(state, candle),
      maxImbalanceRatio: maxRatio,
      buyImbalanceCount: buyImb,
      sellImbalanceCount: sellImb,
      stackedBuyImbalanceCount: maxBuyRun >= minStack ? maxBuyRun : 0,
      stackedSellImbalanceCount: maxSellRun >= minStack ? maxSellRun : 0,
      hasBuyAbsorption: lowBuyRatio >= imbRatio && candle.close >= candle.open,
      hasSellAbsorption: highSellRatio >= imbRatio && candle.close <= candle.open,
      isExhaustionHigh: !!(highLevel && avgLevelVol && highTotal < avgLevelVol * 0.35),
      isExhaustionLow: !!(lowLevel && avgLevelVol && lowTotal < avgLevelVol * 0.35),
      isUnfinishedHigh: !!(highLevel && num(highLevel.buyVol) > 0 && num(highLevel.sellVol) > 0),
      isUnfinishedLow: !!(lowLevel && num(lowLevel.buyVol) > 0 && num(lowLevel.sellVol) > 0),
      levels: levels,
      poc: poc,
      vah: vah,
      val: val,
      vaSet: vaSet,
      openIdx: openIdx,
      closeIdx: closeIdx
    };
  }

  function hasFootprintLevels(candle) {
    return !!(candle && Array.isArray(candle.levels) && candle.levels.length);
  }

  function footprintKey(symbol, tf, candle) {
    return [
      String(symbol || '').toUpperCase(),
      String(tf || ''),
      String(openTime(candle) || 0)
    ].join(':');
  }

  function normalizeBinanceSymbol(symbol) {
    symbol = String(symbol || 'BTCUSDT').toUpperCase();
    if (!/USDT$/.test(symbol)) symbol += 'USDT';
    return symbol;
  }

  function normalizeTrade(raw) {
    if (!raw) return null;
    var price = num(raw.price, num(raw.p));
    var qty = num(raw.qty, num(raw.q));
    var time = num(raw.time, num(raw.T));
    var side = String(raw.side || (raw.m ? 'sell' : 'buy')).toLowerCase();
    if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(qty) || qty <= 0) return null;
    return { price: price, qty: qty, time: time, side: side === 'sell' ? 'sell' : 'buy' };
  }

  // ── Exact price bucketing ───────────────────────────────────────────────
  // Footprint levels are bucketed on the instrument's native tick. A hard 0.01
  // floor + fixed 2-decimal rounding merged distinct levels on fine-tick assets
  // ("faux niveaux prix"); here the bucket key carries exactly the tick's own
  // precision.
  function normalizeTick(tick) {
    var t = num(tick, 1);
    return (Number.isFinite(t) && t > 0) ? t : 1;
  }

  function tickDecimals(tick) {
    var t = normalizeTick(tick);
    var s = t.toString();
    var eIdx = s.indexOf('e-');
    if (eIdx === -1) eIdx = s.indexOf('E-');
    if (eIdx !== -1) {
      var exp = parseInt(s.slice(eIdx + 2), 10) || 0;
      var mant = s.slice(0, eIdx);
      var mdot = mant.indexOf('.');
      return exp + (mdot === -1 ? 0 : mant.length - mdot - 1);
    }
    var dot = s.indexOf('.');
    return dot === -1 ? 0 : s.length - dot - 1;
  }

  function priceBucketKey(price, tick) {
    var t = normalizeTick(tick);
    var bucket = Math.round(num(price) / t) * t;
    return bucket.toFixed(Math.min(20, tickDecimals(t)));
  }

  function buildFootprintFromTrades(candle, state, rawTrades) {
    var settings = (state && state.settings) || {};
    var tf = candle.timeframe || (state && state.timeframe) || '1m';
    var intervalMs = num(candle.intervalMs, timeframeToMs(tf));
    var openMs = openTime(candle);
    var closeMs = closeTime(candle) || (openMs + intervalMs - 1);
    var tick = normalizeTick(settings.tickSize);
    var byPrice = {};
    var buy = 0;
    var sell = 0;
    (Array.isArray(rawTrades) ? rawTrades : []).forEach(function (raw) {
      var t = normalizeTrade(raw);
      if (!t || (t.time && (t.time < openMs || t.time > closeMs))) return;
      var key = priceBucketKey(t.price, tick);
      var level = byPrice[key];
      if (!level) {
        level = byPrice[key] = { price: Number(key), buyVol: 0, sellVol: 0, delta: 0, totalVol: 0, trades: 0 };
      }
      if (t.side === 'sell') {
        level.sellVol += t.qty;
        sell += t.qty;
      } else {
        level.buyVol += t.qty;
        buy += t.qty;
      }
      level.totalVol += t.qty;
      level.delta = level.buyVol - level.sellVol;
      level.trades++;
    });
    var levels = Object.keys(byPrice).map(function (key) { return byPrice[key]; }).sort(function (a, b) { return num(a.price) - num(b.price); });
    if (!levels.length) return null;
    var poc = levels[0].price;
    var pocVol = -1;
    levels.forEach(function (level) {
      if (level.totalVol > pocVol) {
        pocVol = level.totalVol;
        poc = level.price;
      }
    });
    return Object.assign({}, candle, {
      exchange: candle.exchange || 'binance',
      symbol: normalizeBinanceSymbol((state && state.symbol) || candle.symbol),
      timeframe: tf,
      intervalMs: intervalMs,
      closeTime: closeMs,
      buyVol: buy,
      sellVol: sell,
      volume: num(candle.volume, buy + sell),
      delta: buy - sell,
      poc: poc,
      closed: true,
      levels: levels,
      source: 'aggtrades-history',
      tsLocal: Date.now()
    });
  }

  function mergeFootprintCandle(state, candle) {
    if (!V6OF.store || !V6OF.store.setState || !candle) return;
    V6OF.store.setState(function (prev) {
      var settings = (prev && prev.settings) || {};
      var maxCandles = Math.max(60, Math.min(3000, num(settings.footprintMaxCandles, 3000)));
      var incomingKey = footprintKey(candle.symbol, candle.timeframe || prev.timeframe, candle);
      var merged = [];
      var replaced = false;
      (Array.isArray(prev.footprintCandles) ? prev.footprintCandles : []).forEach(function (item) {
        if (footprintKey(item.symbol || prev.symbol, item.timeframe || prev.timeframe, item) === incomingKey) {
          merged.push(candle);
          replaced = true;
        } else {
          merged.push(item);
        }
      });
      if (!replaced) merged.push(candle);
      merged.sort(function (a, b) { return openTime(a) - openTime(b); });
      if (merged.length > maxCandles) merged = merged.slice(merged.length - maxCandles);
      return {
        footprintCandles: merged,
        lastFootprintCandle: merged[merged.length - 1] || candle,
        lastFootprintTs: Date.now(),
        selectedFootprintSymbol: candle.symbol,
        selectedFootprintTimeframe: candle.timeframe || prev.timeframe
      };
    }, 'historical-footprint-candle');
  }

  function storeHasFootprint(symbol, tf, candle) {
    var state = V6OF.store && V6OF.store.getState ? V6OF.store.getState() : null;
    var list = state && Array.isArray(state.footprintCandles) ? state.footprintCandles : [];
    var key = footprintKey(symbol, tf, candle);
    for (var i = 0; i < list.length; i++) {
      if (footprintKey(list[i].symbol || symbol, list[i].timeframe || tf, list[i]) === key && hasFootprintLevels(list[i])) {
        return true;
      }
    }
    return false;
  }

  function aggTradeKey(t) {
    if (!t) return '';
    var id = t.id != null ? t.id : (t.a != null ? t.a : null);
    if (id != null) return 'id:' + String(id);
    return [num(t.time, num(t.T)), num(t.price, num(t.p)), num(t.qty, num(t.q)), t.side || t.m || ''].join(':');
  }

  function fetchAggTradesRange(symbol, start, end, depth) {
    var url = '/api/market/aggtrades?symbol=' + encodeURIComponent(symbol) +
      '&startTime=' + encodeURIComponent(Math.floor(start)) +
      '&endTime=' + encodeURIComponent(Math.floor(end)) +
      '&limit=' + AGGTRADES_FOOTPRINT_PAGE_LIMIT + '&soft=1';
    return fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var trades = Array.isArray(data) ? data : (Array.isArray(data && data.trades) ? data.trades : []);
        var capped = trades.length >= AGGTRADES_FOOTPRINT_PAGE_LIMIT;
        if (!capped || depth >= AGGTRADES_FOOTPRINT_MAX_SPLIT_DEPTH || end <= start + 1) return trades;

        var mid = Math.floor((start + end) / 2);
        return fetchAggTradesRange(symbol, start, mid, depth + 1)
          .then(function (left) {
            return fetchAggTradesRange(symbol, mid + 1, end, depth + 1)
              .then(function (right) { return left.concat(right); });
          });
      });
  }

  function fetchAggTradesFootprint(state, candle) {
    var symbol = normalizeBinanceSymbol((state && state.symbol) || candle.symbol);
    var start = openTime(candle);
    var tf = candle.timeframe || (state && state.timeframe) || '1m';
    var intervalMs = num(candle.intervalMs, timeframeToMs(tf));
    var end = closeTime(candle) || (start + intervalMs - 1);
    if (!start || !end || end <= start || end - start > 86400000) return Promise.resolve(false);
    return fetchAggTradesRange(symbol, start, end, 0)
      .then(function (trades) {
        var seen = {};
        var deduped = [];
        (Array.isArray(trades) ? trades : []).forEach(function (trade) {
          var key = aggTradeKey(trade);
          if (!key || seen[key]) return;
          seen[key] = 1;
          deduped.push(trade);
        });
        deduped.sort(function (a, b) { return num(a.time, num(a.T)) - num(b.time, num(b.T)); });
        var fpCandle = buildFootprintFromTrades(candle, state, deduped);
        if (!fpCandle) return false;
        mergeFootprintCandle(state, fpCandle);
        return true;
      });
  }

  function requestMissingFootprint(state, pick) {
    if (!pick || !pick.locked || hasFootprintLevels(pick.candle)) return false;
    var candle = pick.candle;
    var tf = candle.timeframe || (state && state.timeframe) || '1m';
    var symbol = (state && state.symbol) || candle.symbol || 'BTCUSDT';
    var key = footprintKey(symbol, tf, candle);
    if (missingFootprintLoads[key]) return true;
    if (missingFootprintFailures[key] && Date.now() - missingFootprintFailures[key] < 15000) return false;

    var start = openTime(candle);
    var intervalMs = num(candle.intervalMs, timeframeToMs(tf));
    var end = closeTime(candle) || (start + intervalMs - 1);
    if (!start || !end) return false;

    missingFootprintLoads[key] = Date.now();
    var engineClient = V6OF._engineClient || window._v6EngineClient;
    var enginePromise = engineClient && engineClient.fetchFootprintHistory
      ? engineClient.fetchFootprintHistory({ symbol: symbol, timeframe: tf, from: start, to: end, limit: 20 })
      : Promise.resolve(null);

    Promise.resolve(enginePromise)
      .then(function () {
        if (storeHasFootprint(symbol, tf, candle)) return true;
        var source = String((state && state.dataSource) || 'binance').toLowerCase();
        if (source === 'hyperliquid') return false;
        return fetchAggTradesFootprint(state, candle);
      })
      .then(function (ok) {
        delete missingFootprintLoads[key];
        if (!ok && !storeHasFootprint(symbol, tf, candle)) missingFootprintFailures[key] = Date.now();
        if (V6OF.store && V6OF.store.setState) {
          V6OF.store.setState({ footprintLazyLoadTs: Date.now() }, ok ? 'historical-footprint-loaded' : 'historical-footprint-missing');
        }
      })
      .catch(function (err) {
        delete missingFootprintLoads[key];
        missingFootprintFailures[key] = Date.now();
        console.warn('[V6 Inspector] historical footprint load failed', err);
        if (V6OF.store && V6OF.store.setState) V6OF.store.setState({ footprintLazyLoadTs: Date.now() }, 'historical-footprint-error');
      });
    return true;
  }

  function cvdAtCandle(state, candle) {
    var intervalMs = num(candle && candle.intervalMs,
      (candle ? (closeTime(candle) - openTime(candle) + 1) : 0));
    if (intervalMs <= 0) intervalMs = num((state && state.settings && state.settings.deltaIntervalMs), 60000);
    var targetOpen = openTime(candle);
    if (!targetOpen || intervalMs <= 0) return null;

    var key = String(intervalMs);
    var byInterval = (state && state.deltaBucketsByInterval) || {};
    var buckets = byInterval[key];
    if (!Array.isArray(buckets) || !buckets.length) return null;

    for (var i = 0; i < buckets.length; i++) {
      var b = buckets[i];
      if (num(b && b.intervalMs) !== intervalMs) continue;
      if (num(b && b.startTime) === targetOpen) return num(b.cvd);
    }
    return null;
  }

  function trimZeros(s) {
    return String(s).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '').replace(/\.$/, '');
  }

  function fmtVal(v) {
    if (v == null || !Number.isFinite(Number(v))) return '';
    v = Number(v);
    if (v === 0) return '0';
    var neg = v < 0;
    var a = Math.abs(v);
    var text = a >= 1000000 ? trimZeros((a / 1e6).toFixed(a >= 10000000 ? 0 : 1)) + 'M'
      : a >= 1000 ? trimZeros((a / 1e3).toFixed(a >= 10000 ? 0 : 1)) + 'K'
      : a >= 100 ? a.toFixed(0)
      : a >= 10 ? trimZeros(a.toFixed(1))
      : a >= 1 ? trimZeros(a.toFixed(2))
      : a >= 0.01 ? trimZeros(a.toFixed(3))
      : a.toPrecision(2);
    return (neg ? '-' : '') + text;
  }

  function fmtSignedVal(v) {
    if (v == null || !Number.isFinite(Number(v)) || v === 0) return '0';
    var a = Math.abs(v);
    var body = fmtVal(a);
    return body ? (v >= 0 ? '+' : '-') + body : '0';
  }

  function metric(label, value, cls, derived) {
    if (value == null || value === '') value = '--';
    var mark = derived
      ? '<span class="v6-inspector-derived" title="Synthesized from volume ± delta — not measured buy/sell flow">~est</span>'
      : '';
    return '<div class="v6-inspector-card ' + (cls || '') + (derived ? ' is-derived' : '') +
      '"><em>' + esc(label) + mark + '</em><strong>' + esc(value) + '</strong></div>';
  }

  function flag(label, on) {
    return '<span class="v6-inspector-flag ' + (on ? 'is-on' : '') + '">' + esc(label) + '</span>';
  }

  function renderLevelRows(levels, poc, vah, val, vaSet, openIdx, closeIdx, loading) {
    if (!levels.length) {
      return '<div class="v6-inspector-empty">' + (loading ? 'Loading historical footprint levels...' : 'No footprint levels for this candle.') + '</div>';
    }
    
    // Sort descending by price for visual rendering (high price at top)
    var ordered = levels.slice().sort(function (a, b) { return num(b.price) - num(a.price); });
    
    // Find max level volume to scale horizontal bars
    var maxLvlVol = 1;
    levels.forEach(function (level) {
      var vol = num(level.buyVol) + num(level.sellVol);
      if (vol > maxLvlVol) maxLvlVol = vol;
    });
    
    var rows = ordered.map(function (level) {
      var buy = num(level.buyVol);
      var sell = num(level.sellVol);
      var delta = num(level.delta);
      var total = num(level.totalVol);
      
      var buyPct = Math.max(0, Math.min(100, (buy / maxLvlVol) * 100)).toFixed(1);
      var sellPct = Math.max(0, Math.min(100, (sell / maxLvlVol) * 100)).toFixed(1);
      
      var isPoc = num(level.price) === num(poc);
      var inVa = vaSet && vaSet.has(level.price);
      
      // Locate open/close prices
      var isOpen = levels.findIndex(function(l) { return l.price === level.price; }) === openIdx;
      var isClose = levels.findIndex(function(l) { return l.price === level.price; }) === closeIdx;
      
      var rowCls = '';
      if (isPoc) rowCls += ' is-poc';
      if (inVa) rowCls += ' is-va';
      if (isOpen) rowCls += ' is-open';
      if (isClose) rowCls += ' is-close';
      
      var buyImbCls = level.buyImbalance ? ' is-buy-imb' : '';
      var sellImbCls = level.sellImbalance ? ' is-sell-imb' : '';
      var deltaCls = delta >= 0 ? ' is-pos' : ' is-neg';
      
      var openCloseIndicator = '';
      if (isOpen && isClose) {
        openCloseIndicator = '<span class="v6-ft-oc-indicator is-both" title="Open & Close">◆</span>';
      } else if (isOpen) {
        openCloseIndicator = '<span class="v6-ft-oc-indicator is-open" title="Candle Open">○</span>';
      } else if (isClose) {
        openCloseIndicator = '<span class="v6-ft-oc-indicator is-close" title="Candle Close">●</span>';
      }
      
      return [
        '<div class="v6-ft-row' + rowCls + '">',
          '<div class="v6-ft-cell v6-ft-cell-bid">',
            '<div class="v6-ft-bar is-sell" style="width:' + sellPct + '%"></div>',
            '<span class="v6-ft-val' + sellImbCls + '">' + fmtVal(sell) + '</span>',
          '</div>',
          '<div class="v6-ft-cell v6-ft-cell-price">',
            openCloseIndicator,
            '<span>' + esc(fmtPrice(level.price)) + '</span>',
          '</div>',
          '<div class="v6-ft-cell v6-ft-cell-ask">',
            '<div class="v6-ft-bar is-buy" style="width:' + buyPct + '%"></div>',
            '<span class="v6-ft-val' + buyImbCls + '">' + fmtVal(buy) + '</span>',
          '</div>',
          '<div class="v6-ft-cell v6-ft-cell-delta' + deltaCls + '">' + fmtSignedVal(delta) + '</div>',
          '<div class="v6-ft-cell v6-ft-cell-vol">' + fmtVal(total) + '</div>',
        '</div>'
      ].join('');
    }).join('');
    
    return [
      '<div class="v6-ft-levels">',
        '<div class="v6-ft-head">',
          '<span>Bid Vol</span>',
          '<span>Price</span>',
          '<span>Ask Vol</span>',
          '<span>Delta</span>',
          '<span>Volume</span>',
        '</div>',
        '<div class="v6-ft-body">',
          rows,
        '</div>',
      '</div>'
    ].join('');
  }

  function renderInspector(state) {
    var pick = findActiveCandle(state);
    if (!pick) {
      return '<div class="v6-inspector-empty">Move over the chart to inspect a candle. DOM stays available in its own tab.</div>';
    }
    var candle = pick.candle;
    var m = deriveMetrics(candle, state);
    var loadingFootprint = requestMissingFootprint(state, pick);
    var deltaCls = m.delta >= 0 ? 'is-pos' : 'is-neg';
    var lockText = pick.locked ? 'Unlock' : 'Lock';
    var candleNo = pick.index >= 0 ? (pick.index + 1) + '/' + pick.total : '--';

    // Use candle's actual timeframe, not the chart's current timeframe
    var candleTf = candleTimeframe(candle, state);
    var chartTf = (state && state.timeframe) || '1m';
    var tfDisplay = candleTf;
    if (candleTf !== chartTf) tfDisplay = candleTf + ' (chart: ' + chartTf + ')';

    // Calculate Delta %
    var deltaPctText = '0.0%';
    if (m.volume > 0) {
      var pct = (m.delta / m.volume) * 100;
      deltaPctText = (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%';
    }
    var cvdCls = Number.isFinite(Number(m.cvd)) ? (m.cvd >= 0 ? 'is-pos' : 'is-neg') : '';

    return [
      '<div class="v6-inspector">',
        '<div class="v6-inspector-top">',
          '<div>',
            '<span class="v6-inspector-kicker">' + (pick.locked ? 'Locked candle' : 'Hover candle') + '</span>',
            '<strong>' + esc(fmtDateTime(openTime(candle))) + ' UTC</strong>',
            '<small style="color:var(--v6-text-mute);font-size:10px">→ ' + esc(fmtTime(closeTime(candle))) + ' UTC  (' + esc(candleTf) + ')</small>',
          '</div>',
          '<button type="button" class="v6-btn v6-btn-sm" data-v6-action="toggle-candle-lock">' + lockText + '</button>',
        '</div>',
        '<div class="v6-inspector-meta">',
          '<span>' + esc(state.symbol || candle.symbol || '--') + '</span>',
          '<span>' + esc(tfDisplay) + '</span>',
          '<span>' + esc(pick.source || '--') + '</span>',
          '<span>#' + esc(candleNo) + '</span>',
        '</div>',
        '<div class="v6-inspector-grid">',
          metric('Open', fmtPrice(candle.open)),
          metric('High', fmtPrice(candle.high)),
          metric('Low', fmtPrice(candle.low)),
          metric('Close', fmtPrice(candle.close)),
          metric('Volume', fmtVal(m.volume)),
          metric('Buy Vol', fmtVal(m.buyVol), 'is-pos', m.buySellDerived),
          metric('Sell Vol', fmtVal(m.sellVol), 'is-neg', m.buySellDerived),
          metric('Delta', fmtVal(m.delta) + ' (' + deltaPctText + ')', deltaCls),
          metric('CVD', fmtVal(m.cvd), cvdCls),
          metric('Max Imb', ratioText(m.maxImbalanceRatio), 'is-warn'),
        '</div>',
        '<div class="v6-inspector-section-title">Derived metrics</div>',
        '<div class="v6-inspector-grid">',
          metric('Buy Imb', String(m.buyImbalanceCount), 'is-pos'),
          metric('Sell Imb', String(m.sellImbalanceCount), 'is-neg'),
          metric('Stack Buy', String(m.stackedBuyImbalanceCount), 'is-pos'),
          metric('Stack Sell', String(m.stackedSellImbalanceCount), 'is-neg'),
        '</div>',
        '<div class="v6-inspector-flags">',
          flag('Buy absorption', m.hasBuyAbsorption),
          flag('Sell absorption', m.hasSellAbsorption),
          flag('Exhaustion high', m.isExhaustionHigh),
          flag('Exhaustion low', m.isExhaustionLow),
          flag('Unfinished high', m.isUnfinishedHigh),
          flag('Unfinished low', m.isUnfinishedLow),
        '</div>',
        '<div class="v6-inspector-section-title">Footprint levels</div>',
        renderLevelRows(m.levels, m.poc, m.vah, m.val, m.vaSet, m.openIdx, m.closeIdx, loadingFootprint),
      '</div>'
    ].join('');
  }

  function postReplay(cmd) {
    return fetch(REPLAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd)
    }).then(function (r) {
      if (r.ok) return r.json();
      return r.text().then(function (text) { throw new Error(text || ('HTTP ' + r.status)); });
    });
  }

  function ensureReplayShell(root) {
    var el = root && root.querySelector('[data-v6-replay-strip]');
    if (!el || el.dataset.v6ReplayMounted === '1') return el;
    el.dataset.v6ReplayMounted = '1';
    el.innerHTML = [
      '<span class="v6-replay-drag" data-v6-replay-drag>⠿</span>',
      '<div class="v6-replay-controls">',
        '<button type="button" class="v6-replay-btn" data-v6-replay-action="start" title="Load selected day and play">Play</button>',
        '<button type="button" class="v6-replay-btn" data-v6-replay-action="pause" title="Pause replay">Pause</button>',
        '<button type="button" class="v6-replay-btn" data-v6-replay-action="step" title="Step forward one replayed trade">Step</button>',
        '<button type="button" class="v6-replay-btn" data-v6-replay-action="stop" title="Stop replay">Stop</button>',
      '</div>',
      '<input class="v6-replay-range" type="range" min="0" max="1000" value="0" data-v6-replay-range disabled aria-label="Replay progress">',
      '<div class="v6-replay-fields">',
        '<input type="date" data-v6-replay-date value="' + yesterdayISO() + '" aria-label="Replay date">',
        '<select data-v6-replay-speed aria-label="Replay speed">',
          '<option value="0.25">0.25x</option>',
          '<option value="0.5">0.5x</option>',
          '<option value="1">1x</option>',
          '<option value="2">2x</option>',
          '<option value="5">5x</option>',
          '<option value="10" selected>10x</option>',
          '<option value="0">Max</option>',
        '</select>',
      '</div>',
      '<div class="v6-replay-status"><strong data-v6-replay-state>Idle</strong><span data-v6-replay-clock>--:--:-- UTC</span><span data-v6-replay-count>0/0</span></div>'
    ].join('');

    // ── Initial position (bottom-right) ──
    el.style.left = '';
    el.style.top = '';
    el.style.right = '14px';
    el.style.bottom = '12px';

    // ── Drag ──
    var dragHandle = el.querySelector('[data-v6-replay-drag]');
    var dragState = { active: false, startX: 0, startY: 0, origX: 0, origY: 0 };
    function onDown(e) {
      dragState.active = true;
      dragState.startX = e.clientX;
      dragState.startY = e.clientY;
      var rect = el.getBoundingClientRect();
      dragState.origX = rect.left;
      dragState.origY = rect.top;
      el.style.left = rect.left + 'px';
      el.style.top = rect.top + 'px';
      el.setPointerCapture(e.pointerId);
    }
    function onMove(e) {
      if (!dragState.active) return;
      el.style.left = (dragState.origX + e.clientX - dragState.startX) + 'px';
      el.style.top = (dragState.origY + e.clientY - dragState.startY) + 'px';
    }
    function onEnd() { dragState.active = false; }
    dragHandle.addEventListener('pointerdown', onDown);
    dragHandle.addEventListener('pointermove', onMove);
    dragHandle.addEventListener('pointerup', onEnd);
    dragHandle.addEventListener('pointercancel', onEnd);

    // ── Button / change handlers (unchanged) ──
    el.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-v6-replay-action]');
      if (!btn || !el.contains(btn)) return;
      var action = btn.getAttribute('data-v6-replay-action');
      var dateEl = el.querySelector('[data-v6-replay-date]');
      var speedEl = el.querySelector('[data-v6-replay-speed]');
      var state = V6OF.store && V6OF.store.getState ? V6OF.store.getState() : {};
      var cmd = { action: action };
      if (action === 'start') {
        var replaySymbol = String(state.symbol || 'BTCUSDT').toUpperCase();
        if (!/USDT$/.test(replaySymbol)) replaySymbol += 'USDT';
        cmd.symbol = replaySymbol;
        cmd.date = dateEl && dateEl.value ? dateEl.value : yesterdayISO();
        cmd.speed = speedEl ? Number(speedEl.value) : 10;
        if (V6OF.store && V6OF.store.clearAllBuffers) V6OF.store.clearAllBuffers();
        if (V6OF.CvdBuckets && V6OF.CvdBuckets.reset) V6OF.CvdBuckets.reset();
      } else if (action === 'step') {
        cmd.count = 1;
      }
      setReplayText(el, 'Sending ' + action, null);
      postReplay(cmd).then(function (st) {
        if (V6OF.store && V6OF.store.setState) V6OF.store.setState({ replay: st }, 'replay-command-' + action);
      }).catch(function (err) {
        setReplayText(el, 'Error', err.message || String(err));
        // Store the error so updateReplayShell shows the strip
        if (V6OF.store && V6OF.store.setState) {
          V6OF.store.setState({ replay: { state: 'error', error: err.message } }, 'replay-error');
        }
      });
    });

    el.addEventListener('change', function (event) {
      var speed = event.target.closest('[data-v6-replay-speed]');
      if (!speed) return;
      postReplay({ action: 'speed', speed: Number(speed.value) }).then(function (st) {
        if (V6OF.store && V6OF.store.setState) V6OF.store.setState({ replay: st }, 'replay-speed');
      }).catch(function (err) {
        setReplayText(el, 'Error', err.message || String(err));
        if (V6OF.store && V6OF.store.setState) {
          V6OF.store.setState({ replay: { state: 'error', error: err.message } }, 'replay-speed-error');
        }
      });
    });
    return el;
  }

  function setReplayText(el, stateText, detail) {
    var stateEl = el.querySelector('[data-v6-replay-state]');
    var clockEl = el.querySelector('[data-v6-replay-clock]');
    if (stateEl) stateEl.textContent = stateText || 'Idle';
    if (clockEl && detail != null) clockEl.textContent = detail;
  }

  function updateReplayShell(root, state) {
    var el = ensureReplayShell(root);
    if (!el) return;
    var replay = (state && state.replay) || {};
    // Show strip whenever there's any replay state (including error),
    // hide only when replay is truly absent/empty.
    var hasReplay = state && state.replay;
    el.classList.toggle('is-hidden', !hasReplay);
    if (!hasReplay) return;
    var progress = Math.max(0, Math.min(1, num(replay.progress)));
    var range = el.querySelector('[data-v6-replay-range]');
    var stateEl = el.querySelector('[data-v6-replay-state]');
    var clockEl = el.querySelector('[data-v6-replay-clock]');
    var countEl = el.querySelector('[data-v6-replay-count]');
    var speedEl = el.querySelector('[data-v6-replay-speed]');
    if (range) range.value = String(Math.round(progress * 1000));
    if (stateEl) stateEl.textContent = replay.state || 'idle';
    if (clockEl) clockEl.textContent = replay.error ? replay.error : fmtUtc(replay.clockMs);
    if (countEl) countEl.textContent = String(num(replay.index)) + '/' + String(num(replay.total));
    if (speedEl && document.activeElement !== speedEl && replay.speed != null) {
      speedEl.value = String(replay.speed);
    }
    el.classList.toggle('is-playing', replay.state === 'playing');
    el.classList.toggle('is-paused', replay.state === 'paused');
  }

  V6OF.Inspector = {
    findActiveCandle: findActiveCandle,
    deriveMetrics: deriveMetrics,
    tickDecimals: tickDecimals,
    priceBucketKey: priceBucketKey,
    render: renderInspector,
    renderInto: function (root, state) {
      var body = root && root.querySelector('[data-v6-info-panel]');
      if (!body) return;

      // Preserve scroll position of footprint levels body before re-render
      var ftBody = body.querySelector('.v6-ft-body');
      var savedScroll = ftBody ? ftBody.scrollTop : 0;

      body.innerHTML = renderInspector(state || {});

      // Restore scroll position
      if (savedScroll > 0) {
        var newFtBody = body.querySelector('.v6-ft-body');
        if (newFtBody) {
          requestAnimationFrame(function () {
            newFtBody.scrollTop = savedScroll;
          });
        }
      }

      // Wire the toggle-candle-lock button click
      if (!body._lockWired) {
        body._lockWired = true;
        body.addEventListener('click', function (e) {
          var btn = e.target.closest('[data-v6-action="toggle-candle-lock"]');
          if (!btn) return;
          var state = V6OF.store && V6OF.store.getState ? V6OF.store.getState() : {};
          var ui = state.ui || {};
          var locked = !ui.activeCandleLocked;
          V6OF.store.updateUi({
            activeCandleLocked: locked,
            activeCandleUpdatedAt: Date.now()
          });
        });
      }
    }
  };

  V6OF.ReplayTimeline = {
    post: postReplay,
    renderInto: updateReplayShell
  };
})();
