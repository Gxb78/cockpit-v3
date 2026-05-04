"""Trading Journal COCKPIT v3 — modular app loader.

Loads all app_parts modules into a single shared namespace in dependency order.
Uses compile() + exec() into a dedicated namespace dict (not globals()),
with name collision detection. Each module's function __globals__ points to
the shared namespace, preserving the flat cross-module reference pattern.

The app_parts module itself acts as a proxy: reads go through the shared
namespace, and writes (monkey-patching) propagate back to it so all
functions see the updated value at call time. Test isolation is preserved.
"""
import sys
import types
import logging
from pathlib import Path

log = logging.getLogger("journal")

_PARTS_DIR = Path(__file__).resolve().parent
_PART_FILES = [
    "00_paths_constants.py",        # 00 — chemins, constantes, app
    "01_flask_app.py",              # 01 — configuration Flask
    "02_database.py",               # 02 — base de donnees
    "03_core_helpers.py",           # 03 — helpers generaux
    "04_model_serializers.py",      # 04 — serializers / decodeurs
    "05_payload_normalizers.py",    # 05 — normalisation des payloads
    "06_query_legacy_helpers.py",   # 06 — helpers requetes legacy
    "07_routes_pages.py",           # 07 — routes pages (index, settings)
    "08_trade_math.py",             # 08 — canonical trade math (PnL, RR, direction)
    "06a_trade_service.py",         # 06a — couche service trade (CRUD, validations)
    "06b_day_service.py",           # 06b — couche service day (CRUD, validations)
    "09_routes_days.py",            # 09 — routes API days
    "12_plan_engine.py",            # 09 — moteur coherence plan / PO3
    "10_routes_trades.py",          # 09 — routes API trades
    "11_routes_screenshots.py",     # 10 — routes API screenshots
    "12_stats_math.py",             # 12 — fonctions stats / buckets
    "13_stats_periods_insights.py", # 13 — comparaison periodes, insights
    "14_routes_stats.py",           # 14 — route API /api/stats
    "15_parse_trade.py",            # 15 — parseur de narration trading
    "16_export.py",                 # 16 — export des donnees
    "17_backups.py",                # 17 — sauvegarde automatique
    "17_reset.py",                  # 17 — reset toutes les donnees (danger zone)
    "18_launcher.py",               # 18 — point d entree serveur
    "19_ai_chat.py",                # 19 — IA chat DeepSeek
    "20_ml_engine.py",              # 20 — ML Engine : apprentissage automatique
    "21_routes_ml.py",              # 21 — Routes API ML / insights
    "22_routes_settings.py",        # 22 — Routes API user settings
    "23_routes_market.py",          # 23 — Routes API market data (Binance)
    "21_midnight_engine.py",        # 24 — Midnight Engine (+ route API)
]

# Canonical shared namespace — ALL functions from ALL parts reference this dict
_NS = {}

for _part in _PART_FILES:
    _path = _PARTS_DIR / _part
    if not _path.exists():
        raise FileNotFoundError(f"Partie manquante: app_parts/{_part}")

    # Set dunder names so source files with __file__ resolve correctly
    _NS["__file__"] = str(_path)
    _NS["__name__"] = "app_parts." + _part.replace(".py", "")

    _before_values = {k: _NS[k] for k in _NS if not k.startswith("_")}

    _src = _path.read_text(encoding="utf-8").lstrip("\ufeff")
    try:
        _code = compile(_src, str(_path), "exec")
    except SyntaxError as _e:
        raise SyntaxError(
            f"Erreur de syntaxe dans app_parts/{_part}:\n  {_e.msg} (ligne {_e.lineno})"
        ) from _e

    try:
        exec(_code, _NS, _NS)
    except Exception as _e:
        raise RuntimeError(
            f"Erreur au chargement de app_parts/{_part}: {_e}"
        ) from _e

    _overwritten = []
    for name, old_value in _before_values.items():
        try:
            if name in _NS and _NS[name] is not old_value:
                _overwritten.append(name)
        except Exception:
            _overwritten.append(name)
    if _overwritten:
        log.warning("Noms publics ecrases dans %s : %s", _part, sorted(_overwritten))

# ---------------------------------------------------------------------------
# Expose all public names at the app_parts level so that:
#   1) from app_parts import *  works (for app.py and tests)
#   2) app_parts.init_db direct access works
# These are COPIES in __dict__, but all functions read from _NS at call time.
# ---------------------------------------------------------------------------
_THIS = sys.modules[__name__]
for _k, _v in list(_NS.items()):
    if not _k.startswith("_") or _k in (
        "__doc__", "__name__", "__file__", "__package__",
        "__loader__", "__spec__", "__path__",
    ):
        _THIS.__dict__[_k] = _v
_THIS.__dict__.update({
    "_NS": _NS,
    "_PART_FILES": _PART_FILES,
    "_PARTS_DIR": _PARTS_DIR,
})

# Proxy: app_parts module delegates reads/writes to _NS
# This preserves monkey-patching for tests (app_parts.DB_PATH = X updates
# the namespace that all functions reference at call time).
# When __setattr__ fires, it updates BOTH _NS (for function call-time lookup)
# and the module's __dict__ (for direct attribute access).
# __getattr__ is a safety net for any name not yet in __dict__.
# ---------------------------------------------------------------------------


class _AppPartsModule(types.ModuleType):
    """Proxy module that reads through _NS and propagates writes to it."""

    def __getattr__(self, name):
        try:
            return _NS[name]
        except KeyError:
            msg = f"module {__name__!r} has no attribute {name!r}"
            raise AttributeError(msg) from None

    def __setattr__(self, name, value):
        # Always write into the shared namespace first so all functions see it
        _NS[name] = value
        # Also set on the module's own dict for normal attribute access
        super().__setattr__(name, value)


_THIS.__class__ = _AppPartsModule
