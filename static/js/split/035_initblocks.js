var _initBlocksDelegationBound = false;

function initBlocks() {
  var collapsed = loadCollapsedBlocks();
  $$("#entryModal .block").forEach(function (block) {
    var head = block.querySelector(".block-h");
    if (!head) return;
    if (!block.dataset.bid) {
      block.dataset.bid = slugify(head.textContent.trim().split(/\s+/).slice(0, 4).join(" "));
    }
    var bid = block.dataset.bid;
    if (!head.querySelector(".chevron")) {
      var sum = document.createElement("span"); sum.className = "block-summary";
      var spc = document.createElement("span"); spc.className = "block-h-spacer";
      var chev = document.createElement("button");
      chev.type = "button"; chev.className = "chevron"; chev.title = "Replier / déplier";
      chev.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
      head.append(sum, spc, chev);
    }
    if (collapsed[bid]) block.classList.add("collapsed");
    updateBlockSummary(block);
  });

  if (_initBlocksDelegationBound) return;
  _initBlocksDelegationBound = true;
  $("#entryModal")?.addEventListener("click", function (e) {
    if (e.target.closest("button:not(.chevron), input, select, textarea, .pill-choice")) return;
    var head = e.target.closest(".block-h");
    if (!head) return;
    var block = head.closest(".block");
    if (!block) return;
    var bid = block.dataset.bid;
    var willOpen = block.classList.contains("collapsed");
    if (willOpen && document.querySelector("#entryModal.modal-trade-focus")) {
      $$("#tradeFormSection .block").forEach(function (other) {
        if (other === block || other.classList.contains("hidden")) return;
        other.classList.add("collapsed");
        var oid = other.dataset.bid;
        if (oid) {
          var oc = loadCollapsedBlocks();
          oc[oid] = true;
          saveCollapsedBlocks(oc);
        }
        updateBlockSummary(other);
      });
    }
    block.classList.toggle("collapsed");
    var c = loadCollapsedBlocks();
    c[bid] = block.classList.contains("collapsed");
    saveCollapsedBlocks(c);
    updateBlockSummary(block);
    if (typeof refreshTradeFlowNavState === "function") refreshTradeFlowNavState();
  });
}

function updateBlockSummary(block) {
  const sum = block.querySelector(".block-summary");
  if (!sum) return;
  const parts = [];
  block.querySelectorAll(".pills .pill-choice.active").forEach(p => parts.push(p.textContent.trim()));
  block.querySelectorAll("textarea, input[type='text'], input[type='number']").forEach(inp => {
    if (parts.length >= 3) return;
    const v = (inp.value || "").trim();
    if (v && inp.id !== "tagsInputField")
      parts.push(v.length > 28 ? v.slice(0,28)+"…" : v);
  });
  const q = block.querySelector("#executionQuality")?.value;
  if (q) parts.push("★".repeat(Number(q)));
  sum.textContent = parts.filter(Boolean).slice(0,4).join(" · ");
}

