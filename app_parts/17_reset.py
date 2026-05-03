# ---------- Danger zone : reset data ----------

import shutil as _shutil


@app.post("/api/data/reset")
@ratelimit(max_per_minute=3)
def reset_all_data():
    """Supprime TOUTES les donnees (jours, trades, screenshots).
    Cree un backup automatique avant l'operation.
    """
    if request.content_type != "application/json":
        return jsonify({"error": "Content-Type application/json requis"}), 415

    body = request.get_json(force=True, silent=True) or {}
    confirm = body.get("confirm", "")
    if confirm != "RESET ALL DATA":
        return jsonify({"error": 'Confirmation requise: envoyez {"confirm": "RESET ALL DATA"}'}), 400

    db = get_db()

    # Backup automatique
    backup_path = _backup_before_reset()
    if not backup_path:
        return jsonify({"error": "Impossible de creer le backup"}), 500

    # Compter avant suppression
    day_count = db.execute("SELECT COUNT(*) AS c FROM days").fetchone()["c"]
    trade_count = db.execute("SELECT COUNT(*) AS c FROM trades").fetchone()["c"]
    shot_count = db.execute("SELECT COUNT(*) AS c FROM trade_screenshots").fetchone()["c"]

    # Supprimer les screenshots du disque
    shots = db.execute("SELECT id, filename FROM trade_screenshots").fetchall()
    for s in shots:
        try:
            fp = Path(s["filename"])
            if fp.exists():
                fp.unlink()
        except Exception:
            pass

    # Vider les tables
    db.executescript("""
        DELETE FROM trade_screenshots;
        DELETE FROM trades;
        DELETE FROM days;
        VACUUM;
    """)
    db.commit()

    return jsonify({
        "ok": True,
        "backup": str(backup_path),
        "deleted": {
            "days": day_count,
            "trades": trade_count,
            "screenshots": shot_count,
        },
        "message": f"Toutes les donnees supprimees. Backup: {backup_path.name}",
    })


def _backup_before_reset():
    """Sauvegarde la DB avant reset."""
    from datetime import datetime as _dt
    import shutil as _sh

    backup_dir = DB_PATH.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)

    ts = _dt.now().strftime("%Y%m%d-%H%M%S")
    backup_path = backup_dir / f"journal-pre-reset-{ts}.db"

    try:
        _sh.copy2(DB_PATH, backup_path)
        return backup_path
    except Exception:
        return None
