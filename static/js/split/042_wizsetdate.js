function wizSetDate(dt) {
  if (!wizState) return;
  wizState.data.date = dt;
  var el = document.getElementById('wizDate');
  if (el) el.value = dt;
  var today = todayKey();
  document.querySelectorAll('.wiz-date-btn').forEach(function(b) {
    var label = b.textContent.trim();
    b.classList.toggle('active', (label === "Aujourd'hui" && dt === today) || (label === 'Hier' && dt !== today));
  });
}

// ── Instrument ──

function _wizStepInstrument() {
  var d = wizState.data;
  var instruments = [
    { id:'ES',  label:'ES',  icon:'&#x1F4C8;', sub:'S&amp;P 500 Futures' },
    { id:'NQ', label:'NQ',  icon:'&#x1F4BB;', sub:'Nasdaq Futures' },
    { id:'BTC', label:'BTC', icon:'&#x20BF;',  sub:'Bitcoin' },
    { id:'ETH', label:'ETH', icon:'&#926;',    sub:'Ethereum' },
  ];
  var html = '<div class="wiz-question">Quel instrument ?</div><div class="wiz-cards">';
  instruments.forEach(function(i) {
    html += '<div class="wiz-card' + (d.instrument===i.id?' active':'') + '" onclick="wizSelectInstrument(\'' + i.id + '\')">'
      + '<div class="wiz-card-icon">' + i.icon + '</div>'
      + '<div class="wiz-card-main">' + i.label + '</div>'
      + '<div class="wiz-card-sub">'  + i.sub + '</div>'
      + '</div>';
  });
  return html + '</div>';
}

function wizSelectInstrument(id) {
  if (!wizState) return;
  wizState.data.instrument = wizCanonicalInstrument(id);
  _wizRender();
  setTimeout(wizNext, 200);
}

// ── Session ──

function _wizStepSession() {
  var d = wizState.data;
  var sessions = [
    { id:'asia',    icon:'&#x1F305;', main:'Asia',   sub:'Session asiatique — Tokyo, Sydney' },
    { id:'london',  icon:'&#x1F1EC;&#x1F1E7;', main:'London', sub:'Session London — Europe' },
    { id:'ny_am',   icon:'&#x1F5FD;', main:'NY AM',  sub:'Matin New York — ouverture US' },
    { id:'ny_pm',   icon:'&#x1F303;', main:'NY PM',  sub:'Apres-midi New York — continuation' },
  ];
  var html = '<div class="wiz-question">Dans quelle session ?</div><div class="wiz-cards">';
  sessions.forEach(function(s) {
    html += '<div class="wiz-card' + (d.session===s.id?' active':'') + '" onclick="wizSelectSession(\'' + s.id + '\')">'
      + '<div class="wiz-card-icon">' + s.icon + '</div>'
      + '<div class="wiz-card-main">' + s.main + '</div>'
      + '<div class="wiz-card-sub">'  + s.sub + '</div>'
      + '</div>';
  });
  return html + '</div>';
}

function wizSelectSession(id) {
  if (!wizState) return;
  wizState.data.session = id;
  _wizRender();
  setTimeout(wizNext, 200);
}

// ── Strategy ──

