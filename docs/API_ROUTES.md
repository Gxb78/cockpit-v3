# Inventaire des Routes Flask — Projet Journal (cockpit-v3)

**Total : 49 routes uniques** (certaines partagent la même fonction via alias)

---

## 1. Fichier : `app_parts/07_routes_pages.py`

| # | Méthode | Path | Fonction | Paramètres | Body JSON | Retour | Codes HTTP | Description |
|---|---------|------|----------|------------|-----------|--------|------------|-------------|
| 1 | GET | `/` | `index()` | — | — | HTML (index.html) | 200 | Page principale de l'application (SPA) |
| 2 | GET | `/screenshots/<filename>` | `serve_screenshot(filename)` | Path: `filename` (str) | — | Fichier image (PNG/JPG/GIF/WebP) | 200, 404 | Sert les fichiers de screenshots depuis le dossier dédié. Vérifie l'extension contre une whitelist. |
| 3 | GET | `/api/debug/runtime` | `debug_runtime()` | — | — | JSON : `{now, pid, cwd, base_dir, python_executable, env, db_path, assets}` | 200 | Infos de runtime (PID, env, chemins, versions des assets JS/CSS) |
| 4 | GET | `/api/settings` | `get_settings()` | — | — | JSON : `{ai_api_key_present, ai_api_key_masked, ai_provider, ai_config_hint, deepseek}` | 200 | État des clés API (Anthropic + DeepSeek), masquées pour la sécurité |
| 5 | GET | `/api/config` | `get_config()` | — | — | JSON : `{instruments, strategies, strategy_labels, debug}` | 200 | Configuration partagée envoyée au frontend (instruments, stratégies, mode debug) |
| 6 | POST | `/api/settings/key` | `save_api_key()` | — | `{key: string, provider: "deepseek"|"anthropic"}` | JSON : `{ok, message}` | 200, 400, 500 | Sauvegarde une clé API dans le fichier `.env` et dans l'environnement courant |

---

## 2. Fichier : `app_parts/09_routes_days.py`

| # | Méthode | Path | Fonction | Paramètres | Body JSON | Retour | Codes HTTP | Description |
|---|---------|------|----------|------------|-----------|--------|------------|-------------|
| 7 | GET | `/api/days` | `list_days()` | Query : `from`(str, opt.), `to`(str, opt.), `month`(str, opt.), `instrument`(str, opt.), `q`(str, opt.) | — | JSON : `[jour1, jour2, ...]` | 200, 400 | Liste des jours de trading avec filtres (plage dates, mois, instrument, recherche texte). Rate-limité 60/min. |
| 8 | GET | `/api/days/lookup` | `lookup_day()` | Query : `date`(str, req.), `instrument`(str, req.) | — | JSON : jour complet ou `null` | 200, 400, 404 | Cherche un jour spécifique par date + instrument |
| 9 | GET | `/api/days/<int:day_id>` | `get_day(day_id)` | Path : `day_id` (int) | — | JSON : jour complet avec trades | 200, 404 | Récupère un jour avec ses trades par son ID |
| 10 | POST | `/api/days` | `create_day()` | — | `{date: string, instrument: string, htf_bias?, session?, htf_context?, daily_notes?, tags?}` | JSON : jour créé | 201, 200, 400, 409 | Crée un nouveau jour. Retourne 200 si déjà existant (duplicate date+instrument) |
| 11 | PUT | `/api/days/<int:day_id>` | `update_day(day_id)` | Path : `day_id` (int) | `{date?, instrument?, htf_bias?, session?, htf_context?, daily_notes?, tags?}` | JSON : jour mis à jour | 200, 400, 404, 409 | Met à jour un jour existant (champs partiels acceptés) |
| 12 | DELETE | `/api/days/<int:day_id>` | `delete_day(day_id)` | Path : `day_id` (int) | — | JSON : `{ok: true}` | 200 | Supprime un jour + tous ses trades + screenshots associés (cascade fichier) |

---

## 3. Fichier : `app_parts/10_routes_trades.py`

