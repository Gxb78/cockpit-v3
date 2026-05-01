function prettify(s) {
  return STRATEGY_LABELS[s] || String(s).replace(/_/g," ").replace(/\b\w/g, c => c.toUpperCase());
}

function defaultSettingsState() {
  return {
    profile: { pseudo: "trader" },
    custom_strategies: [],
    custom_tags: [],
    preferences: { animations: true, dark_mode: true },
  };
}

function normalizeStrategyValue(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function uniqueStrategyValue(label, takenValues) {
  const base = normalizeStrategyValue(label) || "custom_strategy";
  if (!takenValues.has(base)) return base;
  let i = 2;
  while (takenValues.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

function normalizeCustomStrategies(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  const taken = new Set(DEFAULT_STRATEGY_VALUES);
  rawList.forEach(item => {
    const label = (typeof item === "string" ? item : item?.label || "").trim();
    if (!label) return;
    const preferred = normalizeStrategyValue(typeof item === "object" ? item?.value : "");
    const value = preferred && !taken.has(preferred) ? preferred : uniqueStrategyValue(label, taken);
    taken.add(value);
    out.push({ value, label });
  });
  return out;
}

function sanitizeSettings(raw) {
  const defaults = defaultSettingsState();
  const pseudo = String(raw?.profile?.pseudo || "").trim();
  return {
    profile: {
      pseudo: pseudo || defaults.profile.pseudo,
    },
    custom_strategies: normalizeCustomStrategies(raw?.custom_strategies),
    custom_tags: raw?.custom_tags || [],
    preferences: {
      animations: typeof raw?.preferences?.animations === "boolean"
        ? raw.preferences.animations
        : defaults.preferences.animations,
      dark_mode: typeof raw?.preferences?.dark_mode === "boolean"
        ? raw.preferences.dark_mode
        : defaults.preferences.dark_mode,
    },
  };
}

function loadSettingsState() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}");
    // Migration: ancien localStorage["theme"] -> preferences.dark_mode
    if (raw.preferences?.dark_mode === undefined) {
      try {
        const legacyTheme = localStorage.getItem("theme");
        if (legacyTheme === "light") raw.preferences = raw.preferences || {};
        if (legacyTheme === "light") raw.preferences.dark_mode = false;
      } catch (_) {}
    }
    return sanitizeSettings(raw);
  } catch {
    return defaultSettingsState();
  }
}

function saveSettingsState() {
  if (!state.settings) return;
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state.settings));
}

function applyProfileSetting() {
  const pseudo = state.settings?.profile?.pseudo || "trader";
  const greeting = $("#todayGreeting");
  if (greeting) greeting.textContent = pseudo;
}

function applyVisualSettings() {
  const prefersDark = state.settings?.preferences?.dark_mode !== false;
  const prefersAnimations = state.settings?.preferences?.animations !== false;
  document.body.classList.toggle("light-mode", !prefersDark);
  document.body.classList.toggle("reduce-motion", !prefersAnimations);
}

function syncStrategyLabels() {
  Object.keys(STRATEGY_LABELS).forEach(key => {
    if (!DEFAULT_STRATEGY_VALUES.includes(key)) delete STRATEGY_LABELS[key];
  });
  (state.settings?.custom_strategies || []).forEach(s => {
    STRATEGY_LABELS[s.value] = s.label;
  });
}

function findPillByValue(container, value) {
  return [...container.querySelectorAll(".pill-choice")].find(btn => btn.dataset.value === value);
}

function appendStrategyPill(container, strategy, opts = {}) {
  if (!container || !strategy?.value) return null;
  if (findPillByValue(container, strategy.value)) return null;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "pill-choice custom-strategy-pill";
  btn.dataset.value = strategy.value;
  if (opts.custom) btn.dataset.customStrategy = "1";
  if (opts.dynamic) btn.dataset.dynamicStrategy = "1";
  btn.textContent = strategy.label || prettify(strategy.value);
  container.appendChild(btn);
  return btn;
}

function syncStrategyPillsFromSettings() {
  const container = document.querySelector(`.pills[data-pills="strategy"]`);
  if (!container) return;
  const currentValue = getPill("strategy");
  container.querySelectorAll(".pill-choice[data-custom-strategy='1']").forEach(btn => btn.remove());
  container.querySelectorAll(".pill-choice[data-dynamic-strategy='1']").forEach(btn => btn.remove());
  (state.settings?.custom_strategies || []).forEach(s => {
    appendStrategyPill(container, s, { custom: true });
  });
  if (currentValue) setPill("strategy", currentValue);
}

function applySettingsState() {
  if (!state.settings) return;
  applyProfileSetting();
  applyVisualSettings();
  syncStrategyLabels();
  syncStrategyPillsFromSettings();
}

function renderSettingsStrategies() {
  const list = $("#settingsStrategiesList");
  if (!list) return;
  const strategies = state.settings?.custom_strategies || [];
  if (!strategies.length) {
    list.innerHTML = `<div class="settings-empty">Aucune stratégie custom pour l'instant.</div>`;
    return;
  }
  list.innerHTML = strategies.map(s => `
    <span class="settings-chip">
      <span>${escapeHtml(s.label)}</span>
      <button type="button" class="settings-chip-remove" data-remove-strategy="${escapeHtml(s.value)}" title="Supprimer">x</button>
    </span>
  `).join("");
}

function renderSettingsTags() {
  const list = $("#settingsTagsList");
  if (!list) return;
  const tags = state.settings?.custom_tags || [];
  if (!tags.length) {
    list.innerHTML = '<div class="settings-empty">Aucun tag custom pour l\'instant.</div>';
    return;
  }
  list.innerHTML = tags.map(function(t) {
    return '<span class="settings-chip">' +
      '<span>' + escapeHtml(t) + '</span>' +
      '<button type="button" class="settings-chip-remove" data-remove-tag="' + escapeHtml(t) + '" title="Supprimer">x</button>' +
      '</span>';
  }).join("");
}

function renderSettingsPage() {
  if (!state.settings) return;
  const pseudo = $("#settingsPseudo");
  const prefAnimations = $("#prefAnimations");
  const prefDarkMode = $("#prefDarkMode");
  if (pseudo) pseudo.value = state.settings.profile?.pseudo || "";
  if (prefAnimations) prefAnimations.checked = state.settings.preferences?.animations !== false;
  if (prefDarkMode) prefDarkMode.checked = state.settings.preferences?.dark_mode !== false;
  renderSettingsStrategies();
  renderSettingsTags();
}

function saveProfileSettings() {
  const input = $("#settingsPseudo");
  if (!input || !state.settings) return;
  const pseudo = input.value.trim() || "trader";
  state.settings.profile.pseudo = pseudo;
  saveSettingsState();
  applySettingsState();
  toast("Profil mis à jour ✓", "success");
}

