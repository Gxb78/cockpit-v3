// 095_v6_popout.js
// Pop-out window bootstrap for the V6 layout grid (094_v6_layout_grid.js).
//
// SCOPE / HONESTY NOTES (read before extending):
// - Activated ONLY when the page URL has `?orderflow_popout=<module>`. With
//   no such param the normal page is completely unaffected by this file.
// - The pop-out window is the SAME app/bundle (same /  route), so it boots
//   normally — including its own V6OF.Transport.EngineClient connection
//   (073_v6_orderflow_layout.js wires this up unconditionally and is out of
//   scope to edit). To avoid a redundant LIVE connection from the pop-out,
//   this module calls the PUBLIC `V6OF._engineClient.disconnect()` API
//   (exposed by 073) once the pop-out has mounted, then relies entirely on
//   the BroadcastChannel ('cockpitV6-orderflow') for live state pushed by
//   the main window (094_v6_layout_grid.js -> popOutCell()).
// - Sync is ONE-WAY (main window -> pop-out). The pop-out does not currently
//   post user actions back to the main window (e.g. panning the popped-out
//   chart will not move the main chart). This is a documented limitation.
// - Module support:
//     - 'chart': fully mirrored. Each incoming state snapshot is drawn via
//       the existing V6OF.CanvasChart.draw(canvas, state) — same renderer
//       as the docked chart, so it looks/behaves identically (read-only).
//     - 'dom' | 'tape' | 'orderbook' | 'info': NOT yet mirrored. These
//       panels are driven by per-module DOM subscriptions wired to the
//       live store in other files (090/093/073/080) which this MVP does
//       not duplicate. The pop-out shows an honest placeholder explaining
//       this and offers a "Close & re-dock" button.
// - Closing the pop-out (tab close / window close) posts a 'closed' message
//   on the channel so the main window's cell re-docks (clears the "popped"
//   indicator on the cell's pop-out button). The main window also polls
//   `win.closed` as a fallback if BroadcastChannel is unavailable.

