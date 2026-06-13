// ============ 095_v6_footprint_settings.js ============
// Footprint settings: configuration, defaults, validation

(function () {
  'use strict';

  var V6OF = window.V6OF = window.V6OF || {};

  // ===== DEFAULT SETTINGS =====
  var FOOTPRINT_DEFAULTS = {
    // Display
    showFootprint: false,                // Enable/disable footprint
    showFootprintPOC: true,             // Show Point of Control marker
    showFootprintVA: true,              // Show Value Area shading
    showFootprintImbalances: true,      // Highlight 3-to-1 imbalances
    showFootprintDelta: true,           // Show delta coloring

    // Rendering
    footprintMinZoom: 'daily',          // Minimum timeframe to show (daily/hourly/15m/5m/1m)
    footprintColumnMode: 'bid-ask',     // 'bid-ask', 'delta', 'volume'
    footprintOpacity: 0.7,              // Volume bar opacity (0-1)
    footprintPOCWidth: 3,               // POC marker width (px)
    imbalanceRatio: 3,                  // Imbalance trigger ratio (3 = 3-to-1)

    // Colors (can be overridden per user theme)
    footprintColorBuy: '#39c77a',       // Green for buy volume
    footprintColorSell: '#d85b66',      // Red for sell volume
    footprintColorPOC: '#facc15',       // Yellow for POC
    footprintColorVA: '#f0ad4e',        // Orange for Value Area

    // History
    footprintMaxCandles: 100,           // Max candles to keep in memory
    footprintHistoryLookback: 10080     // Lookback minutes (7 days)
  };

  // ===== SETTING DEFINITIONS =====
  var FOOTPRINT_SETTING_DEFS = {
    showFootprint: {
      type: 'bool',
      label: 'Show Footprint',
      description: 'Display order flow footprint on chart',
      default: false,
      group: 'display'
    },
    showFootprintPOC: {
      type: 'bool',
      label: 'POC Marker',
      description: 'Show Point of Control (highest volume level)',
      default: true,
      group: 'markers'
    },
    showFootprintVA: {
      type: 'bool',
      label: 'Value Area',
      description: 'Show Value Area (70% of volume)',
      default: true,
      group: 'markers'
    },
    showFootprintImbalances: {
      type: 'bool',
      label: 'Imbalances',
      description: 'Highlight volume imbalances (institutional activity)',
      default: true,
      group: 'markers'
    },
    footprintColumnMode: {
      type: 'enum',
      label: 'Column Display',
      description: 'How to display volume columns',
      values: ['bid-ask', 'delta', 'volume'],
      default: 'bid-ask',
      group: 'rendering',
      help: {
        'bid-ask': 'Show separate buy/sell columns',
        'delta': 'Show net delta as single column',
        'volume': 'Show total volume (no buy/sell split)'
      }
    },
    footprintOpacity: {
      type: 'slider',
      label: 'Opacity',
      description: 'Volume bar transparency',
      min: 0.1,
      max: 1,
      step: 0.1,
      default: 0.7,
      group: 'rendering'
    },
    imbalanceRatio: {
      type: 'number',
      label: 'Imbalance Ratio',
      description: 'Ratio to trigger imbalance highlight (e.g. 3 = 3-to-1)',
      min: 1.5,
      max: 10,
      default: 3,
      group: 'rendering'
    }
  };

  // ===== VALIDATION =====

  /**
   * Validate footprint settings
   */
  function validateSettings(settings) {
    if (!settings || typeof settings !== 'object') return false;

    // Check critical boolean flags
    var hasBoolFlags = 'showFootprint' in settings ||
                       'showFootprintPOC' in settings ||
                       'showFootprintVA' in settings;

    if (!hasBoolFlags) return false;

    // Validate types
    if ('showFootprint' in settings && typeof settings.showFootprint !== 'boolean') {
      return false;
    }
    if ('footprintOpacity' in settings) {
      var op = Number(settings.footprintOpacity);
      if (!Number.isFinite(op) || op < 0 || op > 1) return false;
    }
    if ('imbalanceRatio' in settings) {
      var ratio = Number(settings.imbalanceRatio);
      if (!Number.isFinite(ratio) || ratio < 1) return false;
    }

    return true;
  }

  /**
   * Merge user settings with defaults
   */
  function mergeWithDefaults(userSettings) {
    var merged = {};

    // Start with defaults
    Object.keys(FOOTPRINT_DEFAULTS).forEach(function(key) {
      merged[key] = FOOTPRINT_DEFAULTS[key];
    });

    // Override with user settings
    if (userSettings && typeof userSettings === 'object') {
      Object.keys(userSettings).forEach(function(key) {
        if (key in FOOTPRINT_DEFAULTS) {
          merged[key] = userSettings[key];
        }
      });
    }

    return merged;
  }

  // ===== PRESETS =====

  var FOOTPRINT_PRESETS = {
    'minimal': {
      showFootprint: true,
      showFootprintPOC: false,
      showFootprintVA: false,
      showFootprintImbalances: false,
      footprintOpacity: 0.5
    },
    'standard': {
      showFootprint: true,
      showFootprintPOC: true,
      showFootprintVA: true,
      showFootprintImbalances: false,
      footprintOpacity: 0.7
    },
    'detailed': {
      showFootprint: true,
      showFootprintPOC: true,
      showFootprintVA: true,
      showFootprintImbalances: true,
      footprintOpacity: 0.9,
      imbalanceRatio: 2.5
    },
    'order-flow': {
      showFootprint: true,
      showFootprintPOC: true,
      showFootprintVA: true,
      showFootprintImbalances: true,
      footprintColumnMode: 'delta',
      footprintOpacity: 0.8,
      imbalanceRatio: 2
    }
  };

  /**
   * Apply a preset
   */
  function applyPreset(presetName) {
    var preset = FOOTPRINT_PRESETS[presetName];
    if (!preset) return null;
    return mergeWithDefaults(preset);
  }

  /**
   * Get all available presets
   */
  function getAvailablePresets() {
    return Object.keys(FOOTPRINT_PRESETS);
  }

  // ===== EXPORTS =====
  V6OF.register('Core', 'FootprintSettings', {
    DEFAULTS: FOOTPRINT_DEFAULTS,
    DEFINITIONS: FOOTPRINT_SETTING_DEFS,
    PRESETS: FOOTPRINT_PRESETS,
    validateSettings: validateSettings,
    mergeWithDefaults: mergeWithDefaults,
    applyPreset: applyPreset,
    getAvailablePresets: getAvailablePresets
  });

  if (typeof V6OF.register !== 'function') {
    V6OF.Core = V6OF.Core || {};
    V6OF.Core.FootprintSettings = {
      DEFAULTS: FOOTPRINT_DEFAULTS,
      DEFINITIONS: FOOTPRINT_SETTING_DEFS,
      PRESETS: FOOTPRINT_PRESETS,
      validateSettings: validateSettings,
      mergeWithDefaults: mergeWithDefaults,
      applyPreset: applyPreset,
      getAvailablePresets: getAvailablePresets
    };
  }

  V6OF.debugLog('[Footprint Settings] Initialized with presets:', getAvailablePresets());
})();
