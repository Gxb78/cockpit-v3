// 089_v6_workspace_manager.js
// Phase 20: Workspace Manager for Cockpit V6.
// Manages visual workspace profiles (DOM, Tape, CVD, Heatmap, sizes, and buffers).
// Stores profiles in localStorage key 'cockpitV6.workspaces' and 'cockpitV6.activeWorkspace'.
// No SQLite. Pure client-side.
// Updated: Accessible custom dialogs conforming to APG/RGAA, validation, duplication, renaming, deletion.

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
      rightColWidth: 430,
      cvdStripHeight: 226,
      maxTrades: 5000,
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
      rightColWidth: 460,
      cvdStripHeight: 260,
      maxTrades: 10000,
      activeTab: 'dom'
    },
    'Analysis': {
      chartMode: 'both',
      showTape: true,
      showDOM: false,
      showCVD: true,
      showVwap: true,
      showCandles: true,
      showBubbles: false,
      showHeatmap: true,
      showFootprint: true,
      rightColWidth: 480,
      cvdStripHeight: 240,
      maxTrades: 5000,
      activeTab: 'info'
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

  var _dialogNode = null;
  function closeDialog() {
    if (_dialogNode) {
      _dialogNode.style.display = 'none';
      if (_dialogNode._previousFocus) {
        _dialogNode._previousFocus.focus();
      }
      document.removeEventListener('keydown', handleDialogKeyDown);
    }
  }

  function handleDialogKeyDown(e) {
    if (e.key === 'Escape') {
      closeDialog();
    } else if (e.key === 'Tab' && _dialogNode) {
      // Focus trapping
      var focusables = _dialogNode.querySelectorAll('button, input, select');
      if (focusables.length === 0) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          last.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    }
  }

  function openDialog(root, opts) {
    if (!_dialogNode) {
      _dialogNode = document.createElement('div');
      _dialogNode.className = 'v6-dialog-overlay';
      _dialogNode.id = 'v6-workspace-dialog';
      root.appendChild(_dialogNode);
      
      // Inject dialog CSS styles
      var style = document.createElement('style');
      style.textContent = [
        '.v6-dialog-overlay { position: fixed; inset: 0; z-index: 9999; background: rgba(0, 0, 0, 0.75); display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); animation: v6-fade-in 0.2s ease-out; }',
        '.v6-dialog { background: #0b1218; border: 1px solid rgba(118, 144, 160, 0.25); border-radius: 8px; width: 420px; max-width: 90%; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); animation: v6-slide-up 0.2s cubic-bezier(0.16, 1, 0.3, 1); color: #a8c0d0; font-family: system-ui, sans-serif; }',
        '.v6-dialog-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid rgba(118, 144, 160, 0.16); }',
        '.v6-dialog-title { margin: 0; font-size: 14px; font-weight: 700; color: #f0f4f8; text-transform: uppercase; letter-spacing: 0.05em; }',
        '.v6-dialog-close { background: transparent; border: none; color: #8da3b3; font-size: 20px; cursor: pointer; padding: 4px; line-height: 1; }',
        '.v6-dialog-close:hover { color: #fff; }',
        '.v6-dialog-body { padding: 20px 16px; font-size: 12px; }',
        '.v6-dialog-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }',
        '.v6-dialog-input { background: rgba(8, 12, 20, 0.8); border: 1px solid rgba(118, 144, 160, 0.25); border-radius: 4px; color: #fff; padding: 8px 12px; font-size: 12px; outline: none; width: 100%; }',
        '.v6-dialog-input:focus { border-color: #22d3ee; }',
        '.v6-dialog-error { color: #ff6b80; font-size: 11px; min-height: 16px; margin-top: 6px; font-weight: bold; }',
        '.v6-dialog-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }',
        '.v6-dialog-btn { padding: 6px 12px; font-size: 11px; font-weight: 700; border-radius: 4px; cursor: pointer; border: 1px solid rgba(118, 144, 160, 0.25); background: transparent; color: #f0f4f8; transition: background 0.15s; }',
        '.v6-dialog-btn:hover { background: rgba(255, 255, 255, 0.05); }',
        '.v6-dialog-btn.v6-btn-primary { background: #22d3ee; border-color: #22d3ee; color: #04121a; }',
        '.v6-dialog-btn.v6-btn-primary:hover { background: #0fb6d4; border-color: #0fb6d4; }',
        '.v6-dialog-btn.v6-btn-danger { background: rgba(255, 107, 128, 0.15); border-color: rgba(255, 107, 128, 0.4); color: #ff6b80; }',
        '.v6-dialog-btn.v6-btn-danger:hover { background: rgba(255, 107, 128, 0.3); }',
        '@keyframes v6-fade-in { from { opacity: 0; } to { opacity: 1; } }',
        '@keyframes v6-slide-up { from { transform: translateY(12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }'
      ].join('');
      document.head.appendChild(style);
    }

    _dialogNode._previousFocus = document.activeElement;

    var html = [
      '<div class="v6-dialog" role="dialog" aria-modal="true" aria-labelledby="v6-dialog-title">',
        '<header class="v6-dialog-header">',
          '<h3 id="v6-dialog-title" class="v6-dialog-title">' + V6OF.escapeHtml(opts.title || 'Notification') + '</h3>',
          '<button type="button" class="v6-dialog-close" data-v6-dialog-close aria-label="Close dialog">&times;</button>',
        '</header>',
        '<div class="v6-dialog-body">',
          opts.bodyHtml || '',
          opts.showInput ? [
            '<div class="v6-dialog-field">',
              '<input type="text" class="v6-dialog-input" id="v6-dialog-text-input" value="' + V6OF.escapeHtml(opts.defaultValue || '') + '" aria-label="Input name" />',
              '<div class="v6-dialog-error" id="v6-dialog-error-msg"></div>',
            '</div>'
          ].join('') : '',
          '<div class="v6-dialog-footer">',
            opts.onCancel ? '<button type="button" class="v6-dialog-btn" id="v6-dialog-cancel-btn">Cancel</button>' : '',
            '<button type="button" class="v6-dialog-btn ' + (opts.isDanger ? 'v6-btn-danger' : 'v6-btn-primary') + '" id="v6-dialog-confirm-btn">Confirm</button>',
          '</div>',
        '</div>',
      '</div>'
    ].join('');

    _dialogNode.innerHTML = html;
    _dialogNode.style.display = 'flex';

    _dialogNode.querySelector('[data-v6-dialog-close]').addEventListener('click', closeDialog);
    _dialogNode.addEventListener('click', function(e) {
      if (e.target === _dialogNode) closeDialog();
    });

    var cancelBtn = _dialogNode.querySelector('#v6-dialog-cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', function() {
        if (opts.onCancel) opts.onCancel();
        closeDialog();
      });
    }

    var confirmBtn = _dialogNode.querySelector('#v6-dialog-confirm-btn');
    var input = _dialogNode.querySelector('#v6-dialog-text-input');
    var errorEl = _dialogNode.querySelector('#v6-dialog-error-msg');

    function validate() {
      if (input && opts.validateFn) {
        var val = input.value;
        var err = opts.validateFn(val);
        if (err) {
          errorEl.textContent = err;
          confirmBtn.disabled = true;
          confirmBtn.style.opacity = 0.5;
          confirmBtn.style.cursor = 'not-allowed';
        } else {
          errorEl.textContent = '';
          confirmBtn.disabled = false;
          confirmBtn.style.opacity = 1;
          confirmBtn.style.cursor = 'pointer';
        }
      }
    }

    if (input) {
      input.addEventListener('input', validate);
      validate();
      setTimeout(function() { input.focus(); }, 50);
    } else {
      setTimeout(function() { confirmBtn.focus(); }, 50);
    }

    confirmBtn.addEventListener('click', function() {
      var val = input ? input.value : null;
      if (input && opts.validateFn && opts.validateFn(val)) return;
      opts.onConfirm(val);
      closeDialog();
    });

    document.addEventListener('keydown', handleDialogKeyDown);
  }

  V6OF.WorkspaceManager = {
    init: function (root) {
      if (!root) return;
      var self = this;

      if (!localStorage.getItem(WORKSPACES_KEY)) {
        saveWorkspaces(DEFAULT_PRESETS);
      }

      var active = getActiveName();
      var list = getWorkspaces();
      if (list[active]) {
        self.applyWorkspace(root, active, list[active]);
      } else {
        self.applyWorkspace(root, 'Scalping', DEFAULT_PRESETS['Scalping']);
      }

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
          '<select class="v6-workspace-select" data-v6-workspace-select aria-label="Select workspace profile">',
            optionsHtml,
          '</select>',
          '<button type="button" class="v6-workspace-btn" data-v6-workspace-action="save" title="Save workspace layout">Save</button>',
          '<button type="button" class="v6-workspace-btn" data-v6-workspace-action="reset" title="Reset current workspace to default">Reset</button>',
          '<button type="button" class="v6-workspace-btn" data-v6-workspace-action="manage" title="Manage workspaces (duplicate, rename, delete)">Manage</button>',
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
          openDialog(root, {
            title: 'Workspace Saved',
            bodyHtml: '<p>Workspace "' + V6OF.escapeHtml(cur) + '" has been saved successfully.</p>',
            onConfirm: function() {}
          });
        });
      }

      var resetBtn = container.querySelector('[data-v6-workspace-action="reset"]');
      if (resetBtn) {
        resetBtn.addEventListener('click', function () {
          var cur = select ? select.value : getActiveName();
          var presets = DEFAULT_PRESETS;
          var wList = getWorkspaces();
          if (presets[cur]) {
            openDialog(root, {
              title: 'Reset Workspace',
              bodyHtml: '<p>Are you sure you want to reset workspace "' + V6OF.escapeHtml(cur) + '" to its default preset layout?</p>',
              onConfirm: function() {
                wList[cur] = Object.assign({}, presets[cur]);
                saveWorkspaces(wList);
                self.applyWorkspace(root, cur, wList[cur]);
              },
              onCancel: function() {}
            });
          } else {
            openDialog(root, {
              title: 'Reset Error',
              bodyHtml: '<p>Preset workspaces cannot be reset if they are custom-made.</p>',
              onConfirm: function() {}
            });
          }
        });
      }

      var manageBtn = container.querySelector('[data-v6-workspace-action="manage"]');
      if (manageBtn) {
        manageBtn.addEventListener('click', function () {
          self.openWorkspaceManagementDialog(root);
        });
      }
    },

    openWorkspaceManagementDialog: function (root) {
      var self = this;
      var wList = getWorkspaces();
      var keys = Object.keys(wList);
      
      var listHtml = keys.map(function(name) {
        var isPreset = DEFAULT_PRESETS[name] != null;
        var label = name + (isPreset ? ' (Preset)' : '');
        var renameBtn = !isPreset ? '<button type="button" class="v6-dialog-btn" data-v6-mgr-action="rename" data-name="' + name + '">Rename</button>' : '';
        var deleteBtn = !isPreset ? '<button type="button" class="v6-dialog-btn v6-btn-danger" data-v6-mgr-action="delete" data-name="' + name + '">Delete</button>' : '';
        var duplicateBtn = '<button type="button" class="v6-dialog-btn v6-btn-primary" data-v6-mgr-action="duplicate" data-name="' + name + '">Duplicate</button>';
        
        return [
          '<div style="display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(118, 144, 160, 0.1);">',
            '<span style="font-weight: bold; color: #f0f4f8;">' + V6OF.escapeHtml(label) + '</span>',
            '<div style="display: flex; gap: 4px;">',
              duplicateBtn,
              renameBtn,
              deleteBtn,
            '</div>',
          '</div>'
        ].join('');
      }).join('');

      var bodyHtml = [
        '<div style="max-height: 250px; overflow-y: auto; margin-bottom: 12px;">',
          listHtml,
        '</div>'
      ].join('');

      openDialog(root, {
        title: 'Manage Workspaces',
        bodyHtml: bodyHtml,
        onConfirm: function() {
          self.renderSelector(root);
        }
      });

      var mgrDialog = document.getElementById('v6-workspace-dialog');
      if (mgrDialog) {
        mgrDialog.addEventListener('click', function(e) {
          var btn = e.target.closest('[data-v6-mgr-action]');
          if (!btn) return;
          var action = btn.getAttribute('data-v6-mgr-action');
          var name = btn.getAttribute('data-name');
          
          if (action === 'delete') {
            closeDialog();
            self.confirmDelete(root, name);
          } else if (action === 'rename') {
            closeDialog();
            self.promptRename(root, name);
          } else if (action === 'duplicate') {
            closeDialog();
            self.promptDuplicate(root, name);
          }
        });
      }
    },

    confirmDelete: function (root, name) {
      var self = this;
      openDialog(root, {
        title: 'Delete Workspace',
        bodyHtml: '<p>Are you sure you want to delete workspace "' + V6OF.escapeHtml(name) + '"? This action cannot be undone.</p>',
        isDanger: true,
        onConfirm: function() {
          var wList = getWorkspaces();
          delete wList[name];
          saveWorkspaces(wList);
          if (getActiveName() === name) {
            var remaining = Object.keys(wList);
            setActiveName(remaining[0] || 'Scalping');
          }
          self.renderSelector(root);
          var active = getActiveName();
          self.applyWorkspace(root, active, getWorkspaces()[active]);
          self.openWorkspaceManagementDialog(root);
        },
        onCancel: function() {
          self.openWorkspaceManagementDialog(root);
        }
      });
    },

    promptRename: function (root, oldName) {
      var self = this;
      openDialog(root, {
        title: 'Rename Workspace',
        showInput: true,
        defaultValue: oldName,
        validateFn: function(val) {
          if (!val) return 'Name cannot be empty';
          val = val.trim();
          if (!val) return 'Name cannot be empty';
          if (val === oldName) return 'Enter a new name';
          var wList = getWorkspaces();
          if (wList[val]) return 'Workspace "' + val + '" already exists';
          if (val.length > 25) return 'Name too long (max 25 chars)';
          return null;
        },
        onConfirm: function(val) {
          val = val.trim();
          var wList = getWorkspaces();
          wList[val] = wList[oldName];
          delete wList[oldName];
          saveWorkspaces(wList);
          if (getActiveName() === oldName) {
            setActiveName(val);
          }
          self.renderSelector(root);
          self.openWorkspaceManagementDialog(root);
        },
        onCancel: function() {
          self.openWorkspaceManagementDialog(root);
        }
      });
    },

    promptDuplicate: function (root, oldName) {
      var self = this;
      openDialog(root, {
        title: 'Duplicate Workspace',
        showInput: true,
        defaultValue: oldName + ' Copy',
        validateFn: function(val) {
          if (!val) return 'Name cannot be empty';
          val = val.trim();
          if (!val) return 'Name cannot be empty';
          var wList = getWorkspaces();
          if (wList[val]) return 'Workspace "' + val + '" already exists';
          if (val.length > 25) return 'Name too long (max 25 chars)';
          return null;
        },
        onConfirm: function(val) {
          val = val.trim();
          var wList = getWorkspaces();
          wList[val] = Object.assign({}, wList[oldName]);
          saveWorkspaces(wList);
          setActiveName(val);
          self.renderSelector(root);
          self.applyWorkspace(root, val, wList[val]);
        },
        onCancel: function() {
          self.openWorkspaceManagementDialog(root);
        }
      });
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
        rightColWidth: rightCol ? rightCol.offsetWidth : 430,
        cvdStripHeight: cvdStrip ? cvdStrip.offsetHeight : 226,
        maxTrades: settings.maxTrades || 5000,
        activeTab: activeTab
      };
      saveWorkspaces(wList);
    },

    applyWorkspace: function (root, name, config) {
      if (!V6OF.store || !config) return;

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
        maxTrades: config.maxTrades || 5000
      });

      if (V6OF.ResizablePanels) {
        V6OF.ResizablePanels.restoreSizes(root, config.rightColWidth, config.cvdStripHeight);
      }

      var rbody = root.querySelector('[data-v6-rbody]');
      if (rbody && config.activeTab) {
        rbody.className = 'v6-rbody show-' + config.activeTab;
        var rtabs = root.querySelectorAll('[data-v6-rtab]');
        Array.prototype.forEach.call(rtabs, function (tab) {
          tab.classList.toggle('is-active', tab.getAttribute('data-v6-rtab') === config.activeTab);
        });
      }

      var cv = root.querySelector('[data-v6-chart]');
      if (cv && V6OF.CanvasChart && V6OF.store) {
        requestAnimationFrame(function () {
          V6OF.CanvasChart.draw(cv, V6OF.store.getState());
        });
      }
    }
  };
})();
