# ---------- Backups ----------

import threading as _backup_threading

def backup_db():
    if not DB_PATH.exists() or DB_PATH.stat().st_size == 0:
        return
    BACKUPS_DIR.mkdir(exist_ok=True)
    ts   = datetime.now().strftime("%Y%m%d-%H%M%S")
    dest = BACKUPS_DIR / f"journal-{ts}.db"
    try:
        src = sqlite3.connect(str(DB_PATH))
        dst = sqlite3.connect(str(dest))
        with dst:
            src.backup(dst)
        # Checkpoint WAL pour limiter la croissance du fichier journal
        src.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        src.close(); dst.close()
        backups = sorted(BACKUPS_DIR.glob("journal-*.db"))
        for old in backups[:-MAX_BACKUPS]:
            old.unlink(missing_ok=True)
        log.info("Backup OK -> %s", dest.name)
    except Exception as e:
        log.error("Backup FAILED: %s", e)


# ---------- Auto-backup on write ----------

@app.after_request
def _auto_backup_after_write(response):
    """Declenche un backup automatique apres toute ecriture reussie (POST/PUT/DELETE -> 2xx)."""
    if response.status_code < 200 or response.status_code >= 300:
        return response
    if request.method not in ("POST", "PUT", "DELETE"):
        return response
    # Ne pas backup en environnement de test (DB dans /tmp/ ou Temp Windows)
    db_str = str(DB_PATH).lower().replace("\\", "/")
    if db_str.startswith("/tmp/") or "/temp/" in db_str or "temporarydirectory" in db_str:
        return response
    _backup_threading.Thread(target=backup_db, daemon=True).start()
    return response
