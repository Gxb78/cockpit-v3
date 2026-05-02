#!/usr/bin/env bash
# kill-servers.sh — Tue les DEUX serveurs Flask (WSL + Windows)
# Utilisation: bash scripts/kill-servers.sh
set -eu

PNAME="${1:-app.py}"  # nom du processus à tuer (defaut: app.py)
PORT="${2:-5000}"      # port à verifier (defaut: 5000)

echo "🔍 Detection des serveurs Flask..."

# --- 1. WSL (Linux) ---
WSL_PIDS=$(ps aux | grep -E "[p]ython.*${PNAME}" | awk '{print $2}' || true)
if [ -n "$WSL_PIDS" ]; then
  echo "  🐧 WSL: $WSL_PIDS"
  kill $WSL_PIDS 2>/dev/null && echo "     → tués (SIGTERM)" || echo "     → déjà morts"
else
  echo "  🐧 WSL: aucun processus python/${PNAME} trouve"
fi

# --- 2. Windows (via PowerShell) ---
if command -v powershell.exe &>/dev/null; then
  WIN_PIDS=$(powershell.exe -Command "
    Get-Process python* -ErrorAction SilentlyContinue | 
    Where-Object { \$_.CommandLine -match '${PNAME}' } | 
    Select-Object -ExpandProperty Id
  " 2>/dev/null | tr -d '\r' | grep -E '^[0-9]+$' || true)
  
  if [ -n "$WIN_PIDS" ]; then
    echo "  🪟 Windows: $WIN_PIDS"
    # essayer Stop-Process (plus propre)
    powershell.exe -Command "
      \$pids = @($(echo $WIN_PIDS | tr '\n' ',' | sed 's/,$//'))
      foreach (\$id in \$pids) { 
        try { Stop-Process -Id \$id -Force -ErrorAction SilentlyContinue; Write-Host \"     → tué PID \$id\" }
        catch { }
      }
    " 2>/dev/null || true
  else
    echo "  🪟 Windows: aucun processus python/${PNAME} trouve"
  fi
else
  echo "  🪟 Windows: powershell.exe indisponible (pas dans le PATH WSL)"
fi

# --- 3. Verification croisee: port 5000 ---
if command -v ss &>/dev/null; then
  LISTENERS=$(ss -tlnp "sport = :$PORT" 2>/dev/null | grep -c "LISTEN" || true)
  if [ "$LISTENERS" -gt 0 ]; then
    echo "  ⚠️  Port $PORT encore ecoute. Processus:"
    ss -tlnp "sport = :$PORT" 2>/dev/null | grep "LISTEN" || true
  else
    echo "  ✅ Port $PORT libre."
  fi
fi

echo "✅ Fini."
