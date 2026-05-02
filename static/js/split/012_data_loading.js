// ---------- Data loading ----------

/**
 * Charge toutes les donnees (mois, tous les jours, stats) et rend la page courante.
 * Appele au demarrage et apres chaque modification de donnees.
 */
async function loadAll() {
  loading(true);
  try {
    // 1. Mois en priorite — affiche le calendrier + Today tout de suite
    await loadMonth();
    renderToday();
    // 2. Puis le reste en parallele (allDays + stats)
    await Promise.all([
      loadAllDays(),
      loadStats({ refreshDays: false, skipRender: true }),
    ]);
    if (state.currentPage === "today") renderToday();
    if (state._stats) renderKPIs(state._stats);
    if (state.currentPage === "stats") renderPerformance();
  } finally {
    loading(false);
  }
}

/**
 * Charge les jours du mois/periode courant.
 * @returns {Promise<void>}
 */
async function loadMonth() {
  try {
    const windowDef = getJournalWindow();
    const qs = new URLSearchParams();
    if (windowDef.from) qs.set("from", windowDef.from);
    if (windowDef.to) qs.set("to", windowDef.to);
    if (state.statsInstrument !== "ALL") qs.set("instrument", state.statsInstrument);
    state.days = await api(`/api/days?${qs}`);
    renderCalendar(windowDef);
  } catch (e) { toast(e.message, "error"); }
}

/**
 * Charge tous les jours (utilise pour la recherche et la page Today).
 * @returns {Promise<void>}
 */
async function loadAllDays() {
  try {
    const qs = new URLSearchParams();
    if (state.statsInstrument !== "ALL") qs.set("instrument", state.statsInstrument);
    state.allDays = await api(`/api/days?${qs}`);
  } catch (e) { toast(e.message || "Erreur chargement jours", "error"); }
}

/**
 * Charge les statistiques depuis /api/stats.
 * @param {Object} [opts]
 * @param {boolean} [opts.refreshDays=true] - Recharger allDays avant les stats
 * @param {boolean} [opts.skipRender=false] - Ne pas mettre a jour les KPIs
 * @returns {Promise<void>}
 */
async function loadStats(opts = {}) {
  const { refreshDays = true, skipRender = false } = opts;
  loading(true);
  try {
    if (refreshDays) await loadAllDays();
    const qs = new URLSearchParams();
    if (state.statsInstrument !== "ALL") qs.set("instrument", state.statsInstrument);
    const s = await api(`/api/stats?${qs}`);
    state._stats = s;
    if (!skipRender) renderKPIs(s);
  } catch (e) { toast(e.message || "Erreur chargement stats", "error"); }
  finally { loading(false); }
}

