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
- **Documentation complète des 49 routes API :** `docs/API_ROUTES.md` (méthode, path, params, body, retour, codes HTTP).

### 2.2 Frontend
- Etat global: `static/js/split/000_state.js`.
- **Architecture CSS (52 splits → `static/style.css`) :**
  - Ordre alphabétique du build + **CSS Cascade Layers** pour les overrides explicites
  - Hiérarchie : `reset < design < layout < components < widgets < utilities`
  - Unlayered CSS bat tous les layers (migration progressive)
  - Voir `000_theme_tokens_base.css` pour la définition des layers
- **Creation trade (wizard)** : `040_wizard_core.js`, `041_wizskip.js`, `042_wizsetdate.js`, `043_wizsetdir.js`, `044_wizreadfileasdataurl.js`, `045_bindwizard.js`.
  - Mode compact (clic calendrier): wizard centre 420x520
  - Mode rail (clic "Nouveau Trade"): wizard rectangle 660x360 ancre au bouton, classe `.wiz-rail-mode`
- **Edition trade (flip card XXL)**: `056_journal_day_trade_cards.js` (rendu flip cards), `059_trade_editor_controller.js` (editeur inline XXL).
- **Post-mortem wizard**: `pmWizOpen()` dans wizard core — etape quality/lessons/tags apres cloture.
- Narration auto-fill: `static/js/split/038_custom_blocks.js`.
- Journal rendering/data: `004_loadjournaltablesort.js`, `005_setjournalcustomrange.js`, `011_calendar_nav.js`, `012_data_loading.js`, `015_calendar.js`.
- Templates trade: `templates/partials/overlays/wizard.html` (wizard 11 etapes), `templates/partials/overlays/post_mortem.html` (post-mortem).
- **Plus de modale d'edition (`#entryModal`)**: l'ancien flux modal a ete supprime en mai 2026. Les fichiers supprimes (a ne pas restaurer) sont listes dans pitfall 55 du skill journal-cockpit-dev.

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

### BUG-YYYYMMDD-XX - [RÉSOLU] Titre court
- Symptome:
- Cause racine:
- Regle de prevention:
- Test de non-regression:
- Fichiers a surveiller:


### BUG-20260428-01 - [RÉSOLU] Mojibake introduit par ecriture PowerShell implicite
- Symptome: textes UI affiches avec caracteres casses (`Ã`, `Â`, `â`).
- Cause racine: ecriture de fichiers texte sans forcer UTF-8.
- Regle de prevention: toute ecriture shell doit utiliser `Set-Content/Add-Content -Encoding utf8`.
- Test de non-regression: `tests/test_encoding_guardrails.py` + scan `rg` section 3.4.
- Fichiers a surveiller: `app_parts/*.py`, `static/js/split/*.js`, `templates/partials/**/*.html`, `AI_DEVELOPMENT_PLAYBOOK.md`.


### BUG-20260428-02 - [RÉSOLU] Trade sauve mais calendrier non rafraichi
- Symptome: nouveau trade absent du calendrier tant que la page n'est pas rechargee.
- Cause racine: absence de refresh global post-save.
- Regle de prevention: apres create/update/delete trade, relancer pipeline data central (`loadAll()` + rerender).
- Test de non-regression: test API + verification UI manuelle du journal apres sauvegarde.
- Fichiers a surveiller: `static/js/split/012_data_loading.js`, `static/js/split/015_calendar.js`, `static/js/split/020_trade_form.js`.


### BUG-20260428-03 - [RÉSOLU] Questions Midnight posees hors contexte
- Symptome: champ/questions `Open Midnight` visibles meme hors `midnight_model`.
- Cause racine: logique conditionnelle strategie absente/incomplete dans wizard ou modale.
- Regle de prevention: tout bloc Midnight doit etre strictement conditionne a `strategie == midnight_model`.
- Test de non-regression: scenario UI multi-strategies + parse narration Midnight.
- Fichiers a surveiller: `static/js/split/020_trade_form.js`, `static/js/split/040_wizard_core.js`, `app_parts/10_parse_trade.py`.


### BUG-20260429-01 - [RÉSOLU] Tests ecrivent dans la DB de production (scope Python)
- Symptome: tests fail avec 200 != 201, stats incorrectes (avg_rr 4.595 au lieu de 2.0), routes /api/entries introuvables (404).
- Cause racine: `mod.DB_PATH = temp_path` ne change que `app.DB_PATH`. `get_db()` lit `app_parts.DB_PATH` (le namespace du module parent). Les deux divergent apres reassignment.
- Regle de prevention: Toujours faire `import app_parts; app_parts.DB_PATH = ...` dans les tests, jamais `mod.DB_PATH = ...`.
- Test de non-regression: `tests/test_stats_derived_metrics.py` (average RR sur DB isolee doit etre 2.0).
- Fichiers a surveiller: `tests/*.py`.


### BUG-20260429-02 - [RÉSOLU] data["date"] au lieu de date_val dans IntegrityError
- Symptome: Dans le handler IntegrityError de `09_routes_days.py`, la recherche de l'enregistrement existant utilise `data["date"]` (valeur brute non validee) au lieu de `date_val` (validee via `_validate_date_key`).
- Cause racine: La variable a ete renommee mais pas mise a jour partout.
- Regle de prevention: Apres validation, utiliser systematiquement la variable validee dans tout le handler.
- Test de non-regression: Creer un jour avec date valide puis le meme jour doit retourner 200 (selon le comportement actuel).
- Fichiers a surveiller: `app_parts/09_routes_days.py`.

|### BUG-20260429-03 - 13 fichiers orphelins (code mort) dans app_parts/
- Symptome: Fichiers non charges par `__init__.py` mais presents sur disque. Routes dupliquees et confuses.
- Cause racine: Refactoring vers nouvelle numerotation sans nettoyage des anciens fichiers.
- Regle de prevention: Nettoyer les fichiers orphelins immediatement apres refactoring. Verifier `__init__.py` vs `ls app_parts/`.
- Test de non-regression: `app_parts/` ne doit contenir que les fichiers listes dans `__init__.py`.
- Fichiers a surveiller: `app_parts/__init__.py`, `app_parts/*.py`.


### BUG-20260429-04 - [RÉSOLU] build.py: bundle CSS vide quand tous les <link> sont supprimes
- Symptome: Apres `python build.py`, `head_assets_css.html` est vide. Le bundle CSS n'est pas reference.
- Cause racine: `switch_to_bundles()` supprime tous les `<link>` split puis cherche a inserer le bundle avant le premier `<link>` restant. S'il n'en reste pas (fichier vide), le bundle n'est pas ajoute.
- Regle de prevention: Toujours verifier que `head_assets_css.html` contient le bundle apres build. Le fix utilise `if re.search(r'<link[^>]+rel="stylesheet"', text): ... else: text += bundle_tag`.
- Test de non-regression: `python build.py && grep -q "style.css" templates/partials/layout/head_assets_css.html`
- Fichiers a surveiller: `build.py`


### BUG-20260429-05 - [RÉSOLU] build.py: restore_splits() contamine les templates avec le mauvais type
- Symptome: Apres `python build.py --restore`, `head_assets_css.html` contient des `<script>` JS et `scripts.html` contient des `<link>` CSS. Les deux fichiers sont corrompus.
- Cause racine: `restore_splits()` restaure les deux types (JS + CSS) dans les deux templates sans distinction.
- Regle de prevention: Toujours specifier `js=True/False` et `css=True/False` dans les appels a `restore_splits()`.
- Test de non-regression: `python build.py --restore && python build.py && python -m unittest discover -s tests`
- Fichiers a surveiller: `build.py`, `templates/partials/layout/head_assets_css.html`, `templates/partials/overlays/scripts.html`


### BUG-20260429-06 - [RÉSOLU] DATA CORRUMPUE - La base de donnees a ete videe pendant les tests/build
- Symptome: data/journal.db existe mais toutes les tables sont vides (0 lignes). Les backups automatiques dans data/backups/ aussi.
- Cause racine: Les tests unitaires et le build ont ete lances sans isolement de la DB. Le module `app_parts.DB_PATH` pointait vers la DB de production pendant les tests car `mod.DB_PATH = X` ne propage pas a `app_parts` (BUG-20260429-01). Un `init_db()` a ete appele sur la vraie DB, effacant les donnees.
- Regle de prevention: NE JAMAIS lancer de tests sans verifier que `app_parts.DB_PATH` pointe vers une DB temporaire. Backup OBLIGATOIRE avant toute operation a risque sur le projet.
- Test de non-regression: Avant chaque test, verifier `assert app_parts.DB_PATH != la_vraie_DB_prod`. Les tests utilisent `tempfile.TemporaryDirectory()` pour l'isolation.
- Backup restaure: data/journal.db.pre_audit_backup (69632 bytes, 13 jours, 13 trades). DB corrompue conservee: data/journal.db.corrupted_empty.
- Commande de backup: `cp data/journal.db data/journal.db.$(date +%Y%m%d-%H%M%S).backup`
- Fichiers a surveiller: `data/journal.db`, `app_parts/00_paths_constants.py`, `app_parts/02_database.py`


### BUG-20260429-07 - [RÉSOLU] NAS remplace par NQ comme instrument canonique
- Symptome: L'instrument etait stocke comme "NAS" en base mais affiche "NQ" dans l'UI via alias. Changement de nom canonique de "NAS" vers "NQ".
- Cause racine: L'utilisateur prefere le ticker NQ (Nasdaq Futures). NAS etait le canonique avec NQ comme alias d'affichage.
- Regle de prevention: Le canonique est maintenant "NQ". L'alias inverse {"NAS": "NQ"} assure la retrocompatibilite pour les donnees existantes en base. Toute reference a "NAS" comme instrument doit etre remplacee par "NQ". Les fonctions `_to_canonical()` et `_display()` sont inversees.
- Test de non-regression: `tests/test_wizard_aliases.py` — envoi de "NQ" en entree doit retourner "NQ" (anciennement normalise en "NAS").
- Fichiers a surveiller: `config.json`, `app_parts/00_paths_constants.py`, `app_parts/19_ai_chat.py`, `static/js/split/001_utilities.js`, `static/js/split/029_command_palette.js`, `static/js/split/032_breakdowns.js`, `static/js/split/039_helpers.js`, `static/js/split/040_wizard_core.js`, `static/js/split/042_wizsetdate.js`, `templates/partials/layout/rail.html`, `templates/partials/overlays/modal/day_form.html`, `static/app.js`


