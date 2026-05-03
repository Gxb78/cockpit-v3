function bindWizard() {
  console.log('[WIZARD] bindWizard() called');
  var wiz = document.getElementById('wiz');
  if (!wiz) { console.log('[WIZARD] #wiz NOT found'); return; }
  console.log('[WIZARD] #wiz found');

  // Focus trap pour le wizard
  document.addEventListener('keydown', function _wizTrap(e) {
    if (e.key !== 'Tab') return;
    var el = document.getElementById('wiz');
    if (!el || el.classList.contains('hidden')) return;
    var f = el.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), a[href]');
    if (f.length === 0) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });

  // Diagnostic clic — capturer TOUT clic dans la wizard
  wiz.addEventListener('click', function(e) {
    console.log('[WIZ] CLICK target=' + e.target.tagName + (e.target.id ? '#'+e.target.id : '') + (e.target.className ? '.'+e.target.className.slice(0,30) : '') + ' phase=' + e.eventPhase);
  }, true); // capture=true pour intercepter TOUS les clics
  wiz.addEventListener('click', function(e) {
    if (e.target === wiz) { console.log('[WIZARD] backdrop click'); wizClose(); }
  });

  var closeBtn = document.getElementById('wizCloseBtn');
  var backBtn  = document.getElementById('wizBackBtn');
  var nextBtn  = document.getElementById('wizNextBtn');
  var skipBtn  = document.getElementById('wizSkipBtn');

  console.log('[WIZARD] closeBtn:', !!closeBtn, 'backBtn:', !!backBtn, 'nextBtn:', !!nextBtn, 'skipBtn:', !!skipBtn);
  if (closeBtn) closeBtn.addEventListener('click', function(e) { console.log('[WIZARD] closeBtn clicked'); wizClose(); });
  if (backBtn)  backBtn.addEventListener('click',  wizBack);
  if (nextBtn)  nextBtn.addEventListener('click',  wizNext);
  if (skipBtn)  skipBtn.addEventListener('click',  wizSkip);

  document.addEventListener('keydown', _wizKeydown);
}
