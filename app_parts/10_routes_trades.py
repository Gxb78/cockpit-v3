# ---------- API : trades ----------

@app.get("/api/days/<int:day_id>/trades")
def list_trades(day_id):
    db = get_db()
    if not db.execute("SELECT id FROM days WHERE id=?", (day_id,)).fetchone():
        return jsonify({"error": "day not found"}), 404
    return jsonify(_fetch_trades_for_day(day_id))


@app.post("/api/days/<int:day_id>/trades")
def create_trade(day_id):
    db = get_db()
    if not db.execute("SELECT id FROM days WHERE id=?", (day_id,)).fetchone():
        return jsonify({"error": "day not found"}), 404

    data = request.get_json(force=True)
    payload, errors = normalize_trade_payload(data)
    if errors:
        return jsonify({"error": "; ".join(errors)}), 400
    semantic_errors = _validate_trade_semantics(payload)
    if semantic_errors:
        return jsonify({"error": "; ".join(semantic_errors)}), 400
    _auto_calc_pnl(payload, day_id, db)
    payload.update(evaluate_trade_plan(payload))

    payload.update({
        "day_id": day_id,
        "schema_version": SCHEMA_VERSION,
        "created_at": now_iso(), "updated_at": now_iso(),
    })
    cols = _safe_columns(payload.keys(), "trades")
    cur  = db.execute(
        f"INSERT INTO trades ({','.join(cols)}) VALUES ({','.join(['?']*len(cols))})",
        [payload[c] for c in cols]
    )
    db.commit()
    trade_id = cur.lastrowid
    t = row_to_dict(db.execute("SELECT * FROM trades WHERE id=?", (trade_id,)).fetchone())
    normalize_trade_response(t)
    t["screenshots"]   = []
    return jsonify(t), 201


@app.get("/api/trades/<int:trade_id>")
def get_trade(trade_id):
    db  = get_db()
    row = db.execute("SELECT * FROM trades WHERE id=?", (trade_id,)).fetchone()
    if not row:
        return jsonify({"error": "not found"}), 404
    t = row_to_dict(row)
    normalize_trade_response(t)
    t["screenshots"]   = _fetch_screenshots(trade_id)
    return jsonify(t)


@app.get("/api/trades/favorites")
def list_favorite_trades():
    """Retourne tous les trades marques favoris, avec les donnees du jour."""
    db = get_db()
    rows = db.execute("""
        SELECT t.*, d.date as day_date, d.instrument as day_instrument
        FROM trades t
        JOIN days d ON d.id = t.day_id
        WHERE t.tags LIKE '%"favoris"%'
        ORDER BY t.created_at DESC
    """).fetchall()
    result = []
    for row in rows:
        t = row_to_dict(row)
        normalize_trade_response(t)
        t["screenshots"] = _fetch_screenshots(t["id"])
        result.append(t)
    return jsonify(result)


@app.put("/api/trades/<int:trade_id>")
def update_trade(trade_id):
    data = request.get_json(force=True)
    db   = get_db()
    existing_row = db.execute("SELECT * FROM trades WHERE id=?", (trade_id,)).fetchone()
    if not existing_row:
        return jsonify({"error": "not found"}), 404

    payload, errors = normalize_trade_payload(data, for_update=True)
    if errors:
        return jsonify({"error": "; ".join(errors)}), 400
    semantic_payload = row_to_dict(existing_row)
    semantic_payload.update(payload)
    semantic_errors = _validate_trade_semantics(semantic_payload)
    if semantic_errors:
        return jsonify({"error": "; ".join(semantic_errors)}), 400
    _auto_calc_pnl(semantic_payload, existing_row["day_id"], db)
    for field in ("pnl", "is_win"):
        if field in semantic_payload and semantic_payload[field] is not None:
            payload[field] = semantic_payload[field]
    payload.update(evaluate_trade_plan(semantic_payload))

    payload["updated_at"] = now_iso()
    cols = _safe_columns(payload.keys(), "trades")
    sets = ", ".join(f"{c}=?" for c in cols)
    db.execute(f"UPDATE trades SET {sets} WHERE id=?", list(payload.values()) + [trade_id])
    db.commit()
    t = row_to_dict(db.execute("SELECT * FROM trades WHERE id=?", (trade_id,)).fetchone())
    normalize_trade_response(t)
    t["screenshots"]   = _fetch_screenshots(trade_id)
    return jsonify(t)


