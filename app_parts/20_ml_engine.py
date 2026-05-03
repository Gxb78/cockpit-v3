# ---------- ML Engine : apprentissage automatique sur les trades ----------
#
# Moteur d'analyse utilisant UNIQUEMENT sqlite3 + json (pas de pandas).
# S'execute a la demande, pas de background worker.
# Cache les resultats avec invalidation basee sur le timestamp du dernier trade modifie.
# Detecte des patterns, correlations et insights cross-trades.

import json
import time as _ml_time
from datetime import date, datetime, timedelta

# =========================================================================
# CACHE avec invalidation automatique
# =========================================================================

_ML_CACHE = {}
_ML_CACHE_MAX = 20
_ML_CACHE_PREFIXES = ("pattern_", "profile_", "similar_", "insights_")


def _trade_mtime(db):
    """Timestamp du trade le plus recemment modifie."""
    row = db.execute("SELECT MAX(updated_at) FROM trades").fetchone()
    return row[0] if row and row[0] else ""


def _ml_cache_key(prefix, db):
    return f"{prefix}|{_trade_mtime(db)}"


def _ml_cache_get(key):
    entry = _ML_CACHE.get(key)
    if entry is None:
        return None
    if _ml_time.time() - entry["ts"] > 300:  # TTL 5 min
        del _ML_CACHE[key]
        return None
    return entry["data"]


def _ml_cache_put(key, data):
    _ML_CACHE[key] = {"data": data, "ts": _ml_time.time()}
    if len(_ML_CACHE) > _ML_CACHE_MAX:
        oldest = min(_ML_CACHE, key=lambda k: _ML_CACHE[k]["ts"])
        del _ML_CACHE[oldest]


def invalidate_ml_cache():
    """Invalide TOUT le cache ML."""
    global _ML_CACHE
    _ML_CACHE = {k: v for k, v in _ML_CACHE.items()
                 if not any(k.startswith(p) for p in _ML_CACHE_PREFIXES)}


# =========================================================================
# RECUPERATION DES DONNEES
# =========================================================================

def _load_trades_with_context(db, instrument=None, date_from=None, date_to=None):
    """Charge tous les trades avec le contexte du jour associe.

    Utilise une seule jointure SQL — pas de boucle N+1.
    Retourne une liste de dicts plats enrichis.
    """
    q = """
        SELECT t.*, d.date AS _date, d.instrument AS _instrument,
               d.session AS _session, d.htf_bias AS _htf_bias,
               d.tags AS _day_tags
        FROM trades t
        JOIN days d ON d.id = t.day_id
        WHERE 1=1
    """
    p = []
    if instrument and instrument != "ALL":
        q += " AND d.instrument=?"
        p.append(instrument)
    if date_from:
        q += " AND d.date>=?"
        p.append(date_from)
    if date_to:
        q += " AND d.date<=?"
        p.append(date_to)
    q += " ORDER BY d.date, t.id"

    rows = db.execute(q, p).fetchall()
    trades = []
    for r in rows:
        t = dict(r)
        t["tags"] = _decode_json(t.get("tags"), [])
        t["_day_tags"] = _decode_json(t.get("_day_tags"), [])
        # Utiliser derive_trade_metrics pour les metriques coherentes avec stats API
        derived = derive_trade_metrics(t)
        t["_pnl_eff"] = derived["pnl"] or 0
        t["_is_win_eff"] = derived["is_win"]
        t["_rr_eff"] = derived["rr"]
        trades.append(t)
    return trades


def _decode_json(val, default):
    if val and isinstance(val, str):
        try:
            return json.loads(val)
        except Exception:
            return default
    return default if val is None else val


def _is_recent(days_ago, date_str):
    """Check if date_str is within the last N days."""
    try:
        dt = date.fromisoformat(date_str)
        return (date.today() - dt).days <= days_ago
    except Exception:
        return False


# =========================================================================
# MOTEUR DE PATTERNS — Connaissances extraites des trades
# =========================================================================

