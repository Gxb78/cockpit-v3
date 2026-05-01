// ---------- Custom blocks ----------

var _customBlocksDelegationBound = false;

function _bindCustomBlocksDelegation() {
  if (_customBlocksDelegationBound) return;
  var list = $("#customBlocksList");
  if (!list) return;
  _customBlocksDelegationBound = true;
  list.addEventListener("click", function (e) {
    var del = e.target.closest(".custom-block-delete");
    if (!del) return;
    var block = del.closest(".custom-block");
    if (block) block.remove();
  });
}

function bindCustomBlocks() {
  _bindCustomBlocksDelegation();
  $("#addBlockBtn")?.addEventListener("click", function () {
    addCustomBlock({ id: "", title: "", content: "" });
    var last = $("#customBlocksList .custom-block:last-child .custom-block-title");
    if (last) setTimeout(function () { last.focus(); }, 50);
  });
}

function addCustomBlock(block) {
  _bindCustomBlocksDelegation();
  var list = $("#customBlocksList");
  if (!list) return;
  var id = block.id || "cb_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
  var el = document.createElement("div");
  el.className = "block custom-block";
  el.dataset.cbid = id;
  el.innerHTML = `
    <div class="block-h">
      <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span>
      <input type="text" class="custom-block-title" placeholder="TITRE DU BLOC" />
      <button type="button" class="custom-block-delete" title="Supprimer ce bloc">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
      </button>
    </div>
    <div class="field" style="margin-bottom:0">
      <textarea class="custom-block-content" rows="3" placeholder="Tape ce que tu veux ici… Markdown supporté."></textarea>
    </div>`;
  el.querySelector(".custom-block-title").value   = block.title   || "";
  el.querySelector(".custom-block-content").value = block.content || "";
  list.appendChild(el);
}

function getCustomBlocks() {
  return [...$$("#customBlocksList .custom-block")].map(el => ({
    id:      el.dataset.cbid,
    title:   el.querySelector(".custom-block-title")?.value   || "",
    content: el.querySelector(".custom-block-content")?.value || "",
  })).filter(b => b.title.trim() || b.content.trim());
}

// =============================================================
//  NARRATION AUTO-FILL
// =============================================================

const NARRATION_CHIP_MAP = {
  pnl:              { label:"PnL",       color: v => v>0?"lime":"rose",    fmt: v => (v>0?"+":"")+v+"$" },
  rr:               { label:"RR",        color: ()=>"cyan",                fmt: v => v+"R" },
  is_win:           { label:"Résultat",  color: v => v?"lime":"rose",       fmt: v => v?"WIN ✓":"LOSS ✗" },
  strategy:         { label:"Stratégie", color: ()=>"violet",              fmt: v => prettify(v) },
  direction:        { label:"Direction", color: v => v==="long"?"lime":"rose", fmt: v => v.toUpperCase() },
  _htf_bias:        { label:"HTF Bias",  color: v => v==="bullish"?"lime":v==="bearish"?"rose":"amber", fmt: v => v.charAt(0).toUpperCase()+v.slice(1) },

  thesis_validated: { label:"Thèse",     color: v => v==="yes"?"lime":v==="no"?"rose":"amber", fmt: v => ({yes:"Validée ✓",no:"Invalidée ✗",partial:"Partielle ~"})[v]||v },
  tags:             { label:"Tags",      color: ()=>"magenta",             fmt: v => Array.isArray(v)?v.map(t=>"#"+t).join(" "):v },
};

function bindNarration() {
  const panel    = $("#narrationPanel");
  const closeBtn = $("#narrationClose");
  const parseBtn = $("#narrationParseBtn");
  const retryBtn = $("#narrationRetryBtn");
  const openBtn  = $("#narrationBtn");
  const textarea = $("#narrationText");
  if (!panel) return;

  openBtn?.addEventListener("click", () => {
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) setTimeout(() => textarea?.focus(), 80);
  });
  closeBtn?.addEventListener("click", () => panel.classList.add("hidden"));
  parseBtn?.addEventListener("click", () => runNarrationParse());
  retryBtn?.addEventListener("click", () => runNarrationParse());
  textarea?.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); runNarrationParse(); }
  });
}

async function runNarrationParse() {
  const textarea = $("#narrationText");
  const parseBtn = $("#narrationParseBtn");
  const retryBtn = $("#narrationRetryBtn");
  const btnLabel = $("#narrationBtnLabel");
  const preview  = $("#narrationPreview");
  const sourceEl = $("#narrationSource");
  const text = textarea?.value?.trim();
  if (!text) { toast("Décris d'abord ton trade", "error"); return; }

  parseBtn.disabled = true;
  if (retryBtn) retryBtn.classList.add("hidden");
  if (btnLabel) btnLabel.textContent = "Analyse en cours…";
  if (preview)  preview.classList.add("hidden");

  try {
    const data = await api("/api/parse-trade", {
      method: "POST", body: JSON.stringify({ text }),
    });
    if (sourceEl) {
      sourceEl.textContent = data._source === "claude" ? "✦ Claude AI" : "⚙ Regex";
      if (data._warning) sourceEl.textContent += " · fallback";
    }
    if (data._warning) {
      toast(data._warning, "error");
      if (retryBtn && data._retryable) retryBtn.classList.remove("hidden");
    }
    renderNarrationPreview(data, preview);
    const followUps = getNarrationFollowUps(data);
    if (followUps.length) {
      toast(`Challenge rapide: ${followUps.length} point(s) a completer`, "error");
    }
  } catch (err) {
    toast("Erreur analyse : " + err.message, "error");
    if (retryBtn) retryBtn.classList.remove("hidden");
  } finally {
    parseBtn.disabled = false;
    if (btnLabel) btnLabel.textContent = "Analyser & remplir";
  }
}