function _wizStepStrategy() {
  var d = wizState.data;
  var defaults = [
    { id:'midnight_model', icon:'&#x1F319;', main:'Midnight Model', sub:'Range overnight &amp; London pre-market' },
    { id:'london_model',   icon:'&#x1F1EC;&#x1F1E7;', main:'London Model', sub:'Ouverture &amp; session London' },
    { id:'ny_model',       icon:'&#x1F5FD;', main:'NY Model', sub:'Session New York &amp; continuation' },
  ];
  var custom = (state?.settings?.custom_strategies || []).map(function(s) {
    return {
      id: String(s.value || '').trim(),
      icon: '&#x2728;',
      main: escapeHtml(String(s.label || s.value || '').trim() || prettify(s.value)),
      sub: 'Strategie custom',
    };
  }).filter(function(s) { return !!s.id; });
  var byId = {};
  var strategies = [];
  defaults.concat(custom).forEach(function(s) {
    if (byId[s.id]) return;
    byId[s.id] = true;
    strategies.push(s);
  });
  if (d.strategy && !byId[d.strategy]) {
    strategies.push({
      id: d.strategy,
      icon: '&#x2728;',
      main: escapeHtml(prettify(d.strategy)),
      sub: 'Strategie detectee',
    });
  }

  var cardsClass = strategies.length <= 3 ? 'wiz-cards wiz-cards-3' : 'wiz-cards';
  var html = '<div class="wiz-question">Quelle strategie ?</div>'
    + '<div class="wiz-hint">3 modeles de base + tes strategies custom des Settings.</div>'
    + '<div class="' + cardsClass + '">';
  strategies.forEach(function(s) {
    var sid = String(s.id).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    html += '<div class="wiz-card' + (d.strategy===s.id?' active':'') + '" onclick="wizSelectStrategy(\'' + sid + '\')">'
      + '<div class="wiz-card-icon">' + s.icon + '</div>'
      + '<div class="wiz-card-main">' + s.main + '</div>'
      + '<div class="wiz-card-sub">'  + s.sub  + '</div>'
      + '</div>';
  });
  return html + '</div>';
}

function wizSelectStrategy(id) {
  if (!wizState) return;
  wizState.data.strategy = id;
  _wizRender();
  setTimeout(wizNext, 200);
}

// ── Day Context ──

function _wizStepDayContext() {
  var d = wizState.data;
  var isMidnight = d.strategy === 'midnight_model';
  var biases = [
    { value:'bullish', label:'Bullish', tone:'lime' },
    { value:'bearish', label:'Bearish', tone:'rose' },
    { value:'neutral', label:'Neutral', tone:'' },
  ];

  var biasHtml = biases.map(function(b) {
    return '<button class="wiz-pill wiz-bias' + (d.htf_bias===b.value?' active':'') + (b.tone?' '+b.tone:'') + '" data-value="' + b.value + '" onclick="wizTogglePill(this,\'htf_bias\')">' + b.label + '</button>';
  }).join('');

  var midnightField = '';

  return '<div class="wiz-question">Contexte du jour</div>'
    + '<div class="wiz-hint">Contexte global du jour. Le champ Open Midnight apparait uniquement pour Midnight Model.</div>'
    + '<div class="wiz-field"><label class="wiz-label">HTF Bias</label><div class="wiz-pills">' + biasHtml + '</div></div>'
    + '<div class="wiz-field">'
    +   '<label class="wiz-label">Analyse HTF</label>'
    +   '<textarea class="wiz-textarea" id="wizHtfContext" placeholder="Structure, niveaux clés, invalidation..." rows="3">' + (d.htf_context||'') + '</textarea>'
    + '</div>'
    + midnightField
    + '<div class="wiz-field">'
    +   '<label class="wiz-label">Notes du jour</label>'
    +   '<textarea class="wiz-textarea" id="wizDailyNotes" placeholder="Contexte macro, alertes, discipline du jour...">' + (d.daily_notes||'') + '</textarea>'
    + '</div>';
}

function wizTogglePill(el, field) {
  var group = el.parentElement.querySelectorAll('.wiz-pill');
  var wasActive = el.classList.contains('active');
  group.forEach(function(p) { p.classList.remove('active'); });
  if (!wasActive) {
    el.classList.add('active');
    if (wizState) wizState.data[field] = el.dataset.value;
  } else {
    if (wizState) wizState.data[field] = '';
  }
}

// ── Why Trade ──

function _wizStepWhyTrade() {
  var d = wizState.data;
  return _wizChip()
    + '<div class="wiz-question">Pourquoi ce trade ?</div>'
    + '<div class="wiz-hint">' + _wizHint('why_trade') + '</div>'
    + '<textarea class="wiz-textarea lg" id="wizWhyTrade" placeholder="Alignement avec le plan, setup identifie...">' + (d.why_trade||'') + '</textarea>';
}

