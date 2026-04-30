// ---------- Trade form ----------

const MM_INTERNAL_BLOCK_ID = "__mm_challenge__";
const MIDNIGHT_QUESTION_ORDER = [
  { key: "pre_open", id: "mmPreOpen", label: "1/10 Avant open: prix monte, baisse ou range ?" },
  { key: "open_behavior", id: "mmOpenBehavior", label: "2/10 A l'open: creation du high, creation du low, ou chop ?" },
  { key: "po3_state", id: "mmPo3State", label: "3/10 PO3: valide, partiel, ou invalide ?" },
  { key: "direction", id: "direction", label: "4/10 Direction executee: respecte-t-elle le plan ?" },
  { key: "stdv_level", id: "stdvLevel", label: "5/10 Quel niveau STDV a ete touche ?" },
  { key: "entry_trigger", id: "mmEntryTrigger", label: "6/10 Trigger d'entree: IFVG, breaker, ou les deux ?" },
  { key: "zone_rule", id: "mmZoneRule", label: "7/10 Regle 50% respectee ? (long=Discount, short=Premium)" },
  { key: "smt_state", id: "mmSmtState", label: "8/10 SMT confirmee au contact du STDV ?" },
  { key: "liquidity_target", id: "mmLiquidityTarget", label: "9/10 Quelle liquidite est ciblee en priorite ?" },
  { key: "counter_thesis", id: "mmCounterThesis", label: "10/10 Quelle est ta contre-these (1 phrase) ?" },
];

function isMidnightStrategySelected() {
  return getPill("strategy") === "midnight_model";
}

function syncDayContextMidnightVisibility() {
  const field = $("#midnightOpenField");
  if (!field) return;
  field.classList.toggle("hidden", !isMidnightStrategySelected());
}

function getMidnightCoachInputs() {
  return {
    pre_open: $("#mmPreOpen")?.value || "",
    open_behavior: $("#mmOpenBehavior")?.value || "",
    po3_state: $("#mmPo3State")?.value || "",
    entry_trigger: $("#mmEntryTrigger")?.value || "",
    zone_rule: $("#mmZoneRule")?.value || "",
    smt_state: $("#mmSmtState")?.value || "",
    liquidity_target: $("#mmLiquidityTarget")?.value || "",
    counter_thesis: ($("#mmCounterThesis")?.value || "").trim(),
  };
}

function getCurrentMidnightPlan() {
  return evaluateMidnightPlan({
    direction: getPill("direction"),
    stdv_level: numOrNull("stdvLevel"),
    coach: getMidnightCoachInputs(),
  });
}

function syncPlanDecisionUI(plan) {
  const hint = $("#planDirectionHint");
  const pill = $("#planAlignmentPill");
  const field = $("#planOverrideField");
  const ruleText = $("#po3RuleText");
  const direction = plan?.plan_direction;
  const alignment = plan?.plan_alignment || "incomplete";
  if (hint) hint.textContent = direction ? direction.toUpperCase() : "A definir par le Plan PO3";
  if (pill) {
    pill.textContent = `${planAlignmentLabel(alignment)}${plan?.plan_score != null ? " - " + plan.plan_score + "/100" : ""}`;
    pill.className = `plan-alignment-pill ${alignment}`;
  }
  if (field) field.classList.toggle("hidden", alignment !== "out_of_plan");
  if (ruleText) {
    ruleText.textContent = direction === "short"
      ? "Open haussier: chercher le high de la journee puis distribution short."
      : direction === "long"
        ? "Open baissier: chercher le low de la journee puis expansion long."
        : "Open haussier = chercher short. Open baissier = chercher long.";
  }
}

function resetMidnightChallenge() {
  [
    "mmPreOpen",
    "mmOpenBehavior",
    "mmPo3State",
    "mmEntryTrigger",
    "mmZoneRule",
    "mmSmtState",
    "mmLiquidityTarget",
    "mmCounterThesis",
  ].forEach((id) => {
    const el = $("#" + id);
    if (!el) return;
    el.value = "";
  });
  const status = $("#midnightCoachStatus");
  const next = $("#midnightCoachNextQuestion");
  const list = $("#midnightCoachChecklist");
  if (status) status.textContent = "";
  if (next) next.textContent = "";
  if (list) list.innerHTML = "";
  const override = $("#planOverrideReason");
  if (override) override.value = "";
  syncPlanDecisionUI({ plan_alignment: "incomplete", plan_score: null, plan_direction: null });
}

