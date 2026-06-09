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
- **Documentation complÃ¨te des 49 routes API :** `docs/API_ROUTES.md` (mÃ©thode, path, params, body, retour, codes HTTP).

### 2.2 Frontend
- Etat global: `static/js/split/000_state.js`.
- **Architecture CSS (52 splits â†’ `static/style.css`) :**
  - Ordre alphabÃ©tique du build + **CSS Cascade Layers** pour les overrides explicites
  - HiÃ©rarchie : `reset < design < layout < components < widgets < utilities`
  - Unlayered CSS bat tous les layers (migration progressive)
  - Voir `000_theme_tokens_base.css` pour la dÃ©finition des layers
- **Creation trade (wizard)** : `040_wizard_core.js`, `041_wizskip.js`, `042_wizsetdate.js`, `043_wizsetdir.js`, `044_wizreadfileasdataurl.js`, `045_bindwizard.js`.
  - Mode compact (clic calendrier): wizard centre 420x520
  - Mode rail (clic "Nouveau Trade"): wizard rectangle 660x360 ancre au bouton, classe `.wiz-rail-mode`
- **Edition trade (flip card XXL)**: `056_journal_day_trade_cards.js` (rendu flip cards), `059_trade_editor_controller.js` (editeur inline XXL).
- **Post-mortem wizard**: `pmWizOpen()` dans wizard core â€” etape quality/lessons/tags apres cloture.
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
- Tokens typiques: `Ãƒ`, `Ã‚`, `Ã¢`, `\uFFFD`.
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
rg -n --hidden -g '!.venv/**' -g '!data/**' -g '!__pycache__/**' 'Ãƒ|Ã‚|Ã¢|ï¿½' app_parts static templates docs
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

### BUG-YYYYMMDD-XX - [RÃ‰SOLU] Titre court
- Symptome:
- Cause racine:
- Regle de prevention:
- Test de non-regression:
- Fichiers a surveiller:


### BUG-20260428-01 - [RÃ‰SOLU] Mojibake introduit par ecriture PowerShell implicite
- Symptome: textes UI affiches avec caracteres casses (`Ãƒ`, `Ã‚`, `Ã¢`).
- Cause racine: ecriture de fichiers texte sans forcer UTF-8.
- Regle de prevention: toute ecriture shell doit utiliser `Set-Content/Add-Content -Encoding utf8`.
- Test de non-regression: `tests/test_encoding_guardrails.py` + scan `rg` section 3.4.
- Fichiers a surveiller: `app_parts/*.py`, `static/js/split/*.js`, `templates/partials/**/*.html`, `AI_DEVELOPMENT_PLAYBOOK.md`.


### BUG-20260428-02 - [RÃ‰SOLU] Trade sauve mais calendrier non rafraichi
- Symptome: nouveau trade absent du calendrier tant que la page n'est pas rechargee.
- Cause racine: absence de refresh global post-save.
- Regle de prevention: apres create/update/delete trade, relancer pipeline data central (`loadAll()` + rerender).
- Test de non-regression: test API + verification UI manuelle du journal apres sauvegarde.
- Fichiers a surveiller: `static/js/split/012_data_loading.js`, `static/js/split/015_calendar.js`, `static/js/split/020_trade_form.js`.


### BUG-20260428-03 - [RÃ‰SOLU] Questions Midnight posees hors contexte
- Symptome: champ/questions `Open Midnight` visibles meme hors `midnight_model`.
- Cause racine: logique conditionnelle strategie absente/incomplete dans wizard ou modale.
- Regle de prevention: tout bloc Midnight doit etre strictement conditionne a `strategie == midnight_model`.
- Test de non-regression: scenario UI multi-strategies + parse narration Midnight.
- Fichiers a surveiller: `static/js/split/020_trade_form.js`, `static/js/split/040_wizard_core.js`, `app_parts/10_parse_trade.py`.


### BUG-20260429-01 - [RÃ‰SOLU] Tests ecrivent dans la DB de production (scope Python)
- Symptome: tests fail avec 200 != 201, stats incorrectes (avg_rr 4.595 au lieu de 2.0), routes /api/entries introuvables (404).
- Cause racine: `mod.DB_PATH = temp_path` ne change que `app.DB_PATH`. `get_db()` lit `app_parts.DB_PATH` (le namespace du module parent). Les deux divergent apres reassignment.
- Regle de prevention: Toujours faire `import app_parts; app_parts.DB_PATH = ...` dans les tests, jamais `mod.DB_PATH = ...`.
- Test de non-regression: `tests/test_stats_derived_metrics.py` (average RR sur DB isolee doit etre 2.0).
- Fichiers a surveiller: `tests/*.py`.


### BUG-20260429-02 - [RÃ‰SOLU] data["date"] au lieu de date_val dans IntegrityError
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


### BUG-20260429-04 - [RÃ‰SOLU] build.py: bundle CSS vide quand tous les <link> sont supprimes
- Symptome: Apres `python build.py`, `head_assets_css.html` est vide. Le bundle CSS n'est pas reference.
- Cause racine: `switch_to_bundles()` supprime tous les `<link>` split puis cherche a inserer le bundle avant le premier `<link>` restant. S'il n'en reste pas (fichier vide), le bundle n'est pas ajoute.
- Regle de prevention: Toujours verifier que `head_assets_css.html` contient le bundle apres build. Le fix utilise `if re.search(r'<link[^>]+rel="stylesheet"', text): ... else: text += bundle_tag`.
- Test de non-regression: `python build.py && grep -q "style.css" templates/partials/layout/head_assets_css.html`
- Fichiers a surveiller: `build.py`


### BUG-20260429-05 - [RÃ‰SOLU] build.py: restore_splits() contamine les templates avec le mauvais type
- Symptome: Apres `python build.py --restore`, `head_assets_css.html` contient des `<script>` JS et `scripts.html` contient des `<link>` CSS. Les deux fichiers sont corrompus.
- Cause racine: `restore_splits()` restaure les deux types (JS + CSS) dans les deux templates sans distinction.
- Regle de prevention: Toujours specifier `js=True/False` et `css=True/False` dans les appels a `restore_splits()`.
- Test de non-regression: `python build.py --restore && python build.py && python -m unittest discover -s tests`
- Fichiers a surveiller: `build.py`, `templates/partials/layout/head_assets_css.html`, `templates/partials/overlays/scripts.html`


### BUG-20260429-06 - [RÃ‰SOLU] DATA CORRUMPUE - La base de donnees a ete videe pendant les tests/build
- Symptome: data/journal.db existe mais toutes les tables sont vides (0 lignes). Les backups automatiques dans data/backups/ aussi.
- Cause racine: Les tests unitaires et le build ont ete lances sans isolement de la DB. Le module `app_parts.DB_PATH` pointait vers la DB de production pendant les tests car `mod.DB_PATH = X` ne propage pas a `app_parts` (BUG-20260429-01). Un `init_db()` a ete appele sur la vraie DB, effacant les donnees.
- Regle de prevention: NE JAMAIS lancer de tests sans verifier que `app_parts.DB_PATH` pointe vers une DB temporaire. Backup OBLIGATOIRE avant toute operation a risque sur le projet.
- Test de non-regression: Avant chaque test, verifier `assert app_parts.DB_PATH != la_vraie_DB_prod`. Les tests utilisent `tempfile.TemporaryDirectory()` pour l'isolation.
- Backup restaure: data/journal.db.pre_audit_backup (69632 bytes, 13 jours, 13 trades). DB corrompue conservee: data/journal.db.corrupted_empty.
- Commande de backup: `cp data/journal.db data/journal.db.$(date +%Y%m%d-%H%M%S).backup`
- Fichiers a surveiller: `data/journal.db`, `app_parts/00_paths_constants.py`, `app_parts/02_database.py`


### BUG-20260429-07 - [RÃ‰SOLU] NAS remplace par NQ comme instrument canonique
- Symptome: L'instrument etait stocke comme "NAS" en base mais affiche "NQ" dans l'UI via alias. Changement de nom canonique de "NAS" vers "NQ".
- Cause racine: L'utilisateur prefere le ticker NQ (Nasdaq Futures). NAS etait le canonique avec NQ comme alias d'affichage.
- Regle de prevention: Le canonique est maintenant "NQ". L'alias inverse {"NAS": "NQ"} assure la retrocompatibilite pour les donnees existantes en base. Toute reference a "NAS" comme instrument doit etre remplacee par "NQ". Les fonctions `_to_canonical()` et `_display()` sont inversees.
- Test de non-regression: `tests/test_wizard_aliases.py` â€” envoi de "NQ" en entree doit retourner "NQ" (anciennement normalise en "NAS").
- Fichiers a surveiller: `config.json`, `app_parts/00_paths_constants.py`, `app_parts/19_ai_chat.py`, `static/js/split/001_utilities.js`, `static/js/split/029_command_palette.js`, `static/js/split/032_breakdowns.js`, `static/js/split/039_helpers.js`, `static/js/split/040_wizard_core.js`, `static/js/split/042_wizsetdate.js`, `templates/partials/layout/rail.html`, `templates/partials/overlays/modal/day_form.html`, `static/app.js`


