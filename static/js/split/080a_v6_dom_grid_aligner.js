// 080a_v6_dom_grid_aligner.js
// GridAligner: aligns DOM footprint rows to the canvas GridSystem so
// price-axis rows line up pixel-perfectly with the canvas grid and
// share uniform, grid-snapped heights.

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};

  /**
   * Snap a row index to its grid-aligned Y position.
   * @param {number} rowIndex - Zero-based row index (top to bottom)
   * @param {Object} gridSystem - V6OF.Core.GridSystem instance (uses cellHeight)
   * @returns {number} - Grid-aligned Y position (CSS pixels)
   */
  function snapRowToGrid(rowIndex, gridSystem) {
    var cellHeight = (gridSystem && gridSystem.cellHeight) || 1;
    return Math.round(rowIndex * cellHeight);
  }

  /**
   * Ensure all DOM footprint rows in a container share an even,
   * grid-aligned height and are positioned at grid-snapped Y offsets.
   * @param {Element} container - Parent element holding [data-footprint-row] rows
   * @param {number} visibleLevels - Number of price levels visible
   * @param {Object} [gridSystem] - Optional GridSystem to snap heights to cellHeight
   */
  function ensureEvenRowSpacing(container, visibleLevels, gridSystem) {
    if (!container) return;
    var levels = Math.max(1, visibleLevels);
    var rowHeight = gridSystem && gridSystem.cellHeight
      ? gridSystem.cellHeight
      : container.clientHeight / levels;
    rowHeight = Math.max(1, Math.round(rowHeight));

    var rows = container.querySelectorAll('[data-footprint-row]');
    rows.forEach(function (row, idx) {
      var y = gridSystem ? snapRowToGrid(idx, gridSystem) : idx * rowHeight;
      row.style.top = y + 'px';
      row.style.height = rowHeight + 'px';
      row.style.lineHeight = rowHeight + 'px';

      var textEl = row.querySelector('[data-footprint-text]');
      if (textEl) {
        textEl.style.lineHeight = rowHeight + 'px';
      }
    });
  }

  // Export
  if (typeof V6OF.register === 'function') {
    V6OF.register('Core', 'GridAligner', {
      snapRowToGrid: snapRowToGrid,
      ensureEvenRowSpacing: ensureEvenRowSpacing
    });
  } else {
    V6OF.Core = V6OF.Core || {};
    V6OF.Core.GridAligner = {
      snapRowToGrid: snapRowToGrid,
      ensureEvenRowSpacing: ensureEvenRowSpacing
    };
  }
})();
