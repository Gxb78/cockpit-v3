// ---------- VWAP Core â€” Canonical source, stable by design ----------
// Module unique pour 060 (widget BTC) et 062 (chart page).
// RÃ¨gle absolue : VWAP ne dÃ©pend JAMAIS du timeframe affichÃ©.
// Le chart choisit juste comment AFFICHER, pas comment CALCULER.
//
// Architecture:
//   VWAP_SOURCE_CONFIG  â†’ source canonique fixe par pÃ©riode
//   getCanonicalVwap()  â†’ cache global + pending dedup
//   alignIndicatorToCandles() â†’ alignement vers les bougies du chart
//   drawVwapForChart()  â†’ helper haut niveau pour 060/062

window.BtcMarketClock = window.BtcMarketClock || (function () {
  var _offsetMs = 0;
  var _synced = false;
  var _source = 'local';

  return {
    sync: function (serverMs, src) {
      serverMs = Number(serverMs);
      if (!Number.isFinite(serverMs) || serverMs <= 0) return;
      _offsetMs = serverMs - Date.now();
      _synced = true;
      _source = src || 'unknown';
    },
    now: function () {
      return Date.now() + (_synced ? _offsetMs : 0);
    },
    isSynced: function () { return _synced; },
    offsetMs: function () { return _synced ? _offsetMs : 0; },
    source: function () { return _source; },
    reset: function () { _offsetMs = 0; _synced = false; _source = 'local'; }
  };
})();

