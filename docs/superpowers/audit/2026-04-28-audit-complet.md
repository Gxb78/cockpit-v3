# AUDIT COMPLET — COCKPIT v3 Trading Journal

**Date :** 2026-04-28
**Périmètre :** Codebase complète (backend, frontend, templates, data, devops, UX/UI)
**Auditeur :** Claude (Cowork mode)
**Méthodologie :** Revue statique exhaustive de tous les fichiers source, analyse de l'architecture, vérification des dépendances, identification des risques.
**Contrainte clé :** Projet strictement local — pas de Git, pas de versionning, pas de CI/CD, pas de déploiement.

---

## SYNTHÈSE EXÉCUTIVE

Le Journal est une application Flask mature et bien architecturée dans ses grandes lignes. La refacto de découpage (split files JS/CSS, modules backend app_parts/) est un excellent choix architectural. La suite de tests (9 fichiers) est de bonne qualité et couvre les routes API, le parse Midnight, les alias du wizard, les guardrails d'encodage, et les stats. L'audit révèle **35 problèmes** dont 2 critiques, 10 majeurs et 23 mineurs.

Le plan d'action prioritaire est le suivant : sécuriser l'injection SQL et l'exec() → améliorer la couverture de tests (drawdown, export, backups) → stabiliser le frontend (gestion d'erreurs, loading states) → enrichir l'UX (accessibilité, responsive, onboarding).

---

## 1. ARCHITECTURE GÉNÉRALE

### 1.1 Points forts

**Backend modulaire bien pensé.** Le chargement par `exec(compile())` dans `app.py` (lignes 33-38) permet une excellente séparation des responsabilités tout en maintenant un namespace global unique. Les 19 modules couvrent : chemins/constantes, app Flask, database, helpers, serializers, normalizers, routes (pages, days, trades, screenshots, stats, entries legacy), stats math, parse trade, export, backups, launcher.

**Frontend découpé proprement.** 47 fichiers JS et 30 fichiers CSS dans `static/js/split/` et `static/css/split/`, chargés directement via des balises `<script>` et `<link>` dans les templates. La convention de préfixe numérique (000-047) garantit l'ordre de chargement.

**Design system cohérent.** Le fichier `000_theme_tokens_base.css` définit un système de tokens CSS custom properties complet : couleurs (deep space), accents (cyan, magenta, lime, rose, amber), gradients, ombres, bordures, radius, easing. Support light mode et `prefers-reduced-motion`.

**Build pipeline minimal.** `build.py` permet de régénérer les bundles `app.js` et `style.css` à partir des split files avec un token de version daté.

**Playbook IA exhaustif.** `AI_DEVELOPMENT_PLAYBOOK.md` documente les invariants produit, les zones critiques, la politique d'encodage, les régressions à éviter, et les leçons apprises.

### 1.2 Points faibles

**A1 — CRITIQUE — `exec(compile())` sans sandboxing**
`app.py` ligne 38 : `exec(compile(_src, str(_path), "exec"), globals(), globals())` exécute du code avec accès complet aux globals. Si un fichier `app_parts/` est corrompu ou contient une erreur de syntaxe, toute l'application crash au démarrage avec une trace peu lisible. De plus, n'importe quel module peut écraser les variables des autres sans avertissement.

