// ---------- 087_v6_backtest_panel.js ----------
// Backtest / replay control panel for Cockpit V6.
// Posts commands to the Go engine's /replay endpoint (Binance Data Vision
// historical aggTrades) and reflects replay_status pushed over the WS stream.
// Floating draggable panel — drag via the title bar.
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
        '<div class="v6-bt-pop-head">',
          '<span class="v6-bt-drag-title">⏵ Backtest / Replay</span>',
          '<button type="button" class="v6-bt-pop-close" data-v6-bt-close>✕</button>',
        '</div>',
        '<div class="v6-bt-row">',
          '<label>Symbol<input type="text" data-v6-bt-symbol value="BTCUSDT" spellcheck="false"></label>',
          '<label>Date<input type="date" data-v6-bt-date value="' + yesterdayISO() + '"></label>',
        '</div>',
        '<div class="v6-bt-row-solo">',
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

  function setStatus(root, text, isError) {
    var el = root.querySelector('[data-v6-bt-status]');
    if (el) {
      el.textContent = text;
      el.style.background = isError ? 'rgba(255,80,100,0.15)' : '';
      el.style.color = isError ? '#ff6b7a' : '';
      el.style.padding = isError ? '6px 14px' : '';
      el.style.borderRadius = isError ? '4px' : '';
    }
    if (V6OF.announceStatus) {
      V6OF.announceStatus(null, 'Replay ' + text + '.');
    }
  }

  function renderStatus(root, st) {
    var bar = root.querySelector('[data-v6-bt-bar]');
    var status = root.querySelector('[data-v6-bt-status]');
    var dot = root.querySelector('[data-v6-bt-dot]');
    if (!st) return;
    if (bar) bar.style.width = Math.round((st.progress || 0) * 100) + '%';
    if (status) {
      var label = (st.state || 'idle');
      if (st.error) {
        label = 'error: ' + st.error;
        status.style.background = 'rgba(255,80,100,0.15)';
        status.style.color = '#ff6b7a';
        status.style.padding = '6px 14px';
        status.style.borderRadius = '4px';
      } else if (st.total) {
        label = label + ' · ' + (st.index || 0).toLocaleString() + '/' + st.total.toLocaleString() +
          ' · ' + fmtClock(st.clockMs) + ' · ' + (st.speed === 0 ? 'max' : st.speed + '×');
        status.style.background = '';
        status.style.color = '';
        status.style.padding = '';
        status.style.borderRadius = '';
      }
      status.textContent = label;
      if (V6OF.announceStatus) {
        V6OF.announceStatus(null, 'Replay ' + label + '.');
      }
    }
    if (dot) {
      dot.className = 'v6-bt-dot is-' + (st.state || 'idle');
    }
  }

  var activeCleanups = [];

  V6OF.Backtest = {
    dispose: function () {
      activeCleanups.forEach(function (cleanup) {
        try { cleanup(); } catch (_) {}
      });
      activeCleanups = [];
    },
    mount: function (anchorContainer, store) {
      if (!anchorContainer || anchorContainer.dataset.v6BtMounted === '1') return;
      this.dispose();
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
      var closeBtn = wrap.querySelector('[data-v6-bt-close]');
      var dragTitle = wrap.querySelector('.v6-bt-drag-title');

      // ── Toggle ──
      function showPanel() {
        if (!pop.hidden) return;
        var tr = toggle.getBoundingClientRect();
        pop.style.transform = 'none';
        pop.style.top = (tr.bottom + 4) + 'px';
        pop.style.left = Math.max(4, Math.min(window.innerWidth - 330, tr.right - 300)) + 'px';
        pop.hidden = false;
      }
      function hidePanel() { pop.hidden = true; }
      toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        if (pop.hidden) showPanel(); else hidePanel();
      });
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        hidePanel();
      });

      // ── Drag (only on .v6-bt-drag-title) ──
      var dragState = { active: false, startX: 0, startY: 0, origX: 0, origY: 0 };
      function onDown(e) {
        dragState.active = true;
        dragState.startX = e.clientX;
        dragState.startY = e.clientY;
        var rect = pop.getBoundingClientRect();
        dragState.origX = rect.left;
        dragState.origY = rect.top;
        pop.style.transform = 'none';
        pop.style.left = rect.left + 'px';
        pop.style.top = rect.top + 'px';
        pop.setPointerCapture(e.pointerId);
      }
      function onMove(e) {
        if (!dragState.active) return;
        pop.style.left = (dragState.origX + e.clientX - dragState.startX) + 'px';
        pop.style.top = (dragState.origY + e.clientY - dragState.startY) + 'px';
      }
      function onEnd() { dragState.active = false; }
      dragTitle.addEventListener('pointerdown', onDown);
      dragTitle.addEventListener('pointermove', onMove);
      dragTitle.addEventListener('pointerup', onEnd);
      dragTitle.addEventListener('pointercancel', onEnd);

      // ── Click outside closes ──
      var onDocClick = function (e) {
        if (!wrap.contains(e.target)) hidePanel();
      };
      document.addEventListener('click', onDocClick);
      activeCleanups.push(function () {
        document.removeEventListener('click', onDocClick);
      });
      activeCleanups.push(function () {
        delete anchorContainer.dataset.v6BtMounted;
        anchorContainer.removeAttribute('data-v6-bt-mounted');
      });

      // ── Button actions (delegated on wrap) ──
      function val(sel) { var el = wrap.querySelector(sel); return el ? el.value : ''; }

      function handleBtAction(e) {
        var btn = e.target.closest('[data-v6-bt]');
        if (!btn) return;
        e.stopPropagation();
        var action = btn.getAttribute('data-v6-bt');
        var cmd = { action: action };
        if (action === 'start') {
          cmd.symbol = val('[data-v6-bt-symbol]') || 'BTCUSDT';
          cmd.date = val('[data-v6-bt-date]');
          cmd.speed = Number(val('[data-v6-bt-speed]'));
          if (store && store.clearAllBuffers) store.clearAllBuffers();
          if (V6OF.CvdBuckets) V6OF.CvdBuckets.reset();
        }
        setStatus(wrap, action === 'start' ? 'Connecting to engine...' : action + '...', false);
        post(cmd).then(function (st) {
          renderStatus(wrap, st);
          // Auto-show on first replay status
          if (st && st.state && st.state !== 'idle' && pop.hidden) showPanel();
        }).catch(function (err) {
          setStatus(wrap, 'Engine unreachable: ' + err.message, true);
        });
      }
      wrap.addEventListener('click', handleBtAction);

      // ── Speed change (live) ──
      wrap.addEventListener('change', function (e) {
        if (e.target.closest('[data-v6-bt-speed]')) {
          post({ action: 'speed', speed: Number(val('[data-v6-bt-speed]')) }).catch(function () {});
        }
      });

      // ── Replay status via store → auto-show panel ──
      if (store) {
        var unsub = store.subscribe(function (state) {
          if (state && state.replay) {
            renderStatus(wrap, state.replay);
            // Auto-show panel when replay is active
            if (state.replay.state && state.replay.state !== 'idle' && pop.hidden) showPanel();
          }
        });
        activeCleanups.push(unsub);
      }
    }
  };
})();
