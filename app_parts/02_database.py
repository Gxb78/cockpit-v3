# ---------- Database ----------

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA foreign_keys = ON")
        g.db.execute("PRAGMA busy_timeout=3000")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db:
        db.close()


def init_db():
    con = sqlite3.connect(DB_PATH)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys = ON")
    con.execute("PRAGMA busy_timeout=3000")

    con.executescript("""
    CREATE TABLE IF NOT EXISTS days (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        date            TEXT NOT NULL,
        instrument      TEXT NOT NULL,
        htf_bias        TEXT,
        htf_context     TEXT,
        session         TEXT,
        daily_notes     TEXT,
        tags            TEXT,
        schema_version  INTEGER DEFAULT 3,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL,
        UNIQUE(date, instrument)
    );

    CREATE TABLE IF NOT EXISTS trades (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        day_id            INTEGER NOT NULL,
        strategy          TEXT,
        direction         TEXT,
        why_trade         TEXT,
        why_entry         TEXT,
        why_stop          TEXT,
        why_tp            TEXT,
        stdv_level        TEXT,
        scenario          TEXT,
        entry_price       REAL,
        stop_loss         REAL,
        take_profit       REAL,
        exit_price        REAL,
        position_size     REAL,
        pnl               REAL DEFAULT 0,
        rr                REAL,
        is_win            INTEGER,
        execution_quality INTEGER,
        thesis_validated  TEXT,
        lessons_learned   TEXT,
        plan_model        TEXT,
        plan_direction    TEXT,
        plan_alignment    TEXT,
        plan_score        INTEGER,
        plan_errors       TEXT,
        plan_warnings     TEXT,
        plan_override_reason TEXT,
        plan_snapshot     TEXT,
        tags              TEXT,
        custom_blocks     TEXT,
        schema_version    INTEGER DEFAULT 3,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL,
        FOREIGN KEY (day_id) REFERENCES days(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS trade_screenshots (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id   INTEGER NOT NULL,
        filename   TEXT NOT NULL,
        caption    TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE
    );

CREATE TABLE IF NOT EXISTS knowledge_cards (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        kind            TEXT NOT NULL,
        title           TEXT NOT NULL,
        body            TEXT,
        confidence      REAL DEFAULT 1.0,
        evidence_count  INTEGER DEFAULT 0,
        total_count     INTEGER DEFAULT 0,
        tags            TEXT,
        version         INTEGER DEFAULT 1,
        is_user_saved   INTEGER DEFAULT 0,
        is_archived     INTEGER DEFAULT 0,
        created_at      TEXT NOT NULL,
        updated_at      TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_cards_kind   ON knowledge_cards(kind);
    CREATE INDEX IF NOT EXISTS idx_knowledge_cards_tags   ON knowledge_cards(tags);
    CREATE INDEX IF NOT EXISTS idx_knowledge_cards_saved  ON knowledge_cards(is_user_saved);

    CREATE TABLE IF NOT EXISTS _schema_version (
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_days_date        ON days(date);
    CREATE INDEX IF NOT EXISTS idx_days_instrument  ON days(instrument);
    CREATE INDEX IF NOT EXISTS idx_trades_day_id    ON trades(day_id);
    """)
    _ensure_column(con, "trades", "why_tp", "TEXT")
    _ensure_column(con, "trades", "plan_model", "TEXT")
    _ensure_column(con, "trades", "plan_direction", "TEXT")
    _ensure_column(con, "trades", "plan_alignment", "TEXT")
    _ensure_column(con, "trades", "plan_score", "INTEGER")
    _ensure_column(con, "trades", "plan_errors", "TEXT")
    _ensure_column(con, "trades", "plan_warnings", "TEXT")
    _ensure_column(con, "trades", "plan_override_reason", "TEXT")
    _ensure_column(con, "trades", "plan_snapshot", "TEXT")
    _ensure_column(con, "trades", "leverage", "REAL")
    con.commit()

    _run_migrations(con)
    con.close()


# ---------- Migrations versionnees ----------

def _db_version(con):
    """Lit la version actuelle du schema depuis _schema_version."""
    row = con.execute("SELECT version FROM _schema_version").fetchone()
    return row[0] if row else 0


