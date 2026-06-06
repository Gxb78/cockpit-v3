// ---------- 076_v6_cvd_panel.js ----------
// CVD and delta panel renderer for Cockpit V6 orderflow.
// Redesigned: TradingView-style compact summary + delta histogram.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};
  var Panels = V6OF.Panels = V6OF.Panels || {};

  function intervalOption(value, selected, label) {
    return '<option value="' + value + '"' + (Number(selected) === value ? ' selected' : '') + '>' + label + '</option>';
  }

  function sourceText(state) {
    if (!state) return 'Offline';
    if (state.dataFreshness === 'live') return 'Live';
    if (state.dataFreshness === 'rest-fallback') return 'REST Fallback';
    if (state.transportStatus === 'connecting') return 'Connecting';
    return 'Offline';
  }

  // Format signed value with +/-
  function fmtSigned(v) {
    if (v == null || !Number.isFinite(v)) return '—';
    var a = Math.abs(v);
    var s = a >= 1000 ? (a / 1000).toFixed(1) + 'K' : a.toFixed(a >= 100 ? 0 : 1);
    return (v >= 0 ? '+' : '') + s;
  }

  function fmtPrice(v) {
    if (v == null || !Number.isFinite(v)) return '—';
    return v.toFixed(2);
  }

  Panels.renderCvd = function (state) {
    state = state || {};
    var settings = state.settings || {};
    var selected = Number(settings.deltaIntervalMs || 60000);
    var bucketsByInterval = state.deltaBucketsByInterval || {};
    var latestByInterval = state.latestDeltaByInterval || {};
    var buckets = bucketsByInterval[String(selected)] || state.deltaBuckets || [];
    buckets = Array.isArray(buckets) ? buckets : [];
    var latest = latestByInterval[String(selected)] || buckets[buckets.length - 1] || null;

    if (!latest) {
      return '<div class="v6-cvd-barstrip">Waiting for data…</div>';
    }

    var deltaClass = latest.delta >= 0 ? 'is-pos' : 'is-neg';

    // Mini delta bars (last 120 buckets)
    var barsHtml = '';
    if (buckets.length > 1) {
      var recent = buckets.slice(-120);
      var maxAbs = 1;
      recent.forEach(function (b) { maxAbs = Math.max(maxAbs, Math.abs(b.delta)); });
      barsHtml = recent.map(function (bucket) {
        var pct = Math.max(6, Math.min(100, Math.abs(bucket.delta) / maxAbs * 100));
        var cls = bucket.delta >= 0 ? 'is-buy' : 'is-sell';
        return '<span class="v6-cvd-bar ' + cls + '" style="--h:' + pct.toFixed(1) + '%"></span>';
      }).join('');
    }

    return [
      '<div class="v6-cvd-barstrip">',
        '<span class="v6-cvd-badge ' + deltaClass + '">' + fmtSigned(latest.delta) + '</span>',
        '<span class="v6-cvd-badge ' + (latest.cvd >= 0 ? 'is-pos' : 'is-neg') + '">CVD ' + fmtSigned(latest.cvd) + '</span>',
        '<label class="v6-cvd-interval">',
          '<select data-v6-setting="deltaIntervalMs">',
            intervalOption(1000, selected, '1s'),
            intervalOption(5000, selected, '5s'),
            intervalOption(60000, selected, '1m'),
          '</select>',
        '</label>',
        '<div class="v6-cvd-bars">' + barsHtml + '</div>',
      '</div>'
    ].join('');
  };

  // CVD bucket -> delta histogram bars (last 120 buckets).
  function cvdBarsHtml(buckets) {
    if (!Array.isArray(buckets) || buckets.length <= 1) return '';
    var recent = buckets.slice(-120);
    var maxAbs = 1;
    recent.forEach(function (b) { maxAbs = Math.max(maxAbs, Math.abs(b.delta)); });
    return recent.map(function (bucket) {
      var pct = Math.max(6, Math.min(100, Math.abs(bucket.delta) / maxAbs * 100));
      var cls = bucket.delta >= 0 ? 'is-buy' : 'is-sell';
      return '<span class="v6-cvd-bar ' + cls + '" style="--h:' + pct.toFixed(1) + '%"></span>';
    }).join('');
  }

  function ensureCvdShell(container) {
    if (!container || container._v6CvdShell) return;
    container.innerHTML = [
      '<div class="v6-cvd-barstrip">',
        '<span class="v6-cvd-badge" data-v6-cvd-delta>—</span>',
        '<span class="v6-cvd-badge" data-v6-cvd-cvd>CVD —</span>',
        '<label class="v6-cvd-interval">',
          '<select data-v6-setting="deltaIntervalMs">',
            intervalOption(1000, 60000, '1s'),
            intervalOption(5000, 60000, '5s'),
            intervalOption(60000, 60000, '1m'),
          '</select>',
        '</label>',
        '<div class="v6-cvd-bars" data-v6-cvd-bars></div>',
      '</div>'
    ].join('');
    container._v6CvdShell = {
      delta: container.querySelector('[data-v6-cvd-delta]'),
      cvd: container.querySelector('[data-v6-cvd-cvd]'),
      select: container.querySelector('select[data-v6-setting="deltaIntervalMs"]'),
      bars: container.querySelector('[data-v6-cvd-bars]')
    };
  }

  // Incremental CVD render: keeps a stable shell so the interval <select>
  // is preserved (no rebuild/focus loss); only badge text/class, the select
  // value, and the bar histogram are patched on each update.
  Panels.renderCvdInto = function (container, state) {
    if (!container) return;
    state = state || {};
    var settings = state.settings || {};
    var selected = Number(settings.deltaIntervalMs || 60000);
    var bucketsByInterval = state.deltaBucketsByInterval || {};
    var latestByInterval = state.latestDeltaByInterval || {};
    var buckets = bucketsByInterval[String(selected)] || state.deltaBuckets || [];
    buckets = Array.isArray(buckets) ? buckets : [];
    var latest = latestByInterval[String(selected)] || buckets[buckets.length - 1] || null;

    if (!latest) {
      if (container._v6CvdShell) {
        var sh = container._v6CvdShell;
        sh.delta.textContent = '—'; sh.delta.className = 'v6-cvd-badge';
        sh.cvd.textContent = 'CVD —'; sh.cvd.className = 'v6-cvd-badge';
        sh.bars.innerHTML = '';
      } else {
        container.innerHTML = '<div class="v6-cvd-barstrip">Waiting for data…</div>';
      }
      return;
    }

    ensureCvdShell(container);
    var shell = container._v6CvdShell;
    if (shell.select && document.activeElement !== shell.select &&
        shell.select.value !== String(selected)) {
      shell.select.value = String(selected);
    }
    shell.delta.textContent = fmtSigned(latest.delta);
    shell.delta.className = 'v6-cvd-badge ' + (latest.delta >= 0 ? 'is-pos' : 'is-neg');
    shell.cvd.textContent = 'CVD ' + fmtSigned(latest.cvd);
    shell.cvd.className = 'v6-cvd-badge ' + (latest.cvd >= 0 ? 'is-pos' : 'is-neg');
    shell.bars.innerHTML = cvdBarsHtml(buckets);
  };

  Panels.renderVwap = function (vwap, state) {
    state = state || {};
    if (!vwap) {
      return [
        '<div class="v6-cvd-panel">',
          '<div class="v6-cvd-empty">VWAP not available</div>',
        '</div>',
      ].join('');
    }
    var source = vwap.source || state.source || 'live';
    var warm = !!vwap.isWarm;
    return [
      '<div class="v6-cvd-panel">',
        '<div class="v6-vwap-hero">',
          '<span class="v6-vwap-lbl">VWAP</span>',
          '<span class="v6-vwap-val">' + V6OF.format.price(vwap.value) + '</span>',
        '</div>',
        '<div class="v6-cvd-metrics">',
          '<div class="v6-cvd-metric"><span class="v6-cvd-metric-lbl">Symbol</span><span class="v6-cvd-metric-val">' + (vwap.symbol || '—') + '</span></div>',
          '<div class="v6-cvd-metric"><span class="v6-cvd-metric-lbl">Session</span><span class="v6-cvd-metric-val">' + new Date(vwap.sessionStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</span></div>',
          '<div class="v6-cvd-metric"><span class="v6-cvd-metric-lbl">Cum Vol</span><span class="v6-cvd-metric-val">' + V6OF.format.qty(vwap.cumVol) + '</span></div>',
          '<div class="v6-cvd-metric"><span class="v6-cvd-metric-lbl">Warm</span><span class="v6-cvd-metric-val' + (warm ? ' is-pos' : ' is-warn') + '">' + (warm ? 'Yes' : 'No') + '</span></div>',
        '</div>',
      '</div>',
    ].join('');
  };
})();