### BUG-20260429-08 - [RÃ‰SOLU] Chatbot IA invente des jours feries car pas d'outil delete
- Symptome: L'IA refuse de supprimer un trade le lundi 6 avril 2026 en pretendant que c'est un dimanche et jour ferie. En realite le 6 avril 2026 est bien un lundi.
- Cause racine: Aucun outil `delete_trade` ou `delete_day` n'etait defini dans les tools du module `19_ai_chat.py`. L'IA ne pouvait pas executer la suppression, donc elle a hallucine une reponse au lieu d'avouer son incapacite.
- Regle de prevention: TOUJOURS definir les outils delete quand on ajoute un chatbot CRUD. Les outils doivent etre: `delete_trade` (trade_id), `delete_day` (day_id). Le system prompt doit explicitement interdire de deviner les jours de la semaine et ordonner d'utiliser les outils de verification (`get_day`/`get_days`) avant de refuser une operation. Le prompt doit aussi exiger confirmation utilisateur avant toute suppression.
- Test de non-regression: Aucun test unitaire direct (depend de l'API externe DeepSeek). Verifier manuellement que `/api/ai/chat` expose bien les tools `delete_trade` et `delete_day` dans sa reponse GET.
- Fichiers a surveiller: `app_parts/19_ai_chat.py` (tools definitions + handlers + system prompt)


### BUG-20260429-09 - [RÃ‰SOLU] Chatbot IA : champs manquants dans update_day et stats limitees
- Symptome: L'IA ne pouvait pas modifier l'instrument ou la date d'un jour de trading via update_day. Les stats renvoyees par get_stats etaient basiques (pas de breakdowns, drawdown, period compare, heatmap, etc.).
- Cause racine: Les tools `update_day` n'exposaient pas les champs `instrument` et `date` dans leur parametrage. La fonction `_tool_get_stats()` etait une reimplementation simplifiee qui n'utilisait pas le pipeline complet de `14_routes_stats.py` (_bucket, _derive_trade_metrics, _compute_drawdown_series, _build_period_comparison, _streak_stats, _build_insights, _build_pnl_histogram).
- Regle de prevention: Les tools IA doivent exposer TOUS les champs que les routes backend supportent. Ne pas reimplementer des fonctions stats simplifiees â€” utiliser le meme pipeline que la route API. Le fichier `14_routes_stats.py` est la reference du pipeline stats complet.
- Test de non-regression: Verifier que `_tool_get_stats()` appelle `_derive_trade_metrics`, `_bucket`, `_bucket_multi`, `_compute_drawdown_series`, `_build_pnl_histogram`, `_build_period_comparison`, `_streak_stats`, `_build_insights`.
- Fichiers a surveiller: `app_parts/19_ai_chat.py` (definitions tools + handlers + _tool_get_stats)


### BUG-20260429-10 - [RÃ‰SOLU] Suppression du champ emotional_state de toutes les couches
- Symptome: L'etat emotionnel (calm/focused/anxious/fomo/revenge/overconfident) etait encore present dans le code apres refactoring. L'utilisateur a demande sa suppression complete.
- Cause racine: Le champ etait distribue dans ~20 fichiers (backend whitelists, normalizers, stats pipeline, parseur, tools IA, JS split wizard + formulaire, templates HTML, tests). La colonne SQL a ete preservee.
- Regle de prevention: Suivre la checklist Phase 5 du playbook pour toute suppression multi-couche : backend whitelist â†’ model columns â†’ normalizer aliases â†’ routes stats â†’ parseur keywords â†’ IA system prompt â†’ IA tool schemas â†’ IA handlers â†’ JS split (wizard init, formulaire payload, custom blocks, stats render) â†’ templates HTML â†’ tests â†’ rebuild.
- Test de non-regression: `grep -rn 'emotional_state\|exit_emotion\|by_emo'` hors DB et bundle doit retourner 0. Tests unitaires doivent passer.
- Fichiers a surveiller: Tous les fichiers listes dans la checklist Phase 5.


### BUG-20260429-11 - [RÃ‰SOLU] Backups lances pendant les tests Windows
- Symptome: la suite de tests echoue au nettoyage de `TemporaryDirectory()` avec `PermissionError: [WinError 32]` sur `journal.db` ou `backups/journal-*.db`.
- Cause racine: le garde-fou de `_auto_backup_after_write()` detectait `/tmp/` mais pas les chemins Windows `AppData/Local/Temp`, donc des threads de backup ouvraient encore les DB temporaires.
- Regle de prevention: normaliser les chemins en minuscules avec slashs avant de tester les repertoires temporaires.
- Test de non-regression: `python -m unittest discover -s tests -v` doit passer sans fichiers verrouilles dans les dossiers temporaires.
- Fichiers a surveiller: `app_parts/17_backups.py`, `tests/*.py`.


### BUG-20260429-12 - [RÃ‰SOLU] Controles Journal cables en JS mais absents du template
- Symptome: les modes mois/semaine, calendrier/table, periode custom et filtres trade existaient cote JS mais restaient invisibles dans le Journal.
- Cause racine: `templates/partials/pages/journal/filters.html` etait vide alors que les handlers attendaient des IDs comme `calendarViewToggle`, `calendarLayoutToggle` et `journalFilterStrategy`.
- Regle de prevention: quand un handler UI est ajoute, verifier que le template expose l'element cible et que `rg "id"` trouve une source HTML avant build.
- Test de non-regression: `tests/test_template_render.py` + verification manuelle de la toolbar Journal apres build.
- Fichiers a surveiller: `templates/partials/pages/journal/filters.html`, `static/js/split/004_loadjournaltablesort.js`, `static/js/split/005_setjournalcustomrange.js`, `static/js/split/006_comparetext.js`.


### BUG-20260430-01 - [RÃ‰SOLU] Design trade modifie dans les splits sans bundle regenere
- Symptome: la modale trades peut rester sur l'ancien rendu si `static/js/split/*` ou `static/css/split/*` sont modifies mais que `static/app.js` et `static/style.css` ne sont pas reconstruits.
- Cause racine: le template charge les bundles en mode normal, donc les changements de source split ne sont visibles qu'apres `build.py`.
- Regle de prevention: apres toute retouche UI trade dans les splits, executer `python build.py` et verifier que `templates/partials/layout/head_assets_css.html` et `templates/partials/overlays/scripts.html` pointent vers le nouveau token.
- Test de non-regression: `python build.py && python -m unittest tests.test_template_render -v && python -m unittest discover -s tests -v`.
- Fichiers a surveiller: `static/js/split/019_trades_list_dans_la_modal.js`, `static/css/split/040_trade_cockpit_cards.css`, `static/app.js`, `static/style.css`, `templates/partials/layout/head_assets_css.html`, `static/templates/partials/overlays/scripts.html`.


### BUG-20260430-02 - [RÃ‰SOLU] Sparkline Net P&L coupe (viewBox SVG != hauteur JS)
- Symptome: la sparkline du widget Net P&L est coupee/tronquee â€” les pics de la courbe sortent du cadre SVG et sont invisibles, ne laissant qu'une ligne plate ou incomplete.
- Cause racine: le JS (`013_kpis.js:renderPnlSparkline()`) dessine les points du `<polyline>` sur une hauteur de 42 (`height=42`, `padY=5` â†’ les points Y vont de 5 a 37). Mais le template `001_kpi_total_pnl.html` avait `viewBox="0 0 180 30"`, donc tout point y > 30 etait hors viewBox et invisible. Le mismatch entre les deux hauteurs faisait sortir les extremums de la courbe. Meme avec `overflow:visible` en CSS, le viewBox SVG tronque le rendu.
- Regle de prevention: TOUJOURS aligner le `viewBox` SVG sur les dimensions reelles utilisees par le JS. Quand tu modifies la hauteur de rendu dans `renderPnlSparkline()` (`height=42`), verifie que le viewBox dans le template HTML correspond exactement (`viewBox="0 0 180 42"`). Les 3 couches doivent etre coherentes: (1) JS `height`, (2) SVG `viewBox`, (3) CSS `height` sur l'element SVG. En cas de mismatch, c'est le viewBox qui gagne (le plus restrictif) et les points hors viewBox sont silencieusement coupes sans erreur JS.
- Test de non-regression: verifier que `grep 'viewBox' templates/partials/pages/today/widgets/001_kpi_total_pnl.html` contient `"0 0 180 42"` et que `grep 'height =' static/js/split/013_kpis.js` contient `42`. Verifier manuellement que la sparkline affiche tous les points (les pics ne sont pas coupes).
- Fichiers a surveiller: `templates/partials/pages/today/widgets/001_kpi_total_pnl.html` (viewBox SVG), `static/js/split/013_kpis.js` (height du JS), `static/css/split/003_settings_chip_remove_hover.css` (height CSS 42 OK), `static/css/split/038_kpi_upgrade.css` (overflow:visible), `static/css/split/043_dashboard_pnl_motion_fix.css` (overflow+contain).


### BUG-20260430-03 - [RÃ‰SOLU] Deplacer le contexte du jour casse l'autosave si les IDs quittent la modale
- Symptome: en transformant le contexte du jour en widget dashboard, les champs `entryDate`, `entryInstrument`, `htfContext`, `dailyNotes` et `dayForm` ne sont plus dans `#entryModal`, alors que l'autosave et les fonctions de creation de jour les utilisent toujours.
- Cause racine: la logique day context etait couplee a la presence visuelle du formulaire dans la modale (`triggerDayAutosave()` ignorait les changements quand la modale etait fermee, et `saveDayContext()` se basait surtout sur `state.currentDayId`).
- Regle de prevention: quand un formulaire visible est deplace entre surfaces, garder une seule source DOM avec les IDs historiques ou refactorer toutes les fonctions d'acces en helpers explicites. Ne pas laisser un guard visuel (`modal hidden`) bloquer une logique devenue dashboard.
- Test de non-regression: verifier que le HTML rendu ne contient qu'un seul `id="dayForm"`, que `today_context` est dans `templates/partials/pages/today/grid.html`, que `entry_modal.html` n'inclut plus `modal/day_form.html`, puis lancer `python build.py && python -m unittest discover -s tests -v`.
- Fichiers a surveiller: `templates/partials/pages/today/widgets/006_day_context.html`, `templates/partials/pages/today/grid.html`, `templates/partials/overlays/entry_modal.html`, `static/js/split/014_today_page.js`, `static/js/split/018_day_form.js`, `static/js/split/026_autosave_du_jour.js`, `static/js/split/017_modal_gestion_globale.js`.


### BUG-20260430-04 - [RÃ‰SOLU] Clic calendrier: ne pas ouvrir la modale si un jour a deja des trades
- Symptome: le clic sur une case calendrier contenant des trades ouvrait directement la modale de jour ou le picker multi-instruments, alors que l'UX attendue est une revue visuelle inline des trades.
- Cause racine: `bindCalendarGridActions()` ne distinguait que "aucune entree", "une entree" et "plusieurs entrees"; il ne testait pas le nombre total de trades avant d'ouvrir la modale.
- Regle de prevention: pour les interactions calendrier, raisonner sur le nombre total de trades (`sum(day.trades.length)`) avant le nombre d'entrees day. Le cas `tradeCount > 0` doit rester un chemin inline dedie; le cas `tradeCount === 0` garde le flux historique.
- Note UX: les cards de revue ne doivent pas etre collees sous la grille calendrier. Elles doivent rester separees visuellement, en layer centre dans le panel principal, sans backdrop de modale.
- Test de non-regression: verifier dans `static/js/split/015_calendar.js` que `renderJournalDayTrades(key, info.days)` est appele avant `openExistingDay()`/`openPickerForDate()`, puis lancer `python build.py && node --check static/app.js && python -m unittest discover -s tests -v`.
- Fichiers a surveiller: `static/js/split/015_calendar.js`, `static/js/split/056_journal_day_trade_cards.js`, `templates/partials/pages/journal/calendar_focus.html`, `static/css/split/046_journal_day_trade_cards.css`.


### BUG-20260501-01 - [RÃ‰SOLU] leverage jamais persiste en DB (payload.pop detruit la cle)
- Symptome: le champ `leverage` (colonne DB creee par migration v6) reste toujours NULL en base, meme apres creation/mise a jour d'un trade avec un levier.
- Cause racine: `_auto_calc_pnl()` dans `03_core_helpers.py` utilisait `payload.pop("leverage", None)` aux 3 branches (pnl manuel, infos manquantes, calcul auto). `pop()` SUPPRIME la cle du payload, donc l'INSERT/UPDATE SQL ne recoit jamais la valeur. Le calcul utilisait bien le levier (ligne 252, branche calcul auto) mais il etait perdu apres.
- Regle de prevention: TOUJOURS utiliser `payload.get("leverage")` pas `payload.pop("leverage")` dans `_auto_calc_pnl()`. Le pop detruit la donnee. Si tu veux lire sans supprimer, c'est `get()`. Si tu dois pop (par ex. pour eviter de passer un champ calcule a SQL), remets-le dans le payload apres usage.
- Test de non-regression: verifier que `grep -n 'pop.*leverage' app_parts/03_core_helpers.py` retourne 0. Creer un trade avec `leverage=3` via API, lire le trade, verifier que `leverage==3` retourne.
- Fichiers a surveiller: `app_parts/03_core_helpers.py` (fonction `_auto_calc_pnl`), `app_parts/10_routes_trades.py` (routes create/update).


### BUG-20260501-02 - [RÃ‰SOLU] Orphelins dans app_parts/__archive__ jamais nettoies + header.html vide
- Symptome: 18 fichiers orphelins dans `app_parts/__archive__/` (anciennes versions non chargees) + `templates/partials/pages/journal/header.html` vide (1 ligne commentaire) cassant 22 IDs DOM.
- Cause racine: accumulation d'archives sans cleanup. Le header a ete vide pendant un refactoring sans restaurer les IDs (prevMonth, nextMonth, stats, month picker, focus toggle).
- Regle de prevention: apres chaque refactoring, verifier `git ls-files app_parts/__archive__/` = 0. Verifier que les IDs DOM references par les JS existent dans les templates HTML (`rg -rn '#prevMonth\|#nextMonth\|#monthLabel' templates/ --type html`).
- Test de non-regression: `python -m unittest tests.test_template_render -v` (verifie que les templates rendent correctement). Apres build, verifier que les IDs sont presents dans le template rendu.
- Fichiers a surveiller: `app_parts/__archive__/*`, `templates/partials/pages/journal/header.html`, tous les JS qui referencent des IDs de navigation/stats header.


### BUG-20260501-03 - [RÃ‰SOLU] Parametre mort `existing` dans _auto_calc_pnl + catch silencieux state.js
- Symptome: `_auto_calc_pnl()` acceptait `existing=None` mais ne l'utilisait jamais. `19_ai_chat.py` lui passait `existing` pour rien. State.js ligne 79 catch silencieux qui avale les erreurs de listeners.
- Cause racine: accumulation de code mort et de catch aveugles.
- Regle de prevention: apres chaque refactoring, chercher les parametres de fonction inutilises (`grep -rn "def.*existing=None" app_parts/`). Les catch doivent toujours logger (`console.warn` minimum).
|- Test de non-regression: `grep -n 'existing=None' app_parts/03_core_helpers.py` doit retourner 0. `grep 'catch.*{}' static/js/split/000_state.js` ne doit pas exister.
|- Fichiers a surveiller: `app_parts/03_core_helpers.py`, `app_parts/19_ai_chat.py`, `static/js/split/000_state.js`.


### BUG-20260501-04 - [RÃ‰SOLU] Changement de type d'un champ state (tag string â†’ array) sans retrocompat
- Symptome: apres migration `tag` de string vers array, les filtres chargeaient depuis localStorage avec `typeof tag === "string"` et plantaient les fonctions qui attendaient un array.
- Cause racine: le format stocke en localStorage etait `"news_trade"` (string) mais le nouveau code attend `["news_trade"]` (array).
- Regle de prevention: TOUJOURS gerer la retrocompat dans `sanitizeJournalTradeFilters()` quand un champ change de type. Pattern: `if (Array.isArray(raw.tag)) { ... } else if (typeof raw.tag === "string") { out.tag = [raw.tag]; }`.
- Test de non-regression: charger un filtre depuis localStorage avec ancien format string â†’ doit retourner un array.
- Fichiers a surveiller: `static/js/split/003_addcustomstrategyfromsettings.js` (sanitize).


### BUG-20260501-05 - [RÃ‰SOLU] Placeholder invisible quand input a une valeur
- Symptome: le placeholder "2 car. min" ne s'affichait pas quand le champ contenait deja "a" car les placeholders sont caches par la valeur de l'input.
- Cause racine: utilisation d'un `placeholder` au lieu d'un element HTML positionne.
- Regle de prevention: pour afficher un hint en presence d'une valeur, utiliser un `<span>` en absolute overlay, pas le placeholder de l'input. Placer le span en `position: absolute; right: 8px; top: 50%; transform: translateY(-50%); pointer-events: none;` avec `padding-right` sur l'input pour eviter le chevauchement.
- Test de non-regression: saisir "a" â†’ le hint "2 car. min" est visible a droite du "a".
- Fichiers a surveiller: `static/js/split/006_comparetext.js`, `static/css/split/033_priority2_journal_trade.css`.


### BUG-20260501-06 - [RÃ‰SOLU] Template stats jamais rendu â†’ page blanche (doublon BUG-20260501-09 fusionnÃ©)
- Symptome: navigation vers Stats â†’ ecran vide, aucune erreur JS hormis `Cannot set properties of null (setting 'textContent')` sur `#statStreakCur`.
- Cause racine: le contenu de la page Stats etait dans un `<template id="statsTemplate">` mais aucun code JS ne le clonait dans `<section class="page" data-page="stats">`. Les elements attendus par `renderPerformance()` n'existaient pas dans le DOM.
- Regle de prevention: quand un template HTML est utilise pour une page, verifier que le JS appelle `template.content.cloneNode(true)` dans `openPage()` avant tout render. Pattern: `if (section && tmpl && !section._rendered) { section.appendChild(tmpl.content.cloneNode(true)); section._rendered = true; }`.
- Test de non-regression: naviguer vers Stats â†’ le contenu apparait (pas de page blanche).
- Fichiers a surveiller: `static/js/split/009_navigation.js`, `templates/partials/pages/stats.html`.


### BUG-20260501-07 - [RÃ‰SOLU] applyVisualSettings() ne sync pas la checkbox dark mode
- Symptome: toggler le theme depuis le rail (`#themeToggle`) changeait l'apparence mais la checkbox `#prefDarkMode` dans Settings restait sur l'ancienne valeur.
- Cause racine: `applyVisualSettings()` mettait a jour `body.light-mode` mais pas la checkbox.
- Regle de prevention: toute fonction `apply*Settings()` doit sync les controles UI correspondants s'ils existent dans le DOM. Ajouter `var cb = document.getElementById("prefDarkMode"); if (cb) cb.checked = prefersDark;` dans `applyVisualSettings()`.
- Test de non-regression: toggler theme depuis le rail â†’ ouvrir Settings â†’ checkbox en phase.
- Fichiers a surveiller: `static/js/split/002_prettify.js`.


### BUG-20260501-08 - [RÃ‰SOLU] Champs API key en type=text exposÃ© en partage d'ecran
- Symptome: le champ `#settingsApiKeyMasked` etait en `type="text"`, visible en partage d'ecran.
- Cause racine: pas de mesure de securite sur un champ sensible.
- Regle de prevention: toujours utiliser `type="password"` pour les cles API, avec un bouton toggle Å“il pour afficher/masquer. Pattern: `<input type="password">` + bouton `#settingsApiToggle` qui switch entre `type="password"` et `type="text"`.
- Test de non-regression: ouvrir Settings â†’ la cle est masquee (dots).
- Fichiers a surveiller: `templates/partials/pages/settings/api_card.html`, `static/js/split/003_addcustomstrategyfromsettings.js`, `static/css/split/034_priority3_stats_settings_insights.css`.


### ~~BUG-20260501-09~~ [FUSIONNÃ‰ AVEC BUG-20260501-06] Stats page template jamais rendu â†’ page blanche
- Note: Ce bug est un doublon exact de BUG-20260501-06 (mÃªme symptÃ´me, mÃªme cause, mÃªme fix). ConservÃ© pour rÃ©fÃ©rence historique.


### BUG-20260501-10 - [RÃ‰SOLU] Widget drag drop intercepte les clics sur les cellules calendrier
- Symptome: calendrier Today non clickable. Curseur pointer montre bien l'interactivite mais aucun evenement click ne se declenche.
- Cause racine: `initWidgetDragDrop()` dans `047_today_widget_board.js` attache un `pointerdown` sur chaque widget. L'exclusion listait `button` (elements HTML) mais pas `[role="button"]`. Les cellules `.day` sont des `<div role="button">` â†’ le drag les capturait et le click ne passait jamais.
- Regle de prevention: la liste d'exclusion du drag drop doit toujours inclure `[role="button"]` a cote de `button`. Les elements avec `role="button"` sont interactifs et ne doivent pas initier le drag.
- Test de non-regression: cliquer sur une case du calendrier Today â†’ navigation vers le Journal.
- Fichiers a surveiller: `static/js/split/047_today_widget_board.js`.


### BUG-20260501-11 - [RÃ‰SOLU] Autosave day context ecrase les textareas (state.allDays pas patche)
- Symptome: taper un texte dans Analyse HTF â†’ click hors champ â†’ autosave â†’ le texte revient a l'ancienne valeur.
- Cause racine: `saveDayContext()` patchait `state.days` apres sauvegarde mais pas `state.allDays`. `findTodayContextDay()` cherche dans `state.allDays` en priorite â†’ trouvait l'ancienne donnee â†’ `renderTodayContextWidget()` re-ecrivait la textarea.
- Regle de prevention: TOUJOURS patcher les DEUX stores (`state.days` ET `state.allDays`) apres une sauvegarde local. Meme pattern: boucle for identique sur les deux tableaux.
- Test de non-regression: ecrire dans une textarea du contexte jour â†’ focusout â†’ rafraichir â†’ le texte est preserve.
|- Fichiers a surveiller: `static/js/split/018_day_form.js`.


### BUG-20260501-13 - [RÃ‰SOLU] Knowledge cards sauvegardables dans l'UI Insights
- Symptome: les patterns ML etaient calcules a la volee mais on ne pouvait pas les sauvegarder/bookmarker. La table `knowledge_cards` existait sans UI.
- Cause racine: la table knowledge_cards etait creee en migration v4 mais aucune route CRUD ni UI n'y accedait. Les patterns etaient generes a la volee par analyze_patterns() sans persistance.
- Regle de prevention: quand on cree une table en DB, implementer AU MOINS les routes CRUD de base avant de passer a autre chose, meme si l'UI vient plus tard.
- Test de non-regression: cliquer sur l'etoile d'une insight card â†’ recharger la page â†’ l'etoile est encore jaune.
- Changement: routes CRUD POST/GET/DELETE `/api/ml/knowledge`, bouton etoile sur chaque insight card, etat sauvegarde persistant via classe `.is-saved` + API.
- Fichiers a surveiller: `app_parts/21_routes_ml.py`, `static/js/split/049_insights.js`, `static/css/split/031_insights.css`.



### BUG-20260501-12 - [RÃ‰SOLU] Session ajoutee comme etape wizard + champ trade
- Symptome: impossible de selectionner la session de trading par trade (Asia, London, NY AM, NY PM).
- Cause racine: le champ `session` existait en DB sur `days` (par jour) mais pas sur `trades` (par trade). Aucune UI pour le saisir par trade.
- Regle de prevention: quand un champ existe dans un contexte (day) mais est aussi pertinent dans un autre (trade), l'ajouter aux deux schemas et whitelists + UI associee.
- Test de non-regression: creer un trade via wizard â†’ selectionner une session â†’ verifier dans l'editeur XXL que la session est conservee â†’ flip card â†’ session visible.
- Changement: `session` ajoute a `TRADE_TEXT_FIELDS`, migration v8 (`_migrate_v7_to_v8`), etape wizard dediee (entre instrument et strategy), champ select dans l'editeur XXL, affichage dans les flip cards.
- Valeurs session: `asia`, `london`, `ny_am`, `ny_pm`.
- Fichiers a surveiller: `app_parts/00_paths_constants.py`, `app_parts/02_database.py`, `static/js/split/040_wizard_core.js`, `static/js/split/042_wizsetdate.js`, `static/js/split/041_wizskip.js`, `static/js/split/043_wizsetdir.js`, `static/js/split/059_trade_editor_controller.js`, `static/js/split/056_journal_day_trade_cards.js`.


### BUG-20260502-01 - [RÃ‰SOLU] Jour sans trade affiche $0.00 et refuse le clic wizard
- Symptome: un jour qui existe en DB (contexte seul, sans trade) affiche 0,00$ sur la case calendrier. Le clic ouvre openExistingDay() qui recharge le calendrier sans effet visible (pas de flip cards car pas de trades).
- Cause racine: dayCell() affichait le PnL meme pour `info.trades === 0`. Le click handler appelait openExistingDay() / openPickerForDate() quand tradeCount === 0 au lieu d'ouvrir le wizard.
- Regle de prevention: dayCell() doit cacher le metric si `info.trades === 0`. Le click handler doit ouvrir le wizard quand `tradeCount === 0`, pas openExistingDay().
- Test de non-regression: cliquer sur un jour avec entree DB mais 0 trade â†’ le wizard s'ouvre. La case calendrier n'affiche pas 0,00$.
- Changement: dayCell() ligne 313: `if (info)` â†’ `if (info && info.trades > 0)`. Click handler: affiche renderJournalDayContext() (carte contexte + bouton Nouveau trade) au lieu d'ouvrir directement le wizard. Nouvelle fonction renderJournalDayContext() dans 015_calendar.js + CSS dans 046_journal_day_trade_cards.css.
- Fichiers a surveiller: `static/js/split/015_calendar.js` (dayCell + bindCalendarGridActions + renderJournalDayContext), `static/css/split/046_journal_day_trade_cards.css` (.journal-day-context-empty).


### BUG-20260502-02 - [RÃ‰SOLU] PnL=0 ecrase par _auto_calc_pnl (impossible d'avoir un trade break-even)
- Symptome: un trade avec PnL=0 explicite (break-even) voit son PnL recalculÃ© par _auto_calc_pnl() a partir d'entry/exit/size, effaÃ§ant le 0 intentionnel.
- Cause racine: la condition `pnl is not None and pnl != 0` ne distinguait pas "pnl non fourni" (None) de "pnl=0 explicite".
- Regle de prevention: toujours verifier la presence de la cle dans le dictionnaire avec `"pnl" in payload` plutot que de tester la valeur. Les payloads sans `pnl` n'ont pas la cle; les payloads avec pnl=0 ont la cle.
- Test de non-regression: envoyer un trade avec `pnl=0` + entry/exit/size â†’ le PnL reste 0 (pas recalculÃ©). Envoyer un trade sans `pnl` â†’ le PnL est calculÃ© a partir d'entry/exit/size.
- Changement: `if pnl is not None and pnl != 0` â†’ `if "pnl" in payload` dans _auto_calc_pnl().
- Fichiers a surveiller: `app_parts/03_core_helpers.py` (fonction _auto_calc_pnl).


### BUG-20260502-03 - [RÃ‰SOLU] Ligne morte `payload.get("leverage")` dans _auto_calc_pnl()
- Symptome: une ligne `payload.get("leverage")` est appelÃ©e sans assignation ni usage, rÃ©sultat ignorÃ©.
- Cause racine: code mort residuel d'un refactoring, probablement un oubli ou un copier-coller.
- Regle de prevention: apres chaque refactoring, chercher les appels de fonction dont le retour n'est pas utilisÃ© et qui n'ont pas d'effet de bord. `grep -rn '\.get.*$' app_parts/ | grep -v '='` peut aider.
- Test de non-regression: lancer les tests existants â€” la ligne supprimÃ©e etait sans effet.
- Changement: suppression de la ligne `payload.get("leverage")` dans le bloc de retour anticipÃ©.
- Fichiers a surveiller: `app_parts/03_core_helpers.py` (fonction _auto_calc_pnl).


### BUG-20260502-04 - [RÃ‰SOLU] loadAllDays() et loadStats() avalent les erreurs sans feedback
- Symptome: les KPIs du dashboard affichent des zeros sans indication que les donnees n'ont pas pu etre chargees. L'utilisateur voit des stats a zero sans comprendre pourquoi.
- Cause racine: les catch de loadAllDays() et loadStats() utilisaient `console.error(e)` sans toast ni feedback utilisateur.
- Regle de prevention: toute erreur de chargement de donnees (API call) doit avoir un toast utilisateur. `console.error` seul est insuffisant. `loadMonth()` faisait deja un toast â€” les deux autres doivent faire pareil.
- Test de non-regression: simuler une erreur reseau â†’ toast visible.
- Changement: `catch (e) { console.error(e); }` â†’ `catch (e) { toast(e.message || "...", "error"); }` dans loadAllDays() et loadStats().
- Fichiers a surveiller: `static/js/split/012_data_loading.js`.


### BUG-20260502-05 - [RÃ‰SOLU] Race condition dans loadSettingsState() (fetch async ecrase les modifs)
- Symptome: si l'utilisateur modifie un setting avant que le fetch backend de loadSettingsState() ne resolve, sa modification est perdue car le callback du fetch ecrase state.settings.
- Cause racine: fetch async /api/user/settings resolvait apres le retour de loadSettingsState(). Le callback .then() ecrasait state.settings sans verifier si l'utilisateur avait modifie entre temps.
- Regle de prevention: dans un pattern "fast localStorage puis async fetch", prendre un snapshot JSON.stringify(state.settings) avant le fetch, et dans le callback, verifier que le snapshot n'a pas change avant d'ecraser.
- Test de non-regression: modifier un setting â†’ le fetch resolvant apres ne doit pas annuler la modification.
- Changement: snapshot JSON.stringify() avant fetch, guard `if (JSON.stringify(state.settings) !== localSnapshot) return;` dans le callback.
- Fichiers a surveiller: `static/js/split/002_prettify.js` (loadSettingsState).


### BUG-20260502-06 - [RÃ‰SOLU] Double definition de _applyJournalFilter() (code mort)
- Symptome: la fonction _applyJournalFilter() est definie dans 004_loadjournaltablesort.js ET 054_journal_filter_picker_override.js. La premiere est ecrasee par la seconde (054 charge apres 004 dans le bundle).
- Cause racine: le fichier 004_loadjournaltablesort.js contenait une copie legacy de _applyJournalFilter() qui n'etait jamais appelee (tous les appels sont dans 054).
- Regle de prevention: avant d'ajouter une fonction avec le meme nom, verifier si elle existe deja dans un fichier charge plus tot. Utiliser `grep -rn 'function _apply' static/js/split/` pour detecter les doublons.
- Test de non-regression: les filtres journal (date/instrument) fonctionnent toujours.
- Changement: suppression de la definition morte dans 004_loadjournaltablesort.js.
- Fichiers a surveiller: `static/js/split/004_loadjournaltablesort.js`, `static/js/split/054_journal_filter_picker_override.js`.


### BUG-20260502-07 - [RÃ‰SOLU] Month picker popover jamais binde a cause d'un return precoce
- Symptome: le popover #calendarMonthPicker avec selection graphique des mois ne fonctionne pas. Clic sur #monthLabel (le nom du mois) ne fait rien.
- Cause racine: bindCalendarMonthPicker() avait un guard `if (monthInput) return;` qui sortait immediatement parce que #journalMonthInput existe dans le header. De plus, le trigger etait `#monthLabelBtn` qui n'existe pas dans le template (le bon trigger est `#monthLabel`).
- Regle de prevention: ne pas blocker un composant UI parce qu'un autre existe. Les deux peuvent coexister (input month natif + popover graphique). Verifier que les IDs references dans le JS existent dans les templates HTML.
- Test de non-regression: cliquer sur #monthLabel â†’ le popover s'ouvre avec selection de mois et navigation d'annee.
- Changement: suppression du guard `if (monthInput) return;`, trigger change de `#monthLabelBtn` a `#monthLabel`.
- Fichiers a surveiller: `static/js/split/011_calendar_nav.js` (bindCalendarMonthPicker), `templates/partials/pages/journal/header.html` (#calendarMonthPicker, #monthLabel, #monthPopover).


### BUG-20260502-08 - [RÃ‰SOLU] PriceLine du chart pas mise a jour par WebSocket
- Symptome: la ligne pointillee verte du dernier prix reste figee au dernier fetch periodique (15-60s). Quand le prix monte puis descend, on voit brievement une double ligne (verte figee + rouge par defaut).
- Cause racine: le WebSocket ne mettait jamais a jour `countdownPriceLine.applyOptions({ price: candle.close })`. La priceLine restait au prix du dernier `_fetchAndRender()`. De plus, `priceLineVisible: true` (defaut de Lightweight Charts) ajoutait sa propre ligne qui change de couleur.
- Regle de prevention: toujours mettre a jour la priceLine custom DANS le handler WebSocket, pas seulement dans le fetch periodique. Ajouter `priceLineVisible: false` sur la serie candlestick pour eviter la double ligne.
- Test de non-regression: le WebSocket pousse des mises a jour â†’ la priceLine bouge en temps reel. Pas de double ligne.
- Changement: `series.createPriceLine({ price: candle.close })` dans ws.onmessage + `priceLineVisible: false` sur les deux series (widget + chart XXL).
- Fichiers a surveiller: `static/js/split/060_btc_chart_widget.js` (ws.onmessage + createChart), `static/js/split/062_chart_page.js` (idem).


### BUG-20260502-09 - [RÃ‰SOLU] Countdown `_fetchAndRender()` sans keepZoom resetait le zoom
- Symptome: a l'ouverture d'une nouvelle bougie (timer a 0:00), le zoom utilisateur etait perdu.
- Cause racine: `_fetchAndRender()` appele sans argument â†’ keepZoom = undefined â†’ `chart.timeScale().fitContent()` resetait le zoom.
- Regle de prevention: tout auto-refresh (countdown, periodic, WebSocket k.x) doit passer `_fetchAndRender(true)`. Seuls les changements manuels (timeframe, symbole) appellent sans keepZoom.
- Test de non-regression: zoomer sur le chart â†’ attendre l'ouverture d'une bougie â†’ le zoom est preserve.
- Changement: `_fetchAndRender(true)` dans le countdown du widget BTC (le chart XXL etait deja correct).
- Fichiers a surveiller: `static/js/split/060_btc_chart_widget.js` (fonction tick dans _startCountdown).


### BUG-20260502-10 - [RÃ‰SOLU] Fonctions favoris/dupliquer definies dans le mauvais scope
- Symptome: ReferenceError: _toggleTradeFavorite is not defined au clic sur le coeur.
- Cause racine: les fonctions ont ete inserees AVANT la fermeture de `journalTradeFlipCardHtml()` rendant leur scope local a la fonction. Inaccessible depuis le click handler.
- Regle de prevention: quand on ajoute des fonctions a la fin d'un fichier JS, verifier qu'elles sont apres le dernier `}` de la fonction precedente, pas dedans. Toujours verifier le scope dans le bundle build (app.js).
- Test de non-regression: clic sur coeur â†’ API PUT /api/trades/:id avec tags ['favoris'] â†’ coeur se remplit.
- Changement: deplacement des deux fonctions apres le `}` fermant de `journalTradeFlipCardHtml()`.
- Fichiers a surveiller: `static/js/split/056_journal_day_trade_cards.js` (fin du fichier).


## 9) Lessons apprises et bugs a ne pas reproduire
### BUG-20260503-01 - [RÃ‰SOLU] Carte contexte HTF avec wizard fluide

- Symptome: Clic sur jour sans trade â†’ la wizard s'ouvrait direct ou une carte moche apparaissait.
- Cause racine: `renderJournalDayContext()` avait un HTML basique et etait supprime/restaure.
- Regle de prevention: Un jour sans trade affiche une carte style journal (classes `journal-flip-*`) avec les donnees HTF (bias, notes, instrument) et un bouton "+ Creer un trade". La wizard s'ouvre avec `contextCard: true` pour s'aligner pres de la carte (taille reduite a 480px, position fluide).
- Test de non-regression: Cliquer sur le 1er mai (jour avec contexte, sans trade) â†’ carte HTF avec infos. Cliquer "+ Creer un trade" â†’ wizard positionnee a cote de la carte.
- Fichiers a surveiller: `static/js/split/015_calendar.js` (renderJournalDayContext), `static/js/split/040_wizard_core.js` (wizOpen contextCard), `static/css/split/022a_wizard_backdrop.css` (.wiz-context-card).


### BUG-20260504-01 - [RÃ‰SOLU] UX bugs #23-#45 : 23 correctifs UX, accessibilite, performance

- Symptome: Nombreux composants sans etat vide, accessibilite absente (pas d'aria-label, tooltips title inaccessibles mobile), input month deforme sur Firefox/Safari, table journal freeze avec >100 trades, settings ordre illogique, cle API non editable dans l'UI.
- Cause racine: Approche feature-first sans revue UX systematique ni test cross-browser. Accumulation de patterns "on verra plus tard" pour les placeholders, l'accessibilite et le lazy loading.
- Regle de prevention: Chaque nouveau composant doit avoir: 1) etat vide explicite, 2) aria-label sur elements visuels, 3) test quick cross-browser (Chrome + Firefox), 4) lazy loading si affichage de listes >100 items. Les settings cards suivent l'ordre logique: Profilâ†’Prefsâ†’Strategiesâ†’Tagsâ†’API (technique en dernier).
- Test de non-regression: Table journal >100 trades â†’ scroll infini charge par 100. Input month â†’ meme rendu Chrome/Firefox. Settings â†’ card Donnees affiche path/taille DB. API key â†’ bouton Modifier â†’ saisie â†’ Enregistrer â†’ POST /api/settings/key.
- Fichiers a surveiller: `static/js/split/006_comparetext.js` (lazy load IntersectionObserver), `static/js/split/013_kpis.js` (ARIA progressbar), `static/js/split/015_calendar.js` (search empty msg), `static/js/split/028_global_keys.js` (shortcuts / et F), `static/js/split/032_breakdowns.js` (sort badge), `static/js/split/047_today_widget_board.js` (confirm reset), `static/js/split/049_insights.js` (debounce + aria-label), `static/css/split/005_journal_toolbar_filters.css` (input month cross-browser), `templates/partials/pages/settings.html` (ordre), `templates/partials/pages/settings/data_card.html` (nouveau), `app_parts/07_routes_pages.py` (POST /api/settings/key), `app_parts/16_export.py` (GET /api/db/info).