// ── Why Entry ──

function _wizStepWhyEntry() {
  var d = wizState.data;
  return _wizChip()
    + '<div class="wiz-question">Pourquoi cette entree ?</div>'
    + '<div class="wiz-hint">' + _wizHint('why_entry') + '</div>'
    + '<textarea class="wiz-textarea lg" id="wizWhyEntry" placeholder="Signal declencheur, confirmation, timing...">' + (d.why_entry||'') + '</textarea>';
}

// ── Why Stop + TP (combined) ──

function _wizStepWhyStopTp() {
  var d = wizState.data;
  return _wizChip()
    + '<div class="wiz-question">Stop &amp; objectif</div>'
    + '<div class="wiz-hint">' + _wizHint('why_stop_tp') + '</div>'
    + '<div class="wiz-field">'
    +   '<label class="wiz-label">Pourquoi ce stop</label>'
    +   '<textarea class="wiz-textarea" id="wizWhyStop" placeholder="Invalidation du setup, zone de protection...">' + (d.why_stop||'') + '</textarea>'
    + '</div>'
    + '<div class="wiz-divider"></div>'
    + '<div class="wiz-field">'
    +   '<label class="wiz-label">Pourquoi ce TP / objectif</label>'
    +   '<textarea class="wiz-textarea" id="wizWhyTp" placeholder="Zone cible, R:R vise, niveau technique...">' + (d.why_tp||'') + '</textarea>'
    + '</div>';
}

// ── Levels ──

function _wizStepLevels() {
  var d      = wizState.data;
  var isLong  = d.direction === 'long';
  var isShort = d.direction === 'short';

  var rrHtml = '';
  if (d.entry_price && d.stop_loss && d.take_profit) {
    var rr  = _calcRR(+d.entry_price, +d.stop_loss, +d.take_profit, d.direction);
    var col = rr >= 2 ? 'var(--win)' : rr >= 1.5 ? 'var(--cyan)' : 'var(--text-muted)';
    rrHtml  = '<div class="wiz-rr-preview" style="color:' + col + '">R:R ' + rr.toFixed(2) + '</div>';
  }

  return '<div class="wiz-question">Direction &amp; niveaux</div>'
    + '<div class="wiz-hint">Prix d\'entree, stop et objectif.</div>'
    + '<div class="wiz-direction-toggle">'
    +   '<button class="wiz-dir-btn' + (isLong?' active-long':'') + '" data-dir="long" onclick="wizSetDir(this)">'
    +     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"/></svg>Long</button>'
    +   '<button class="wiz-dir-btn' + (isShort?' active-short':'') + '" data-dir="short" onclick="wizSetDir(this)">'
    +     '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>Short</button>'
    + '</div>'
    + '<div class="wiz-levels-grid">'
    +   '<div><label class="wiz-level-lbl">Entree</label><input type="number" class="wiz-level-input" id="wizEntry" value="' + (d.entry_price||'') + '" placeholder="0.00" step="0.25" oninput="wizUpdateRR()"></div>'
    +   '<div><label class="wiz-level-lbl">Stop</label><input type="number" class="wiz-level-input" id="wizStop" value="' + (d.stop_loss||'') + '" placeholder="0.00" step="0.25" oninput="wizUpdateRR()"></div>'
    +   '<div><label class="wiz-level-lbl">Objectif (TP)</label><input type="number" class="wiz-level-input" id="wizTarget" value="' + (d.take_profit||'') + '" placeholder="0.00" step="0.25" oninput="wizUpdateRR()"></div>'
    +   '<div><label class="wiz-level-lbl">STDV</label><input type="number" class="wiz-level-input" id="wizStdv" value="' + (d.stdv_level||'') + '" placeholder="0.0" step="0.01"></div>'
    + '</div>'
    + '<div id="wizRrPreview">' + rrHtml + '</div>';
}