function evaluateMidnightChallenge() {
  const direction = getPill("direction");
  const stdvLevel = numOrNull("stdvLevel");
  const coach = getMidnightCoachInputs();
  const missing = [];
  const blockers = [];
  const warnings = [];
  const checks = [];
  const plan = getCurrentMidnightPlan();

  function miss(key, message) {
    missing.push({ key, message });
    checks.push({ tone: "bad", text: message });
  }
  function block(message) {
    blockers.push(message);
    checks.push({ tone: "bad", text: message });
  }
  function warn(message) {
    warnings.push(message);
    checks.push({ tone: "warn", text: message });
  }
  function ok(message) {
    checks.push({ tone: "ok", text: message });
  }

  if (!coach.pre_open) miss("pre_open", "Challenge 1: precise le contexte avant open.");
  else ok("OK - Avant open renseigne.");

  if (!coach.open_behavior) miss("open_behavior", "Challenge 2: indique la reaction de l'open.");
  else if (plan.plan_direction) ok(`OK - Plan PO3 attendu: ${plan.plan_direction.toUpperCase()}.`);
  else warn("Open indecis: plan PO3 incomplet.");

  if (!coach.po3_state) miss("po3_state", "Challenge 3: indique l'etat du PO3.");
  else if (coach.po3_state === "no") warn("PO3 invalide: challenge ton entree avant execution.");
  else ok("OK - Etat PO3 renseigne.");

  if (!direction) miss("direction", "Challenge 4: choisis la direction executee (long/short).");
  else ok(`OK - Direction executee: ${direction.toUpperCase()}.`);

  if (stdvLevel == null) miss("stdv_level", "Challenge 5: precise le niveau STDV touche.");
  else ok(`OK - STDV ${stdvLevel} renseigne.`);

  if (!coach.entry_trigger) miss("entry_trigger", "Challenge 6: precise le trigger d'entree.");
  else ok("OK - Trigger d'entree renseigne.");

  if (!coach.zone_rule) miss("zone_rule", "Challenge 7: indique la zone d'entree (Premium/Discount).");
  else if (coach.zone_rule === "invalid") block("Bloquant: entree hors regle 50% (Premium/Discount).");
  else ok("OK - Regle Premium/Discount renseignee.");

  if (!coach.smt_state) miss("smt_state", "Challenge 8: confirme la SMT au contact du STDV.");
  else if (coach.smt_state === "none") warn("Pas de SMT: confluence plus faible.");
  else ok("OK - SMT renseignee.");

  if (!coach.liquidity_target) miss("liquidity_target", "Challenge 9: precise la liquidite ciblee.");
  else ok("OK - Liquidite ciblee renseignee.");

  if (!coach.counter_thesis || coach.counter_thesis.length < 10) {
    miss("counter_thesis", "Challenge 10: ecris une contre-these claire (1 phrase).");
  } else {
    ok("OK - Contre-these renseignee.");
  }

  (plan.plan_errors || []).forEach((code) => block(PLAN_ERROR_LABELS[code] || code));
  (plan.plan_warnings || [])
    .filter((code) => code !== "plan_incomplete")
    .forEach((code) => warn(PLAN_WARNING_LABELS[code] || code));

  const questionMap = Object.fromEntries(MIDNIGHT_QUESTION_ORDER.map((item) => [item.key, item]));
  const firstMissing = missing[0] || null;
  const nextQuestion = firstMissing
    ? `${questionMap[firstMissing.key]?.label || firstMissing.key}`
    : blockers.length
      ? `Corrige d'abord: ${blockers[0]}`
      : warnings.length
        ? `Point de vigilance: ${warnings[0]}`
        : "Challenge rapide termine: setup coherent.";

  const score = Math.min(plan.plan_score ?? 100, Math.max(0, 100 - (missing.length * 8) - (blockers.length * 14) - (warnings.length * 5)));
  return { direction, stdvLevel, coach, plan, missing, blockers, warnings, checks, score, nextQuestion };
}