### BUG-20260504-02 - [RÃ‰SOLU] Knowledge cards unsave en 2 appels + pas de cache
- Symptome: Unsave d'une knowledge card nÃ©cessitait un GET (liste) puis un DELETE (par ID) â†’ 2 appels rÃ©seau. `_markSavedCards()` fetchait l'API Ã  chaque render Insights.
- Cause racine: `toggleSave()` faisait un GET pour trouver l'ID de la card, puis un DELETE par ID. `_markSavedCards()` n'avait pas de cache.
- Regle de prevention: Utiliser un DELETE par kind+title (query params) pour unsave en 1 appel. Ajouter un cache in-memory (`_savedCardCache`) pour `_markSavedCards`, invalider aprÃ¨s chaque save/unsave.
- Test de non-regression: Cliquer sur l'Ã©toile d'une insight card â†’ elle se remplit (save) ou se vide (unsave) sans erreur rÃ©seau. Recharger la page â†’ les Ã©toiles remplies sont toujours remplies.
- Changement: Nouvelle route `DELETE /api/ml/knowledge?kind=X&title=Y` dans `21_routes_ml.py`. Refacto de `toggleSave()` et `_markSavedCards()` dans `049_insights.js`.
- Fichiers a surveiller: `app_parts/21_routes_ml.py`, `static/js/split/049_insights.js`.


### BUG-20260504-03 - [RÃ‰SOLU] Settings : pas de Danger Zone pour les actions destructrices
- Symptome: Aucune section visuellement distincte pour le reset de donnees. Les actions destructrices n'existaient pas dans l'UI.
- Cause racine: Pas de backend de reset, pas de template, pas de CSS.
- Regle de prevention: Toute action destructive doit avoir: 1) backend avec backup automatique, 2) double confirmation utilisateur, 3) zone rouge visuellement separee, 4) rate limiting.
- Test de non-regression: POST /api/data/reset avec confirm=RESET ALL DATA â†’ 200 + backup cree. Sans confirmation â†’ 400.
- Changement: Nouvelle route POST /api/data/reset avec backup automatique (17_reset.py). Template danger_card.html avec bouton btn-danger rouge. CSS danger zone avec bordures rouges. JS: double confirm() avant appel API.
- Fichiers a surveiller: `app_parts/17_reset.py`, `app_parts/__init__.py`, `templates/partials/pages/settings/danger_card.html`, `templates/partials/pages/settings.html`, `static/js/split/003_addcustomstrategyfromsettings.js`, `static/css/split/034_priority3_stats_settings_insights.css`.


### BUG-20260504-04 - [RÃ‰SOLU] Stats fusionnees dans la page Insights
- Symptome: La page Stats etait separee d'Insights, avec un design different.
- Cause racine: Separation artificielle Stats vs Insights.
- Regle de prevention: Les donnees de performance doivent apparaitre dans Insights.
- Test de non-regression: Naviguer vers Insights â†’ breakdowns et period compare s'affichent.
- Changement: Suppression complete de la page Stats (template, rail, navigation, raccourci S, commande palette). Contenu Stats deplace dans Insights. Filtres Insights synchronises avec localStorage et heritage de la periode du journal.
- Fichiers a surveiller: `templates/index.html`, `templates/partials/layout/rail.html`, `templates/partials/pages/stats/*` (supprimes), `templates/partials/pages/insights.html`, `static/js/split/009_navigation.js`, `static/js/split/028_global_keys.js`, `static/js/split/029_command_palette.js`, `static/js/split/008_boot.js`, `static/js/split/049_insights.js`, `static/js/split/002_prettify.js`, `static/js/split/003_addcustomstrategyfromsettings.js`, `static/js/split/007_loadcalendarmonthfocusmode.js`, `static/js/split/012_data_loading.js`.



### BUG-20260503-02 - [RÃ‰SOLU] hidden + style=display:none doublon â†’ masquage cassÃ©
- Symptome: des elements ont `class="hidden"` ET `style="display:none"` dans le template. Le JS retire la classe via `classList.toggle()` mais pas le style inline â†’ l'element reste invisible.
- Cause racine: accumulation de deux mÃ©canismes de masquage (classe CSS + inline style) sans coordination. Le JS ne gÃ©rait que la classe.
- Regle de prevention: UN SEUL mÃ©canisme de masquage par element. Si le template a `class="hidden"`, pas de `style="display:none"` en plus. Le JS pilote l'Ã©tat via la classe uniquement (ou le style uniquement, pas les deux).
- Test de non-regression: `grep -r 'style=["\x27]*display\s*:\s*none' templates/` + vÃ©rifier que le toggle JS fonctionne pour chaque element concernÃ©.
- Fichiers a surveiller: `templates/partials/overlays/*.html`, templates avec `hidden` + `style="display:none"`.

### BUG-20260503-03 - [RÃ‰SOLU] Ã‰tat vide contexte jour sans trade
- Symptome: un jour avec entree DB (contexte, notes) mais 0 trade affichait un message basique ou rien. La carte contexte n'avait pas d'Ã©tat intermÃ©diaire.
- Cause racine: `renderJournalDayContext()` n'avait pas de design dÃ©diÃ© pour "contexte prÃ©sent, zÃ©ro trade".
- Regle de prevention: tout widget/composant doit avoir 3 Ã©tats: loading (`...`), vide (`â€”`), et valeur rÃ©elle. Le contexte jour sans trade affiche une carte avec les infos HTF (bias, notes, instrument) + bouton "+ CrÃ©er un trade".
- Test de non-regression: cliquer sur un jour avec contexte mais sans trade â†’ carte informative visible.
- Fichiers a surveiller: `static/js/split/015_calendar.js`, `static/css/split/046_journal_day_trade_cards.css`.

### BUG-20260503-04 - [RÃ‰SOLU] Popover sÃ©lecteur mois et input natif en conflit
- Symptome: deux mÃ©canismes de navigation mensuelle coexistaient â€” l'input natif `<input type="month">` ET un popover de sÃ©lection graphique. Le popover Ã©tait bloquÃ© par un guard `if (monthInput) return;`.
- Cause racine: le popover avait Ã©tÃ© ajoutÃ© comme amÃ©lioration sans supprimer l'input natif. Le guard empÃªchait le popover de s'initialiser.
- Regle de prevention: quand on ajoute un mÃ©canisme alternatif, supprimer l'ancien OU s'assurer qu'il n'y a pas de guard bloquant. Un seul systÃ¨me de navigation par composant.
- Test de non-regression: le header journal a un seul Ã©lÃ©ment cliquable pour la navigation mois. Cliquer â†’ le popover/input s'ouvre.
- Fichiers a surveiller: `templates/partials/pages/journal/header.html`, `static/js/split/011_calendar_nav.js`.

