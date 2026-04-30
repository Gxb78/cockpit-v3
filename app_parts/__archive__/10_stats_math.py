# ---------- API : stats ----------

def _to_float(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _infer_trade_direction(trade):
    direction = (trade.get("direction") or "").strip().lower()
    if direction in {"long", "short"}:
        return direction
    entry = _to_float(trade.get("entry_price"))
    stop = _to_float(trade.get("stop_loss"))
    target = _to_float(trade.get("take_profit"))
    if entry is not None and stop is not None and stop != entry:
        return "long" if stop < entry else "short"
    if entry is not None and target is not None and target != entry:
        return "long" if target > entry else "short"
    return None


def _derive_trade_metrics(trade):
    rr = _to_float(trade.get("rr"))
    pnl = _to_float(trade.get("pnl"))
    is_win = trade.get("is_win")
    entry = _to_float(trade.get("entry_price"))
    stop = _to_float(trade.get("stop_loss"))
    target = _to_float(trade.get("take_profit"))
    exit_price = _to_float(trade.get("exit_price"))
    qty = _to_float(trade.get("position_size"))
    if qty is None or qty <= 0:
        qty = 1.0

    direction = _infer_trade_direction(trade)
    pnl_derived = None
    if direction and entry is not None and exit_price is not None:
        if direction == "long":
            pnl_derived = (exit_price - entry) * qty
        else:
            pnl_derived = (entry - exit_price) * qty

    is_win_derived = None
    if is_win in (0, 1):
        is_win_derived = int(is_win)
    elif pnl is not None and pnl != 0:
        is_win_derived = 1 if pnl > 0 else 0
    elif pnl_derived is not None and pnl_derived != 0:
        is_win_derived = 1 if pnl_derived > 0 else 0

    rr_derived = rr
    if rr_derived is None and entry is not None and stop is not None and stop != entry:
        risk = abs(entry - stop)
        if risk > 0:
            if target is not None:
                rr_derived = abs(target - entry) / risk
            elif exit_price is not None:
                rr_derived = abs(exit_price - entry) / risk
                if is_win_derived == 0:
                    rr_derived = -rr_derived

    pnl_effective = pnl if pnl is not None else pnl_derived
    pnl_known = pnl_effective is not None
    if pnl_effective is None:
        pnl_effective = 0

    return {
        "direction": direction,
        "pnl_effective": pnl_effective,
        "pnl_known": pnl_known,
        "is_win_effective": is_win_derived,
        "rr_effective": rr_derived,
    }


def _bucket(items, key_fn):
    out = {}
    for r in items:
        k = key_fn(r)
        if k is None or k == "":
            continue
        b = out.setdefault(k, {"count": 0, "wins": 0, "losses": 0, "pnl": 0, "rrs": [], "qualities": []})
        b["count"] += 1
        b["pnl"]   += (r.get("_pnl_eff", r.get("pnl")) or 0)
        win_state = r.get("_is_win_eff", r.get("is_win"))
        if win_state == 1:
            b["wins"] += 1
        elif win_state == 0:
            b["losses"] += 1
        rr_val = r.get("_rr_eff", r.get("rr"))
        if rr_val is not None:
            b["rrs"].append(rr_val)
        if r.get("execution_quality"): b["qualities"].append(r["execution_quality"])
    for v in out.values():
        dec = v["wins"] + v["losses"]
        v["winrate"]     = (v["wins"] / dec * 100) if dec else 0
        v["avg_rr"]      = (sum(v["rrs"]) / len(v["rrs"])) if v["rrs"] else 0
        v["avg_quality"] = (sum(v["qualities"]) / len(v["qualities"])) if v["qualities"] else 0
        del v["rrs"], v["qualities"]
    return out


def _bucket_multi(items, keys_fn):
    out = {}
    for r in items:
        keys = keys_fn(r) or []
        seen = set()
        for key in keys:
            if key is None:
                continue
            k = str(key).strip()
            if not k or k in seen:
                continue
            seen.add(k)
            b = out.setdefault(k, {"count": 0, "wins": 0, "losses": 0, "pnl": 0, "rrs": [], "qualities": []})
            b["count"] += 1
            b["pnl"] += (r.get("_pnl_eff", r.get("pnl")) or 0)
            win_state = r.get("_is_win_eff", r.get("is_win"))
            if win_state == 1:
                b["wins"] += 1
            elif win_state == 0:
                b["losses"] += 1
            rr_val = r.get("_rr_eff", r.get("rr"))
            if rr_val is not None:
                b["rrs"].append(rr_val)
            if r.get("execution_quality"):
                b["qualities"].append(r["execution_quality"])
    for v in out.values():
        dec = v["wins"] + v["losses"]
        v["winrate"] = (v["wins"] / dec * 100) if dec else 0
        v["avg_rr"] = (sum(v["rrs"]) / len(v["rrs"])) if v["rrs"] else 0
        v["avg_quality"] = (sum(v["qualities"]) / len(v["qualities"])) if v["qualities"] else 0
        del v["rrs"], v["qualities"]
    return out


def _compute_drawdown_series(cumulative):
    if not cumulative:
        return {"series": [], "max_drawdown": 0, "current_drawdown": 0}

    peak = None
    max_dd = 0
    series = []
    for point in cumulative:
        cum = float(point.get("cumulative") or 0)
        if peak is None or cum > peak:
            peak = cum
        drawdown = cum - peak
        if drawdown < max_dd:
            max_dd = drawdown
        series.append({
            "date": point.get("date"),
            "cumulative": cum,
            "peak": peak,
            "drawdown": drawdown,
        })
    return {
        "series": series,
        "max_drawdown": max_dd,
        "current_drawdown": series[-1]["drawdown"] if series else 0,
    }


def _build_pnl_histogram(values, bins=10):
    nums = [float(v) for v in values if v is not None]
    if not nums:
        return []
    if len(nums) == 1:
        v = nums[0]
        return [{
            "from": v,
            "to": v,
            "center": v,
            "count": 1,
            "label": f"{v:.2f}",
        }]

    min_v = min(nums)
    max_v = max(nums)
    if min_v == max_v:
        return [{
            "from": min_v,
            "to": max_v,
            "center": min_v,
            "count": len(nums),
            "label": f"{min_v:.2f}",
        }]

    bin_count = max(4, min(int(bins), len(nums)))
    width = (max_v - min_v) / bin_count
    buckets = []
    for i in range(bin_count):
        left = min_v + i * width
        right = left + width if i < bin_count - 1 else max_v
        buckets.append({
            "from": left,
            "to": right,
            "center": (left + right) / 2,
            "count": 0,
        })

    for v in nums:
        if v >= max_v:
            idx = bin_count - 1
        else:
            idx = int((v - min_v) / width)
            idx = max(0, min(idx, bin_count - 1))
        buckets[idx]["count"] += 1

    for b in buckets:
        b["label"] = f"{b['from']:.0f}..{b['to']:.0f}"
    return buckets