function renderMidnightChallenge() {
  const block = $("#midnightCoachBlock");
  if (!block) return;
  const active = isMidnightStrategySelected();
  syncDayContextMidnightVisibility();
  block.classList.toggle("hidden", !active);
  if (!active) {
    if (typeof refreshTradeFlowNavState === "function") refreshTradeFlowNavState();
    return;
  }

  const evals = evaluateMidnightChallenge();
  const status = $("#midnightCoachStatus");
  const next = $("#midnightCoachNextQuestion");
  const list = $("#midnightCoachChecklist");

  if (status) {
    const tone = evals.blockers.length || evals.missing.length > 2
      ? "bad"
      : evals.warnings.length
        ? "warn"
        : "good";
    status.className = `midnight-coach-status ${tone}`;
    status.innerHTML = `<span class="midnight-coach-score">${Math.round(evals.score)}/100</span>
      <span>${evals.missing.length} a completer, ${evals.blockers.length} bloquant(s), ${evals.warnings.length} vigilance(s)</span>`;
  }

  if (next) {
    next.innerHTML = `<strong>Challenge rapide - prochaine question:</strong> ${escapeHtml(evals.nextQuestion)}`;
  }
  syncPlanDecisionUI(evals.plan);

  if (list) {
    list.innerHTML = evals.checks.slice(0, 10).map((item) =>
      `<li class="${item.tone}"><span class="midnight-coach-bullet"></span><span>${escapeHtml(item.text)}</span></li>`
    ).join("");
  }
  if (typeof refreshTradeFlowNavState === "function") refreshTradeFlowNavState();
}

function hydrateMidnightChallengeFromSnapshot(snapshotContent) {
  if (!snapshotContent) return;
  let parsed = null;
  try {
    parsed = JSON.parse(snapshotContent);
  } catch (_) {
    return;
  }
  if (!parsed || !parsed.coach) return;
  const coach = parsed.coach;
  const map = {
    mmPreOpen: coach.pre_open,
    mmOpenBehavior: coach.open_behavior,
    mmPo3State: coach.po3_state,
    mmEntryTrigger: coach.entry_trigger,
    mmZoneRule: coach.zone_rule,
    mmSmtState: coach.smt_state,
    mmLiquidityTarget: coach.liquidity_target,
    mmCounterThesis: coach.counter_thesis,
  };
  Object.entries(map).forEach(([id, value]) => {
    const el = $("#" + id);
    if (!el || value == null) return;
    el.value = value;
  });
}

function buildMidnightCoachSnapshotBlock(evals) {
  if (!isMidnightStrategySelected()) return null;
  const payload = {
    version: 1,
    saved_at: new Date().toISOString(),
    score: evals.score,
    missing: evals.missing.map((x) => x.key),
    blockers: evals.blockers,
    warnings: evals.warnings,
    direction: evals.direction,
    stdv_level: evals.stdvLevel,
    coach: evals.coach,
    plan: evals.plan,
  };
  return {
    id: MM_INTERNAL_BLOCK_ID,
    title: "Midnight Challenge Snapshot",
    content: JSON.stringify(payload),
  };
}

function applyMidnightAutofillFromCoach(payload, evals) {
  const c = evals.coach;
  const directionLabel = payload.direction === "short" ? "short" : "long";
  if (!payload.scenario) {
    const preOpenLabel = { up: "hausse", down: "baisse", range: "range" }[c.pre_open] || "non precise";
    const openLabel = { drop: "open baissier", rise: "open haussier", chop: "open indecis" }[c.open_behavior] || "open non precise";
    payload.scenario = `Pre-open: ${preOpenLabel}. ${openLabel}. PO3: ${c.po3_state || "non precise"}.`;
  }
  if (!payload.why_entry) {
    const trigger = c.entry_trigger === "both" ? "IFVG + breaker" : c.entry_trigger || "trigger non precise";
    const zone = c.zone_rule || "zone non precisee";
    const smt = c.smt_state || "SMT non precisee";
    payload.why_entry = `Entree ${directionLabel} via ${trigger}, en zone ${zone}, avec ${smt}.`;
  }
  if (!payload.why_trade) {
    payload.why_trade = `Setup Midnight: validation rapide du scenario, puis execution ${directionLabel} selon check-list.`;
  }
  if (!payload.why_stop && c.counter_thesis) {
    payload.why_stop = `Invalidation definie par la contre-these: ${c.counter_thesis}`;
  }
  if (!payload.why_tp) {
    const targetLabel = { above: "liquidite au-dessus", below: "liquidite en dessous", both: "liquidites des deux cotes (scaling)" }[c.liquidity_target] || "cible non precisee";
    payload.why_tp = `TP oriente vers ${targetLabel}.`;
  }
}