### BUG-20260429-08 - [RÉSOLU] Chatbot IA invente des jours feries car pas d'outil delete
- Symptome: L'IA refuse de supprimer un trade le lundi 6 avril 2026 en pretendant que c'est un dimanche et jour ferie. En realite le 6 avril 2026 est bien un lundi.
- Cause racine: Aucun outil `delete_trade` ou `delete_day` n'etait defini dans les tools du module `19_ai_chat.py`. L'IA ne pouvait pas executer la suppression, donc elle a hallucine une reponse au lieu d'avouer son incapacite.
- Regle de prevention: TOUJOURS definir les outils delete quand on ajoute un chatbot CRUD. Les outils doivent etre: `delete_trade` (trade_id), `delete_day` (day_id). Le system prompt doit explicitement interdire de deviner les jours de la semaine et ordonner d'utiliser les outils de verification (`get_day`/`get_days`) avant de refuser une operation. Le prompt doit aussi exiger confirmation utilisateur avant toute suppression.
- Test de non-regression: Aucun test unitaire direct (depend de l'API externe DeepSeek). Verifier manuellement que `/api/ai/chat` expose bien les tools `delete_trade` et `delete_day` dans sa reponse GET.
- Fichiers a surveiller: `app_parts/19_ai_chat.py` (tools definitions + handlers + system prompt)


### BUG-20260429-09 - [RÉSOLU] Chatbot IA : champs manquants dans update_day et stats limitees
- Symptome: L'IA ne pouvait pas modifier l'instrument ou la date d'un jour de trading via update_day. Les stats renvoyees par get_stats etaient basiques (pas de breakdowns, drawdown, period compare, heatmap, etc.).
- Cause racine: Les tools `update_day` n'exposaient pas les champs `instrument` et `date` dans leur parametrage. La fonction `_tool_get_stats()` etait une reimplementation simplifiee qui n'utilisait pas le pipeline complet de `14_routes_stats.py` (_bucket, _derive_trade_metrics, _compute_drawdown_series, _build_period_comparison, _streak_stats, _build_insights, _build_pnl_histogram).
- Regle de prevention: Les tools IA doivent exposer TOUS les champs que les routes backend supportent. Ne pas reimplementer des fonctions stats simplifiees — utiliser le meme pipeline que la route API. Le fichier `14_routes_stats.py` est la reference du pipeline stats complet.
- Test de non-regression: Verifier que `_tool_get_stats()` appelle `_derive_trade_metrics`, `_bucket`, `_bucket_multi`, `_compute_drawdown_series`, `_build_pnl_histogram`, `_build_period_comparison`, `_streak_stats`, `_build_insights`.
- Fichiers a surveiller: `app_parts/19_ai_chat.py` (definitions tools + handlers + _tool_get_stats)


### BUG-20260429-10 - [RÉSOLU] Suppression du champ emotional_state de toutes les couches
- Symptome: L'etat emotionnel (calm/focused/anxious/fomo/revenge/overconfident) etait encore present dans le code apres refactoring. L'utilisateur a demande sa suppression complete.
- Cause racine: Le champ etait distribue dans ~20 fichiers (backend whitelists, normalizers, stats pipeline, parseur, tools IA, JS split wizard + formulaire, templates HTML, tests). La colonne SQL a ete preservee.
- Regle de prevention: Suivre la checklist Phase 5 du playbook pour toute suppression multi-couche : backend whitelist → model columns → normalizer aliases → routes stats → parseur keywords → IA system prompt → IA tool schemas → IA handlers → JS split (wizard init, formulaire payload, custom blocks, stats render) → templates HTML → tests → rebuild.
- Test de non-regression: `grep -rn 'emotional_state\|exit_emotion\|by_emo'` hors DB et bundle doit retourner 0. Tests unitaires doivent passer.
- Fichiers a surveiller: Tous les fichiers listes dans la checklist Phase 5.


### BUG-20260429-11 - [RÉSOLU] Backups lances pendant les tests Windows
- Symptome: la suite de tests echoue au nettoyage de `TemporaryDirectory()` avec `PermissionError: [WinError 32]` sur `journal.db` ou `backups/journal-*.db`.
- Cause racine: le garde-fou de `_auto_backup_after_write()` detectait `/tmp/` mais pas les chemins Windows `AppData/Local/Temp`, donc des threads de backup ouvraient encore les DB temporaires.
- Regle de prevention: normaliser les chemins en minuscules avec slashs avant de tester les repertoires temporaires.
- Test de non-regression: `python -m unittest discover -s tests -v` doit passer sans fichiers verrouilles dans les dossiers temporaires.
- Fichiers a surveiller: `app_parts/17_backups.py`, `tests/*.py`.


### BUG-20260429-12 - [RÉSOLU] Controles Journal cables en JS mais absents du template
- Symptome: les modes mois/semaine, calendrier/table, periode custom et filtres trade existaient cote JS mais restaient invisibles dans le Journal.
- Cause racine: `templates/partials/pages/journal/filters.html` etait vide alors que les handlers attendaient des IDs comme `calendarViewToggle`, `calendarLayoutToggle` et `journalFilterStrategy`.
- Regle de prevention: quand un handler UI est ajoute, verifier que le template expose l'element cible et que `rg "id"` trouve une source HTML avant build.
- Test de non-regression: `tests/test_template_render.py` + verification manuelle de la toolbar Journal apres build.
- Fichiers a surveiller: `templates/partials/pages/journal/filters.html`, `static/js/split/004_loadjournaltablesort.js`, `static/js/split/005_setjournalcustomrange.js`, `static/js/split/006_comparetext.js`.


### BUG-20260430-01 - [RÉSOLU] Design trade modifie dans les splits sans bundle regenere
- Symptome: la modale trades peut rester sur l'ancien rendu si `static/js/split/*` ou `static/css/split/*` sont modifies mais que `static/app.js` et `static/style.css` ne sont pas reconstruits.
- Cause racine: le template charge les bundles en mode normal, donc les changements de source split ne sont visibles qu'apres `build.py`.
- Regle de prevention: apres toute retouche UI trade dans les splits, executer `python build.py` et verifier que `templates/partials/layout/head_assets_css.html` et `templates/partials/overlays/scripts.html` pointent vers le nouveau token.
- Test de non-regression: `python build.py && python -m unittest tests.test_template_render -v && python -m unittest discover -s tests -v`.
- Fichiers a surveiller: `static/js/split/019_trades_list_dans_la_modal.js`, `static/css/split/040_trade_cockpit_cards.css`, `static/app.js`, `static/style.css`, `templates/partials/layout/head_assets_css.html`, `static/templates/partials/overlays/scripts.html`.


### BUG-20260430-02 - [RÉSOLU] Sparkline Net P&L coupe (viewBox SVG != hauteur JS)
- Symptome: la sparkline du widget Net P&L est coupee/tronquee — les pics de la courbe sortent du cadre SVG et sont invisibles, ne laissant qu'une ligne plate ou incomplete.
- Cause racine: le JS (`013_kpis.js:renderPnlSparkline()`) dessine les points du `<polyline>` sur une hauteur de 42 (`height=42`, `padY=5` → les points Y vont de 5 a 37). Mais le template `001_kpi_total_pnl.html` avait `viewBox="0 0 180 30"`, donc tout point y > 30 etait hors viewBox et invisible. Le mismatch entre les deux hauteurs faisait sortir les extremums de la courbe. Meme avec `overflow:visible` en CSS, le viewBox SVG tronque le rendu.
- Regle de prevention: TOUJOURS aligner le `viewBox` SVG sur les dimensions reelles utilisees par le JS. Quand tu modifies la hauteur de rendu dans `renderPnlSparkline()` (`height=42`), verifie que le viewBox dans le template HTML correspond exactement (`viewBox="0 0 180 42"`). Les 3 couches doivent etre coherentes: (1) JS `height`, (2) SVG `viewBox`, (3) CSS `height` sur l'element SVG. En cas de mismatch, c'est le viewBox qui gagne (le plus restrictif) et les points hors viewBox sont silencieusement coupes sans erreur JS.
- Test de non-regression: verifier que `grep 'viewBox' templates/partials/pages/today/widgets/001_kpi_total_pnl.html` contient `"0 0 180 42"` et que `grep 'height =' static/js/split/013_kpis.js` contient `42`. Verifier manuellement que la sparkline affiche tous les points (les pics ne sont pas coupes).
- Fichiers a surveiller: `templates/partials/pages/today/widgets/001_kpi_total_pnl.html` (viewBox SVG), `static/js/split/013_kpis.js` (height du JS), `static/css/split/003_settings_chip_remove_hover.css` (height CSS 42 OK), `static/css/split/038_kpi_upgrade.css` (overflow:visible), `static/css/split/043_dashboard_pnl_motion_fix.css` (overflow+contain).


### BUG-20260430-03 - [RÉSOLU] Deplacer le contexte du jour casse l'autosave si les IDs quittent la modale
- Symptome: en transformant le contexte du jour en widget dashboard, les champs `entryDate`, `entryInstrument`, `htfContext`, `dailyNotes` et `dayForm` ne sont plus dans `#entryModal`, alors que l'autosave et les fonctions de creation de jour les utilisent toujours.
- Cause racine: la logique day context etait couplee a la presence visuelle du formulaire dans la modale (`triggerDayAutosave()` ignorait les changements quand la modale etait fermee, et `saveDayContext()` se basait surtout sur `state.currentDayId`).
- Regle de prevention: quand un formulaire visible est deplace entre surfaces, garder une seule source DOM avec les IDs historiques ou refactorer toutes les fonctions d'acces en helpers explicites. Ne pas laisser un guard visuel (`modal hidden`) bloquer une logique devenue dashboard.
- Test de non-regression: verifier que le HTML rendu ne contient qu'un seul `id="dayForm"`, que `today_context` est dans `templates/partials/pages/today/grid.html`, que `entry_modal.html` n'inclut plus `modal/day_form.html`, puis lancer `python build.py && python -m unittest discover -s tests -v`.
- Fichiers a surveiller: `templates/partials/pages/today/widgets/006_day_context.html`, `templates/partials/pages/today/grid.html`, `templates/partials/overlays/entry_modal.html`, `static/js/split/014_today_page.js`, `static/js/split/018_day_form.js`, `static/js/split/026_autosave_du_jour.js`, `static/js/split/017_modal_gestion_globale.js`.


### BUG-20260430-04 - [RÉSOLU] Clic calendrier: ne pas ouvrir la modale si un jour a deja des trades
- Symptome: le clic sur une case calendrier contenant des trades ouvrait directement la modale de jour ou le picker multi-instruments, alors que l'UX attendue est une revue visuelle inline des trades.
- Cause racine: `bindCalendarGridActions()` ne distinguait que "aucune entree", "une entree" et "plusieurs entrees"; il ne testait pas le nombre total de trades avant d'ouvrir la modale.
- Regle de prevention: pour les interactions calendrier, raisonner sur le nombre total de trades (`sum(day.trades.length)`) avant le nombre d'entrees day. Le cas `tradeCount > 0` doit rester un chemin inline dedie; le cas `tradeCount === 0` garde le flux historique.
- Note UX: les cards de revue ne doivent pas etre collees sous la grille calendrier. Elles doivent rester separees visuellement, en layer centre dans le panel principal, sans backdrop de modale.
- Test de non-regression: verifier dans `static/js/split/015_calendar.js` que `renderJournalDayTrades(key, info.days)` est appele avant `openExistingDay()`/`openPickerForDate()`, puis lancer `python build.py && node --check static/app.js && python -m unittest discover -s tests -v`.
- Fichiers a surveiller: `static/js/split/015_calendar.js`, `static/js/split/056_journal_day_trade_cards.js`, `templates/partials/pages/journal/calendar_focus.html`, `static/css/split/046_journal_day_trade_cards.css`.


### BUG-20260501-01 - [RÉSOLU] leverage jamais persiste en DB (payload.pop detruit la cle)
- Symptome: le champ `leverage` (colonne DB creee par migration v6) reste toujours NULL en base, meme apres creation/mise a jour d'un trade avec un levier.
- Cause racine: `_auto_calc_pnl()` dans `03_core_helpers.py` utilisait `payload.pop("leverage", None)` aux 3 branches (pnl manuel, infos manquantes, calcul auto). `pop()` SUPPRIME la cle du payload, donc l'INSERT/UPDATE SQL ne recoit jamais la valeur. Le calcul utilisait bien le levier (ligne 252, branche calcul auto) mais il etait perdu apres.
- Regle de prevention: TOUJOURS utiliser `payload.get("leverage")` pas `payload.pop("leverage")` dans `_auto_calc_pnl()`. Le pop detruit la donnee. Si tu veux lire sans supprimer, c'est `get()`. Si tu dois pop (par ex. pour eviter de passer un champ calcule a SQL), remets-le dans le payload apres usage.
- Test de non-regression: verifier que `grep -n 'pop.*leverage' app_parts/03_core_helpers.py` retourne 0. Creer un trade avec `leverage=3` via API, lire le trade, verifier que `leverage==3` retourne.
- Fichiers a surveiller: `app_parts/03_core_helpers.py` (fonction `_auto_calc_pnl`), `app_parts/10_routes_trades.py` (routes create/update).


### BUG-20260501-02 - [RÉSOLU] Orphelins dans app_parts/__archive__ jamais nettoies + header.html vide
- Symptome: 18 fichiers orphelins dans `app_parts/__archive__/` (anciennes versions non chargees) + `templates/partials/pages/journal/header.html` vide (1 ligne commentaire) cassant 22 IDs DOM.
- Cause racine: accumulation d'archives sans cleanup. Le header a ete vide pendant un refactoring sans restaurer les IDs (prevMonth, nextMonth, stats, month picker, focus toggle).
- Regle de prevention: apres chaque refactoring, verifier `git ls-files app_parts/__archive__/` = 0. Verifier que les IDs DOM references par les JS existent dans les templates HTML (`rg -rn '#prevMonth\|#nextMonth\|#monthLabel' templates/ --type html`).
- Test de non-regression: `python -m unittest tests.test_template_render -v` (verifie que les templates rendent correctement). Apres build, verifier que les IDs sont presents dans le template rendu.
- Fichiers a surveiller: `app_parts/__archive__/*`, `templates/partials/pages/journal/header.html`, tous les JS qui referencent des IDs de navigation/stats header.


### BUG-20260501-03 - [RÉSOLU] Parametre mort `existing` dans _auto_calc_pnl + catch silencieux state.js
- Symptome: `_auto_calc_pnl()` acceptait `existing=None` mais ne l'utilisait jamais. `19_ai_chat.py` lui passait `existing` pour rien. State.js ligne 79 catch silencieux qui avale les erreurs de listeners.
- Cause racine: accumulation de code mort et de catch aveugles.
- Regle de prevention: apres chaque refactoring, chercher les parametres de fonction inutilises (`grep -rn "def.*existing=None" app_parts/`). Les catch doivent toujours logger (`console.warn` minimum).
|- Test de non-regression: `grep -n 'existing=None' app_parts/03_core_helpers.py` doit retourner 0. `grep 'catch.*{}' static/js/split/000_state.js` ne doit pas exister.
|- Fichiers a surveiller: `app_parts/03_core_helpers.py`, `app_parts/19_ai_chat.py`, `static/js/split/000_state.js`.


### BUG-20260501-04 - [RÉSOLU] Changement de type d'un champ state (tag string → array) sans retrocompat
- Symptome: apres migration `tag` de string vers array, les filtres chargeaient depuis localStorage avec `typeof tag === "string"` et plantaient les fonctions qui attendaient un array.
- Cause racine: le format stocke en localStorage etait `"news_trade"` (string) mais le nouveau code attend `["news_trade"]` (array).
- Regle de prevention: TOUJOURS gerer la retrocompat dans `sanitizeJournalTradeFilters()` quand un champ change de type. Pattern: `if (Array.isArray(raw.tag)) { ... } else if (typeof raw.tag === "string") { out.tag = [raw.tag]; }`.
- Test de non-regression: charger un filtre depuis localStorage avec ancien format string → doit retourner un array.
- Fichiers a surveiller: `static/js/split/003_addcustomstrategyfromsettings.js` (sanitize).


### BUG-20260501-05 - [RÉSOLU] Placeholder invisible quand input a une valeur
- Symptome: le placeholder "2 car. min" ne s'affichait pas quand le champ contenait deja "a" car les placeholders sont caches par la valeur de l'input.
- Cause racine: utilisation d'un `placeholder` au lieu d'un element HTML positionne.
- Regle de prevention: pour afficher un hint en presence d'une valeur, utiliser un `<span>` en absolute overlay, pas le placeholder de l'input. Placer le span en `position: absolute; right: 8px; top: 50%; transform: translateY(-50%); pointer-events: none;` avec `padding-right` sur l'input pour eviter le chevauchement.
- Test de non-regression: saisir "a" → le hint "2 car. min" est visible a droite du "a".
- Fichiers a surveiller: `static/js/split/006_comparetext.js`, `static/css/split/033_priority2_journal_trade.css`.


### BUG-20260501-06 - [RÉSOLU] Template stats jamais rendu → page blanche (doublon BUG-20260501-09 fusionné)
- Symptome: navigation vers Stats → ecran vide, aucune erreur JS hormis `Cannot set properties of null (setting 'textContent')` sur `#statStreakCur`.
- Cause racine: le contenu de la page Stats etait dans un `<template id="statsTemplate">` mais aucun code JS ne le clonait dans `<section class="page" data-page="stats">`. Les elements attendus par `renderPerformance()` n'existaient pas dans le DOM.
- Regle de prevention: quand un template HTML est utilise pour une page, verifier que le JS appelle `template.content.cloneNode(true)` dans `openPage()` avant tout render. Pattern: `if (section && tmpl && !section._rendered) { section.appendChild(tmpl.content.cloneNode(true)); section._rendered = true; }`.
- Test de non-regression: naviguer vers Stats → le contenu apparait (pas de page blanche).
- Fichiers a surveiller: `static/js/split/009_navigation.js`, `templates/partials/pages/stats.html`.


### BUG-20260501-07 - [RÉSOLU] applyVisualSettings() ne sync pas la checkbox dark mode
- Symptome: toggler le theme depuis le rail (`#themeToggle`) changeait l'apparence mais la checkbox `#prefDarkMode` dans Settings restait sur l'ancienne valeur.
- Cause racine: `applyVisualSettings()` mettait a jour `body.light-mode` mais pas la checkbox.
- Regle de prevention: toute fonction `apply*Settings()` doit sync les controles UI correspondants s'ils existent dans le DOM. Ajouter `var cb = document.getElementById("prefDarkMode"); if (cb) cb.checked = prefersDark;` dans `applyVisualSettings()`.
- Test de non-regression: toggler theme depuis le rail → ouvrir Settings → checkbox en phase.
- Fichiers a surveiller: `static/js/split/002_prettify.js`.


### BUG-20260501-08 - [RÉSOLU] Champs API key en type=text exposé en partage d'ecran
- Symptome: le champ `#settingsApiKeyMasked` etait en `type="text"`, visible en partage d'ecran.
- Cause racine: pas de mesure de securite sur un champ sensible.
- Regle de prevention: toujours utiliser `type="password"` pour les cles API, avec un bouton toggle œil pour afficher/masquer. Pattern: `<input type="password">` + bouton `#settingsApiToggle` qui switch entre `type="password"` et `type="text"`.
- Test de non-regression: ouvrir Settings → la cle est masquee (dots).
- Fichiers a surveiller: `templates/partials/pages/settings/api_card.html`, `static/js/split/003_addcustomstrategyfromsettings.js`, `static/css/split/034_priority3_stats_settings_insights.css`.


### ~~BUG-20260501-09~~ [FUSIONNÉ AVEC BUG-20260501-06] Stats page template jamais rendu → page blanche
- Note: Ce bug est un doublon exact de BUG-20260501-06 (même symptôme, même cause, même fix). Conservé pour référence historique.


### BUG-20260501-10 - [RÉSOLU] Widget drag drop intercepte les clics sur les cellules calendrier
- Symptome: calendrier Today non clickable. Curseur pointer montre bien l'interactivite mais aucun evenement click ne se declenche.
- Cause racine: `initWidgetDragDrop()` dans `047_today_widget_board.js` attache un `pointerdown` sur chaque widget. L'exclusion listait `button` (elements HTML) mais pas `[role="button"]`. Les cellules `.day` sont des `<div role="button">` → le drag les capturait et le click ne passait jamais.
- Regle de prevention: la liste d'exclusion du drag drop doit toujours inclure `[role="button"]` a cote de `button`. Les elements avec `role="button"` sont interactifs et ne doivent pas initier le drag.
- Test de non-regression: cliquer sur une case du calendrier Today → navigation vers le Journal.
- Fichiers a surveiller: `static/js/split/047_today_widget_board.js`.


### BUG-20260501-11 - [RÉSOLU] Autosave day context ecrase les textareas (state.allDays pas patche)
- Symptome: taper un texte dans Analyse HTF → click hors champ → autosave → le texte revient a l'ancienne valeur.
- Cause racine: `saveDayContext()` patchait `state.days` apres sauvegarde mais pas `state.allDays`. `findTodayContextDay()` cherche dans `state.allDays` en priorite → trouvait l'ancienne donnee → `renderTodayContextWidget()` re-ecrivait la textarea.
- Regle de prevention: TOUJOURS patcher les DEUX stores (`state.days` ET `state.allDays`) apres une sauvegarde local. Meme pattern: boucle for identique sur les deux tableaux.
- Test de non-regression: ecrire dans une textarea du contexte jour → focusout → rafraichir → le texte est preserve.
|- Fichiers a surveiller: `static/js/split/018_day_form.js`.


### BUG-20260501-13 - [RÉSOLU] Knowledge cards sauvegardables dans l'UI Insights
- Symptome: les patterns ML etaient calcules a la volee mais on ne pouvait pas les sauvegarder/bookmarker. La table `knowledge_cards` existait sans UI.
- Cause racine: la table knowledge_cards etait creee en migration v4 mais aucune route CRUD ni UI n'y accedait. Les patterns etaient generes a la volee par analyze_patterns() sans persistance.
- Regle de prevention: quand on cree une table en DB, implementer AU MOINS les routes CRUD de base avant de passer a autre chose, meme si l'UI vient plus tard.
- Test de non-regression: cliquer sur l'etoile d'une insight card → recharger la page → l'etoile est encore jaune.
- Changement: routes CRUD POST/GET/DELETE `/api/ml/knowledge`, bouton etoile sur chaque insight card, etat sauvegarde persistant via classe `.is-saved` + API.
- Fichiers a surveiller: `app_parts/21_routes_ml.py`, `static/js/split/049_insights.js`, `static/css/split/031_insights.css`.



### BUG-20260501-12 - [RÉSOLU] Session ajoutee comme etape wizard + champ trade
- Symptome: impossible de selectionner la session de trading par trade (Asia, London, NY AM, NY PM).
- Cause racine: le champ `session` existait en DB sur `days` (par jour) mais pas sur `trades` (par trade). Aucune UI pour le saisir par trade.
- Regle de prevention: quand un champ existe dans un contexte (day) mais est aussi pertinent dans un autre (trade), l'ajouter aux deux schemas et whitelists + UI associee.
- Test de non-regression: creer un trade via wizard → selectionner une session → verifier dans l'editeur XXL que la session est conservee → flip card → session visible.
- Changement: `session` ajoute a `TRADE_TEXT_FIELDS`, migration v8 (`_migrate_v7_to_v8`), etape wizard dediee (entre instrument et strategy), champ select dans l'editeur XXL, affichage dans les flip cards.
- Valeurs session: `asia`, `london`, `ny_am`, `ny_pm`.
- Fichiers a surveiller: `app_parts/00_paths_constants.py`, `app_parts/02_database.py`, `static/js/split/040_wizard_core.js`, `static/js/split/042_wizsetdate.js`, `static/js/split/041_wizskip.js`, `static/js/split/043_wizsetdir.js`, `static/js/split/059_trade_editor_controller.js`, `static/js/split/056_journal_day_trade_cards.js`.


### BUG-20260502-01 - [RÉSOLU] Jour sans trade affiche $0.00 et refuse le clic wizard
- Symptome: un jour qui existe en DB (contexte seul, sans trade) affiche 0,00$ sur la case calendrier. Le clic ouvre openExistingDay() qui recharge le calendrier sans effet visible (pas de flip cards car pas de trades).
- Cause racine: dayCell() affichait le PnL meme pour `info.trades === 0`. Le click handler appelait openExistingDay() / openPickerForDate() quand tradeCount === 0 au lieu d'ouvrir le wizard.
- Regle de prevention: dayCell() doit cacher le metric si `info.trades === 0`. Le click handler doit ouvrir le wizard quand `tradeCount === 0`, pas openExistingDay().
- Test de non-regression: cliquer sur un jour avec entree DB mais 0 trade → le wizard s'ouvre. La case calendrier n'affiche pas 0,00$.
- Changement: dayCell() ligne 313: `if (info)` → `if (info && info.trades > 0)`. Click handler: affiche renderJournalDayContext() (carte contexte + bouton Nouveau trade) au lieu d'ouvrir directement le wizard. Nouvelle fonction renderJournalDayContext() dans 015_calendar.js + CSS dans 046_journal_day_trade_cards.css.
- Fichiers a surveiller: `static/js/split/015_calendar.js` (dayCell + bindCalendarGridActions + renderJournalDayContext), `static/css/split/046_journal_day_trade_cards.css` (.journal-day-context-empty).


### BUG-20260502-02 - [RÉSOLU] PnL=0 ecrase par _auto_calc_pnl (impossible d'avoir un trade break-even)
- Symptome: un trade avec PnL=0 explicite (break-even) voit son PnL recalculé par _auto_calc_pnl() a partir d'entry/exit/size, effaçant le 0 intentionnel.
- Cause racine: la condition `pnl is not None and pnl != 0` ne distinguait pas "pnl non fourni" (None) de "pnl=0 explicite".
- Regle de prevention: toujours verifier la presence de la cle dans le dictionnaire avec `"pnl" in payload` plutot que de tester la valeur. Les payloads sans `pnl` n'ont pas la cle; les payloads avec pnl=0 ont la cle.
- Test de non-regression: envoyer un trade avec `pnl=0` + entry/exit/size → le PnL reste 0 (pas recalculé). Envoyer un trade sans `pnl` → le PnL est calculé a partir d'entry/exit/size.
- Changement: `if pnl is not None and pnl != 0` → `if "pnl" in payload` dans _auto_calc_pnl().
- Fichiers a surveiller: `app_parts/03_core_helpers.py` (fonction _auto_calc_pnl).


### BUG-20260502-03 - [RÉSOLU] Ligne morte `payload.get("leverage")` dans _auto_calc_pnl()
- Symptome: une ligne `payload.get("leverage")` est appelée sans assignation ni usage, résultat ignoré.
- Cause racine: code mort residuel d'un refactoring, probablement un oubli ou un copier-coller.
- Regle de prevention: apres chaque refactoring, chercher les appels de fonction dont le retour n'est pas utilisé et qui n'ont pas d'effet de bord. `grep -rn '\.get.*$' app_parts/ | grep -v '='` peut aider.
- Test de non-regression: lancer les tests existants — la ligne supprimée etait sans effet.
- Changement: suppression de la ligne `payload.get("leverage")` dans le bloc de retour anticipé.
- Fichiers a surveiller: `app_parts/03_core_helpers.py` (fonction _auto_calc_pnl).


### BUG-20260502-04 - [RÉSOLU] loadAllDays() et loadStats() avalent les erreurs sans feedback
- Symptome: les KPIs du dashboard affichent des zeros sans indication que les donnees n'ont pas pu etre chargees. L'utilisateur voit des stats a zero sans comprendre pourquoi.
- Cause racine: les catch de loadAllDays() et loadStats() utilisaient `console.error(e)` sans toast ni feedback utilisateur.
- Regle de prevention: toute erreur de chargement de donnees (API call) doit avoir un toast utilisateur. `console.error` seul est insuffisant. `loadMonth()` faisait deja un toast — les deux autres doivent faire pareil.
- Test de non-regression: simuler une erreur reseau → toast visible.
- Changement: `catch (e) { console.error(e); }` → `catch (e) { toast(e.message || "...", "error"); }` dans loadAllDays() et loadStats().
- Fichiers a surveiller: `static/js/split/012_data_loading.js`.


### BUG-20260502-05 - [RÉSOLU] Race condition dans loadSettingsState() (fetch async ecrase les modifs)
- Symptome: si l'utilisateur modifie un setting avant que le fetch backend de loadSettingsState() ne resolve, sa modification est perdue car le callback du fetch ecrase state.settings.
- Cause racine: fetch async /api/user/settings resolvait apres le retour de loadSettingsState(). Le callback .then() ecrasait state.settings sans verifier si l'utilisateur avait modifie entre temps.
- Regle de prevention: dans un pattern "fast localStorage puis async fetch", prendre un snapshot JSON.stringify(state.settings) avant le fetch, et dans le callback, verifier que le snapshot n'a pas change avant d'ecraser.
- Test de non-regression: modifier un setting → le fetch resolvant apres ne doit pas annuler la modification.
- Changement: snapshot JSON.stringify() avant fetch, guard `if (JSON.stringify(state.settings) !== localSnapshot) return;` dans le callback.
- Fichiers a surveiller: `static/js/split/002_prettify.js` (loadSettingsState).


### BUG-20260502-06 - [RÉSOLU] Double definition de _applyJournalFilter() (code mort)
- Symptome: la fonction _applyJournalFilter() est definie dans 004_loadjournaltablesort.js ET 054_journal_filter_picker_override.js. La premiere est ecrasee par la seconde (054 charge apres 004 dans le bundle).
- Cause racine: le fichier 004_loadjournaltablesort.js contenait une copie legacy de _applyJournalFilter() qui n'etait jamais appelee (tous les appels sont dans 054).
- Regle de prevention: avant d'ajouter une fonction avec le meme nom, verifier si elle existe deja dans un fichier charge plus tot. Utiliser `grep -rn 'function _apply' static/js/split/` pour detecter les doublons.
- Test de non-regression: les filtres journal (date/instrument) fonctionnent toujours.
- Changement: suppression de la definition morte dans 004_loadjournaltablesort.js.
- Fichiers a surveiller: `static/js/split/004_loadjournaltablesort.js`, `static/js/split/054_journal_filter_picker_override.js`.


### BUG-20260502-07 - [RÉSOLU] Month picker popover jamais binde a cause d'un return precoce
- Symptome: le popover #calendarMonthPicker avec selection graphique des mois ne fonctionne pas. Clic sur #monthLabel (le nom du mois) ne fait rien.
- Cause racine: bindCalendarMonthPicker() avait un guard `if (monthInput) return;` qui sortait immediatement parce que #journalMonthInput existe dans le header. De plus, le trigger etait `#monthLabelBtn` qui n'existe pas dans le template (le bon trigger est `#monthLabel`).
- Regle de prevention: ne pas blocker un composant UI parce qu'un autre existe. Les deux peuvent coexister (input month natif + popover graphique). Verifier que les IDs references dans le JS existent dans les templates HTML.
- Test de non-regression: cliquer sur #monthLabel → le popover s'ouvre avec selection de mois et navigation d'annee.
- Changement: suppression du guard `if (monthInput) return;`, trigger change de `#monthLabelBtn` a `#monthLabel`.
- Fichiers a surveiller: `static/js/split/011_calendar_nav.js` (bindCalendarMonthPicker), `templates/partials/pages/journal/header.html` (#calendarMonthPicker, #monthLabel, #monthPopover).


### BUG-20260502-08 - [RÉSOLU] PriceLine du chart pas mise a jour par WebSocket
- Symptome: la ligne pointillee verte du dernier prix reste figee au dernier fetch periodique (15-60s). Quand le prix monte puis descend, on voit brievement une double ligne (verte figee + rouge par defaut).
- Cause racine: le WebSocket ne mettait jamais a jour `countdownPriceLine.applyOptions({ price: candle.close })`. La priceLine restait au prix du dernier `_fetchAndRender()`. De plus, `priceLineVisible: true` (defaut de Lightweight Charts) ajoutait sa propre ligne qui change de couleur.
- Regle de prevention: toujours mettre a jour la priceLine custom DANS le handler WebSocket, pas seulement dans le fetch periodique. Ajouter `priceLineVisible: false` sur la serie candlestick pour eviter la double ligne.
- Test de non-regression: le WebSocket pousse des mises a jour → la priceLine bouge en temps reel. Pas de double ligne.
- Changement: `series.createPriceLine({ price: candle.close })` dans ws.onmessage + `priceLineVisible: false` sur les deux series (widget + chart XXL).
- Fichiers a surveiller: `static/js/split/060_btc_chart_widget.js` (ws.onmessage + createChart), `static/js/split/062_chart_page.js` (idem).


### BUG-20260502-09 - [RÉSOLU] Countdown `_fetchAndRender()` sans keepZoom resetait le zoom
- Symptome: a l'ouverture d'une nouvelle bougie (timer a 0:00), le zoom utilisateur etait perdu.
- Cause racine: `_fetchAndRender()` appele sans argument → keepZoom = undefined → `chart.timeScale().fitContent()` resetait le zoom.
- Regle de prevention: tout auto-refresh (countdown, periodic, WebSocket k.x) doit passer `_fetchAndRender(true)`. Seuls les changements manuels (timeframe, symbole) appellent sans keepZoom.
- Test de non-regression: zoomer sur le chart → attendre l'ouverture d'une bougie → le zoom est preserve.
- Changement: `_fetchAndRender(true)` dans le countdown du widget BTC (le chart XXL etait deja correct).
- Fichiers a surveiller: `static/js/split/060_btc_chart_widget.js` (fonction tick dans _startCountdown).


### BUG-20260502-10 - [RÉSOLU] Fonctions favoris/dupliquer definies dans le mauvais scope
- Symptome: ReferenceError: _toggleTradeFavorite is not defined au clic sur le coeur.
- Cause racine: les fonctions ont ete inserees AVANT la fermeture de `journalTradeFlipCardHtml()` rendant leur scope local a la fonction. Inaccessible depuis le click handler.
- Regle de prevention: quand on ajoute des fonctions a la fin d'un fichier JS, verifier qu'elles sont apres le dernier `}` de la fonction precedente, pas dedans. Toujours verifier le scope dans le bundle build (app.js).
- Test de non-regression: clic sur coeur → API PUT /api/trades/:id avec tags ['favoris'] → coeur se remplit.
- Changement: deplacement des deux fonctions apres le `}` fermant de `journalTradeFlipCardHtml()`.
- Fichiers a surveiller: `static/js/split/056_journal_day_trade_cards.js` (fin du fichier).


## 9) Lessons apprises et bugs a ne pas reproduire
### BUG-20260503-01 - [RÉSOLU] Carte contexte HTF avec wizard fluide

- Symptome: Clic sur jour sans trade → la wizard s'ouvrait direct ou une carte moche apparaissait.
- Cause racine: `renderJournalDayContext()` avait un HTML basique et etait supprime/restaure.
- Regle de prevention: Un jour sans trade affiche une carte style journal (classes `journal-flip-*`) avec les donnees HTF (bias, notes, instrument) et un bouton "+ Creer un trade". La wizard s'ouvre avec `contextCard: true` pour s'aligner pres de la carte (taille reduite a 480px, position fluide).
- Test de non-regression: Cliquer sur le 1er mai (jour avec contexte, sans trade) → carte HTF avec infos. Cliquer "+ Creer un trade" → wizard positionnee a cote de la carte.
- Fichiers a surveiller: `static/js/split/015_calendar.js` (renderJournalDayContext), `static/js/split/040_wizard_core.js` (wizOpen contextCard), `static/css/split/022a_wizard_backdrop.css` (.wiz-context-card).


### BUG-20260504-01 - [RÉSOLU] UX bugs #23-#45 : 23 correctifs UX, accessibilite, performance

- Symptome: Nombreux composants sans etat vide, accessibilite absente (pas d'aria-label, tooltips title inaccessibles mobile), input month deforme sur Firefox/Safari, table journal freeze avec >100 trades, settings ordre illogique, cle API non editable dans l'UI.
- Cause racine: Approche feature-first sans revue UX systematique ni test cross-browser. Accumulation de patterns "on verra plus tard" pour les placeholders, l'accessibilite et le lazy loading.
- Regle de prevention: Chaque nouveau composant doit avoir: 1) etat vide explicite, 2) aria-label sur elements visuels, 3) test quick cross-browser (Chrome + Firefox), 4) lazy loading si affichage de listes >100 items. Les settings cards suivent l'ordre logique: Profil→Prefs→Strategies→Tags→API (technique en dernier).
- Test de non-regression: Table journal >100 trades → scroll infini charge par 100. Input month → meme rendu Chrome/Firefox. Settings → card Donnees affiche path/taille DB. API key → bouton Modifier → saisie → Enregistrer → POST /api/settings/key.
- Fichiers a surveiller: `static/js/split/006_comparetext.js` (lazy load IntersectionObserver), `static/js/split/013_kpis.js` (ARIA progressbar), `static/js/split/015_calendar.js` (search empty msg), `static/js/split/028_global_keys.js` (shortcuts / et F), `static/js/split/032_breakdowns.js` (sort badge), `static/js/split/047_today_widget_board.js` (confirm reset), `static/js/split/049_insights.js` (debounce + aria-label), `static/css/split/005_journal_toolbar_filters.css` (input month cross-browser), `templates/partials/pages/settings.html` (ordre), `templates/partials/pages/settings/data_card.html` (nouveau), `app_parts/07_routes_pages.py` (POST /api/settings/key), `app_parts/16_export.py` (GET /api/db/info).


