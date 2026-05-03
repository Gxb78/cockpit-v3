"""Trading Journal COCKPIT v3 — modular app loader.

Loads all app_parts modules into a single shared namespace in dependency order.
Each module is validated for syntax before execution for clear error messages.
"""
from pathlib import Path

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
]

for _part in _PART_FILES:
    _path = _PARTS_DIR / _part
    if not _path.exists():
        raise FileNotFoundError(f"Partie manquante: app_parts/{_part}")
    _src = _path.read_text(encoding="utf-8").lstrip("﻿")
    # Syntax check before execution for a clear, localised error message
    try:
        _code = compile(_src, str(_path), "exec")
    except SyntaxError as _e:
        raise SyntaxError(
            f"Erreur de syntaxe dans app_parts/{_part}:\n  {_e.msg} (ligne {_e.lineno})"
        ) from _e
    try:
        exec(_code, globals(), globals())
    except Exception as _e:
        raise RuntimeError(
            f"Erreur au chargement de app_parts/{_part}: {_e}"
        ) from _e
