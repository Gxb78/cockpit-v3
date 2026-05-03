#!/usr/bin/env bash
# check-envs.sh — Vérifie et synchronise les deux venv (WSL + Windows)
# Usage: bash scripts/check-envs.sh [sync]
#   sync: installe les packages manquants dans les deux venv
set -eu

DIR="$(cd "$(dirname "$0")/.." && pwd)"
WSL_PY="$DIR/.venv_linux/bin/python"
WIN_PY="$DIR/.venv/Scripts/python.exe"
REQ="$DIR/requirements.txt"
NEED_SYNC=false

echo "══════════════════════════════════════════"
echo "  Journal — Vérification des environnements"
echo "══════════════════════════════════════════"

# ── WSL venv ──
if [ -f "$WSL_PY" ]; then
  WSL_VER=$("$WSL_PY" --version 2>/dev/null || echo "N/A")
  echo ""
  echo "  🐧 WSL  : $WSL_VER"
  echo "     Path : $WSL_PY"
else
  echo ""
  echo "  🐧 WSL  : venv manquant"
  echo "     Creer avec: python3 -m venv .venv_linux"
  NEED_SYNC=true
fi

# ── Windows venv (via PowerShell) ──
if command -v powershell.exe &>/dev/null; then
  WIN_EXISTS=0
  WIN_PATH_WSL=$(wslpath -w "$WIN_PY" 2>/dev/null || echo "")
  if [ -n "$WIN_PATH_WSL" ]; then
    WIN_EXISTS=$(powershell.exe -Command "if (Test-Path '$WIN_PATH_WSL') { 1 } else { 0 }" 2>/dev/null | tr -d '\r' || echo "0")
  fi
  if [ "$WIN_EXISTS" = "1" ]; then
    WIN_VER=$(powershell.exe -Command "& '$WIN_PATH_WSL' --version" 2>/dev/null | tr -d '\r' || echo "N/A")
    echo "  Win  : $WIN_VER"
    echo "     Path : $WIN_PY"
  else
    echo "  Win  : venv manquant"
    echo "     Creer avec: python -m venv .venv"
    NEED_SYNC=true
  fi
else
  echo "  Win  : powershell.exe indisponible (pas dans le PATH WSL)"
fi

# ── requirements.txt ──
if [ ! -f "$REQ" ]; then
  echo ""
  echo "  requirements.txt : manquant"
  NEED_SYNC=true
fi

# ── Comparer les packages (WSL) ──
if [ -f "$WSL_PY" ] && [ -f "$REQ" ]; then
  echo ""
  echo "  Packages installes (WSL) :"

  # Lister les packages installes (sans pip/setuptools/wheel)
  "$WSL_PY" -m pip list --format=freeze 2>/dev/null \
    | grep -vE '^(pip|setuptools|wheel|(-e|#))' \
    | sed 's/==.*//' | sort > /tmp/_wsl_pkgs.txt

  # Lister les requirements (sans commentaires, sans versions)
  sed 's/[>=<~].*//' "$REQ" | sed 's/^[[:space:]]*//' | grep -vE '^(#|$)' \
    | sort > /tmp/_req_pkgs.txt

  # Trouver les manquants
  comm -13 /tmp/_wsl_pkgs.txt /tmp/_req_pkgs.txt > /tmp/_missing_pkgs.txt

  WSL_COUNT=$(wc -l < /tmp/_wsl_pkgs.txt)
  echo "     $WSL_COUNT packages installes"

  if [ -s /tmp/_missing_pkgs.txt ]; then
    echo "     WARNING - Packages manquants:"
    cat /tmp/_missing_pkgs.txt | sed 's/^/       - /'
    NEED_SYNC=true
  else
    echo "     OK - Tous les requirements sont installes"
  fi

  rm -f /tmp/_wsl_pkgs.txt /tmp/_req_pkgs.txt /tmp/_missing_pkgs.txt
fi

# ── Sync optionnelle ──
if [ "$NEED_SYNC" = true ] && [ "${1:-}" = "sync" ]; then
  echo ""
  echo "══════════════════════════════════════════"
  echo "  Synchronisation..."
  echo "══════════════════════════════════════════"

  if [ -f "$WSL_PY" ] && [ -f "$REQ" ]; then
    echo "  Installation WSL..."
    "$WSL_PY" -m pip install -r "$REQ" -q
    echo "     OK - WSL"
  fi

  if command -v powershell.exe &>/dev/null && [ -n "${WIN_PATH_WSL:-}" ]; then
    WIN_EXISTS=$(powershell.exe -Command "if (Test-Path '$WIN_PATH_WSL') { 1 } else { 0 }" 2>/dev/null | tr -d '\r' || echo "0")
    if [ "$WIN_EXISTS" = "1" ] && [ -f "$REQ" ]; then
      WIN_REQ_PATH=$(wslpath -w "$REQ" 2>/dev/null || echo "")
      echo "  Installation Windows..."
      powershell.exe -Command "& '$WIN_PATH_WSL' -m pip install -r '$WIN_REQ_PATH' -q"
      echo "     OK - Windows"
    fi
  fi

  echo "  Synchronisation terminee."
elif [ "$NEED_SYNC" = true ]; then
  echo ""
  echo "  Desynchronisation detectee."
  echo "     -> bash scripts/check-envs.sh sync"
fi

if [ "$NEED_SYNC" = false ]; then
  echo ""
  echo "  OK - Les deux environnements sont synchronises."
fi
echo ""
