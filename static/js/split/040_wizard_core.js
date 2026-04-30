/* ============================================================
   WIZARD MODULE — Scenario Logger
   ============================================================ */

const WIZ_DRAFT_KEY = 'cockpit:wizard_draft:v3';

let wizState = null;

const WIZ_INSTRUMENTS = ["BTC", "ETH", "NQ", "ES"];
const STEPS_TRADE = ['date','instrument','strategy','day_context','why_trade','why_entry','why_stop_tp','levels','screenshots','recap'];
const STEPS_PM = ['pm_exit','pm_quality','pm_lessons'];

const STRATEGY_HINTS = {
  midnight_model: {
    why_trade:   "Quel setup Midnight Model justifie ce trade ? (ex: London pre-market, range overnight, etc.)",
    why_entry:   "Trigger d'entree Midnight : LVN, liquidite overnight, gap fill...",
    why_stop_tp: "Stop : au-dela du range overnight.  TP : prochaine zone LVN ou HVN.",
  },
  london_model: {
    why_trade:   "Quel setup London Model ? (ex: ouverture London, sweep d'Asian range, LVN London...)",
    why_entry:   "Trigger d'entree London : cassure de session, LVN, rejet sur VWAP...",
    why_stop_tp: "Stop : au-dela du swing London.  TP : niveau LVN ou R:R cible.",
  },
  ny_model: {
    why_trade:   "Quel setup NY Model ? (ex: continuation post-London, LVN NY, rotation...)",
    why_entry:   "Trigger d'entree NY : rejet VWAP, LVN, cassure intraday...",
    why_stop_tp: "Stop : invalidation du setup NY.  TP : objectif de session ou LVN.",
  },
  default: {
    why_trade:   "Pourquoi ce trade est-il aligne avec votre plan du jour ?",
    why_entry:   "Quel signal ou configuration vous a declenche ?",
    why_stop_tp: "Logique de placement du stop et de l'objectif.",
  }
};

function _wizHint(field) {
  const strat = wizState?.data?.strategy || 'default';
  return (STRATEGY_HINTS[strat] || STRATEGY_HINTS.default)[field] || '';
}

function wizCanonicalInstrument(value) {
  const raw = String(value || "").trim().toUpperCase();
  if (!raw) return "";
  return raw === "NAS" ? "NQ" : raw;
}

function wizInstrumentLabel(value) {
  const canonical = wizCanonicalInstrument(value);
  return canonical;
}

function wizDefaultInstrument() {
  const fromFilter = wizCanonicalInstrument(state?.statsInstrument || "");
  if (WIZ_INSTRUMENTS.includes(fromFilter)) return fromFilter;
  if (typeof _lastInstrument === "function") {
    const last = wizCanonicalInstrument(_lastInstrument());
    if (WIZ_INSTRUMENTS.includes(last)) return last;
  }
  return "BTC";
}

// ─── Open / Close ──────────────────────────────────────────

var _wizLastFocused = null;

function wizOpen(opts) {
  _wizLastFocused = document.activeElement;
  opts = opts || {};
  const mode = opts.mode === 'postmortem' ? 'postmortem' : 'trade';
  const instrument = wizCanonicalInstrument(opts.instrument || "") || wizDefaultInstrument();
  const strategy = String(opts.strategy || "midnight_model").trim() || "midnight_model";
  const draft = _wizLoadDraft();

  wizState = {
    mode:    mode,
    stepIdx: opts.date ? 1 : 0,
    steps:   mode === 'postmortem' ? STEPS_PM : STEPS_TRADE,
    data: {
      date:         opts.date        || todayKey(),
      instrument:   instrument       || '',
      strategy:     strategy,
      htf_bias:     '',
    htf_context:  '',
      daily_notes:  '',
      tags:         [],
      scenario:     '',
      why_trade:    '',
      why_entry:    '',
      why_stop:     '',
      why_tp:       '',
      direction:    '',
      entry_price:  '',
      stop_loss:    '',
      take_profit:  '',
      stdv_level:   '',
      screenshots:  [],
      exit_price:   '',
      exit_quality: 0,

      lessons:      '',
      missing_chat_text: '',
      missing_followups: [],
      tradeId:      opts.tradeId || null,
      dayId:        opts.dayId   || null,
    },
    hasDraft: !!(draft && mode !== 'postmortem'),
    _draft:   draft || null,
  };

  _wizRender();
  const el = document.getElementById('wiz');
  if (el) {
    el.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
}

function wizClose() {
  const el = document.getElementById('wiz');
  if (el) el.classList.add('hidden');
  document.body.style.overflow = '';
  wizState = null;
  if (_wizLastFocused) { _wizLastFocused.focus(); _wizLastFocused = null; }
}

// ─── Draft ─────────────────────────────────────────────────

function _wizSaveDraft() {
  if (!wizState || wizState.mode === 'postmortem') return;
  try {
    localStorage.setItem(WIZ_DRAFT_KEY, JSON.stringify({
      stepIdx: wizState.stepIdx,
      data: wizState.data
    }));
  } catch(e) {}
}

function _wizLoadDraft() {
  try { return JSON.parse(localStorage.getItem(WIZ_DRAFT_KEY)); } catch(e) { return null; }
}

function _wizClearDraft() {
  localStorage.removeItem(WIZ_DRAFT_KEY);
}

function wizResumeDraft() {
  if (!wizState || !wizState._draft) return;
  wizState.data     = Object.assign(wizState.data, wizState._draft.data);
  wizState.stepIdx  = wizState._draft.stepIdx || 0;
  wizState.hasDraft = false;
  _wizRender();
}

function wizDiscardDraft() {
  _wizClearDraft();
  if (wizState) { wizState.hasDraft = false; }
  _wizRender();
}

// ─── Navigation ────────────────────────────────────────────

function wizNext() {
  if (!wizState) return;
  _wizSaveCurrentStep();
  if (wizState.stepIdx < wizState.steps.length - 1) {
    wizState.stepIdx++;
    _wizSaveDraft();
    _wizRender();
  } else {
    _wizSubmit();
  }
}

function wizBack() {
  if (!wizState) return;
  if (wizState.stepIdx > 0) {
    wizState.stepIdx--;
    _wizRender();
  } else {
    wizClose();
  }
}