_MIN_TRADES_FOR_PATTERN = 3  # Minimum de trades pour un pattern valide


def analyze_patterns(db, instrument=None, date_from=None, date_to=None):
    """Analyse tous les trades et extrait les patterns significatifs.

    Retourne une liste de knowledge_cards (dicts).
    Chaque card a: kind, title, body, confidence, evidence_count, total_count, tags
    """
    cache_key = _ml_cache_key("pattern", db)
    if instrument:
        cache_key += f"|inst={instrument}"
    if date_from:
        cache_key += f"|from={date_from}"
    if date_to:
        cache_key += f"|to={date_to}"

    cached = _ml_cache_get(cache_key)
    if cached:
        return cached

    trades = _load_trades_with_context(db, instrument, date_from, date_to)
    if not trades:
        return []

    cards = []

    # --- Pattern 1: Performance par strategie ---
    _detect_strategy_performance(trades, cards)

    # --- Pattern 2: Performance par session ---
    _detect_session_patterns(trades, cards)

    # --- Pattern 3: Correlation biais HTF ---
    _detect_bias_correlation(trades, cards)

    # --- Pattern 4: Direction preferee ---
    _detect_direction_performance(trades, cards)

    # --- Pattern 5: Lecons recurrentes ---
    _detect_lesson_clusters(trades, cards)

    # --- Pattern 6: Execution quality vs winrate ---
    _detect_execution_impact(trades, cards)

    # --- Pattern 7: StdV level sweet spot ---
    _detect_stdv_sweetspot(trades, cards)

    # --- Pattern 8: Theses validees vs PnL ---
    _detect_thesis_patterns(trades, cards)

    # --- Pattern 9: R:R optimal ---
    _detect_rr_sweetspot(trades, cards)

    # --- Pattern 10: Recent trends ---
    _detect_recent_trends(trades, cards)

    _ml_cache_put(cache_key, cards)
    return cards


# ---------------------------------------------------------------------------
# Detecteurs de patterns individuels
# ---------------------------------------------------------------------------

def _bucket_trades(trades, key_fn):
    """Groupe les trades par une cle et calcule les stats.

    Retourne {key: {"wins": N, "losses": N, "pnl": float, "total": N}}
    """
    buckets = {}
    for t in trades:
        k = key_fn(t)
        if k is None:
            continue
        b = buckets.setdefault(k, {"wins": 0, "losses": 0, "pnl": 0.0, "total": 0})
        b["total"] += 1
        b["pnl"] += t.get("_pnl_eff", 0)
        if t.get("_is_win_eff") == 1:
            b["wins"] += 1
        elif t.get("_is_win_eff") == 0:
            b["losses"] += 1
    for k, v in buckets.items():
        decided = v["wins"] + v["losses"]
        v["winrate"] = (v["wins"] / decided * 100) if decided else 0
    return buckets


def _detect_strategy_performance(trades, cards):
    """Strategie avec meilleur/pire winrate."""
    by_strat = _bucket_trades(trades, lambda t: t.get("strategy"))
    eligible = {k: v for k, v in by_strat.items()
                if v["wins"] + v["losses"] >= _MIN_TRADES_FOR_PATTERN}
    if not eligible:
        return

    best = max(eligible.items(), key=lambda x: x[1]["winrate"])
    worst = min(eligible.items(), key=lambda x: x[1]["winrate"])

    if best[1]["winrate"] >= 55:
        cards.append({
            "kind": "best_strategy", "version": 1,
            "title": f"Meilleure strategie : {best[0]}",
            "body": f"{best[1]['winrate']:.0f}% WR sur {best[1]['wins']+best[1]['losses']} trades | PnL {best[1]['pnl']:+.0f}$",
            "confidence": min(best[1]["winrate"] / 100, 0.95),
            "evidence_count": best[1]["wins"] + best[1]["losses"],
            "total_count": best[1]["total"],
            "tags": ["strategy", best[0] or "unknown"],
        })

    if worst[1]["winrate"] < 45 and worst[0] != best[0]:
        cards.append({
            "kind": "worst_strategy", "version": 1,
            "title": f"Strategie a eviter : {worst[0]}",
            "body": f"{worst[1]['winrate']:.0f}% WR sur {worst[1]['wins']+worst[1]['losses']} trades | PnL {worst[1]['pnl']:+.0f}$",
            "confidence": min((100 - worst[1]["winrate"]) / 100, 0.95),
            "evidence_count": worst[1]["wins"] + worst[1]["losses"],
            "total_count": worst[1]["total"],
            "tags": ["strategy", worst[0] or "unknown", "warning"],
        })


