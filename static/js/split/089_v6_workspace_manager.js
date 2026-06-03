// 089_v6_workspace_manager.js
// Phase 20: Workspace Manager for Cockpit V6.
// Manages visual workspace profiles (DOM, Tape, CVD, Heatmap, sizes, and buffers).
// Stores profiles in localStorage key 'cockpitV6.workspaces' and 'cockpitV6.activeWorkspace'.
// No SQLite. Pure client-side.

(function () {
  'use strict';
  var V6OF = window.V6OF = window.V6OF || {};

  var WORKSPACES_KEY = 'cockpitV6.workspaces';
  var ACTIVE_KEY = 'cockpitV6.activeWorkspace';

  var DEFAULT_PRESETS = {
    'Scalping': {
      chartMode: 'both',
      showTape: true,
      showDOM: true,
      showCVD: false,
      showVwap: true,
      showCandles: true,
      showBubbles: true,
      showHeatmap: false,
      showFootprint: false,
      rightColWidth: 330,
      cvdStripHeight: 226,
      maxTrades: 500,
      activeTab: 'dom'
    },
    'Orderflow': {
      chartMode: 'both',
      showTape: false,
      showDOM: true,
      showCVD: true,
      showVwap: true,
      showCandles: true,
      showBubbles: false,
      showHeatmap: true,
      showFootprint: true,
      rightColWidth: 360,
      cvdStripHeight: 260,
      maxTrades: 1000,
      activeTab: 'dom'
    }
  };

  function getWorkspaces() {
    try {
      var raw = localStorage.getItem(WORKSPACES_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return Object.assign({}, DEFAULT_PRESETS);
  }

  function saveWorkspaces(w) {
    try {
      localStorage.setItem(WORKSPACES_KEY, JSON.stringify(w));
    } catch (_) {}
  }

  function getActiveName() {
    return localStorage.getItem(ACTIVE_KEY) || 'Scalping';
  }

  function setActiveName(name) {
    localStorage.setItem(ACTIVE_KEY, name);
  }

  V6OF.WorkspaceManager = {
    init: function (root) {
      if (!root) return;
      var self = this;

      // Populate workspaces storage if empty
      if (!localStorage.getItem(WORKSPACES_KEY)) {
        saveWorkspaces(DEFAULT_PRESETS);
      }

      // Initial restore of active workspace on launch
      var active = getActiveName();
      var list = getWorkspaces();
      if (list[active]) {
        self.applyWorkspace(root, active, list[active]);
      } else {
        self.applyWorkspace(root, 'Scalping', DEFAULT_PRESETS['Scalping']);
      }

      // Render dropdown elements in the top bar
      self.renderSelector(root);
    },

    renderSelector: function (root) {
      var self = this;
      var container = root.querySelector('[data-v6-workspace-container]');
      if (!container) return;

      var active = getActiveName();
      var list = getWorkspaces();
      var keys = Object.keys(list);

      var optionsHtml = keys.map(function (k) {
        var selected = k === active ? ' selected' : '';
        return '<option value="' + k + '"' + selected + '>' + k + '</option>';
      }).join('');

      container.innerHTML = [
        '<div class="v6-workspace-widget">',
          '<span class="v6-workspace-lbl">Workspace:</span>',
          '<select class="v6-workspace-select" data-v6-workspace-select>',
            optionsHtml,
          '</select>',
          '<button type="button" class="v6-workspace-btn" data-v6-workspace-action="save" title="Save workspace layout">Save</button>',
          '<button type="button" class="v6-workspace-btn" data-v6-workspace-action="reset" title="Reset current workspace to default">Reset</button>',
          '<button type="button" class="v6-workspace-btn" data-v6-workspace-action="new" title="Create new custom workspace">+ New</button>',
        '</div>'
      ].join('');

      var select = container.querySelector('[data-v6-workspace-select]');
      if (select) {
        select.addEventListener('change', function () {
          var next = select.value;
          var wList = getWorkspaces();
          if (wList[next]) {
            setActiveName(next);
            self.applyWorkspace(root, next, wList[next]);
          }
        });
      }

      var saveBtn = container.querySelector('[data-v6-workspace-action="save"]');
      if (saveBtn) {
        saveBtn.addEventListener('click', function () {
          var cur = select ? select.value : getActiveName();
          self.saveCurrentState(root, cur);
          alert('Workspace "' + cur + '" saved successfully!');
        });
      }

      var resetBtn = container.querySelector('[data-v6-workspace-action="reset"]');
      if (resetBtn) {
        resetBtn.addEventListener('click', function () {
          var cur = select ? select.value : getActiveName();
          var presets = DEFAULT_PRESETS;
          var wList = getWorkspaces();
          if (presets[cur]) {
            wList[cur] = Object.assign({}, presets[cur]);
            saveWorkspaces(wList);
            self.applyWorkspace(root, cur, wList[cur]);
            alert('Workspace "' + cur + '" reset to default.');
          } else {
            alert('Cannot reset custom workspace.');
          }
        });
      }

      var newBtn = container.querySelector('[data-v6-workspace-action="new"]');
      if (newBtn) {
        newBtn.addEventListener('click', function () {
          var name = prompt('Enter a name for the new workspace:');
          if (!name) return;
          name = name.trim();
          if (!name) return;

          var wList = getWorkspaces();
          if (wList[name]) {
            alert('Workspace "' + name + '" already exists!');
            return;
          }

          // Duplicate current workspace state as new workspace
          self.saveCurrentState(root, name);
          setActiveName(name);
          self.renderSelector(root);
          self.applyWorkspace(root, name, getWorkspaces()[name]);
          alert('Workspace "' + name + '" created successfully!');
        });
      }
    },

    saveCurrentState: function (root, name) {
      if (!V6OF.store) return;
      var state = V6OF.store.getState();
      var settings = state.settings || {};

      var rightCol = root.querySelector('.v6-right-col');
      var cvdStrip = root.querySelector('[data-v6-cvd-strip]');
      var rbody = root.querySelector('[data-v6-rbody]');

      var activeTab = 'dom';
      if (rbody) {
        var m = rbody.className.match(/show-(\w+)/);
        if (m) activeTab = m[1];
      }

      var wList = getWorkspaces();
      wList[name] = {
        chartMode: settings.chartMode || 'both',
        showTape: settings.showTape !== false,
        showDOM: settings.showDOM !== false,
        showCVD: settings.showCVD !== false,
        showVwap: settings.showVwap !== false,
        showCandles: settings.showCandles !== false,
        showBubbles: settings.showBubbles !== false,
        showHeatmap: settings.showHeatmap === true,
        showFootprint: settings.showFootprint === true,
        rightColWidth: rightCol ? rightCol.offsetWidth : 330,
        cvdStripHeight: cvdStrip ? cvdStrip.offsetHeight : 226,
        maxTrades: settings.maxTrades || 500,
        activeTab: activeTab
      };
      saveWorkspaces(wList);
    },

    applyWorkspace: function (root, name, config) {
      if (!V6OF.store || !config) return;

      // Update store settings
      V6OF.store.updateSettings({
        chartMode: config.chartMode || 'both',
        showTape: config.showTape !== false,
        showDOM: config.showDOM !== false,
        showCVD: config.showCVD !== false,
        showVwap: config.showVwap !== false,
        showCandles: config.showCandles !== false,
        showBubbles: config.showBubbles !== false,
        showHeatmap: config.showHeatmap === true,
        showFootprint: config.showFootprint === true,
        maxTrades: config.maxTrades || 500
      });

      // Restore sizes
      if (V6OF.ResizablePanels) {
        V6OF.ResizablePanels.restoreSizes(root, config.rightColWidth, config.cvdStripHeight);
      }

      // Restore active right tab
      var rbody = root.querySelector('[data-v6-rbody]');
      if (rbody && config.activeTab) {
        rbody.className = 'v6-rbody show-' + config.activeTab;
        var rtabs = root.querySelectorAll('[data-v6-rtab]');
        Array.prototype.forEach.call(rtabs, function (tab) {
          tab.classList.toggle('is-active', tab.getAttribute('data-v6-rtab') === config.activeTab);
        });
      }

      // Update layout indicators and triggers
      var cv = root.querySelector('[data-v6-chart]');
      if (cv && V6OF.CanvasChart && V6OF.store) {
        requestAnimationFrame(function () {
          V6OF.CanvasChart.draw(cv, V6OF.store.getState());
        });
      }
    }
  };
})();