(function () {
  'use strict';
  var V6OF = window.V6OF = window.V6OF || {};
  if (!V6OF.register) {
    ['Core', 'Data', 'Transport', 'UI', 'Studies', 'Page'].forEach(function (n) {
      V6OF[n] = V6OF[n] || {};
    });
    V6OF.register = function (domain, name, value, legacyName) {
      V6OF[domain] = V6OF[domain] || {};
      V6OF[domain][name] = value;
      if (legacyName) V6OF[legacyName] = value;
      return value;
    };
  }

  var POPOUT_CHANNEL = 'cockpitV6-orderflow';
  var MODULE_LABELS = { chart: 'Chart', dom: 'DOM', tape: 'Tape', orderbook: 'Orderbook', info: 'Info' };

  function getQueryParam(name) {
    try {
      var params = new URLSearchParams(window.location.search);
      return params.get(name);
    } catch (err) {
      return null;
    }
  }

  var module = getQueryParam('orderflow_popout');
  if (!module) return; // Normal page: do nothing.

  var cellIndex = parseInt(getQueryParam('cell'), 10);
  if (isNaN(cellIndex)) cellIndex = 0;
  if (MODULE_LABELS[module] === undefined) module = 'chart';

  var _channel = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') _channel = new BroadcastChannel(POPOUT_CHANNEL);
  } catch (err) {
    _channel = null;
  }

  function postClosed() {
    if (!_channel) return;
    try { _channel.postMessage({ type: 'closed', cell: cellIndex, module: module }); } catch (err) { /* ignore */ }
  }

  window.addEventListener('beforeunload', postClosed);

  // ---------------------------------------------------------------------
  // Build the full-window pop-out shell once the normal app DOM exists.
  // ---------------------------------------------------------------------
  function buildShell(root) {
    if (root.querySelector('[data-v6-popout-shell]')) return root.querySelector('[data-v6-popout-shell]');

    var shell = document.createElement('div');
    shell.setAttribute('data-v6-popout-shell', '');
    shell.className = 'v6-popout-shell';

    var head = document.createElement('div');
    head.className = 'v6-popout-head';
    head.innerHTML = '<span class="v6-popout-title">' + (MODULE_LABELS[module] || module) +
      ' <span class="v6-popout-tag">live mirror</span></span>' +
      '<button type="button" class="v6-popout-close" data-v6-popout-close title="Close &amp; re-dock">Close &amp; re-dock</button>';

    var body = document.createElement('div');
    body.className = 'v6-popout-body';
    body.setAttribute('data-v6-popout-body', '');

    shell.appendChild(head);
    shell.appendChild(body);

    // Hide the normal shell entirely; show only our pop-out shell.
    Array.prototype.forEach.call(root.children, function (child) {
      if (child !== shell) child.style.display = 'none';
    });
    root.appendChild(shell);

    shell.querySelector('[data-v6-popout-close]').addEventListener('click', function () {
      postClosed();
      window.close();
    });

    return shell;
  }

  function buildChartBody(body) {
    body.innerHTML = '';
    var canvas = document.createElement('canvas');
    canvas.className = 'v6-chart-canvas v6-popout-canvas';
    canvas.setAttribute('data-v6-popout-canvas', '');
    body.appendChild(canvas);
    return canvas;
  }

  function buildUnsupportedBody(body) {
    body.innerHTML = '';
    var note = document.createElement('div');
    note.className = 'v6-popout-unsupported';
    note.innerHTML = '<p>Live mirroring for the <strong>' + (MODULE_LABELS[module] || module) +
      '</strong> panel is not available in pop-out windows yet.</p>' +
      '<p>This panel is driven by a live data subscription in the main window and has not been duplicated here. ' +
      'Close this window to re-dock the panel.</p>';
    body.appendChild(note);
  }

  function resizeCanvas(canvas) {
    // Delegate to centralized utility (001_utilities.js) to avoid DPI scaling duplication
    resizeCanvasForDpr(canvas);
  }

  function init() {
    var root = document.getElementById('v6-orderflow-root') || document.querySelector('.v6-orderflow-root');
    if (!root) {
      // DOM not ready yet — retry shortly (the SPA mounts asynchronously).
      setTimeout(init, 50);
      return;
    }

    var shell = buildShell(root);
    var body = shell.querySelector('[data-v6-popout-body]');
    var canvas = null;
    var lastState = null;

    if (module === 'chart') {
      canvas = buildChartBody(body);
      resizeCanvas(canvas);
      // RAF-throttled: resize fires per pixel during a drag, and setting
      // canvas.width clears the bitmap, so redraw from the last mirrored
      // state or the chart stays blank until the next tick arrives.
      var resizeRaf = null;
      window.addEventListener('resize', function () {
        if (resizeRaf) return;
        resizeRaf = requestAnimationFrame(function () {
          resizeRaf = null;
          resizeCanvas(canvas);
          if (lastState && V6OF.CanvasChart && canvas.offsetWidth > 0 && canvas.offsetHeight > 0) {
            V6OF.CanvasChart.draw(canvas, lastState);
          }
        });
      });
    } else {
      buildUnsupportedBody(body);
    }

    // Disconnect this window's own engine connection (public API on 073) so
    // the pop-out does not hold a second live socket — it relies on the
    // BroadcastChannel mirror from the main window instead.
    setTimeout(function () {
      try {
        if (V6OF._engineClient && typeof V6OF._engineClient.disconnect === 'function') {
          V6OF._engineClient.disconnect();
        }
      } catch (err) { /* ignore */ }
    }, 500);

    if (_channel) {
      _channel.onmessage = function (ev) {
        var msg = ev && ev.data;
        if (!msg || msg.type !== 'state' || msg.cell !== cellIndex) return;
        lastState = msg.state || null;
        if (module === 'chart' && canvas && V6OF.CanvasChart) {
          if (canvas.offsetWidth > 0 && canvas.offsetHeight > 0) {
            resizeCanvas(canvas);
            V6OF.CanvasChart.draw(canvas, msg.state || {});
          }
        }
      };
    }
  }

  // Run after the normal SPA bootstrap has had a chance to build its DOM.
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 0);
  } else {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 0); });
  }
})();
