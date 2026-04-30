# ---------- Plan / PO3 coherence engine ----------

MM_INTERNAL_BLOCK_ID = "__mm_challenge__"
PLAN_ERROR_LABELS = {
    "counter_direction": "Direction opposee au plan PO3",
    "invalid_zone": "Zone Premium/Discount incoherente",
    "po3_invalid": "PO3 invalide",
}
PLAN_WARNING_LABELS = {
    "plan_incomplete": "Plan PO3 incomplet",
    "po3_partial": "PO3 partiel",
    "smt_missing": "SMT absente",
    "smt_inconsistent": "SMT incoherente",
    "liquidity_inconsistent": "Cible de liquidite incoherente",
    "counter_thesis_missing": "Contre-these absente",
}


def _json_loads_safe(value, default=None):
    if value is None or value == "":
        return default
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except Exception:
            return default
    return default


def _extract_midnight_snapshot(payload):
    snapshot = _json_loads_safe(payload.get("plan_snapshot"), None)
    if isinstance(snapshot, dict):
        return snapshot

    blocks = _json_loads_safe(payload.get("custom_blocks"), [])
    if isinstance(blocks, list):
        for block in blocks:
            if not isinstance(block, dict):
                continue
            if str(block.get("id") or "") != MM_INTERNAL_BLOCK_ID:
                continue
            parsed = _json_loads_safe(block.get("content"), None)
            if isinstance(parsed, dict):
                return parsed
    return None


def _plan_direction_from_open(open_behavior):
    if open_behavior == "rise":
        return "short"
    if open_behavior == "drop":
        return "long"
    return None


def _dedupe(items):
    out = []
    for item in items:
        if item and item not in out:
            out.append(item)
    return out


def evaluate_trade_plan(payload):
    """Return normalized plan fields for a trade payload.

    The backend owns the final evaluation. Frontend-provided plan fields are
    treated as hints only; the snapshot/custom block is the source of truth.
    """
    strategy = _canonical_strategy(payload.get("strategy"))
    snapshot = _extract_midnight_snapshot(payload)
    if strategy != "midnight_model":
        return {
            "plan_model": None,
            "plan_direction": None,
            "plan_alignment": "unknown",
            "plan_score": None,
            "plan_errors": None,
            "plan_warnings": None,
            "plan_snapshot": None,
            "plan_override_reason": payload.get("plan_override_reason"),
        }

    if not isinstance(snapshot, dict):
        snapshot = {}
    coach = snapshot.get("coach") if isinstance(snapshot.get("coach"), dict) else {}
    if not isinstance(coach, dict):
        coach = {}

    direction = str(payload.get("direction") or snapshot.get("direction") or "").strip().lower()
    open_behavior = str(coach.get("open_behavior") or snapshot.get("open_behavior") or "").strip().lower()
    po3_state = str(coach.get("po3_state") or snapshot.get("po3_state") or "").strip().lower()
    zone_rule = str(coach.get("zone_rule") or snapshot.get("zone_rule") or "").strip().lower()
    smt_state = str(coach.get("smt_state") or snapshot.get("smt_state") or "").strip().lower()
    liquidity_target = str(coach.get("liquidity_target") or snapshot.get("liquidity_target") or "").strip().lower()
    counter_thesis = str(coach.get("counter_thesis") or snapshot.get("counter_thesis") or "").strip()

    plan_direction = _plan_direction_from_open(open_behavior)
    errors, warnings = [], []

    if not plan_direction:
        warnings.append("plan_incomplete")
    elif direction in {"long", "short"} and direction != plan_direction:
        errors.append("counter_direction")
    elif direction not in {"long", "short"}:
        warnings.append("plan_incomplete")

    if po3_state == "no":
        errors.append("po3_invalid")
    elif po3_state == "partial":
        warnings.append("po3_partial")
    elif not po3_state:
        warnings.append("plan_incomplete")

    effective_direction = direction if direction in {"long", "short"} else plan_direction
    if zone_rule == "invalid":
        errors.append("invalid_zone")
    elif effective_direction == "long" and zone_rule and zone_rule != "discount":
        errors.append("invalid_zone")
    elif effective_direction == "short" and zone_rule and zone_rule != "premium":
        errors.append("invalid_zone")
    elif not zone_rule:
        warnings.append("plan_incomplete")

    if not smt_state:
        warnings.append("smt_missing")
    elif smt_state == "none":
        warnings.append("smt_missing")
    elif effective_direction == "long" and smt_state != "bullish":
        warnings.append("smt_inconsistent")
    elif effective_direction == "short" and smt_state != "bearish":
        warnings.append("smt_inconsistent")

    if effective_direction == "long" and liquidity_target and liquidity_target not in {"above", "both"}:
        warnings.append("liquidity_inconsistent")
    elif effective_direction == "short" and liquidity_target and liquidity_target not in {"below", "both"}:
        warnings.append("liquidity_inconsistent")
    elif not liquidity_target:
        warnings.append("plan_incomplete")

    if len(counter_thesis) < 10:
        warnings.append("counter_thesis_missing")

    errors = _dedupe(errors)
    warnings = _dedupe(warnings)
    if not snapshot:
        warnings = _dedupe(["plan_incomplete"] + warnings)

    if errors:
        alignment = "out_of_plan"
    elif not plan_direction or "plan_incomplete" in warnings:
        alignment = "incomplete"
    else:
        alignment = "in_plan"

    score = max(0, 100 - (len(errors) * 24) - (len(warnings) * 7) - (15 if alignment == "incomplete" else 0))
    normalized_snapshot = snapshot if isinstance(snapshot, dict) else {
        "version": 1,
        "coach": coach,
    }
    normalized_snapshot["plan_direction"] = plan_direction
    normalized_snapshot["plan_alignment"] = alignment

    return {
        "plan_model": "midnight_po3",
        "plan_direction": plan_direction,
        "plan_alignment": alignment,
        "plan_score": int(round(score)),
        "plan_errors": json.dumps(errors, ensure_ascii=False) if errors else None,
        "plan_warnings": json.dumps(warnings, ensure_ascii=False) if warnings else None,
        "plan_override_reason": payload.get("plan_override_reason"),
        "plan_snapshot": json.dumps(normalized_snapshot, ensure_ascii=False),
    }


def plan_error_label(code):
    return PLAN_ERROR_LABELS.get(code, str(code).replace("_", " ").title())
