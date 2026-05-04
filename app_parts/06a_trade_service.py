# ---------- Trade Service Layer ----------
# Couche métier pour les opérations sur les trades.
# Réutilisable depuis les routes, chat IA, et tests.

def service_create_trade(day_id, data_json, db):
    """Crée un trade avec validations et calculs.
    
    Retourne:
        (trade_dict, 201) si succès
        (error_dict, code_error) si erreur
    """
    # Valider que le jour existe
    if not db.execute("SELECT id FROM days WHERE id=?", (day_id,)).fetchone():
        return {"error": "day not found"}, 404
    
    # Normaliser et valider le payload
    payload, errors = normalize_trade_payload(data_json)
    if errors:
        return {"error": "; ".join(errors)}, 400
    
    # Valider la sémantique (avec les valeurs existantes du jour)
    semantic_errors = _validate_trade_semantics(payload)
    if semantic_errors:
        return {"error": "; ".join(semantic_errors)}, 400
    
    # Calculer PnL et plan
    _auto_calc_pnl(payload, day_id, db)
    payload.update(evaluate_trade_plan(payload))
    
    # Ajouter metadata
    payload.update({
        "day_id": day_id,
        "schema_version": SCHEMA_VERSION,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    })
    
    # Insérer en BD
    cols = _safe_columns(payload.keys(), "trades")
    cur = db.execute(
        f"INSERT INTO trades ({','.join(cols)}) VALUES ({','.join(['?']*len(cols))})",
        [payload[c] for c in cols]
    )
    db.commit()
    
    # Retourner le trade créé
    trade_id = cur.lastrowid
    t = row_to_dict(db.execute("SELECT * FROM trades WHERE id=?", (trade_id,)).fetchone())
    normalize_trade_response(t)
    t["screenshots"] = []
    return t, 201


def service_get_trade(trade_id, db):
    """Récupère un trade avec ses screenshots.
    
    Retourne:
        (trade_dict, 200) si trouve
        (error_dict, 404) si non trouve
    """
    row = db.execute("SELECT * FROM trades WHERE id=?", (trade_id,)).fetchone()
    if not row:
        return {"error": "not found"}, 404
    
    t = row_to_dict(row)
    normalize_trade_response(t)
    t["screenshots"] = _fetch_screenshots(trade_id)
    return t, 200


def service_update_trade(trade_id, data_json, db):
    """Met à jour un trade avec validations et recalculs.
    
    Retourne:
        (trade_dict, 200) si succès
        (error_dict, code_error) si erreur
    """
    # Récupérer le trade existant
    existing_row = db.execute("SELECT * FROM trades WHERE id=?", (trade_id,)).fetchone()
    if not existing_row:
        return {"error": "not found"}, 404
    
    # Normaliser et valider le payload partiels
    payload, errors = normalize_trade_payload(data_json, for_update=True)
    if errors:
        return {"error": "; ".join(errors)}, 400
    
    # Valider la sémantique (fusionner avec valeurs existantes)
    semantic_payload = row_to_dict(existing_row)
    semantic_payload.update(payload)
    semantic_errors = _validate_trade_semantics(semantic_payload)
    if semantic_errors:
        return {"error": "; ".join(semantic_errors)}, 400
    
    # Invalider PnL si un champ de calcul a change et que l'utilisateur
    # n'a pas fourni pnl explicitement
    _recalc_fields = {"entry_price", "exit_price", "take_profit", "stop_loss",
                      "position_size", "leverage", "direction"}
    if any(f in payload for f in _recalc_fields) and "pnl" not in payload:
        semantic_payload["pnl"] = None
        semantic_payload["is_win"] = None

    _auto_calc_pnl(semantic_payload, existing_row["day_id"], db)
    for field in ("pnl", "is_win"):
        if field in semantic_payload and semantic_payload[field] is not None:
            payload[field] = semantic_payload[field]
    payload.update(evaluate_trade_plan(semantic_payload))
    
    # Ajouter timestamp
    payload["updated_at"] = now_iso()
    
    # Mettre à jour en BD
    cols = _safe_columns(payload.keys(), "trades")
    sets = ", ".join(f"{c}=?" for c in cols)
    db.execute(f"UPDATE trades SET {sets} WHERE id=?", list(payload.values()) + [trade_id])
    db.commit()
    
    # Retourner le trade mis à jour
    t = row_to_dict(db.execute("SELECT * FROM trades WHERE id=?", (trade_id,)).fetchone())
    normalize_trade_response(t)
    t["screenshots"] = _fetch_screenshots(trade_id)
    return t, 200


def service_delete_trade(trade_id, db):
    """Supprime un trade et ses screenshots.
    
    Retourne:
        ({"ok": True}, 200) si succès
        (error_dict, 404) si non trouve
    """
    # Vérifier existence
    if not db.execute("SELECT id FROM trades WHERE id=?", (trade_id,)).fetchone():
        return {"error": "trade not found"}, 404
    
    # Supprimer les screenshots
    shots = db.execute(
        "SELECT filename FROM trade_screenshots WHERE trade_id=?", (trade_id,)
    ).fetchall()
    for s in shots:
        try:
            (SCREENSHOTS_DIR / s["filename"]).unlink(missing_ok=True)
        except Exception:
            pass
    
    # Supprimer le trade
    db.execute("DELETE FROM trades WHERE id=?", (trade_id,))
    db.commit()
    
    return {"ok": True}, 200


def service_list_trades_by_day(day_id, db):
    """Liste les trades d'un jour.
    
    Retourne:
        (trades_list, 200) si le jour existe
        (error_dict, 404) sinon
    """
    if not db.execute("SELECT id FROM days WHERE id=?", (day_id,)).fetchone():
        return {"error": "day not found"}, 404
    
    return _fetch_trades_for_day(day_id), 200


def service_batch_delete_trades(ids, db):
    """Supprime plusieurs trades par liste d'IDs.
    
    Retourne:
        ({"ok": True, "deleted": count}, 200) si succès
        (error_dict, code_error) sinon
    """
    # Valider la liste
    if not isinstance(ids, list) or not ids:
        return {"error": "ids requis: liste d'entiers"}, 400
    if len(ids) > 500:
        return {"error": "maximum 500 IDs par batch"}, 400
    
    # Convertir et valider chaque ID
    validated_ids = []
    for v in ids:
        try:
            validated_ids.append(int(v))
        except (TypeError, ValueError):
            return {"error": f"id invalide: {v}"}, 400
    
    # Supprimer les screenshots
    placeholders = ",".join("?" * len(validated_ids))
    shots = db.execute(
        f"SELECT filename FROM trade_screenshots WHERE trade_id IN ({placeholders})",
        validated_ids,
    ).fetchall()
    for s in shots:
        try:
            (SCREENSHOTS_DIR / s["filename"]).unlink(missing_ok=True)
        except Exception:
            pass
    
    # Supprimer les trades et compter
    cur = db.execute(f"DELETE FROM trades WHERE id IN ({placeholders})", validated_ids)
    deleted = cur.rowcount
    db.commit()
    
    return {"ok": True, "deleted": deleted}, 200


def service_list_favorite_trades(db):
    """Liste tous les trades marqués favoris.
    
    Retourne:
        trades_list
    """
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
    
    return result