def _detect_session_patterns(trades, cards):
    """Performance par session de trading."""
    by_session = _bucket_trades(trades, lambda t: t.get("_session"))
    eligible = {k: v for k, v in by_session.items()
                if v["wins"] + v["losses"] >= _MIN_TRADES_FOR_PATTERN}
    if not eligible:
        return

    best = max(eligible.items(), key=lambda x: x[1]["winrate"])
    if best[1]["winrate"] >= 55:
        cards.append({
            "kind": "best_session", "version": 1,
            "title": f"Meilleure session : {best[0]}",
            "body": f"{best[1]['winrate']:.0f}% WR sur {best[1]['wins']+best[1]['losses']} trades",
            "confidence": min(best[1]["winrate"] / 100, 0.9),
            "evidence_count": best[1]["wins"] + best[1]["losses"],
            "total_count": best[1]["total"],
            "tags": ["session", best[0] or "unknown"],
        })

    # Session avec mauvais resultats
    worst = min(eligible.items(), key=lambda x: x[1]["winrate"])
    if worst[1]["winrate"] < 40 and best[0] != worst[0]:
        cards.append({
            "kind": "worst_session", "version": 1,
            "title": f"Session difficile : {worst[0]}",
            "body": f"{worst[1]['winrate']:.0f}% WR — eviter ou adapter ta strategie",
            "confidence": min((100 - worst[1]["winrate"]) / 100, 0.9),
            "evidence_count": worst[1]["wins"] + worst[1]["losses"],
            "total_count": worst[1]["total"],
            "tags": ["session", worst[0] or "unknown", "warning"],
        })


def _detect_bias_correlation(trades, cards):
    """Correlation entre biais HTF et performance."""
    by_bias = _bucket_trades(trades, lambda t: t.get("_htf_bias"))
    eligible = {k: v for k, v in by_bias.items()
                if v["wins"] + v["losses"] >= _MIN_TRADES_FOR_PATTERN}
    if not eligible:
        return

    best = max(eligible.items(), key=lambda x: x[1]["winrate"])
    if best[1]["winrate"] >= 58:
        cards.append({
            "kind": "bias_correlation", "version": 1,
            "title": f"Biais favorable : {best[0]}",
            "body": f"{best[1]['winrate']:.0f}% WR quand HTF est {best[0]}",
            "confidence": min(best[1]["winrate"] / 100, 0.9),
            "evidence_count": best[1]["wins"] + best[1]["losses"],
            "total_count": best[1]["total"],
            "tags": ["bias", best[0] or "unknown"],
        })


def _detect_direction_performance(trades, cards):
    """Performance par direction (long/short)."""
    by_dir = _bucket_trades(trades, lambda t: t.get("direction"))
    eligible = {k: v for k, v in by_dir.items()
                if v["wins"] + v["losses"] >= _MIN_TRADES_FOR_PATTERN}
    if not eligible:
        return

    for direction, stats in eligible.items():
        if stats["winrate"] >= 60:
            cards.append({
                "kind": "direction_strength", "version": 1,
                "title": f"Force{'e' if direction=='short' else 't'} en {direction}",
                "body": f"{stats['winrate']:.0f}% WR — PnL {stats['pnl']:+.0f}$ sur {stats['total']} trades",
                "confidence": min(stats["winrate"] / 100, 0.9),
                "evidence_count": stats["wins"] + stats["losses"],
                "total_count": stats["total"],
                "tags": ["direction", direction or "unknown"],
            })