def _set_db_version(con, version):
    """Ecrit la version du schema dans _schema_version (remplace la ligne unique)."""
    con.execute("DELETE FROM _schema_version")
    con.execute(
        "INSERT INTO _schema_version (version, updated_at) VALUES (?, ?)",
        (version, now_iso()),
    )


def _run_migrations(con):
    """Execute les migrations dans l'ordre jusqu'a atteindre SCHEMA_VERSION."""
    current = _db_version(con)
    if current >= SCHEMA_VERSION:
        return

    _MIGRATIONS = {
        # version cible → fonction de migration
        3: _migrate_v2_to_v3,
        4: _migrate_v3_to_v4,
        5: _migrate_v4_to_v5,
        6: _migrate_v5_to_v6,
        7: _migrate_v6_to_v7,
        8: _migrate_v7_to_v8,
    }

    for target in sorted(_MIGRATIONS):
        if current >= target:
            continue
        fn = _MIGRATIONS[target]
        log.info("Migration de v%s vers v%s...", current, target)
        fn(con)
        _set_db_version(con, target)
        con.commit()
        current = target
        log.info("Migration OK -> v%s", target)


# Whitelist des noms de tables et colonnes autorisées (Sécurité SQL)
_VALID_TABLES = {"days", "trades", "screenshots", "settings", "knowledge_cards"}
_VALID_DDL_TYPES = {"TEXT", "INTEGER", "REAL", "BLOB"}

def _table_columns(con, table_name):
    if table_name not in _VALID_TABLES:
        raise ValueError(f"Nom de table non autorisé: {table_name}")
    return {row[1] for row in con.execute(f"PRAGMA table_info({table_name})")}


def _ensure_column(con, table_name, column_name, ddl):
    if table_name not in _VALID_TABLES:
        raise ValueError(f"Nom de table non autorisé: {table_name}")
    ddl_type = ddl.split("(")[0].strip().upper()
    if ddl_type not in _VALID_DDL_TYPES:
        raise ValueError(f"Type DDL non autorisé: {ddl}")
    if column_name in _table_columns(con, table_name):
        return
    con.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {ddl}")


def _migrate_v2_to_v3(con):
    """Migration one-shot : entries (v2) -> days + trades (v3)."""
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "entries" not in tables:
        return  # Installation propre ou deja migre

    log.info("Migration v3: entries -> days + trades...")

    entry_cols = [r[1] for r in con.execute("PRAGMA table_info(entries)")]
    shot_cols  = [r[1] for r in con.execute("PRAGMA table_info(screenshots)")] if "screenshots" in tables else []

    migrated = 0
    for row in con.execute("SELECT * FROM entries").fetchall():
        e   = dict(zip(entry_cols, row))
        now = e.get("created_at") or now_iso()
        upd = e.get("updated_at") or now

        # Inserer le jour (contexte partage)
        cur = con.execute("""
            INSERT OR IGNORE INTO days
                (date, instrument, htf_bias, htf_context,
                 session, tags, schema_version, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 3, ?, ?)
        """, (e["date"], e["instrument"],
              e.get("htf_bias"), e.get("htf_context"),
              e.get("session"), e.get("tags"), now, upd))

        if cur.rowcount == 0:
            day_id = con.execute(
                "SELECT id FROM days WHERE date=? AND instrument=?", (e["date"], e["instrument"])
            ).fetchone()[0]
        else:
            day_id = cur.lastrowid

        # Creer un trade si donnees trading presentes
        has_data = (
            e.get("scenario") or e.get("stdv_level") or e.get("setup_type")
            or (e.get("pnl") is not None and e.get("pnl") != 0)
            or e.get("rr") is not None
            or (e.get("num_trades") or 0) > 0
        )

        trade_id = None
        if has_data:
            strategy = e.get("setup_type")
            if strategy == "stdv":
                strategy = None  # stdv n'etait pas une vraie strategie

            tc = con.execute("""
                INSERT INTO trades (
                    day_id, strategy, stdv_level, scenario,
                    pnl, rr, is_win,
                    execution_quality, thesis_validated,
                    lessons_learned, custom_blocks,
                    schema_version, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 3, ?, ?)
            """, (day_id, strategy,
                  e.get("stdv_level"), e.get("scenario"),
                  e.get("pnl", 0), e.get("rr"), e.get("is_win"),
                  e.get("execution_quality"),
                  e.get("thesis_validated"), e.get("lessons_learned"),
                  e.get("custom_blocks"), now, upd))
            trade_id = tc.lastrowid

        # Migrer les screenshots vers ce trade
        if "screenshots" in tables and trade_id:
            for srow in con.execute("SELECT * FROM screenshots WHERE entry_id=?", (e["id"],)):
                s = dict(zip(shot_cols, srow))
                con.execute(
                    "INSERT INTO trade_screenshots (trade_id, filename, caption, created_at) VALUES (?,?,?,?)",
                    (trade_id, s["filename"], s.get("caption", ""), s.get("created_at", now))
                )
        migrated += 1

    # Renommer les anciennes tables en backup
    con.execute("ALTER TABLE entries RENAME TO entries_v2_backup")
    if "screenshots" in tables:
        con.execute("ALTER TABLE screenshots RENAME TO screenshots_v2_backup")

    con.commit()
    log.info("Migration v3 OK - %s entree(s) migree(s).", migrated)