| # | Méthode | Path | Fonction | Paramètres | Body JSON | Retour | Codes HTTP | Description |
|---|---------|------|----------|------------|-----------|--------|------------|-------------|
| 13 | GET | `/api/days/<int:day_id>/trades` | `list_trades(day_id)` | Path : `day_id` (int) | — | JSON : `[trade1, trade2, ...]` | 200, 404 | Liste tous les trades d'un jour |
| 14 | POST | `/api/days/<int:day_id>/trades` | `create_trade(day_id)` | Path : `day_id` (int) | `{strategy, direction, entry_price, stop_loss, take_profit, position_size, ...}` | JSON : trade créé | 201, 400, 404 | Crée un trade. Valide la sémantique (long: SL<entry<TP), calcule PnL auto, évalue le plan |
| 15 | GET | `/api/trades/<int:trade_id>` | `get_trade(trade_id)` | Path : `trade_id` (int) | — | JSON : trade complet avec screenshots | 200, 404 | Récupère un trade par son ID |
| 16 | GET | `/api/trades/favorites` | `list_favorite_trades()` | — | — | JSON : `[trade1, ...]` | 200 | Liste tous les trades marqués "favoris" (tag `favoris`), avec données du jour et screenshots |
| 17 | PUT | `/api/trades/<int:trade_id>` | `update_trade(trade_id)` | Path : `trade_id` (int) | `{strategy?, direction?, entry_price?, ...}` | JSON : trade mis à jour | 200, 400, 404 | Met à jour un trade. Re-valide la sémantique, recalcule PnL et plan |
| 18 | DELETE | `/api/trades/<int:trade_id>` | `delete_trade(trade_id)` | Path : `trade_id` (int) | — | JSON : `{ok: true}` | 200 | Supprime un trade + ses fichiers screenshots |
| 19 | DELETE | `/api/days/<int:day_id>/trades` | `delete_day_trades(day_id)` | Path : `day_id` (int) | — | JSON : `{ok, deleted}` | 200, 404 | Supprime tous les trades d'un jour (avec screenshots) |
| 20 | POST | `/api/trades/batch-delete` | `batch_delete_trades()` | — | `{ids: [int, ...]}` | JSON : `{ok, deleted}` | 200, 400 | Supprime plusieurs trades par une liste d'IDs. Supprime aussi les screenshots |
| 21 | GET | `/api/trades/instruments` | `list_instruments()` | — | — | JSON : `{ok, instruments: [...]}` | 200 | Liste des instruments distincts présents dans la DB |
| 22 | GET | `/api/journal/search` | `journal_search()` | Query : `q`(str, req., min 2 car.) | — | JSON : `{ok, days, count}` | 200 | Recherche full-text dans les jours (notes, tags) |

---

## 4. Fichier : `app_parts/11_routes_screenshots.py`

| # | Méthode | Path | Fonction | Paramètres | Body / Form | Retour | Codes HTTP | Description |
|---|---------|------|----------|------------|-------------|--------|------------|-------------|
| 23 | POST | `/api/trades/<int:trade_id>/screenshots` | `upload_screenshot(trade_id)` | Path : `trade_id` (int) | form-data : `file` (image), `caption`(str, opt.) | JSON : `{id, filename, caption}` | 201, 400, 404 | Upload un screenshot pour un trade. Vérifie type MIME, taille (max ~10Mo), compresse via Pillow (max 1920px). Rate-limité 30/min. |
| 24 | DELETE | `/api/screenshots/<int:shot_id>` | `delete_screenshot(shot_id)` | Path : `shot_id` (int) | — | JSON : `{ok: true}` | 200, 404 | Supprime un screenshot (fichier + DB) |
| 25 | PUT | `/api/screenshots/<int:shot_id>` | `update_screenshot(shot_id)` | Path : `shot_id` (int) | `{caption: string}` | JSON : `{ok: true}` | 200, 400, 404 | Met à jour la légende (caption) d'un screenshot |

---

## 5. Fichier : `app_parts/14_routes_stats.py`

