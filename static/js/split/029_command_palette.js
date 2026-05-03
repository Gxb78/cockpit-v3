// ---------- Command Palette ----------

var _cmdkLastFocused = null;
var _cmdkDelegationBound = false;

function _bindCmdkDelegation() {
  if (_cmdkDelegationBound) return;
  var parent = $("#cmdkResults");
  if (!parent) return;
  _cmdkDelegationBound = true;
  parent.addEventListener("click", function (e) {
    var item = e.target.closest(".cmdk-item");
    if (!item) return;
    var idx = Number(item.dataset.idx);
    var it = state.cmdkResults[idx];
    if (it) it.run();
  });
  parent.addEventListener("mouseenter", function (e) {
    var item = e.target.closest(".cmdk-item");
    if (!item) return;
    state.cmdkActiveIdx = Number(item.dataset.idx);
    highlightCmdk();
  }, true);
}

function bindCmdk() {
  _bindCmdkDelegation();
  const input = $("#cmdkInput");
  var _cmdkTimer;
  input.addEventListener("input", function () {
    clearTimeout(_cmdkTimer);
    _cmdkTimer = setTimeout(function () { renderCmdkResults(input.value); }, 150);
  });
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { e.preventDefault(); moveCmdk(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); moveCmdk(-1); }
    else if (e.key === "Enter") { e.preventDefault(); execCmdk(); }
    else if (e.key === "Tab") { e.preventDefault(); moveCmdk(e.shiftKey ? -1 : 1); }
  });
  $("#cmdk").addEventListener("click", e => { if (e.target.id === "cmdk") closeCmdk(); });
  document.addEventListener("keydown", function _cmdkTrap(e) {
    if (e.key !== "Tab" || !state.cmdkOpen) return;
    var container = $("#cmdk");
    if (!container || container.classList.contains("hidden")) return;
    var focusable = container.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    if (e.shiftKey && document.activeElement === focusable[0]) {
      e.preventDefault();
      focusable[focusable.length - 1].focus();
    } else if (!e.shiftKey && document.activeElement === focusable[focusable.length - 1]) {
      e.preventDefault();
      focusable[0].focus();
    }
  });
}

function openCmdk() {
  _cmdkLastFocused = document.activeElement;
  state.cmdkOpen = true;
  $("#cmdk").classList.remove("hidden");
  const input = $("#cmdkInput");
  input.value = "";
  setTimeout(() => input.focus(), 50);
  renderCmdkResults("");
}

function closeCmdk() {
  state.cmdkOpen = false;
  $("#cmdk").classList.add("hidden");
  if (_cmdkLastFocused) {
    _cmdkLastFocused.focus();
    _cmdkLastFocused = null;
  }
}

function buildCmdkItems(query) {
  const q = (query || "").trim().toLowerCase();
  const items = [];
  const actions = [
    { kind:"action", label:"Nouveau trade (aujourd'hui)", icon:"plus", run:()=>{ closeCmdk(); wizOpen({ date: todayKey() }); }},
    { kind:"action", label:"Aller a Today",                 icon:"home", run:()=>{ closeCmdk(); goPage("today"); }},
    { kind:"action", label:"Journal (calendrier)",          icon:"cal",  run:()=>{ closeCmdk(); goPage("journal"); }},
    { kind:"action", label:"Journal en vue semaine",        icon:"cal",  run:()=>{ closeCmdk(); goPage("journal"); setJournalViewMode("week", { persist:true, reload:true }); }},
    { kind:"action", label:"Journal en vue mois",           icon:"cal",  run:()=>{ closeCmdk(); goPage("journal"); setJournalViewMode("month", { persist:true, reload:true }); }},
    
    { kind:"action", label:"Ouvrir Settings",               icon:"gear", run:()=>{ closeCmdk(); goPage("settings"); }},
    { kind:"action", label:"Exporter en JSON",              icon:"down", run:()=>{ closeCmdk(); $("#exportBtn").click(); }},
  ];
  ["ALL","BTC","ETH","NQ","ES"].forEach(i =>
    actions.push({ kind:"action", label: i === "ALL" ? "Filtrer : tous" : `Filtrer : ${i}`, icon:"filter",
      run:()=>{ closeCmdk(); document.querySelector(`.instr-chip[data-instr="${i}"]`)?.click(); }})
  );

  const matchedActions = q
    ? actions.filter(a => a.label.toLowerCase().includes(q))
    : actions.slice(0, 6);
  matchedActions.forEach(a => items.push(a));

  const matchedDays = q
    ? state.allDays.filter(d => {
        const hay = [d.date, d.instrument, d.htf_context, d.daily_notes,
          ...(d.trades || []).flatMap(t => [t.why_trade, t.scenario, t.strategy])
        ].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      }).slice(0, 12)
    : state.allDays.slice(0, 6);

  matchedDays.forEach(d => {
    const trades = d.trades || [];
    const summary = trades[0]?.why_trade || trades[0]?.scenario || d.htf_context || "-";
    items.push({
      kind:"entry",
      icon:"doc",
      label: `${d.instrument} - ${d.date}`,
      meta: summary.slice(0, 60),
      run: ()=>{ closeCmdk(); openExistingDay(d); },
    });
  });
  return items;
}

