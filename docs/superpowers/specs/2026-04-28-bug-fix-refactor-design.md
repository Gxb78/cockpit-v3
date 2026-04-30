# COCKPIT v3 — Bug Fix + Refacto Frontend

**Date :** 2026-04-28
**Statut :** Approuvé, prêt pour implémentation

---

## Contexte

Application Flask de journal de trading (COCKPIT v3). Après une refacto, l'affichage central (page Today) a disparu sur desktop — la zone centrale est noire. Sur mobile / petite fenêtre, le contenu s'affiche correctement. Aucune erreur JavaScript en console.

En parallèle, les deux fichiers frontend monolithiques dépassent largement la limite de maintenabilité :
- `static/app.js` → 5099 lignes
- `static/style.css` → 4552 lignes

Les versions découpées existent déjà (`static/js/split/` 46 fichiers, `static/css/split/` 27 fichiers) mais le HTML pointe encore sur les bundles.

---

## Diagnostic du bug

Le bloc "guardrail" CSS ajouté récemment à la fin de `static/style.css` (lignes 4491–4552) contient :
- Des règles `!important` contradictoires sur la visibilité des `.page`
- Un `@media (min-width: 821px)` avec `align-items: start` sur `.cockpit` qui perturbe le layout grid sur desktop
- Le même bloc est dupliqué dans `static/css/split/026_trade_card_pm_btn_hover.css`

Le mécanisme original (`.page { display: none }` + `.page.active { display: block }`) fonctionnait. Le guardrail l'a cassé.

---

## Architecture cible

### Ce qui ne change PAS
- Backend Python (`app_parts/`) — déjà bien découpé, aucune intervention
- Templates HTML (`templates/partials/`) — déjà bien découpés, structure conservée
- Base de données SQLite, routes Flask

### Ce qui change
- `static/style.css` → supprimé (remplacé par les 27 fichiers split)
- `static/app.js` → supprimé (remplacé par les 46 fichiers split)
- `templates/partials/layout/head_assets_css.html` → liste les 27 CSS splits
- `templates/partials/overlays/scripts.html` → liste les 46 JS splits, sans le bloc rescue complexe
- `build.py` (nouveau) → script de rebundling si besoin

### Règle de taille
Aucun fichier source ne doit dépasser 2000 lignes. Les 27 CSS splits font 50–150 lignes chacun. Les 46 JS splits font 30–300 lignes chacun. La règle est respectée sans découpage supplémentaire.

---

## Plan d'implémentation (4 sections)

### Section 1 — Bug Fix CSS (~20 min)
**Fichiers :** `static/style.css`, `static/css/split/026_trade_card_pm_btn_hover.css`, `templates/partials/overlays/scripts.html`

1. Vérification DevTools : inspecter `<section class="page active" data-page="today">` → confirmer la règle CSS gagnante
2. `static/style.css` : supprimer lignes 4491–4552 (bloc guardrail complet)
3. `026_trade_card_pm_btn_hover.css` : supprimer le bloc guardrail (lignes 11–73), garder `.trade-card-pm-btn:hover` et `.wiz-divider`
4. `scripts.html` : supprimer le second `<script>` (fonction `rescue` + `force-pages-visible`)
5. Test desktop + mobile + navigation 4 pages

### Section 2 — Refacto CSS (~30 min)
**Fichiers :** `templates/partials/layout/head_assets_css.html`

1. Remplacer le `<link>` unique vers `style.css` par 27 `<link>` vers `static/css/split/000_module.css` … `026_trade_card_pm_btn_hover.css` (ordre numérique)
2. Vérification visuelle desktop + mobile
3. Supprimer `static/style.css`

### Section 3 — Refacto JS (~30 min)
**Fichiers :** `templates/partials/overlays/scripts.html`

1. Remplacer `<script src="/static/app.js">` par 46 `<script>` vers `static/js/split/000_module.js` … `045_bindwizard.js` (ordre numérique)
2. Test fonctionnel complet (navigation, calendar, journal, wizard, command palette, stats)
3. Supprimer `static/app.js`

### Section 4 — Build pipeline (~20 min)
**Fichiers :** `build.py` (nouveau), `start.bat`

1. `build.py` : concatenation ordonnée des splits → bundles, génération token version YYYYMMDD
2. `start.bat` : ajout mode `build` optionnel
3. Documentation inline dans `build.py` pour ajouter un nouveau module

---

## Fichiers touchés (résumé)

| Section | Modifiés | Supprimés | Créés |
|---|---|---|---|
| 1 Bug | `style.css`, `026_trade_card_pm_btn_hover.css`, `scripts.html` | — | — |
| 2 CSS | `head_assets_css.html` | `style.css` | — |
| 3 JS | `scripts.html` | `app.js` | — |
| 4 Build | `start.bat` | — | `build.py` |

Aucun fichier Python backend, aucune route Flask, aucun template de contenu n'est modifié.

---

## Risques et mitigations

| Risque | Mitigation |
|---|---|
| Ordre de chargement JS incorrect | Les fichiers sont préfixés numériquement 000–045, l'ordre est garanti |
| Cache navigateur après changement | Incrémenter le token de version sur chaque fichier split |
| Régression visuelle CSS | Test visuel systématique desktop + mobile après Section 2 avant de passer à Section 3 |
| Fonction JS appelée avant définition | Vérifier la console après Section 3 — les split files respectent déjà cet ordre |
