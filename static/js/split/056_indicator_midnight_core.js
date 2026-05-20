// ---------- Midnight Core ----------
// Shared helper for 060 (BTC widget) and 062 (chart page).

(function () {
  var _cache = {};
  var _pending = {};

  var MIDNIGHT_COLOR = '#00f5ff';
  var POSITIVE_COLOR = '#ff73b9';
  var NEGATIVE_COLOR = '#00e676';

  function _toMs(ts) {
    var n = Number(ts);
    if (!Number.isFinite(n) || n <= 0) return Date.now();
    return n > 1e12 ? n : n * 1000;
  }

  function getNyDateString(timestampMs) {
    var ms = _toMs(timestampMs);
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(ms));

    var out = { year: '0000', month: '01', day: '01' };
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.type === 'year' || p.type === 'month' || p.type === 'day') {
        out[p.type] = p.value;
      }
    }
    return out.year + '-' + out.month + '-' + out.day;
  }

  function _cacheKey(symbol, dateNy) {
    return (symbol || 'BTCUSDT').toUpperCase() + ':' + dateNy;
  }

  function _fetchDay(symbol, dateNy) {
    var sym = (symbol || 'BTCUSDT').toUpperCase();
    var key = _cacheKey(sym, dateNy);

    if (_cache[key]) return Promise.resolve(_cache[key]);
    if (_pending[key]) return _pending[key];

    var url = '/api/models/midnight/day?symbol=' + encodeURIComponent(sym) + '&date=' + encodeURIComponent(dateNy);
    var req = fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        _cache[key] = data || null;
        return _cache[key];
      })
      .catch(function (e) {
        console.warn('[MIDNIGHT] fetch failed', sym, dateNy, e);
        return null;
      })
      .finally(function () {
        delete _pending[key];
      });

    _pending[key] = req;
    return req;
  }

  function _clearLines(series) {
    var lines = series && series._midnightPriceLines;
    if (!series || !Array.isArray(lines)) {
      if (series) series._midnightPriceLines = [];
      return;
    }
    for (var i = 0; i < lines.length; i++) {
      try { series.removePriceLine(lines[i]); } catch(e) {}
    }
    series._midnightPriceLines = [];
  }

  function _addLineSeries(chart, opts) {
    if (!chart) return null;
    try {
      if (typeof chart.addSeries === 'function' && window.LightweightCharts && window.LightweightCharts.LineSeries) {
        return chart.addSeries(window.LightweightCharts.LineSeries, opts);
      }
      if (typeof chart.addLineSeries === 'function') {
        return chart.addLineSeries(opts);
      }
    } catch(e) {}
    return null;
  }

  function _clearOpenSegment(series) {
    if (!series) return;
    var chart = series._midnightChart;
    var seg = series._midnightOpenSegmentSeries;
    if (chart && seg && typeof chart.removeSeries === 'function') {
      try { chart.removeSeries(seg); } catch(e) {}
    }
    series._midnightOpenSegmentSeries = null;
    series._midnightOpenPrice = NaN;
    series._midnightOpenStartSec = NaN;
    series._midnightOpenEndSec = NaN;
  }

  function _resolveNowMs(timestampMs) {
    var marketNow = window.BtcMarketClock && typeof window.BtcMarketClock.now === 'function'
      ? Number(window.BtcMarketClock.now())
      : NaN;
    if (Number.isFinite(marketNow) && marketNow > 0) return marketNow;
    return _toMs(timestampMs);
  }

  function _refreshOpenSegment(series, timestampMs) {
    if (!series || !series._midnightOpenSegmentSeries) return;
    var startSec = Number(series._midnightOpenStartSec);
    var price = Number(series._midnightOpenPrice);
    if (!Number.isFinite(startSec) || !Number.isFinite(price)) return;

    var nowSec = Math.floor(_resolveNowMs(timestampMs) / 1000);
    var endSec = Math.max(startSec + 1, nowSec);
    if (series._midnightOpenEndSec === endSec) return;

    series._midnightOpenEndSec = endSec;
    try {
      series._midnightOpenSegmentSeries.setData([
        { time: startSec, value: price },
        { time: endSec, value: price },
      ]);
    } catch(e) {}
  }

  function _parseStdvEntries(stdvLevels) {
    var out = [];
    if (!stdvLevels || typeof stdvLevels !== 'object') return out;

    Object.keys(stdvLevels).forEach(function (key) {
      var value = Number(stdvLevels[key]);
      if (!Number.isFinite(value)) return;

      var mult = Number(key);
      var sign = key[0] === '-' ? '-' : '+';
      if (!Number.isFinite(mult)) {
        var absMatch = String(key).match(/(\d+(?:\.\d+)?)/);
        if (absMatch) {
          mult = Number(absMatch[1]);
          if (sign === '-') mult = -mult;
        }
      }
      if (!Number.isFinite(mult)) return;

      out.push({
        key: key,
        multiplier: mult,
        value: value,
        label: (mult > 0 ? '+' : '-') + Math.abs(mult).toFixed(1) + ' SD',
      });
    });

    out.sort(function (a, b) {
      var aPos = a.multiplier > 0 ? 0 : 1;
      var bPos = b.multiplier > 0 ? 0 : 1;
      if (aPos !== bPos) return aPos - bPos;
      return Math.abs(a.multiplier) - Math.abs(b.multiplier);
    });
    return out;
  }

  function _addLine(series, lines, opts) {
    try {
      var line = series.createPriceLine(opts);
      if (line) lines.push(line);
    } catch(e) {}
  }

  async function drawMidnightLines(series, symbol, timestampMs, force, chartApi) {
    if (!series || typeof series.createPriceLine !== 'function' || typeof series.removePriceLine !== 'function') return;
    if (chartApi) series._midnightChart = chartApi;

    var sym = (symbol || 'BTCUSDT').toUpperCase();
    var dateNy = getNyDateString(timestampMs);

    if (!force && series._midnightDrawnDate === dateNy && series._midnightDrawnSymbol === sym) {
      _refreshOpenSegment(series, timestampMs);
      return;
    }

    series._midnightDrawSeq = (series._midnightDrawSeq || 0) + 1;
    var drawSeq = series._midnightDrawSeq;

    var payload = await _fetchDay(sym, dateNy);
    if (drawSeq !== series._midnightDrawSeq) return;

    _clearLines(series);
    _clearOpenSegment(series);

    var levels = payload && payload.levels ? payload.levels : null;
    var midnightOpen = levels ? Number(levels.midnight_open) : NaN;
    if (!Number.isFinite(midnightOpen)) {
      series._midnightDrawnDate = dateNy;
      series._midnightDrawnSymbol = sym;
      return;
    }

    var midnightStartMs = payload && payload.windows && payload.windows.midnight
      ? Number(payload.windows.midnight.start_utc)
      : NaN;
    if (Number.isFinite(midnightStartMs)) {
      var startSec = Math.floor(midnightStartMs / 1000);
      var chart = series._midnightChart;
      var segSeries = _addLineSeries(chart, {
        color: MIDNIGHT_COLOR,
        lineWidth: 2,
        lineStyle: 0,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: false,
        title: 'Midnight Open',
        autoscaleInfoProvider: function () { return null; },
      });
      if (segSeries) {
        series._midnightOpenSegmentSeries = segSeries;
        series._midnightOpenPrice = midnightOpen;
        series._midnightOpenStartSec = startSec;
        series._midnightOpenEndSec = NaN;
        _refreshOpenSegment(series, timestampMs);
      }
    }

    var created = [];

    var entries = _parseStdvEntries(levels.stdv_levels);
    for (var i = 0; i < entries.length; i++) {
      var item = entries[i];
      _addLine(series, created, {
        price: item.value,
        color: item.multiplier > 0 ? POSITIVE_COLOR : NEGATIVE_COLOR,
        lineWidth: 1,
        lineStyle: 1,
        axisLabelVisible: true,
        title: item.label,
      });
    }

    series._midnightPriceLines = created;
    series._midnightDrawnDate = dateNy;
    series._midnightDrawnSymbol = sym;
  }

  window.BtcMidnight = {
    _cache: _cache,
    getNyDateString: getNyDateString,
    drawMidnightLines: drawMidnightLines,
    clearSeriesLines: function (series) {
      _clearLines(series);
      _clearOpenSegment(series);
    },
  };
})();