### BUG-20260504-02 - [RÉSOLU] Knowledge cards unsave en 2 appels + pas de cache
- Symptome: Unsave d'une knowledge card nécessitait un GET (liste) puis un DELETE (par ID) → 2 appels réseau. `_markSavedCards()` fetchait l'API à chaque render Insights.
- Cause racine: `toggleSave()` faisait un GET pour trouver l'ID de la card, puis un DELETE par ID. `_markSavedCards()` n'avait pas de cache.
- Regle de prevention: Utiliser un DELETE par kind+title (query params) pour unsave en 1 appel. Ajouter un cache in-memory (`_savedCardCache`) pour `_markSavedCards`, invalider après chaque save/unsave.
- Test de non-regression: Cliquer sur l'étoile d'une insight card → elle se remplit (save) ou se vide (unsave) sans erreur réseau. Recharger la page → les étoiles remplies sont toujours remplies.
- Changement: Nouvelle route `DELETE /api/ml/knowledge?kind=X&title=Y` dans `21_routes_ml.py`. Refacto de `toggleSave()` et `_markSavedCards()` dans `049_insights.js`.
- Fichiers a surveiller: `app_parts/21_routes_ml.py`, `static/js/split/049_insights.js`.


### BUG-20260504-03 - [RÉSOLU] Settings : pas de Danger Zone pour les actions destructrices
- Symptome: Aucune section visuellement distincte pour le reset de donnees. Les actions destructrices n'existaient pas dans l'UI.
- Cause racine: Pas de backend de reset, pas de template, pas de CSS.
- Regle de prevention: Toute action destructive doit avoir: 1) backend avec backup automatique, 2) double confirmation utilisateur, 3) zone rouge visuellement separee, 4) rate limiting.
- Test de non-regression: POST /api/data/reset avec confirm=RESET ALL DATA → 200 + backup cree. Sans confirmation → 400.
- Changement: Nouvelle route POST /api/data/reset avec backup automatique (17_reset.py). Template danger_card.html avec bouton btn-danger rouge. CSS danger zone avec bordures rouges. JS: double confirm() avant appel API.
- Fichiers a surveiller: `app_parts/17_reset.py`, `app_parts/__init__.py`, `templates/partials/pages/settings/danger_card.html`, `templates/partials/pages/settings.html`, `static/js/split/003_addcustomstrategyfromsettings.js`, `static/css/split/034_priority3_stats_settings_insights.css`.