function renderCmdkResults(query) {
  const items = buildCmdkItems(query);
  state.cmdkResults = items;
  state.cmdkActiveIdx = 0;
  const c = $("#cmdkResults");
  c.innerHTML = "";
  if (items.length === 0) {
    c.innerHTML = `<div class="cmdk-empty">Aucun resultat pour "${escapeHtml(query)}"</div>`;
    return;
  }
  const groups = { action:[], entry:[] };
  items.forEach((it, idx) => groups[it.kind]?.push({ ...it, idx }));
  if (groups.action.length) {
    c.insertAdjacentHTML("beforeend", `<div class="cmdk-section">Actions</div>`);
    groups.action.forEach(it => c.appendChild(cmdkItemEl(it)));
  }
  if (groups.entry.length) {
    c.insertAdjacentHTML("beforeend", `<div class="cmdk-section">Entrees</div>`);
    groups.entry.forEach(it => c.appendChild(cmdkItemEl(it)));
  }
  highlightCmdk();
}

function cmdkItemEl(it) {
  const el = document.createElement("div");
  el.className = "cmdk-item";
  el.dataset.idx = it.idx;
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "-1");
  el.innerHTML = `
    <div class="icon">${cmdkIcon(it.icon)}</div>
    <div class="label">${escapeHtml(it.label)}</div>
    ${it.meta ? `<div class="meta">${escapeHtml(it.meta)}</div>` : ""}
  `;
  return el;
}

function cmdkIcon(name) {
  const icons = {
    plus:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
    home:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    cal:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
    chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
    gear:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .33 1.76l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.6 1.6 0 0 0 15 19.4a1.6 1.6 0 0 0-1 .6 1.6 1.6 0 0 1-2 0 1.6 1.6 0 0 0-1-.6 1.6 1.6 0 0 0-1.76.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 4.6 15a1.6 1.6 0 0 0-.6-1 1.6 1.6 0 0 1 0-2 1.6 1.6 0 0 0 .6-1 1.6 1.6 0 0 0-.33-1.76l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 9 4.6a1.6 1.6 0 0 0 1-.6 1.6 1.6 0 0 1 2 0 1.6 1.6 0 0 0 1 .6 1.6 1.6 0 0 0 1.76-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.6 1.6 0 0 0 19.4 9a1.6 1.6 0 0 0 .6 1 1.6 1.6 0 0 1 0 2 1.6 1.6 0 0 0-.6 1z"/></svg>`,
    down:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
    filter:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>`,
    doc:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  };
  return icons[name] || icons.doc;
}

function moveCmdk(delta) {
  const max = state.cmdkResults.length;
  if (!max) return;
  state.cmdkActiveIdx = (state.cmdkActiveIdx + delta + max) % max;
  highlightCmdk();
}

function highlightCmdk() {
  $$("#cmdkResults .cmdk-item").forEach(el =>
    el.classList.toggle("active", Number(el.dataset.idx) === state.cmdkActiveIdx)
  );
  document.querySelector("#cmdkResults .cmdk-item.active")?.scrollIntoView({ block:"nearest" });
}

function execCmdk() {
  state.cmdkResults[state.cmdkActiveIdx]?.run();
}