| # | Méthode | Path | Fonction | Paramètres | Body | Retour | Codes HTTP | Description |
|---|---------|------|----------|------------|------|--------|------------|-------------|
| 26 | GET | `/api/stats` | `stats()` | Query : `instrument`(str, opt.), `from`(str, opt.), `to`(str, opt.) | — | JSON : `{total_pnl, winrate, wins, losses, num_entries, num_trades, avg_rr, per_instrument, cumulative, streak, best_streak, by_setup, by_session, by_bias, by_dow, by_tag, plan_matrix, by_plan_error, plan_summary, activity, rr_buckets, insights, drawdown, pnl_histogram, period_compare}` | 200, 400 | Statistiques complètes : PnL, winrate, RR, par instrument/setup/session/biais HTF/jour semaine/tag, matrice plan, drawdown, histogramme PnL, comparaison mensuelle, insights automatiques. Rate-limité 30/min. |

---

## 6. Fichier : `app_parts/15_parse_trade.py`

| # | Méthode | Path | Fonction | Paramètres | Body JSON | Retour | Codes HTTP | Description |
|---|---------|------|----------|------------|-----------|--------|------------|-------------|
| 27 | POST | `/api/parse-trade` | `parse_trade()` | — | `{text: string}` | JSON : `{pnl?, rr?, is_win?, strategy?, direction?, why_trade?, why_entry?, why_stop?, why_tp?, stdv_level?, scenario?, thesis_validated?, lessons_learned?, tags?, _source, _warning?, _retryable?}` | 200, 400 | Parse un texte libre de description de trade. Tente d'abord Claude API (Anthropic) avec fallback regex. Pour Midnight Model, infère les signaux PO3/STDV/IFVG/breaker, génère narratifs et questions de suivi. Rate-limité 20/min. |

---

## 7. Fichier : `app_parts/16_export.py`

| # | Méthode | Path | Fonction | Paramètres | Body | Retour | Codes HTTP | Description |
|---|---------|------|----------|------------|------|--------|------------|-------------|
| 28 | GET | `/api/export` | `export_data()` | Query : `instrument`(str, opt.), `from`(str, opt.), `to`(str, opt.), `format`(str: "json"|"csv", defaut "json") | — | JSON ou CSV (fichier téléchargeable) | 200, 400 | Export des données avec filtres. JSON : version 3 avec jours/trades/screenshots. CSV : 1 ligne par trade avec en-têtes. Rate-limité 20/min. |
| 29 | GET | `/api/db/info` | `db_info()` | — | — | JSON : `{db_path, size_bytes, size_str, num_days, num_trades}` | 200 | Infos sur la base de données (taille, nombre de jours/trades). Rate-limité 10/min. |

---

## 8. Fichier : `app_parts/17_reset.py`

| # | Méthode | Path | Fonction | Paramètres | Body JSON | Retour | Codes HTTP | Description |
|---|---------|------|----------|------------|-----------|--------|------------|-------------|
| 30 | POST | `/api/data/reset` | `reset_all_data()` | — | `{confirm: "RESET ALL DATA"}` | JSON : `{ok, backup, deleted: {days, trades, screenshots}, message}` | 200, 400, 415, 500 | Supprime TOUTES les données (jours, trades, screenshots). Crée un backup automatique avant. Rate-limité 3/min. |

---

## 9. Fichier : `app_parts/18_launcher.py`

| # | Méthode | Path | Fonction | Paramètres | Body | Retour | Codes HTTP | Description |
|---|---------|------|----------|------------|------|--------|------------|-------------|
| 31 | POST | `/api/dev/restart` | `dev_restart()` | — | — | JSON : `{ok, message}` | 200, 403 | Redémarre le serveur Flask (dev only). Rebuild le bundle JS d'abord, puis `os.execv`. Désactivé hors DEBUG. |

---

## 10. Fichier : `app_parts/19_ai_chat.py`