### BUG-20260504-04 - [RÉSOLU] Stats fusionnees dans la page Insights
- Symptome: La page Stats etait separee d'Insights, avec un design different.
- Cause racine: Separation artificielle Stats vs Insights.
- Regle de prevention: Les donnees de performance doivent apparaitre dans Insights.
- Test de non-regression: Naviguer vers Insights → breakdowns et period compare s'affichent.
- Changement: Suppression complete de la page Stats (template, rail, navigation, raccourci S, commande palette). Contenu Stats deplace dans Insights. Filtres Insights synchronises avec localStorage et heritage de la periode du journal.
- Fichiers a surveiller: `templates/index.html`, `templates/partials/layout/rail.html`, `templates/partials/pages/stats/*` (supprimes), `templates/partials/pages/insights.html`, `static/js/split/009_navigation.js`, `static/js/split/028_global_keys.js`, `static/js/split/029_command_palette.js`, `static/js/split/008_boot.js`, `static/js/split/049_insights.js`, `static/js/split/002_prettify.js`, `static/js/split/003_addcustomstrategyfromsettings.js`, `static/js/split/007_loadcalendarmonthfocusmode.js`, `static/js/split/012_data_loading.js`.



### BUG-20260503-02 - [RÉSOLU] hidden + style=display:none doublon → masquage cassé
- Symptome: des elements ont `class="hidden"` ET `style="display:none"` dans le template. Le JS retire la classe via `classList.toggle()` mais pas le style inline → l'element reste invisible.
- Cause racine: accumulation de deux mécanismes de masquage (classe CSS + inline style) sans coordination. Le JS ne gérait que la classe.
- Regle de prevention: UN SEUL mécanisme de masquage par element. Si le template a `class="hidden"`, pas de `style="display:none"` en plus. Le JS pilote l'état via la classe uniquement (ou le style uniquement, pas les deux).
- Test de non-regression: `grep -r 'style=["\x27]*display\s*:\s*none' templates/` + vérifier que le toggle JS fonctionne pour chaque element concerné.
- Fichiers a surveiller: `templates/partials/overlays/*.html`, templates avec `hidden` + `style="display:none"`.

