def _month_span_from_days(days):
    from datetime import date

    parsed = []
    for d in days:
        raw = d.get("date")
        if not raw:
            continue
        try:
            parsed.append(date.fromisoformat(raw))
        except Exception:
            continue
    if not parsed:
        return None, None, None, None

    latest = max(parsed)
    cur_start = date(latest.year, latest.month, 1)
    if latest.month == 1:
        next_month = date(latest.year + 1, 1, 1)
    else:
        next_month = date(latest.year, latest.month + 1, 1)
    cur_end = next_month - __import__("datetime").timedelta(days=1)
    prev_end = cur_start - __import__("datetime").timedelta(days=1)
    prev_start = date(prev_end.year, prev_end.month, 1)
    return cur_start, cur_end, prev_start, prev_end


def _period_summary(trades, start_date, end_date):
    if start_date is None or end_date is None:
        return {"from": None, "to": None, "num_trades": 0, "pnl": 0, "wins": 0, "losses": 0, "winrate": 0}

    start_key = start_date.isoformat()
    end_key = end_date.isoformat()
    scoped = [
        t for t in trades
        if t.get("_date") and start_key <= t["_date"] <= end_key
    ]
    wins = sum(1 for t in scoped if t.get("_is_win_eff") == 1)
    losses = sum(1 for t in scoped if t.get("_is_win_eff") == 0)
    decided = wins + losses
    pnl = sum((t.get("_pnl_eff", t.get("pnl")) or 0) for t in scoped)
    return {
        "from": start_key,
        "to": end_key,
        "num_trades": len(scoped),
        "pnl": pnl,
        "wins": wins,
        "losses": losses,
        "winrate": (wins / decided * 100) if decided else 0,
    }


def _build_period_comparison(days, trades):
    cur_start, cur_end, prev_start, prev_end = _month_span_from_days(days)
    if not cur_start:
        return {
            "label": "Mois courant vs precedent",
            "current": {"from": None, "to": None, "num_trades": 0, "pnl": 0, "wins": 0, "losses": 0, "winrate": 0},
            "previous": {"from": None, "to": None, "num_trades": 0, "pnl": 0, "wins": 0, "losses": 0, "winrate": 0},
            "delta": {"pnl": 0, "winrate": 0, "num_trades": 0},
        }

    cur = _period_summary(trades, cur_start, cur_end)
    prev = _period_summary(trades, prev_start, prev_end)
    return {
        "label": "Mois courant vs precedent",
        "current": cur,
        "previous": prev,
        "delta": {
            "pnl": cur["pnl"] - prev["pnl"],
            "winrate": cur["winrate"] - prev["winrate"],
            "num_trades": cur["num_trades"] - prev["num_trades"],
        },
    }


def _streak_stats(days):
    from datetime import date, timedelta
    if not days:
        return {"current": 0, "best": 0}
    date_set = sorted({d["date"] for d in days})
    best = cur = 0
    prev = None
    for ds in date_set:
        try:
            dt = date.fromisoformat(ds)
        except Exception:
            continue
        cur = (cur + 1) if (prev and (dt - prev).days == 1) else 1
        best = max(best, cur)
        prev = dt
    today = date.today()
    s = set(date_set)
    walker = today
    if walker.isoformat() not in s:
        walker -= __import__("datetime").timedelta(days=1)
    cur_streak = 0
    while walker.isoformat() in s:
        cur_streak += 1
        walker -= __import__("datetime").timedelta(days=1)
    return {"current": cur_streak, "best": best}


