// 000_popover_helper.js
// Centralized popover lifecycle management (used by layout-picker & layout-grid).
// Eliminates duplication of positionPopover() / openPopover() / closePopover()
// between 091_v6_layout_picker.js and 094_v6_layout_grid.js.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};
  // Defensive: define V6OF.register if not already present
  if (!V6OF.register) {
    var domains = ['Core', 'Data', 'Transport', 'UI', 'Studies', 'Page'];
    domains.forEach(function (name) {
      V6OF[name] = V6OF[name] || {};
    });
    V6OF.register = function (domain, name, value, legacyName) {
      V6OF[domain] = V6OF[domain] || {};
      V6OF[domain][name] = value;
      if (legacyName) V6OF[legacyName] = value;
      return value;
    };
  }

  // Create a popover element from HTML string.
  // @param {string} html - Inner HTML markup
  // @return {HTMLElement} - The popover wrapper
  function popoverCreate(html) {
    var div = document.createElement('div');
    div.innerHTML = html;
    return div.firstElementChild;
  }

  // Position popover under anchor, right-aligned, clamped to viewport.
  // @param {HTMLElement} popEl - Popover element
  // @param {HTMLElement} anchorEl - Anchor element (optional)
  function popoverPosition(popEl, anchorEl) {
    if (!popEl) return;
    popEl.style.visibility = 'hidden';
    popEl.style.top = '0px';
    popEl.style.left = '0px';

    var margin = 8;
    var anchorRect = anchorEl ? anchorEl.getBoundingClientRect() : { bottom: margin, right: window.innerWidth - margin, left: margin };
    var popRect = popEl.getBoundingClientRect();

    var top = anchorRect.bottom + 6;
    var left = anchorRect.right - popRect.width;

    var maxLeft = window.innerWidth - popRect.width - margin;
    var maxTop = window.innerHeight - popRect.height - margin;
    if (left > maxLeft) left = maxLeft;
    if (left < margin) left = margin;
    if (top > maxTop) top = Math.max(margin, anchorRect.top - popRect.height - 6);
    if (top < margin) top = margin;

    popEl.style.top = top + 'px';
    popEl.style.left = left + 'px';
    popEl.style.visibility = '';
  }

  // Attach click-outside and escape listeners to popover.
  // @param {HTMLElement} popEl - Popover element
  // @param {HTMLElement} rootEl - Optional root to check for mounting (e.g., .v6-orderflow-root)
  // @param {Function} onClose - Callback when close is triggered
  // @param {string} keepOpenSelector - Optional selector for elements that keep popover open (e.g., anchor button)
  function popoverOpen(popEl, rootEl, onClose, keepOpenSelector) {
    if (!popEl) return;

    // Append to root (design token scope) or body
    (rootEl || document.body).appendChild(popEl);

    var outsideClose = function (e) {
      if (popEl && !popEl.contains(e.target)) {
        if (keepOpenSelector && e.target.closest(keepOpenSelector)) return;
        popoverClose(popEl, onClose);
      }
    };

    var escClose = function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        popoverClose(popEl, onClose);
      }
    };

    // Delay attachment so click that opened popover doesn't immediately close it
    setTimeout(function () {
      document.addEventListener('click', outsideClose, true);
      document.addEventListener('keydown', escClose);
    }, 0);

    // Store listeners on popEl so they can be detached later
    popEl._outsideClose = outsideClose;
    popEl._escClose = escClose;
  }

  // Remove popover from DOM and detach listeners.
  // @param {HTMLElement} popEl - Popover element
  // @param {Function} onClose - Callback after removal
  function popoverClose(popEl, onClose) {
    if (!popEl) return;
    if (popEl.parentNode) {
      popEl.parentNode.removeChild(popEl);
    }
    if (popEl._outsideClose) {
      document.removeEventListener('click', popEl._outsideClose, true);
    }
    if (popEl._escClose) {
      document.removeEventListener('keydown', popEl._escClose);
    }
    if (onClose) onClose();
  }

  V6OF.register('UI', 'PopoverHelper', {
    create: popoverCreate,
    position: popoverPosition,
    open: popoverOpen,
    close: popoverClose
  });
})();
