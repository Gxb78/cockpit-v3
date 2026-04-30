# ---------- API : stats ----------

# trade-math functions (_to_float, _infer_trade_direction, _derive_trade_metrics)
# are now provided by 08_trade_math.py (loaded before this module).

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
