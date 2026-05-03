# Latence dessins vs axe des prix — Analyse technique

## Problème

Quand l'utilisateur scroll/zoom l'axe des prix (Y), les dessins (rectangle, trend line, fibonacci, etc.) ont un **micro-décalage** visible : ils se repositionnent ~16-32ms après les bougies, créant un "glissement" perceptible, surtout en zoom out (quand le prix se dilate).

## Cause racine

Lightweight Charts (LWC) v4 n'a **aucun événement natif** pour détecter les changements de l'axe des prix. On écoute donc des événements de contournement :

1. `mousemove` sur le conteneur → `requestAnimationFrame` → `_renderAll()` (dessins)
2. `wheel` sur le conteneur → rAF → `_renderAll()`
3. `subscribeCrosshairMove` → rAF → `_renderAll()`

Mais le pipeline LWC est asynchrone :

```
Mouse wheel → LWC internal handler (async) → price scale update → [frame render]
                                                         ↓
              Notre handler wheel → rAF → _renderAll() → [canvas overlay draw]
```

Les deux `→ [frame render]` sont dans le même rAF, mais LWC traite ses mises à jour **avant** le rendu du canvas overlay. Le problème : si `_toPixel()` (qui convertit temps/prix → pixels via `priceToCoordinate`) lit les coordonnées **avant** que LWC ait fini son update, les dessins sont dessinés aux anciennes positions, puis LWC met à jour les bougies → décalage d'un frame.

## Solution testée (insuffisante)

- `mousemove` + `wheel` avec `requestAnimationFrame` pour synchro
- `subscribeVisibleLogicalRangeChange` + `subscribeVisibleTimeRangeChange` pour l'axe X
- `subscribeCrosshairMove` pour capter les mouvements souris

**Résultat** : ~90% synchro, mais encore un infime décalage visible en zoom Y.

## Solutions possibles (à discuter avec le lead)

### Option A — Abandonner le canvas overlay, utiliser les primitives LWC

Au lieu d'un canvas HTML superposé, utiliser les séries et price lines natives de LWC pour les dessins. Chaque dessin serait une `LineSeries` ou une `createPriceLine` / `createLine`. LWC gère lui-même la synchro.

**Avantages** : synchro parfaite, pas de canvas overlay, pas de `_toPixel()` ni de `_renderAll()`.

**Inconvénients** :
- Plus de possibilité de canvas custom (fill alpha, text, dégradés, formes complexes)
- Fibonacci nécessiterait N séries de lignes → overhead
- Perte de contrôle sur le rendu (anti-aliasing, ombres, glow, etc.)
- Les sessions zones deviennent impossibles (rectangles remplis)

### Option B — Forcer un render synchrone via `chart.timeScale().subscribeVisibleTimeRangeChange()`

Le seul événement qui semble fiable est `subscribeVisibleTimeRangeChange` (déclenché APRÈS que LWC a fini son update). Mais il ne couvre pas l'axe Y.

Solution : combiner cet événement avec `subscribeCrosshairMove` ET un observer sur la `priceScale().width()` (via `ResizeObserver`) pour détecter les changements d'échelle.

**Code :**
```js
// Observer la price scale (taille change quand le range de prix change)
var priceScaleObserver = new ResizeObserver(function () {
    requestAnimationFrame(function () { _renderAll(); });
});
var priceScaleEl = container.querySelector('.tv-price-scale');
if (priceScaleEl) priceScaleObserver.observe(priceScaleEl);
```

**Risques** : dépend du DOM interne de LWC (classe `.tv-price-scale`) → cassable à chaque mise à jour LWC.

### Option C — Polling haute fréquence (trade-off)

Au lieu de dépendre d'événements, lancer un `setInterval(_renderAll, 16)` (~60fps) en boucle pendant que la souris est sur le chart. Un flag `_isInteracting` activé par `mousemove`/`wheel` et désactivé après 200ms d'inactivité.

**Code :**
```js
var _renderLoopId = null;
var _interactionTimeout = null;

function _startRenderLoop() {
    if (_renderLoopId) return;
    function loop() {
        _renderAll();
        _renderLoopId = requestAnimationFrame(loop);
    }
    _renderLoopId = requestAnimationFrame(loop);
}

function _stopRenderLoop() {
    if (_renderLoopId) { cancelAnimationFrame(_renderLoopId); _renderLoopId = null; }
}

container.addEventListener('mousemove', function () {
    _startRenderLoop();
    clearTimeout(_interactionTimeout);
    _interactionTimeout = setTimeout(_stopRenderLoop, 200);
}, { passive: true });
```

**Avantages** :
- Synchro parfaite : tant que la souris bouge, les dessins sont redessinés à chaque frame
- Indépendant des événements LWC
- Simple, robuste, pas de dépendance DOM interne

**Inconvénients** :
- Consommation CPU quand la souris est sur le chart (rendu canvas 60fps)
- À tester sur machine basse (chromebook, vieux PC)

### Option D — Utiliser `series.priceScale().subscribeSizeChange()` (si existe)

Dans LWC v4, `IPriceScaleApi` n'a pas de méthode `subscribeSizeChange`. Mais `IChartApi` a `subscribeCrosshairMove` et `subscribeClick`. Rien pour la price scale.

**Conclusion** : pas de solution standard.

## Recommandation personnelle

**Option C** (render loop pendant interaction) est le meilleur compromis : synchro parfaite, pas de dépendance LWC, code simple. Le canvas overlay ne fait que des opérations de dessin 2D (lignes, textes, rectangles) — même avec 50 dessins, un render prend < 1ms. 60 renders/s = 60ms/s de CPU ≈ 6% d'un core. Acceptable.

À implémenter en remplacement des handlers `mousemove`/`wheel`/`subscribeCrosshairMove` actuels.