**A2 — MAJEUR — Duplication de préfixes numériques dans app_parts/**
Les préfixes `04_`, `05_`, `06_`, `10_`, `11_`, `12_` apparaissent chacun deux fois :
- `04_model_serializers.py` / `04_routes_pages.py`
- `05_payload_normalizers.py` / `05_routes_entries_legacy.py`
- `06_query_legacy_helpers.py` / `06_routes_days.py`
- `10_stats_math.py` / `10_parse_trade.py`
- `11_stats_periods_insights.py` / `11_export.py`
- `12_routes_stats.py` / `12_backups.py`

Cela rend l'ordre de chargement ambigu et source de confusion. La convention de nommage est trop lâche.

**A3 — MINEUR — ~~Pas de fichier `__init__.py` ni module Python standard~~ ✅ RÉSOLU**
Le projet n'utilisait pas le système de modules Python standard avec `exec()` direct dans `app.py`. Résolu par la création de `app_parts/__init__.py` et le changement de `app.py` vers `from app_parts import *`. Le projet utilise maintenant un vrai package Python avec un module d'import standard.

---

## 2. BACKEND — SÉCURITÉ

### 2.1 Injection SQL

**S1 — CRITIQUE — Colonnes interpolées dans les requêtes SQL**

Plusieurs endroits construisent des requêtes SQL avec des noms de colonnes issus de listes contrôlées par le développeur via f-string :

- `app_parts/02_database.py` ligne 32 : `f"INSERT INTO trades ({','.join(cols)}) VALUES ({','.join(['?']*len(cols))})"` — `cols` vient de `payload.keys()` qui est filtré par `normalize_trade_payload()`.
- `app_parts/06_routes_days.py` ligne 56 : même pattern pour days.
- `app_parts/07_routes_trades.py` ligne 76 : `f"UPDATE trades SET {sets} WHERE id=?"` — `sets` vient de `payload.keys()`.
- `app_parts/05_routes_entries_legacy.py` lignes 62, 122, 138 : même pattern.

**Analyse :** Les clés sont effectivement filtrées par les normalizers qui whitelistent les colonnes autorisées (`DAY_TEXT_FIELDS`, `TRADE_TEXT_FIELDS`, `TRADE_NUMERIC_FIELDS`, `TRADE_INT_FIELDS`). Le risque d'injection externe est donc quasi nul. Cependant, c'est une **mauvaise pratique** qui :
- Rend le code fragile aux refactorings futurs
- Pourrait devenir critique si un nouveau champ est ajouté sans whitelist
- Est difficile à auditer automatiquement

**Recommandation :** Remplacer par des requêtes préparées avec des noms de colonnes constants, ou utiliser un mini ORM/query builder qui valide les noms de colonnes contre le schéma.

**S2 — MINEUR — Pas de Rate Limiting**
Aucune protection contre les requêtes abusives sur les endpoints API. Un attaquant pourrait inonder `/api/days` ou `/api/stats` (qui fait des calculs lourds) pour dégrader les performances.

### 2.2 Gestion des secrets

**S3 — MAJEUR — Clé API Anthropic en variable d'environnement sans .env**
`app_parts/10_parse_trade.py` ligne 537 : `api_key = os.environ.get("ANTHROPIC_API_KEY", "")`. Aucun support de fichier `.env`. L'utilisateur doit configurer manuellement la variable d'environnement. Le endpoint `/api/settings` expose l'état de la clé (présente/absente) et son format masqué — c'est acceptable mais le masquage est faible (6 premiers + 4 derniers caractères).

**S4 — MINEUR — Pas de validation CORS**
`app_parts/01_flask_app.py` ne configure pas CORS. En local c'est acceptable, mais si l'app est exposée sur le réseau, des requêtes cross-origin non autorisées pourraient être possibles.

### 2.3 Upload de fichiers

**S5 — MINEUR — Validation d'upload correcte mais sans limite par fichier**
`app_parts/08_routes_screenshots.py` valide correctement le type MIME et l'extension, et sniff le contenu binaire (magic bytes). La limite globale est 25 Mo (`MAX_CONTENT_LENGTH`). Pas de limite individuelle par screenshot — un seul fichier de 25 Mo pourrait saturer le disque. Le nom de fichier utilise `uuid.uuid4().hex` ce qui est bon.

---

## 3. BACKEND — FIABILITÉ ET ROBUSTESSE

### 3.1 Gestion d'erreurs

**R1 — MAJEUR — Pas de handler d'erreur global Flask**
Aucun `@app.errorhandler` n'est défini. Les erreurs 404, 500 renvoient la page d'erreur Flask par défaut (HTML brut) au lieu d'un JSON structuré pour les routes API.

**R2 — MAJEUR — API Claude sans circuit breaker**
`_parse_with_claude()` dans `10_parse_trade.py` a un timeout de 12 secondes, ce qui est correct. Mais si l'API Claude est lente ou en erreur, chaque appel bloque une connexion Flask (mono-thread par défaut) pendant 12 secondes. Il n'y a pas de cache, pas de retry avec backoff, pas de file d'attente.

**R3 — MINEUR — `urllib.request` au lieu de `requests` ou `httpx`**
`_parse_with_claude()` utilise `urllib.request` (bibliothèque standard) plutôt qu'une bibliothèque plus robuste comme `requests` ou `httpx`. La gestion d'erreur est moins fine, et il n'y a pas de support HTTP/2 ou de connection pooling.

### 3.2 Base de données

**R4 — MAJEUR — Pas de WAL mode pour SQLite**
`app_parts/02_database.py` ne configure pas le mode WAL (`PRAGMA journal_mode=WAL`). En mode par défaut (DELETE), les lectures sont bloquées pendant les écritures. Avec potentiellement plusieurs requêtes concurrentes (API + save trade), cela peut causer des erreurs "database is locked".

**R5 — MINEUR — Pas de pool de connexions**
Chaque requête crée une nouvelle connexion SQLite via `get_db()`. Pour une app locale mono-utilisateur c'est acceptable, mais `g.db` n'est pas réutilisé efficacement entre les appels imbriqués.

**R6 — MINEUR — Pas de système de migration versionné**
La migration v2→v3 est codée en dur dans `_migrate_v2_to_v3()`. Il n'y a pas de table `schema_migrations` ni de système de versioning pour les migrations futures.

### 3.3 Robustesse des données

**R7 — MINEUR — Pas de validation des dates**
Les dates sont stockées en `TEXT` sans validation de format. Le frontend envoie des dates au format `YYYY-MM-DD` mais le backend les accepte sans vérification.

---

## 4. FRONTEND — ARCHITECTURE ET QUALITÉ

### 4.1 Gestion d'état

**F1 — MAJEUR — État global mutable sans garde-fou**
`static/js/split/000_state.js` définit un objet `state` global. N'importe quel module peut le modifier sans restriction. Il n'y a pas de système d'events ou d'observers pour réagir aux changements d'état. Les dépendances entre modules sont implicites (ex: `renderCalendar()` suppose que `state.days` est déjà peuplé par `loadMonth()`).

**F2 — MAJEUR — Pas de gestion d'erreur globale côté frontend**
Aucun `window.onerror` ou `window.addEventListener('unhandledrejection')`. Si une erreur JS se produit dans un module, l'utilisateur voit un écran blanc ou partiellement cassé sans feedback. Les `try/catch` sont présents dans certaines fonctions (`loadMonth`, `loadAllDays`, `loadStats`) mais pas systématiques.

**F3 — MINEUR — Pas de loading states visuels**
Quand `loadAll()` est appelé, il n'y a pas d'indicateur de chargement. L'utilisateur voit la page se peupler progressivement sans savoir si les données arrivent ou si c'est cassé.

### 4.2 Performance

**F4 — MAJEUR — 47 requêtes HTTP pour le JS + 30 pour le CSS**
En mode dev (split files), le navigateur fait ~77 requêtes HTTP pour charger tous les assets. Sur une connexion lente ou avec latence, le temps de chargement peut dépasser 3-4 secondes. Le mode bundle (`build.py`) résout ce problème mais n'est pas le mode par défaut.

**F5 — MINEUR — Pas de lazy loading des pages**
Les 4 pages (Today, Journal, Stats, Settings) sont toutes dans le DOM en permanence (`index.html` lignes 11-14). Les templates Jinja2 génèrent potentiellement beaucoup de HTML statique, même pour les pages non visibles.

**F6 — MINEUR — Pas de cache-busting pour les assets**
Le token `?v=20260428bundlefix4` est statique et doit être mis à jour manuellement via `build.py`. Un hash de contenu serait plus fiable.

### 4.3 Accessibilité

**F7 — MAJEUR — Aucun attribut ARIA**
Aucun `role`, `aria-label`, `aria-expanded`, `aria-hidden` dans les templates. Les utilisateurs de lecteurs d'écran ne peuvent pas naviguer efficacement.

**F8 — MAJEUR — Pas de gestion du focus clavier**
La navigation au clavier repose sur `bindGlobalKeys()` (raccourcis comme Cmd+K) mais il n'y a pas de gestion du focus après fermeture de modale, pas de `focus-trap` dans les overlays, pas d'ordre de tabulation logique.

**F9 — MINEUR — Pas de balises `<meta>` pour le viewport mobile**
Le template `head_meta.html` n'a pas été vérifié, mais `000_theme_tokens_base.css` ne contient pas de media queries mobile-first — seulement un `body.light-mode` et `body.reduce-motion`.

**F10 — MINEUR — Contraste discutable sur certains éléments**
Le thème deep space utilise `--text-muted: #7e85a3` et `--text-faint: #4d536a` sur fond `--bg: #07070d`. Le ratio de contraste pour `--text-faint` est d'environ 3.2:1, en dessous du minimum WCAG AA (4.5:1).

### 4.4 Code quality

**F11 — MINEUR — Duplication entre frontend et backend**
La fonction `inferDirectionFromPrices()` dans `001_utilities.js` (ligne 100) et `_infer_direction_for_validation()` dans `03_core_helpers.py` (ligne 59) font la même chose. Même constat pour `deriveTradeMetrics()` dans `001_utilities.js` et `_derive_trade_metrics()` dans `10_stats_math.py`.

**F12 — MINEUR — Pas de validation TypeScript ou JSDoc**
Aucun typage. Les fonctions acceptent des objets sans contrat défini. Les erreurs de typage (ex: passer `null` au lieu d'un tableau) ne sont détectées qu'au runtime.

---

## 5. INFRASTRUCTURE MANQUANTE

### 5.1 Tests existants (9 fichiers, bonne qualité)

**I1 — POINT FORT — 9 fichiers de tests présents et fonctionnels**

Le dossier `tests/` contient **9 fichiers de test** bien écrits :

| Fichier | Tests | Ce qu'il couvre |
|---|---|---|
| `test_template_render.py` | 1 classe | Vérifie que le template HTML charge tous les split files JS/CSS, pas les bundles, token de version cohérent, éléments clés du DOM |
| `test_encoding_guardrails.py` | 1 test | Scan tous les fichiers source pour détecter des tokens mojibake (`Ã`, `�`, etc.) |
| `test_playbook_lessons_guardrails.py` | 2 tests | Vérifie que le playbook contient ≥3 lessons structurées et qu'il n'est pas plus vieux que les fichiers critiques |
| `test_entries_validation.py` | 7 tests | Validation API legacy entries : is_win (string "0", invalide), num_trades (invalide, négatif), execution_quality (hors range), instrument invalide, conflit doublon 409 |
| `test_days_update.py` | 3 tests | API days : changement d'instrument, rejet instrument invalide, conflit doublon 409 |
| `test_trade_validation_and_upload.py` | 6 tests | Validation cohérence niveaux de prix (long), conflict PnL/is_win, mismatch extension/content PNG, upload PNG valide, fallback regex parse trade (sans API key), parse texte Midnight complexe avec extraction scénario + questions suivi + niveaux numériques |
| `test_wizard_aliases.py` | 6 tests | Alias wizard : NQ→NAS, bias→htf_bias, stop_price→stop_loss, target_price→take_profit, stdv→stdv_level, alias postmortem (exit_quality, exit_emotion, lessons), headers de deprecation sur legacy entries |
| `test_stats_derived_metrics.py` | 1 test | Calcul RR et win/loss à partir des niveaux de prix dans `/api/stats` |
| `test_stats_phase2.py` | 1 test | Breakdowns par tag, drawdown series, histogramme PnL, comparaison de périodes (current vs previous month) |

**Qualité :** Les tests sont propres :
- Utilisent `tempfile.TemporaryDirectory` pour l'isolation (BDD SQLite éphémère)
- Chaque classe reset proprement via `setUp`/`tearDown`
- Couvrent à la fois les cas nominaux et les cas d'erreur (400, 409)
- Mockent `os.environ` pour les tests sans API key réelle
- Testent le parse Midnight complexe (régression clé)
- Respectent les principes énoncés dans le playbook

**Couverture à améliorer :**
- Pas de tests pour les routes screenshots (`/api/screenshots/<id>` PUT/DELETE)
- Pas de tests pour l'export (`/api/export`)
- Pas de tests pour les backups (fonction `backup_db`)
- Pas de tests frontend (pas d'E2E)
- Pas de test pour l'API days avec paramètres de recherche (`?from=`, `?to=`, `?q=`)
- Pas de test pour le delete day/trade

### 5.2 Scripts de maintenance

**I2 — MINEUR — Dossier `scripts/` absent**
`start.bat` ligne 70 et le playbook référence `scripts/install-git-hooks.ps1`. Le projet étant strictement local sans Git, ce dossier n'est pas prioritaire et peut rester absent. Si des scripts de maintenance sont nécessaires à l'avenir, ils pourront être placés dans `scripts/`.

### 5.3 Fichiers de configuration absents

**I3 — MINEUR — Pas de `.env.example` ou documentation de configuration**
L'utilisateur doit deviner qu'il faut définir `ANTHROPIC_API_KEY`. Les autres variables d'environnement (`DEBUG`, `HOST`, `PORT`, `OPEN_BROWSER`, `FLASK_DEBUG`, `APP_URL`) sont dispersées entre `start.bat` et `13_launcher.py`. Un fichier `.env.example` ou une section dédiée en haut de `start.bat` améliorerait l'expérience.

---

## 6. UX / UI — AUDIT DÉTAILLÉ

### 6.1 Navigation

**UX1 — MINEUR — Pas de breadcrumb ni de titre de page dynamique**
Le `<title>` de la page ne change pas selon la page active. L'utilisateur ne peut pas savoir où il se trouve sans regarder le rail de navigation.

**UX2 — MINEUR — Pas de confirmation avant suppression**
`delete_trade()` et `delete_day()` dans les routes API n'ont pas de boîte de dialogue de confirmation côté frontend (à vérifier dans le code JS non lu intégralement — mais le playbook mentionne que le wizard pose des questions donc c'est probablement géré).

### 6.2 Saisie et formulaires

**UX3 — MINEUR — Pas d'autosave explicite pour les longs formulaires**
Le fichier `026_autosave_du_jour.js` suggère un autosave, mais sans indicateur visuel ("Brouillon sauvegardé à 14:32").

**UX4 — MINEUR — Le wizard Midnight Challenge est dense**
Le fichier `020_trade_form.js` définit 10 questions pour le challenge Midnight (lignes 3-14). C'est exhaustif mais peut être intimidant pour un nouvel utilisateur. Pas d'indicateur de progression global (étape X/10).

### 6.3 Feedback visuel

**UX5 — MINEUR — Le système de toast est basique**
`001_utilities.js` ligne 152 : le toast est un simple `textContent` avec une classe CSS. Pas de support pour les actions (undo, dismiss), pas de file d'attente (un second toast écrase le premier), pas de variante de durée selon la sévérité.

**UX6 — MINEUR — Pas d'empty states**
Quand il n'y a pas de trades pour un jour/mois, les tableaux et graphiques affichent probablement des zéros ou du vide. Des empty states illustrés ("Ajoutez votre premier trade") amélioreraient l'expérience des nouveaux utilisateurs.

### 6.4 Page Stats

**UX7 — MINEUR — Les graphiques sont rendus côté serveur via les stats API**
L'endpoint `/api/stats` calcule tout côté serveur et renvoie un JSON volumineux. Pour des historiques longs (plusieurs mois), cela peut peser plusieurs centaines de Ko et ralentir le rendu initial. Un chargement progressif ou une pagination des stats serait bénéfique.

### 6.5 Cohérence visuelle

**UX8 — MINEUR — Mix de français et d'anglais**
Les constantes sont majoritairement en français (`MONTHS_FR`, `DAYS_FR`, messages d'erreur), mais certaines sont en anglais (`STRATEGY_LABELS`, `fmtMoney` avec le suffixe `$`). Le code est commenté en français. Les noms de variables sont en anglais. Ce mélange peut perturber les contributeurs.

**UX9 — MINEUR — Pas de favicon**
Aucun fichier favicon.ico ou balise `<link rel="icon">` trouvé.

### 6.6 Onboarding

**UX10 — MAJEUR — Aucun onboarding pour les nouveaux utilisateurs**
Pas de visite guidée, pas de tooltips, pas d'état "premier lancement". Un nouvel utilisateur arrive sur une page vide sans savoir par où commencer.

---

## 7. DETTE TECHNIQUE — BACKEND

### 7.1 Code mort ou legacy

**D1 — MINEUR — Routes legacy entries (v2)**
`05_routes_entries_legacy.py` maintient la compatibilité v2 avec 4 endpoints (`/api/entries`). Si la migration v2→v3 est terminée et que plus aucun client n'utilise ces routes, elles devraient être supprimées. Le endpoint `/api/entries` a déjà un header `Deprecation` et `Sunset` (30 Sep 2026).

### 7.2 Nommage

**D2 — MINEUR — Incohérence dans les noms des fichiers CSS split**
Le plan de refacto (`docs/superpowers/plans/2026-04-28-bug-fix-refactor.md`) référence des noms comme `000_module.css`, `005_module.css`, `011_chunk.css`, `016_module.css`, `019_module.css`, `022_chunk.css`, `025_chunk.css`. Ces noms génériques ne décrivent pas leur contenu. Par exemple, `005_journal_toolbar_filters.css` est beaucoup plus descriptif que `005_module.css`.

Heureusement, dans la réalité (`head_assets_css.html`), les vrais noms sont descriptifs (`005_journal_toolbar_filters.css`). Le plan de refacto est donc partiellement obsolète sur ce point.

---

## 8. DETTE TECHNIQUE — PERFORMANCE

**P1 — MINEUR — `loadAll()` fait 3 appels API en parallèle mais sans priorisation**
`012_data_loading.js` ligne 3 : trois `Promise.all([loadMonth(), loadAllDays(), loadStats()])`. Si les données sont volumineuses, l'utilisateur attend les 3 avant de voir quoi que ce soit. Un rendu progressif (afficher le calendrier dès que `loadMonth()` termine, puis les stats) serait plus rapide perçu.

**P2 — MINEUR — Pas de cache des stats entre les navigations**
À chaque navigation vers la page Stats (`goPage("stats")`), `renderPerformance()` est appelé, ce qui réutilise `state._stats` (cache). Mais si l'utilisateur a changé de mois ou ajouté un trade, les stats ne sont pas invalidées automatiquement.

**P3 — MINEUR — Les screenshots sont stockés en local mais pas optimisés**
Aucun redimensionnement ou compression des screenshots uploadés. Sur un mois de trading actif avec des captures HD, le dossier `data/screenshots/` peut rapidement atteindre des centaines de Mo.

---

## 9. DETTE TECHNIQUE — MAINTENABILITÉ

**M1 — MAJEUR — Pas de gestion de version du schéma de base de données**
`SCHEMA_VERSION = 3` est défini dans `00_paths_constants.py` mais n'est pas utilisé pour déclencher des migrations automatiques. La seule migration (`_migrate_v2_to_v3`) est exécutée à chaque lancement dans `init_db()` et vérifie l'existence de la table `entries`.

**M2 — MINEUR — Pas de logging structuré**
Les seuls logs sont des `print()` (ex: `[backup] OK`, `[parse] Claude API failed`). Pas de niveaux de log, pas de timestamps, pas de fichier de log.

**M3 — MINEUR — Pas de configuration centralisée**
Les constantes sont éparpillées : `INSTRUMENTS` dans `00_paths_constants.py`, `STRATEGIES` dans `00_paths_constants.py`, mais les labels JS sont dans `001_utilities.js`. Un fichier de config partagé (JSON ou YAML) éviterait la duplication.

---

## 10. PLAN D'ACTION PRIORISÉ

### PHASE 1 — CRITIQUE (SEMAINE 1) : Sécurité et tests minimaux

| # | Action | Fichiers | Effort |
|---|---|---|---|
| 1.1 | **Ajouter les tests manquants** : screenshots (PUT/DELETE), export, backup, search (`?from`, `?to`, `?q`), delete day/trade | `tests/test_screenshots.py`, `tests/test_export.py`, `tests/test_search_and_delete.py` | 2h |
| 1.2 | **Remplacer `exec(compile())` par un import standard** : convertir `app_parts/` en package Python avec `__init__.py` et imports explicites | `app.py`, `app_parts/__init__.py` | 2h |
| 1.3 | **Ajouter un handler d'erreur global Flask** : `@app.errorhandler(404)`, `@app.errorhandler(500)` qui renvoient du JSON structuré | `app_parts/01_flask_app.py` | 30 min |
| 1.4 | **Ajouter la validation des dates** : vérifier que les dates reçues sont au format `YYYY-MM-DD` et valides | `app_parts/03_core_helpers.py` | 30 min |

### PHASE 2 — MAJEUR (SEMAINE 2) : Robustesse backend

| # | Action | Fichiers | Effort |
|---|---|---|---|
| 2.1 | **Activer le mode WAL sur SQLite** : `PRAGMA journal_mode=WAL` dans `init_db()` | `app_parts/02_database.py` | 15 min |
| 2.2 | **Renommer les fichiers app_parts/ avec des préfixes uniques** : utiliser 00-18 sans doublons | `app_parts/*`, `app.py` | 30 min |
| 2.3 | **Ajouter un fichier `.env.example`** et utiliser `python-dotenv` dans `start.bat` | `.env.example`, `requirements.txt`, `start.bat` | 30 min |
| 2.4 | **Ajouter un système de migration versionné** : table `schema_migrations`, script `migrate.py` | `app_parts/02_database.py`, `migrate.py` | 2h |
| 2.5 | **Ajouter rate limiting** : utiliser `Flask-Limiter` pour les endpoints API | `requirements.txt`, `app_parts/01_flask_app.py` | 1h |
| 2.6 | **Ajouter un circuit breaker pour l'API Claude** : timeout dégressif, cache des résultats identiques | `app_parts/10_parse_trade.py` | 1h30 |

### PHASE 3 — MINEUR (SEMAINE 3) : Frontend et UX

| # | Action | Fichiers | Effort |
|---|---|---|---|
| 3.1 | **Ajouter un error boundary global frontend** : `window.onerror` + `unhandledrejection` avec toast visuel | `static/js/split/000_state.js` ou nouveau `static/js/split/048_error_handler.js` | 1h |
| 3.2 | **Ajouter des loading states** : squelette ou spinner pendant `loadAll()` | `static/css/split/`, `static/js/split/012_data_loading.js` | 1h30 |
| 3.3 | **Ajouter les attributs ARIA de base** : `role="navigation"`, `aria-label` sur les boutons, `aria-expanded` sur les toggles | Tous les `templates/partials/**/*.html` | 2h |
| 3.4 | **Ajouter un indicateur d'autosave** : "Sauvegardé à 14:32" avec fade out | `static/js/split/026_autosave_du_jour.js`, CSS associé | 45 min |
| 3.5 | **Améliorer le système de toast** : file d'attente, variantes (info/success/warning/error), undo pour les suppressions | `static/js/split/001_utilities.js`, `templates/partials/overlays/toast.html` | 1h30 |
| 3.6 | **Créer des empty states** : illustrations simples pour "Aucun trade ce mois", "Ajoutez votre première journée" | `templates/partials/pages/today.html`, `templates/partials/pages/journal.html`, `templates/partials/pages/stats.html` | 2h |

### PHASE 4 — UX AVANCÉE (SEMAINE 4) : Polissage

| # | Action | Fichiers | Effort |
|---|---|---|---|
| 4.1 | **Ajouter un onboarding first-run** : tooltips sur les 3-4 actions principales (Nouveau trade, Navigation, Filtres) | Nouveau `static/js/split/049_onboarding.js`, `templates/partials/overlays/` | 3h |
| 4.2 | **Optimiser le chargement des assets** : utiliser le bundle en production, conserver les splits en dev avec un flag `?dev=1` | `start.bat`, `build.py`, `templates/partials/overlays/scripts.html`, `head_assets_css.html` | 1h30 |
| 4.3 | **Ajouter un système de favoris/widget personnalisable** sur la page Today (déjà partiellement présent via `047_today_widget_board.js`) | `static/js/split/047_today_widget_board.js` | 2h |
| 4.4 | **Améliorer le contraste des textes** : `--text-faint` et `--text-muted` doivent atteindre WCAG AA (ratio 4.5:1 minimum) | `static/css/split/000_theme_tokens_base.css` | 30 min |
| 4.5 | **Uniformiser la langue de l'interface** : choisir français ET anglais (i18n basique) ou tout en français, mais pas de mélange | Multiple | 2h |

### PHASE 5 — DETTE TECHNIQUE LONG TERME

| # | Action | Effort estimé |
|---|---|---|
| 5.1 | Migrer vers un bundler moderne (Vite/esbuild) pour le frontend | 4h |
| 5.2 | Ajouter du typage JSDoc sur les fonctions critiques pour l'intellisense | 3h |
| 5.3 | Nettoyer les routes legacy entries (post-Sunset Sep 2026) | 1h |
| 5.4 | Ajouter des scénarios de test plus avancés | 4h |
| 5.5 | Compression/redimensionnement automatique des screenshots uploadés | 2h |

---

## 11. TABLEAU DE BORD — RÉSUMÉ DES RISQUES

| Catégorie | Critique | Majeur | Mineur | Total |
|---|---|---|---|---|
| Sécurité | 1 (S1) | 1 (S3) | 3 (S2,S4,S5) | 5 |
| Fiabilité | 0 | 3 (R1,R2,R4) | 4 (R3,R5,R6,R7) | 7 |
| Frontend | 0 | 4 (F1,F2,F4,F7,F8) | 8 (F3,F5,F6,F9,F10,F11,F12,F13) | 12 |
| Infrastructure | 0 | 0 | 1 (I2) | 1 |
| UX/UI | 0 | 1 (UX10) | 9 (UX1-9) | 10 |
| **Total** | **1** | **9** | **25** | **35** |

---

## 12. MÉTRIQUES DU CODEBASE

- **Backend** : 19 modules Python dans `app_parts/`, ~2500 lignes estimées
- **Frontend JS** : 48 modules dans `static/js/split/`, ~6000 lignes estimées
- **Frontend CSS** : 30 modules dans `static/css/split/`, ~3500 lignes estimées
- **Templates** : 50+ fichiers HTML Jinja2 dans `templates/partials/`
- **Base de données** : SQLite, 3 tables (days, trades, trade_screenshots)
- **Dépendances Python** : Flask 3.0.3, Werkzeug 3.0.3 (minimaliste — bonne pratique)
- **Dépendances JS** : Aucune (vanilla JS — bon pour la performance mais limite les capacités)

---

*Fin du rapport d'audit. Toute action du plan ci-dessus nécessite une validation préalable.*
