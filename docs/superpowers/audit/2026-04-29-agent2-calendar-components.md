# Agent #2 — CALENDRIER & COMPOSANTS : Audit + Propositions

## Problème central
L'utilisateur signale que le calendrier est devenu « plus moche » et l'ambiance « moins sombre ». J'ai analysé les fichiers CSS du calendrier (005, 006, 007, 008, 018, 028, 003) et les templates Jinja pour identifier les causes racines.

---

## 1. CALENDRIER JOURNAL (grille 7 colonnes, day cards)

### 1.1 Ce qui cloche

**A. Fond des day cards trop « magenta lourd » (cause principale du « moins sombre »)**
```css
/* CURRENT — fichier 006, lignes 213-216 */
.day {
  background:
    radial-gradient(120% 120% at 100% 0%, rgba(255,46,196,0.08), transparent 40%),
    linear-gradient(145deg, rgba(11,13,26,0.95), rgba(10,12,24,0.88));
  border: 1px solid rgba(255, 255, 255, 0.12);
}
```
La radial-gradient magenta (0.08 → 0) crée un « lavis rose » sur chaque case. Cumulé sur 28-31 cases, ça éclaircit visuellement toute la grille et donne un aspect « ecchymose » plutôt que deep space. Le border `rgba(255,255,255,0.12)` ajoute 28-31 fines lignes claires qui cassent l'unité sombre.

**B. Gain gap trop grand**
```css
/* 006 ligne 23 */
.calendar-grid { gap: 8px; }
/* mobile 018 ligne 202 — 6px */
```
Avec 7 colonnes, un gap de 8px crée 48px d'espace mort horizontal et ~200px vertical. Ça disjoint la grille et réduit la lisibilité des métriques.

**C. Aucune hiérarchie visuelle des jours avec trades**
Les jours win/loss ont certes des backgrounds différents, mais les jours « à PnL important » ne se distinguent pas visuellement des jours à petit PnL. Tout est uniforme.

**D. Le .day:hover ::before ajoute un overlay cyan/magenta**
```css
/* 007 ligne 1-5 */
.day::before {
  background: linear-gradient(145deg, rgba(0,229,255,0.08), transparent 45%, rgba(255,46,196,0.06));
  opacity: 0;
}
.day:hover::before { opacity: 1; }
```
Au hover, chaque jour devient subitement plus clair → l'utilisateur perçoit l'interface comme « moins sombre ».

**E. La bordure .today est trop agressive**
```css
/* 007 lignes 8-10 */
.day.today {
  border-color: rgba(0,229,255,0.9);
  box-shadow: 0 0 0 1px rgba(0,229,255,0.85), 0 0 22px rgba(0,229,255,0.26);
}
```
Opacité 0.9 = quasiment plein cyan. Ça attire trop l'œil et écrase la lisibilité des métriques du jour courant.

**F. Taille des métriques instable**
- `.day-metric-pnl` en mode PnL: `clamp(24px, 1.62vw, 34px)` 
- `.mode-trades .day-metric-trades`: `clamp(36px, 2.25vw, 54px)` → 2× plus gros
- `.mode-both .day-metric-pnl`: `clamp(18px, 1.24vw, 24px)` → plus petit
Ces écarts créent des « sauts visuels » quand on change de mode.

### 1.2 Propositions correctives

**A. Assombrir et unifier les fonds — enlever le magenta des fonds neutres**
Remplacer le fond des `.day` par un dégradé plus sobre, purement deep space :
```css
/* PROPOSITION */
.day {
  background: linear-gradient(165deg, rgba(8,10,20,0.96), rgba(6,8,16,0.92));
  border: 1px solid rgba(255, 255, 255, 0.06);
}
```
→ 0.06 au lieu de 0.12 pour le border = plus sombre, plus intégré.
→ Plus de magenta dans les jours vides — il réapparaît seulement au hover ou sur les jours actifs.

**B. Garder les fonds win/loss mais plus sombres et plus subtils**
```css
/* PROPOSITION */
.day.win {
  background: linear-gradient(165deg, rgba(8,22,14,0.94), rgba(6,16,10,0.90));
  border-color: rgba(136,255,90,0.25);
}
.day.loss {
  background: linear-gradient(165deg, rgba(28,10,16,0.94), rgba(18,8,12,0.90));
  border-color: rgba(255,78,107,0.28);
}
```
→ Baisser l'opacité des radials de 0.18→0.12 et 0.20→0.14
→ Bords moins saturés

