// 089_v6_workspace_manager.js
// Workspace manager: visual workspace profiles (DOM, Tape, CVD, Heatmap, sizes, buffers).
// Manages visual workspace profiles (DOM, Tape, CVD, Heatmap, sizes, and buffers).
// Stores profiles in localStorage key 'cockpitV6.workspaces' and 'cockpitV6.activeWorkspace'.
// Server sync via user_settings key 'v6_workspaces' (debounced 2s POST, merge on load).
// JSON export/import with schemaVersion migrators.

(function () {
  'use strict';
  var V6OF = window.V6OF = window.V6OF || {};
  if (!V6OF.register) {
    ['Core', 'Data', 'Transport', 'UI', 'Studies', 'Page'].forEach(function (name) { V6OF[name] = V6OF[name] || {}; });
    V6OF.register = function (domain, name, value, legacyName) {
      V6OF[domain] = V6OF[domain] || {};
      V6OF[domain][name] = value;
      if (legacyName) V6OF[legacyName] = value;
      return value;
    };
  }

  var WORKSPACES_KEY = 'cockpitV6.workspaces';
  var ACTIVE_KEY = 'cockpitV6.activeWorkspace';
  var WORKSPACE_SCHEMA_VERSION = 1;
  var _wsSyncTimer = null;
  var _lastWorkspaceSyncJson = '';
  var _pendingWorkspaceSyncJson = '';

  var LAYER_PRESETS = {
    scalping: {
      chartMode: 'both',
      showOhlc: true,
      showCandles: true,
      showBubbles: true,
      showHeatmap: false,
      showFootprint: false
    },
    orderflow: {
      chartMode: 'both',
      showOhlc: true,
      showCandles: true,
      showBubbles: false,
      showHeatmap: false,
      showFootprint: true
    },
    analysis: {
      chartMode: 'both',
      showOhlc: true,
      showCandles: true,
      showBubbles: false,
      showHeatmap: true,
      showFootprint: false
    }
  };

  function layerPresetForWorkspace(name) {
    if (name === 'Orderflow') return 'orderflow';
    if (name === 'Analysis') return 'analysis';
    return 'scalping';
  }

  function resolveLayerPreset(name, config) {
    var preset = config && config.layerPreset;
    if (preset === 'custom') return 'custom';
    if (!LAYER_PRESETS[preset]) preset = layerPresetForWorkspace(name);
    return preset;
  }

  function applyLayerPresetConfig(target, preset) {
    var layers = LAYER_PRESETS[preset] || LAYER_PRESETS.scalping;
    return Object.assign(target || {}, layers, { layerPreset: preset });
  }

  var DEFAULT_PRESETS = {
    'Scalping': {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      layerPreset: 'scalping',
      chartMode: 'both',
      showTape: true,
      showDOM: true,
      showCVD: false,
      showVwap: true,
      showOhlc: true,
      showCandles: true,
      showBubbles: true,
      showHeatmap: false,
      showFootprint: false,
      rightColWidth: 430,
      leftColWidth: 320,
      cvdStripHeight: 226,
      maxTrades: 5000,
      activeTab: 'dom',
      activeLeftTab: '',
      layoutSchema: null
    },
    'Orderflow': {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      layerPreset: 'orderflow',
      chartMode: 'both',
      showTape: false,
      showDOM: true,
      showCVD: true,
      showVwap: true,
      showOhlc: true,
      showCandles: true,
      showBubbles: false,
      showHeatmap: false,
      showFootprint: true,
      rightColWidth: 460,
      leftColWidth: 320,
      cvdStripHeight: 260,
      maxTrades: 10000,
      activeTab: 'dom',
      activeLeftTab: '',
      layoutSchema: null
    },
    'Analysis': {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      layerPreset: 'analysis',
      chartMode: 'both',
      showTape: true,
      showDOM: false,
      showCVD: true,
      showVwap: true,
      showOhlc: true,
      showCandles: true,
      showBubbles: false,
      showHeatmap: true,
      showFootprint: false,
      rightColWidth: 480,
      leftColWidth: 320,
      cvdStripHeight: 240,
      maxTrades: 5000,
      activeTab: 'info',
      activeLeftTab: '',
      layoutSchema: null
    }
  };

  function cloneWorkspaces(list) {
    var out = {};
    Object.keys(list || {}).forEach(function (name) {
      if (list[name] && typeof list[name] === 'object') {
        out[name] = Object.assign({}, list[name]);
      }
    });
    return out;
  }

  function normalizeWorkspaceConfig(config) {
    var c = Object.assign({}, config || {});
    c.schemaVersion = WORKSPACE_SCHEMA_VERSION;
    if (LAYER_PRESETS[c.layerPreset]) {
      applyLayerPresetConfig(c, c.layerPreset);
    }
    return c;
  }

  function normalizeWorkspaceList(list) {
    var out = {};
    Object.keys(list || {}).forEach(function (name) {
      if (list[name] && typeof list[name] === 'object') {
        out[name] = normalizeWorkspaceConfig(list[name]);
      }
    });
    return Object.assign({}, cloneWorkspaces(DEFAULT_PRESETS), out);
  }

  var WORKSPACE_MIGRATORS = {
    0: function (payload) {
      var list = payload && payload.list && typeof payload.list === 'object' ? payload.list : {};
      return {
        schemaVersion: 1,
        list: normalizeWorkspaceList(list)
      };
    }
  };

  function migrateWorkspacePayload(raw) {
    var payload = raw && typeof raw === 'object' ? raw : {};
    if (!payload.list || typeof payload.list !== 'object') {
      payload = { schemaVersion: payload.schemaVersion || payload._v || 0, list: payload };
    }
    var version = Number(payload.schemaVersion || payload._v || 0);
    if (!Number.isFinite(version) || version < 0) version = 0;
    payload = {
      schemaVersion: version,
      list: payload.list && typeof payload.list === 'object' ? payload.list : {}
    };
    while (payload.schemaVersion < WORKSPACE_SCHEMA_VERSION) {
      var migrator = WORKSPACE_MIGRATORS[payload.schemaVersion];
      if (typeof migrator !== 'function') {
        payload.schemaVersion = WORKSPACE_SCHEMA_VERSION;
        payload.list = normalizeWorkspaceList(payload.list);
        break;
      }
      payload = migrator(payload);
    }
    payload.schemaVersion = WORKSPACE_SCHEMA_VERSION;
    payload.list = normalizeWorkspaceList(payload.list);
    return payload;
  }

  function workspaceEnvelope(list) {
    return {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      list: normalizeWorkspaceList(list)
    };
  }

  function saveWorkspaceEnvelope(payload, shouldSync) {
    var migrated = migrateWorkspacePayload(payload);
    try {
      localStorage.setItem(WORKSPACES_KEY, JSON.stringify(migrated));
    } catch (_) {}
    if (shouldSync !== false) syncWorkspacesToServer();
    return migrated;
  }

  function getWorkspaces() {
    try {
      var raw = localStorage.getItem(WORKSPACES_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        var migrated = migrateWorkspacePayload(parsed);
        if (JSON.stringify(parsed) !== JSON.stringify(migrated)) {
          saveWorkspaceEnvelope(migrated, false);
        }
        return migrated.list;
      }
    } catch (_) {}
    return normalizeWorkspaceList(DEFAULT_PRESETS);
  }

  function saveWorkspaces(w) {
    saveWorkspaceEnvelope(workspaceEnvelope(w), true);
  }

  function syncWorkspacesToServer() {
    var payload = {
      v6_workspaces: {
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        active: getActiveName(),
        list: getWorkspaces()
      }
    };
    var payloadJson = JSON.stringify(payload);
    if (!payloadJson || payloadJson === _lastWorkspaceSyncJson || payloadJson === _pendingWorkspaceSyncJson) return;
    _pendingWorkspaceSyncJson = payloadJson;
    clearTimeout(_wsSyncTimer);
    _wsSyncTimer = setTimeout(function() {
      var body = _pendingWorkspaceSyncJson;
      _pendingWorkspaceSyncJson = '';
      if (!body || body === _lastWorkspaceSyncJson) return;
      fetch("/api/user/workspace-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: body
      }).then(function(r) {
        if (r && r.ok) _lastWorkspaceSyncJson = body;
      }).catch(function() {});
    }, 2000);
  }

  function loadWorkspacesFromServer(callback) {
    fetch("/api/user/workspace-profile", { credentials: "same-origin" })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(data) {
        if (!data || !data.workspace_profile || !data.workspace_profile.v6_workspaces) return;
        var serverWs = data.workspace_profile.v6_workspaces;
        if (!serverWs || typeof serverWs !== "object") return;
        var migratedServer = migrateWorkspacePayload(serverWs);
        _lastWorkspaceSyncJson = JSON.stringify({
          v6_workspaces: {
            schemaVersion: WORKSPACE_SCHEMA_VERSION,
            active: serverWs.active || migratedServer.active || getActiveName(),
            list: migratedServer.list
          }
        });
        // Only apply if localStorage is empty (new machine)
        if (!localStorage.getItem(WORKSPACES_KEY)) {
          if (migratedServer.list && typeof migratedServer.list === "object") {
            saveWorkspaceEnvelope(migratedServer, false);
          }
          if (serverWs.active && typeof serverWs.active === "string") {
            localStorage.setItem(ACTIVE_KEY, serverWs.active);
          }
        }
        if (callback) callback();
      })
      .catch(function() {});
  }

  function exportWorkspacesJSON() {
    var data = {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      active: getActiveName(),
      list: getWorkspaces()
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "cockpit-workspaces-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importWorkspacesJSON(root) {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.addEventListener("change", function() {
      var file = input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function(e) {
        try {
          var imported = JSON.parse(e.target.result);
          var hasWorkspaceList = imported && imported.list && typeof imported.list === "object";
          var hasFlatWorkspaces = imported && typeof imported === "object" && Object.keys(imported).some(function (key) {
            return imported[key] && typeof imported[key] === "object" && key !== "list";
          });
          if (!hasWorkspaceList && !hasFlatWorkspaces) {
            throw new Error("Invalid format");
          }
          imported = migrateWorkspacePayload(imported);
          var current = getWorkspaces();
          // Merge: imported wins on conflict
          var merged = Object.assign({}, current, imported.list);
          saveWorkspaces(merged);
          if (imported.active && merged[imported.active]) {
            setActiveName(imported.active);
          }
          // Re-render
          var mgr = V6OF.UI.WorkspaceManager;
          mgr.renderSelector(root);
          var active = getActiveName();
          mgr.applyWorkspace(root, active, merged[active]);
          openDialog(root, {
            title: "Import Successful",
            bodyHtml: "<p>Imported " + Object.keys(imported.list).length + " workspace(s).</p>",
            onConfirm: function() {}
          });
        } catch (err) {
          openDialog(root, {
            title: "Import Failed",
            bodyHtml: "<p>The selected file is not a valid workspace export.</p>",
            onConfirm: function() {}
          });
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  function getActiveName() {
    return localStorage.getItem(ACTIVE_KEY) || 'Scalping';
  }

  function setActiveName(name) {
    localStorage.setItem(ACTIVE_KEY, name);
    syncWorkspacesToServer();
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

  V6OF.register('UI', 'WorkspaceManager', {
    init: function (root) {
      if (!root) return;
      var self = this;

      var proceed = function() {
        if (!localStorage.getItem(WORKSPACES_KEY)) {
          saveWorkspaceEnvelope(workspaceEnvelope(DEFAULT_PRESETS), false);
        }
        var active = getActiveName();
        var list = getWorkspaces();
        if (list[active]) {
          self.applyWorkspace(root, active, list[active]);
        } else {
          self.applyWorkspace(root, 'Scalping', DEFAULT_PRESETS['Scalping']);
        }
        self.renderSelector(root);
        // ── Bridge workspace into V6 store ──
        self._syncToStore(root);
      };

      if (localStorage.getItem(WORKSPACES_KEY)) {
        // Deja des donnees locales, pas besoin d'attendre le serveur
        proceed();
      } else {
        // Nouvelle machine : essayer le serveur d'abord
        loadWorkspacesFromServer(proceed);
      }
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
          '<button type="button" class="v6-workspace-btn" data-v6-workspace-action="export" title="Export all workspaces as JSON">Export</button>',
          '<button type="button" class="v6-workspace-btn" data-v6-workspace-action="import" title="Import workspaces from JSON file">Import</button>',
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
            self._syncToStore(root);
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

      var exportBtn = container.querySelector('[data-v6-workspace-action="export"]');
      if (exportBtn) {
        exportBtn.addEventListener('click', function () {
          exportWorkspacesJSON();
        });
      }

      var importBtn = container.querySelector('[data-v6-workspace-action="import"]');
      if (importBtn) {
        importBtn.addEventListener('click', function () {
          importWorkspacesJSON(root);
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
      var store = V6OF.getStore ? V6OF.getStore(root) : null;
      if (!store) return;
      var state = store.getState();
      var settings = state.settings || {};

      var leftCol = root.querySelector('[data-v6-left-col]');
      var rightCol = root.querySelector('.v6-right-col');
      var cvdStrip = root.querySelector('[data-v6-cvd-strip]');
      var lbody = root.querySelector('[data-v6-lbody]');
      var rbody = root.querySelector('[data-v6-rbody]');

      var activeTab = 'dom';
      if (rbody) {
        var m = rbody.className.match(/show-(\w+)/);
        if (m) activeTab = m[1];
      }

      var activeLeftTab = '';
      if (lbody) {
        var ml = lbody.className.match(/show-(\w+)/);
        if (ml) activeLeftTab = ml[1];
      }

      var layoutSchema = settings.layoutSchema || null;

      var wList = getWorkspaces();
      wList[name] = {
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        layerPreset: settings.layerPreset || (state.ui && state.ui.layerPreset) || 'custom',
        chartMode: settings.chartMode || 'both',
        showTape: settings.showTape !== false,
        showDOM: settings.showDOM !== false,
        showCVD: settings.showCVD !== false,
        showVwap: settings.showVwap !== false,
        showOhlc: settings.showOhlc !== false,
        showCandles: settings.showCandles !== false,
        showBubbles: settings.showBubbles !== false,
        showHeatmap: settings.showHeatmap === true,
        showFootprint: settings.showFootprint === true,
        rightColWidth: rightCol ? rightCol.offsetWidth : 430,
        leftColWidth: leftCol ? leftCol.offsetWidth : 320,
        cvdStripHeight: cvdStrip ? cvdStrip.offsetHeight : 226,
        maxTrades: settings.maxTrades || 5000,
        activeTab: activeTab,
        activeLeftTab: activeLeftTab,
        layoutSchema: layoutSchema
      };
      saveWorkspaces(wList);
    },

    applyWorkspace: function (root, name, config) {
      var store = V6OF.getStore ? V6OF.getStore(root) : null;
      if (!store || !config) return;
      var layerPreset = resolveLayerPreset(name, config);
      var layerConfig = layerPreset === 'custom' ? config : applyLayerPresetConfig({}, layerPreset);

      store.updateSettings({
        chartMode: layerConfig.chartMode || config.chartMode || 'both',
        showTape: config.showTape !== false,
        showDOM: config.showDOM !== false,
        showCVD: config.showCVD !== false,
        showVwap: config.showVwap !== false,
        showOhlc: layerConfig.showOhlc !== false,
        showCandles: layerConfig.showCandles !== false,
        showBubbles: layerConfig.showBubbles === true,
        showHeatmap: layerConfig.showHeatmap === true,
        showFootprint: layerConfig.showFootprint === true,
        maxTrades: config.maxTrades || 5000,
        layoutSchema: config.layoutSchema || null
      });
      if (store.updateUi) store.updateUi({ layerPreset: layerPreset });

      if (V6OF.ResizablePanels) {
        V6OF.ResizablePanels.restoreSizes(root, config.rightColWidth, config.cvdStripHeight, config.leftColWidth);
      }

      var rbody = root.querySelector('[data-v6-rbody]');
      if (rbody && config.activeTab) {
        rbody.className = 'v6-rbody show-' + config.activeTab;
        var rtabs = root.querySelectorAll('[data-v6-rtab]');
        Array.prototype.forEach.call(rtabs, function (tab) {
          tab.classList.toggle('is-active', tab.getAttribute('data-v6-rtab') === config.activeTab);
        });
      }

      var lbody = root.querySelector('[data-v6-lbody]');
      if (lbody && config.activeLeftTab) {
        lbody.className = 'v6-lbody show-' + config.activeLeftTab;
        var ltabs = root.querySelectorAll('[data-v6-ltab]');
        Array.prototype.forEach.call(ltabs, function (tab) {
          tab.classList.toggle('is-active', tab.getAttribute('data-v6-ltab') === config.activeLeftTab);
        });
      }

      var cv = root.querySelector('[data-v6-chart]');
      if (cv && V6OF.CanvasChart && store) {
        requestAnimationFrame(function () {
          V6OF.CanvasChart.draw(cv, store.getState());
        });
      }
    },

    // ── Bridge workspace state into the V6 orderflow store ──
    _syncToStore: function (root) {
      var store = V6OF.getStore ? V6OF.getStore(root) : null;
      if (!store) return;
      store.updateSlice('workspace', {
        activeWorkspace: getActiveName(),
        workspaceList: getWorkspaces()
      });
    }
  }, 'WorkspaceManager');
})();