function mergeMidnightCoachTags(tags, evals) {
  const set = new Set((tags || []).map((x) => String(x).trim()).filter(Boolean));
  set.add("midnight_challenge");
  if (evals.coach.entry_trigger) set.add(`entry_${evals.coach.entry_trigger}`);
  if (evals.coach.zone_rule) set.add(`zone_${evals.coach.zone_rule}`);
  if (evals.coach.smt_state) set.add(`smt_${evals.coach.smt_state}`);
  if (evals.coach.liquidity_target) set.add(`liq_${evals.coach.liquidity_target}`);
  if (evals.stdvLevel != null) set.add(`stdv_${String(evals.stdvLevel).replace(".", "_")}`);
  return [...set];
}

function validateMidnightBeforeSave() {
  if (!isMidnightStrategySelected()) return { ok: true };
  const evals = evaluateMidnightChallenge();
  if (evals.plan?.plan_alignment === "out_of_plan" && !($("#planOverrideReason")?.value || "").trim()) {
    return {
      ok: false,
      message: "Trade hors plan PO3: explique la raison de l'override avant d'enregistrer.",
      focusId: "planOverrideReason",
      evals,
    };
  }
  if (!evals.missing.length && !evals.blockers.length && !evals.warnings.length) return { ok: true, evals };
  const details = [];
  if (evals.missing.length) details.push(`${evals.missing.length} info(s) manquante(s)`);
  if (evals.blockers.length) details.push(`${evals.blockers.length} incoherence(s)`);
  if (evals.warnings.length) details.push(`${evals.warnings.length} alerte(s)`);
  return {
    ok: true,
    confirmNeeded: true,
    confirmMessage: `Challenge rapide Midnight incomplet (${details.join(", ")}).\n\nTu peux enregistrer maintenant, ou revenir completer les points ci-dessus.`,
    evals,
  };
}

function bindMidnightChallenge() {
  const fields = [
    "mmPreOpen",
    "mmOpenBehavior",
    "mmPo3State",
    "mmEntryTrigger",
    "mmZoneRule",
    "mmSmtState",
    "mmLiquidityTarget",
    "mmCounterThesis",
    "stdvLevel",
    "whyStop",
    "whyTp",
  ];
  fields.forEach((id) => {
    const el = $("#" + id);
    if (!el) return;
    el.addEventListener("input", scheduleMidnightChallengeRender);
    el.addEventListener("change", scheduleMidnightChallengeRender);
  });
  document.querySelector(`.pills[data-pills="direction"]`)?.addEventListener("click", scheduleMidnightChallengeRender);
  document.querySelector(`.pills[data-pills="strategy"]`)?.addEventListener("click", scheduleMidnightChallengeRender);
}

function setActiveTradeCard(tradeId) {
  const cards = $$("#tradesList .trade-card");
  const wanted = tradeId == null ? "" : String(tradeId);
  cards.forEach((card) => {
    const isActive = wanted !== "" && String(card.dataset.tid || "") === wanted;
    card.classList.toggle("active", isActive);
  });
}

const TRADE_FLOW_STEPS = [
  { bid: "strategy", label: "Setup" },
  { bid: "midnight-coach", label: "Plan PO3" },
  { bid: "direction", label: "Direction" },
  { bid: "levels", label: "Niveaux" },
  { bid: "result", label: "Resultat" },
  { bid: "postmortem", label: "Review" },
  { bid: "screenshots", label: "Screens" },
];

