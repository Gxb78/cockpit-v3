// ---------- 066a_orderflow_viewport.js ----------
// Couche viewport dediee: centralise les regles d'etat (auto/manual/follow-ready).
// Note: la classe OF.ViewportController est definie dans 066_orderflow_engine.js,
// puis etendue ici pour garder une migration progressive sans casser le runtime.

(function () {
  'use strict';

  var OF = window.OF = window.OF || {};
  if (!OF.ViewportController) return;

  // Etat normalise expose pour debug/tests.
  OF.ViewportController.prototype.getState = function () {
    return {
      mode: this.mode,
      userDetached: !!this.userDetached,
      timeRange: this.timeRange,
      priceRange: this.priceRange,
    };
  };

  // Utilitaire explicite pour repasser en mode auto.
  OF.ViewportController.prototype.enableAuto = function (reason) {
    this.setMode('auto', false);
    this.setDataRange(reason || 'auto-enable');
  };

  // Hook live: ne recadre jamais en mode manual.
  OF.ViewportController.prototype.onLiveTrade = function (_trade) {
    if (this.mode !== 'auto' || this.userDetached) return;
    // En auto, on ne force pas ici de recadrage agressif: le flux live met
    // juste a jour les donnees; le moteur decide quand ajuster la vue.
  };
})();