function renderNarrationPreview(data, container) {
  if (!container) return;
  const followUps = getNarrationFollowUps(data);
  const fields = Object.keys(NARRATION_CHIP_MAP).filter(k => data[k] != null);
  if (!fields.length && !followUps.length) {
    container.innerHTML = `<div class="narration-preview-title">Résultat</div>
      <p class="narration-none">Aucun champ détecté — sois plus précis dans ta description.</p>`;
    container.classList.remove("hidden");
    return;
  }
  const COLORS = new Set(["lime","rose","cyan","violet","amber","magenta"]);
  const chips  = fields.map((k, i) => {
    const cfg   = NARRATION_CHIP_MAP[k];
    const val   = data[k];
    const color = COLORS.has(cfg.color(val)) ? cfg.color(val) : "cyan";
    return `<span class="nc ${color}" style="animation-delay:${i*40}ms">
      <span class="nc-label">${escapeHtml(cfg.label)}</span>${escapeHtml(cfg.fmt(val))}
    </span>`;
  }).join("");
  const chipsSection = fields.length ? `
    <div class="narration-preview-title">Champs détectés — ${fields.length}</div>
    <div class="narration-chips">${chips}</div>` : "";
  const followUpSection = followUps.length ? `
    <div class="narration-preview-title">Challenge rapide — ${followUps.length} point(s)</div>
    <div class="narration-chat-list">
      ${followUps.map((q, i) => `
      <div class="narration-chat-item" style="animation-delay:${i * 50}ms">
        <div class="narration-chat-role">Assistant</div>
        <div class="narration-chat-q">${escapeHtml(q.question)}</div>
      </div>`).join("")}
    </div>
    <div class="narration-chat-help">Reponds dans la zone texte, puis relance “Analyser & remplir”.</div>
    <div class="narration-followup-row">
      <button type="button" class="btn-ghost" id="narrationInsertFollowupsBtn">Copier le challenge dans le chat</button>
    </div>` : "";
  container.innerHTML = `${chipsSection}${followUpSection}
    <div class="narration-apply-row">
      <button type="button" class="narration-apply-btn" id="narrationApplyBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        Appliquer au formulaire
      </button>
    </div>`;
  container.classList.remove("hidden");
  $("#narrationApplyBtn")?.addEventListener("click", () => applyNarrationToForm(data));
  $("#narrationInsertFollowupsBtn")?.addEventListener("click", () => injectNarrationFollowUps(followUps));
}

function getNarrationFollowUps(data) {
  const raw = Array.isArray(data?._follow_up_questions) ? data._follow_up_questions : [];
  return raw.map(item => {
    if (typeof item === "string") return { field: "", question: item };
    return {
      field: String(item?.field || ""),
      question: String(item?.question || ""),
    };
  }).filter(item => item.question.trim());
}

function injectNarrationFollowUps(followUps) {
  const textarea = $("#narrationText");
  if (!textarea || !followUps.length) return;
  const block = `\n\nQuestions a completer:\n${followUps.map(q => `- ${q.question}`).join("\n")}\n`;
  if (!textarea.value.includes("Questions a completer:")) {
    textarea.value = (textarea.value || "").trimEnd() + block;
  } else {
    textarea.value = (textarea.value || "").trimEnd() + "\n" + followUps.map(q => `- ${q.question}`).join("\n") + "\n";
  }
  textarea.focus();
  textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
}

function applyNarrationToForm(data) {
  const d = { ...data };
  delete d._source;

  // Champs du jour
  if (d._htf_bias) setPill("htf_bias", d._htf_bias);

  // Champs du trade (appliqués automatiquement)
  {
    if (d.strategy)        setPill("strategy",         d.strategy);
    if (d.direction)       setPill("direction",        d.direction);

    if (d.thesis_validated) setPill("thesis_validated", d.thesis_validated);
    if (d.why_trade)       { const el = $("#whyTrade"); if (el) el.value = d.why_trade; }
    if (d.why_entry)       { const el = $("#whyEntry"); if (el) el.value = d.why_entry; }
    if (d.scenario)        { const el = $("#scenario"); if (el) el.value = d.scenario; }
    if (d.why_stop)        { const el = $("#whyStop"); if (el) el.value = d.why_stop; }
    if (d.why_tp)          { const el = $("#whyTp"); if (el) el.value = d.why_tp; }
    if (d.stdv_level != null) { const el = $("#stdvLevel"); if (el) el.value = d.stdv_level; }
    if (d.pnl != null)     { const el = $("#pnl");  if (el) el.value = d.pnl; }
    if (d.rr  != null)     { const el = $("#rr");   if (el) el.value = d.rr; }
    if (d.is_win != null)  { const el = $("#isWin"); if (el) el.value = String(d.is_win); }
    if (Array.isArray(d.tags)) d.tags.forEach(t => addTag(t));
    updateRRPreview();
    if (typeof renderMidnightChallenge === "function") renderMidnightChallenge();
  }
  $("#narrationPanel")?.classList.add("hidden");
  const missing = Array.isArray(d._missing_fields) ? d._missing_fields : [];
  if (missing.length) {
    toast(`Champs appliqués (fiche partielle: ${missing.length} infos manquantes)`, "error");
  } else {
    toast("Champs appliqués ✓", "success");
  }
}