def _detect_lesson_clusters(trades, cards):
    """Extraction des lecons recurrentes par similarite de mots-cles."""
    lessons = [t.get("lessons_learned", "") for t in trades
               if t.get("lessons_learned") and isinstance(t.get("lessons_learned"), str)]

    if len(lessons) < 3:
        return

    # Mots-cles de lecons frequents
    keywords = {}
    for lesson in lessons:
        words = lesson.lower().split()
        for w in words:
            if len(w) > 3 and w not in ("avec", "pour", "dans", "plus", "tres", "bien",
                                          "faire", "etait", "mais", "donc", "quand", "leur"):
                keywords[w] = keywords.get(w, 0) + 1

    # Top themes
    top = sorted(keywords.items(), key=lambda x: -x[1])[:5]
    meaningful = [(k, v) for k, v in top if v >= 2]

    if meaningful:
        cards.append({
            "kind": "lesson_themes", "version": 1,
            "title": "Themes recurrents dans les lecons",
            "body": ", ".join(f"'{k}' ({v}x)" for k, v in meaningful),
            "confidence": min(len(meaningful) / 10, 0.8),
            "evidence_count": len(lessons),
            "total_count": len(trades),
            "tags": ["lessons", "themes"],
        })


def _detect_execution_impact(trades, cards):
    """Correlation qualite execution → winrate."""
    with_quality = [t for t in trades if t.get("execution_quality") is not None]
    if len(with_quality) < _MIN_TRADES_FOR_PATTERN:
        return

    high = [t for t in with_quality if t["execution_quality"] >= 4]
    low = [t for t in with_quality if t["execution_quality"] <= 2]

    if len(high) >= _MIN_TRADES_FOR_PATTERN:
        h_wins = sum(1 for t in high if t.get("_is_win_eff") == 1)
        h_total = sum(1 for t in high if t.get("_is_win_eff") in (0, 1))
        h_wr = (h_wins / h_total * 100) if h_total else 0
        if h_wr >= 55:
            cards.append({
                "kind": "execution_quality", "version": 1,
                "title": "Bonne execution = bons resultats",
                "body": f"{h_wr:.0f}% WR quand qualite >= 4/5 ({h_total} trades)",
                "confidence": min(h_wr / 100, 0.85),
                "evidence_count": h_total,
                "total_count": len(with_quality),
                "tags": ["execution", "quality"],
            })

    if len(low) >= _MIN_TRADES_FOR_PATTERN:
        l_wins = sum(1 for t in low if t.get("_is_win_eff") == 1)
        l_total = sum(1 for t in low if t.get("_is_win_eff") in (0, 1))
        l_wr = (l_wins / l_total * 100) if l_total else 0
        if l_wr < 45:
            cards.append({
                "kind": "execution_warning", "version": 1,
                "title": "Execution faible = pertes",
                "body": f"{l_wr:.0f}% WR quand qualite <= 2/5 ({l_total} trades) — travailler le plan de trade",
                "confidence": min((100 - l_wr) / 100, 0.85),
                "evidence_count": l_total,
                "total_count": len(with_quality),
                "tags": ["execution", "warning"],
            })


# =========================================================================
# AUTO-INVALIDATION : hook after_request
# =========================================================================

_ML_TRADE_MUTATIONS = {
    "create_trade", "update_trade", "delete_trade",
    "create_day", "update_day", "delete_day",
}


@app.after_request
def _ml_invalidate_on_mutation(response):
    """Invalide le cache ML apres chaque creation/modification/suppression de trade/day.

    S'execute silencieusement sans ralentir la reponse.
    """
    if response.status_code in (200, 201) and request.endpoint in _ML_TRADE_MUTATIONS:
        invalidate_ml_cache()
    return response