def _build_insights(trades, by_strategy, by_session, by_emo, by_bias, total_wr, num_decided):
    insights = []
    MIN = 3

    def pretty(s):
        return str(s).replace("_", " ").title()

    eligible = [(k, v) for k, v in by_strategy.items() if v["wins"] + v["losses"] >= MIN]
    if eligible:
        best = max(eligible, key=lambda x: x[1]["winrate"])
        if best[1]["winrate"] >= 60:
            delta = best[1]["winrate"] - total_wr if num_decided else 0
            insights.append({
                "kind": "best_setup", "color": "lime", "icon": "trophy",
                "title": f"Top strategie : {pretty(best[0])}",
                "body":  f"{best[1]['winrate']:.0f}% WR sur {best[1]['wins']+best[1]['losses']} trades"
                         + (f" (+{delta:.0f}pts vs global)" if delta > 0 else ""),
            })
        worst = min(eligible, key=lambda x: x[1]["winrate"])
        if worst[1]["winrate"] < 40 and worst[0] != best[0]:
            insights.append({
                "kind": "worst_setup", "color": "rose", "icon": "alert",
                "title": f"A surveiller : {pretty(worst[0])}",
                "body":  f"{worst[1]['winrate']:.0f}% WR sur {worst[1]['wins']+worst[1]['losses']} trades",
            })

    sess_el = [(k, v) for k, v in by_session.items() if v["wins"] + v["losses"] >= MIN]
    if sess_el:
        best = max(sess_el, key=lambda x: x[1]["winrate"])
        if best[1]["winrate"] >= 55:
            insights.append({
                "kind": "best_session", "color": "cyan", "icon": "clock",
                "title": f"Meilleure session : {pretty(best[0])}",
                "body":  f"{best[1]['winrate']:.0f}% WR - PnL {best[1]['pnl']:+.0f}$",
            })

    for k, v in by_emo.items():
        dec = v["wins"] + v["losses"]
        if dec >= MIN and k in ("fomo", "revenge") and v["winrate"] < 40:
            insights.append({
                "kind": "tilt_pattern", "color": "rose", "icon": "warning",
                "title": f"Pattern toxique : {pretty(k)}",
                "body":  f"{v['winrate']:.0f}% WR quand tu es en {k}",
            })
    good = [(k, v) for k, v in by_emo.items() if v["wins"]+v["losses"] >= MIN and k in ("calm","focused")]
    if good:
        best = max(good, key=lambda x: x[1]["winrate"])
        if best[1]["winrate"] >= 60:
            insights.append({
                "kind": "best_mental", "color": "lime", "icon": "brain",
                "title": f"Tu trades mieux : {pretty(best[0])}",
                "body":  f"{best[1]['winrate']:.0f}% WR dans cet etat",
            })

    vl = sum(1 for t in trades if t.get("thesis_validated") == "yes" and t.get("_is_win_eff", t.get("is_win")) == 0)
    vw = sum(1 for t in trades if t.get("thesis_validated") == "yes" and t.get("_is_win_eff", t.get("is_win")) == 1)
    if vl + vw >= 5 and vl / (vl + vw) > 0.4:
        insights.append({
            "kind": "exec_issue", "color": "amber", "icon": "tools",
            "title": "Probleme d'execution",
            "body":  f"{vl} trades perdants malgre une these validee",
        })

    bias_el = [(k, v) for k, v in by_bias.items() if v["wins"]+v["losses"] >= MIN]
    if bias_el:
        best = max(bias_el, key=lambda x: x[1]["winrate"])
        if best[1]["winrate"] >= 60:
            insights.append({
                "kind": "best_bias", "color": "cyan", "icon": "compass",
                "title": f"Biais favorable : {pretty(best[0])}",
                "body":  f"{best[1]['winrate']:.0f}% WR quand HTF est {best[0]}",
            })

    qs = [t["execution_quality"] for t in trades if t.get("execution_quality")]
    if len(qs) >= 5:
        avg_q = sum(qs) / len(qs)
        insights.append({
            "kind": "exec_quality", "color": "magenta" if avg_q < 3 else "cyan", "icon": "star",
            "title": f"Qualite d'execution moyenne : {avg_q:.1f}/5",
            "body":  f"sur {len(qs)} trades evalues",
        })

    return insights[:6]