let _tradeFlowBound = false;
let _tradeFlowNavDelegationBound = false;
let _tradeFlowRefreshRaf = 0;
let _midnightChallengeRaf = 0;

function scheduleTradeFlowNavStateRefresh() {
  if (_tradeFlowRefreshRaf) return;
  _tradeFlowRefreshRaf = requestAnimationFrame(() => {
    _tradeFlowRefreshRaf = 0;
    refreshTradeFlowNavState();
  });
}

function scheduleMidnightChallengeRender() {
  if (_midnightChallengeRaf) return;
  _midnightChallengeRaf = requestAnimationFrame(() => {
    _midnightChallengeRaf = 0;
    renderMidnightChallenge();
  });
}

function _isFilledValue(v) {
  if (v == null) return false;
  if (typeof v === "number") return Number.isFinite(v);
  return String(v).trim() !== "";
}

function _stepDone(bid) {
  if (bid === "strategy") return !!getPill("strategy");
  if (bid === "direction") {
    const plan = getCurrentMidnightPlan();
    const directionOk = !!getPill("direction");
    const overrideOk = plan.plan_alignment !== "out_of_plan" || _isFilledValue($("#planOverrideReason")?.value);
    return directionOk && overrideOk;
  }
  if (bid === "scenario") return ["whyTrade", "whyEntry", "scenario", "whyStop", "whyTp"].some((id) => _isFilledValue($("#" + id)?.value));
  if (bid === "levels") return _isFilledValue($("#entryPrice")?.value) && _isFilledValue($("#stopLoss")?.value) && _isFilledValue($("#takeProfit")?.value);
  if (bid === "result") return _isFilledValue($("#exitPrice")?.value) || _isFilledValue($("#isWin")?.value);
  if (bid === "midnight-coach") {
    if (!isMidnightStrategySelected()) return true;
    const evals = evaluateMidnightChallenge();
    return evals.missing.length === 0 && evals.blockers.length === 0;
  }
  if (bid === "postmortem") return _isFilledValue($("#lessonsLearned")?.value) || !!getPill("thesis_validated");
  if (bid === "screenshots") return ($$("#shotsList .shot").length > 0);
  return false;
}

function _setBlockCollapsed(block, collapsed) {
  if (!block) return;
  block.classList.toggle("collapsed", !!collapsed);
  const bid = block.dataset.bid || "";
  if (bid && typeof loadCollapsedBlocks === "function" && typeof saveCollapsedBlocks === "function") {
    const stateCollapsed = loadCollapsedBlocks();
    stateCollapsed[bid] = !!collapsed;
    saveCollapsedBlocks(stateCollapsed);
  }
  if (typeof updateBlockSummary === "function") updateBlockSummary(block);
}

function _focusTradeBlockByBid(bid, opts = {}) {
  const options = opts || {};
  const blocks = [...$$("#tradeFormSection .block")];
  const target = blocks.find((b) => (b.dataset.bid || "") === bid && !b.classList.contains("hidden"));
  if (!target) return;

  blocks.forEach((block) => {
    if (block.classList.contains("hidden")) return;
    _setBlockCollapsed(block, block !== target);
  });

  if (options.scroll !== false) {
    const behavior = options.smooth ? "smooth" : "auto";
    const modalScroll = $("#entryModal .modal-scroll");
    if (modalScroll) {
      const targetTop = target.offsetTop - modalScroll.offsetTop - 12;
      modalScroll.scrollTo({ top: Math.max(0, targetTop), behavior });
    } else {
      target.scrollIntoView({ behavior, block: "start" });
    }
  }

  if (options.focus !== false) {
    setTimeout(() => {
      const candidate = target.querySelector("textarea, input:not([type='hidden']):not([readonly]), select, .pill-choice");
      if (candidate && typeof candidate.focus === "function") candidate.focus();
    }, 120);
  }
}

