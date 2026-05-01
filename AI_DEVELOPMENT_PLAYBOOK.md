# AI Development Playbook - Journal Cockpit v3

Ce fichier est la source de verite pour toute IA qui modifie ce repo.
But: avancer vite sans casser l'UX metier, sans casser le flow Midnight, sans reintroduire de bugs d'encodage.

## 1) Product invariants (non negotiables)

### 1.1 Creation de trade (wizard + modale)
- Toujours demander/selectionner la `strategie` dans le parcours.
- Ne jamais reintroduire `Mode complet` / `Trade rapide`.
- Toutes les questions restent optionnelles (aucun blocage hard sur un champ manquant).
- Fin de parcours: `challenge rapide final` non bloquant.
- Si infos manquantes (ex: SL, TP, profit, risque), proposer de les completer dans le chat de fin.
- L'utilisateur peut ignorer et fermer la modale sans etre bloque.

### 1.2 Regles Midnight
- `Open Midnight` n'apparait que si `strategie == midnight_model`.
- Questions/wording Midnight seulement dans ce contexte.
- Le challenge est court, numerote, actionnable, et sert a verifier rapidement la coherence du scenario.
- Le parser texte doit comprendre le scenario narratif Midnight et mapper vers les bons champs.

### 1.3 Journal / calendrier
- Apres `create/update/delete` trade: calendrier et stats visibles mis a jour sans refresh navigateur.
- Le refresh data doit passer par le pipeline front central (`loadAll()` + rerender).
- Sur desktop, viser un ecran compact (limiter le scroll vertical inutile).
- Simplifier la selection de dates et la navigation mensuelle.

## 2) Zones critiques du code

### 2.1 Backend
- `app.py` charge les modules `app_parts/*.py`.
- Tables metier: `days`, `trades`, `trade_screenshots`.
- Parser narration: `app_parts/10_parse_trade.py`.

### 2.2 Frontend
- Etat global: `static/js/split/000_state.js`.
- Wizard trade: `040_wizard_core.js`, `041_wizskip.js`, `042_wizsetdate.js`, `043_wizsetdir.js`, `044_wizreadfileasdataurl.js`, `045_bindwizard.js`.
- Modale trade: `static/js/split/020_trade_form.js`.
- Narration auto-fill: `static/js/split/038_custom_blocks.js`.
- Journal rendering/data: `004_loadjournaltablesort.js`, `005_setjournalcustomrange.js`, `011_calendar_nav.js`, `012_data_loading.js`, `015_calendar.js`.
- Templates trade: `templates/partials/overlays/modal/trade_form/*.html`.

### 2.3 Ordre des scripts
- Les modules JS split doivent rester en ordre numerique dans `templates/partials/overlays/scripts.html`.
- Ne pas permuter cet ordre sans verifier les dependances globales implicites.

## 3) Politique encodage (obligatoire)

### 3.1 Standard
- Tous les fichiers texte en UTF-8.
- Eviter les copier/coller Word/Slack/Notion sans verification finale.
- Favoriser ASCII dans code/commentaires/messages quand possible.

### 3.2 Marqueurs de corruption a detecter
- Tokens typiques: `Ã`, `Â`, `â`, `\uFFFD`.
- Si present dans runtime (hors tests de guardrail): corriger immediatement.

### 3.3 Ecriture de fichiers en PowerShell
- Toujours forcer l'encodage:

```powershell
Set-Content -LiteralPath <file> -Value <text> -Encoding utf8
```

- Pour append:

```powershell
Add-Content -LiteralPath <file> -Value <text> -Encoding utf8
```

- Eviter les commandes qui ecrivent avec un encodage implicite.

### 3.4 Scan rapide
```powershell
rg -n --hidden -g '!.venv/**' -g '!data/**' -g '!__pycache__/**' 'Ã|Â|â|�' app_parts static templates docs
```

### 3.5 Test guardrail encodage
```powershell
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -Command .\.venv\Scripts\python.exe -m unittest tests.test_encoding_guardrails -v
```

Note: `tests/test_encoding_guardrails.py` contient volontairement des tokens invalides dans ses fixtures.

