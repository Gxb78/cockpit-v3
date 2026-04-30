# Bug Fix + Refacto Frontend — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Réparer l'affichage central cassé sur desktop, puis décomposer les deux monolithes frontend (app.js 5099 lignes, style.css 4552 lignes) en modules individuels déjà existants dans static/js/split/ et static/css/split/.

**Architecture:** Le bug est un bloc CSS "guardrail" contradictoire ajouté en fin de style.css et dans 026_trade_card_pm_btn_hover.css — on le supprime. Les fichiers split sont les sources canoniques ; on fait pointer le HTML directement dessus (27 CSS + 46 JS) pour ne plus avoir de monolithes. Un build.py simple permet de régénérer les bundles si besoin.

**Tech Stack:** Flask (Python), HTML Jinja2 templates, CSS vanilla, JS vanilla (global scope, chargement ordonné par préfixe numérique), Python 3 pour build.py.

---

## SECTION 1 — Bug Fix CSS

### Task 1 : Nettoyer 026_trade_card_pm_btn_hover.css

**Files:**
- Modify: `static/css/split/026_trade_card_pm_btn_hover.css`

- [ ] **Step 1 : Inspecter le bug en DevTools**

  Ouvrir l'app (`start.bat`), F12 → onglet **Elements** → sélectionner `<section class="page active" data-page="today">` → onglet **Styles** → repérer la règle `display: none !important` qui gagne et noter sa ligne dans `style.css`. Confirme que c'est le bloc guardrail (lignes 4491–4552).

- [ ] **Step 2 : Réduire 026_trade_card_pm_btn_hover.css aux 9 premières lignes**

  Le fichier doit contenir **uniquement** :

  ```css
  .trade-card-pm-btn:hover { border-color: var(--amber); background: rgba(255,170,0,0.07); }
  .trade-card-pm-btn svg { width: 12px; height: 12px; }

  /* Divider inside steps */
  .wiz-divider {
    height: 1px;
    background: var(--border);
    margin: 16px 0;
  }
  ```

  Tout ce qui suit (commentaire `Runtime guardrails` + les 62 lignes de règles) est **supprimé**.

---

### Task 2 : Nettoyer style.css

**Files:**
- Modify: `static/style.css`

- [ ] **Step 1 : Supprimer le bloc guardrail de style.css**

  Dans `static/style.css`, supprimer depuis la ligne 4490 (ligne vide avant le commentaire) jusqu'à la fin du fichier. Le fichier se termine après la dernière règle légitime qui précède le commentaire `Runtime guardrails`.

  Concrètement : ouvrir le fichier, aller à la ligne 4490, supprimer tout jusqu'à la ligne 4552 (fin de fichier). Le fichier doit maintenant faire **~4489 lignes** et se terminer sur une règle CSS normale (vérifier que la dernière ligne est une accolade fermante `}`).

- [ ] **Step 2 : Vérifier qu'aucune occurrence de `force-pages-visible` ne subsiste dans style.css**

  Lancer :
  ```bash
  python -c "txt=open('static/style.css',encoding='utf-8').read(); print('OK' if 'force-pages-visible' not in txt and 'guardrail' not in txt.lower() else 'FAIL')"
  ```
  Résultat attendu : `OK`

---

### Task 3 : Simplifier scripts.html

**Files:**
- Modify: `templates/partials/overlays/scripts.html`

- [ ] **Step 1 : Remplacer le contenu de scripts.html**

  Le fichier doit contenir **exactement** :

  ```html
  <script>
  document.addEventListener("DOMContentLoaded", function () {
    try {
      var pages = document.querySelectorAll(".main .page");
      var hasActive = false;
      for (var i = 0; i < pages.length; i++) {
        if (pages[i].classList.contains("active")) { hasActive = true; break; }
      }
      if (!hasActive) {
        var today = document.querySelector('.main .page[data-page="today"]');
        if (today) today.classList.add("active");
      }
    } catch (_) {}
  });
  </script>
  <script src="/static/app.js?v=20260428bundlefix4"></script>
  ```

  Le second bloc `<script>` (fonction `rescue`, `hasVisiblePage`, `forceToday`, `force-pages-visible`) est **supprimé**.

