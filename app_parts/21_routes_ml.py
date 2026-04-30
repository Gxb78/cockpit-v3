# ---------- Routes API : Machine Learning / Insights ----------
#
# Endpoints :
#   GET  /api/ml/insights       — Patterns appris
#   GET  /api/ml/profile        — Profil du trader
#   GET  /api/ml/setups/similar — Setups similaires
#   POST /api/ml/analyze        — Analyse a la demande
#   POST /api/ml/invalidate     — Invalidation manuelle du cache
#   GET  /api/ml/stats          — Stats du moteur ML


@app.get("/api/ml/insights")
@app.get("/api/ml/patterns")
def ml_insights():
    """Retourne tous les patterns/knowledge_cards detectes.

    Query params:
      instrument (str) : filtrer par instrument
      from (str)       : date debut YYYY-MM-DD
      to (str)         : date fin YYYY-MM-DD
      kind (str)       : filtrer par type de pattern (optionnel)
    """
    db = get_db()
    instrument = _canonical_instrument(request.args.get("instrument"))
    date_from = request.args.get("from")
    date_to = request.args.get("to")
    kind_filter = request.args.get("kind")

    cards = analyze_patterns(db, instrument, date_from, date_to)

    if kind_filter:
        cards = [c for c in cards if c.get("kind") == kind_filter]

    return jsonify({
        "patterns": cards,
        "count": len(cards),
        "filters": {
            "instrument": instrument,
            "from": date_from,
            "to": date_to,
            "kind": kind_filter,
        },
    })


@app.get("/api/ml/profile")
def ml_profile():
    """Profil complet du trader : forces, faiblesses, preferences.

    Query params:
      instrument (str) : filtrer par instrument
    """
    db = get_db()
    instrument = _canonical_instrument(request.args.get("instrument"))
    profile = build_trader_profile(db, instrument)
    return jsonify(profile)


@app.get("/api/ml/setups/similar")
def ml_similar_setups():
    """Trouve des trades similaires a un trade de reference.

    Query params:
      trade_id (int, requis) : ID du trade de reference
      limit (int)            : nombre max de resultats (defaut 5)
    """
    trade_id = request.args.get("trade_id")
    if not trade_id:
        return jsonify({"error": "trade_id requis"}), 400

    try:
        trade_id = int(trade_id)
    except (ValueError, TypeError):
        return jsonify({"error": "trade_id doit etre un entier"}), 400

    limit = request.args.get("limit", 5, type=int)
    if limit < 1 or limit > 20:
        limit = 5

    db = get_db()
    result = find_similar_setups(db, trade_id, limit)
    return jsonify(result)


@app.post("/api/ml/analyze")
def ml_analyze():
    """Declenche une analyse a la demande.

    Body optionnel :
      instrument (str)
      from (str) : date debut YYYY-MM-DD
      to (str)   : date fin YYYY-MM-DD

    Retourne les patterns detectes.
    """
    data = request.get_json(silent=True) or {}
    db = get_db()
    instrument = _canonical_instrument(data.get("instrument"))
    date_from = data.get("from")
    date_to = data.get("to")

    patterns = analyze_patterns(db, instrument, date_from, date_to)
    profile = build_trader_profile(db, instrument)

    return jsonify({
        "ok": True,
        "patterns": patterns,
        "profile": profile,
        "pattern_count": len(patterns),
    })


@app.post("/api/ml/invalidate")
def ml_invalidate():
    """Invalide le cache ML. A appeler apres chaque modification de trade.

    Body optionnel :
      full (bool) : si True, vide tout le cache (defaut: seulement les caches ML)
    """
    data = request.get_json(silent=True) or {}
    if data.get("full"):
        _ML_CACHE.clear()
    else:
        invalidate_ml_cache()

    return jsonify({"ok": True, "cache_invalidated": True})


@app.get("/api/ml/stats")
def ml_stats():
    """Stats du moteur ML : nombre de patterns, etat du cache, etc."""
    db = get_db()
    stats = get_ml_stats(db)
    return jsonify(stats)