(function () {

  // â”€â”€ CONFIG CANONIQUE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // IndÃ©pendante du timeframe actif du chart.
  // Chaque pÃ©riode a une source stable, prÃ©visible, rapide.
  // Modes :
  //   'rolling' → fenêtre glissante de durationMs depuis endTime
  //   'session' → session calendaire (UTC_DAY)
  var VWAP_SOURCE_CONFIG = {
    '1D':   { mode: 'session', session: 'UTC_DAY', interval: '15m', limit: 110, refreshMs: 60000 },
    '7D':   { mode: 'rolling', durationMs: 7 * 24 * 60 * 60 * 1000, interval: '15m', limit: 682, refreshMs: 60000 },
    '30D':  { mode: 'rolling', durationMs: 30 * 24 * 60 * 60 * 1000, interval: '1h',  limit: 730, refreshMs: 300000 },
    '90D':  { mode: 'rolling', durationMs: 90 * 24 * 60 * 60 * 1000, interval: '4h',  limit: 550, refreshMs: 900000 },
    '365D': { mode: 'rolling', durationMs: 365 * 24 * 60 * 60 * 1000, interval: '12h', limit: 750, refreshMs: 900000 },
  };

  var VWAP_COLORS = {
    '1D': '#f59e0b', '7D': '#06b6d4', '30D': '#a78bfa', '90D': '#f472b6', '365D': '#22c55e',
  };

  // â”€â”€ BORNES TEMPORELLES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function _getUtcDayBounds(nowMs) {
    var d = new Date(nowMs);
    var start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
    return { startTime: start, endTime: nowMs };
  }

  function _getSessionBounds(config, nowMs) {
    nowMs = nowMs || Date.now();
    var endTime = _getLastClosedCandleEndTime(config.interval, nowMs);
    if (config.mode === 'rolling') {
      var startTime = endTime - config.durationMs;
      return { startTime: startTime, endTime: endTime };
    }
    if (config.mode === 'session') {
      if (config.session === 'UTC_DAY') {
        var bounds = _getUtcDayBounds(nowMs);
        return { startTime: bounds.startTime, endTime: endTime };
      }
    }
    // Fallback: rolling 24h
    return { startTime: Date.now() - 86400000, endTime: Date.now() };
  }
  function _intervalToMs(interval) {
    var m = {
      '3m': 3*60000, '5m': 5*60000, '15m': 15*60000, '30m': 30*60000,
      '1h': 3600000, '2h': 7200000, '4h': 14400000, '6h': 21600000,
      '8h': 28800000, '12h': 43200000, '1d': 86400000,
    };
    return m[interval] || 3600000;
  }

  // endTime fixÃ© sur la derniÃ¨re bougie FERMÃ‰E de l'intervalle source
  // garanti identique entre deux appels Ã  quelques ms d'Ã©cart
  function _getLastClosedCandleEndTime(interval, now) {
    now = now || Date.now();
    var ms = _intervalToMs(interval);
    return Math.floor(now / ms) * ms - 1;
  }

  // â”€â”€ NORMALISATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function _numRequired(v) {
    if (v === null || v === undefined || v === '') return NaN;
    var n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }

  function _numOptional(v, fallback) {
    if (v === null || v === undefined || v === '') return fallback;
    var n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

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
    var byTime = {};

    (raw || []).forEach(function (c) {
      if (!c) return;

      var rawTime = c.time != null ? c.time : (c.openTime != null ? c.openTime : c.t);
      var time = _normalizeTimeToSeconds(rawTime);

      var open = _numRequired(c.open);
      var high = _numRequired(c.high);
      var low = _numRequired(c.low);
      var close = _numRequired(c.close);
      var volume = _numOptional(c.volume, 0);

      if (!Number.isFinite(time) || time <= 0) return;
      if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) return;

      if (high < low) return;
      if (high < Math.max(open, close)) return;
      if (low > Math.min(open, close)) return;

      byTime[time] = {
        time: time,
        open: open,
        high: high,
        low: low,
        close: close,
        volume: volume,
      };
    });

    return Object.keys(byTime)
      .map(function (t) { return byTime[t]; })
      .sort(function (a, b) { return a.time - b.time; });
  }

  function sanitizeLineData(points) {
    var byTime = {};

    (points || []).forEach(function (p) {
      if (!p) return;

      var time = Number(p.time);
      var value = Number(p.value);

      if (!Number.isFinite(time) || time <= 0) return;
      if (!Number.isFinite(value)) return;

      byTime[time] = { time: time, value: value };
    });

    return Object.keys(byTime)
      .map(function (t) { return byTime[t]; })
      .sort(function (a, b) { return a.time - b.time; });
  }

  // â”€â”€ CALCUL VWAP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ FETCH KLINES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function _fetchKlines(symbol, interval, startTime, endTime, limit) {
    var params = 'symbol=' + symbol + '&interval=' + interval + '&limit=' + limit + '&soft=1';
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

    var bounds = _getSessionBounds(config);
    var startTime = bounds.startTime;
    var endTime = bounds.endTime;

    console.log('[VWAP BOUNDS]', period, {
      mode: config.mode,
      interval: config.interval,
      start: new Date(startTime).toISOString(),
      end: new Date(endTime).toISOString(),
      limit: config.limit,
    });

    var raw = await _fetchKlines(symbol, config.interval, startTime, endTime, config.limit);

    console.log('[VWAP RAW]', period, {
      count: raw.length,
      first: raw[0] && new Date((raw[0].time || raw[0].openTime || raw[0].t) * 1000).toISOString(),
      last: raw[raw.length - 1] && new Date((raw[raw.length - 1].time || raw[raw.length - 1].openTime || raw[raw.length - 1].t) * 1000).toISOString(),
    });

    var candles = normalizeCandlesForLwc(raw)
      .filter(function (c) {
        var ms = c.time * 1000;
        return ms >= startTime && ms <= endTime && Number.isFinite(c.volume) && c.volume > 0;
      });

    return computeVwapSeries(candles);
  }

  // â”€â”€ CACHE GLOBAL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // Ã‰vite les doubles fetchs simultanÃ©s (widget + chart page)
    if (_pending[key]) {
      return _pending[key];
    }

    var promise = _fetchAndComputeCanonicalVwap(symbol, period)
      .then(function (data) {
        _cache[key] = { createdAt: Date.now(), data: data };
        return data;
      })
      .catch(function (e) {
        console.warn("[VWAP] canonical fetch failed", period, e);
        if (cached && cached.data) return cached.data;
        return [];
      })
      .finally(function () {
        delete _pending[key];
      });

    _pending[key] = promise;
    return promise;
  }

  // â”€â”€ ALIGNEMENT â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Transforme les points VWAP canoniques pour qu'ils aient les
  // timestamps des bougies du chart actif.
  // Le temps du point canonique est prÃ©servÃ© (time: candle.time)
  function alignIndicatorToCandles(indicatorPoints, candles) {
    if (!indicatorPoints || !indicatorPoints.length || !candles || !candles.length) return [];

    // Filtrer et trier les points indicateurs
    var sorted = indicatorPoints.slice()
      .filter(function (p) { return p && Number.isFinite(p.time) && Number.isFinite(p.value); })
      .sort(function (a, b) { return a.time - b.time; });

    var out = [], j = 0;

    for (var ci = 0; ci < candles.length; ci++) {
      var t = candles[ci].time;
      // Avancer j jusqu'au dernier point â‰¤ candle.time
      while (j + 1 < sorted.length && sorted[j + 1].time <= t) j++;
      var p = sorted[j];
      if (p && p.time <= t) {
        out.push({ time: t, value: p.value });
      }
    }
    return out;
  }

  // â”€â”€ DRAW HIGH-LEVEL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Helper pour 060 et 062 â€” fetch le VWAP canonique, aligne, setData
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
      autoscaleInfoProvider: function () { return null; },
    });
    aligned = sanitizeLineData(aligned);
    if (aligned.length < 2) return;
    s.setData(aligned);
  }

  // â”€â”€ EVENT BUS VWAP â€” normalisation + synchro cross-component â”€â”€
  function normalizeVwapPeriods(periods) {
    var legacyMap = { 'D-NY': '1D', '24H': null };
    var seen = {};
    var out = [];
    (periods || []).forEach(function (p) {
      p = legacyMap[p] || p;
      if (!VWAP_SOURCE_CONFIG[p]) return;
      if (seen[p]) return;
      seen[p] = true;
      out.push(p);
    });
    return out;
  }

  function readActiveVwapPeriods() {
    try {
      var raw = JSON.parse(localStorage.getItem('chartVwapPeriods'));
      return normalizeVwapPeriods(Array.isArray(raw) ? raw : []);
    } catch(e) {
      return [];
    }
  }

  function saveActiveVwapPeriods(periods) {
    var normalized = normalizeVwapPeriods(periods);
    localStorage.setItem('chartVwapPeriods', JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent('chart:vwap-periods-changed', {
      detail: { periods: normalized }
    }));
    return normalized;
  }

  // â”€â”€ EXPOSE â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  window.BtcVwap = {
    VWAP_SOURCE_CONFIG: VWAP_SOURCE_CONFIG,
    VWAP_COLORS: VWAP_COLORS,
    normalizeVwapPeriods: normalizeVwapPeriods,
    readActiveVwapPeriods: readActiveVwapPeriods,
    saveActiveVwapPeriods: saveActiveVwapPeriods,
    normalizeCandlesForLwc: normalizeCandlesForLwc,
    computeVwapSeries: computeVwapSeries,
    getCanonicalVwap: getCanonicalVwap,
    alignIndicatorToCandles: alignIndicatorToCandles,
    drawVwapForChart: drawVwapForChart,
  };

})();
