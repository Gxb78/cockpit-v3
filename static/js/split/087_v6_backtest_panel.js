// ---------- 087_v6_backtest_panel.js ----------
// Backtest / replay control panel for Cockpit V6.
// Posts commands to the Go engine's /replay endpoint (Binance Data Vision
// historical aggTrades) and reflects replay_status pushed over the WS stream.
// UI-only; the engine replays through the same pipeline as live data.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};
  var REPLAY_URL = 'http://127.0.0.1:8765/replay';

  function post(cmd) {
    return fetch(REPLAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd)
    }).then(function (r) { return r.ok ? r.json() : r.text().then(function (t) { throw new Error(t); }); });
  }

  function yesterdayISO() {
    var d = new Date(Date.now() - 86400000);
    return d.toISOString().slice(0, 10);
  }

  function popoverHtml() {
    return [
      '<div class="v6-bt-pop" data-v6-bt-pop hidden>',
        '<div class="v6-bt-row">',
          '<label>Symbol<input type="text" data-v6-bt-symbol value="BTCUSDT" spellcheck="false"></label>',
          '<label>Date<input type="date" data-v6-bt-date value="' + yesterdayISO() + '"></label>',
        '</div>',
        '<div class="v6-bt-row">',
          '<label>Speed',
            '<select data-v6-bt-speed>',
              '<option value="1">1×</option>',
              '<option value="10" selected>10×</option>',
              '<option value="60">60×</option>',
              '<option value="300">300×</option>',
              '<option value="0">Max</option>',
            '</select>',
          '</label>',
        '</div>',
        '<div class="v6-bt-actions">',
          '<button type="button" class="v6-btn v6-btn-engine" data-v6-bt="start">▶ Load &amp; Play</button>',
          '<button type="button" class="v6-btn" data-v6-bt="pause">❚❚</button>',
          '<button type="button" class="v6-btn" data-v6-bt="resume">▶</button>',
          '<button type="button" class="v6-btn v6-btn-danger" data-v6-bt="stop">■</button>',
        '</div>',
        '<div class="v6-bt-progress"><span data-v6-bt-bar></span></div>',
        '<div class="v6-bt-status" data-v6-bt-status>Idle</div>',
        '<div class="v6-bt-note">Free historical ticks · Binance Data Vision</div>',
      '</div>'
    ].join('');
  }

  function fmtClock(ms) {
    if (!ms) return '--:--:--';
    var d = new Date(ms);
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + ' UTC';
  }

  function renderStatus(root, st) {
    var bar = root.querySelector('[data-v6-bt-bar]');
    var status = root.querySelector('[data-v6-bt-status]');
    var dot = root.querySelector('[data-v6-bt-dot]');
    if (!st) return;
    if (bar) bar.style.width = Math.round((st.progress || 0) * 100) + '%';
    if (status) {
      var label = (st.state || 'idle');
      if (st.error) label = 'error: ' + st.error;
      else if (st.total) label = label + ' · ' + (st.index || 0).toLocaleString() + '/' + st.total.toLocaleString() +
        ' · ' + fmtClock(st.clockMs) + ' · ' + (st.speed === 0 ? 'max' : st.speed + '×');
      status.textContent = label;
    }
    if (dot) {
      dot.className = 'v6-bt-dot is-' + (st.state || 'idle');
    }
  }

  V6OF.Backtest = {
    mount: function (anchorContainer, store) {
      if (!anchorContainer || anchorContainer.dataset.v6BtMounted === '1') return;
      anchorContainer.dataset.v6BtMounted = '1';

      var wrap = document.createElement('div');
      wrap.className = 'v6-bt-wrap';
      wrap.innerHTML =
        '<button type="button" class="v6-btn v6-bt-toggle" data-v6-bt-toggle>' +
          '<span class="v6-bt-dot is-idle" data-v6-bt-dot></span> Backtest' +
        '</button>' + popoverHtml();
      anchorContainer.appendChild(wrap);

      var pop = wrap.querySelector('[data-v6-bt-pop]');
      var toggle = wrap.querySelector('[data-v6-bt-toggle]');

      toggle.addEventListener('click', function () { pop.hidden = !pop.hidden; });
      document.addEventListener('click', function (e) {
        if (!wrap.contains(e.target)) pop.hidden = true;
      });

      function val(sel) { var el = wrap.querySelector(sel); return el ? el.value : ''; }

      wrap.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-v6-bt]');
        if (!btn) return;
        var action = btn.getAttribute('data-v6-bt');
        var cmd = { action: action };
        if (action === 'start') {
          cmd.action = 'start';
          cmd.symbol = val('[data-v6-bt-symbol]') || 'BTCUSDT';
          cmd.date = val('[data-v6-bt-date]');
          cmd.speed = Number(val('[data-v6-bt-speed]'));
          // Clear live buffers so the replay starts clean.
          if (store && store.clearAllBuffers) store.clearAllBuffers();
          if (V6OF.CvdBuckets) V6OF.CvdBuckets.reset();
        } else if (action === 'speed') {
          cmd.speed = Number(val('[data-v6-bt-speed]'));
        }
        var statusEl = wrap.querySelector('[data-v6-bt-status]');
        if (statusEl && action === 'start') statusEl.textContent = 'loading…';
        post(cmd).then(function (st) { renderStatus(wrap, st); })
          .catch(function (err) { if (statusEl) statusEl.textContent = 'error: ' + err.message; });
      });

      // speed change applies live
      wrap.addEventListener('change', function (e) {
        if (e.target.closest('[data-v6-bt-speed]')) {
          post({ action: 'speed', speed: Number(val('[data-v6-bt-speed]')) }).catch(function () {});
        }
      });

      // Reflect replay_status pushed via the stream.
      if (store) {
        store.subscribe(function (state) {
          if (state && state.replay) renderStatus(wrap, state.replay);
        });
      }
    }
  };
})();
