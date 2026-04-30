# ---------- Backups ----------

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
        src.close(); dst.close()
        backups = sorted(BACKUPS_DIR.glob("journal-*.db"))
        for old in backups[:-MAX_BACKUPS]:
            old.unlink(missing_ok=True)
        print(f"[backup] OK -> {dest.name}")
    except Exception as e:
        print(f"[backup] FAILED: {e}")


