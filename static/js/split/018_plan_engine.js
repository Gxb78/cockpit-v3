// ---------- Plan / PO3 engine ----------

const PLAN_ERROR_LABELS = {
  counter_direction: "Direction opposee au plan PO3",
  invalid_zone: "Zone Premium/Discount incoherente",
  po3_invalid: "PO3 invalide",
};

const PLAN_WARNING_LABELS = {
  plan_incomplete: "Plan PO3 incomplet",
  po3_partial: "PO3 partiel",
  smt_missing: "SMT absente",
  smt_inconsistent: "SMT incoherente",
  liquidity_inconsistent: "Cible de liquidite incoherente",
  counter_thesis_missing: "Contre-these absente",
};

function po3PlanDirection(openBehavior) {
  if (openBehavior === "rise") return "short";
  if (openBehavior === "drop") return "long";
  return null;
}

function _dedupePlanItems(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function evaluateMidnightPlan(input) {
  const coach = input?.coach || {};
  const direction = String(input?.direction || "").toLowerCase();
  const openBehavior = String(coach.open_behavior || "").toLowerCase();
  const po3State = String(coach.po3_state || "").toLowerCase();
  const zoneRule = String(coach.zone_rule || "").toLowerCase();
  const smtState = String(coach.smt_state || "").toLowerCase();
  const liquidityTarget = String(coach.liquidity_target || "").toLowerCase();
  const counterThesis = String(coach.counter_thesis || "").trim();
  const planDirection = po3PlanDirection(openBehavior);
  const errors = [];
  const warnings = [];

  if (!planDirection) warnings.push("plan_incomplete");
  else if (direction && direction !== planDirection) errors.push("counter_direction");
  else if (!direction) warnings.push("plan_incomplete");

  if (po3State === "no") errors.push("po3_invalid");
  else if (po3State === "partial") warnings.push("po3_partial");
  else if (!po3State) warnings.push("plan_incomplete");

  const effectiveDirection = direction || planDirection;
  if (zoneRule === "invalid") errors.push("invalid_zone");
  else if (effectiveDirection === "long" && zoneRule && zoneRule !== "discount") errors.push("invalid_zone");
  else if (effectiveDirection === "short" && zoneRule && zoneRule !== "premium") errors.push("invalid_zone");
  else if (!zoneRule) warnings.push("plan_incomplete");

  if (!smtState || smtState === "none") warnings.push("smt_missing");
  else if (effectiveDirection === "long" && smtState !== "bullish") warnings.push("smt_inconsistent");
  else if (effectiveDirection === "short" && smtState !== "bearish") warnings.push("smt_inconsistent");

  if (effectiveDirection === "long" && liquidityTarget && !["above", "both"].includes(liquidityTarget)) warnings.push("liquidity_inconsistent");
  else if (effectiveDirection === "short" && liquidityTarget && !["below", "both"].includes(liquidityTarget)) warnings.push("liquidity_inconsistent");
  else if (!liquidityTarget) warnings.push("plan_incomplete");

  if (counterThesis.length < 10) warnings.push("counter_thesis_missing");

  const planErrors = _dedupePlanItems(errors);
  const planWarnings = _dedupePlanItems(warnings);
  const alignment = planErrors.length
    ? "out_of_plan"
    : (!planDirection || planWarnings.includes("plan_incomplete")) ? "incomplete" : "in_plan";
  const score = Math.max(0, 100 - (planErrors.length * 24) - (planWarnings.length * 7) - (alignment === "incomplete" ? 15 : 0));

  return {
    plan_model: "midnight_po3",
    plan_direction: planDirection,
    plan_alignment: alignment,
    plan_score: Math.round(score),
    plan_errors: planErrors,
    plan_warnings: planWarnings,
  };
}

function planAlignmentLabel(alignment) {
  return {
    in_plan: "Dans le plan",
    out_of_plan: "Hors plan",
    incomplete: "Plan incomplet",
    unknown: "Plan inconnu",
  }[alignment] || "Plan inconnu";
}