### BUG-20260503-05 - [RÃ‰SOLU] Accents UI corrompus dans Stats
- Symptome: les labels des breakdowns (stratÃ©gie, instrument) avaient des accents affichÃ©s comme caractÃ¨res brisÃ©s (`ÃƒÂ©` au lieu de `Ã©`).
- Cause racine: caractÃ¨res UTF-8 non encodÃ©s en HTML entities dans les templates ou le JS, ou conversion d'encodage incorrecte.
- Regle de prevention: utiliser les HTML entities (`&eacute;` pour Ã©, `&egrave;` pour Ã¨, `&rsquo;` pour apostrophe) dans les templates HTML. VÃ©rifier avec le scan encodage section 3.4.
- Test de non-regression: `rg '\xC3' static/app.js | head -5` â†’ doit retourner 0 (pas d'octets UTF-8 bruts non ASCII dans le bundle).
- Fichiers a surveiller: templates HTML, `static/js/split/032_breakdowns.js`, tout fichier avec texte accentuÃ©.

### BUG-20260503-06 - [RÃ‰SOLU] KPI streak counter sans animation
- Symptome: le compteur de streak (sÃ©rie de trades gagnants) passait instantanÃ©ment de l'ancienne valeur Ã  la nouvelle sans transition visuelle.
- Cause racine: `textContent = value` direct, pas de boucle d'animation.
- Regle de prevention: tout KPI numÃ©rique doit animer de la valeur prÃ©cÃ©dente vers la nouvelle via `requestAnimationFrame`. Fonction gÃ©nÃ©rique `_animateCounter(el, target, suffix, opts)` avec durÃ©e proportionnelle Ã  l'Ã©cart (200-600ms).
- Test de non-regression: changer de pÃ©riode â†’ les KPIs numÃ©riques dÃ©filent (comptent) de l'ancienne Ã  la nouvelle valeur.
- Fichiers a surveiller: `static/js/split/013_kpis.js`, `static/js/split/049_insights.js`.

### BUG-20260503-07 - [RÃ‰SOLU] #btcChartPrice manquant dans le template
- Symptome: `document.getElementById("btcChartPrice")` retournait systÃ©matiquement null. Le code avait un `if (el)` guard silencieux â†’ la fonctionnalitÃ© (affichage du prix en haut du widget BTC) Ã©tait morte sans erreur visible.
- Cause racine: l'element `<span id="btcChartPrice">` n'existait pas dans le template HTML du widget BTC. AjoutÃ© dans le JS uniquement mais jamais dans le template.
- Regle de prevention: quand un `getElementById()` est systÃ©matiquement dans un `if (el)` guard sans jamais s'exÃ©cuter, VÃ‰RIFIER que l'Ã©lÃ©ment existe dans le template HTML â€” c'est un pattern de bug silencieux. Chercher dans les templates, pas dans le JS.
- Test de non-regression: `grep 'btcChartPrice' templates/partials/pages/today/widgets/` â†’ doit retourner au moins une occurrence dans un fichier .html.
- Fichiers a surveiller: `templates/partials/pages/today/widgets/011_btc_chart.html`, `static/js/split/060_btc_chart_widget.js`.

### BUG-20260503-08 - [RÃ‰SOLU] Stats overflow ellipsis cassÃ©
- Symptome: les labels longs dans les breakdowns Stats/Insights (noms de stratÃ©gies, instruments) dÃ©passaient de leur conteneur sans ellipsis.
- Cause racine: `text-overflow: ellipsis` appliquÃ© mais sans `overflow: hidden` + `white-space: nowrap` sur les elements concernÃ©s.
- Regle de prevention: `text-overflow: ellipsis` nÃ©cessite TOUJOURS les trois propriÃ©tÃ©s: `overflow: hidden; white-space: nowrap; text-overflow: ellipsis;`.
- Test de non-regression: un nom de stratÃ©gie long (>20 car) dans les breakdowns â†’ tronquÃ© avec `...`.
- Fichiers a surveiller: `static/css/split/031_insights.css`, `static/css/split/032_breakdowns.css`.

### BUG-20260503-09 - [RÃ‰SOLU] URL API key hardcodÃ©e au lieu d'env var
- Symptome: l'URL de l'API LLM (DeepSeek) Ã©tait hardcodÃ©e dans le code JS/frontend au lieu d'Ãªtre fournie via variable d'environnement backend.
- Cause racine: pas de mÃ©canisme de configuration par env var pour l'URL de l'API.
- Regle de prevention: toute URL de service externe (API LLM, Binance, WebSocket) doit Ãªtre configurable via backend (env var â†’ `/api/config`), pas hardcodÃ©e dans le JS. Le JS lit `state.config.apiUrl`.
- Test de non-regression: `grep -rn 'https\?://api\.deepseek' static/js/split/` â†’ 0 rÃ©sultats (l'URL vient de state.config via backend).
- Fichiers a surveiller: `app_parts/00_paths_constants.py` (env vars), `static/js/split/` (rÃ©fÃ©rences URL API).

### BUG-20260505-01 - [RÃ‰SOLU] KPIs Dashboard non filtrÃ©s par pÃ©riode Journal
- Symptome: les KPIs du Dashboard (Net P&L, Winrate, RR, Trades) affichaient des donnÃ©es all-time au lieu de la pÃ©riode sÃ©lectionnÃ©e dans le Journal (mois/trimestre/custom).
- Cause racine: `getTradesForCurrentFilter()` ne filtrait pas les trades. Utilisait `state.allDays` directement sans appliquer `journalRangeMode`, `currentMonth`, ou `journalCustomFrom/To`.
- Regle de prevention: toute fonction qui alimente les KPIs doit filtrer par la pÃ©riode Journal courante. `getTradesForCurrentFilter()` est LA fonction canonique â€” utiliser `monthRange()`, `quarterRange()` ou `journalCustomFrom/To` selon `journalRangeMode`.
- Test de non-regression: Dashboard affiche mois en cours â†’ cliquer sur un mois diffÃ©rent dans le Journal â†’ Dashboard reflÃ¨te le nouveau mois.
- Fichiers a surveiller: `static/js/split/013_kpis.js` (getTradesForCurrentFilter), `static/js/split/012_data_loading.js` (loadStats refreshDays).

### BUG-20260505-02 - [RÃ‰SOLU] fetch() sans r.ok guard â†’ SyntaxError silencieux
- Symptome: quand le serveur Flask retourne une page HTML 500, `r.json()` lÃ¨ve une `SyntaxError` non catchÃ©e â†’ la chaÃ®ne de promesse reste pendante, l'utilisateur ne voit rien.
- Cause racine: pattern `fetch(url).then(r => r.json())` sans vÃ©rifier `r.ok`. Sur HTTP 500, Flask renvoie HTML, pas JSON.
- Regle de prevention: TOUT appel `fetch()` qui appelle `.json()` doit d'abord vÃ©rifier `res.ok`. Pattern: `.then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })`. Utiliser la fonction helper `api()` de `001_utilities.js` quand possible.
- Test de non-regression: `grep -rn 'fetch.*\.json' static/app.js` â†’ chaque occurrence doit avoir un `r.ok` ou `res.ok` guard dans la mÃªme fonction ou avant.
- Fichiers a surveiller: `static/js/split/001_utilities.js` (api helper), tous les fichiers split avec fetch().

### BUG-20260505-03 - [RÃ‰SOLU] state.allDays jamais invalidÃ© aprÃ¨s Ã©dition de trade
- Symptome: aprÃ¨s Ã©dition d'un trade via flip card, les KPIs du Dashboard restaient sur les donnÃ©es du boot (state.allDays pas rechargÃ©). Il fallait un refresh manuel.
- Cause racine: `_journalRefreshStateDebounced()` appelait `loadStats({ refreshDays: false })` qui ne recharge PAS `state.allDays`. Ensuite `loadStats()` utilisait l'ancien state pour calculer les KPIs.
- Regle de prevention: `refreshDays: true` doit Ãªtre passÃ© Ã  `loadStats()` aprÃ¨s toute modification de trade. `_journalRefreshStateDebounced()` doit toujours utiliser `refreshDays: true`. AprÃ¨s save, state.allDays est re-fetchÃ© via `loadAllDays()`.
- Test de non-regression: Ã©diter un trade â†’ les KPIs Dashboard se mettent Ã  jour sans refresh manuel.
- Fichiers a surveiller: `static/js/split/012_data_loading.js`, `static/js/split/056_journal_day_trade_cards.js` (_journalRefreshStateDebounced).

### BUG-20260505-04 - [RÃ‰SOLU] _waitForContainer : setTimeout fixe â†’ polling DOM
- Symptome: 3 widgets (BTC chart, Chart XXL, Favoris Carousel) utilisaient `setTimeout(init, 300/400/500)` avec des dÃ©lais arbitraires. Parfois le DOM n'Ã©tait pas prÃªt, parfois le dÃ©lai Ã©tait trop long.
- Cause racine: `setTimeout` fixe qui ne s'adapte pas Ã  l'Ã©tat rÃ©el du DOM.
- Regle de prevention: utiliser `_waitForContainer(callback, 20, 50)` (polling 50ms Ã— 20 = 1s max) pour toute initialisation diffÃ©rÃ©e de widget. Pas de `setTimeout` fixe. Le polling s'exÃ©cute dÃ¨s que le DOM est prÃªt et abandonne aprÃ¨s 1s avec un `console.warn`.
- Test de non-regression: les 3 widgets s'initialisent correctement aprÃ¨s un rebuild + refresh navigateur.
- Fichiers a surveiller: `static/js/split/060_btc_chart_widget.js`, `static/js/split/062_chart_page.js`, `static/js/split/063_favorites_carousel.js`.

### BUG-20260505-05 - [RÃ‰SOLU] Sauvegarde Settings sans feedback utilisateur
- Symptome: cliquer sur "Enregistrer" dans Settings â†’ rien ne se passe visuellement pendant 0-300ms. L'utilisateur ne sait pas si la sauvegarde a eu lieu.
- Cause racine: les boutons save n'Ã©taient pas dÃ©sactivÃ©s pendant l'appel API et leur texte ne changeait pas.
- Regle de prevention: tout bouton dÃ©clenchant une opÃ©ration asynchrone doit: 1) se dÃ©sactiver immÃ©diatement, 2) changer son texte pour indiquer l'action en cours, 3) se rÃ©activer Ã  la fin (ou aprÃ¨s 1.5s minimum).
- Test de non-regression: cliquer "Enregistrer" â†’ le bouton devient gris avec texte "Sauvegarde..." â†’ redevient "Enregistrer" Ã  la fin.
- Fichiers a surveiller: `static/js/split/003_addcustomstrategyfromsettings.js`, `static/js/split/002_prettify.js`.

### BUG-20260505-06 - [RÃ‰SOLU] Navigation page non persistÃ©e entre sessions
- Symptome: aprÃ¨s un refresh navigateur, l'utilisateur revenait toujours sur la page Dashboard (page par dÃ©faut) mÃªme s'il Ã©tait sur Insights ou Settings.
- Cause racine: `state.currentPage` Ã©tait initialisÃ© Ã  la valeur par dÃ©faut sans lire `localStorage("lastPage")`.
- Regle de prevention: au boot, lire `localStorage("lastPage")` et restaurer la page. Dans `goPage()`, sauvegarder la page courante dans localStorage. Pattern: `state.currentPage = localStorage.getItem("lastPage") || "today";`.
- Test de non-regression: naviguer vers Insights â†’ refresh â†’ la page Insights s'affiche.
- Fichiers a surveiller: `static/js/split/008_boot.js`, `static/js/split/009_navigation.js`.

### BUG-20260505-07 - [RÃ‰SOLU] Sparkline PnL sans ligne zÃ©ro ni dates
- Symptome: la sparkline du widget Net P&L Dashboard n'avait ni ligne horizontale zÃ©ro (repÃ¨re visuel) ni labels de dates (contexte temporel). Le graphique Ã©tait flottant.
- Cause racine: le SVG ne dessinait que le polyline des PnL, sans axe ni repÃ¨re.
- Regle de prevention: toute sparkline doit avoir: 1) une ligne zÃ©ro horizontale (tiretÃ©, position dynamique selon min/max), 2) trois labels de dates (premiÃ¨re, milieu, derniÃ¨re des 30 pÃ©riodes), 3) la ligne zÃ©ro positionnÃ©e en absolu dans le viewBox.
- Test de non-regression: la sparkline affiche une ligne horizontale pointillÃ©e au niveau zÃ©ro (mÃªme si la courbe est tout positive ou nÃ©gative) et 3 dates espacÃ©es.
- Fichiers a surveiller: `static/js/split/013_kpis.js` (renderPnlSparkline), `static/css/split/038_kpi_upgrade.css`.

### BUG-20260505-08 - [RÃ‰SOLU] Settings hiÃ©rarchie hero/featured dÃ©sordonnÃ©e
- Symptome: les cards Settings n'avaient pas d'ordre logique. Les actions destructrices (Danger Zone) Ã©taient mÃ©langÃ©es avec les rÃ©glages quotidiens.
- Cause racine: ajout de cards dans l'ordre chronologique des features, sans architecture de page.
- Regle de prevention: les Settings suivent une hiÃ©rarchie claire: Profil (hero, full width) â†’ PrÃ©fÃ©rences â†’ StratÃ©gies â†’ Tags â†’ DonnÃ©es â†’ API Key (featured, full width) â†’ Danger Zone (full, bordure rouge). Les cards hero/featured sont pleine largeur, les autres en grille 2 colonnes.
- Test de non-regression: la page Settings affiche les cards dans l'ordre ci-dessus, sans trou ni dÃ©sordre.
- Fichiers a surveiller: `templates/partials/pages/settings.html`, templates des cards individuelles.

### BUG-20260505-09 - [RÃ‰SOLU] Strategy/Tag chips non rÃ©ordonnables (drag & drop)
- Symptome: impossible de changer l'ordre des stratÃ©gies ou tags dans Settings. L'ordre Ã©tait celui de la crÃ©ation ou alphabÃ©tique.
- Cause racine: les chips Ã©taient des `<span>` statiques sans attribut `draggable="true"` ni handlers drag/drop.
- Regle de prevention: toute liste ordonnÃ©e de chips (stratÃ©gies, tags, instruments) doit supporter le drag & drop natif HTML5. Chaque chip a `draggable="true"` et `data-reorder-value`. Le drop rÃ©ordonne le tableau et persiste sur le backend.
- Test de non-regression: glisser une stratÃ©gie du milieu vers le haut â†’ l'ordre est mis Ã  jour et persiste aprÃ¨s refresh.
- Fichiers a surveiller: `static/js/split/003_addcustomstrategyfromsettings.js`, `static/css/split/003_settings_chip_remove_hover.css`.

### BUG-20260505-10 - [RÃ‰SOLU] Journal Night Mode â˜¾ absent
- Symptome: le Journal n'avait pas de mode nuit pour le trading en soirÃ©e. L'interface Ã©tait trop lumineuse.
- Cause racine: pas de toggle ni de classe CSS pour un mode nuit spÃ©cifique au Journal.
- Regle de prevention: proposer un mode nuit par page (icon moon/sun) avec Ã©tat persistÃ© dans localStorage. Le mode nuit rÃ©duit le contraste, rÃ©chauffe les couleurs, et assombrit le calendrier. Pattern localStorage-driven: `localStorage.getItem("journalNightMode")`.
- Test de non-regression: cliquer sur l'icone â˜¾ â†’ le Journal passe en tons chauds tamisÃ©s. Refresh â†’ l'Ã©tat est conservÃ©.
- Fichiers a surveiller: `templates/partials/pages/journal/header.html` (bouton â˜¾), `static/js/split/004_loadjournaltablesort.js` (toggle), `static/css/split/046_journal_day_trade_cards.css`.

### BUG-20260505-11 - [RÃ‰SOLU] KPIs placeholders "0.00$" au lieu de "â€”"
- Symptome: au chargement initial, les KPIs affichaient `+0.00$` au lieu de `â€”`. L'utilisateur croyait voir des donnÃ©es rÃ©elles (zÃ©ro) alors que rien n'Ã©tait chargÃ©.
- Cause racine: les templates avaient `0.00$` comme valeur initiale. `fmtMoney(val || 0)` transformait null/undefined en `0.00$`.
- Regle de prevention: les templates doivent avoir `â€”` (&mdash;) comme valeur initiale pour tout KPI. `fmtMoney()` ne doit JAMAIS recevoir `|| 0` â€” utiliser `val != null ? fmtMoney(val) : "â€”"`. Les trois Ã©tats doivent Ãªtre: loading=`...`, vide=`â€”`, valeur rÃ©elle=fmtMoney(val).
- Test de non-regression: au premier chargement, tous les KPIs Dashboard affichent `â€”` (pas `0.00$`). AprÃ¨s chargement des donnÃ©es, ils affichent les vraies valeurs.
- Fichiers a surveiller: tous les templates HTML de widgets KPIs, `static/js/split/013_kpis.js`.

