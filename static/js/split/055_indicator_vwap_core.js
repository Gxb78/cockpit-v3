// ---------- VWAP Core — Canonical source, stable by design ----------
// Module unique pour 060 (widget BTC) et 062 (chart page).
// Règle absolue : VWAP ne dépend JAMAIS du timeframe affiché.
// Le chart choisit juste comment AFFICHER, pas comment CALCULER.
//
// Architecture:
//   VWAP_SOURCE_CONFIG  → source canonique fixe par période
//   getCanonicalVwap()  → cache global + pending dedup
//   alignIndicatorToCandles() → alignement vers les bougies du chart
//   drawVwapForChart()  → helper haut niveau pour 060/062

(function () {

  // ── CONFIG CANONIQUE ──────────────────────────────────────
  // Indépendante du timeframe actif du chart.
  // Chaque période a une source stable, prévisible, rapide.
  var VWAP_SOURCE_CONFIG = {
    '1D': { days: 1,  interval: '15m', limit: 106, refreshMs:  60000 },
    '7D': { days: 7,  interval: '15m', limit: 682, refreshMs:  60000 },
    '30D':{ days: 30, interval: '1h',  limit: 730, refreshMs: 300000 },
    '90D':{ days: 90, interval: '4h',  limit: 550, refreshMs: 900000 },
  };

  var VWAP_COLORS = {
    '1D': '#f59e0b', '7D': '#06b6d4', '30D': '#a78bfa', '90D': '#f472b6',
  };

  // ── HELPERS TEMPS ─────────────────────────────────────────
  function _intervalToMs(interval) {
    var m = {
      '3m': 3*60000, '5m': 5*60000, '15m': 15*60000, '30m': 30*60000,
      '1h': 3600000, '2h': 7200000, '4h': 14400000, '6h': 21600000,
      '8h': 28800000, '12h': 43200000, '1d': 86400000,
    };
    return m[interval] || 3600000;
  }

  // endTime fixé sur la dernière bougie FERMÉE de l'intervalle source
  // garanti identique entre deux appels à quelques ms d'écart
  function _getLastClosedCandleEndTime(interval, now) {
    now = now || Date.now();
    var ms = _intervalToMs(interval);
    return Math.floor(now / ms) * ms - 1;
  }

  // ── NORMALISATION ─────────────────────────────────────────
  function _normalizeTimeToSeconds(t) {
    if (t == null) return NaN;
    if (typeof t === 'number') return t > 1e12 ? Math.floor(t / 1000) : t;
    if (typeof t === 'string') {
      var n = parseInt(t, 10);
      return n > 1e12 ? Math.floor(n / 1000) : n;
    }
    return NaN;
  }

  function normalizeCandlesForLwc(raw) {
    return (raw || [])
      .map(function (c) {
        var rawTime = c.time != null ? c.time : (c.openTime != null ? c.openTime : c.t);
        return {
          time: _normalizeTimeToSeconds(rawTime),
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
          volume: Number(c.volume),
        };
      })
      .filter(function (c) {
        return Number.isFinite(c.time) && Number.isFinite(c.open)
          && Number.isFinite(c.high) && Number.isFinite(c.low)
          && Number.isFinite(c.close);
      })
      .sort(function (a, b) { return a.time - b.time; });
  }

  // ── CALCUL VWAP ───────────────────────────────────────────
  // Cumul strict : typicalPrice * volume, running average
  function computeVwapSeries(candles) {
    var cumPV = 0, cumVol = 0, out = [];
    for (var i = 0; i < candles.length; i++) {
      var c = candles[i];
      var vol = Number(c.volume);
      if (!Number.isFinite(vol) || vol <= 0) continue;
      var tp = (c.high + c.low + c.close) / 3;
      cumPV += tp * vol;
      cumVol += vol;
      out.push({ time: c.time, value: cumPV / cumVol });
    }
    return out;
  }

  // ── FETCH KLINES ──────────────────────────────────────────
  function _fetchKlines(symbol, interval, startTime, endTime, limit) {
    var params = 'symbol=' + symbol + '&interval=' + interval + '&limit=' + limit;
    if (startTime) params += '&startTime=' + startTime;
    if (endTime) params += '&endTime=' + endTime;
    return fetch('/api/market/klines?' + params)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) { return data.candles || []; });
  }

  async function _fetchAndComputeCanonicalVwap(symbol, period) {
    var config = VWAP_SOURCE_CONFIG[period];
    if (!config) throw new Error('Unknown VWAP period: ' + period);

    var endTime = _getLastClosedCandleEndTime(config.interval);
    var startTime = endTime - config.days * 86400000;

    var raw = await _fetchKlines(symbol, config.interval, startTime, endTime, config.limit);

    var candles = normalizeCandlesForLwc(raw)
      .filter(function (c) {
        var ms = c.time * 1000;
        return ms >= startTime && ms <= endTime && Number.isFinite(c.volume) && c.volume > 0;
      });

    return computeVwapSeries(candles);
  }

  // ── CACHE GLOBAL ──────────────────────────────────────────
  var _cache = {};
  var _pending = {};

  function _cacheKey(symbol, period) { return symbol + ':' + period; }

  async function getCanonicalVwap(symbol, period) {
    var config = VWAP_SOURCE_CONFIG[period];
    if (!config) throw new Error('Unknown VWAP period: ' + period);

    var key = _cacheKey(symbol, period);
    var cached = _cache[key];
    var now = Date.now();

    // Cache valide ?
    if (cached && now - cached.createdAt < config.refreshMs) {
      return cached.data;
    }

    // Évite les doubles fetchs simultanés (widget + chart page)
    if (_pending[key]) {
      return _pending[key];
    }

    var promise = _fetchAndComputeCanonicalVwap(symbol, period)
      .then(function (data) {
        _cache[key] = { createdAt: Date.now(), data: data };
        return data;
      })
      .finally(function () {
        delete _pending[key];
      });

    _pending[key] = promise;
    return promise;
  }

  // ── ALIGNEMENT ────────────────────────────────────────────
  // Transforme les points VWAP canoniques pour qu'ils aient les
  // timestamps des bougies du chart actif.
  // Le temps du point canonique est préservé (time: candle.time)
  function alignIndicatorToCandles(indicatorPoints, candles) {
    if (!indicatorPoints || !indicatorPoints.length || !candles || !candles.length) return [];

    // Filtrer et trier les points indicateurs
    var sorted = indicatorPoints.slice()
      .filter(function (p) { return p && Number.isFinite(p.time) && Number.isFinite(p.value); })
      .sort(function (a, b) { return a.time - b.time; });

    var out = [], j = 0;

    for (var ci = 0; ci < candles.length; ci++) {
      var t = candles[ci].time;
      // Avancer j jusqu'au dernier point ≤ candle.time
      while (j + 1 < sorted.length && sorted[j + 1].time <= t) j++;
      var p = sorted[j];
      if (p && p.time <= t) {
        out.push({ time: t, value: p.value });
      }
    }
    return out;
  }

  // ── DRAW HIGH-LEVEL ───────────────────────────────────────
  // Helper pour 060 et 062 — fetch le VWAP canonique, aligne, setData
  async function drawVwapForChart(state, period, shouldAbort) {
    // state doit avoir: symbol, candles, vwapSeriesMap
    var canonicalVwap = await getCanonicalVwap(state.symbol || 'BTCUSDT', period);
    if (shouldAbort && shouldAbort()) return;
    if (!state.candles || !state.candles.length) return;

    var aligned = alignIndicatorToCandles(canonicalVwap, state.candles);
    if (shouldAbort && shouldAbort()) return;
    if (aligned.length < 2) return;

    var s = state.vwapSeriesMap[period];
    if (!s) return;
    if (shouldAbort && shouldAbort()) return;

    s.applyOptions({
      visible: true,
      color: VWAP_COLORS[period] || '#f59e0b',
      title: 'VWAP ' + period,
      lastValueVisible: true,
    });
    s.setData(aligned);
  }

  // ── EXPOSE ────────────────────────────────────────────────
  window.BtcVwap = {
    VWAP_SOURCE_CONFIG: VWAP_SOURCE_CONFIG,
    VWAP_COLORS: VWAP_COLORS,
    normalizeCandlesForLwc: normalizeCandlesForLwc,
    computeVwapSeries: computeVwapSeries,
    getCanonicalVwap: getCanonicalVwap,
    alignIndicatorToCandles: alignIndicatorToCandles,
    drawVwapForChart: drawVwapForChart,
  };

})();