# =========================================================================
# DETECTEURS DE PATTERNS (suite)
# =========================================================================


def _detect_stdv_sweetspot(trades, cards):
    """Niveau STDV optimal (Midnight Model uniquement)."""
    stdv_trades = [t for t in trades if t.get("stdv_level") is not None]
    if len(stdv_trades) < _MIN_TRADES_FOR_PATTERN:
        return

    by_stdv = _bucket_trades(stdv_trades, lambda t: t.get("stdv_level"))
    eligible = {k: v for k, v in by_stdv.items()
                if v["wins"] + v["losses"] >= 2}
    if not eligible:
        return

    best = max(eligible.items(), key=lambda x: x[1]["winrate"])
    if best[1]["winrate"] >= 55:
        cards.append({
            "kind": "stdv_sweetspot", "version": 1,
            "title": f"Sweet spot STDV : {best[0]}",
            "body": f"{best[1]['winrate']:.0f}% WR sur {best[1]['total']} trades",
            "confidence": min(best[1]["winrate"] / 100, 0.85),
            "evidence_count": best[1]["wins"] + best[1]["losses"],
            "total_count": best[1]["total"],
            "tags": ["stdv", "midnight_model"],
        })


def _detect_thesis_patterns(trades, cards):
    """Performance quand la these est validee ou non."""
    with_thesis = [t for t in trades if t.get("thesis_validated") in ("yes", "no", "partial")]
    if len(with_thesis) < _MIN_TRADES_FOR_PATTERN:
        return

    by_thesis = _bucket_trades(with_thesis, lambda t: t.get("thesis_validated"))
    yes = by_thesis.get("yes")
    no = by_thesis.get("no")

    if yes and yes["wins"] + yes["losses"] >= 3:
        cards.append({
            "kind": "thesis_validated", "version": 1,
            "title": "These validee = confiance",
            "body": f"{yes['winrate']:.0f}% WR quand these validee ({yes['total']} trades)",
            "confidence": min(yes["winrate"] / 100, 0.9),
            "evidence_count": yes["wins"] + yes["losses"],
            "total_count": yes["total"],
            "tags": ["thesis", "validation"],
        })

    if no and no["wins"] + no["losses"] >= 3 and no["winrate"] < 40:
        cards.append({
            "kind": "thesis_invalid", "version": 1,
            "title": "These non validee = danger",
            "body": f"{no['winrate']:.0f}% WR quand these NON validee ({no['total']} trades)",
            "confidence": min((100 - no["winrate"]) / 100, 0.85),
            "evidence_count": no["wins"] + no["losses"],
            "total_count": no["total"],
            "tags": ["thesis", "warning"],
        })


def _detect_rr_sweetspot(trades, cards):
    """Plage de R:R optimale."""
    with_rr = [t for t in trades if t.get("_rr_eff") is not None and t.get("_is_win_eff") is not None]
    if len(with_rr) < _MIN_TRADES_FOR_PATTERN:
        return

    # Buckets R:R
    buckets = {">=3": [], "2-3": [], "1-2": [], "<1": []}
    for t in with_rr:
        rr = t["_rr_eff"]
        if rr >= 3:
            buckets[">=3"].append(t)
        elif rr >= 2:
            buckets["2-3"].append(t)
        elif rr >= 1:
            buckets["1-2"].append(t)
        else:
            buckets["<1"].append(t)

    for label, group in buckets.items():
        if len(group) >= 2:
            wins = sum(1 for t in group if t["_is_win_eff"] == 1)
            total = sum(1 for t in group if t["_is_win_eff"] in (0, 1))
            wr = (wins / total * 100) if total else 0
            if wr >= 55:
                cards.append({
                    "kind": "rr_sweetspot", "version": 1,
                    "title": f"R:R {label} : {wr:.0f}% WR",
                    "body": f"{total} trades avec R:R {label}",
                    "confidence": min(wr / 100, 0.8),
                    "evidence_count": total,
                    "total_count": len(with_rr),
                    "tags": ["rr", "risk_reward"],
                })