### BUG-20260503-03 - [RÉSOLU] État vide contexte jour sans trade
- Symptome: un jour avec entree DB (contexte, notes) mais 0 trade affichait un message basique ou rien. La carte contexte n'avait pas d'état intermédiaire.
- Cause racine: `renderJournalDayContext()` n'avait pas de design dédié pour "contexte présent, zéro trade".
- Regle de prevention: tout widget/composant doit avoir 3 états: loading (`...`), vide (`—`), et valeur réelle. Le contexte jour sans trade affiche une carte avec les infos HTF (bias, notes, instrument) + bouton "+ Créer un trade".
- Test de non-regression: cliquer sur un jour avec contexte mais sans trade → carte informative visible.
- Fichiers a surveiller: `static/js/split/015_calendar.js`, `static/css/split/046_journal_day_trade_cards.css`.

### BUG-20260503-04 - [RÉSOLU] Popover sélecteur mois et input natif en conflit
- Symptome: deux mécanismes de navigation mensuelle coexistaient — l'input natif `<input type="month">` ET un popover de sélection graphique. Le popover était bloqué par un guard `if (monthInput) return;`.
- Cause racine: le popover avait été ajouté comme amélioration sans supprimer l'input natif. Le guard empêchait le popover de s'initialiser.
- Regle de prevention: quand on ajoute un mécanisme alternatif, supprimer l'ancien OU s'assurer qu'il n'y a pas de guard bloquant. Un seul système de navigation par composant.
- Test de non-regression: le header journal a un seul élément cliquable pour la navigation mois. Cliquer → le popover/input s'ouvre.
- Fichiers a surveiller: `templates/partials/pages/journal/header.html`, `static/js/split/011_calendar_nav.js`.