function _ensureTradeFlowNav() {
  var section = $("#tradeFormSection");
  if (!section) return null;
  var inner = section.querySelector(".trade-form-inner");
  if (!inner) return null;

  var nav = $("#tradeFlowNav");
  if (!nav) {
    nav = document.createElement("div");
    nav.id = "tradeFlowNav";
    nav.className = "trade-flow-nav";
    inner.insertAdjacentElement("beforebegin", nav);
  }

  nav.innerHTML = TRADE_FLOW_STEPS.map(function (step) {
    return `<button type="button" class="trade-flow-step" data-bid="${step.bid}">
      <span class="trade-flow-dot"></span>
      <span class="trade-flow-label">${step.label}</span>
    </button>`;
  }).join("");

  if (!_tradeFlowNavDelegationBound) {
    _tradeFlowNavDelegationBound = true;
    nav.addEventListener("click", function (e) {
      var btn = e.target.closest(".trade-flow-step");
      if (!btn) return;
      _focusTradeBlockByBid(btn.dataset.bid, { scroll: true, focus: true });
      refreshTradeFlowNavState();
    });
  }
  return nav;
}

function refreshTradeFlowNavState() {
  const nav = $("#tradeFlowNav");
  if (!nav) return;
  const blocks = [...$$("#tradeFormSection .block")].filter((b) => !b.classList.contains("hidden"));
  const active = blocks.find((b) => !b.classList.contains("collapsed"));
  const activeBid = active?.dataset?.bid || "";

  nav.querySelectorAll(".trade-flow-step").forEach((btn) => {
    const bid = btn.dataset.bid || "";
    const block = blocks.find((b) => (b.dataset.bid || "") === bid);
    const visible = !!block;
    const done = visible ? _stepDone(bid) : true;
    btn.classList.toggle("is-active", bid === activeBid);
    btn.classList.toggle("is-done", done);
    btn.classList.toggle("is-hidden-step", !visible);
  });
}

function _pickInitialTradeStep(trade) {
  if (!trade) return "strategy";
  if (isMidnightStrategySelected()) {
    const plan = getCurrentMidnightPlan();
    if (!plan.plan_direction || plan.plan_alignment === "incomplete") return "midnight-coach";
    if (!getPill("direction")) return "direction";
  }
  if (!_isFilledValue($("#entryPrice")?.value) || !_isFilledValue($("#takeProfit")?.value)) return "levels";
  if (_isFilledValue($("#entryPrice")?.value) && !_isFilledValue($("#exitPrice")?.value)) return "result";
  return "scenario";
}

function _initTradeFlowUX() {
  _ensureTradeFlowNav();
  if (_tradeFlowBound) {
    refreshTradeFlowNavState();
    return;
  }
  const form = $("#tradeForm");
  if (form) {
    form.addEventListener("input", scheduleTradeFlowNavStateRefresh);
    form.addEventListener("change", scheduleTradeFlowNavStateRefresh);
  }
  $$("#tradeForm .pills").forEach((el) => {
    el.addEventListener("click", scheduleTradeFlowNavStateRefresh);
  });
  _tradeFlowBound = true;
  refreshTradeFlowNavState();
}

function _enterCompactTradeFlow(trade) {
  _initTradeFlowUX();
  const initialBid = _pickInitialTradeStep(trade);
  _focusTradeBlockByBid(initialBid, { scroll: true, focus: true });
  refreshTradeFlowNavState();
}

