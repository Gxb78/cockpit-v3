function bindWizard() {
  var wiz = document.getElementById('wiz');
  if (!wiz) return;

  // Focus trap pour le wizard
  document.addEventListener('keydown', function _wizTrap(e) {
    if (e.key !== 'Tab') return;
    var el = document.getElementById('wiz');
    if (!el || el.classList.contains('hidden')) return;
    var f = el.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled])');
    if (f.length === 0) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });

  // Close on backdrop click
  wiz.addEventListener('click', function(e) {
    if (e.target === wiz) wizClose();
  });

  var closeBtn = document.getElementById('wizCloseBtn');
  var backBtn  = document.getElementById('wizBackBtn');
  var nextBtn  = document.getElementById('wizNextBtn');
  var skipBtn  = document.getElementById('wizSkipBtn');

  if (closeBtn) closeBtn.addEventListener('click', wizClose);
  if (backBtn)  backBtn.addEventListener('click',  wizBack);
  if (nextBtn)  nextBtn.addEventListener('click',  wizNext);
  if (skipBtn)  skipBtn.addEventListener('click',  wizSkip);

  document.addEventListener('keydown', _wizKeydown);
}
