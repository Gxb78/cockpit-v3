# ---------- Day Service Layer ----------
# Couche métier pour les opérations sur les jours.
# Réutilisable depuis les routes, chat IA, et tests.

def service_create_day(data_json, db):
    """Crée un jour avec validations.
    
    Retourne:
        (day_dict, 201) si succès
        (error_dict, code_error) si erreur
    """
    # Extraire et valider date et instrument
    instrument = _canonical_instrument(data_json.get("instrument"))
    raw_date = data_json.get("date")
    
    if not raw_date or not instrument:
        return {"error": "date et instrument requis"}, 400
    
    try:
        date_val = _validate_date_key(raw_date, "date")
    except ValueError as _exc:
        return {"error": str(_exc)}, 400
    
    if instrument not in INSTRUMENTS:
        return {"error": f"instrument doit être parmi {INSTRUMENTS}"}, 400
    
    # Normaliser et valider le payload
    payload, errors = normalize_day_payload(data_json)
    if errors:
        return {"error": "; ".join(errors)}, 400
    
    # Ajouter les champs obligatoires
    payload.update({
        "date": date_val,
        "instrument": instrument,
        "schema_version": SCHEMA_VERSION,
        "created_at": now_iso(),
        "updated_at": now_iso(),
    })
    
    # Insérer en BD
    cols = _safe_columns(payload.keys(), "days")
    sql = f"INSERT INTO days ({','.join(cols)}) VALUES ({','.join(['?']*len(cols))})"
    try:
        cur = db.execute(sql, [payload[c] for c in cols])
        db.commit()
        day = fetch_day(cur.lastrowid)
        return day, 201
    except sqlite3.IntegrityError:
        return {
            "error": f"Un jour avec la date {date_val} et l'instrument {instrument} existe déjà"
        }, 409


def service_get_day(day_id, db):
    """Récupère un jour avec ses trades.
    
    Retourne:
        (day_dict, 200) si trouve
        (error_dict, 404) sinon
    """
    d = fetch_day(day_id)
    if not d:
        return {"error": "not found"}, 404
    return d, 200


def service_lookup_day(date_str, instrument_str, db):
    """Recherche un jour par date et instrument.
    
    Retourne:
        (day_dict, 200) si trouve
        (None, 404) sinon
    """
    instrument = _canonical_instrument(instrument_str)
    
    if not date_str or not instrument:
        return {"error": "date et instrument requis"}, 400
    
    try:
        date = _validate_date_key(date_str, "date")
    except ValueError as _exc:
        return {"error": str(_exc)}, 400
    
    row = db.execute(
        "SELECT * FROM days WHERE date=? AND instrument=?", (date, instrument)
    ).fetchone()
    
    if not row:
        return None, 404
    
    d = row_to_dict(row)
    d["tags"] = _decode_json(d.get("tags"), [])
    return d, 200


def service_update_day(day_id, data_json, db):
    """Met à jour un jour.
    
    Retourne:
        (day_dict, 200) si succès
        (error_dict, code_error) sinon
    """
    # Vérifier que le jour existe
    existing_row = db.execute("SELECT * FROM days WHERE id=?", (day_id,)).fetchone()
    if not existing_row:
        return {"error": "not found"}, 404
    
    # Normaliser et valider le payload
    payload, errors = normalize_day_payload(data_json)
    if errors:
        return {"error": "; ".join(errors)}, 400
    
    # Ajouter timestamp
    payload["updated_at"] = now_iso()
    
    # Mettre à jour en BD
    cols = _safe_columns(payload.keys(), "days")
    sets = ", ".join(f"{c}=?" for c in cols)
    try:
        db.execute(f"UPDATE days SET {sets} WHERE id=?", list(payload.values()) + [day_id])
        db.commit()
    except sqlite3.IntegrityError:
        return {
            "error": "Cette entrée existe déjà pour cette date et cet instrument"
        }, 409
    
    # Retourner le jour mis à jour
    return fetch_day(day_id), 200


def service_delete_day(day_id, db):
    """Supprime un jour et cascade (tous ses trades et screenshots).
    
    Retourne:
        ({"ok": True}, 200) si succès
        (error_dict, 404) sinon
    """
    # Vérifier existence
    if not db.execute("SELECT id FROM days WHERE id=?", (day_id,)).fetchone():
        return {"error": "day not found"}, 404
    
    # Supprimer les fichiers de screenshots en cascade
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
    
    # Supprimer le jour (cascade auto par FK)
    db.execute("DELETE FROM days WHERE id=?", (day_id,))
    db.commit()
    
    return {"ok": True}, 200


def service_delete_day_trades(day_id, db):
    """Supprime tous les trades d'un jour (avec leurs screenshots).
    
    Retourne:
        ({"ok": True, "deleted": count}, 200) si succès
        (error_dict, 404) sinon
    """
    # Vérifier que le jour existe
    if not db.execute("SELECT id FROM days WHERE id=?", (day_id,)).fetchone():
        return {"error": "day not found"}, 404
    
    # Supprimer les screenshots
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
    
    # Supprimer les trades et compter
    cur = db.execute("DELETE FROM trades WHERE day_id=?", (day_id,))
    deleted = cur.rowcount
    db.commit()
    
    return {"ok": True, "deleted": deleted}, 200
