"""
Trading Journal - COCKPIT v3
Local Flask app for BTC / ETH / NAS / ES.
Schema v3 : days (contexte journalier) + trades (trades individuels, N par jour).
"""
import json
import os
import re as _re
import sqlite3
import unicodedata
import uuid
import webbrowser
from datetime import datetime
from pathlib import Path
from threading import Timer
import sys

from flask import Flask, abort, g, jsonify, render_template, request, send_from_directory

# ---------- Paths & constants ----------

# _FILE_DIR = __init__.py (dans app_parts/) ou app.py (a la racine)
_FILE_DIR = Path(__file__).resolve().parent
if getattr(sys, 'frozen', False):
    # Mode PyInstaller frozen
    RESOURCE_DIR = Path(sys._MEIPASS).resolve()
    EXE_DIR      = Path(sys.executable).resolve().parent
    IS_FROZEN    = True
else:
    # Mode developpement normal
    RESOURCE_DIR = _FILE_DIR.parent if _FILE_DIR.name == "app_parts" else _FILE_DIR
    EXE_DIR      = RESOURCE_DIR
    IS_FROZEN    = False

# Resolution du Mode Portable vs Mode Installe (Garde-fous Phase 25)
IS_PORTABLE = (EXE_DIR / "portable.mode").exists()

if IS_PORTABLE:
    # Mode Portable -> données dans le dossier de l'exécutable
    USER_DATA_DIR = EXE_DIR
else:
    # Mode Installé -> données dans %APPDATA%\CockpitV6
    if not IS_FROZEN:
        # En dev, on reste local pour preserver le workflow de developpement
        USER_DATA_DIR = RESOURCE_DIR
    else:
        if os.name == 'nt' or sys.platform == 'win32':
            appdata = os.environ.get("APPDATA")
            if appdata:
                USER_DATA_DIR = Path(appdata) / "CockpitV6"
            else:
                USER_DATA_DIR = Path.home() / "AppData" / "Roaming" / "CockpitV6"
        else:
            USER_DATA_DIR = Path.home() / ".config" / "CockpitV6"

BASE_DIR = USER_DATA_DIR

DATA_DIR        = USER_DATA_DIR / "data"
SCREENSHOTS_DIR = DATA_DIR / "screenshots"
BACKUPS_DIR     = DATA_DIR / "backups"
LOGS_DIR        = USER_DATA_DIR / "logs"
DB_PATH         = DATA_DIR / "journal.db"

# Creation recursive des repertoires de données utilisateur
DATA_DIR.mkdir(parents=True, exist_ok=True)
SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
LOGS_DIR.mkdir(parents=True, exist_ok=True)

# Phase 25C: Migration automatique safe de Portable vers AppData
if not IS_PORTABLE and IS_FROZEN:
    portable_db = EXE_DIR / "data" / "journal.db"
    installed_db = DB_PATH
    if portable_db.exists():
        if not installed_db.exists():
            import shutil
            try:
                # Copy portable database
                shutil.copy2(str(portable_db), str(installed_db))
                
                # Copy env file
                portable_env = EXE_DIR / ".env"
                installed_env = USER_DATA_DIR / ".env"
                if portable_env.exists() and not installed_env.exists():
                    shutil.copy2(str(portable_env), str(installed_env))
                    
                # Copy config.json
                portable_config = EXE_DIR / "config.json"
                installed_config = USER_DATA_DIR / "config.json"
                if portable_config.exists() and not installed_config.exists():
                    shutil.copy2(str(portable_config), str(installed_config))
                    
                # Copy screenshots if any
                portable_screenshots = EXE_DIR / "data" / "screenshots"
                if portable_screenshots.exists():
                    for item in portable_screenshots.glob("*"):
                        if item.is_file() and item.name != ".gitkeep":
                            shutil.copy2(str(item), str(SCREENSHOTS_DIR / item.name))
                            
                # Copy backups if any
                portable_backups = EXE_DIR / "data" / "backups"
                if portable_backups.exists():
                    for item in portable_backups.glob("*"):
                        if item.is_file() and item.name != ".gitkeep":
                            shutil.copy2(str(item), str(BACKUPS_DIR / item.name))
                
                print("migration: copied portable data to AppData")
            except Exception as e:
                print(f"WARNING: Automatic migration failed: {e}")
        else:
            print("WARNING: AppData already contains journal.db. Bypassing automatic migration. Manual merge required.")

del _FILE_DIR

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}
MAX_SCREENSHOT_SIZE = 5 * 1024 * 1024  # 5 Mo par screenshot

# Configuration et fallback config.json (Garde-fous Phase 25)
_CONFIG_PATH = USER_DATA_DIR / "config.json"
if not _CONFIG_PATH.exists():
    default_config = EXE_DIR / "config.json"
    if not default_config.exists():
        default_config = RESOURCE_DIR / "config.json"
    if default_config.exists() and not IS_PORTABLE:
        try:
            import shutil
            shutil.copy2(str(default_config), str(_CONFIG_PATH))
        except Exception:
            pass

_CONFIG_DATA = json.loads(_CONFIG_PATH.read_text(encoding="utf-8")) if _CONFIG_PATH.exists() else {}

INSTRUMENTS       = _CONFIG_DATA.get("instruments", ["BTC", "ETH", "NQ", "ES"])
STRATEGIES        = _CONFIG_DATA.get("strategies", ["midnight_model", "london_model", "ny_model"])
INSTRUMENT_ALIASES = _CONFIG_DATA.get("instrument_aliases", {"NAS": "NQ"})
STRATEGY_ALIASES   = _CONFIG_DATA.get("strategy_aliases", {
    "midnight": "midnight_model",
    "london": "london_model",
    "ny": "ny_model",
})
STRATEGY_LABELS    = _CONFIG_DATA.get("strategy_labels", {
    "midnight_model": "Midnight Model",
    "london_model": "London Model",
    "ny_model": "NY Model",
})
SCHEMA_VERSION = 10
MAX_BACKUPS    = 50

# Limites de taille pour les champs textes
MAX_TEXT_SHORT  = 1000   # htf_bias, session, caption
MAX_TEXT_MEDIUM = 5000   # why_trade, why_entry, scenario, etc.
MAX_TEXT_LONG   = 10000  # daily_notes, htf_context, lessons_learned

# Whitelists pour la normalisation des payloads
DAY_TEXT_FIELDS   = ["htf_bias", "htf_context", "session", "daily_notes"]
TRADE_TEXT_FIELDS = [
    "session",
    "strategy", "direction",
    "why_trade", "why_entry", "why_stop", "why_tp",
    "scenario",
    "thesis_validated", "lessons_learned",
    "plan_model", "plan_direction", "plan_alignment",
    "plan_override_reason", "plan_snapshot",
]
TRADE_NUMERIC_FIELDS = ["pnl", "rr", "entry_price", "exit_price", "stop_loss", "take_profit", "position_size", "leverage"]
TRADE_INT_FIELDS     = ["execution_quality", "plan_score"]