---

### Task 4 : Tester le bug fix et committer

**Files:**
- Test: `tests/test_template_render.py`

- [ ] **Step 1 : Lancer les tests existants**

  ```bash
  python -m pytest tests/ -v
  ```
  Résultat attendu : tous les tests passent (le test `test_index_renders_with_runtime_assets` vérifie que `/static/app.js?v=20260428bundlefix4` est encore dans le HTML — c'est correct à ce stade).

- [ ] **Step 2 : Test visuel navigateur**

  Ouvrir `http://127.0.0.1:5000` en desktop (fenêtre > 821px large). Vérifier :
  - La page Today affiche le header, les KPIs, la grille
  - Navigation vers Journal, Stats, Settings fonctionne
  - Rétrécir la fenêtre < 820px → tout s'affiche aussi en mobile

- [ ] **Step 3 : Committer**

  ```bash
  git init  # si le repo n'existe pas encore
  git add static/style.css static/css/split/026_trade_card_pm_btn_hover.css templates/partials/overlays/scripts.html
  git commit -m "fix: supprimer les guardrails CSS contradictoires qui masquaient le contenu desktop"
  ```

---

## SECTION 2 — Refacto CSS (chargement des split files)

### Task 5 : Mettre à jour le test pour le nouveau chargement CSS

**Files:**
- Modify: `tests/test_template_render.py`

- [ ] **Step 1 : Écrire l'assertion qui échouera (TDD)**

  Dans `tests/test_template_render.py`, remplacer la ligne :
  ```python
  self.assertIn('/static/style.css?v=20260428bundlefix4', html)
  ```
  par :
  ```python
  self.assertIn('/static/css/split/000_module.css', html)
  self.assertIn('/static/css/split/026_trade_card_pm_btn_hover.css', html)
  self.assertNotIn('/static/style.css', html)
  ```

- [ ] **Step 2 : Vérifier que le test échoue**

  ```bash
  python -m pytest tests/test_template_render.py -v
  ```
  Résultat attendu : `FAILED` — `AssertionError: '/static/css/split/000_module.css' not found in html`

---

### Task 6 : Faire pointer le HTML sur les fichiers CSS split

**Files:**
- Modify: `templates/partials/layout/head_assets_css.html`

- [ ] **Step 1 : Remplacer head_assets_css.html**

  Le fichier doit contenir **exactement** (27 lignes) :

  ```html
  <link rel="stylesheet" href="/static/css/split/000_module.css" />
  <link rel="stylesheet" href="/static/css/split/001_cockpit_grid.css" />
  <link rel="stylesheet" href="/static/css/split/002_instr_chip_hover.css" />
  <link rel="stylesheet" href="/static/css/split/003_settings_chip_remove_hover.css" />
  <link rel="stylesheet" href="/static/css/split/004_cta_add_svg.css" />
  <link rel="stylesheet" href="/static/css/split/005_module.css" />
  <link rel="stylesheet" href="/static/css/split/006_btn_icon_svg.css" />
  <link rel="stylesheet" href="/static/css/split/007_day_hover_before.css" />
  <link rel="stylesheet" href="/static/css/split/008_day_mode_trades_day_metric_sub.css" />
  <link rel="stylesheet" href="/static/css/split/009_chart_tt_value_pos.css" />
  <link rel="stylesheet" href="/static/css/split/010_heatmap_row_labels_span.css" />
  <link rel="stylesheet" href="/static/css/split/011_chunk.css" />
  <link rel="stylesheet" href="/static/css/split/012_modal_body.css" />
  <link rel="stylesheet" href="/static/css/split/013_field_input_disabled_placeholder.css" />
  <link rel="stylesheet" href="/static/css/split/014_shot_hover_shot_x.css" />
  <link rel="stylesheet" href="/static/css/split/015_cmdk_input_placeholder.css" />
  <link rel="stylesheet" href="/static/css/split/016_module.css" />
  <link rel="stylesheet" href="/static/css/split/017_field_toggle_svg.css" />
  <link rel="stylesheet" href="/static/css/split/018_templates_menu_hidden.css" />
  <link rel="stylesheet" href="/static/css/split/019_module.css" />
  <link rel="stylesheet" href="/static/css/split/020_narration_parse_btn_svg.css" />
  <link rel="stylesheet" href="/static/css/split/021_btn_add_trade_svg.css" />
  <link rel="stylesheet" href="/static/css/split/022_chunk.css" />
  <link rel="stylesheet" href="/static/css/split/023_wiz_hidden.css" />
  <link rel="stylesheet" href="/static/css/split/024_wiz_card_hover.css" />
  <link rel="stylesheet" href="/static/css/split/025_chunk.css" />
  <link rel="stylesheet" href="/static/css/split/026_trade_card_pm_btn_hover.css" />
  ```

---

### Task 7 : Valider, supprimer le monolithe CSS, committer

**Files:**
- Delete: `static/style.css`

- [ ] **Step 1 : Lancer les tests**

  ```bash
  python -m pytest tests/test_template_render.py -v
  ```
  Résultat attendu : `PASSED`

- [ ] **Step 2 : Test visuel navigateur**

  Hard-refresh (Ctrl+Shift+R) sur `http://127.0.0.1:5000`. Vérifier :
  - Rendu identique à avant (layout, couleurs, fonts)
  - Desktop + mobile visuellement identiques
  - Modal d'entrée, wizard, stats : pas de régression visuelle

- [ ] **Step 3 : Supprimer style.css**

  ```bash
  rm static/style.css
  ```

- [ ] **Step 4 : Relancer les tests pour confirmer rien ne dépend de style.css**

  ```bash
  python -m pytest tests/ -v
  ```
  Résultat attendu : tous les tests passent.

- [ ] **Step 5 : Committer**

  ```bash
  git add templates/partials/layout/head_assets_css.html tests/test_template_render.py
  git rm static/style.css
  git commit -m "refactor: charger les 27 modules CSS split à la place du bundle style.css"
  ```

---

## SECTION 3 — Refacto JS (chargement des split files)

### Task 8 : Mettre à jour le test pour le nouveau chargement JS

**Files:**
- Modify: `tests/test_template_render.py`

- [ ] **Step 1 : Écrire l'assertion qui échouera (TDD)**

  Dans `tests/test_template_render.py`, remplacer la ligne :
  ```python
  self.assertIn('/static/app.js?v=20260428bundlefix4', html)
  ```
  par :
  ```python
  self.assertIn('/static/js/split/000_module.js', html)
  self.assertIn('/static/js/split/045_bindwizard.js', html)
  self.assertNotIn('/static/app.js', html)
  ```

- [ ] **Step 2 : Vérifier que le test échoue**

  ```bash
  python -m pytest tests/test_template_render.py -v
  ```
  Résultat attendu : `FAILED` — `AssertionError: '/static/js/split/000_module.js' not found in html`

---

### Task 9 : Faire pointer le HTML sur les fichiers JS split

**Files:**
- Modify: `templates/partials/overlays/scripts.html`

- [ ] **Step 1 : Remplacer scripts.html**

  Le fichier doit contenir **exactement** :

  ```html
  <script>
  document.addEventListener("DOMContentLoaded", function () {
    try {
      var pages = document.querySelectorAll(".main .page");
      var hasActive = false;
      for (var i = 0; i < pages.length; i++) {
        if (pages[i].classList.contains("active")) { hasActive = true; break; }
      }
      if (!hasActive) {
        var today = document.querySelector('.main .page[data-page="today"]');
        if (today) today.classList.add("active");
      }
    } catch (_) {}
  });
  </script>
  <script src="/static/js/split/000_module.js"></script>
  <script src="/static/js/split/001_utilities.js"></script>
  <script src="/static/js/split/002_prettify.js"></script>
  <script src="/static/js/split/003_addcustomstrategyfromsettings.js"></script>
  <script src="/static/js/split/004_loadjournaltablesort.js"></script>
  <script src="/static/js/split/005_setjournalcustomrange.js"></script>
  <script src="/static/js/split/006_comparetext.js"></script>
  <script src="/static/js/split/007_loadcalendarmonthfocusmode.js"></script>
  <script src="/static/js/split/008_boot.js"></script>
  <script src="/static/js/split/009_navigation.js"></script>
  <script src="/static/js/split/010_filter.js"></script>
  <script src="/static/js/split/011_calendar_nav.js"></script>
  <script src="/static/js/split/012_data_loading.js"></script>
  <script src="/static/js/split/013_kpis.js"></script>
  <script src="/static/js/split/014_today_page.js"></script>
  <script src="/static/js/split/015_calendar.js"></script>
  <script src="/static/js/split/016_openpickerfordate.js"></script>
  <script src="/static/js/split/017_modal_gestion_globale.js"></script>
  <script src="/static/js/split/018_day_form.js"></script>
  <script src="/static/js/split/019_trades_list_dans_la_modal.js"></script>
  <script src="/static/js/split/020_trade_form.js"></script>
  <script src="/static/js/split/021_rr_preview.js"></script>
  <script src="/static/js/split/022_pills.js"></script>
  <script src="/static/js/split/023_quality_stars.js"></script>
  <script src="/static/js/split/024_tags_input.js"></script>
  <script src="/static/js/split/025_screenshots.js"></script>
  <script src="/static/js/split/026_autosave_du_jour.js"></script>
  <script src="/static/js/split/027_export.js"></script>
  <script src="/static/js/split/028_global_keys.js"></script>
  <script src="/static/js/split/029_command_palette.js"></script>
  <script src="/static/js/split/030_stats.js"></script>
  <script src="/static/js/split/031_heatmap.js"></script>
  <script src="/static/js/split/032_breakdowns.js"></script>
  <script src="/static/js/split/033_renderdrawdownchart.js"></script>
  <script src="/static/js/split/034_cumulative_chart_canvas.js"></script>
  <script src="/static/js/split/035_initblocks.js"></script>
  <script src="/static/js/split/036_markdown_preview.js"></script>
  <script src="/static/js/split/037_hashtag_auto_extraction.js"></script>
  <script src="/static/js/split/038_custom_blocks.js"></script>
  <script src="/static/js/split/039_helpers.js"></script>
  <script src="/static/js/split/040_module.js"></script>
  <script src="/static/js/split/041_wizskip.js"></script>
  <script src="/static/js/split/042_wizsetdate.js"></script>
  <script src="/static/js/split/043_wizsetdir.js"></script>
  <script src="/static/js/split/044_wizreadfileasdataurl.js"></script>
  <script src="/static/js/split/045_bindwizard.js"></script>
  ```

---

### Task 10 : Valider, supprimer le monolithe JS, committer

**Files:**
- Delete: `static/app.js`

- [ ] **Step 1 : Lancer les tests**

  ```bash
  python -m pytest tests/test_template_render.py -v
  ```
  Résultat attendu : `PASSED`

- [ ] **Step 2 : Test fonctionnel navigateur (checklist)**

  Hard-refresh (Ctrl+Shift+R). Vérifier dans cet ordre :
  1. Page Today s'affiche avec KPIs et grille
  2. Navigation Today → Journal → Stats → Settings → Today
  3. Ouvrir la modal d'ajout (bouton "Nouvelle entrée") → remplir un champ → fermer
  4. Ouvrir le wizard (bouton "Logger ta journée") → vérifier que les étapes défilent
  5. Ouvrir la command palette (Cmd/Ctrl+K) → taper un caractère → fermer
  6. Vérifier la console navigateur : **aucune erreur rouge**

- [ ] **Step 3 : Supprimer app.js**

  ```bash
  rm static/app.js
  ```

- [ ] **Step 4 : Relancer la suite de tests complète**

  ```bash
  python -m pytest tests/ -v
  ```
  Résultat attendu : tous les tests passent.

- [ ] **Step 5 : Committer**

  ```bash
  git add templates/partials/overlays/scripts.html tests/test_template_render.py
  git rm static/app.js
  git commit -m "refactor: charger les 46 modules JS split à la place du bundle app.js"
  ```

---

## SECTION 4 — Build pipeline minimal

### Task 11 : Créer build.py

**Files:**
- Create: `build.py`

- [ ] **Step 1 : Créer build.py à la racine**

  ```python
  """
  Concatene static/js/split/*.js  -> static/app.js
  et       static/css/split/*.css -> static/style.css

  Usage:
    python build.py           # rebuild JS + CSS
    python build.py --js      # rebuild JS seulement
    python build.py --css     # rebuild CSS seulement

  Pour ajouter un module:
    - JS  : creer static/js/split/NNN_name.js  (NNN = prochain numero)
    - CSS : creer static/css/split/NNN_name.css
    - Lancer python build.py pour rebundler
  """

  import sys
  from pathlib import Path

  ROOT = Path(__file__).parent


  def build(src_dir, out_path, ext, marker_fmt):
      files = sorted(src_dir.glob(f"*.{ext}"))
      parts = []
      for f in files:
          parts.append(marker_fmt.format(name=f.name))
          parts.append(f.read_text(encoding="utf-8"))
      out_path.write_text("\n".join(parts), encoding="utf-8")
      print(f"Built {out_path.name}: {len(files)} modules, {out_path.stat().st_size} bytes")


  def build_js():
      build(
          ROOT / "static" / "js" / "split",
          ROOT / "static" / "app.js",
          "js",
          "// ---- {name} ----",
      )


  def build_css():
      build(
          ROOT / "static" / "css" / "split",
          ROOT / "static" / "style.css",
          "css",
          "/* ---- {name} ---- */",
      )


  if __name__ == "__main__":
      args = sys.argv[1:]
      do_css = not args or "--css" in args
      do_js  = not args or "--js"  in args
      if do_css: build_css()
      if do_js:  build_js()
  ```

- [ ] **Step 2 : Tester build.py**

  ```bash
  python build.py
  ```
  Résultat attendu :
  ```
  Built style.css: 27 modules, XXXXXX bytes
  Built app.js: 46 modules, XXXXXX bytes
  ```
  Vérifier que les fichiers générés existent : `ls -lh static/app.js static/style.css`

- [ ] **Step 3 : Supprimer les bundles générés (pas nécessaires en dev)**

  ```bash
  rm static/app.js static/style.css
  ```
  L'app continue de fonctionner via les splits — les bundles ne sont là que pour une éventuelle mise en prod.

---

### Task 12 : Mettre à jour start.bat et committer

**Files:**
- Modify: `start.bat`

- [ ] **Step 1 : Ajouter le mode build à start.bat**

  Après la ligne `@echo off` et avant `cd /d "%~dp0"`, ajouter :

  ```bat
  @echo off
  cd /d "%~dp0"

  REM Mode build: start.bat build  -> regenere static/app.js et static/style.css depuis les splits
  if "%1"=="build" (
      echo ============================================
      echo   Trading Journal - Build des bundles
      echo ============================================
      call .venv\Scripts\activate.bat 2>nul
      python build.py
      echo.
      echo Bundles regeneres dans static/app.js et static/style.css
      pause
      exit /b 0
  )
  ```

  Le reste du fichier reste inchangé.

- [ ] **Step 2 : Tester le mode build**

  ```bat
  start.bat build
  ```
  Résultat attendu : affiche "Built style.css: 27 modules" + "Built app.js: 46 modules", puis pause.

- [ ] **Step 3 : Suite de tests finale**

  ```bash
  python -m pytest tests/ -v
  ```
  Résultat attendu : tous les tests passent.

- [ ] **Step 4 : Commit final**

  ```bash
  git add build.py start.bat
  git commit -m "feat: ajouter build.py pour regenerer les bundles depuis les splits"
  ```

---

## Checklist de validation finale

Après les 4 sections :

- [ ] `static/app.js` n'existe plus (ou seulement si généré par `build.py`)
- [ ] `static/style.css` n'existe plus (ou seulement si généré par `build.py`)
- [ ] Aucun fichier dans `static/js/split/` ou `static/css/split/` ne dépasse 400 lignes
- [ ] `python -m pytest tests/ -v` → 100% pass
- [ ] Console navigateur : aucune erreur sur les 4 pages
- [ ] Navigation desktop + mobile : contenu visible sur toutes les pages