### BUG-20260505-12 - [RÃ‰SOLU] Delta â–²/â–¼ indicateurs KPIs absents
- Symptome: les KPIs du Dashboard (Net P&L, Winrate, etc.) n'indiquaient pas la variation par rapport Ã  la pÃ©riode prÃ©cÃ©dente. Impossible de savoir si la performance s'amÃ©liore ou se dÃ©grade.
- Cause racine: pas de calcul ni d'affichage de delta (pÃ©riode courante vs pÃ©riode prÃ©cÃ©dente).
- Regle de prevention: tout KPI numÃ©rique doit afficher: valeur courante + delta (â–² hausse / â–¼ baisse) par rapport Ã  la pÃ©riode prÃ©cÃ©dente. Le delta doit Ãªtre calculÃ© par `loadStats()` et stockÃ© dans `state.kpiDeltas`. Fonction `_renderKpiDelta(el, value, previous)`.
- Test de non-regression: le Dashboard affiche â–² ou â–¼ Ã  cÃ´tÃ© de chaque KPI avec la valeur de variation.
- Fichiers a surveiller: `static/js/split/013_kpis.js`, `static/js/split/012_data_loading.js`.


## 10) Features, conventions et APIs documentÃ©es

Cette section documente les features ajoutÃ©es, les conventions Ã©tablies, et les endpoints API spÃ©ciaux â€” sans format de bug car ce ne sont pas des rÃ©gressions.

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
- Regle: `exit_price` est mappe conditionnellement selon le resultat du trade. Si WIN â†’ exit_price = take_profit. Si LOSS â†’ exit_price = stop_loss.
- Le backend (`05_payload_normalizers.py`) derive `is_win` depuis direction + entry vs exit si non fourni explicitement.
- Le frontend affiche `exit_price` sous le label "TP" dans la section Niveaux de l'editeur XXL, mais le bloc Resultat a un select Statut (Ouvert/Cloture) qui permet de corriger le mapping.
- `syncExitMapping()` dans `021_rr_preview.js` auto-remplit SL ou TP quand l'utilisateur change isWin.
- La DB conserve les deux colonnes (`take_profit`, `stop_loss`) pour retrocompatibilite.
- **Ne JAMAIS afficher exit_price ET take_profit en meme temps** â€” seul exit_price (label "TP") est visible.
- Cas particulier: SL=TP â†’ RR preview affiche un avertissement au lieu de 1.00R.
- Correction du bug: une perte short avec exit_price mais sans TP causait SL=TP=1.00R (nonsensical).
- Fichiers a surveiller: `app_parts/05_payload_normalizers.py` (normalisation conditionnelle), `static/js/split/021_rr_preview.js` (syncExitMapping), `static/js/split/059_trade_editor_controller.js` (label TP), `templates/partials/pages/journal/table.html`, `static/js/split/056_journal_day_trade_cards.js`, `app_parts/03_core_helpers.py` (skip validation si is_win explicite).


### CONVENTION-20260503 - Refacto loader `app_parts/__init__.py` (exec â†’ namespace dÃ©diÃ©)

- **Motivation**: Le loader utilisait `exec(_code, globals(), globals())` qui chargeait tous les modules dans le mÃªme espace de noms que le package `app_parts` lui-mÃªme. Causes de fragilitÃ©: 1) collisions silencieuses entre modules (ex: `_time` Ã©crasÃ© entre deux fichiers), 2) pas de dÃ©tection de chevauchement, 3) `globals()` implicite rendait le code difficile Ã  instrumenter.
- **Nouveau loader**: Chaque fichier est compilÃ© et exÃ©cutÃ© dans un dictionnaire namespace dÃ©diÃ© `_NS`. AprÃ¨s chargement, un proxy `_AppPartsModule` est installÃ© sur `app_parts` qui dÃ©lÃ¨gue les lectures/Ã©critures Ã  `_NS`. Les collisions de noms publics sont dÃ©tectÃ©es et loguÃ©es en warning.
- **Monkey-patching**: `app_parts.DB_PATH = X` (utilisÃ© dans les tests) propage dans `_NS` via `__setattr__` â€” toutes les fonctions voient la nouvelle valeur Ã  l'appel car leur `__globals__` pointe sur `_NS`.
- **RÃ©trocompat**: `from app_parts import *` dans `app.py` continue de fonctionner (les noms sont copiÃ©s dans `__dict__` aprÃ¨s chargement).
- **Test de non-rÃ©gression**: `python -m unittest discover -s tests -v` â†’ 41 tests passent (dont le guardrail playbook mis Ã  jour). Le serveur dÃ©marre avec `python app.py`.
- **Fichiers modifiÃ©s**: `app_parts/__init__.py` (seulement ce fichier â€” les 25 modules `app_parts/*.py` sont inchangÃ©s).