**C. Réduire le gap pour plus de densité « cockpit »**
```css
/* PROPOSITION */
.calendar-grid {
  gap: 5px;  /* au lieu de 8px */
}
@media (max-width: 760px) {
  .calendar-grid { gap: 4px; }
}
```
→ 5px reste lisible mais resserre la grille, améliore le ratio data/whitespace.

**D. Remplacer le ::before hover par un subtle glow**
```css
/* PROPOSITION — remplacer l'overlay par un glow */
.day:hover {
  border-color: rgba(0,229,255,0.35);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,229,255,0.12);
}
/* Supprimer ou réduire .day::before pour éviter l'éclaircissement */
.day::before { display: none; }
```

**E. Adoucir le today marker**
```css
/* PROPOSITION */
.day.today {
  border-color: rgba(0,229,255,0.55);
  box-shadow: 0 0 0 1px rgba(0,229,255,0.40), 0 0 18px rgba(0,229,255,0.15);
}
```

**F. Uniformiser les métriques**
```css
/* PROPOSITION — mêmes tailles en mode PnL, trades et mix */
.day-metric-pnl,
.mode-trades .day-metric-trades {
  font-size: clamp(22px, 1.5vw, 30px);
  font-weight: 900;
}
.mode-both .day-metric-pnl,
.mode-both .day-metric-trades {
  font-size: clamp(17px, 1.2vw, 22px);
}
```

**G. Ajouter une subtle vignette aux jours actifs pour la profondeur**
```css
/* PROPOSITION — ajout de profondeur */
.day {
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.03);
}
```

---

## 2. KPI CARDS (6 widgets en haut de la page today)

### 2.1 Ce qui cloche

**A. `backdrop-filter: blur(18px)` → surface trop transparente**
```css
/* 003 ligne 42-43 */
.kpi {
  background: var(--surface);  /* rgba(20,22,36,0.55) */
  backdrop-filter: blur(18px);
}
```
L'opacité 0.55 couplée à `blur(18px)` donne un effet de « vitre sale ». Les KPI cards deviennent trop transparentes et laissent voir l'aurora background → aspect moins pro, moins lisible.

**B. Aucune différenciation visuelle entre les KPIs**
Tous les 6 ont le même fond, la même taille de valeur (24px), le même label. Le PnL total devrait être visuellement dominant.

**C. Layout `auto-fit` inadapté pour 6 cards**
```css
.kpi-row {
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}
```
Sur 1200px, ça donne souvent 4-3-3 ou 4-2 → pas aligné. 6 cartes demandent une grille 3×2 fixe sur desktop.

**D. Les sparklines (42px) prennent trop de hauteur pour les KPIs qui en ont une**
Seulement le PnL total a une sparkline, mais elle est intégrée dans le même format que les autres → déséquilibre visuel.

### 2.2 Propositions correctives

**A. Opacifier les KPI cards pour une meilleure lisibilité**
```css
/* PROPOSITION */
.kpi {
  background: rgba(20, 22, 36, 0.78);
  backdrop-filter: blur(12px);  /* plus léger */
  border: 1px solid rgba(255, 255, 255, 0.06);
}
```

**B. Différencier la KPI PnL (la plus importante)**
```css
/* PROPOSITION — KPI PnL plus visible */
.kpi[data-widget-key="kpi_total_pnl"] {
  border-color: rgba(0,229,255,0.18);
  background: linear-gradient(145deg, rgba(20,22,36,0.82), rgba(0,229,255,0.04));
}
.kpi[data-widget-key="kpi_total_pnl"] .kpi-value {
  font-size: 30px;
}
```

**C. Grille 3×2 fixe pour les 6 KPIs**
```css
/* PROPOSITION */
.kpi-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  margin-bottom: 18px;
}
@media (max-width: 1100px) {
  .kpi-row { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 600px) {
  .kpi-row { grid-template-columns: 1fr; }
}
```

**D. Compacter la sparkline**
```css
/* PROPOSITION */
.kpi-spark {
  height: 32px;  /* au lieu de 42px */
}
.kpi-spark-wrap {
  margin-top: 6px;  /* au lieu de 10px */
}
```