### BUG-20260503-05 - [RÉSOLU] Accents UI corrompus dans Stats
- Symptome: les labels des breakdowns (stratégie, instrument) avaient des accents affichés comme caractères brisés (`Ã©` au lieu de `é`).
- Cause racine: caractères UTF-8 non encodés en HTML entities dans les templates ou le JS, ou conversion d'encodage incorrecte.
- Regle de prevention: utiliser les HTML entities (`&eacute;` pour é, `&egrave;` pour è, `&rsquo;` pour apostrophe) dans les templates HTML. Vérifier avec le scan encodage section 3.4.
- Test de non-regression: `rg '\xC3' static/app.js | head -5` → doit retourner 0 (pas d'octets UTF-8 bruts non ASCII dans le bundle).
- Fichiers a surveiller: templates HTML, `static/js/split/032_breakdowns.js`, tout fichier avec texte accentué.

### BUG-20260503-06 - [RÉSOLU] KPI streak counter sans animation
- Symptome: le compteur de streak (série de trades gagnants) passait instantanément de l'ancienne valeur à la nouvelle sans transition visuelle.
- Cause racine: `textContent = value` direct, pas de boucle d'animation.
- Regle de prevention: tout KPI numérique doit animer de la valeur précédente vers la nouvelle via `requestAnimationFrame`. Fonction générique `_animateCounter(el, target, suffix, opts)` avec durée proportionnelle à l'écart (200-600ms).
- Test de non-regression: changer de période → les KPIs numériques défilent (comptent) de l'ancienne à la nouvelle valeur.
- Fichiers a surveiller: `static/js/split/013_kpis.js`, `static/js/split/049_insights.js`.

### BUG-20260503-07 - [RÉSOLU] #btcChartPrice manquant dans le template
- Symptome: `document.getElementById("btcChartPrice")` retournait systématiquement null. Le code avait un `if (el)` guard silencieux → la fonctionnalité (affichage du prix en haut du widget BTC) était morte sans erreur visible.
- Cause racine: l'element `<span id="btcChartPrice">` n'existait pas dans le template HTML du widget BTC. Ajouté dans le JS uniquement mais jamais dans le template.
- Regle de prevention: quand un `getElementById()` est systématiquement dans un `if (el)` guard sans jamais s'exécuter, VÉRIFIER que l'élément existe dans le template HTML — c'est un pattern de bug silencieux. Chercher dans les templates, pas dans le JS.
- Test de non-regression: `grep 'btcChartPrice' templates/partials/pages/today/widgets/` → doit retourner au moins une occurrence dans un fichier .html.
- Fichiers a surveiller: `templates/partials/pages/today/widgets/011_btc_chart.html`, `static/js/split/060_btc_chart_widget.js`.

### BUG-20260503-08 - [RÉSOLU] Stats overflow ellipsis cassé
- Symptome: les labels longs dans les breakdowns Stats/Insights (noms de stratégies, instruments) dépassaient de leur conteneur sans ellipsis.
- Cause racine: `text-overflow: ellipsis` appliqué mais sans `overflow: hidden` + `white-space: nowrap` sur les elements concernés.
- Regle de prevention: `text-overflow: ellipsis` nécessite TOUJOURS les trois propriétés: `overflow: hidden; white-space: nowrap; text-overflow: ellipsis;`.
- Test de non-regression: un nom de stratégie long (>20 car) dans les breakdowns → tronqué avec `...`.
- Fichiers a surveiller: `static/css/split/031_insights.css`, `static/css/split/032_breakdowns.css`.

### BUG-20260503-09 - [RÉSOLU] URL API key hardcodée au lieu d'env var
- Symptome: l'URL de l'API LLM (DeepSeek) était hardcodée dans le code JS/frontend au lieu d'être fournie via variable d'environnement backend.
- Cause racine: pas de mécanisme de configuration par env var pour l'URL de l'API.
- Regle de prevention: toute URL de service externe (API LLM, Binance, WebSocket) doit être configurable via backend (env var → `/api/config`), pas hardcodée dans le JS. Le JS lit `state.config.apiUrl`.
- Test de non-regression: `grep -rn 'https\?://api\.deepseek' static/js/split/` → 0 résultats (l'URL vient de state.config via backend).
- Fichiers a surveiller: `app_parts/00_paths_constants.py` (env vars), `static/js/split/` (références URL API).

### BUG-20260505-01 - [RÉSOLU] KPIs Dashboard non filtrés par période Journal
- Symptome: les KPIs du Dashboard (Net P&L, Winrate, RR, Trades) affichaient des données all-time au lieu de la période sélectionnée dans le Journal (mois/trimestre/custom).
- Cause racine: `getTradesForCurrentFilter()` ne filtrait pas les trades. Utilisait `state.allDays` directement sans appliquer `journalRangeMode`, `currentMonth`, ou `journalCustomFrom/To`.
- Regle de prevention: toute fonction qui alimente les KPIs doit filtrer par la période Journal courante. `getTradesForCurrentFilter()` est LA fonction canonique — utiliser `monthRange()`, `quarterRange()` ou `journalCustomFrom/To` selon `journalRangeMode`.
- Test de non-regression: Dashboard affiche mois en cours → cliquer sur un mois différent dans le Journal → Dashboard reflète le nouveau mois.
- Fichiers a surveiller: `static/js/split/013_kpis.js` (getTradesForCurrentFilter), `static/js/split/012_data_loading.js` (loadStats refreshDays).

### BUG-20260505-02 - [RÉSOLU] fetch() sans r.ok guard → SyntaxError silencieux
- Symptome: quand le serveur Flask retourne une page HTML 500, `r.json()` lève une `SyntaxError` non catchée → la chaîne de promesse reste pendante, l'utilisateur ne voit rien.
- Cause racine: pattern `fetch(url).then(r => r.json())` sans vérifier `r.ok`. Sur HTTP 500, Flask renvoie HTML, pas JSON.
- Regle de prevention: TOUT appel `fetch()` qui appelle `.json()` doit d'abord vérifier `res.ok`. Pattern: `.then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })`. Utiliser la fonction helper `api()` de `001_utilities.js` quand possible.
- Test de non-regression: `grep -rn 'fetch.*\.json' static/app.js` → chaque occurrence doit avoir un `r.ok` ou `res.ok` guard dans la même fonction ou avant.
- Fichiers a surveiller: `static/js/split/001_utilities.js` (api helper), tous les fichiers split avec fetch().

### BUG-20260505-03 - [RÉSOLU] state.allDays jamais invalidé après édition de trade
- Symptome: après édition d'un trade via flip card, les KPIs du Dashboard restaient sur les données du boot (state.allDays pas rechargé). Il fallait un refresh manuel.
- Cause racine: `_journalRefreshStateDebounced()` appelait `loadStats({ refreshDays: false })` qui ne recharge PAS `state.allDays`. Ensuite `loadStats()` utilisait l'ancien state pour calculer les KPIs.
- Regle de prevention: `refreshDays: true` doit être passé à `loadStats()` après toute modification de trade. `_journalRefreshStateDebounced()` doit toujours utiliser `refreshDays: true`. Après save, state.allDays est re-fetché via `loadAllDays()`.
- Test de non-regression: éditer un trade → les KPIs Dashboard se mettent à jour sans refresh manuel.
- Fichiers a surveiller: `static/js/split/012_data_loading.js`, `static/js/split/056_journal_day_trade_cards.js` (_journalRefreshStateDebounced).

### BUG-20260505-04 - [RÉSOLU] _waitForContainer : setTimeout fixe → polling DOM
- Symptome: 3 widgets (BTC chart, Chart XXL, Favoris Carousel) utilisaient `setTimeout(init, 300/400/500)` avec des délais arbitraires. Parfois le DOM n'était pas prêt, parfois le délai était trop long.
- Cause racine: `setTimeout` fixe qui ne s'adapte pas à l'état réel du DOM.
- Regle de prevention: utiliser `_waitForContainer(callback, 20, 50)` (polling 50ms × 20 = 1s max) pour toute initialisation différée de widget. Pas de `setTimeout` fixe. Le polling s'exécute dès que le DOM est prêt et abandonne après 1s avec un `console.warn`.
- Test de non-regression: les 3 widgets s'initialisent correctement après un rebuild + refresh navigateur.
- Fichiers a surveiller: `static/js/split/060_btc_chart_widget.js`, `static/js/split/062_chart_page.js`, `static/js/split/063_favorites_carousel.js`.

### BUG-20260505-05 - [RÉSOLU] Sauvegarde Settings sans feedback utilisateur
- Symptome: cliquer sur "Enregistrer" dans Settings → rien ne se passe visuellement pendant 0-300ms. L'utilisateur ne sait pas si la sauvegarde a eu lieu.
- Cause racine: les boutons save n'étaient pas désactivés pendant l'appel API et leur texte ne changeait pas.
- Regle de prevention: tout bouton déclenchant une opération asynchrone doit: 1) se désactiver immédiatement, 2) changer son texte pour indiquer l'action en cours, 3) se réactiver à la fin (ou après 1.5s minimum).
- Test de non-regression: cliquer "Enregistrer" → le bouton devient gris avec texte "Sauvegarde..." → redevient "Enregistrer" à la fin.
- Fichiers a surveiller: `static/js/split/003_addcustomstrategyfromsettings.js`, `static/js/split/002_prettify.js`.

### BUG-20260505-06 - [RÉSOLU] Navigation page non persistée entre sessions
- Symptome: après un refresh navigateur, l'utilisateur revenait toujours sur la page Dashboard (page par défaut) même s'il était sur Insights ou Settings.
- Cause racine: `state.currentPage` était initialisé à la valeur par défaut sans lire `localStorage("lastPage")`.
- Regle de prevention: au boot, lire `localStorage("lastPage")` et restaurer la page. Dans `goPage()`, sauvegarder la page courante dans localStorage. Pattern: `state.currentPage = localStorage.getItem("lastPage") || "today";`.
- Test de non-regression: naviguer vers Insights → refresh → la page Insights s'affiche.
- Fichiers a surveiller: `static/js/split/008_boot.js`, `static/js/split/009_navigation.js`.

### BUG-20260505-07 - [RÉSOLU] Sparkline PnL sans ligne zéro ni dates
- Symptome: la sparkline du widget Net P&L Dashboard n'avait ni ligne horizontale zéro (repère visuel) ni labels de dates (contexte temporel). Le graphique était flottant.
- Cause racine: le SVG ne dessinait que le polyline des PnL, sans axe ni repère.
- Regle de prevention: toute sparkline doit avoir: 1) une ligne zéro horizontale (tireté, position dynamique selon min/max), 2) trois labels de dates (première, milieu, dernière des 30 périodes), 3) la ligne zéro positionnée en absolu dans le viewBox.
- Test de non-regression: la sparkline affiche une ligne horizontale pointillée au niveau zéro (même si la courbe est tout positive ou négative) et 3 dates espacées.
- Fichiers a surveiller: `static/js/split/013_kpis.js` (renderPnlSparkline), `static/css/split/038_kpi_upgrade.css`.

### BUG-20260505-08 - [RÉSOLU] Settings hiérarchie hero/featured désordonnée
- Symptome: les cards Settings n'avaient pas d'ordre logique. Les actions destructrices (Danger Zone) étaient mélangées avec les réglages quotidiens.
- Cause racine: ajout de cards dans l'ordre chronologique des features, sans architecture de page.
- Regle de prevention: les Settings suivent une hiérarchie claire: Profil (hero, full width) → Préférences → Stratégies → Tags → Données → API Key (featured, full width) → Danger Zone (full, bordure rouge). Les cards hero/featured sont pleine largeur, les autres en grille 2 colonnes.
- Test de non-regression: la page Settings affiche les cards dans l'ordre ci-dessus, sans trou ni désordre.
- Fichiers a surveiller: `templates/partials/pages/settings.html`, templates des cards individuelles.

### BUG-20260505-09 - [RÉSOLU] Strategy/Tag chips non réordonnables (drag & drop)
- Symptome: impossible de changer l'ordre des stratégies ou tags dans Settings. L'ordre était celui de la création ou alphabétique.
- Cause racine: les chips étaient des `<span>` statiques sans attribut `draggable="true"` ni handlers drag/drop.
- Regle de prevention: toute liste ordonnée de chips (stratégies, tags, instruments) doit supporter le drag & drop natif HTML5. Chaque chip a `draggable="true"` et `data-reorder-value`. Le drop réordonne le tableau et persiste sur le backend.
- Test de non-regression: glisser une stratégie du milieu vers le haut → l'ordre est mis à jour et persiste après refresh.
- Fichiers a surveiller: `static/js/split/003_addcustomstrategyfromsettings.js`, `static/css/split/003_settings_chip_remove_hover.css`.

### BUG-20260505-10 - [RÉSOLU] Journal Night Mode ☾ absent
- Symptome: le Journal n'avait pas de mode nuit pour le trading en soirée. L'interface était trop lumineuse.
- Cause racine: pas de toggle ni de classe CSS pour un mode nuit spécifique au Journal.
- Regle de prevention: proposer un mode nuit par page (icon moon/sun) avec état persisté dans localStorage. Le mode nuit réduit le contraste, réchauffe les couleurs, et assombrit le calendrier. Pattern localStorage-driven: `localStorage.getItem("journalNightMode")`.
- Test de non-regression: cliquer sur l'icone ☾ → le Journal passe en tons chauds tamisés. Refresh → l'état est conservé.
- Fichiers a surveiller: `templates/partials/pages/journal/header.html` (bouton ☾), `static/js/split/004_loadjournaltablesort.js` (toggle), `static/css/split/046_journal_day_trade_cards.css`.

