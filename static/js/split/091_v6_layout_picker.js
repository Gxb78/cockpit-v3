// 091_v6_layout_picker.js
// Layout picker: STANDARD presets, SYNC toggles, add-panel menu.
// Injected into .v6-header by LayoutPicker.init(root, store).

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

  var ALL_PANELS = ['dom', 'tape', 'info'];

  // SVG thumbnails for each preset (16x12 viewport)
  var PRESET_SVGS = {
    'single':       '<svg viewBox="0 0 16 12"><rect x="1" y="1" width="14" height="10" rx="1"/></svg>',
    'vsplit':       '<svg viewBox="0 0 16 12"><rect x="1" y="1" width="8" height="10" rx="1"/><rect x="10" y="1" width="5" height="10" rx="1"/></svg>',
    'hsplit':       '<svg viewBox="0 0 16 12"><rect x="1" y="1" width="14" height="5" rx="1"/><rect x="1" y="7" width="14" height="4" rx="1"/></svg>',
    'one-plus-two': '<svg viewBox="0 0 16 12"><rect x="1" y="1" width="8" height="10" rx="1"/><rect x="10" y="1" width="5" height="4" rx="1"/><rect x="10" y="7" width="5" height="4" rx="1"/></svg>',
    'three':        '<svg viewBox="0 0 16 12"><rect x="1" y="1" width="4" height="10" rx="1"/><rect x="6" y="1" width="4" height="10" rx="1"/><rect x="11" y="1" width="4" height="10" rx="1"/></svg>',
    '2x2':          '<svg viewBox="0 0 16 12"><rect x="1" y="1" width="6" height="4" rx="1"/><rect x="9" y="1" width="6" height="4" rx="1"/><rect x="1" y="7" width="6" height="4" rx="1"/><rect x="9" y="7" width="6" height="4" rx="1"/></svg>'
  };

  var PRESET_LABELS = {
    'single': 'Single', 'vsplit': 'Vertical', 'hsplit': 'Horizontal',
    'one-plus-two': '1+2', 'three': '3 Col', '2x2': '2x2'
  };

  function buildSchema(preset, cur) {
    cur = cur || {};
    var sync = cur.sync || {};
    var base = {
      activeRightTab: cur.activeRightTab || 'dom',
      activeLeftTab: cur.activeLeftTab || '',
      sync: sync
    };
    if (preset === 'single' || preset === 'vsplit') {
      return Object.assign({}, base, {
        left: [], right: ['dom', 'tape', 'info', 'indicators', 'settings'],
        center: ['chart'], activeLeftTab: ''
      });
    }
    if (preset === 'hsplit' || preset === 'one-plus-two') {
      return Object.assign({}, base, {
        left: ['tape'], right: ['dom', 'info', 'indicators', 'settings'],
        center: ['chart'], activeLeftTab: cur.activeLeftTab || 'tape'
      });
    }
    // three or 2x2
    return Object.assign({}, base, {
      left: ['tape', 'info'], right: ['dom', 'indicators', 'settings'],
      center: ['chart'], activeLeftTab: cur.activeLeftTab || 'tape'
    });
  }

  var _popover = null;
  var _store = null;
  var _root = null;

  function getSchema() {
    var state = _store && _store.getState ? _store.getState() : {};
    return (state.settings || {}).layoutSchema || { left: [], right: ['dom', 'tape'], center: ['chart'], sync: {} };
  }

  function popoverHtml(schema) {
    var sync = schema.sync || {};
    var allInSchema = (schema.left || []).concat(schema.right || []);
    var absent = ALL_PANELS.filter(function (id) {
      return allInSchema.indexOf(id) === -1;
    });

    var presetBtns = Object.keys(PRESET_SVGS).map(function (key) {
      return '<button type="button" class="v6-lp-preset" data-v6-layout-preset="' + key + '" title="' + PRESET_LABELS[key] + '">' +
        PRESET_SVGS[key] + '<span>' + PRESET_LABELS[key] + '</span></button>';
    }).join('');

    var syncToggles = ['symbol', 'interval', 'crosshair'].map(function (key) {
      var active = sync[key] ? ' is-active' : '';
      return '<button type="button" class="v6-lp-sync' + active + '" data-v6-sync-toggle="' + key + '">' +
        key.charAt(0).toUpperCase() + key.slice(1) + '</button>';
    }).join('');

    var addChips = absent.map(function (id) {
      return '<button type="button" class="v6-lp-add-chip" data-v6-add-panel="' + id + '">+ ' +
        id.charAt(0).toUpperCase() + id.slice(1) + '</button>';
    }).join('');

    return [
      '<div class="v6-lp-popover" data-v6-layout-popover>',
        '<div class="v6-lp-section">',
          '<div class="v6-lp-section-title">STANDARD</div>',
          '<div class="v6-lp-presets">', presetBtns, '</div>',
        '</div>',
        '<div class="v6-lp-sep"></div>',
        '<div class="v6-lp-section">',
          '<div class="v6-lp-section-title">SYNC</div>',
          '<div class="v6-lp-syncs">', syncToggles, '</div>',
        '</div>',
        absent.length ? [
          '<div class="v6-lp-sep"></div>',
          '<div class="v6-lp-section">',
            '<div class="v6-lp-section-title">ADD PANEL</div>',
            '<div class="v6-lp-adds">', addChips, '</div>',
          '</div>'
        ].join('') : '',
      '</div>'
    ].join('');
  }

  function handlePopoverClick(e) {
    var presetBtn = e.target.closest('[data-v6-layout-preset]');
    var syncBtn = e.target.closest('[data-v6-sync-toggle]');
    var addBtn = e.target.closest('[data-v6-add-panel]');

    if (presetBtn) {
      var preset = presetBtn.getAttribute('data-v6-layout-preset');
      var cur = getSchema();
      var next = buildSchema(preset, cur);
      if (_store) _store.updateSettings({ layoutSchema: next });
      closePopover();
      return;
    }

    if (syncBtn) {
      var syncKey = syncBtn.getAttribute('data-v6-sync-toggle');
      var cur2 = getSchema();
      var syncObj = Object.assign({}, cur2.sync || {});
      syncObj[syncKey] = !syncObj[syncKey];
      if (_store) _store.updateSettings({ layoutSchema: Object.assign({}, cur2, { sync: syncObj }) });
      // Re-render popover in place to reflect toggle state
      if (_popover && _popover.parentNode) {
        var newDiv = document.createElement('div');
        newDiv.innerHTML = popoverHtml(getSchema());
        var newPop = newDiv.firstElementChild;
        newPop.addEventListener('click', handlePopoverClick);
        _popover.parentNode.replaceChild(newPop, _popover);
        _popover = newPop;
      }
      return;
    }

    if (addBtn) {
      var panelId = addBtn.getAttribute('data-v6-add-panel');
      var cur3 = getSchema();
      var nextRight = (cur3.right || []).concat([panelId]);
      if (_store) _store.updateSettings({ layoutSchema: Object.assign({}, cur3, {
        right: nextRight,
        activeRightTab: panelId
      })});
      closePopover();
    }
  }

  function openPopover(anchorEl) {
    closePopover();
    // Use centralized popover helper (000_popover_helper.js)
    _popover = V6OF.UI.PopoverHelper.create(popoverHtml(getSchema()));
    _popover.addEventListener('click', handlePopoverClick);
    V6OF.UI.PopoverHelper.open(_popover, document.body, function() { _popover = null; });
    V6OF.UI.PopoverHelper.position(_popover, anchorEl);
  }

  function closePopover() {
    if (_popover) {
      V6OF.UI.PopoverHelper.close(_popover);
      _popover = null;
    }
  }

  V6OF.register('UI', 'LayoutPicker', {
    init: function (root, store) {
      _root = root;
      _store = store;

      // Inject layout picker button into the header toolbar area
      var header = root && root.querySelector('.v6-header');
      if (!header || header._v6LayoutPickerMounted) return;
      header._v6LayoutPickerMounted = true;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'v6-header-lp-btn';
      btn.setAttribute('data-v6-layout-picker', '');
      btn.setAttribute('title', 'Layout picker');
      btn.setAttribute('aria-label', 'Layout picker');
      btn.innerHTML = '<svg viewBox="0 0 18 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' +
        '<rect x="1" y="1" width="7" height="12" rx="1"/>' +
        '<rect x="10" y="1" width="7" height="5" rx="1"/>' +
        '<rect x="10" y="8" width="7" height="5" rx="1"/>' +
        '</svg>';

      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (_popover) { closePopover(); return; }
        openPopover(btn);
      });

      // Insert before the right side of the header (before reconnect/settings)
      var headerRight = header.querySelector('.v6-header-right, .v6-header-actions, .v6-reconnect');
      if (headerRight) {
        header.insertBefore(btn, headerRight);
      } else {
        header.appendChild(btn);
      }
    },
    open: openPopover,
    close: closePopover,
    buildSchema: buildSchema
  });
})();
