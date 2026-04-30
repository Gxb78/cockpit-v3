# ---------- Helpers ----------

# Whitelists de colonnes SQL — seules ces colonnes sont autorisees dans les INSERT/UPDATE dynamiques
_DAY_COLUMNS = frozenset({
    "id", "date", "instrument",
    "htf_bias", "htf_context", "session", "daily_notes",
    "tags", "schema_version", "created_at", "updated_at",
})

_TRADE_COLUMNS = frozenset({
    "id", "day_id",
    "strategy", "direction",
    "why_trade", "why_entry", "why_stop", "why_tp",
    "stdv_level", "scenario",
    "entry_price", "stop_loss", "take_profit", "exit_price", "position_size",
    "pnl", "rr", "is_win",
    "execution_quality",
    "thesis_validated", "lessons_learned",
    "plan_model", "plan_direction", "plan_alignment", "plan_score",
    "plan_errors", "plan_warnings", "plan_override_reason", "plan_snapshot",
    "tags", "custom_blocks",
    "schema_version", "created_at", "updated_at",
})

_SCREENSHOT_COLUMNS = frozenset({
    "id", "trade_id", "filename", "caption", "created_at",
})

_TABLE_COLUMNS = {
    "days": _DAY_COLUMNS,
    "trades": _TRADE_COLUMNS,
    "trade_screenshots": _SCREENSHOT_COLUMNS,
}


def _safe_columns(columns, table):
    """Validate that all column names are known for the given table.

    Returns the validated list. Raises ValueError if any column is unknown.
    This is a safety net to prevent accidental SQL injection via dynamic
    column names in INSERT/UPDATE queries.
    """
    allowed = _TABLE_COLUMNS.get(table)
    if allowed is None:
        raise ValueError(f"Table inconnue: {table}")
    unknown = [c for c in columns if c not in allowed]
    if unknown:
        raise ValueError(
            f"Colonnes inconnues pour la table '{table}': {unknown}"
        )
    return list(columns)


# ---------- Rate limiter memoire (sans dependance externe) ----------

from collections import defaultdict
from time import time as _time
from functools import wraps

_ratelimit_buckets = defaultdict(list)


def ratelimit(max_per_minute=60):
    """Decorate a Flask route to limit requests per minute.

    Simple sliding-window counter in memory. Resets when the process restarts.
    Usage:
        @app.get("/api/stats")
        @ratelimit(max_per_minute=30)
        def stats():
            ...
    """
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            now = _time()
            key = f.__name__
            bucket = _ratelimit_buckets[key]
            cutoff = now - 60.0
            # Purge les entrees plus vieilles que 60s
            bucket[:] = [t for t in bucket if t > cutoff]
            if len(bucket) >= max_per_minute:
                return jsonify({
                    "error": "Trop de requetes. Reessaye dans quelques instants.",
                    "retry_after": int(60 - (now - bucket[0])) if bucket else 60,
                }), 429
            bucket.append(now)
            return f(*args, **kwargs)
        return wrapper
    return decorator


# ---------- Validation de dates ----------

from datetime import date as _date_cls


def _validate_date_key(value, label="date"):
    """Valide qu'une valeur est une date au format YYYY-MM-DD et effectivement valide.

    Retourne la date au format canonique YYYY-MM-DD.
    Leve ValueError si le format est invalide ou la date inexistante.
    """
    if not value or not isinstance(value, str):
        raise ValueError(f"{label}: format invalide (attendu YYYY-MM-DD)")
    value = value.strip()
    if not _re.match(r"^\d{4}-\d{2}-\d{2}$", value):
        raise ValueError(f"{label}: format invalide (attendu YYYY-MM-DD, recu '{value}')")
    parts = value.split("-")
    try:
        _date_cls(int(parts[0]), int(parts[1]), int(parts[2]))
    except ValueError as _exc:
        raise ValueError(f"{label}: date inexistante ({_exc})") from _exc
    return value


def now_iso():
    return datetime.now().isoformat(timespec="seconds")


def _canonical_instrument(value):
    if value is None:
        return None
    raw = str(value).strip().upper()
    if not raw:
        return None
    return INSTRUMENT_ALIASES.get(raw, raw)


def _canonical_strategy(value):
    if value is None:
        return None
    raw = str(value).strip().lower()
    if not raw:
        return None
    return STRATEGY_ALIASES.get(raw, raw)


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def _sniff_image_extension(file_storage):
    """Return canonical extension from file signature: png|jpg|gif|webp or None."""
    try:
        stream = file_storage.stream
        pos = stream.tell()
        head = stream.read(32)
        stream.seek(pos)
    except Exception:
        return None

    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    return None


def _as_float(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _infer_direction_for_validation(payload):
    # NOTE: duplique dans static/js/split/001_utilities.js inferDirectionFromPrices()
    direction = str(payload.get("direction") or "").strip().lower()
    if direction in {"long", "short"}:
        return direction

    entry = _as_float(payload.get("entry_price"))
    stop = _as_float(payload.get("stop_loss"))
    target = _as_float(payload.get("take_profit"))
    if entry is not None and stop is not None and stop != entry:
        return "long" if stop < entry else "short"
    if entry is not None and target is not None and target != entry:
        return "long" if target > entry else "short"
    return None


def _validate_trade_semantics(payload):
    errors = []
    entry = _as_float(payload.get("entry_price"))
    stop = _as_float(payload.get("stop_loss"))
    target = _as_float(payload.get("take_profit"))
    direction = _infer_direction_for_validation(payload)

    if direction == "long":
        if entry is not None and stop is not None and not (stop < entry):
            errors.append("niveaux invalides: en long, stop_loss doit etre inferieur a entry_price")
        if entry is not None and target is not None and not (target > entry):
            errors.append("niveaux invalides: en long, take_profit doit etre superieur a entry_price")
    elif direction == "short":
        if entry is not None and stop is not None and not (stop > entry):
            errors.append("niveaux invalides: en short, stop_loss doit etre superieur a entry_price")
        if entry is not None and target is not None and not (target < entry):
            errors.append("niveaux invalides: en short, take_profit doit etre inferieur a entry_price")

    if direction and entry is not None and stop is not None and target is not None:
        if direction == "long" and not (target > entry > stop):
            errors.append("niveaux invalides: en long, take_profit > entry_price > stop_loss")
        if direction == "short" and not (target < entry < stop):
            errors.append("niveaux invalides: en short, take_profit < entry_price < stop_loss")

    pnl = _as_float(payload.get("pnl"))
    is_win = payload.get("is_win")
    if isinstance(is_win, bool):
        is_win = 1 if is_win else 0
    elif isinstance(is_win, str) and is_win.strip() in {"0", "1"}:
        is_win = int(is_win.strip())
    if is_win in (0, 1) and pnl is not None and pnl != 0:
        if pnl > 0 and is_win == 0:
            errors.append("incoherence: pnl positif avec is_win=0")
        if pnl < 0 and is_win == 1:
            errors.append("incoherence: pnl negatif avec is_win=1")

    return errors


