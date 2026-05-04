# Journal — Agent Onboarding

## Quick start

```bash
cd /mnt/c/Users/gb781/Desktop/Journal   # WSL path
# or C:\Users\gb781\Desktop\Journal       # Windows path

# Backend
.venv_linux/bin/python app.py            # WSL server on :5000

# Frontend build
.venv_linux/bin/python build.py          # builds static/app.js + style.css

# Tests
.venv_linux/bin/python -m unittest discover -s tests -v

# Git
git add -A && git commit -m "msg" && git push
```

**NE JAMAIS commit sans accord explicite** de l'utilisateur.

## Architecture

### Backend (Flask)
- `app.py` — entry point, charge `app_parts/*.py`
- `app_parts/02_database.py` — SQLite, migrations v0..v8
- `app_parts/23_routes_market.py` — proxy Binance (klines, trades, orderbook). Cache 5min, retry 429/502/503
- 49 routes API documentées dans `docs/API_ROUTES.md`

### Frontend (JS vanilla + CSS)
- `static/js/split/*.js` — modules numerotés, concaténés dans `app.js` par ordre alphabétique
- `static/css/split/*.css` — idem, dans `style.css`
- `build.py` — concaténation + hash (token dans templates)
- `templates/partials/pages/*/` — pages (today, journal, chart, orderflow...)
- `templates/partials/overlays/` — modales, wizard, scripts.html

### Database
- `data/journal.db` — tables: `days`, `trades`, `trade_screenshots`, `user_settings`

## Modules clés (split JS)

| # | Fichier | Rôle |
|---|---------|------|
| 054 | `chart_view_core.js` | Cadrage X+Y canonique (communs widget + chart) |
| 055 | `indicator_vwap_core.js` | VWAP canonique, cache global |
| 060 | `btc_chart_widget.js` | Widget BTC dashboard (live, follow, drag libre) |
| 062 | `chart_page.js` | Page chart classique (indicateurs, drawings, volume profile) |
| 064 | `chart_drawings.js` | Outils de dessin (trendlines, fibo, etc.) |
| 065 | `volume_profile.js` | Profile de volume (canvas overlay) |
| 066 | `orderflow_engine.js` | Moteur orderflow (footprint canvas) |

## Architecture WS (060 + 062)

**Générationnel** : `wsGeneration` incrementé à chaque déconnexion.
Les callbacks `onopen/onmessage/onerror/onclose` sont nullifiés AVANT `ws.close()`.
Un vieux WebSocket ne peut plus relancer de reconnexion.

- `_disconnectWs(reason)` — incrémente la génération, supprime les handlers
- `_connectWs(reason, {force:true})` — idempotent, throttle 10s sauf `force`
- `_scheduleWsReconnect(reason)` — backoff exponentiel 2s^attempt, max 60s, 6 essais
- `_fetchAndRender` ne reset le WS QUE sur `init/user/timeframe` (pas sur auto)
- Connexion WS effectuée APRES `setData()` via `setTimeout(250ms)`

**REST fallback** : `_fetchLatestCandleOnly()` — ne fait pas de full render.
Utilise `series.update()` au lieu de `setData()`. Guards `token/timeframe` anti-stale.

## Countdown

Basé sur `countdownAnchor` :
```js
countdownAnchor = {
  candleCloseMs,          // closeTime Binance (k.T) ou openTime + interval
  remainingAtAnchorMs,    // closeMs - Date.now() au moment du calcul
  perfAtAnchor,           // performance.now() pour descente monotone
  source,                 // 'fetch', 'ws', 'rest-fallback'
};
```
Tick : `remaining = anchor.remainingAtAnchorMs - (performance.now() - anchor.perfAtAnchor)`

Pas de `clockOffset`. Pas de clear du timer à 0:00. Mise à jour via WS/fetch/REST.

## VWAP (055)

- Source canonique fixe par période : 1D/7D=15m, 30D=1h, 90D=4h
- Cache du RÉSULTAT VWAP, pas des klines brutes
- `endTime = getLastClosedCandleEndTime(interval)` — fenêtre stable
- `drawVwapForChart(state, period, shouldAbort)` — abort check avant chaque await et setData
- `shouldAbort` = callback qui vérifie `token !== renderToken || tf !== timeframe`

## Chart View (054)

- `computePriceRange(candles, visibleBars, padding)` — range Y sur N bougies
- `setPriceRange(priceScale, range, ref)` — via LWC v5 API ou fallback
- `applyBestView(chart, series, candles, config, withProgRangeFn, ref)` — X+Y
- `makeAutoscaleInfoProvider(ref)` — provider dynamique pour candleSeries
- Configs : `WIDGET_VIEW` (compact, follow) vs `CHART_VIEW` (large, libre)

## Règles de debug

1. **Console DevTools** : arme la plus puissante. Mesurer, pas déduire.
2. **3 échecs = changer de cadre**, pas raffiner.
3. **Demander AVANT d'écrire** : "c'est quoi X ? comment tu l'utilises ?"
4. **Solution la plus simple** : 1 flag + 1 setTimeout, pas 4 mécanismes.
5. **focusout arrive AVANT click** → flag différé setTimeout.
6. **Timestamp > booléen** pour cooldowns.

## API (endpoints principaux)

- `GET /api/market/klines?symbol=BTCUSDT&interval=3m&limit=300` — klines
- `GET /api/market/trades?symbol=BTCUSDT&limit=50` — trades récents
- `GET /api/market/orderbook?symbol=BTCUSDT&limit=20` — carnet d'ordres
- `GET /api/market/time` — timestamp serveur
- Voir `docs/API_ROUTES.md` pour les 49 routes complètes.

## Serveurs (WSL)

Deux serveurs Flask coexistent :
- **Windows** : `.venv/Scripts/python.exe app.py` sur `127.0.0.1:5001` (navigateur)
- **Linux** : `.venv_linux/bin/python app.py` sur `127.0.0.1:5000` (curl/test)

Le navigateur Windows utilise le serveur Windows. Les curl WSL utilisent Linux.
Après modif Python, tuer les DEUX. `pkill -f 'python app.py'` ne tue que le Linux.

## Repo

Public sur `github.com/Gxb78/cockpit-v3`. Ne jamais commiter secrets, clés API, tokens,
chemins utilisateur locaux, ou données personnelles.