def _detect_recent_trends(trades, cards):
    """Tendance recente (30 derniers jours) comparee a l'ensemble."""
    recent = [t for t in trades if t.get("_date") and _is_recent(30, t["_date"])]
    if len(recent) < _MIN_TRADES_FOR_PATTERN:
        return

    r_wins = sum(1 for t in recent if t.get("_is_win_eff") == 1)
    r_total = sum(1 for t in recent if t.get("_is_win_eff") in (0, 1))
    r_wr = (r_wins / r_total * 100) if r_total else 0

    all_decided = sum(1 for t in trades if t.get("_is_win_eff") in (0, 1))
    all_wins = sum(1 for t in trades if t.get("_is_win_eff") == 1)
    all_wr = (all_wins / all_decided * 100) if all_decided else 0

    delta = r_wr - all_wr
    if abs(delta) >= 8:
        trend = "hausse" if delta > 0 else "baisse"
        color = "positive" if delta > 0 else "negative"
        cards.append({
            "kind": "recent_trend", "version": 1,
            "title": f"Tendance recente en {trend}",
            "body": f"{r_wr:.0f}% WR (30j) vs {all_wr:.0f}% WR (global) — {delta:+.0f}pts",
            "confidence": min(abs(delta) / 100, 0.8),
            "evidence_count": r_total,
            "total_count": len(recent),
            "tags": ["trend", color, "recent"],
        })


# =========================================================================
# PROFIL DU TRADER
# =========================================================================

def build_trader_profile(db, instrument=None):
    """Construit le profil global du trader : forces, faiblesses, preferences.

    Retourne un dict structure.
    """
    cache_key = _ml_cache_key("profile", db)
    if instrument:
        cache_key += f"|inst={instrument}"

    cached = _ml_cache_get(cache_key)
    if cached:
        return cached

    trades = _load_trades_with_context(db, instrument)
    if not trades:
        profile = {"empty": True, "total_trades": 0}
        _ml_cache_put(cache_key, profile)
        return profile

    # Stats globales
    wins = sum(1 for t in trades if t.get("_is_win_eff") == 1)
    losses = sum(1 for t in trades if t.get("_is_win_eff") == 0)
    decided = wins + losses
    winrate = (wins / decided * 100) if decided else 0
    total_pnl = sum(t.get("_pnl_eff", 0) for t in trades)
    rrs = [t.get("_rr_eff") for t in trades if t.get("_rr_eff") is not None]
    avg_rr = (sum(rrs) / len(rrs)) if rrs else 0

    # Forces (top 3 patterns les plus confiants)
    cards = analyze_patterns(db, instrument)
    strengths = [c for c in cards if "warning" not in c.get("tags", [])][:3]
    weaknesses = [c for c in cards if "warning" in c.get("tags", [])][:3]

    # Strategies preferees
    by_strat = _bucket_trades(trades, lambda t: t.get("strategy"))
    preferred_strats = sorted(by_strat.items(), key=lambda x: -x[1]["total"])[:3]

    # Instruments
    by_instr = _bucket_trades(trades, lambda t: t.get("_instrument"))
    preferred_instrs = sorted(by_instr.items(), key=lambda x: -x[1]["total"])[:3]

    profile = {
        "empty": False,
        "total_trades": len(trades),
        "winrate": round(winrate, 1),
        "total_pnl": round(total_pnl, 2),
        "avg_rr": round(avg_rr, 2),
        "wins": wins,
        "losses": losses,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "preferred_strategies": [
            {"name": k, "total": v["total"], "winrate": round(v["winrate"], 1), "pnl": round(v["pnl"], 2)}
            for k, v in preferred_strats
        ],
        "preferred_instruments": [
            {"name": k, "total": v["total"], "winrate": round(v["winrate"], 1), "pnl": round(v["pnl"], 2)}
            for k, v in preferred_instrs
        ],
    }

    _ml_cache_put(cache_key, profile)
    return profile