### BUG-20260505-11 - [RÉSOLU] KPIs placeholders "0.00$" au lieu de "—"
- Symptome: au chargement initial, les KPIs affichaient `+0.00$` au lieu de `—`. L'utilisateur croyait voir des données réelles (zéro) alors que rien n'était chargé.
- Cause racine: les templates avaient `0.00$` comme valeur initiale. `fmtMoney(val || 0)` transformait null/undefined en `0.00$`.
- Regle de prevention: les templates doivent avoir `—` (&mdash;) comme valeur initiale pour tout KPI. `fmtMoney()` ne doit JAMAIS recevoir `|| 0` — utiliser `val != null ? fmtMoney(val) : "—"`. Les trois états doivent être: loading=`...`, vide=`—`, valeur réelle=fmtMoney(val).
- Test de non-regression: au premier chargement, tous les KPIs Dashboard affichent `—` (pas `0.00$`). Après chargement des données, ils affichent les vraies valeurs.
- Fichiers a surveiller: tous les templates HTML de widgets KPIs, `static/js/split/013_kpis.js`.

### BUG-20260505-12 - [RÉSOLU] Delta ▲/▼ indicateurs KPIs absents
- Symptome: les KPIs du Dashboard (Net P&L, Winrate, etc.) n'indiquaient pas la variation par rapport à la période précédente. Impossible de savoir si la performance s'améliore ou se dégrade.
- Cause racine: pas de calcul ni d'affichage de delta (période courante vs période précédente).
- Regle de prevention: tout KPI numérique doit afficher: valeur courante + delta (▲ hausse / ▼ baisse) par rapport à la période précédente. Le delta doit être calculé par `loadStats()` et stocké dans `state.kpiDeltas`. Fonction `_renderKpiDelta(el, value, previous)`.
- Test de non-regression: le Dashboard affiche ▲ ou ▼ à côté de chaque KPI avec la valeur de variation.
- Fichiers a surveiller: `static/js/split/013_kpis.js`, `static/js/split/012_data_loading.js`.


## 10) Features, conventions et APIs documentées

Cette section documente les features ajoutées, les conventions établies, et les endpoints API spéciaux — sans format de bug car ce ne sont pas des régressions.

### FEATURE-20260501 - BTC chart widget en direct
- Ajout d'un widget graphique bougies chandeliers BTC/USDT dans le dashboard Today.
- Backend: route `/api/market/klines` proxy Binance API (23_routes_market.py).
- Frontend: TradingView Lightweight Charts (CDN), zoom/defilement, intervalles 1H/4H/1D.
- Widget enregistre dans WIDGET_REGISTRY + WIDGET_DEFAULTS pour apparaitre par defaut.
- Fichiers a surveiller: `app_parts/23_routes_market.py`, `static/js/split/060_btc_chart_widget.js`, `static/css/split/061_btc_chart_widget.css`, `templates/partials/pages/today/widgets/011_btc_chart.html`, `static/js/split/047_today_widget_board.js`.



### FEATURE-20260501b - Page Chart XXL dediee
- Nouvelle page accessible via le rail (raccourci C) avec graphique plein ecran.
- Bougies + histogramme volume, timeframes 5m-1W, paires BTC/ETH.
- Barre stats O/H/L/C/Vol, countdown bougie, variation.
- Architecture preparee pour TPO/VWAP/orderflow plus tard.
- Fichiers: chart.html, 062_chart_page.js, 062_chart_page.css, rail.html, 028_global_keys.js.



### CONVENTION-20260502 - Mode par defaut = light (white), upgrade design
- Regle: Le theme par defaut est le light mode (`dark_mode: false` dans les defaults). Les ombres light utilisent le pattern 3 couches de Steep. Les border-radius ont ete augmentes (cards 16px, small 12px) inspires de Legend. Les accents warm (--surface-warm, --accent-warm) sont disponibles. Le rail et la topbar ont des overrides light-mode. Le widget contexte jour a ete redesign pour ressembler aux entry-cards (compact, badge instr, hover glow). Les badges resultat (WIN/LOSS) sont minimalistes en light mode (transparents).
- Fichiers a surveiller: `static/js/split/002_prettify.js`, `static/css/split/000_theme_tokens_base.css`, `static/css/split/032_priority1_app_shell.css`, `static/css/split/048_card_surface.css`, `static/css/split/045_today_context_widget.css`.


### API-20260502-01 - GET /api/trades/favorites
- Endpoint qui retourne tous les trades avec le tag `favoris` en jointure avec la table `days` pour les champs `day_date` et `day_instrument`.
- Route: `GET /api/trades/favorites` dans `app_parts/10_routes_trades.py`.
- La fonction `normalize_trade_response()` preserve les colonnes inconnues (`day_date`, `day_instrument`).
- Utilise pour le widget Favoris Carousel dans le dashboard Today.


### FEATURE-20260502-01 - Widget Favoris Carousel
- Nouveau widget `favorites_carousel` dans le dashboard Today.
- Affiche les trades favoris sous forme de flip cards dans un carousel horizontal.
- Navigation: fleches (hover), swipe tactile (scroll-snap), points indicateurs.
- Scroll-snap natif CSS pour le swipe mobile.
- Lazy render: seules les slides adjacentes sont rendues.
- Template: `templates/partials/pages/today/widgets/012_favorites_carousel.html`
- JS: `static/js/split/063_favorites_carousel.js`
- CSS: `static/css/split/063_favorites_carousel.css`
- Enregistre dans `WIDGET_REGISTRY` et `WIDGET_DEFAULTS` de `047_today_widget_board.js`.
- Les utilisateurs existants verront le widget apparaitre en fin de grille (non dans l'ordre sauvegarde localStorage).


### CONVENTION-20260501 - exit_price = mapping conditionnel WIN/LOSS (MAJ 2026-05-01)
- Regle: `exit_price` est mappe conditionnellement selon le resultat du trade. Si WIN → exit_price = take_profit. Si LOSS → exit_price = stop_loss.
- Le backend (`05_payload_normalizers.py`) derive `is_win` depuis direction + entry vs exit si non fourni explicitement.
- Le frontend affiche `exit_price` sous le label "TP" dans la section Niveaux de l'editeur XXL, mais le bloc Resultat a un select Statut (Ouvert/Cloture) qui permet de corriger le mapping.
- `syncExitMapping()` dans `021_rr_preview.js` auto-remplit SL ou TP quand l'utilisateur change isWin.
- La DB conserve les deux colonnes (`take_profit`, `stop_loss`) pour retrocompatibilite.
- **Ne JAMAIS afficher exit_price ET take_profit en meme temps** — seul exit_price (label "TP") est visible.
- Cas particulier: SL=TP → RR preview affiche un avertissement au lieu de 1.00R.
- Correction du bug: une perte short avec exit_price mais sans TP causait SL=TP=1.00R (nonsensical).
- Fichiers a surveiller: `app_parts/05_payload_normalizers.py` (normalisation conditionnelle), `static/js/split/021_rr_preview.js` (syncExitMapping), `static/js/split/059_trade_editor_controller.js` (label TP), `templates/partials/pages/journal/table.html`, `static/js/split/056_journal_day_trade_cards.js`, `app_parts/03_core_helpers.py` (skip validation si is_win explicite).


### CONVENTION-20260503 - Refacto loader `app_parts/__init__.py` (exec → namespace dédié)

- **Motivation**: Le loader utilisait `exec(_code, globals(), globals())` qui chargeait tous les modules dans le même espace de noms que le package `app_parts` lui-même. Causes de fragilité: 1) collisions silencieuses entre modules (ex: `_time` écrasé entre deux fichiers), 2) pas de détection de chevauchement, 3) `globals()` implicite rendait le code difficile à instrumenter.
- **Nouveau loader**: Chaque fichier est compilé et exécuté dans un dictionnaire namespace dédié `_NS`. Après chargement, un proxy `_AppPartsModule` est installé sur `app_parts` qui délègue les lectures/écritures à `_NS`. Les collisions de noms publics sont détectées et loguées en warning.
- **Monkey-patching**: `app_parts.DB_PATH = X` (utilisé dans les tests) propage dans `_NS` via `__setattr__` — toutes les fonctions voient la nouvelle valeur à l'appel car leur `__globals__` pointe sur `_NS`.
- **Rétrocompat**: `from app_parts import *` dans `app.py` continue de fonctionner (les noms sont copiés dans `__dict__` après chargement).
- **Test de non-régression**: `python -m unittest discover -s tests -v` → 41 tests passent (dont le guardrail playbook mis à jour). Le serveur démarre avec `python app.py`.
- **Fichiers modifiés**: `app_parts/__init__.py` (seulement ce fichier — les 25 modules `app_parts/*.py` sont inchangés).