function openTradeForm(trade) {
  if (typeof sanitizeEntryModalSticky === "function") sanitizeEntryModalSticky();
  if (typeof setModalTradeFocus === "function") setModalTradeFocus(true);
  state.currentTradeId = trade?.id || null;
  setActiveTradeCard(state.currentTradeId);
  resetTradeForm();

  if (trade) {
    // Edition d'un trade existant
    $("#tradeId").value         = trade.id;
    setPill("strategy",          trade.strategy);
    setPill("direction",         trade.direction);
    setPill("thesis_validated",  trade.thesis_validated);

    setQuality(trade.execution_quality);
    $("#whyTrade").value      = trade.why_trade      ?? "";
    $("#whyEntry").value      = trade.why_entry      ?? "";
    $("#scenario").value      = trade.scenario       ?? "";
    $("#whyStop").value       = trade.why_stop       ?? "";
    $("#whyTp").value         = trade.why_tp         ?? "";
    $("#stdvLevel").value     = trade.stdv_level     ?? "";
    $("#entryPrice").value    = trade.entry_price    ?? "";
    $("#stopLoss").value      = trade.stop_loss      ?? "";
    $("#takeProfit").value    = trade.take_profit    ?? "";
    $("#exitPrice").value     = trade.exit_price     ?? "";
    $("#positionSize").value  = trade.position_size  ?? 1;
    $("#pnl").value           = trade.pnl            ?? 0;
    $("#rr").value            = trade.rr             ?? "";
    $("#isWin").value         = trade.is_win != null ? String(trade.is_win) : "";
    $("#planOverrideReason").value = trade.plan_override_reason ?? "";
    $("#exitPrice").dataset.autoSource = (
      trade.exit_price != null && trade.take_profit != null && Number(trade.exit_price) === Number(trade.take_profit)
    ) ? "tp" : "manual";
    $("#lessonsLearned").value = trade.lessons_learned ?? "";
    (trade.tags || []).forEach((t) => addTag(t));
    const allBlocks = trade.custom_blocks || [];
    const internalMidnight = allBlocks.find((b) => String(b?.id || "") === MM_INTERNAL_BLOCK_ID);
    if (internalMidnight) {
      hydrateMidnightChallengeFromSnapshot(internalMidnight.content);
    }
    allBlocks
      .filter((b) => String(b?.id || "") !== MM_INTERNAL_BLOCK_ID)
      .forEach((b) => addCustomBlock(b));
    renderShots(trade.screenshots || []);
    $("#tradeFormTitle").textContent = `Trade #${$("#tradesList .trade-card").length} - edition`;
    $("#deleteTradeBtn").classList.remove("hidden");
  } else {
    // Nouveau trade
    $("#tradeFormTitle").textContent = "Nouveau trade";
    $("#deleteTradeBtn").classList.add("hidden");
    renderShots([]);
    $("#positionSize").value = 1;
    setPill("strategy", "midnight_model");
  }

  autoFillExitFromTarget();
  updateRRPreview();
  renderMidnightChallenge();
  syncDayContextMidnightVisibility();
  setTimeout(function () { enhanceSelects($("#tradeFormSection")); }, 0);
  const tradeSection = $("#tradeFormSection");
  tradeSection?.classList.remove("hidden");
  _enterCompactTradeFlow(trade);
}

function closeTradeForm() {
  closeTradeFormUI();
}

function closeTradeFormUI() {
  $("#tradeFormSection").classList.add("hidden");
  if (typeof setModalTradeFocus === "function") setModalTradeFocus(false);
  setActiveTradeCard(null);
  state.currentTradeId = null;
  syncDayContextMidnightVisibility();
  refreshTradeFlowNavState();
}

function resetTradeForm() {
  $("#tradeForm").reset();
  $("#tradeId").value = "";
  $$("#tradeForm .pills .pill-choice").forEach((p) => p.classList.remove("active"));
  $$(".quality button").forEach((b) => b.classList.remove("on"));
  $("#executionQuality").value = "";
  $("#tagsInput").querySelectorAll(".tag-pill").forEach((t) => t.remove());
  $("#customBlocksList").innerHTML = "";
  renderShots([]);
  $("#rrPreview").textContent = "";
  const exit = $("#exitPrice");
  if (exit) exit.dataset.autoSource = "";
  const override = $("#planOverrideReason");
  if (override) override.value = "";
  resetMidnightChallenge();
  syncDayContextMidnightVisibility();
}

