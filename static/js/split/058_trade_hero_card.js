// ---------- TradeHeroCard — reusable primitive ----------
// Two variants:
//   'flip-front' → journal card front face (light Apple, compact)
//   'card'       → modal trade list (dark theme, full details)
// Returns a DIV (not article) — caller wraps in appropriate container.

function tradeHeroCardHtml(trade, options) {
  options = options || {};
  var variant = options.variant || 'card';
  var day     = options.day || {};
  var idx     = options.index || 1;
  var extraHtml = options.extraHtml || '';
  var extraClasses = options.extraClasses || '';

  var m           = deriveTradeMetrics(trade);
  var pnl         = Number(m.pnl || 0);
  var pnlClass    = pnl > 0 ? 'pos' : pnl < 0 ? 'neg' : 'flat';
  var resultClass = m.isWin === 1 ? 'win' : m.isWin === 0 ? 'loss' : 'neutral';
  var resultLabel = m.isWin === 1 ? 'WIN' : m.isWin === 0 ? 'LOSS' : '\u2014';
  var direction   = (m.direction || trade.direction || '-').toUpperCase();
  var strategy    = trade.strategy ? prettify(trade.strategy) : 'Strategie inconnue';
  var rr          = m.rr == null ? '-' : Number(m.rr).toFixed(2) + 'R';
  var summary     = options.summary || journalShortText(trade.why_trade, trade.scenario, trade.why_entry);
  var tid         = escapeHtml(String(trade.id));
  var instr       = options.showInstrument !== false ? escapeHtml(day.instrument || '-') : '';
  var dateLabel   = options.dateLabel || (day.date ? prettyDateKey(day.date) : '');

  // Screenshot
  var shot     = (trade.screenshots || [])[0];
  var shotUrl  = shot ? '/screenshots/' + escapeHtml(shot.filename) : null;
  var shotStyle = shotUrl ? ' style="background-image:url(\'' + shotUrl + '\')"' : '';
  var hasShot   = !!shotUrl;

  // Helper: fmt price
  function _price(v) {
    return v != null && v !== '' ? Number(v).toFixed(2) : '\u2014';
  }

  // ── TOPBAR ──
  var topbarPill = function (text, cls) {
    return '<span class="metric-pill' + (cls ? ' ' + cls : '') + '">' + escapeHtml(text) + '</span>';
  };

  var topbar = '';
  if (variant === 'flip-front') {
    var pnlPillClass = pnlClass === 'pos' ? 'metric-pill--win' : pnlClass === 'neg' ? 'metric-pill--loss' : 'metric-pill--muted';
    var resPillClass = resultClass === 'win' ? 'metric-pill--win' : resultClass === 'loss' ? 'metric-pill--loss' : 'metric-pill--muted';
    topbar =
      '<div class="thc-topbar">' +
        topbarPill('#' + idx, 'metric-pill--muted journal-trade-index') +
        topbarPill(instr, 'metric-pill--cyan journal-trade-instrument') +
        topbarPill(fmtMoney(pnl), pnlPillClass + ' journal-trade-top-pnl ' + pnlClass) +
        topbarPill(resultLabel, resPillClass + ' journal-trade-result ' + resultClass) +
        '<button type="button" class="thc-close journal-card-close" data-journal-day-close aria-label="Fermer">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>' +
      '</div>';
  } else if (variant === 'card') {
    topbar =
      '<div class="thc-topbar">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          topbarPill('#' + idx, 'trade-chip trade-chip-num') +
          topbarPill(instr, 'metric-pill--cyan') +
          '<span class="thc-strategy-name" style="font-size:13px;color:var(--text-soft,#c8ccdb);font-weight:700">' + escapeHtml(strategy) + '</span>' +
        '</div>' +
      '</div>';
  }

  // ── MEDIA ──
  var media = '';
  if (variant === 'flip-front' || variant === 'card') {
    if (hasShot) {
      media = '<div class="thc-media">' +
        '<div class="thc-shot"' + shotStyle + '></div>' +
        (variant === 'card' ? '<div class="trade-card-media-overlay"></div>' : '') +
      '</div>';
    } else {
      var emptyLabel = variant === 'flip-front'
        ? '<span>Aucune capture</span>'
        : '<span>Aucune capture</span><strong>' + escapeHtml(pnl > 0 ? 'Moteur propre' : pnl < 0 ? 'Point a corriger' : 'Setup neutre') + '</strong>';
      media = '<div class="thc-media is-empty">' +
        '<div class="thc-shot-empty">' + emptyLabel + '</div>' +
      '</div>';
    }
  }

  // ── BODY ──
  var dirPillClass = direction === 'LONG' ? 'long' : direction === 'SHORT' ? 'short' : '';
  var resPillClass = resultClass === 'win' ? 'win' : resultClass === 'loss' ? 'loss' : 'neutral';

  var stripHtml =
    '<div class="thc-strip">' +
      '<span class="metric-pill thc-direction' + (dirPillClass ? ' ' + dirPillClass : '') + '">' + escapeHtml(direction || '-') + '</span>' +
      '<span class="metric-pill">' + escapeHtml(rr) + '</span>' +
      '<span class="metric-pill metric-pill--' + resPillClass + '">' + escapeHtml(resultLabel) + '</span>' +
    '</div>';

  var body = '';
  if (variant === 'flip-front') {
    body =
      '<div class="thc-body">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding-bottom:14px">' +
          '<div style="flex:1">' +
            '<h4 class="thc-strategy-name">' + escapeHtml(strategy) + '</h4>' +
            '<p class="thc-summary">' + escapeHtml(summary) + '</p>' +
          '</div>' +
          '<div class="thc-pnl-large" style="flex-shrink:0">' +
            '<strong class="' + pnlClass + '">' + fmtMoney(pnl) + '</strong>' +
          '</div>' +
        '</div>' +
        stripHtml +
        '<div class="journal-trade-card-actions">' +
          '<span>' + escapeHtml(resultLabel) + '</span>' +
          '<button type="button">Voir details</button>' +
        '</div>' +
      '</div>';
  } else if (variant === 'card') {
    var thesisLabel = trade.thesis_validated === 'yes' ? 'These validee' : trade.thesis_validated === 'no' ? 'These rejetee' : 'These a qualifier';
    body =
      '<div class="thc-body">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px">' +
          '<div class="thc-strategy-name">' + escapeHtml(thesisLabel) + '</div>' +
          '<div class="thc-pnl ' + pnlClass + '">' + fmtMoney(pnl) + '</div>' +
        '</div>' +
        stripHtml +
        '<div class="thc-grid">' +
          _thcField('Entree', _price(trade.entry_price)) +
          _thcField('Sortie', _price(trade.exit_price)) +
          _thcField('Stop', _price(trade.stop_loss)) +
          _thcField('Target', _price(trade.take_profit)) +
        '</div>' +
        '<div class="thc-footer">' +
          '<span class="trade-meta-pill">Exec ' + (trade.execution_quality ? trade.execution_quality + '/5' : '-') + '</span>' +
          '<span class="trade-meta-pill">Pos ' + (trade.position_size != null ? Number(trade.position_size) + 'u' : '-') + '</span>' +
          '<span class="trade-edit-hint" style="margin-left:auto;font-size:10px;color:var(--cyan,#00E5FF);letter-spacing:0.45px;text-transform:uppercase;opacity:0.86">Cliquer pour editer</span>' +
        '</div>' +
        (summary ? '<div class="thc-footer-note">' + escapeHtml(summary) + '</div>' : '') +
      '</div>';
  }

  // ── ASSEMBLE — returns a DIV with variant class ──
  return '<div class="trade-hero-card thc--' + variant + ' ' + extraClasses + '"' +
    (variant === 'card' ? ' data-tid="' + tid + '"' : '') +
    '>' +
    topbar + media + body + extraHtml +
    '</div>';
}

// ── Internal helper ──

function _thcField(label, value) {
  return '<div class="thc-field">' +
    '<span class="thc-field-label">' + escapeHtml(label) + '</span>' +
    '<strong class="thc-field-value">' + value + '</strong>' +
  '</div>';
}