def _migrate_v3_to_v4(con):
    """Migration v4: cree la table knowledge_cards pour les patterns ML.

    La table est creee avec CREATE TABLE IF NOT EXISTS dans init_db(),
    mais on s'assure qu'elle existe au cas ou init_db n'a pas ete appele.
    """
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "knowledge_cards" in tables:
        return  # Deja cree

    con.executescript("""
        CREATE TABLE knowledge_cards (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            kind            TEXT NOT NULL,
            title           TEXT NOT NULL,
            body            TEXT,
            confidence      REAL DEFAULT 1.0,
            evidence_count  INTEGER DEFAULT 0,
            total_count     INTEGER DEFAULT 0,
            tags            TEXT,
            version         INTEGER DEFAULT 1,
            is_user_saved   INTEGER DEFAULT 0,
            is_archived     INTEGER DEFAULT 0,
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL
        );

        CREATE INDEX idx_knowledge_cards_kind  ON knowledge_cards(kind);
        CREATE INDEX idx_knowledge_cards_tags  ON knowledge_cards(tags);
        CREATE INDEX idx_knowledge_cards_saved ON knowledge_cards(is_user_saved);
    """)
    con.commit()
    log.info("Migration v4 OK - table knowledge_cards creee.")


def _migrate_v4_to_v5(con):
    """Migration v5: ajoute les champs de coherence Plan/PO3 sur les trades."""
    _ensure_column(con, "trades", "plan_model", "TEXT")
    _ensure_column(con, "trades", "plan_direction", "TEXT")
    _ensure_column(con, "trades", "plan_alignment", "TEXT")
    _ensure_column(con, "trades", "plan_score", "INTEGER")
    _ensure_column(con, "trades", "plan_errors", "TEXT")
    _ensure_column(con, "trades", "plan_warnings", "TEXT")
    _ensure_column(con, "trades", "plan_override_reason", "TEXT")
    _ensure_column(con, "trades", "plan_snapshot", "TEXT")
    log.info("Migration v5 OK - champs plan PO3 ajoutes.")


def _migrate_v5_to_v6(con):
    """Migration v6: ajoute le champ leverage sur les trades."""
    _ensure_column(con, "trades", "leverage", "REAL")
    log.info("Migration v6 OK - champ leverage ajoute.")


def _migrate_v6_to_v7(con):
    """Migration v7: cree la table user_settings pour la persistence backend."""
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "user_settings" not in tables:
        con.execute("""
            CREATE TABLE user_settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
    log.info("Migration v7 OK - table user_settings creee.")


def _migrate_v7_to_v8(con):
    """Migration v8: ajoute colonne session dans trades."""
    _ensure_column(con, "trades", "session", "TEXT")
    log.info("Migration v8 OK - session ajoutee dans trades.")


