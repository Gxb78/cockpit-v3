function loadBreakdownSortMode() {
  try {
    const raw = localStorage.getItem(BREAKDOWN_SORT_KEY);
    return BREAKDOWN_SORT_MODES.has(raw) ? raw : _state.breakdownSortMode;
  } catch {
    return _state.breakdownSortMode;
  }
}

function updateBreakdownSortUI() {
  const select = $("#breakdownSort");
  if (!select) return;
  select.value = state.breakdownSortMode || "count";
}

function setBreakdownSortMode(mode, opts = {}) {
  const { persist = true, rerender = true } = opts;
  if (!BREAKDOWN_SORT_MODES.has(mode)) return;
  state.breakdownSortMode = mode;
  updateBreakdownSortUI();
  if (persist) { localStorage.setItem(BREAKDOWN_SORT_KEY, mode); saveUiState(); }
  if (rerender && state.currentPage === "insights") renderPerformance();
}

function bindBreakdownSort() {
  const select = $("#breakdownSort");
  if (!select) return;
  select.addEventListener("change", () => {
    setBreakdownSortMode(select.value, { persist: true, rerender: true });
  });
}