# =========================================================================
# RECHERCHE DE SETUPS SIMILAIRES
# =========================================================================

def find_similar_setups(db, trade_id, limit=5):
    """Trouve des trades similaires a un trade donne.

    Similarite basee sur: strategie, direction, instrument, stdv_level, scenario.
    """
    cache_key = _ml_cache_key(f"similar_{trade_id}", db)

    cached = _ml_cache_get(cache_key)
    if cached:
        return cached

    # Charger le trade de reference
    ref_row = db.execute("SELECT * FROM trades WHERE id=?", (trade_id,)).fetchone()
    if not ref_row:
        return {"error": "Trade introuvable"}
    ref = dict(ref_row)
    ref["tags"] = _decode_json(ref.get("tags"), [])

    # Charger le jour associe
    day_row = db.execute("SELECT * FROM days WHERE id=?", (ref["day_id"],)).fetchone()
    ref_context = dict(day_row) if day_row else {}

    # Tous les autres trades avec contexte
    others = _load_trades_with_context(db)

    # Calculer le score de similarite
    scored = []
    for t in others:
        if t["id"] == trade_id:
            continue

        score = 0
        # Meme strategie (+3)
        if t.get("strategy") and t["strategy"] == ref.get("strategy"):
            score += 3
        # Meme direction (+2)
        if t.get("direction") and t["direction"] == ref.get("direction"):
            score += 2
        # Meme instrument (+2)
        if t.get("_instrument") and t["_instrument"] == ref_context.get("instrument"):
            score += 2
        # Meme stdv_level (+1)
        if t.get("stdv_level") is not None and t["stdv_level"] == ref.get("stdv_level"):
            score += 1
        # Meme biais HTF (+1)
        if t.get("_htf_bias") and t["_htf_bias"] == ref_context.get("htf_bias"):
            score += 1

        if score > 0:
            scored.append({
                "trade": {
                    "id": t["id"],
                    "date": t.get("_date"),
                    "strategy": t.get("strategy"),
                    "direction": t.get("direction"),
                    "instrument": t.get("_instrument"),
                    "pnl": t.get("_pnl_eff"),
                    "is_win": t.get("_is_win_eff"),
                    "rr": t.get("_rr_eff"),
                    "execution_quality": t.get("execution_quality"),
                    "thesis_validated": t.get("thesis_validated"),
                },
                "similarity_score": score,
            })

    scored.sort(key=lambda x: -x["similarity_score"])

    result = {
        "reference_trade": {
            "id": ref["id"],
            "date": ref_context.get("date"),
            "instrument": ref_context.get("instrument"),
            "strategy": ref.get("strategy"),
            "direction": ref.get("direction"),
            "stdv_level": ref.get("stdv_level"),
            "scenario": ref.get("scenario"),
            "pnl": ref.get("pnl"),
            "is_win": ref.get("is_win"),
            "rr": ref.get("rr"),
            "lessons_learned": ref.get("lessons_learned"),
        },
        "similar_trades": scored[:limit],
        "total_candidates": len(scored),
    }

    _ml_cache_put(cache_key, result)
    return result


# =========================================================================
# STATISTIQUES DU SYSTEME D'APPRENTISSAGE
# =========================================================================

def get_ml_stats(db):
    """Retourne des metriques sur l'etat de l'apprentissage."""
    cards = analyze_patterns(db)
    total_trades = db.execute("SELECT COUNT(*) FROM trades").fetchone()[0]
    total_days = db.execute("SELECT COUNT(*) FROM days").fetchone()[0]
    cache_entries = len(_ML_CACHE)

    return {
        "total_trades": total_trades,
        "total_days": total_days,
        "patterns_count": len(cards),
        "cache_entries": cache_entries,
        "has_enough_data": total_trades >= _MIN_TRADES_FOR_PATTERN,
        "last_analysis": cards[:5] if cards else [],
    }