### 3.6 Protocole de correction encodage
1. Corriger la source texte (jamais de workaround CSS/JS pour masquer).
2. Relancer le scan section 3.4.
3. Relancer les tests section 3.5 puis la suite complete.

## 4) Regressions a eviter par domaine

### 4.1 Si tu touches le flow trade
- Verifier que l'etape `strategie` est visible et exploitee.
- Verifier que `Open Midnight` reste conditionnel.
- Verifier que les champs restent optionnels.
- Verifier que le recap final demande les infos manquantes sans bloquer le save.
- Verifier coherence wizard + modale + parser texte backend.

### 4.2 Si tu touches le parser narration
- Verifier extraction de scenario Midnight depuis texte libre.
- Verifier mapping des niveaux (entry/sl/tp/stdv/liquidite) quand presents.
- Verifier generation de follow-up questions pertinentes si infos manquantes.
- Verifier que le wording final reste `challenge rapide` (pas de prose longue).

### 4.3 Si tu touches le journal
- Verifier periode (mois/semaine/custom), filtres, et navigation dates.
- Verifier que la page tient mieux sur une vue sans scroll inutile.
- Verifier synchro immediate apres save trade (sans refresh manuel).

## 5) Definition of Done (DoD)

Une tache n'est finie que si:
1. Le comportement produit attendu est respecte.
2. Les invariants section 1 sont respectes.
3. Aucun mojibake runtime.
4. Tests complets verts:

