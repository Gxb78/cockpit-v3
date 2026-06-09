// 092_v6_panel_settings.js
// Per-panel settings flyout: opens anchored to the panel's ⚙ button.
// Reads/writes store settings keys for DOM and Tape panels.

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

  // Schema: for each panelId, list of { key, label, min, max, step, type }
  var PANEL_FIELDS = {
    dom: [
      { key: 'domDepth',     label: 'DOM Depth',     min: 10,  max: 5000, step: 10, type: 'number' },
      { key: 'wallScoreMin', label: 'Wall Threshold', min: 1,   max: 5,   step: 1,  type: 'number' }
    ],
    tape: [
      { key: 'minQty',       label: 'Min Qty',        min: 0,   max: 500,  step: 1,  type: 'number' },
      { key: 'maxRows',      label: 'Max Rows',       min: 8,   max: 5000, step: 10, type: 'number' },
      { key: 'tapeFontSize', label: 'Font Size (px)', min: 8,   max: 20,   step: 1,  type: 'number' }
    ]
  };

  var _flyout = null;
  var _store = null;

  function getSettings() {
    var state = _store && _store.getState ? _store.getState() : {};
    return state.settings || {};
  }

  function escHtml(s) {
    return V6OF.escapeHtml ? V6OF.escapeHtml(String(s)) : String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function flyoutHtml(panelId) {
    var fields = PANEL_FIELDS[panelId];
    if (!fields || !fields.length) return '';
    var settings = getSettings();
    var rows = fields.map(function (f) {
      var val = settings[f.key];
      if (val === undefined || val === null) val = '';
      return [
        '<label class="v6-ps-row">',
          '<span class="v6-ps-label">', escHtml(f.label), '</span>',
          '<input class="v6-ps-input" type="', f.type, '"',
            ' data-v6-ps-key="', f.key, '"',
            ' min="', f.min, '"',
            ' max="', f.max, '"',
            ' step="', f.step, '"',
            ' value="', escHtml(val), '"',
          '/>',
        '</label>'
      ].join('');
    }).join('');

    return [
      '<div class="v6-ps-flyout" data-v6-ps-panel="', panelId, '">',
        '<div class="v6-ps-title">',
          escHtml(panelId.charAt(0).toUpperCase() + panelId.slice(1)), ' Settings',
        '</div>',
        '<div class="v6-ps-body">', rows, '</div>',
      '</div>'
    ].join('');
  }

  function closeFlyout() {
    if (_flyout && _flyout.parentNode) {
      _flyout.parentNode.removeChild(_flyout);
    }
    _flyout = null;
    document.removeEventListener('click', outsideClose, true);
  }

  function outsideClose(e) {
    if (_flyout && !_flyout.contains(e.target)) {
      closeFlyout();
    }
  }

  function openFlyout(anchorEl, panelId, store) {
    closeFlyout();
    _store = store;

    var fields = PANEL_FIELDS[panelId];
    if (!fields || !fields.length) return;

    var html = flyoutHtml(panelId);
    if (!html) return;

    var div = document.createElement('div');
    div.innerHTML = html;
    _flyout = div.firstElementChild;

    // Wire inputs → store
    var inputs = _flyout.querySelectorAll('[data-v6-ps-key]');
    for (var i = 0; i < inputs.length; i++) {
      (function (inp) {
        inp.addEventListener('change', function () {
          var key = inp.getAttribute('data-v6-ps-key');
          var val = Number(inp.value);
          if (!isNaN(val) && store) {
            var patch = {};
            patch[key] = val;
            store.updateSettings(patch);
          }
        });
      })(inputs[i]);
    }

    document.body.appendChild(_flyout);

    // Position below anchor
    if (anchorEl) {
      var rect = anchorEl.getBoundingClientRect();
      _flyout.style.top = (rect.bottom + 4 + window.scrollY) + 'px';
      _flyout.style.left = Math.max(8, rect.right + window.scrollX - 180) + 'px';
    }

    setTimeout(function () {
      document.addEventListener('click', outsideClose, true);
    }, 0);
  }

  V6OF.register('UI', 'PanelSettings', {
    open: openFlyout,
    close: closeFlyout
  });
})();