### BUG-20260503-D09 - [RÃ‰SOLU] Skeleton KPI reste figÃ© aprÃ¨s erreur API
- Symptome: Si le fetch `/api/stats` Ã©choue (rÃ©seau, 500), `renderKPIs()` n'est jamais appelÃ©e. Le `.loading` class sur `[data-widget-board="today"]` n'est pas retirÃ© â†’ le shimmer skeleton reste indÃ©finiment.
- Cause racine: `loadStats()` avait `catch { toast() }` mais ne nettoyait pas le skeleton. Le `finally { loading(false) }` ne gÃ©rait que la loadingBar globale (#loadingBar), pas le skeleton widget.
- Regle de prevention: TOUT `catch` d'un fetch qui alimente un render doit netoyer l'Ã©tat de chargement du widget correspondant. Pattern: `var board = document.querySelector('[data-widget-board="today"]'); if (board) board.classList.remove("loading");`. Le `finally` ne suffit pas si le render est dans le `try`.
- Test de non-regression: Simuler une erreur API â†’ le skeleton disparaÃ®t, le toast d'erreur s'affiche, un Ã©tat d'erreur visuel apparaÃ®t (bordure rouge subtile avec "Erreur de chargement").
- Fichiers a surveiller: `static/js/split/012_data_loading.js` (catch de loadStats), `static/js/split/013_kpis.js` (renderKPIs loading removal), `static/css/split/003_settings_chip_remove_hover.css` (.widget-board[data-load-error] styles).

### BUG-20260503-D23 - [RÃ‰SOLU] Ã‰tats vides sans action claire
- Symptome: Plusieurs Ã©tats vides (recent entries, favoris, journal filters, calendar search) n'avaient aucun bouton d'action pour sortir de l'Ã©tat vide.
- Cause racine: Approche "message seulement" sans CTA â€” l'utilisateur devait deviner quoi faire.
- Regle de prevention: TOUT Ã©tat vide doit proposer une action claire : "Ajouter", "Voir", "RÃ©initialiser", "CrÃ©er". Pas de message seul.
- Test de non-regression: Naviguer vers chaque Ã©cran sans donnÃ©es â†’ un bouton d'action est visible.
- Fichiers a surveiller: `014_today_page.js` (recent empty), `012_favorites_carousel.html` (fav empty), `table.html` (journal filter empty), `015_calendar.js` (calendar/search empty).


### BUG-20260505-03 - [RÃ‰SOLU] Wizard clics morts + draft auto-resume
- Symptome: DÃ¨s l'ouverture du wizard, plus aucun clic ne marche. AprÃ¨s un refresh, la wizard reprend Ã  l'Ã©tape du crash PC (3/12 au lieu de 1/12).
- Cause racine: 3 causes combinÃ©es â€” (1) setTimeout(wizNext,200) jamais annulÃ© â†’ timer stale aprÃ¨s fermeture (2) wizClose() ne nettoyait pas paddingTop/paddingLeft/onclick/wiz-rail-mode (3) Draft auto-repris Ã  chaque wizOpen()
- Regle de prevention: (1) Toujours stocker le timer ID et clearTimeout dans wizClose() (2) wizClose() doit nettoyer TOUS les rÃ©sidus d'Ã©tat (inline styles, classes dynamiques, onclick) (3) _wizClearDraft() en tÃªte de wizOpen() â€” le draft est crash recovery, jamais repris auto.
- Test de non-regression: Ouvrir wizard depuis le rail, cliquer sur Suivant/cartes, fermer, rouvrir â€” doit repartir Ã  l'Ã©tape 1. RÃ©pÃ©ter 3x.
- Fichiers a surveiller: 040_wizard_core.js, 042_wizsetdate.js, 025_wizard_steps_ui.css

### CONVENTION-20260503-02 - Conflit de namespace `_time` dans le loader partagÃ©
- Symptome: 500 INTERNAL SERVER ERROR sur `/api/days` et `/api/stats` des l'ouverture du journal. TypeError: 'module' object is not callable sur `_time()` dans le rate limiter.
- Cause racine: `03_core_helpers.py` fait `from time import time as _time` (la fonction). `23_routes_market.py` fait `import time as _time` (le module). Dans le namespace partagÃ© `_NS` du loader, le dernier fichier charge Ã©crase le premier â†’ `_time` devient le module `time`, pas la fonction `time()`.
- Regle de prevention: NE JAMAIS utiliser `_time` comme alias d'import dans les fichiers app_parts. Utiliser `_time_mod` pour le module (`import time as _time_mod`) et `_time` ou `_time_fn` pour la fonction (`from time import time as _time_fn`). VÃ©rifier avec `grep -n 'import.*as _time' app_parts/*.py` apres ajout d'un fichier.
- Test de non-regression: Charger le module app_parts â†’ `_time` doit etre callable. Toutes les routes `@ratelimit` doivent repondre 200.
- Fichiers a surveiller: app_parts/__init__.py, app_parts/03_core_helpers.py, app_parts/23_routes_market.py, app_parts/15_parse_trade.py, app_parts/19_ai_chat.py

### CONVENTION-20260506-01 â€” Pagination backend aggTrades + force cache bust
- Symptome: La route `/api/market/aggtrades` ne paginait pas et envoyait limit=5000 a Binance (max 1000). Le cache etait un dict sans limite de taille. Le cache hit renvoyait des metadata incompletes. Le param force n'existait pas. Les int() levaient 500 sur input invalide.
- Cause racine: Implementation initiale minimaliste sans pagination, cache size limit, ou validation de parametres.
- Regle de prevention: TOUJOURS clamber les parametres limite. Paginer en backend avec _MAX_PAGES = 8. Stoker le payload complet dans le cache (pas seulement trades). Expurger les entrees expirees quand le cache depasse _CACHE_MAX_KEYS = 100. Ajouter force=1 pour bypass cache. Utiliser _parse_int_param() avec try/except plutot que int() direct.
- Test de non-regression: /api/market/aggtrades?symbol=BTCUSDT&limit=5000 doit retourner jusqu'a 5000 trades pagines. /api/market/aggtrades?limit=abc doit retourner 400. /api/market/aggtrades?force=1 doit contourner le cache.
- Changement: Rewrite complet de market_aggtrades(), ajout de _purge_cache(), _parse_int_param(), _fetch_binance_agg(), _MAX_PAGES, MAX_TOTAL_TRADES.
- Fichiers a surveiller: app_parts/23_routes_market.py

### CONVENTION-20260506-02 â€” Pagination aggTrades par fromId (pas startTime+1ms)
- Cause racine: startTime+1ms peut skipper des trades ayant le meme timestamp milliseconde. Plusieurs aggTrades Binance peuvent partager le meme T.
- Regle de prevention: TOUJOURS paginer par fromId=lastAggTradeId+1 pour les pages suivantes. La premiere page utilise startTime/endTime pour le filtrage temporel. Filtrer cote backend les trades > endTime.
- Test de non-regression: /api/market/aggtrades?symbol=BTCUSDT&limit=5000 doit retourner exactement 5000 trades sans trous. Verifier que les trades ont des ids consecutifs.
- Fichiers a surveiller: app_parts/23_routes_market.py

### CONVENTION-20260506-03 â€” rAF _running guard pour eviter les boucles orphelines
- Cause racine: start() sans guard peut etre appele plusieurs fois (init + pageChange listener).
- Regle de prevention: Toujours garder _running flag dans start/stop. start() check _running en tete, return si deja lance. loop() check _running a chaque frame. stop() met _running=false puis cancelAnimationFrame.
- Fichiers a surveiller: static/js/split/066_orderflow_engine.js

### CONVENTION-20260506-04 â€” abort(400) retourne HTML â†’ try/except ValueError + jsonify
- Cause racine: abort(400) dans Flask peut retourner une page HTML si pas de handler errorhandler(400) dedie.
- Regle de prevention: Ne jamais utiliser abort() dans les routes API. Utiliser raise ValueError dans les helpers, try/except dans la route, return jsonify({"error": str(e)}), 400.
- Fichiers a surveiller: app_parts/23_routes_market.py

### BUG-20260506-05 â€” Timeout Binance 10s cause UI bloquee 10 secondes
- Symptome: Au refresh, page noire sans donnees pendant ~10s, puis data apparait. `klines?interval=1d&limit=100` â†’ 502 apres 10.02s.
- Cause racine: `urllib.request.urlopen(req, timeout=10)` dans `market_klines()` et `_fetch_binance_page()`. Quand Binance est lent/unreachable, le thread Flask est bloque 10s. Le frontend attend les donnees VWAP 90D avant de rendre completement.
- Regle de prevention: Timeout = 3s max pour les proxies API externes. Ajouter `log.warning` sur les timeouts Binance pour diagnositic. Les VWAP multi-TF doivent echouer silencieusement (log only, pas de toast).
- Test de non-regression: Charger la page Today â†’ le widget BTC chart doit s'afficher immediatement meme si Binance est down. Les VWAP doivent etre absents (pas d'etat d'erreur visible).
- Fichiers a surveiller: app_parts/23_routes_market.py, static/js/split/060_btc_chart_widget.js

### BUG-20260506-06 â€” JS bundle bloque en Pending (serveur Flask mono-thread)
- Symptome: `app.js` reste en Pending (0 B) dans le navigateur, CSS se charge normalement. La page reste noire sans data.
- Cause racine: `app.run(host, port, debug)` sans `threaded=True`. Flask par defaut est mono-thread. Quand le proxy Binance bloque le thread (3s), la reponse du JS (657 KB) est suspendue â†’ le navigateur attend.
- Regle de prevention: Toujours `threaded=True` sur `app.run()` en dev. En prod, utiliser waitress/gunicorn.
- Test de non-regression: Lancer le serveur, charger la page â†’ `app.js` doit charger en <500ms meme si Binance est down.
- Fichiers a surveiller: app_parts/18_launcher.py

### BUG-20260506-07 â€” Pagination klines par `batch[-1][0]` cause doublons
- Symptome: des bougies en double apparaissent dans les donnees klines paginees (meme open_time).
- Cause racine: `current_start = batch[-1][0]` rÃ©utilise l'open_time de la derniÃ¨re bougie comme startTime de la page suivante. Binance inclusive start â†’ la derniere bougie est fetchÃ©e deux fois.
- Regle de prevention: TOUJOURS paginer les klines par `last_open_time + interval_ms`. Ajouter une dedupe par open_time en post-traitement.
- Test de non-regression: fetch 150 bougies de 1h â†’ les 150 doivent avoir des open_time uniques et consecutifs.
- Fichiers a surveiller: app_parts/23_routes_market.py

### BUG-20260507-01 â€” DELETE routes sans check existence â†’ 200 OK meme si rien supprime
- Symptome: `delete_day(999)` et `delete_trade(999)` retournaient `{"ok": true}` 200 pour des IDs inexistants.
- Cause racine: les routes DELETE executaient directement le SQL sans SELECT prealable.
- Regle de prevention: TOUJOURS verifier l'existence avec `SELECT id` avant DELETE sur des ressources individuelles. Pour les batchs, utiliser `cur.rowcount` au lieu de `len(ids)`.
- Test de non-regression: `DELETE /api/days/999999` â†’ 404. `DELETE /api/trades/999999` â†’ 404. `DELETE /api/trades/batch` avec 501 IDs â†’ 400.
- Fichiers a surveiller: app_parts/09_routes_days.py, app_parts/10_routes_trades.py

### BUG-20260507-02 â€” /api/trades/instruments pas de fallback config si DB vide
- Symptome: avec une DB vide, la route retourne `[]` au lieu des instruments par defaut definis dans INSTRUMENTS.
- Cause racine: la route ne faisait que `SELECT DISTINCT instrument FROM days` sans fallback.
- Regle de prevention: TOUJOURS prevoir un fallback sur les valeurs de config quand une requete DB retourne 0 resultats. Les instruments par defaut du config.json sont la source de verite, la DB est un sur-ensemble dynamique.
- Fichiers a surveiller: app_parts/10_routes_trades.py

### CONVENTION-20260507-01 â€” Index manquants sur trades
- Cause racine: les colonnes `strategy`, `is_win`, `created_at` sont frequemment filtrees/triees sans index.
- Regle: Ajouter les indexes sur les colonnes de filtrage et tri frequents dans `init_db()`. Migration si table existe deja.
- Fichiers a surveiller: app_parts/02_database.py

### CONVENTION-20260507-02 â€” ML _load_trades_with_context doit utiliser derive_trade_metrics()
- Cause racine: le module ML lisait les colonnes brutes `pnl`, `is_win`, `rr` directement depuis la DB, contournant `derive_trade_metrics()` qui normalise ces valeurs.
- Regle: Toujours passer par `derive_trade_metrics()` pour les metriques derivees (pnl, rr, is_win) meme dans les modules non-stats. Les valeurs brutes DB peuvent etre NULL ou incoherentes.
- Fichiers a surveiller: app_parts/20_ml_engine.py

### BUG-20260507-03 â€” Cache ML : date_to absent de la cle de cache
- Symptome: Deux requetes `analyze_patterns` avec le meme `date_from` mais des `date_to` differents retournaient le meme resultat en cache.
- Cause racine: la construction de `cache_key` incluait `pattern|{mtime}|inst={inst}|from={from}` mais pas `|to={to}`.
- Regle de prevention: TOUS les parametres de requete doivent etre inclus dans la cle de cache. Un parametre oublie = donnees incoherentes silencieuses.
- Fichiers a surveiller: app_parts/20_ml_engine.py

### CONVENTION-20260507-03 â€” Couche service extraite (06a_trade_service + 06b_day_service)
- Motivation: extraire la logique metier des routes pour la rendre reutilisable par l'IA chat et les tests.
- Regle: Les fonctions `service_*` prennent `db` en parametre explicite, ne dependent pas du contexte Flask. Les routes restent minces (parse â†’ service â†’ jsonify). Charger les services AVANT les routes dans `__init__.py`.
- Fichiers a surveiller: app_parts/06a_trade_service.py, app_parts/06b_day_service.py, app_parts/__init__.py

### BUG-20260503-08 â€” [RÃ‰SOLU] pnl REAL DEFAULT 0 en DB empeche la distinction pnl-absent vs pnl=0
- Symptome: quand _auto_calc_pnl() ne set pas pnl (pas d'entry/exit/size), le DEFAULT 0 en DB prenait le relais, rendant impossible la distinction entre "pnl non fourni" (None) et "pnl=0 explicite". Cassait le recalcul en update (le pnl=0 existant bloquait le guard `payload.get("pnl") is not None`).
- Cause racine: `pnl REAL DEFAULT 0` dans le CREATE TABLE de 02_database.py.
- Regle de prevention: les colonnes avec une semantique "optionnelle/inconnue" ne doivent PAS avoir de DEFAULT. NULL est la valeur correcte pour "non renseigne". Uniquement les colonnes ou 0 a un sens metier (ex: position_size) peuvent avoir DEFAULT 0.

## LeÃ§ons retenues (mai 2026)

### VWAP â€” ne pas polluer l'axe logique LWC
Les series VWAP 7D/30D/90D en fallback 15m/1h/4h ajoutent des centaines de points
supplementaires sur l'axe logique de Lightweight Charts (~1800 vs 300 bougies 3m).
Cela rend le zoom instable et les calculs de range invalides.
**Fix** : resampler les points VWAP fallback sur les timestamps des bougies
principales (`_mainCandles`) avant `setData()`. Le VWAP direct depuis
`_mainCandles` (quand coveredSecs >= periodSec) est deja aligne, pas besoin.

### localStorage â€” relire au besoin
Les settings VWAP sont stockes dans localStorage (`chartVwapPeriods`) mais
le widget 060 (today) ne lisait cette valeur qu'a l'init. Les changements
depuis le menu settings n'etaient pas visibles.
**Fix** : relire localStorage au debut de chaque `_calcAndDrawVwap()`.
- Test de non-regression: creer un trade sans entry/exit/size â†’ pnl=None (pas 0.0). Update avec exit_price â†’ pnl recalcule depuis les donnees existantes.
- Fichiers a surveiller: app_parts/02_database.py (CREATE TABLE trades), app_parts/05_payload_normalizers.py, app_parts/03_core_helpers.py

### VWAP â€” ne pas tirer l'echelle prix vers le bas
Les VWAP multi-TF (7D, 30D, 90D) peuvent avoir des prix bien en dessous de la
bougie courante (marche baissier, vieilles donnees). Sans precaution, la price
scale autoscale s'etend pour inclure TOUTES les series visibles, tirant l'axe Y
vers le bas et rendant les bougies courantes toutes petites.
**Fix** : ajouter `autoscaleInfoProvider: function () { return null; }` sur
chaque serie VWAP. Les VWAP restent sur la price scale `'right'` (alignees avec
les bougies) mais n'influencent pas le calcul du range vertical.
- Applique dans `060_btc_chart_widget.js` et `062_chart_page.js`.

### VWAP canonique â€” flood API Binance â†’ 502
Le module VWAP canonique (055) fetch 4 intervalles differents (15m, 15m, 1h, 4h)
a chaque chargement, ce qui multiplie les appels API par 5 (1 widget + 4 VWAP).
Binance rate-limite â†’ 502 â†’ chart disparait.
**Fix** : 
- `_KLINES_CACHE_TTL` passe de 30s a 300s (5min) dans `app_parts/23_routes_market.py`
- Retry 3 fois sur 429/502/503 avec backoff 1-2s dans `_fetch_klines_page()`
- VWAP utilise `getLastClosedCandleEndTime()` â†’ fenetre stable â†’ meilleur hit cache
- Fichiers a surveiller: `app_parts/23_routes_market.py`

### Horloge Windows decalee â†’ countdown affiche 'â€”'
L'horloge Windows/locale peut etre decalee de plusieurs heures (veille WSL,
mauvaise synchro NTP). Le guard anti-timestamp detectait lastCandleTime > Date.now()
et affichait 'â€”'.
**Fix** : calculer `clockOffset = serverTime - Date.now()` au premier fetch,
puis utiliser `adjustedNow = Date.now() + clockOffset` dans tous les calculs
de countdown et auto-refresh. clockOffset n'est pas recalcule sur les messages WS
(pour eviter le reset du countdown a 3:00 en boucle).
- Applique dans `060_btc_chart_widget.js` et `062_chart_page.js`.

### Countdown â€” anchor base sur candleCloseMs + performance.now()
Le clockOffset (= serveurTime - Date.now()) etait recalcule sur chaque evenement,
causant des sauts de countdown (Bug A: depart toujours a 3:00 meme si bougie de 2min;
Bug B: saut a 8 min lors d'un drag/pan chart).
**Fix** : remplacer clockOffset par `countdownAnchor` :
```js
countdownAnchor = {
  candleCloseMs,         // closeTime Binance (k.T) ou openTime + interval
  remainingAtAnchorMs,   // closeMs - Date.now() au moment du calcul
  perfAtAnchor,          // performance.now() pour descente monotone
  source,                // 'fetch', 'ws', 'rest-fallback'
};
```
Le tick countdown ne fait plus que :
```js
elapsed = performance.now() - anchor.perfAtAnchor;
remaining = anchor.remainingAtAnchorMs - elapsed;
```
Aucun evenement chart (drag, wheel, range) ne peut corrompre le compteur.
Le timer n'est JAMAIS clear a 0:00 (le prochain anchor le remet a jour).
- `clockOffset` supprime des deux fichiers.
- `_updateCountdownAnchor()` appele depuis fetch/WS/REST fallback.
- WS fournit `openTime: k.t, closeTime: k.T` pour un calcul precis.
- Fichiers: `060_btc_chart_widget.js`, `062_chart_page.js`.

### Bug VWAP 1D = rolling 24h au lieu de daily session (4 mai 2026)
**Cause** : VWAP '1D' utilisait `startTime = endTime - 1 * 86400000` (rolling 24h glissantes),
pas une session calendaire. Le backend `/api/market/klines` ignorait `endTime`, rendant
les fenetres temporelles non-bornees.
**Fix** :
- **Backend `23_routes_market.py`** : `fetch_klines()` et `market_klines()` acceptent `endTime`.
  Filtre strict post-normalisation : `c["time"] * 1000 >= startTime` et `<= endTime`.
  Cache key inclut `endTime`.
- **Frontend `055_indicator_vwap_core.js`** : `VWAP_SOURCE_CONFIG` renomme '1D' en deux periodes :
  `'D-NY'` (session NY_DAY, depuis 00:00 America/New_York) et `'24H'` (rolling 24h).
  Ajout de `_getSessionBounds()` qui distingue `mode: 'rolling'` vs `mode: 'session'`.
  Logs debug `[VWAP BOUNDS]` et `[VWAP RAW]` temporaires pour verifier les fenetres.
- **UI `060_btc_chart_widget.js` + `062_chart_page.js`** : `vwapOrder` passe de `['1D', ...]`
  a `['D-NY', '24H', '7D', '30D', '90D']`. `VWAP_COLORS` mis a jour.
  Filtrage des periodes inconnues au chargement depuis localStorage.
- **Template `chart.html`** : boutons VWAP : 'Jour NY' + '24h' remplacent '1 jour'.
- Ne pas toucher au mapping timeframe `'1D' â†’ '1d'` (c'est Binance, pas VWAP).

### Event bus VWAP â€” synchro widget â†” page chart (4 mai 2026)
**Cause** : quand 062 modifie `localStorage.chartVwapPeriods`, le widget 060 ne recoit aucun
signal car l'event natif `storage` ne se declenche PAS dans le meme document/onglet.
Le widget relisait la config au chargement mais pas apres changement.
**Fix** :
- **055** : `readActiveVwapPeriods()`, `saveActiveVwapPeriods()`, `normalizeVwapPeriods()`
  (legacy '1D' â†’ 'D-NY'). `saveActiveVwapPeriods()` declenche `CustomEvent('chart:vwap-periods-changed')`.
  Tout expose dans `window.BtcVwap`.
- **062** : toggle VWAP passe par `BtcVwap.saveActiveVwapPeriods()` au lieu de `localStorage.setItem()` direct.
- **060** : `_refreshWidgetVwapFromPrefs()` ecoute `chart:vwap-periods-changed` ET l'event natif `storage`.
  Recalcul VWAP a chaque changement de periode.

### Countdown `â€”` â€” cache klines TTL 5min + force=1 (4 mai 2026)
**Cause** : le cache backend `_KLINES_CACHE_TTL = 300` (5 min) renvoyait des bougies expirees
pour les fetchs live sans `endTime`. `_updateCountdownAnchor()` rejetait l'anchor stale â†’ `countdownAnchor = null` â†’ affichage `â€”`.
**Fix** :
- **Backend** : ajout du parametre `force` sur `fetch_klines()` et `market_klines()`.
  `force=True` skip le cache, mais le cache est quand meme mis a jour apres fetch.
- **Frontend 060 + 062** : `force=1` sur `_fetchAndRender()` et `_fetchLatestCandleOnly()`,
  pas sur les VWAP canoniques (startTime/endTime â†’ cache stable).
- **Fallback stale anchor** : si `remaining < -intervalMs`, log warning + `_fetchLatestCandleOnly()` auto.
  `_startCountdown()` appelle aussi `_fetchLatestCandleOnly()` si pas d'anchor.
- **wsConnected** : `newWs.onopen` manquant dans 062 ajoute (set `wsConnected = true`).

### Timeout Binance 10s â†’ 3s + threaded=True (6 mai 2026)
**Cause** : `urllib.request.urlopen(req, timeout=10)` bloquait le thread Flask 10s sur Binance lent/unreachable.
Flask mono-thread â†’ `app.js` (657 KB) reste en Pending â†’ page noire sans data.
**Fix** : timeout Binance 3s max, `threaded=True` sur `app.run()` en dev.
- Fichiers: `app_parts/23_routes_market.py`, `app_parts/18_launcher.py`


### LeÃ§on T-0004: Midnight Engine - bornes strictes et fenetres NY

**Date:** 2026-05-04

**Probleme:** Toute feature temporelle (Midnight Engine, Volume Profile, daily high/low) depend de la definition precise des fenetres. Le backend doit gerer les timezones (America/New_York) avec zoneinfo + tzdata, et les bornes de fenetres doivent etre calculees cote backend, pas cote frontend.

**Actions:**
- Ajouter `tzdata` comme dependance Python
- Migration v9: tables `market_day_contexts`, `market_events`, `trade_market_contexts` avec indexes
- Module `21_midnight_engine.py`: calcul des 3 fenetres (pre-midnight 22h-00h NY, midnight 00h-00h30 NY, post-open 00h30-2h NY), extraction de features, classification de scenarios, outcome journalier
- Route `GET /api/models/midnight/day?symbol=BTCUSDT&date=YYYY-MM-DD`


### LeÃ§on T-0005: Corriger les bugs sans les patchs qui crÃ©ent d'autres bugs (4-5 mai 2026)

**Date:** 2026-05-04/05

**Probleme:** Une sÃ©rie de bugs corrigÃ©s en rafale, mais chaque fix mÃ©ritait une approche mesurÃ©e plutÃ´t qu'un patch agressif.

**Bugs corrigÃ©s:**

1. **Loader collisions (`app_parts/__init__.py`)** : Le calcul de collisions (`_after - _before`) ne pouvait jamais rien dÃ©tecter car les nouveaux noms ne sont pas dans les anciens. **Fix**: comparer les VALEURS avant/aprÃ¨s, pas les noms.

2. **PnL non recalculÃ© sur update** : Si l'ancien trade a un pnl non-null, `_auto_calc_pnl` retourne sans recalculer mÃªme si entry/exit/size changent. **Fix**: Invalider `pnl` avant `_auto_calc_pnl` si un champ de calcul a changÃ©, dans `service_update_trade`, `update_trade` route, et chat IA.

3. **Upload image extension incohÃ©rente** : `_save_pending_image` pouvait sauvegarder `image.exe` (le nom) contenant un PNG valide. **Fix**: Toujours utiliser l'extension sniffÃ©e du contenu binaire.

4. **Markdown IA liens non filtrÃ©s** : Les liens markdown `[texte](url)` Ã©taient injectÃ©s directement en `<a href="$2">`, permettant `javascript:`. Les donnÃ©es JSON des actions Ã©taient injectÃ©es en attribut HTML `data-ai-action-data='${JSON.stringify(...)}'`, cassant si les donnÃ©es contiennent `'`. **Fix**: `_aiSafeHref()` valide les protocoles (http/https/mailto), `_aiActionStore` stocke les donnÃ©es en mÃ©moire plutÃ´t que dans le DOM.

5. **ChartViewCore padding top/bottom inversÃ©** : `computePriceRange` appliquait `padding.top` au bas (from=low) et `padding.bottom` au haut (to=high). **Fix**: Inverser le mapping.

6. **Config WIDGET_VIEW/CHART_VIEW pas alignÃ©e** : Le core `054` avait `0.22/0.18` pendant que le widget `060` utilisait `0.08/0.08`. **Fix**: Aligner le core Ã  `0.08/0.08` (widget) et `0.10/0.08` (chart).

7. **start.bat pip install Ã  chaque lancement** : `pip install -r requirements.txt` ralentit chaque dÃ©marrage. **Fix**: Hasher `requirements.txt`, ne rÃ©installer que si le hash change.

8. **Widget BTC live Y trop figÃ©** : `maybeFollowBtcWidgetPriceY()` ne recadrait qu'Ã  16%/84%, throttle absent, `S.candles` pas updatÃ© en live â†’ widget immobile. **Fix**: Upsert WS candles, zone 28%/72%, throttle 250ms, grace period 2.5s post-focus, zones adaptatives par TF, restauration candle-only post-VWAP.

9. **VWAP pollue l'autoscale Y** : Les sÃ©ries VWAP faisaient autoscaleinfoProvider implicite â†’ range Y s'Ã©tend vers VWAP loin â†’ jump visuel. **Fix**: `autoscaleInfoProvider: () => null` dans `055` (applyOptions) ET `060` (crÃ©ation). `getBtcWidgetCurrentPriceRange()` prÃ©fÃ¨re `manualPriceRange` en mode follow. Restauration Ã©tagÃ©e (0/50/150/400/1000ms) post-VWAP.

10. **visibleBars non calibrÃ©s en durÃ©e** : 3m=120 bougies (6h) mais 5m=110 bougies (9h10) â†’ mÃªme "nombre" mais pas la mÃªme durÃ©e â†’ rendu incohÃ©rent. **Fix**: Calibrer en durÃ©e (~6h pour TF courts) plutÃ´t qu'en nombre fixe.

**RÃ¨gles de prÃ©vention retenues:**
- AprÃ¨s un redesign de widget avec follow live, tester sur 3-4 timeframes successifs
- Un fix "simple" (ex: countdownAnchor=null) est mieux qu'un systÃ¨me complexe
- Toujours vÃ©rifier que les configs canoniques du core sont alignÃ©es avec les overrides des widgets
- Les sÃ©ries d'indicateurs (VWAP) ne doivent JAMAIS influencer l'autoscale â€” toujours `autoscaleInfoProvider: () => null`
- Pour les liens et donnÃ©es dynamiques dans le HTML, toujours valider/sanitiser cÃ´tÃ© JS plutÃ´t que d'injecter en brut
- Avant tout fix de race condition async, vÃ©rifier si le problÃ¨me vient d'un ordre de chargement ou d'un scope JS


### Lecon T-0006: Market clock drift, live Y jump, et optimisations de chargement (5 mai 2026)

**Date:** 2026-05-05

**Probleme:** Malgre les fixs precedents, le widget BTC sautait encore apres 3-4s. Cause racine: decalage dhorloge ~9h entre Date.now() et timestamps Binance, provoquant rejet anchor countdown et boucle REST/WS refocus.

**Actions:**

1. BtcMarketClock global avec sync serverTime WS/klines.
2. _updateCountdownAnchor utilise BtcMarketClock.now() + nowMsOverride.
3. REST fallback bloque tant que clock pas sync.
4. _fetchLatestCandleOnly sans force=1.
5. LWC charge en local avant CDN.
6. Live Y breakout-only (sortie de cadre + throttle 1s).
7. Guard data.serverTime != null (Number(null)=0 piege).

**Regles de prevention:**
- Countdown marche ne doit JAMAIS dependre de Date.now() brut
- WS: utiliser d.E comme nowMsOverride plutot que clock globale
- Live Y = breakout, pas tracking (le tracking cree des jumps)
- Verifier x != null avant Number.isFinite(Number(x))
- Optim chargement: local > CDN, timeout court > long, pas force=1

### Lecon T-0007: Anti-flash et stale cache (5 mai 2026)

**Probleme:** Flash 1 bougie au changement TF cause par _clearAllSeries avant fetch + REST fallback concurrent. 502 intermittent quand Binance injoignable sans cache.

**Actions:** renderInFlight bloque REST fallback pendant full fetch. sessionStorage cache immediat au reload. _clearAllSeries retire avant await. _find_stale_klines_cache() fallback par symbol+interval.

**Regle:** Ne JAMAIS supprimer une declaration var sans verifier toutes ses utilisations dans la fonction. Un diff Git doit etre relu avant commit.

### Lecon T-0008: Cache sessionStorage et stale cache age (5 mai 2026)

**Probleme:** sessionStorage causait Value is null sur donnees corrompues. _find_stale_klines_cache calculait cache.age avec _time_mod.time() au lieu du ts du cache.

**Actions:** _normalizeCandles avant setData + guard length >= 2. _find_stale_klines_cache retourne (response, ts), cache.age = int(now - from_cache_ts).

**Regle:** Tout cache storage doit normaliser ses donnees avant usage. Toujours utiliser le vrai timestamp du cache pour calculer son age.

## T-0009: Stale cache for bounded requests must honor soft mode

**Bug**: When a VWAP (or any bounded) request hits Binance error, the stale cache fallback
_find_stale_klines_cache found a cache for the same symbol+interval, but _cache_covers_range
rejected it because it didn't cover the requested time range. The code returned 502 (hard error)
instead of honoring soft=1 and returning 200 with empty candles.

**Fix**: Before returning err[0], err[1] (502) on bounded request cache miss, check if soft:
and return _empty_klines_response() with 200 instead. This prevents VWAP 502 from breaking
the chart when Binance is unreachable for bounded queries.

**Date**: 2026-05-05


### Lecon T-0009: Cache SQLite historique klines — pagination Binance (5 mai 2026)

**Problème:** Pour le Volume Profile longue durée (90D, 366D), on avait besoin de 2000+ candles par intervalle. L'endpoint `/api/market/klines` limité à `limit=1000` ne pouvait pas servir ces périodes en un seul appel. Le frontend bricolait avec des `limit` approximatives.

**Solution:** Nouveau module `app_parts/24_market_history_cache.py`:
- Table SQLite `market_klines(symbol, interval, time, open, high, low, close, volume)` avec PK composite
- Endpoint `GET /api/market/klines/history?symbol=&interval=&days=` 
- Si le cache SQLite couvre la période (tolérance 2 intervalles pour bougie courante), retour direct depuis SQLite
- Sinon, pagination Binance avec `startTime` (pas de `limit=1000`), upsert `INSERT OR IGNORE`, puis retour depuis SQLite
- Réutilisation des helpers existants : `_normalize_candle()`, `_interval_to_ms()`, `_fetch_klines_page()` du namespace partagé (23_routes_market.py)

**Règle:** Ne jamais paginer depuis le frontend. Le backend doit gérer l'historique, la pagination et le cache. Le frontend demande juste une période (`days`). Pour les gros volumes (366D/4h = 9 pages Binance), le cache SQLite rend le second appel instantané.

**Test de validation:** `curl http://127.0.0.1:5000/api/market/klines/history?symbol=BTCUSDT&interval=4h&days=366` → 2196 candles en 1.8s (binance+sqlite), puis 0.0s (sqlite seul).

**Fichiers à surveiller:** `app_parts/24_market_history_cache.py`, `app_parts/__init__.py` (ordre de chargement), `data/journal.db` (table market_klines).


### Lecon T-0010: Filtre endTime sur TOUTES les pages aggTrades (5 mai 2026)

**Problème:** La pagination aggTrades utilisait `fromId` après la première page, mais `fromId` ne respecte pas `endTime`. Les pages suivantes pouvaient retourner des trades POSTÉRIEURS à la fenêtre demandée, polluant la footprint avec des données hors-fenêtre.

**Correction:** Appliquer le filtre `start_time`/`end_time` sur CHAQUE batch, pas seulement la première page :
```python
if start_time is not None:
    batch = [t for t in batch if t["time"] >= start_time]
if end_time is not None:
    batch = [t for t in batch if t["time"] <= end_time]
```

**Règle:** Toute pagination avec `fromId` (aggTrades) ou `startTime` (klines) doit filtrer les bornes temporelles sur CHAQUE page, pas seulement la première. `fromId` ne garanti pas le respect d'`endTime` — c'est un ID séquentiel, pas une garantie temporelle.

**Test de non-régression:** `GET /api/market/aggtrades?symbol=BTCUSDT&startTime=X&endTime=Y&limit=8000` → aucun `trade.time < X`, aucun `trade.time > Y`.


### Lecon T-0010 bis: Filtre endTime sur TOUTES les pages aggTrades (5 mai 2026)


### Lecon T-0011: ViewportController — machine d'état pour la vue orderflow (6 mai 2026)

**Problème:** timeScale/priceScale étaient mutés directement depuis 8 sources différentes (wheel, drag, keys, loadData, resize, setInterval, fit, reset). Un fetch data recadrait toujours la vue, même après un zoom utilisateur — reproduisant le bug historique du widget BTC.

**Solution:**
- `OF.ViewportController` avec mode `auto` | `manual`
- `mode=auto` (défaut) : loadData recadre la vue automatiquement
- `mode=manual` : loadData ne touche PAS la vue (setDataRange no-op)
- Toute interaction utilisateur (wheel, drag, keys, clicks) bascule en `manual`
- Les zooms passent par `applyPriceRange()` / `applyTimeRange()` — setters uniques
- `setAutoRange()` remet mode=auto

**Règle:** Un fetch data ne doit JAMAIS recadrer la vue si l'utilisateur a interagi. La vue appartient à l'utilisateur, pas aux données.

**Fichiers:** `066_orderflow_engine.js`, `066a_orderflow_viewport.js`


### BUG-20260505-02 - [RESOLU] Prix/countdown/timers perdus apres refactor _fetchAndRender

- Symptome: Le prix BTC met du temps a s'afficher (attend le WS retarde de 700ms). Le countdown reste sur `—`. L'auto-refresh REST ne se declenche jamais.
- Cause racine: Le refactor render/WS a supprime les side-effects critiques de `_fetchAndRender()` : mise a jour du prix DOM, `S.lastCandleTime`, `_updateCountdownAnchor`, `_startCountdown()`, `_startAutoRefresh()`, `countdownPriceLine.applyOptions`. Ces initialisations dependaient donc du WS (retarde 700ms) au lieu du REST fetch immediat.
- Regle de prevention: Lors d'un refactor de fonction fetch/render, toujours verifier que les side-effects UI (prix, countdown, timers) sont preserves. Le WS est un relais live, pas la source initiale.
- Test de non-regression: Charger le widget BTC -> le prix apparait des que `/api/market/klines` repond. Le countdown affiche un decompte, pas `—`. Changer de timeframe -> prix et countdown se mettent a jour immediatement (cache puis fetch).
- Changement: Restauration des side-effects dans `_fetchAndRender()` (chemin cache + chemin reseau). `_fetchWidgetCandles` retourne `data` complet pour sync `BtcMarketClock` via `serverTime`.
- Fichiers a surveiller: `static/js/split/060_btc_chart_widget.js` (`_fetchAndRender`, `_fetchWidgetCandles`).

### BUG-20260506-03 - [RESOLU] Contrat viewport orderflow non etanche en mode manuel

- Symptome: Des mutations directes `timeScale/priceScale` subsistaient hors setters uniques (notamment nudge/zoom), ce qui rendait le comportement manuel fragile apres interaction utilisateur.
- Cause racine: `OF.ViewportController` et le moteur utilisaient encore des ecritures directes sur les scales au lieu d'un point d'entree unique.
- Regle de prevention: Toute mutation viewport doit passer par `applyTimeRange()` / `applyPriceRange()`; `066_orderflow_engine.js` definit le controller principal et `066a_orderflow_viewport.js` l'etend uniquement (migration progressive explicite).
- Test de non-regression:
  1. Backend aggTrades:
     - `soft=1` + erreur Binance -> `200`, `source=\"unavailable\"`, `trades=[]`.
     - stale cache fallback -> `source=\"cache\"`, `cache.stale=true`, `upstream_error` renseigne.
  2. Checklist manuelle orderflow viewport (mode manual):
     - Interagir (drag/zoom/wheel) pour passer en manual.
     - `reload` ne doit pas recadrer la vue manuelle.
     - Changer timeframe puis revenir: la vue ne doit pas \"sauter\" hors action explicite reset/auto.
     - Couper/rallumer live: aucune reprise de controle de la vue si utilisateur detache.
     - `reset` / `auto` doivent recadrer explicitement.
- Fichiers a surveiller: `static/js/split/066_orderflow_engine.js`, `static/js/split/066a_orderflow_viewport.js`, `tests/test_market_aggtrades.py`.
 - Runtime hotfix prioritaire: si des routes API basculent en 500 avec `TypeError: 'module' object is not callable`, verifier les aliases globaux partages (`_time`, etc.) dans `app_parts`.

### Lecon T-0012: Midnights levels shared core + redraw guard (20 mai 2026)

- Probleme: le rendu des niveaux Midnight (open + STDV) devait etre coherent entre widget BTC (`060`) et page chart (`062`) sans multiplier les appels API au tick WS.
- Solution:
  - calcul `stdv_levels` cote backend dans `extract_midnight_features` et expose sous `levels.stdv_levels`;
  - module frontend partage `056_indicator_midnight_core.js` avec cache memoire, dedup des requetes en cours, conversion date NY, nettoyage strict des `priceLine`;
  - garde de redraw par `series._midnightDrawnDate` + `series._midnightDrawnSymbol` pour eviter les redraw inutiles.
- Regle: tout indicateur horizontal partage entre plusieurs charts doit passer par un core unique (cache + clear + draw), pas par des impls dupliquees dans chaque page.

### Lecon T-0013: Hyperliquid HIP-3 read-only data layer (22 mai 2026)

- Probleme: les contrats Hyperliquid type ES/Nasdaq peuvent etre des perps HIP-3 et ne se resolvent pas toujours avec un simple ticker. Certains endpoints demandent le nom complet `deployer:ASSET`, sinon candles/trades/orderbook peuvent pointer vers rien ou vers le mauvais actif.
- Solution:
  - ne jamais hardcoder ES/NASDAQ;
  - charger `meta`/`allPerpMetas`, construire un catalogue normalise, puis resoudre les alias BTC/ES/NASDAQ vers le vrai `coin`;
  - accepter `coin=` en override manuel pour un perp HIP-3 specifique;
  - garder la couche strictement read-only via l'Info API publique: candles, trades, L2 book, mids, funding, predicted funding, contexts, annotations, metadata.
- Regle: toute nouvelle source market doit d'abord fournir un resolver + des endpoints normalises et testes sans reseau. Le frontend/chart/orderflow/backtest consomment ensuite cette couche; ils ne doivent pas connaitre les particularites exchange comme `deployer:ASSET`.

### Lecon T-0014: Wallet tracker read-only avant UI live (22 mai 2026)

- Probleme: suivre des traders Hyperliquid forts demande de reconstruire des evenements depuis plusieurs sources publiques (`clearinghouseState`, open orders, fills). Si le dashboard consomme directement l'API exchange, il va dupliquer la logique et mal classifier partiels/hedges/closes.
- Solution:
  - creer une watchlist SQLite dediee (`hyperliquid_wallets`) avec migration versionnee;
  - exposer des endpoints backend normalises read-only pour state, orders, fills et events derives;
  - accepter aussi un endpoint `address=` sans sauvegarde pour debug/verif rapide;
  - tester les normalisations sans reseau avec des payloads Hyperliquid simules.
- Regle: le widget dashboard et l'overlay chart ne doivent consommer que les endpoints normalises du backend. La detection fine hedge/partial/close doit evoluer dans le moteur d'events backend, pas dans plusieurs composants frontend.

### Lecon T-0015: Wallet tracker tolerant au collage et aux pannes live (22 mai 2026)

- Probleme: l'ajout d'un wallet Hyperliquid pouvait afficher `error` alors que l'adresse etait valide. Deux causes se melangeaient: validation trop stricte (`0x` exact, pas `0X`, pas d'URL explorer, pas d'espaces invisibles) et refresh live qui faisait passer une panne Hyperliquid pour un echec d'ajout.
- Solution:
  - extraire la premiere adresse `0x/0X` + 40 hex depuis le texte colle, cote frontend et backend;
  - supprimer espaces et caracteres invisibles avant validation;
  - separer l'erreur d'ajout DB de l'erreur de state live;
  - si `/wallets/state` echoue, fallback sur `/wallets` pour afficher la watchlist sauvegardee avec un warning partiel.
- Regle: une action de persistance locale ne doit pas etre marquee en echec a cause d'un refresh live externe effectue juste apres. Les widgets read-only doivent degrader en mode partiel au lieu de cacher les donnees deja sauvegardees.

### Lecon T-0016: Alias Hyperliquid indices = mapping produit, pas recherche floue (22 mai 2026)

- Probleme: le resolver Hyperliquid choisissait `ES` et `NASDAQ` par recherche floue dans les metas, alors que les bons contrats prioritaires sont `SP500` pour ES et `XYZ100` pour Nasdaq. Les donnees affichees etaient donc plausibles mais fausses.
- Solution:
  - definir des alias canoniques explicites: `ES -> SP500`, `NASDAQ -> XYZ100`;
  - donner priorite absolue au nom canonique, meme si un asset `ES` ou `NASDAQ` existe;
  - tester les deux cas avec des faux assets concurrents pour eviter une regression silencieuse;
  - bump la cle de cache catalogue quand la logique de resolution change.
- Regle: pour les indices/synths Hyperliquid, ne jamais faire confiance a un ticker visuellement proche. La resolution doit etre un mapping produit explicite, puis seulement un fallback meta.

### Lecon T-0017: Wallet Hyperliquid = DEX principal + DEX HIP-3 (22 mai 2026)

- Probleme: `clearinghouseState` sans champ `dex` ne couvre que le perp DEX principal. Un wallet pouvait donc afficher HYPE/LIT/TON mais oublier les positions HIP-3 comme `xyz:XYZ100` ou `xyz:TSLA`, avec un PnL et un nombre de positions faux.
- Solution:
  - recuperer `perpDexs`, puis appeler `clearinghouseState`, `frontendOpenOrders` et `userFills` pour chaque DEX;
  - prefixer les coins HIP-3 par leur DEX (`xyz:XYZ100`) pour eviter toute collision avec les perps natifs;
  - dedupliquer par coin/ordre/fill normalise et garder les erreurs DEX partielles non bloquantes.
- Regle: toute feature wallet Hyperliquid doit verifier les positions natives ET les positions HIP-3 avec un wallet de reference avant d'etre consideree correcte.

### Lecon T-0018: Hyperliquid indices XYZ = canonical direct, pas resolver meta (22 mai 2026)

- Probleme: ES/Nasdaq etaient encore resolus via catalogue/metas, ce qui pouvait choisir un asset plausible mais faux ou un DEX de test. Pour les indices XYZ, le bon `coin` Info API est le nom complet prefixe: `xyz:SP500` pour ES et `xyz:XYZ100` pour Nasdaq.
- Solution:
  - court-circuiter `_hl_resolve_coin` pour les marches prioritaires avec un mapping produit explicite;
  - garder `BTC` en resolution native, mais forcer ES/NASDAQ vers leur coin complet `xyz:*`;
  - tester klines/trades/contexts/funding avec les coins complets, pas seulement avec les labels visibles.
- Regle: quand un marche Hyperliquid est un produit synthetique/indice, la source de verite est le `coin` complet attendu par l'Info API, pas le ticker utilisateur ni le meilleur match dans `allPerpMetas`.

### Lecon T-0018: DEX xyz pour SP500/XYZ100 sur Hyperliquid (22 mai 2026)

- Probleme: le mock de test utilisait des DEX bidons `builder` et `idx` pour SP500 et XYZ100, alors que le vrai DEX Hyperliquid est `xyz`. Les tests passaient en local mais l'API reelle resolvait mal ES/Nasdaq.
- Solution: aligner les mocks sur la prod — DEX `xyz`, assets `SP500` et `XYZ100` directement, pas de doublons `ES`/`NASDAQ` qui faussaient le scoring.
- Regle: les mocks de test doivent refleter la structure reelle de l'API upstream, pas des noms arbitraires.

### BUG-20260527-01 - Volume Profile calcule depuis OHLCV au lieu des executions

- Symptome: Le Volume Profile pouvait afficher POC, VA et delta plausibles mais faux, car chaque bougie repartissait son volume uniformement entre low et high; l'ancien orderflow utilisait en plus des libelles bid/ask inverses pour l'agression.
- Cause racine: La chart et l'orderflow n'avaient pas de contrat analytique commun fonde sur les trades executes Hyperliquid, ni de couverture explicite pour les archives absentes.
- Regle de prevention: Un profil ou delta market data doit etre calcule uniquement depuis des executions normalisees `buyVolume`/`sellVolume`; un side non certifie compte dans le volume total mais jamais dans le delta, et toute lacune doit retourner `partial/gaps`.
- Test de non-regression: Tester deduplication du fill `crossed`, agresseur inconnu, POC tie-break au prix inferieur, Value Area contigue, metriques Base/USD Notional, developing POC/niveaux de session precedente et reponses API partielles quand L2 manque.
- Fichiers a surveiller: `app_parts/27_routes_hyperliquid_analytics.py`, `workers/hyperliquid_market_worker.py`, `static/js/split/065_volume_profile.js`, `static/js/split/063a_hyperliquid_workspace.js`, `tests/test_hyperliquid_analytics.py`.


### BUG-20260601-22 - [RESOLU] Erreur de chargement zoneinfo et perte de donnees SQLite dans l'executable PyInstaller

- Symptome: 
  1. `ModuleNotFoundError: No module named 'zoneinfo'` au lancement du serveur package.
  2. Risque critique d'effacement complet des captures d'ecran et de la base de donnees SQLite `journal.db` a chaque fermeture de l'application.
- Cause racine:
  1. L'importation dynamique (`exec()`) des modules de `app_parts/` empechait l'analyseur statique de PyInstaller de detecter la dependance standard `zoneinfo`.
  2. L'application utilisait `sys._MEIPASS` (repertoire temporaire PyInstaller) comme base d'ecriture (`BASE_DIR`), qui est automatiquement purge par l'OS apres fermeture du processus.
- Regle de prevention:
  1. Toujours specifier explicitement les modules importes dynamiquement dans la directive `hiddenimports` du fichier `.spec` (ex: `zoneinfo`).
  2. Scinder strictement la gestion des repertoires : `RESOURCE_DIR` pour les ressources en lecture seule (templates/static decompresses dans `sys._MEIPASS`) et `BASE_DIR` pour l'ecriture utilisateur persistance (SQLite `journal.db`, screenshots, backups resolus via le dossier parent de l'executable `Path(sys.executable).parent`).
- Test de non-regression: Tests unitaires de `apps/desktop` validant la signature de `FlaskSpec`, et verification manuelle du demarrage et de l'ecriture en base via le sidecar `journal-server.exe`.
- Fichiers a surveiller: `app_parts/00_paths_constants.py`, `app_parts/01_flask_app.py`, `app_parts/07_routes_pages.py`, `app_parts/__init__.py`, `apps/desktop/pyinstaller/journal-server.spec`.

### BUG-20260602-01 - Sous-processus PyInstaller orphelins et acces ecriture restreint sous Windows Program Files

- Symptome: 
  1. Apres fermeture de la fenetre desktop, le sidecar `journal-server.exe` reste actif en arriere-plan et continue d'occuper le port 5001.
  2. Crash SQLite et erreurs de permissions d'ecriture lors de l'execution du binaire installe dans le repertoire par defaut Program Files.
- Cause racine: 
  1. Go standard `cmd.Process.Kill()` n'arrete que le bootloader PyInstaller parent sur Windows, laissant le processus Python sous-jacent orphelin sans mecanisme de terminaison automatique.
  2. L'application resolvait la racine d'ecriture `BASE_DIR` localement a l'emplacement de l'executable, qui possede des permissions restreintes en lecture seule lorsqu'il est installe via NSIS dans Program Files.
- Regle de prevention: 
  1. Toujours utiliser une terminaison d'arbre de processus (`taskkill /F /T /PID <pid>`) sur Windows lors de l'arret des sidecars pour forcer la fermeture propre de PyInstaller et de ses descendants.
  2. Separer strictement le mode portable (ecriture a cote des executables si `portable.mode` est detecte) et le mode installe (ecriture dynamique dans le repertoire specifique de l'utilisateur `%APPDATA%\CockpitV6\`).
- Test de non-regression: Lancer `build_portable.ps1`, verifier la presence de `portable.mode`, verifier la creation dynamique d'AppData et s'assurer qu'un CloseMainWindow ferme l'ensemble des PIDs enfants en liberant completement les ports 5001 et 8765.
- Fichiers a surveiller: `app_parts/00_paths_constants.py`, `app_parts/01_flask_app.py`, `apps/desktop/internal/launcher/process.go`, `apps/desktop/server_entry.py`.

### TASK-V6-001 - API Request Cache Utility (3 juin 2026)

- Objectif: Créer une utility de cache pour les requêtes API côté frontend, deduplicating les appels en-vol et cachant les réponses par URL.
- Problème adressé: 6x appels dupliqués aux endpoints `hyperliquid/*` lors du chargement simultané de plusieurs composants (orderflow, charts, wallet).
- Solution: `static/js/utilities/api-cache.js` avec:
  - Cache mémoire en-session (url -> { data, timestamp, pending })
  - Cache localStorage persistant entre reloads
  - Deduplication des promesses en-vol (retour du même Promise si requête en cours)
  - TTL configurable par requête (défaut: 5 secondes)
- Regle: Toute requête fetch répétée dans la même page doit passer par `V6OF.ApiCache.fetch(url, ttl)` pour éviter les appels dupliqués et réduire la latence réseau.
- Fichiers a surveiller: `static/js/utilities/api-cache.js`, intégration dans les modules qui font des appels répétés.

### BUG-20260603-10 - [RESOLU] Splash "backend ne repond pas" alors que Flask repond (fetch cross-origin bloque par CORS)

- Symptome:
  1. Au lancement de l'app desktop, le splash Wails affiche "Le serveur backend ne repond pas apres 12s" apres 20 tentatives.
  2. Cliquer manuellement sur le lien http://127.0.0.1:5001/ charge l'app instantanement - donc Flask repondait bien.
- Cause racine: Le health-check du splash (`apps/desktop/frontend/dist/index.html`) faisait `fetch("http://127.0.0.1:5001/")` depuis l'origine du webview Wails. La racine "/" de Flask ne renvoie d'en-tete CORS que pour les chemins `/api/` (voir `app_parts/01_flask_app.py` after_request), donc le navigateur bloquait le fetch cross-origin meme si le serveur renvoyait HTTP 200. Une navigation (clic sur le lien) n'est pas soumise au CORS, d'ou le contraste.
- Regle de prevention: Un health-check par `fetch` vers un serveur local d'une autre origine doit utiliser `mode: "no-cors"` (la promesse se resout des que le serveur est joignable, reponse opaque) OU le serveur doit exposer un en-tete CORS sur le chemin sonde. Ne jamais deduire "serveur down" d'un fetch cross-origin rejete sans avoir ecarte le CORS.
- Test de non-regression: Verifier que la racine Flask sans en-tete `Access-Control-Allow-Origin` (`curl -H "Origin: http://wails.localhost" http://127.0.0.1:5001/`) ne bloque plus le demarrage; le splash doit basculer sur l'app des que Flask repond.
- Fichiers a surveiller: `apps/desktop/frontend/dist/index.html`, `app_parts/01_flask_app.py`, `app_parts/18_launcher.py`.

### BUG-20260603-11 - [RESOLU] DOM Binance plafonne a 20 niveaux (stream partiel @depthN au lieu du diff @depth + snapshot REST)

- Symptome: Le carnet d'ordres (DOM/heatmap) Binance ne montrait jamais que ~20 niveaux; les murs de liquidite loin du prix etaient absents ou clignotaient, jamais fiables en continu.
- Cause racine: Le client s'abonnait au stream partiel `@depthN@100ms` (plafonne a 5/10/20 niveaux, snapshots jetables) au lieu de maintenir un carnet local complet. `MARKET_GO_BOOK_DEPTH=1000` et `HEATMAP_DEPTH=500` etaient donc fictifs - la donnee ne contenait jamais plus de 20 niveaux.
- Regle de prevention: Pour un carnet fiable, suivre l'algorithme documente "manage a local order book": stream diff `@depth@100ms` + snapshot REST initial (`lastUpdateId`) + buffer et validation de sequence (spot: U == prev_u+1 ; futures: pu == prev_u), application des deltas (qty=0 supprime le niveau), resync sur gap. Ne jamais traiter les snapshots du stream partiel comme un carnet complet.
- Test de non-regression: Tests unitaires de sequencage dans `services/market-go/internal/exchange/binance/book_test.go` (toutes les branches) + test d'integration live garde par `BINANCE_LIVE=1` (`live_test.go`) verifiant >= 100 niveaux/cote et un tri strict. Verifie live: spot 5006/5004, futures 1051/1024.
- Fichiers a surveiller: `services/market-go/internal/exchange/binance/book.go`, `depth.go`, `client.go`, `services/market-go/internal/config/config.go`, `services/market-go/internal/ws/server.go`.

### BUG-20260603-12 - [RESOLU] aggTrades Binance limit>1000 ne backfill pas les trades recents sans fenetre temporelle

- Symptome: Le replay affichait beaucoup plus de trades que le live/rest prefill; demander `/api/market/aggtrades?limit=8000` ne renvoyait qu'environ 1000 trades recents, donc le tape, le CVD et les volumes buy/sell du DOM restaient pauvres.
- Cause racine: L'endpoint Binance `aggTrades` sans `startTime` renvoie les derniers trades, puis la pagination par `fromId=lastId+1` part vers le futur. Augmenter `limit` seul ne peut donc pas recuperer les trades precedents. Le frontend attendait en plus parfois un tableau brut alors que la route Flask renvoie `{trades: [...]}`.
- Regle de prevention: Pour un backfill de trades recents, utiliser des fenetres temporelles courtes `startTime/endTime` en remontant dans le temps, puis normaliser le contrat `{id, tsExchange, price, qty, side}` avant d'alimenter tape, DOM et CVD. Ne jamais supposer que `limit>1000` donne automatiquement plus d'historique sur une API paginee.
- Test de non-regression: Verifier via Flask test client ou endpoint local que `/api/market/aggtrades?symbol=BTCUSDT&limit=8000&force=1` renvoie plusieurs pages et jusqu'a 8000 trades quand Binance fournit assez de donnees; verifier aussi le parseur frontend sur `{trades: [...]}` et tableau brut.
- Fichiers a surveiller: `app_parts/23_routes_market.py`, `static/js/split/073_v6_orderflow_layout.js`, `static/js/split/075_v6_dom_panel.js`, `static/js/split/076_v6_cvd_panel.js`, `static/js/split/078_v6_local_engine_client.js`.

### BUG-20260606-01 - [RESOLU] Signaux footprint divergents: deux algorithmes serveur + seuil exhaustion non pilote par l'UI

- Symptome:
  1. Le seuil `exhaustionFactor` etait declare et lu cote Go (`clientMsg`, `FootprintSignalConfig`) mais jamais envoye par l'UI (`buildFootprintConfigMsg` n'emettait que le trio imbalance), et il n'existait aucun controle UI - le client codait `0.35` en dur. L'engine retombait donc toujours sur son defaut, l'utilisateur ne pilotait pas l'exhaustion.
  2. `persistFootprintCandle` recalculait tous les signaux via un SECOND algorithme `calc.ComputeMetrics` (imbalance horizontale, exhaustion percentile p20, unfinished p80) qui divergeait de l'algorithme canonique `calc.DeriveFootprintSignals` (imbalance diagonale, exhaustion `avg*factor`, unfinished deux-cotes) deja porte par le candle. Le footprint persiste differait du live; masque uniquement parce que `encodeCandle` ne sert aucune metrique derivee (piege latent).
  3. Le rebuild (`RebuildFootprint1m`) reconstruisait les signaux avec les seuils PAR DEFAUT du calculateur, pas ceux synchronises depuis l'UI.
- Cause racine: Synchro UI->engine incomplete (un seul des 4 seuils non cable) + duplication d'algorithme metier (deux implementations independantes du meme concept qui ne se rejoignent sur aucune des 5 familles de signaux).
- Regle de prevention: Pour toute etude derivee cote serveur, (a) chaque seuil que l'engine consomme DOIT etre pilote de bout en bout par l'UI (DEFAULTS/validate, lecture dans deriveMetrics client, message `footprint_config`, controle UI) - pas de champ backend "a moitie cable"; (b) UNE seule source de verite par signal: persister/rebuilder doit reutiliser les valeurs deja derivees par `DeriveFootprintSignals` (mapping direct candle->record), jamais recalculer avec un autre algorithme; (c) les chemins offline (persist, rebuild) lisent la config synchronisee du moteur via `Engine.FootprintSignalConfig()`. Supprimer tout algorithme concurrent des qu'il devient redondant.
- Test de non-regression: `tests/test_orderflow_footprint_config.py` (exhaustionFactor envoye/par defaut/au changement); `services/market-go/internal/ws/persist_footprint_test.go` (persist conserve les signaux engine sans recalcul, derive defensive si SignalsDerived absent, rebuild honore le seuil synchronise via flip exhaustion 0.05 vs 0.9). `go test ./internal/calc/ ./internal/ws/ ./internal/engine/`.
- Fichiers a surveiller: `services/market-go/internal/calc/footprint_signals.go`, `services/market-go/internal/ws/server.go` (persistFootprintCandle + RebuildFootprint1m), `services/market-go/internal/engine/engine.go` (FootprintSignalConfig), `static/js/split/078_v6_local_engine_client.js`, `079_v6_orderflow_settings.js`, `081_v6_orderflow_inspector.js`, `073_v6_orderflow_layout.js`.

### BUG-20260606-02 - [RESOLU] CORS market-go ouvert sur * + origine HTTP derivee de l'URL WebSocket

- Symptome:
  1. Le serveur market-go renvoyait `Access-Control-Allow-Origin: *` pour TOUTE origine (middleware global dans `Handler()` + handler `/replay`), exposant l'API footprint/replay a n'importe quel site.
  2. Le fetch d'historique footprint cote frontend fabriquait son origine HTTP en mutilant l'URL WebSocket (`resolveMarketUrl` swappait `ws->http` et strippait `/stream`), couplant deux transports distincts.
- Cause racine: CORS wildcard non scope + absence de config transport HTTP de premier ordre (l'origine HTTP n'existait pas comme valeur configurable, seulement derivee du WS).
- Regle de prevention: (a) Ne jamais emettre `Access-Control-Allow-Origin: *` par defaut. Refletter l'origine seulement si elle est loopback (`localhost`/`127.0.0.1`/`::1`) via `url.Parse(...).Hostname()` -- JAMAIS un `HasPrefix("http://localhost")` qui laisserait passer `http://localhost.attacker.com`. Ajouter `Vary: Origin` quand on reflete. Wildcard reserve a un opt-in explicite (`MARKET_GO_ALLOWED_ORIGINS=*`). Meme logique cote Flask (`app_parts/01_flask_app.py`). (b) Une origine HTTP de service est une config de premier ordre (`COCKPIT_CONFIG.marketHttpUrl` / `COCKPIT_MARKET_HTTP_URL`), pas un derive d'une autre couche transport; garder la derivation WS uniquement en fallback.
- Test de non-regression: `services/market-go/internal/ws/cors_test.go` (loopback reflete, cross-origin rejete, spoof `localhost.attacker.com` rejete, no-Origin sans header, allowlist explicite, wildcard opt-in, preflight 204); `internal/config/config_test.go` (parsing `MARKET_GO_ALLOWED_ORIGINS`); `tests/test_api_cors.py` (Flask) et `tests/test_orderflow_transport_url.py` + `tests/test_template_render.py` (origine HTTP injectee/independante).
- Fichiers a surveiller: `services/market-go/internal/ws/server.go` (resolveAllowedOrigin/isLoopbackOrigin), `services/market-go/internal/config/config.go` (AllowedOrigins), `app_parts/01_flask_app.py`, `app_parts/07_routes_pages.py` (marketHttpUrl), `static/js/split/078_v6_local_engine_client.js` (configuredMarketHttpUrl/resolveMarketUrl).

### CONVENTION-20260607-01 - Decomposition du god-object ws.Server (pur refactor incremental)

- Contexte: `internal/ws/server.go` (2000 lignes) concentrait 7 responsabilites. Spec: `docs/superpowers/specs/2026-06-07-ws-server-decomposition-design.md`. Refactor behavior-preserving, un type dedie par responsabilite dans le package `ws`, Server = orchestrateur. Tests verts (Go + Python) entre chaque etape.
- Regle: chaque composant possede son etat et expose une API etroite; les dependances transverses passent par injection (interface `broadcaster`, accesseurs `func()`), jamais par acces direct aux champs de Server. Le CVD-par-symbole n'est qu'un accumulateur ecrit par la persistence footprint (pas lu par l'historique CVD qui recalcule depuis les trades).
- Etat (ordre d'extraction): [x] 1 cvdTracker · [x] 2 tradeStore · [x] 3 footprintStore · [x] 4 klineBackfiller · [x] 5 replayController · [x] 6 exchangeManager · [x] 7 Server aminci (server.go 2000->640 lignes; plomberie WS bas-niveau dans wsconn.go). TERMINE.
- Piege rencontre (etape 6): `switchExchange` mute `cfg.Exchange` ET `cfg.Symbols` a l'execution. Les composants qui lisent ces champs mutables (tradeStore, exchangeManager) doivent partager `*config.Config` (= `&s.cfg`), sinon une copie par valeur fige l'exchange et le source_switch ne se propage pas. klineBackfiller/footprintStore ne lisent que des champs immuables -> copie par valeur OK. Le pipeline Hyperliquid live est inline (pas de persist footprint, contrairement a replayEmit) -> preserve tel quel.
- Gate par etape: `go build ./... && go vet ./... && go test ./internal/{calc,config,engine,ws}/` (le package `ws` isole; le panic flaky `TestStreamEndpointUpgrades` n'apparait qu'en `go test ./...` complet et est pre-existant) + suite Python orderflow/cors/transport.
- Fichiers a surveiller: `services/market-go/internal/ws/*.go` (cvd_tracker.go, trade_store.go, footprint_store.go, kline_backfiller.go, replay_controller.go, exchange_manager.go, server.go).

### BUG-20260607-01 - [RESOLU] Theme clair/sombre incoherent et limite de bougies d'historique bridee a 1000/3000

- Symptome:
  1. L'espace de travail Orderflow conservait des elements blancs/clairs (canevas de graphe, barre de dessin gauche, loaders squelettes) incoherents avec le reste de l'UI cockpit v6 sombre, a cause de regles "Light Theme Preservations" forcees en CSS et d'un defaut settings initialise sur `light-tv` avec `#ffffff`.
  2. Augmenter le nombre max de bougies (`footprintMaxCandles`) au-dela de 3000 etait ignore ou tronque, a la fois cote frontend (clamps a 3000 dans les settings/UI/engine) et cote backend (constante `_KLINES_MAX_LIMIT = 1000` clampant le fetch proxy Binance).
- Cause racine: Ciel et terre separes: les variables de theme n'etaient pas homogenes (presence de regles overrides hardcodees) + la limite max de bougies etait bridee de maniere redundante a chaque couche (settings schema, store validation, UI input, engine client, backend controller).
- Regle de prevention: (a) Pour garantir une theme unifie, bannir les overrides CSS `!important` avec des couleurs absolues (ex. `#ffffff`); utiliser des variables de theme (`var(--v6-bg)`, `var(--v6-bg-2)`) et forcer le dataset theme (`root.dataset.v6Theme = 'dark-tv'`) lors de l'hydration. (b) Pour augmenter une limite de donnees d'historique (ex. candles, trades), synchroniser l'augmentation a travers toutes les couches de validation (schema settings, layout input slider clamps, local client, et constante backend `_KLINES_MAX_LIMIT` de pagination).
- Test de non-regression: `tests/test_playbook_lessons_guardrails.py` (cette verif); `tests/test_user_settings_routes.py` et les suites orderflow; verifier en executant build.py et en verifiant que `_KLINES_MAX_LIMIT` est a `5000` et `max` dans settings est a `5000`.
- Fichiers a surveiller: `app_parts/23_routes_market.py`, `static/js/split/079_v6_orderflow_settings.js`, `static/js/split/072_v6_orderflow_helpers.js`, `static/js/split/073_v6_orderflow_layout.js`, `static/js/split/078_v6_local_engine_client.js`, `static/js/split/081_v6_orderflow_inspector.js`, `static/css/split/072_v6_orderflow_refactor.css`.