### BUG-20260503-D09 - [RÉSOLU] Skeleton KPI reste figé après erreur API
- Symptome: Si le fetch `/api/stats` échoue (réseau, 500), `renderKPIs()` n'est jamais appelée. Le `.loading` class sur `[data-widget-board="today"]` n'est pas retiré → le shimmer skeleton reste indéfiniment.
- Cause racine: `loadStats()` avait `catch { toast() }` mais ne nettoyait pas le skeleton. Le `finally { loading(false) }` ne gérait que la loadingBar globale (#loadingBar), pas le skeleton widget.
- Regle de prevention: TOUT `catch` d'un fetch qui alimente un render doit netoyer l'état de chargement du widget correspondant. Pattern: `var board = document.querySelector('[data-widget-board="today"]'); if (board) board.classList.remove("loading");`. Le `finally` ne suffit pas si le render est dans le `try`.
- Test de non-regression: Simuler une erreur API → le skeleton disparaît, le toast d'erreur s'affiche, un état d'erreur visuel apparaît (bordure rouge subtile avec "Erreur de chargement").
- Fichiers a surveiller: `static/js/split/012_data_loading.js` (catch de loadStats), `static/js/split/013_kpis.js` (renderKPIs loading removal), `static/css/split/003_settings_chip_remove_hover.css` (.widget-board[data-load-error] styles).

### BUG-20260503-D23 - [RÉSOLU] États vides sans action claire
- Symptome: Plusieurs états vides (recent entries, favoris, journal filters, calendar search) n'avaient aucun bouton d'action pour sortir de l'état vide.
- Cause racine: Approche "message seulement" sans CTA — l'utilisateur devait deviner quoi faire.
- Regle de prevention: TOUT état vide doit proposer une action claire : "Ajouter", "Voir", "Réinitialiser", "Créer". Pas de message seul.
- Test de non-regression: Naviguer vers chaque écran sans données → un bouton d'action est visible.
- Fichiers a surveiller: `014_today_page.js` (recent empty), `012_favorites_carousel.html` (fav empty), `table.html` (journal filter empty), `015_calendar.js` (calendar/search empty).


### BUG-20260505-03 - [RÉSOLU] Wizard clics morts + draft auto-resume
- Symptome: Dès l'ouverture du wizard, plus aucun clic ne marche. Après un refresh, la wizard reprend à l'étape du crash PC (3/12 au lieu de 1/12).
- Cause racine: 3 causes combinées — (1) setTimeout(wizNext,200) jamais annulé → timer stale après fermeture (2) wizClose() ne nettoyait pas paddingTop/paddingLeft/onclick/wiz-rail-mode (3) Draft auto-repris à chaque wizOpen()
- Regle de prevention: (1) Toujours stocker le timer ID et clearTimeout dans wizClose() (2) wizClose() doit nettoyer TOUS les résidus d'état (inline styles, classes dynamiques, onclick) (3) _wizClearDraft() en tête de wizOpen() — le draft est crash recovery, jamais repris auto.
- Test de non-regression: Ouvrir wizard depuis le rail, cliquer sur Suivant/cartes, fermer, rouvrir — doit repartir à l'étape 1. Répéter 3x.
- Fichiers a surveiller: 040_wizard_core.js, 042_wizsetdate.js, 025_wizard_steps_ui.css

### CONVENTION-20260503-02 - Conflit de namespace `_time` dans le loader partagé
- Symptome: 500 INTERNAL SERVER ERROR sur `/api/days` et `/api/stats` des l'ouverture du journal. TypeError: 'module' object is not callable sur `_time()` dans le rate limiter.
- Cause racine: `03_core_helpers.py` fait `from time import time as _time` (la fonction). `23_routes_market.py` fait `import time as _time` (le module). Dans le namespace partagé `_NS` du loader, le dernier fichier charge écrase le premier → `_time` devient le module `time`, pas la fonction `time()`.
- Regle de prevention: NE JAMAIS utiliser `_time` comme alias d'import dans les fichiers app_parts. Utiliser `_time_mod` pour le module (`import time as _time_mod`) et `_time` ou `_time_fn` pour la fonction (`from time import time as _time_fn`). Vérifier avec `grep -n 'import.*as _time' app_parts/*.py` apres ajout d'un fichier.
- Test de non-regression: Charger le module app_parts → `_time` doit etre callable. Toutes les routes `@ratelimit` doivent repondre 200.
- Fichiers a surveiller: app_parts/__init__.py, app_parts/03_core_helpers.py, app_parts/23_routes_market.py, app_parts/15_parse_trade.py, app_parts/19_ai_chat.py

### CONVENTION-20260506-01 — Pagination backend aggTrades + force cache bust
- Symptome: La route `/api/market/aggtrades` ne paginait pas et envoyait limit=5000 a Binance (max 1000). Le cache etait un dict sans limite de taille. Le cache hit renvoyait des metadata incompletes. Le param force n'existait pas. Les int() levaient 500 sur input invalide.
- Cause racine: Implementation initiale minimaliste sans pagination, cache size limit, ou validation de parametres.
- Regle de prevention: TOUJOURS clamber les parametres limite. Paginer en backend avec _MAX_PAGES = 8. Stoker le payload complet dans le cache (pas seulement trades). Expurger les entrees expirees quand le cache depasse _CACHE_MAX_KEYS = 100. Ajouter force=1 pour bypass cache. Utiliser _parse_int_param() avec try/except plutot que int() direct.
- Test de non-regression: /api/market/aggtrades?symbol=BTCUSDT&limit=5000 doit retourner jusqu'a 5000 trades pagines. /api/market/aggtrades?limit=abc doit retourner 400. /api/market/aggtrades?force=1 doit contourner le cache.
- Changement: Rewrite complet de market_aggtrades(), ajout de _purge_cache(), _parse_int_param(), _fetch_binance_agg(), _MAX_PAGES, MAX_TOTAL_TRADES.
- Fichiers a surveiller: app_parts/23_routes_market.py

### CONVENTION-20260506-02 — Pagination aggTrades par fromId (pas startTime+1ms)
- Cause racine: startTime+1ms peut skipper des trades ayant le meme timestamp milliseconde. Plusieurs aggTrades Binance peuvent partager le meme T.
- Regle de prevention: TOUJOURS paginer par fromId=lastAggTradeId+1 pour les pages suivantes. La premiere page utilise startTime/endTime pour le filtrage temporel. Filtrer cote backend les trades > endTime.
- Test de non-regression: /api/market/aggtrades?symbol=BTCUSDT&limit=5000 doit retourner exactement 5000 trades sans trous. Verifier que les trades ont des ids consecutifs.
- Fichiers a surveiller: app_parts/23_routes_market.py

### CONVENTION-20260506-03 — rAF _running guard pour eviter les boucles orphelines
- Cause racine: start() sans guard peut etre appele plusieurs fois (init + pageChange listener).
- Regle de prevention: Toujours garder _running flag dans start/stop. start() check _running en tete, return si deja lance. loop() check _running a chaque frame. stop() met _running=false puis cancelAnimationFrame.
- Fichiers a surveiller: static/js/split/066_orderflow_engine.js

### CONVENTION-20260506-04 — abort(400) retourne HTML → try/except ValueError + jsonify
- Cause racine: abort(400) dans Flask peut retourner une page HTML si pas de handler errorhandler(400) dedie.
- Regle de prevention: Ne jamais utiliser abort() dans les routes API. Utiliser raise ValueError dans les helpers, try/except dans la route, return jsonify({"error": str(e)}), 400.
- Fichiers a surveiller: app_parts/23_routes_market.py

### BUG-20260506-05 — Timeout Binance 10s cause UI bloquee 10 secondes
- Symptome: Au refresh, page noire sans donnees pendant ~10s, puis data apparait. `klines?interval=1d&limit=100` → 502 apres 10.02s.
- Cause racine: `urllib.request.urlopen(req, timeout=10)` dans `market_klines()` et `_fetch_binance_page()`. Quand Binance est lent/unreachable, le thread Flask est bloque 10s. Le frontend attend les donnees VWAP 90D avant de rendre completement.
- Regle de prevention: Timeout = 3s max pour les proxies API externes. Ajouter `log.warning` sur les timeouts Binance pour diagnositic. Les VWAP multi-TF doivent echouer silencieusement (log only, pas de toast).
- Test de non-regression: Charger la page Today → le widget BTC chart doit s'afficher immediatement meme si Binance est down. Les VWAP doivent etre absents (pas d'etat d'erreur visible).
- Fichiers a surveiller: app_parts/23_routes_market.py, static/js/split/060_btc_chart_widget.js

### BUG-20260506-06 — JS bundle bloque en Pending (serveur Flask mono-thread)
- Symptome: `app.js` reste en Pending (0 B) dans le navigateur, CSS se charge normalement. La page reste noire sans data.
- Cause racine: `app.run(host, port, debug)` sans `threaded=True`. Flask par defaut est mono-thread. Quand le proxy Binance bloque le thread (3s), la reponse du JS (657 KB) est suspendue → le navigateur attend.
- Regle de prevention: Toujours `threaded=True` sur `app.run()` en dev. En prod, utiliser waitress/gunicorn.
- Test de non-regression: Lancer le serveur, charger la page → `app.js` doit charger en <500ms meme si Binance est down.
- Fichiers a surveiller: app_parts/18_launcher.py

### BUG-20260506-07 — Pagination klines par `batch[-1][0]` cause doublons
- Symptome: des bougies en double apparaissent dans les donnees klines paginees (meme open_time).
- Cause racine: `current_start = batch[-1][0]` réutilise l'open_time de la dernière bougie comme startTime de la page suivante. Binance inclusive start → la derniere bougie est fetchée deux fois.
- Regle de prevention: TOUJOURS paginer les klines par `last_open_time + interval_ms`. Ajouter une dedupe par open_time en post-traitement.
- Test de non-regression: fetch 150 bougies de 1h → les 150 doivent avoir des open_time uniques et consecutifs.
- Fichiers a surveiller: app_parts/23_routes_market.py

### BUG-20260507-01 — DELETE routes sans check existence → 200 OK meme si rien supprime
- Symptome: `delete_day(999)` et `delete_trade(999)` retournaient `{"ok": true}` 200 pour des IDs inexistants.
- Cause racine: les routes DELETE executaient directement le SQL sans SELECT prealable.
- Regle de prevention: TOUJOURS verifier l'existence avec `SELECT id` avant DELETE sur des ressources individuelles. Pour les batchs, utiliser `cur.rowcount` au lieu de `len(ids)`.
- Test de non-regression: `DELETE /api/days/999999` → 404. `DELETE /api/trades/999999` → 404. `DELETE /api/trades/batch` avec 501 IDs → 400.
- Fichiers a surveiller: app_parts/09_routes_days.py, app_parts/10_routes_trades.py

### BUG-20260507-02 — /api/trades/instruments pas de fallback config si DB vide
- Symptome: avec une DB vide, la route retourne `[]` au lieu des instruments par defaut definis dans INSTRUMENTS.
- Cause racine: la route ne faisait que `SELECT DISTINCT instrument FROM days` sans fallback.
- Regle de prevention: TOUJOURS prevoir un fallback sur les valeurs de config quand une requete DB retourne 0 resultats. Les instruments par defaut du config.json sont la source de verite, la DB est un sur-ensemble dynamique.
- Fichiers a surveiller: app_parts/10_routes_trades.py

### CONVENTION-20260507-01 — Index manquants sur trades
- Cause racine: les colonnes `strategy`, `is_win`, `created_at` sont frequemment filtrees/triees sans index.
- Regle: Ajouter les indexes sur les colonnes de filtrage et tri frequents dans `init_db()`. Migration si table existe deja.
- Fichiers a surveiller: app_parts/02_database.py

### CONVENTION-20260507-02 — ML _load_trades_with_context doit utiliser derive_trade_metrics()
- Cause racine: le module ML lisait les colonnes brutes `pnl`, `is_win`, `rr` directement depuis la DB, contournant `derive_trade_metrics()` qui normalise ces valeurs.
- Regle: Toujours passer par `derive_trade_metrics()` pour les metriques derivees (pnl, rr, is_win) meme dans les modules non-stats. Les valeurs brutes DB peuvent etre NULL ou incoherentes.
- Fichiers a surveiller: app_parts/20_ml_engine.py

### BUG-20260507-03 — Cache ML : date_to absent de la cle de cache
- Symptome: Deux requetes `analyze_patterns` avec le meme `date_from` mais des `date_to` differents retournaient le meme resultat en cache.
- Cause racine: la construction de `cache_key` incluait `pattern|{mtime}|inst={inst}|from={from}` mais pas `|to={to}`.
- Regle de prevention: TOUS les parametres de requete doivent etre inclus dans la cle de cache. Un parametre oublie = donnees incoherentes silencieuses.
- Fichiers a surveiller: app_parts/20_ml_engine.py

### CONVENTION-20260507-03 — Couche service extraite (06a_trade_service + 06b_day_service)
- Motivation: extraire la logique metier des routes pour la rendre reutilisable par l'IA chat et les tests.
- Regle: Les fonctions `service_*` prennent `db` en parametre explicite, ne dependent pas du contexte Flask. Les routes restent minces (parse → service → jsonify). Charger les services AVANT les routes dans `__init__.py`.
- Fichiers a surveiller: app_parts/06a_trade_service.py, app_parts/06b_day_service.py, app_parts/__init__.py

### BUG-20260503-08 — [RÉSOLU] pnl REAL DEFAULT 0 en DB empeche la distinction pnl-absent vs pnl=0
- Symptome: quand _auto_calc_pnl() ne set pas pnl (pas d'entry/exit/size), le DEFAULT 0 en DB prenait le relais, rendant impossible la distinction entre "pnl non fourni" (None) et "pnl=0 explicite". Cassait le recalcul en update (le pnl=0 existant bloquait le guard `payload.get("pnl") is not None`).
- Cause racine: `pnl REAL DEFAULT 0` dans le CREATE TABLE de 02_database.py.
- Regle de prevention: les colonnes avec une semantique "optionnelle/inconnue" ne doivent PAS avoir de DEFAULT. NULL est la valeur correcte pour "non renseigne". Uniquement les colonnes ou 0 a un sens metier (ex: position_size) peuvent avoir DEFAULT 0.
- Test de non-regression: creer un trade sans entry/exit/size → pnl=None (pas 0.0). Update avec exit_price → pnl recalcule depuis les donnees existantes.
- Fichiers a surveiller: app_parts/02_database.py (CREATE TABLE trades), app_parts/05_payload_normalizers.py, app_parts/03_core_helpers.py
