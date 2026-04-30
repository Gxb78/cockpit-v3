@app.get("/api/stats")
def stats():
    from datetime import datetime as dt_cls
    db = get_db()

    day_q, day_p = "SELECT * FROM days WHERE 1=1", []
    instrument = _canonical_instrument(request.args.get("instrument"))
    date_from  = request.args.get("from")
    date_to    = request.args.get("to")
    if instrument and instrument != "ALL":
        day_q += " AND instrument=?"; day_p.append(instrument)
    if date_from:
        day_q += " AND date>=?"; day_p.append(date_from)
    if date_to:
        day_q += " AND date<=?"; day_p.append(date_to)

    days      = [row_to_dict(r) for r in db.execute(day_q, day_p)]
    day_ids   = [d["id"] for d in days]
    day_by_id = {d["id"]: d for d in days}

    EMPTY = {
        "total_pnl": 0, "winrate": 0, "wins": 0, "losses": 0,
        "num_entries": 0, "num_trades": 0, "avg_rr": 0,
        "per_instrument": {}, "cumulative": [], "streak": 0, "best_streak": 0,
        "by_setup": {}, "by_session": {}, "by_bias": {}, "by_emo": {}, "by_dow": {}, "by_tag": {},
        "activity": [], "rr_buckets": [0]*6, "insights": [],
        "drawdown": {"series": [], "max_drawdown": 0, "current_drawdown": 0},
        "pnl_histogram": [],
        "period_compare": {
            "label": "Mois courant vs precedent",
            "current": {"from": None, "to": None, "num_trades": 0, "pnl": 0, "wins": 0, "losses": 0, "winrate": 0},
            "previous": {"from": None, "to": None, "num_trades": 0, "pnl": 0, "wins": 0, "losses": 0, "winrate": 0},
            "delta": {"pnl": 0, "winrate": 0, "num_trades": 0},
        },
    }
    if not day_ids:
        return jsonify(EMPTY)

    ph     = ",".join("?" * len(day_ids))
    trades = [row_to_dict(r) for r in db.execute(f"SELECT * FROM trades WHERE day_id IN ({ph})", day_ids)]

    # Enrichir chaque trade avec le contexte du jour
    for t in trades:
        d = day_by_id.get(t["day_id"], {})
        t["_date"]     = d.get("date")
        t["_instrument"] = d.get("instrument")
        t["_session"]  = d.get("session")
        t["_htf_bias"] = d.get("htf_bias")
        t["tags"] = _decode_json(t.get("tags"), [])
        derived = _derive_trade_metrics(t)
        t["_direction_eff"] = derived["direction"]
        t["_pnl_eff"] = derived["pnl_effective"]
        t["_pnl_known"] = derived["pnl_known"]
        t["_is_win_eff"] = derived["is_win_effective"]
        t["_rr_eff"] = derived["rr_effective"]

    total_pnl = sum((t.get("_pnl_eff", t.get("pnl")) or 0) for t in trades)
    wins      = [t for t in trades if t.get("_is_win_eff") == 1]
    losses    = [t for t in trades if t.get("_is_win_eff") == 0]
    decided   = len(wins) + len(losses)
    winrate   = (len(wins) / decided * 100) if decided else 0
    rrs       = [t["_rr_eff"] for t in trades if t.get("_rr_eff") is not None]
    avg_rr    = (sum(rrs) / len(rrs)) if rrs else 0

    # Par instrument
    per_instr = {}
    for instr in INSTRUMENTS:
        i_days   = [d for d in days if d["instrument"] == instr]
        i_trades = [t for t in trades if t["_instrument"] == instr]
        if not i_trades and not i_days:
            continue
        i_wins    = sum(1 for t in i_trades if t.get("_is_win_eff") == 1)
        i_losses  = sum(1 for t in i_trades if t.get("_is_win_eff") == 0)
        i_decided = i_wins + i_losses
        i_rrs = [t["_rr_eff"] for t in i_trades if t.get("_rr_eff") is not None]
        per_instr[instr] = {
            "count": len(i_days), "entries": len(i_days), "trades": len(i_trades),
            "pnl": sum((t.get("_pnl_eff", t.get("pnl")) or 0) for t in i_trades),
            "wins": i_wins, "losses": i_losses,
            "winrate": (i_wins / i_decided * 100) if i_decided else 0,
            "avg_rr": (sum(i_rrs) / len(i_rrs)) if i_rrs else 0,
        }

    by_setup   = _bucket(trades, lambda t: t.get("strategy"))
    by_session = _bucket(trades, lambda t: t.get("_session"))
    by_bias    = _bucket(trades, lambda t: t.get("_htf_bias"))
    by_emo     = _bucket(trades, lambda t: t.get("emotional_state"))
    by_tag     = _bucket_multi(trades, lambda t: t.get("tags"))

    def dow_key(t):
        try:
            return dt_cls.strptime(t["_date"], "%Y-%m-%d").weekday()
        except Exception:
            return None
    by_dow = _bucket(trades, dow_key)

    # PnL cumule
    daily_pnl = {}
    for t in trades:
        if t.get("_date"):
            daily_pnl[t["_date"]] = daily_pnl.get(t["_date"], 0) + (t.get("_pnl_eff", t.get("pnl")) or 0)
    cum, cumulative = 0, []
    for d in sorted(daily_pnl):
        cum += daily_pnl[d]
        cumulative.append({"date": d, "pnl": daily_pnl[d], "cumulative": cum})

    # Heatmap d'activite
    activity = {}
    for d in days:
        a = activity.setdefault(d["date"], {"date": d["date"], "entries": 0, "pnl": 0, "wins": 0, "losses": 0})
        a["entries"] += 1
    for t in trades:
        key = t.get("_date")
        if key and key in activity:
            activity[key]["pnl"] += (t.get("_pnl_eff", t.get("pnl")) or 0)
            if t.get("_is_win_eff") == 1:
                activity[key]["wins"] += 1
            elif t.get("_is_win_eff") == 0:
                activity[key]["losses"] += 1

    # Distribution RR
    rr_buckets = [0]*6
    for v in rrs:
        if   v < 0: rr_buckets[0] += 1
        elif v < 1: rr_buckets[1] += 1
        elif v < 2: rr_buckets[2] += 1
        elif v < 3: rr_buckets[3] += 1
        elif v < 5: rr_buckets[4] += 1
        else:       rr_buckets[5] += 1

    streak   = _streak_stats(days)
    insights = _build_insights(trades, by_setup, by_session, by_emo, by_bias, winrate, decided)
    drawdown = _compute_drawdown_series(cumulative)
    pnl_histogram = _build_pnl_histogram([
        t.get("_pnl_eff", t.get("pnl"))
        for t in trades
        if t.get("_pnl_known") or t.get("pnl") is not None
    ])
    period_compare = _build_period_comparison(days, trades)

    return jsonify({
        "total_pnl": total_pnl, "winrate": winrate,
        "wins": len(wins), "losses": len(losses),
        "num_entries": len(days), "num_trades": len(trades), "avg_rr": avg_rr,
        "per_instrument": per_instr, "cumulative": cumulative,
        "streak": streak["current"], "best_streak": streak["best"],
        "by_setup": by_setup, "by_session": by_session,
        "by_bias": by_bias, "by_emo": by_emo, "by_dow": by_dow, "by_tag": by_tag,
        "activity": sorted(activity.values(), key=lambda x: x["date"]),
        "rr_buckets": rr_buckets, "insights": insights,
        "drawdown": drawdown,
        "pnl_histogram": pnl_histogram,
        "period_compare": period_compare,
    })