| # | Méthode | Path | Fonction | Paramètres | Body JSON | Retour | Codes HTTP | Description |
|---|---------|------|----------|------------|-----------|--------|------------|-------------|
| 32 | POST | `/api/ai/chat/upload-image` | `ai_chat_upload_image()` | — | form-data : `file` (image) | JSON : `{ok, image_token, message}` | 200, 400, 500 | Upload temporaire d'une image dans le chat. Retourne un `image_token` valable 10 min pour `attach_screenshot`. Rate-limité 30/min. |
| 33 | GET | `/api/ai/chat` | `ai_chat_options()` | — | — | JSON : description de l'endpoint, schéma body, tools disponibles | 200 | Documentation de l'endpoint chat + pré-flight CORS |
| 33b | OPTIONS | `/api/ai/chat` | `ai_chat_options()` | — | — | JSON : `{ok: true}` | 200 | Pre-flight CORS |
| 34 | POST | `/api/ai/chat` | `ai_chat()` | — | `{messages: [{role, content}, ...], reset?: bool, pending_image_token?: string}` | JSON : `{response, tool_calls_count, model, source}` | 200, 400 | Chat conversationnel avec DeepSeek v4 Flash. Tool-calling intégré (CRUD days/trades, stats, screenshots). Cache LRU + circuit breaker. Rate-limité 20/min. |
| 35 | POST | `/api/ai/ping` | `ai_ping()` | — | — | JSON : `{ok, status, message, model?}` | 200 | Test de validité de la clé API DeepSeek. Envoie un probe minimal (1 token). |

---

## 11. Fichier : `app_parts/21_routes_ml.py`

| # | Méthode | Path | Fonction | Paramètres | Body JSON | Retour | Codes HTTP | Description |
|---|---------|------|----------|------------|-----------|--------|------------|-------------|
| 36 | GET | `/api/ml/insights` | `ml_insights()` | Query : `instrument`(str, opt.), `from`(str, opt.), `to`(str, opt.), `kind`(str, opt.) | — | JSON : `{patterns, count, filters}` | 200 | Patterns / knowledge_cards détectés par l'analyse ML |
| 37 | GET | `/api/ml/patterns` | `ml_insights()` (alias) | (mêmes params que ci-dessus) | — | JSON : idem | 200 | Alias de `/api/ml/insights` |
| 38 | GET | `/api/ml/profile` | `ml_profile()` | Query : `instrument`(str, opt.) | — | JSON : profil du trader | 200 | Profil complet : forces, faiblesses, préférences |
| 39 | GET | `/api/ml/setups/similar` | `ml_similar_setups()` | Query : `trade_id`(int, req.), `limit`(int, opt., defaut 5, max 20) | — | JSON : trades similaires | 200, 400 | Trouve des setups similaires à un trade de référence |
| 40 | POST | `/api/ml/analyze` | `ml_analyze()` | — | `{instrument?, from?, to?}` | JSON : `{ok, patterns, profile, pattern_count}` | 200 | Déclenche une analyse ML à la demande |
| 41 | POST | `/api/ml/invalidate` | `ml_invalidate()` | — | `{full?: bool}` | JSON : `{ok, cache_invalidated}` | 200 | Invalide le cache ML. `full=true` vide tout le cache. |
| 42 | GET | `/api/ml/stats` | `ml_stats()` | — | — | JSON : stats du moteur ML | 200 | Stats du moteur ML (nb patterns, état cache, etc.) |
| 43 | GET | `/api/ml/knowledge` | `ml_list_knowledge()` | — | — | JSON : `[card1, card2, ...]` | 200 | Liste les knowledge cards sauvegardées par l'utilisateur (`is_user_saved=1`) |
| 44 | POST | `/api/ml/knowledge` | `ml_save_knowledge()` | — | `{kind, title, body?, confidence?, evidence_count?, total_count?, tags?}` | JSON : card créée | 201, 400 | Sauvegarde/upsert d'une knowledge card |
| 45 | DELETE | `/api/ml/knowledge/<int:card_id>` | `ml_delete_knowledge(card_id)` | Path : `card_id` (int) | — | JSON : `{ok: true}` | 200 | Archive une knowledge card par ID (`is_user_saved=0`) |
| 46 | DELETE | `/api/ml/knowledge` | `ml_delete_knowledge_by_key()` | Query : `kind`(str, req.), `title`(str, req.) | — | JSON : `{ok: true}` | 200 | Archive une knowledge card par kind + title |