function buildTradePayload() {
  const isWinVal = $("#isWin").value;
  const eq       = $("#executionQuality").value;
  const midnightEvals = evaluateMidnightChallenge();
  const plan = midnightEvals.plan || getCurrentMidnightPlan();
  const customBlocks = getCustomBlocks().filter((b) => String(b?.id || "") !== MM_INTERNAL_BLOCK_ID);
  const midnightSnapshot = buildMidnightCoachSnapshotBlock(midnightEvals);
  if (midnightSnapshot) customBlocks.push(midnightSnapshot);
  let tags = getTags();
  if (isMidnightStrategySelected()) tags = mergeMidnightCoachTags(tags, midnightEvals);

  const payload = {
    strategy:         getPill("strategy"),
    direction:        getPill("direction"),
    why_trade:        $("#whyTrade").value   || null,
    why_entry:        $("#whyEntry").value   || null,
    scenario:         $("#scenario").value   || null,
    why_stop:         $("#whyStop").value    || null,
    why_tp:           $("#whyTp").value      || null,
    stdv_level:       numOrNull("stdvLevel"),
    entry_price:      numOrNull("entryPrice"),
    stop_loss:        numOrNull("stopLoss"),
    take_profit:      numOrNull("takeProfit"),
    exit_price:       numOrNull("exitPrice"),
    position_size:    numOrNull("positionSize"),
    pnl:              Number($("#pnl").value || 0),
    rr:               numOrNull("rr"),
    is_win:           isWinVal === "" ? null : isWinVal === "1",
    execution_quality: eq === "" ? null : Number(eq),
    thesis_validated: getPill("thesis_validated"),
    lessons_learned:  $("#lessonsLearned").value || null,
    tags,
    custom_blocks:    customBlocks,
  };

  if (isMidnightStrategySelected()) {
    Object.assign(payload, {
      plan_model:       plan.plan_model,
      plan_direction:   plan.plan_direction,
      plan_alignment:   plan.plan_alignment,
      plan_score:       plan.plan_score,
      plan_errors:      plan.plan_errors,
      plan_warnings:    plan.plan_warnings,
      plan_override_reason: $("#planOverrideReason")?.value?.trim() || null,
      plan_snapshot:    {
        version: 1,
        saved_at: new Date().toISOString(),
        direction: getPill("direction"),
        stdv_level: numOrNull("stdvLevel"),
        coach: midnightEvals.coach,
        plan,
      },
    });
    applyMidnightAutofillFromCoach(payload, midnightEvals);
  }
  return payload;
}

function numOrNull(id) {
  const v = $("#" + id)?.value;
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function submitTrade(e) {
  e.preventDefault();
  if (state.isSavingTrade) return;
  updateRRPreview();
  renderMidnightChallenge();

  // S'assurer que le jour existe avant d'enregistrer le trade
  if (!state.currentDayId) {
    const saved = await saveDayContext(true);
    if (!saved) return;
  }

  const challengeValidation = validateMidnightBeforeSave();
  if (!challengeValidation.ok) {
    toast(challengeValidation.message, "error");
    if (challengeValidation.focusId) {
      const focusEl = $("#" + challengeValidation.focusId);
      if (focusEl) focusEl.focus();
    }
    return;
  }
  if (challengeValidation.confirmNeeded && !confirm(challengeValidation.confirmMessage)) {
    return;
  }

  state.isSavingTrade = true;
  const payload = buildTradePayload();

  try {
    if (state.currentTradeId) {
      await api(`/api/trades/${state.currentTradeId}`,
        { method: "PUT", body: JSON.stringify(payload) });
      state.modalDataDirty = true;
      toast("Trade mis a jour ✓", "success");
    } else {
      await api(`/api/days/${state.currentDayId}/trades`,
        { method: "POST", body: JSON.stringify(payload) });
      state.modalDataDirty = true;
      toast("Trade enregistre ✓", "success");
    }
    // Recharger le jour pour mettre a jour la liste
    const day = await api(`/api/days/${state.currentDayId}`);
    renderTradesList(day.trades || []);
    closeTradeFormUI();
    document.dispatchEvent(new CustomEvent("trade:saved"));
    await loadAll();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    state.isSavingTrade = false;
  }
}

async function deleteTrade() {
  if (!state.currentTradeId) return;
  if (!confirm("Supprimer ce trade (screenshots inclus) ?")) return;
  try {
    await api(`/api/trades/${state.currentTradeId}`, { method: "DELETE" });
    state.modalDataDirty = true;
    toast("Trade supprime", "success");
    const day = await api(`/api/days/${state.currentDayId}`);
    renderTradesList(day.trades || []);
    closeTradeFormUI();
    document.dispatchEvent(new CustomEvent("trade:saved"));
    await loadAll();
  } catch (err) { toast(err.message, "error"); }
}