**E. Ajouter une barre de progression subtile pour le Winrate**
```css
/* PROPOSITION — remplacer le fond gris par plus sombre */
.kpi-bar {
  background: rgba(255,255,255,0.02);
}
.kpi-bar > i {
  background: linear-gradient(90deg, var(--win) 0%, var(--cyan) 100%);
}
```

**F. Rendre les labels KPI plus sobres (enlever l'icône SVG petite et bruitée)**
```css
/* PROPOSITION */
.kpi-label svg { display: none; }  /* ou réduire l'opacité */
.kpi-label {
  letter-spacing: 1.5px;
  font-size: 9.5px;
}
```

---

## 3. BOUTONS & CONTRÔLES (toggles, filtres, navigation)

### 3.1 Ce qui cloche

**A. Gradient backgrounds trop voyants pour des contrôles secondaires**
```css
/* 005 lignes 146-157 — metric toggle */
.calendar-metric-toggle {
  background: linear-gradient(135deg, rgba(255,255,255,0.06), rgba(0,229,255,0.08));
  border: 1px solid rgba(255, 255, 255, 0.2);
}
/* 005 lignes 182-193 — view/layout/range toggles */
.calendar-view-toggle {
  background: linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,46,196,0.08));
  border: 1px solid rgba(255, 255, 255, 0.2);
}
```
→ Les toggles ont un fond qui rivalise avec le contenu. Le border `rgba(255,255,255,0.2)` est trop épais visuellement. De plus, le metric toggle utilise cyan pendant que les autres utilisent magenta → incohérence.

**B. Active state « pressed button » trop 2015**
```css
/* 005 lignes 175-180 */
.calendar-metric-btn.active {
  color: #04131a;
  border-color: rgba(0,229,255,0.65);
  background: linear-gradient(135deg, rgba(0,229,255,0.9), rgba(0,188,255,0.76));
  box-shadow: 0 0 0 1px rgba(0,229,255,0.32) inset, 0 6px 14px rgba(0,229,255,0.28);
}
```
→ Texte noir (#04131a) sur fond cyan → look « bouton Windows 95 ». Le box-shadow inset ajoute du bruit visuel.

**C. Trop de toggles séparés**
Sur la page journal : metric-toggle + view-toggle + layout-toggle + range-toggle = 4 groupes de boutons. C'est trop d'UI pour une seule toolbar → perception d'encombrement.

**D. Le `.calendar-nav` a un fond gradient aussi**
```css
/* 005 ligne 32 */
.calendar-nav {
  background: linear-gradient(140deg, rgba(255,255,255,0.06), rgba(0,229,255,0.04));
  border: 1px solid rgba(255, 255, 255, 0.12);
}
```
→ Sur fond déjà sombre, ce gradient subtil crée un « halo » autour de la navigation.

**E. Les btns `.calendar-metric-btn` etc. utilisent `letter-spacing: 0.7px` + `text-transform: uppercase` + `font-weight: 800`**
→ Le texte devient difficile à lire rapidement (tracking trop large, uppercase fatigant pour des labels courts comme « PnL » ou « WR »)

### 3.2 Propositions correctives

**A. Simplifier les fonds des toggles — version épurée**
```css
/* PROPOSITION */
.calendar-metric-toggle,
.calendar-view-toggle,
.calendar-layout-toggle,
.calendar-range-toggle {
  background: rgba(10, 14, 26, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 3px;
  gap: 2px;
  box-shadow: none !important;  /* enlever le shadow superflu */
}
```

**B. Active state « filled » plus moderne**
```css
/* PROPOSITION — remplacer le texte noir par du texte blanc */
.calendar-metric-btn.active {
  color: #fff;
  background: linear-gradient(135deg, rgba(0,229,255,0.85), rgba(0,188,255,0.70));
  border-color: transparent;
  box-shadow: 0 4px 12px rgba(0,229,255,0.20);
}
.calendar-view-btn.active,
.calendar-layout-btn.active,
.calendar-range-btn.active {
  color: #fff;
  background: linear-gradient(135deg, rgba(255,46,196,0.82), rgba(180,0,255,0.68));
  border-color: transparent;
  box-shadow: 0 4px 12px rgba(255,46,196,0.18);
}
```

**C. Réduire le letter-spacing et le poids pour les contrôles**
```css
/* PROPOSITION */
.calendar-metric-btn,
.calendar-view-btn,
.calendar-layout-btn,
.calendar-range-btn {
  font-size: 10.5px;
  font-weight: 700;  /* au lieu de 800 */
  letter-spacing: 0.4px;  /* au lieu de 0.7px */
  text-transform: uppercase;
  padding: 6px 12px;
  border-radius: 999px;
}
```

**D. Unifier la toolbar — fond plus sobre pour `.calendar-nav`**
```css
/* PROPOSITION */
.calendar-nav {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.06);
  padding: 4px 8px;
}
```

**E. Option de fusionner les toggles secondaires**
Proposition UI : view-toggle (Month/Week) et layout-toggle (Calendar/Table) pourraient être fusionnés en un seul sélecteur :
- Mois/Calendrier (défaut)
- Mois/Tableau
- Semaine/Calendrier
- Semaine/Tableau
→ Mais cela demande une modification du JS. Alternative plus simple : cacher le layout-toggle par défaut et ne l'afficher qu'en mode semaine (moins de changements de layout).

**F. Appliquer le même design system aux quick-range buttons**
```css
/* PROPOSITION — aligner les quick-range btns avec les toggles */
.calendar-quick-btn {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.4px;
  padding: 5px 10px;
}
.calendar-quick-btn.active {
  color: #fff;
  background: linear-gradient(135deg, rgba(0,229,255,0.85), rgba(0,188,255,0.70));
  border-color: transparent;
}
```

---

## 4. ORDRE D'APPLICATION (comment ne pas tout casser)

### 4.1 Fichiers à modifier

| Changement | Fichier | Impact |
|---|---|---|
| Fond `.day` + border | `006_btn_icon_svg.css` | Cosmétique uniquement |
| Hover `.day` + supprimer `::before` overlay | `007_day_hover_before.css` | Changement de comportement au hover |
| `.day.today` border | `007_day_hover_before.css` | Cosmétique |
| gap calendrier | `006_btn_icon_svg.css` + `018_templates_menu_hidden.css` | Layout |
| Taille métriques | `007_day_hover_before.css` + `008_day_mode_trades_day_metric_sub.css` | Typographie |
| Fond `.kpi` + grille | `003_settings_chip_remove_hover.css` | Layout + visuel |
| KPI PnL différenciation | `003_settings_chip_remove_hover.css` (à ajouter) | Cosmétique |
| Toggles backgrounds + active state | `005_journal_toolbar_filters.css` | Cosmétique |
| Toggles letter-spacing | `005_journal_toolbar_filters.css` | Typographie |
| `.calendar-nav` fond | `005_journal_toolbar_filters.css` | Cosmétique |

### 4.2 Aucun fichier JS à modifier
Toutes les propositions sont purement CSS. Aucun changement dans les templates Jinja ou le JS. Risque de régression : nul.

### 4.3 Stratégie de déploiement

1. Appliquer les changements CSS par ordre : fonds → gaps → typo → toggles
2. Tester visuellement sur chaque mode (PnL, Trades, Mix)
3. Tester responsive (mobile + desktop)
4. Vérifier que le build (`python build.py`) passe toujours

### 4.4 Si jamais d'autres agents modifient les mêmes fichiers

- Agent #1 (couleurs globales) pourrait toucher `000_theme_tokens_base.css` — pas de conflit direct
- Agent #3 (layout responsive) pourrait toucher `018_templates_menu_hidden.css` — attention au gap calendrier et aux breakpoints KPI
- Les fichiers sont suffisamment cloisonnés (un par feature) pour éviter les conflits majeurs

---

## 5. RÉSUMÉ — Top 5 actions à fort impact

| Priorité | Action | Fichier | Effet attendu |
|---|---|---|---|
| 1 | Assombrir fond `.day` et supprimer magenta des neutres | 006, 007 | ✅ Restaure l'ambiance sombre |
| 2 | Réduire le gap de 8→5px | 006, 018 | ✅ Grille plus dense, plus « cockpit » |
| 3 | Opacifier KPI cards (0.55→0.78) | 003 | ✅ Plus lisibles, plus solides |
| 4 | Simplifier toggles (fond uni, active state blanc) | 005 | ✅ Plus modernes, moins de bruit |
| 5 | Adoucir le today marker | 007 | ✅ Moins agressif, plus élégant |
