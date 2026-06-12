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

  /**
   * Canvas renderer for the CVD sub-pane. Time-synced to the chart viewport.
   *
   * @param {HTMLCanvasElement} canvas
   * @param {object} state   - full V6OF store state
   * @param {object} [vp]    - ChartViewport instance (optional; falls back to bar-only)
   * @param {object} [opts]  - { crosshairTs, showTimeAxis, timeAxisHeight, accentColor }
   */
  Panels.CvdPanel = {};
  Panels.CvdPanel.draw = function (canvas, state, vp, opts) {
    if (!canvas) return;
    opts = opts || {};
    state = state || {};

    var dpr = window.devicePixelRatio || 1;
    var rect = canvas.getBoundingClientRect();
    var W = Math.max(1, rect.width || canvas.clientWidth || 300);
    var H = Math.max(1, rect.height || canvas.clientHeight || 80);
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Resolve design tokens from the root element.
    var rootEl = document.getElementById('v6-orderflow-root') || document.body;
    var cs = getComputedStyle(rootEl);
    var bg        = cs.getPropertyValue('--v6-bg-2').trim()       || '#0e0f12';
    var hairline  = cs.getPropertyValue('--v6-hairline').trim()   || 'rgba(255,255,255,0.06)';
    var textFaint = cs.getPropertyValue('--v6-text-faint').trim() || '#565b66';
    var textDim   = cs.getPropertyValue('--v6-text-dim').trim()   || '#9aa0ab';
    var buyColor  = cs.getPropertyValue('--v6-buy').trim()        || '#3fb950';
    var sellColor = cs.getPropertyValue('--v6-sell').trim()       || '#f6465d';
    var monoFont  = cs.getPropertyValue('--v6-mono').trim()       || 'JetBrains Mono, monospace';

    var TIME_AXIS_H = opts.showTimeAxis ? (opts.timeAxisHeight || 20) : 0;
    var GUTTER_LEFT  = 4;
    var GUTTER_RIGHT = 66; // align with chart price-axis width

    // Clear
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Top separator hairline
    ctx.fillStyle = hairline;
    ctx.fillRect(0, 0, W, 1);

    // Resolve buckets
    var settings = state.settings || {};
    var selected = Number(settings.deltaIntervalMs || 60000);
    var bucketsByInterval = state.deltaBucketsByInterval || {};
    var buckets = bucketsByInterval[String(selected)] || state.deltaBuckets || [];
    buckets = Array.isArray(buckets) ? buckets : [];

    var plotH = H - TIME_AXIS_H;
    var plotW = W - GUTTER_LEFT - GUTTER_RIGHT;
    if (plotH < 4 || plotW < 4 || !buckets.length) {
      return; // leave bg fill only
    }

    // ---- Time-synced path (viewport available) ----
    if (vp && typeof vp.timeToX === 'function' && vp.timeStart && vp.timeEnd > vp.timeStart) {
      var vpLeft   = GUTTER_LEFT;
      var vpWidth  = plotW;
      var timeSpan = vp.timeEnd - vp.timeStart;

      function localTimeToX(ts) {
        return vpLeft + (ts - vp.timeStart) / timeSpan * vpWidth;
      }

      var interval = Number(settings.deltaIntervalMs || 60000);

      // Per-bar hairline gridlines
      ctx.fillStyle = hairline;
      buckets.forEach(function (b) {
        var ts = Number(b.ts);
        if (!ts) return;
        var x = localTimeToX(ts);
        if (x < GUTTER_LEFT || x > GUTTER_LEFT + plotW) return;
        ctx.fillRect(Math.round(x), 0, 1, plotH);
      });

      // Visible buckets
      var visibleBuckets = buckets.filter(function (b) {
        var ts = Number(b.ts);
        var x = localTimeToX(ts);
        return x >= GUTTER_LEFT && x <= GUTTER_LEFT + plotW;
      });
      if (!visibleBuckets.length) visibleBuckets = buckets.slice(-120);

      var maxAbs = 1;
      visibleBuckets.forEach(function (b) { maxAbs = Math.max(maxAbs, Math.abs(b.delta)); });

      // Bar width from interval duration in pixels
      var barPx = Math.max(1, (interval / timeSpan) * plotW);
      var barW  = Math.max(1, barPx - 1);

      // Row center (zero line) — bars are drawn symmetrically around this
      // row center so they line up with the main chart's candle baseline.
      var rowCenterY = Math.round(plotH / 2);
      // Cap bar height so it stays centered within the row, matching the
      // main chart grid's row geometry (snap to grid cell height * 0.7).
      var maxBarH = Math.max(2, Math.round(plotH * 0.7));

      // Draw bars
      ctx.globalAlpha = 0.75;
      visibleBuckets.forEach(function (b) {
        var ts = Number(b.ts);
        if (!ts) return;
        // Snap bar X to the candle column (whole-pixel grid).
        var x = Math.round(localTimeToX(ts));
        if (x < GUTTER_LEFT - barW || x > GUTTER_LEFT + plotW) return;
        var pct  = Math.max(0.04, Math.min(1, Math.abs(b.delta) / maxAbs));
        var barH = Math.max(2, Math.min(maxBarH, Math.round(pct * (maxBarH))));
        var y    = b.delta >= 0 ? rowCenterY - barH : rowCenterY;
        ctx.fillStyle = b.delta >= 0 ? buyColor : sellColor;
        ctx.fillRect(Math.round(x - barW / 2), y, Math.ceil(barW), barH);
      });
      ctx.globalAlpha = 1;

      // Zero line — row center, snapped to pixel grid.
      ctx.fillStyle = hairline;
      ctx.fillRect(GUTTER_LEFT, rowCenterY, plotW, 1);

      // Crosshair vertical line
      var crossTs = opts.crosshairTs;
      if (crossTs) {
        var cx = localTimeToX(crossTs);
        if (cx >= GUTTER_LEFT && cx <= GUTTER_LEFT + plotW) {
          ctx.fillStyle = 'rgba(255,255,255,0.25)';
          ctx.fillRect(Math.round(cx), 0, 1, plotH);
        }
      }

      // Time axis at bottom of CVD pane
      if (opts.showTimeAxis && TIME_AXIS_H > 0) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, plotH, W, TIME_AXIS_H);
        ctx.fillStyle = hairline;
        ctx.fillRect(0, plotH, W, 1);
        ctx.fillStyle = textFaint;
        ctx.font = '10px ' + monoFont;
        ctx.textBaseline = 'middle';
        var labelEvery = Math.max(1, Math.ceil(30 / barPx));
        visibleBuckets.forEach(function (b, i) {
          if (i % labelEvery !== 0) return;
          var ts = Number(b.ts);
          if (!ts) return;
          var x = localTimeToX(ts);
          if (x < GUTTER_LEFT + 10 || x > GUTTER_LEFT + plotW - 20) return;
          var d = new Date(ts);
          var label = d.getUTCHours().toString().padStart(2, '0') + ':' +
                      d.getUTCMinutes().toString().padStart(2, '0');
          ctx.fillText(label, x - ctx.measureText(label).width / 2, plotH + TIME_AXIS_H / 2);
        });
      }

      // Right gutter — CVD label
      var latestByInterval = state.latestDeltaByInterval || {};
      var latest = latestByInterval[String(selected)] || buckets[buckets.length - 1] || null;
      if (latest) {
        var gx = W - GUTTER_RIGHT;
        ctx.fillStyle = bg;
        ctx.fillRect(gx, 0, GUTTER_RIGHT, plotH);
        ctx.fillStyle = hairline;
        ctx.fillRect(gx, 0, 1, plotH);
        ctx.fillStyle = textDim;
        ctx.font = '9px ' + monoFont;
        ctx.textBaseline = 'top';
        ctx.fillText('CVD', gx + 4, 4);
        var cvdSign = latest.cvd >= 0 ? '+' : '';
        var cvdStr  = cvdSign + (Math.abs(latest.cvd) >= 1000 ?
          (latest.cvd / 1000).toFixed(1) + 'K' : latest.cvd.toFixed(1));
        ctx.fillStyle = latest.cvd >= 0 ? buyColor : sellColor;
        ctx.font = '10px ' + monoFont;
        ctx.fillText(cvdStr, gx + 4, 16);
      }

    } else {
      // ---- Fallback: simple bar-only render (no viewport) ----
      var fbBuckets = buckets.slice(-Math.floor(plotW / 3));
      var fbMaxAbs  = 1;
      fbBuckets.forEach(function (b) { fbMaxAbs = Math.max(fbMaxAbs, Math.abs(b.delta)); });
      var fbBarW = Math.max(1, plotW / Math.max(fbBuckets.length, 1) - 1);
      ctx.globalAlpha = 0.75;
      fbBuckets.forEach(function (b, i) {
        var pct  = Math.max(0.04, Math.min(1, Math.abs(b.delta) / fbMaxAbs));
        var barH = Math.max(2, Math.round(pct * (plotH - 4)));
        var x    = GUTTER_LEFT + i * (fbBarW + 1);
        var y    = b.delta >= 0 ? plotH - barH : 0;
        ctx.fillStyle = b.delta >= 0 ? buyColor : sellColor;
        ctx.fillRect(Math.round(x), y, Math.ceil(fbBarW), barH);
      });
      ctx.globalAlpha = 1;
      ctx.fillStyle = hairline;
      ctx.fillRect(GUTTER_LEFT, Math.round(plotH / 2), plotW, 1);
    }
  };
})();
