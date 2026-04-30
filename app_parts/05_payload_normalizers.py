def normalize_day_payload(data, *, for_update=False):
    raw = dict(data or {})
    if "bias" in raw and "htf_bias" not in raw:
        raw["htf_bias"] = raw.get("bias")

    out, errors = {}, []
    for f in DAY_TEXT_FIELDS:
        if f in raw:
            v = raw[f]
            out[f] = v if (v is None or isinstance(v, str)) else str(v)
            # Validation taille
            if isinstance(out[f], str) and len(out[f]) > MAX_TEXT_LONG:
                errors.append(f"{f} trop long ({len(out[f])} caracteres, max {MAX_TEXT_LONG})")
    if "tags" in raw:
        tags = raw["tags"]
        if isinstance(tags, list):
            cleaned = [str(t).strip() for t in tags if str(t).strip()]
            out["tags"] = json.dumps(cleaned, ensure_ascii=False) if cleaned else None
        elif tags is None or tags == "":
            out["tags"] = None
    return out, errors


def normalize_trade_payload(data, *, for_update=False):
    raw = dict(data or {})
    if "stop_price" in raw and "stop_loss" not in raw:
        raw["stop_loss"] = raw.get("stop_price")
    if "target_price" in raw and "take_profit" not in raw:
        raw["take_profit"] = raw.get("target_price")
    if "tp" in raw and "take_profit" not in raw:
        raw["take_profit"] = raw.get("tp")
    if "stdv" in raw and "stdv_level" not in raw:
        raw["stdv_level"] = raw.get("stdv")
    if "exit_quality" in raw and "execution_quality" not in raw:
        raw["execution_quality"] = raw.get("exit_quality")
    if "lessons" in raw and "lessons_learned" not in raw:
        raw["lessons_learned"] = raw.get("lessons")
    if "strategy" in raw:
        raw["strategy"] = _canonical_strategy(raw.get("strategy"))
    if "plan_snapshot" in raw and isinstance(raw.get("plan_snapshot"), (dict, list)):
        raw["plan_snapshot"] = json.dumps(raw.get("plan_snapshot"), ensure_ascii=False)
    out, errors = {}, []

    _TRADE_TEXT_LIMITS = {
        "strategy": MAX_TEXT_SHORT,
        "direction": MAX_TEXT_SHORT,
        "why_trade": MAX_TEXT_MEDIUM,
        "why_entry": MAX_TEXT_MEDIUM,
        "why_stop": MAX_TEXT_MEDIUM,
        "why_tp": MAX_TEXT_MEDIUM,
        "scenario": MAX_TEXT_LONG,
        "thesis_validated": MAX_TEXT_LONG,
        "lessons_learned": MAX_TEXT_LONG,
        "plan_model": MAX_TEXT_SHORT,
        "plan_direction": MAX_TEXT_SHORT,
        "plan_alignment": MAX_TEXT_SHORT,
        "plan_override_reason": MAX_TEXT_MEDIUM,
        "plan_snapshot": MAX_TEXT_LONG,
    }
    for f in TRADE_TEXT_FIELDS:
        if f in raw:
            v = raw[f]
            out[f] = v if (v is None or isinstance(v, str)) else str(v)
            limit = _TRADE_TEXT_LIMITS.get(f)
            if isinstance(out[f], str) and limit and len(out[f]) > limit:
                errors.append(f"{f} trop long ({len(out[f])} caracteres, max {limit})")

    for f in TRADE_NUMERIC_FIELDS:
        if f in raw:
            v = raw[f]
            if v is None or v == "":
                out[f] = None
            else:
                try:
                    out[f] = float(v)
                except (TypeError, ValueError):
                    errors.append(f"{f} invalide")

    for f in TRADE_INT_FIELDS:
        if f in raw:
            v = raw[f]
            if v is None or v == "":
                out[f] = None
            else:
                try:
                    parsed = int(v)
                    if f == "execution_quality" and parsed not in (1, 2, 3, 4, 5):
                        errors.append("execution_quality doit etre entre 1 et 5")
                        continue
                    out[f] = parsed
                except (TypeError, ValueError):
                    errors.append(f"{f} invalide")

    if "stdv_level" in raw:
        v = raw["stdv_level"]
        if v is None or v == "":
            out["stdv_level"] = None
        else:
            try:
                stdv = float(v)
            except (TypeError, ValueError):
                errors.append("stdv_level invalide (entre 1 et 5, pas de 0.5)")
            else:
                half_steps = abs(stdv * 2 - round(stdv * 2)) < 1e-9
                if stdv < 1 or stdv > 5 or not half_steps:
                    errors.append("stdv_level doit etre entre 1 et 5 par pas de 0.5")
                else:
                    out["stdv_level"] = stdv

    if "is_win" in raw:
        parsed, err = _parse_bool_to_is_win(raw["is_win"])
        if err:
            errors.append(err)
        else:
            out["is_win"] = parsed

    if "tags" in raw:
        tags = raw["tags"]
        if isinstance(tags, list):
            cleaned = [str(t).strip() for t in tags if str(t).strip()]
            out["tags"] = json.dumps(cleaned, ensure_ascii=False) if cleaned else None
        elif tags is None or tags == "":
            out["tags"] = None

    if "custom_blocks" in raw:
        cb = raw["custom_blocks"]
        if isinstance(cb, list):
            cleaned = []
            for b in cb:
                if isinstance(b, dict) and (b.get("title") or b.get("content")):
                    cleaned.append({
                        "id":      str(b.get("id", "")),
                        "title":   str(b.get("title", "")),
                        "content": str(b.get("content", "")),
                    })
            out["custom_blocks"] = json.dumps(cleaned, ensure_ascii=False) if cleaned else None
        elif cb is None or cb == "":
            out["custom_blocks"] = None

    for f in ("plan_errors", "plan_warnings"):
        if f in raw:
            val = raw[f]
            if isinstance(val, list):
                cleaned = [str(x).strip() for x in val if str(x).strip()]
                out[f] = json.dumps(cleaned, ensure_ascii=False) if cleaned else None
            elif val is None or val == "":
                out[f] = None

    if not for_update and out.get("pnl") is None:
        out["pnl"] = 0

    return out, errors