@app.delete("/api/trades/<int:trade_id>")
def delete_trade(trade_id):
    db = get_db()
    # Vérifier que le trade existe
    if not db.execute("SELECT id FROM trades WHERE id=?", (trade_id,)).fetchone():
        return jsonify({"error": "trade not found"}), 404
    shots = db.execute("SELECT filename FROM trade_screenshots WHERE trade_id=?", (trade_id,)).fetchall()
    for s in shots:
        try:
            (SCREENSHOTS_DIR / s["filename"]).unlink(missing_ok=True)
        except Exception:
            pass
    db.execute("DELETE FROM trades WHERE id=?", (trade_id,))
    db.commit()
    return jsonify({"ok": True})


@app.delete("/api/days/<int:day_id>/trades")
def delete_day_trades(day_id):
    """Supprime tous les trades d'un jour (avec leurs screenshots)."""
    db = get_db()
    if not db.execute("SELECT id FROM days WHERE id=?", (day_id,)).fetchone():
        return jsonify({"error": "day not found"}), 404
    shots = db.execute("""
        SELECT ts.filename FROM trade_screenshots ts
        JOIN trades t ON t.id = ts.trade_id
        WHERE t.day_id=?
    """, (day_id,)).fetchall()
    for s in shots:
        try:
            (SCREENSHOTS_DIR / s["filename"]).unlink(missing_ok=True)
        except Exception:
            pass
    db.execute("DELETE FROM trades WHERE day_id=?", (day_id,))
    db.commit()
    return jsonify({"ok": True, "deleted": len(shots)})


@app.post("/api/trades/batch-delete")
def batch_delete_trades():
    """Supprime plusieurs trades par une liste d'ids.

    Body: {"ids": [1, 2, 3]}
    """
    data = request.get_json(force=True) or {}
    raw_ids = data.get("ids", [])
    if not isinstance(raw_ids, list) or not raw_ids:
        return jsonify({"error": "ids requis: liste d'entiers"}), 400
    if len(raw_ids) > 500:
        return jsonify({"error": "maximum 500 IDs par batch"}), 400
    ids = []
    for v in raw_ids:
        try:
            ids.append(int(v))
        except (TypeError, ValueError):
            return jsonify({"error": f"id invalide: {v}"}), 400
    db = get_db()
    placeholders = ",".join("?" * len(ids))
    shots = db.execute(
        f"SELECT filename FROM trade_screenshots WHERE trade_id IN ({placeholders})",
        ids,
    ).fetchall()
    for s in shots:
        try:
            (SCREENSHOTS_DIR / s["filename"]).unlink(missing_ok=True)
        except Exception:
            pass
    cur = db.execute(f"DELETE FROM trades WHERE id IN ({placeholders})", ids)
    deleted = cur.rowcount
    db.commit()
    return jsonify({"ok": True, "deleted": deleted})


# ── Instruments distincts ──

@app.get("/api/trades/instruments")
def list_instruments():
    db = get_db()
    rows = db.execute(
        "SELECT DISTINCT instrument FROM days WHERE instrument IS NOT NULL AND instrument != '' ORDER BY instrument"
    ).fetchall()
    instruments = [row["instrument"] for row in rows]
    # Fallback sur INSTRUMENTS si la DB est vide
    if not instruments:
        instruments = INSTRUMENTS
    return jsonify({"ok": True, "instruments": instruments})


# ── Recherche full-text ──

@app.get("/api/journal/search")
def journal_search():
    q = request.args.get("q", "").strip()
    if not q or len(q) < 2:
        return jsonify({"ok": True, "days": []})
    raw_from = request.args.get("from")
    raw_to = request.args.get("to")
    instrument = request.args.get("instrument")
    try:
        date_from = _validate_date_key(raw_from, "from") if raw_from else None
        date_to = _validate_date_key(raw_to, "to") if raw_to else None
    except ValueError as _exc:
        return jsonify({"error": str(_exc)}), 400
    days = _query_days(
        search=q,
        date_from=date_from,
        date_to=date_to,
        instrument=instrument,
    )
    return jsonify({"ok": True, "days": days, "count": len(days)})