---

## 12. Fichier : `app_parts/22_routes_settings.py`

| # | Méthode | Path | Fonction | Paramètres | Body JSON | Retour | Codes HTTP | Description |
|---|---------|------|----------|------------|-----------|--------|------------|-------------|
| 47 | GET | `/api/user/settings` | `get_user_settings()` | — | — | JSON : `{ok, settings: {profile?, custom_strategies?, custom_tags?, preferences?}}` | 200 | Récupère tous les settings utilisateur depuis la table `user_settings` |
| 48 | POST | `/api/user/settings` | `save_user_settings()` | — | `{profile?, custom_strategies?, custom_tags?, preferences?}` | JSON : `{ok, updated_at}` | 200, 400 | Sauvegarde les settings utilisateur. Clés autorisées : `profile`, `custom_strategies`, `custom_tags`, `preferences`. |

---

## 13. Fichier : `app_parts/23_routes_market.py`

| # | Méthode | Path | Fonction | Paramètres | Body | Retour | Codes HTTP | Description |
|---|---------|------|----------|------------|------|--------|------------|-------------|
| 49 | GET | `/api/market/klines` | `market_klines()` | Query : `symbol`(str, defaut "BTCUSDT"), `interval`(str, defaut "1h"), `limit`(int, defaut 1000), `startTime`(int, opt., ms) | — | JSON : `{symbol, interval, candles: [{time, open, high, low, close, volume}]}` | 200, 502 | Proxy Binance pour les chandeliers (klines). Pagination automatique pour les limites >1000. Retourne les bougies en secondes Unix. |

---

## Résumé par méthode HTTP

| Méthode | Nombre | Routes |
|---------|--------|--------|
| GET | 26 | `/`, `/screenshots/<filename>`, `/api/debug/runtime`, `/api/settings`, `/api/config`, `/api/days`, `/api/days/lookup`, `/api/days/<int:day_id>`, `/api/days/<int:day_id>/trades`, `/api/trades/<int:trade_id>`, `/api/trades/favorites`, `/api/trades/instruments`, `/api/journal/search`, `/api/stats`, `/api/export`, `/api/db/info`, `/api/ai/chat`, `/api/ml/insights`, `/api/ml/patterns`, `/api/ml/profile`, `/api/ml/setups/similar`, `/api/ml/stats`, `/api/ml/knowledge`, `/api/user/settings`, `/api/market/klines` |
| POST | 17 | `/api/settings/key`, `/api/days`, `/api/days/<int:day_id>/trades`, `/api/trades/batch-delete`, `/api/trades/<int:trade_id>/screenshots`, `/api/parse-trade`, `/api/data/reset`, `/api/dev/restart`, `/api/ai/chat/upload-image`, `/api/ai/chat`, `/api/ai/ping`, `/api/ml/analyze`, `/api/ml/invalidate`, `/api/ml/knowledge`, `/api/user/settings` |
| PUT | 3 | `/api/days/<int:day_id>`, `/api/trades/<int:trade_id>`, `/api/screenshots/<int:shot_id>` |
| DELETE | 5 | `/api/days/<int:day_id>`, `/api/trades/<int:trade_id>`, `/api/days/<int:day_id>/trades`, `/api/screenshots/<int:shot_id>`, `/api/ml/knowledge/<int:card_id>`, `/api/ml/knowledge` |
| OPTIONS | 1 | `/api/ai/chat` |

**Note :** `@app.route("/api/ai/chat", methods=["GET", "OPTIONS"])` est un seul décorateur qui gère GET et OPTIONS, compté comme 2 verbes. `GET /api/ml/insights` et `GET /api/ml/patterns` partagent la même fonction `ml_insights()`.