```powershell
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -Command .\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

5. Les fichiers modifies restent coherents en encodage UTF-8.

## 6) Checklist IA avant livraison

- J'ai lu les fichiers critiques du domaine modifie.
- Je n'ai pas reintroduit de modes ou champs obligatoires non voulus.
- J'ai garde la logique conditionnelle `midnight_model`.
- J'ai verifie le rerender calendrier sans refresh apres sauvegarde trade.
- J'ai execute scan encodage + tests.
- Je n'ai pas casse l'ordre des scripts split.

## 7) Convention wording (Midnight challenge rapide)

- Format court, numerote, orientee action.
- Prefixes standard:
  - `Challenge ...` pour manque d'info.
  - `Vigilance ...` pour risque ou contradiction.
  - `OK - ...` pour validation claire.
- Eviter les formulations vagues ou moralisatrices.

## 8) Protocole evolution future

1. Mettre a jour ce playbook avant ou en meme temps que la feature.
2. Ajouter un test de non-regression lie au bug/feature.
3. Deployer en lot coherent: UI + backend + parser + wording.
4. Si nouvelle regle produit contredit ce fichier, la regle produit recente prime et ce fichier doit etre adapte dans le meme patch.

## 8.1) Hook pre-commit (obligatoire en local)

- Le projet fournit un hook Git dans `.githooks/pre-commit`.
- Installation:
  - `start.bat hooks`
  - ou `powershell -ExecutionPolicy Bypass -File scripts/install-git-hooks.ps1`
- Le hook execute au minimum:
  - `tests.test_encoding_guardrails`
  - `tests.test_playbook_lessons_guardrails`
- Optionnel: suite complete avec `PRECOMMIT_FULL=1`.

## 9) Lessons apprises et bugs a ne pas reproduire

Regle: ne pas tenir un changelog "ce qui a change". Ne stocker ici que des lessons durables et des bugs a ne pas reproduire.

Format obligatoire d'une lesson:

### BUG-YYYYMMDD-XX - Titre court
- Symptome:
- Cause racine:
- Regle de prevention:
- Test de non-regression:
- Fichiers a surveiller:

### BUG-20260428-01 - Mojibake introduit par ecriture PowerShell implicite
- Symptome: textes UI affiches avec caracteres casses (`Ã`, `Â`, `â`).
- Cause racine: ecriture de fichiers texte sans forcer UTF-8.
- Regle de prevention: toute ecriture shell doit utiliser `Set-Content/Add-Content -Encoding utf8`.
- Test de non-regression: `tests/test_encoding_guardrails.py` + scan `rg` section 3.4.
- Fichiers a surveiller: `app_parts/*.py`, `static/js/split/*.js`, `templates/partials/**/*.html`, `AI_DEVELOPMENT_PLAYBOOK.md`.

### BUG-20260428-02 - Trade sauve mais calendrier non rafraichi
- Symptome: nouveau trade absent du calendrier tant que la page n'est pas rechargee.
- Cause racine: absence de refresh global post-save.
- Regle de prevention: apres create/update/delete trade, relancer pipeline data central (`loadAll()` + rerender).
- Test de non-regression: test API + verification UI manuelle du journal apres sauvegarde.
- Fichiers a surveiller: `static/js/split/012_data_loading.js`, `static/js/split/015_calendar.js`, `static/js/split/020_trade_form.js`.

### BUG-20260428-03 - Questions Midnight posees hors contexte
- Symptome: champ/questions `Open Midnight` visibles meme hors `midnight_model`.
- Cause racine: logique conditionnelle strategie absente/incomplete dans wizard ou modale.
- Regle de prevention: tout bloc Midnight doit etre strictement conditionne a `strategie == midnight_model`.
- Test de non-regression: scenario UI multi-strategies + parse narration Midnight.
- Fichiers a surveiller: `static/js/split/020_trade_form.js`, `static/js/split/040_wizard_core.js`, `app_parts/10_parse_trade.py`.

### BUG-20260429-01 - Tests ecrivent dans la DB de production (scope Python)
- - Symptome: tests fail avec 200 != 201, stats incorrectes (avg_rr 4.595 au lieu de 2.0), routes /api/entries introuvables (404).
- - Cause racine: `mod.DB_PATH = temp_path` ne change que `app.DB_PATH`. `get_db()` lit `app_parts.DB_PATH` (le namespace du module parent). Les deux divergent apres reassignment.
- - Regle de prevention: Toujours faire `import app_parts; app_parts.DB_PATH = ...` dans les tests, jamais `mod.DB_PATH = ...`.
- - Test de non-regression: `tests/test_stats_derived_metrics.py` (average RR sur DB isolee doit etre 2.0).
- - Fichiers a surveiller: `tests/*.py`.

### BUG-20260429-02 - data["date"] au lieu de date_val dans IntegrityError
- - Symptome: Dans le handler IntegrityError de `09_routes_days.py`, la recherche de l'enregistrement existant utilise `data["date"]` (valeur brute non validee) au lieu de `date_val` (validee via `_validate_date_key`).
- - Cause racine: La variable a ete renommee mais pas mise a jour partout.
- - Regle de prevention: Apres validation, utiliser systematiquement la variable validee dans tout le handler.
- - Test de non-regression: Creer un jour avec date valide puis le meme jour doit retourner 200 (selon le comportement actuel).
- - Fichiers a surveiller: `app_parts/09_routes_days.py`.

|### BUG-20260429-03 - 13 fichiers orphelins (code mort) dans app_parts/
- - Symptome: Fichiers non charges par `__init__.py` mais presents sur disque. Routes dupliquees et confuses.
- - Cause racine: Refactoring vers nouvelle numerotation sans nettoyage des anciens fichiers.
- - Regle de prevention: Nettoyer les fichiers orphelins immediatement apres refactoring. Verifier `__init__.py` vs `ls app_parts/`.
- - Test de non-regression: `app_parts/` ne doit contenir que les fichiers listes dans `__init__.py`.
- - Fichiers a surveiller: `app_parts/__init__.py`, `app_parts/*.py`.

### BUG-20260429-04 - build.py: bundle CSS vide quand tous les <link> sont supprimes
- - Symptome: Apres `python build.py`, `head_assets_css.html` est vide. Le bundle CSS n'est pas reference.
- - Cause racine: `switch_to_bundles()` supprime tous les `<link>` split puis cherche a inserer le bundle avant le premier `<link>` restant. S'il n'en reste pas (fichier vide), le bundle n'est pas ajoute.
- - Regle de prevention: Toujours verifier que `head_assets_css.html` contient le bundle apres build. Le fix utilise `if re.search(r'<link[^>]+rel="stylesheet"', text): ... else: text += bundle_tag`.
- - Test de non-regression: `python build.py && grep -q "style.css" templates/partials/layout/head_assets_css.html`
- - Fichiers a surveiller: `build.py`

### BUG-20260429-05 - build.py: restore_splits() contamine les templates avec le mauvais type
- - Symptome: Apres `python build.py --restore`, `head_assets_css.html` contient des `<script>` JS et `scripts.html` contient des `<link>` CSS. Les deux fichiers sont corrompus.
- - Cause racine: `restore_splits()` restaure les deux types (JS + CSS) dans les deux templates sans distinction.
- - Regle de prevention: Toujours specifier `js=True/False` et `css=True/False` dans les appels a `restore_splits()`.
- - Test de non-regression: `python build.py --restore && python build.py && python -m unittest discover -s tests`
- - Fichiers a surveiller: `build.py`, `templates/partials/layout/head_assets_css.html`, `templates/partials/overlays/scripts.html`

### BUG-20260429-06 - DATA CORRUMPUE - La base de donnees a ete videe pendant les tests/build
- - Symptome: data/journal.db existe mais toutes les tables sont vides (0 lignes). Les backups automatiques dans data/backups/ aussi.
- - Cause racine: Les tests unitaires et le build ont ete lances sans isolement de la DB. Le module `app_parts.DB_PATH` pointait vers la DB de production pendant les tests car `mod.DB_PATH = X` ne propage pas a `app_parts` (BUG-20260429-01). Un `init_db()` a ete appele sur la vraie DB, effacant les donnees.
- - Regle de prevention: NE JAMAIS lancer de tests sans verifier que `app_parts.DB_PATH` pointe vers une DB temporaire. Backup OBLIGATOIRE avant toute operation a risque sur le projet.
- - Test de non-regression: Avant chaque test, verifier `assert app_parts.DB_PATH != la_vraie_DB_prod`. Les tests utilisent `tempfile.TemporaryDirectory()` pour l'isolation.
- - Backup restaure: data/journal.db.pre_audit_backup (69632 bytes, 13 jours, 13 trades). DB corrompue conservee: data/journal.db.corrupted_empty.
- - Commande de backup: `cp data/journal.db data/journal.db.$(date +%Y%m%d-%H%M%S).backup`
- - Fichiers a surveiller: `data/journal.db`, `app_parts/00_paths_constants.py`, `app_parts/02_database.py`

### BUG-20260429-07 - NAS remplace par NQ comme instrument canonique
- - Symptome: L'instrument etait stocke comme "NAS" en base mais affiche "NQ" dans l'UI via alias. Changement de nom canonique de "NAS" vers "NQ".
- - Cause racine: L'utilisateur prefere le ticker NQ (Nasdaq Futures). NAS etait le canonique avec NQ comme alias d'affichage.
- - Regle de prevention: Le canonique est maintenant "NQ". L'alias inverse {"NAS": "NQ"} assure la retrocompatibilite pour les donnees existantes en base. Toute reference a "NAS" comme instrument doit etre remplacee par "NQ". Les fonctions `_to_canonical()` et `_display()` sont inversees.
- - Test de non-regression: `tests/test_wizard_aliases.py` — envoi de "NQ" en entree doit retourner "NQ" (anciennement normalise en "NAS").
- - Fichiers a surveiller: `config.json`, `app_parts/00_paths_constants.py`, `app_parts/19_ai_chat.py`, `static/js/split/001_utilities.js`, `static/js/split/029_command_palette.js`, `static/js/split/032_breakdowns.js`, `static/js/split/039_helpers.js`, `static/js/split/040_wizard_core.js`, `static/js/split/042_wizsetdate.js`, `templates/partials/layout/rail.html`, `templates/partials/overlays/modal/day_form.html`, `static/app.js`

### BUG-20260429-08 - Chatbot IA invente des jours feries car pas d'outil delete
- - Symptome: L'IA refuse de supprimer un trade le lundi 6 avril 2026 en pretendant que c'est un dimanche et jour ferie. En realite le 6 avril 2026 est bien un lundi.
- - Cause racine: Aucun outil `delete_trade` ou `delete_day` n'etait defini dans les tools du module `19_ai_chat.py`. L'IA ne pouvait pas executer la suppression, donc elle a hallucine une reponse au lieu d'avouer son incapacite.
- - Regle de prevention: TOUJOURS definir les outils delete quand on ajoute un chatbot CRUD. Les outils doivent etre: `delete_trade` (trade_id), `delete_day` (day_id). Le system prompt doit explicitement interdire de deviner les jours de la semaine et ordonner d'utiliser les outils de verification (`get_day`/`get_days`) avant de refuser une operation. Le prompt doit aussi exiger confirmation utilisateur avant toute suppression.
- - Test de non-regression: Aucun test unitaire direct (depend de l'API externe DeepSeek). Verifier manuellement que `/api/ai/chat` expose bien les tools `delete_trade` et `delete_day` dans sa reponse GET.
- - Fichiers a surveiller: `app_parts/19_ai_chat.py` (tools definitions + handlers + system prompt)

### BUG-20260429-09 - Chatbot IA : champs manquants dans update_day et stats limitees
- - Symptome: L'IA ne pouvait pas modifier l'instrument ou la date d'un jour de trading via update_day. Les stats renvoyees par get_stats etaient basiques (pas de breakdowns, drawdown, period compare, heatmap, etc.).
- - Cause racine: Les tools `update_day` n'exposaient pas les champs `instrument` et `date` dans leur parametrage. La fonction `_tool_get_stats()` etait une reimplementation simplifiee qui n'utilisait pas le pipeline complet de `14_routes_stats.py` (_bucket, _derive_trade_metrics, _compute_drawdown_series, _build_period_comparison, _streak_stats, _build_insights, _build_pnl_histogram).
- - Regle de prevention: Les tools IA doivent exposer TOUS les champs que les routes backend supportent. Ne pas reimplementer des fonctions stats simplifiees — utiliser le meme pipeline que la route API. Le fichier `14_routes_stats.py` est la reference du pipeline stats complet.
- - Test de non-regression: Verifier que `_tool_get_stats()` appelle `_derive_trade_metrics`, `_bucket`, `_bucket_multi`, `_compute_drawdown_series`, `_build_pnl_histogram`, `_build_period_comparison`, `_streak_stats`, `_build_insights`.
- - Fichiers a surveiller: `app_parts/19_ai_chat.py` (definitions tools + handlers + _tool_get_stats)

### BUG-20260429-10 - Suppression du champ emotional_state de toutes les couches
- - Symptome: L'etat emotionnel (calm/focused/anxious/fomo/revenge/overconfident) etait encore present dans le code apres refactoring. L'utilisateur a demande sa suppression complete.
- - Cause racine: Le champ etait distribue dans ~20 fichiers (backend whitelists, normalizers, stats pipeline, parseur, tools IA, JS split wizard + formulaire, templates HTML, tests). La colonne SQL a ete preservee.
- - Regle de prevention: Suivre la checklist Phase 5 du playbook pour toute suppression multi-couche : backend whitelist → model columns → normalizer aliases → routes stats → parseur keywords → IA system prompt → IA tool schemas → IA handlers → JS split (wizard init, formulaire payload, custom blocks, stats render) → templates HTML → tests → rebuild.
- - Test de non-regression: `grep -rn 'emotional_state\|exit_emotion\|by_emo'` hors DB et bundle doit retourner 0. Tests unitaires doivent passer.
- - Fichiers a surveiller: Tous les fichiers listes dans la checklist Phase 5.

### BUG-20260429-11 - Backups lances pendant les tests Windows
- Symptome: la suite de tests echoue au nettoyage de `TemporaryDirectory()` avec `PermissionError: [WinError 32]` sur `journal.db` ou `backups/journal-*.db`.
- Cause racine: le garde-fou de `_auto_backup_after_write()` detectait `/tmp/` mais pas les chemins Windows `AppData/Local/Temp`, donc des threads de backup ouvraient encore les DB temporaires.
- Regle de prevention: normaliser les chemins en minuscules avec slashs avant de tester les repertoires temporaires.
- Test de non-regression: `python -m unittest discover -s tests -v` doit passer sans fichiers verrouilles dans les dossiers temporaires.
- Fichiers a surveiller: `app_parts/17_backups.py`, `tests/*.py`.

### BUG-20260429-12 - Controles Journal cables en JS mais absents du template
- Symptome: les modes mois/semaine, calendrier/table, periode custom et filtres trade existaient cote JS mais restaient invisibles dans le Journal.
- Cause racine: `templates/partials/pages/journal/filters.html` etait vide alors que les handlers attendaient des IDs comme `calendarViewToggle`, `calendarLayoutToggle` et `journalFilterStrategy`.
- Regle de prevention: quand un handler UI est ajoute, verifier que le template expose l'element cible et que `rg "id"` trouve une source HTML avant build.
- Test de non-regression: `tests/test_template_render.py` + verification manuelle de la toolbar Journal apres build.
- Fichiers a surveiller: `templates/partials/pages/journal/filters.html`, `static/js/split/004_loadjournaltablesort.js`, `static/js/split/005_setjournalcustomrange.js`, `static/js/split/006_comparetext.js`.

### BUG-20260430-01 - Design trade modifie dans les splits sans bundle regenere
- Symptome: la modale trades peut rester sur l'ancien rendu si `static/js/split/*` ou `static/css/split/*` sont modifies mais que `static/app.js` et `static/style.css` ne sont pas reconstruits.
- Cause racine: le template charge les bundles en mode normal, donc les changements de source split ne sont visibles qu'apres `build.py`.
- Regle de prevention: apres toute retouche UI trade dans les splits, executer `python build.py` et verifier que `templates/partials/layout/head_assets_css.html` et `templates/partials/overlays/scripts.html` pointent vers le nouveau token.
- Test de non-regression: `python build.py && python -m unittest tests.test_template_render -v && python -m unittest discover -s tests -v`.
- Fichiers a surveiller: `static/js/split/019_trades_list_dans_la_modal.js`, `static/css/split/040_trade_cockpit_cards.css`, `static/app.js`, `static/style.css`, `templates/partials/layout/head_assets_css.html`, `static/templates/partials/overlays/scripts.html`.

### BUG-20260430-02 - Sparkline Net P&L coupe (viewBox SVG != hauteur JS)
- Symptome: la sparkline du widget Net P&L est coupee/tronquee — les pics de la courbe sortent du cadre SVG et sont invisibles, ne laissant qu'une ligne plate ou incomplete.
- Cause racine: le JS (`013_kpis.js:renderPnlSparkline()`) dessine les points du `<polyline>` sur une hauteur de 42 (`height=42`, `padY=5` → les points Y vont de 5 a 37). Mais le template `001_kpi_total_pnl.html` avait `viewBox="0 0 180 30"`, donc tout point y > 30 etait hors viewBox et invisible. Le mismatch entre les deux hauteurs faisait sortir les extremums de la courbe. Meme avec `overflow:visible` en CSS, le viewBox SVG tronque le rendu.
- Regle de prevention: TOUJOURS aligner le `viewBox` SVG sur les dimensions reelles utilisees par le JS. Quand tu modifies la hauteur de rendu dans `renderPnlSparkline()` (`height=42`), verifie que le viewBox dans le template HTML correspond exactement (`viewBox="0 0 180 42"`). Les 3 couches doivent etre coherentes: (1) JS `height`, (2) SVG `viewBox`, (3) CSS `height` sur l'element SVG. En cas de mismatch, c'est le viewBox qui gagne (le plus restrictif) et les points hors viewBox sont silencieusement coupes sans erreur JS.
- Test de non-regression: verifier que `grep 'viewBox' templates/partials/pages/today/widgets/001_kpi_total_pnl.html` contient `"0 0 180 42"` et que `grep 'height =' static/js/split/013_kpis.js` contient `42`. Verifier manuellement que la sparkline affiche tous les points (les pics ne sont pas coupes).
- Fichiers a surveiller: `templates/partials/pages/today/widgets/001_kpi_total_pnl.html` (viewBox SVG), `static/js/split/013_kpis.js` (height du JS), `static/css/split/003_settings_chip_remove_hover.css` (height CSS 42 OK), `static/css/split/038_kpi_upgrade.css` (overflow:visible), `static/css/split/043_dashboard_pnl_motion_fix.css` (overflow+contain).

### BUG-20260430-03 - Deplacer le contexte du jour casse l'autosave si les IDs quittent la modale
- Symptome: en transformant le contexte du jour en widget dashboard, les champs `entryDate`, `entryInstrument`, `htfContext`, `dailyNotes` et `dayForm` ne sont plus dans `#entryModal`, alors que l'autosave et les fonctions de creation de jour les utilisent toujours.
- Cause racine: la logique day context etait couplee a la presence visuelle du formulaire dans la modale (`triggerDayAutosave()` ignorait les changements quand la modale etait fermee, et `saveDayContext()` se basait surtout sur `state.currentDayId`).
- Regle de prevention: quand un formulaire visible est deplace entre surfaces, garder une seule source DOM avec les IDs historiques ou refactorer toutes les fonctions d'acces en helpers explicites. Ne pas laisser un guard visuel (`modal hidden`) bloquer une logique devenue dashboard.
- Test de non-regression: verifier que le HTML rendu ne contient qu'un seul `id="dayForm"`, que `today_context` est dans `templates/partials/pages/today/grid.html`, que `entry_modal.html` n'inclut plus `modal/day_form.html`, puis lancer `python build.py && python -m unittest discover -s tests -v`.
- Fichiers a surveiller: `templates/partials/pages/today/widgets/006_day_context.html`, `templates/partials/pages/today/grid.html`, `templates/partials/overlays/entry_modal.html`, `static/js/split/014_today_page.js`, `static/js/split/018_day_form.js`, `static/js/split/026_autosave_du_jour.js`, `static/js/split/017_modal_gestion_globale.js`.

### BUG-20260430-04 - Clic calendrier: ne pas ouvrir la modale si un jour a deja des trades
- Symptome: le clic sur une case calendrier contenant des trades ouvrait directement la modale de jour ou le picker multi-instruments, alors que l'UX attendue est une revue visuelle inline des trades.
- Cause racine: `bindCalendarGridActions()` ne distinguait que "aucune entree", "une entree" et "plusieurs entrees"; il ne testait pas le nombre total de trades avant d'ouvrir la modale.
- Regle de prevention: pour les interactions calendrier, raisonner sur le nombre total de trades (`sum(day.trades.length)`) avant le nombre d'entrees day. Le cas `tradeCount > 0` doit rester un chemin inline dedie; le cas `tradeCount === 0` garde le flux historique.
- Note UX: les cards de revue ne doivent pas etre collees sous la grille calendrier. Elles doivent rester separees visuellement, en layer centre dans le panel principal, sans backdrop de modale.
- Test de non-regression: verifier dans `static/js/split/015_calendar.js` que `renderJournalDayTrades(key, info.days)` est appele avant `openExistingDay()`/`openPickerForDate()`, puis lancer `python build.py && node --check static/app.js && python -m unittest discover -s tests -v`.
- Fichiers a surveiller: `static/js/split/015_calendar.js`, `static/js/split/056_journal_day_trade_cards.js`, `templates/partials/pages/journal/calendar_focus.html`, `static/css/split/046_journal_day_trade_cards.css`.

### BUG-20260501-01 - leverage jamais persiste en DB (payload.pop detruit la cle)
- Symptome: le champ `leverage` (colonne DB creee par migration v6) reste toujours NULL en base, meme apres creation/mise a jour d'un trade avec un levier.
- Cause racine: `_auto_calc_pnl()` dans `03_core_helpers.py` utilisait `payload.pop("leverage", None)` aux 3 branches (pnl manuel, infos manquantes, calcul auto). `pop()` SUPPRIME la cle du payload, donc l'INSERT/UPDATE SQL ne recoit jamais la valeur. Le calcul utilisait bien le levier (ligne 252, branche calcul auto) mais il etait perdu apres.
- Regle de prevention: TOUJOURS utiliser `payload.get("leverage")` pas `payload.pop("leverage")` dans `_auto_calc_pnl()`. Le pop detruit la donnee. Si tu veux lire sans supprimer, c'est `get()`. Si tu dois pop (par ex. pour eviter de passer un champ calcule a SQL), remets-le dans le payload apres usage.
- Test de non-regression: verifier que `grep -n 'pop.*leverage' app_parts/03_core_helpers.py` retourne 0. Creer un trade avec `leverage=3` via API, lire le trade, verifier que `leverage==3` retourne.
- Fichiers a surveiller: `app_parts/03_core_helpers.py` (fonction `_auto_calc_pnl`), `app_parts/10_routes_trades.py` (routes create/update).

### BUG-20260501-02 - Orphelins dans app_parts/__archive__ jamais nettoies + header.html vide
- Symptome: 18 fichiers orphelins dans `app_parts/__archive__/` (anciennes versions non chargees) + `templates/partials/pages/journal/header.html` vide (1 ligne commentaire) cassant 22 IDs DOM.
- Cause racine: accumulation d'archives sans cleanup. Le header a ete vide pendant un refactoring sans restaurer les IDs (prevMonth, nextMonth, stats, month picker, focus toggle).
- Regle de prevention: apres chaque refactoring, verifier `git ls-files app_parts/__archive__/` = 0. Verifier que les IDs DOM references par les JS existent dans les templates HTML (`rg -rn '#prevMonth\|#nextMonth\|#monthLabel' templates/ --type html`).
- Test de non-regression: `python -m unittest tests.test_template_render -v` (verifie que les templates rendent correctement). Apres build, verifier que les IDs sont presents dans le template rendu.
- Fichiers a surveiller: `app_parts/__archive__/*`, `templates/partials/pages/journal/header.html`, tous les JS qui referencent des IDs de navigation/stats header.

### BUG-20260501-03 - Parametre mort `existing` dans _auto_calc_pnl + catch silencieux state.js
- Symptome: `_auto_calc_pnl()` acceptait `existing=None` mais ne l'utilisait jamais. `19_ai_chat.py` lui passait `existing` pour rien. State.js ligne 79 catch silencieux qui avale les erreurs de listeners.
- Cause racine: accumulation de code mort et de catch aveugles.
- Regle de prevention: apres chaque refactoring, chercher les parametres de fonction inutilises (`grep -rn "def.*existing=None" app_parts/`). Les catch doivent toujours logger (`console.warn` minimum).
|- Test de non-regression: `grep -n 'existing=None' app_parts/03_core_helpers.py` doit retourner 0. `grep 'catch.*{}' static/js/split/000_state.js` ne doit pas exister.
|- Fichiers a surveiller: `app_parts/03_core_helpers.py`, `app_parts/19_ai_chat.py`, `static/js/split/000_state.js`.

### BUG-20260501-04 - Changement de type d'un champ state (tag string → array) sans retrocompat
- Symptome: apres migration `tag` de string vers array, les filtres chargeaient depuis localStorage avec `typeof tag === "string"` et plantaient les fonctions qui attendaient un array.
- Cause racine: le format stocke en localStorage etait `"news_trade"` (string) mais le nouveau code attend `["news_trade"]` (array).
- Regle de prevention: TOUJOURS gerer la retrocompat dans `sanitizeJournalTradeFilters()` quand un champ change de type. Pattern: `if (Array.isArray(raw.tag)) { ... } else if (typeof raw.tag === "string") { out.tag = [raw.tag]; }`.
- Test de non-regression: charger un filtre depuis localStorage avec ancien format string → doit retourner un array.
- Fichiers a surveiller: `static/js/split/003_addcustomstrategyfromsettings.js` (sanitize).

### BUG-20260501-05 - Placeholder invisible quand input a une valeur
- Symptome: le placeholder "2 car. min" ne s'affichait pas quand le champ contenait deja "a" car les placeholders sont caches par la valeur de l'input.
- Cause racine: utilisation d'un `placeholder` au lieu d'un element HTML positionne.
- Regle de prevention: pour afficher un hint en presence d'une valeur, utiliser un `<span>` en absolute overlay, pas le placeholder de l'input. Placer le span en `position: absolute; right: 8px; top: 50%; transform: translateY(-50%); pointer-events: none;` avec `padding-right` sur l'input pour eviter le chevauchement.
- Test de non-regression: saisir "a" → le hint "2 car. min" est visible a droite du "a".
- Fichiers a surveiller: `static/js/split/006_comparetext.js`, `static/css/split/033_priority2_journal_trade.css`.
