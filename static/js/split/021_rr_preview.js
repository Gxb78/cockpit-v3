// ---------- RR preview ----------

function bindRRPreview() {
  ["entryPrice","stopLoss","takeProfit","exitPrice","positionSize"].forEach(id =>
    document.getElementById(id)?.addEventListener("input", updateRRPreview)
  );
  $("#tradeStatus")?.addEventListener("change", function() {
    syncTradeStatus();
    updateRRPreview();
  });
  $("#takeProfit")?.addEventListener("input", autoFillExitFromTarget);
  $("#exitPrice")?.addEventListener("input", () => {
    const exit = $("#exitPrice");
    if (exit) exit.dataset.autoSource = "manual";
    updateRRPreview();
  });
}

function autoFillExitFromTarget() {
  const exit = $("#exitPrice");
  const target = $("#takeProfit");
  if (!exit || !target) return;
  const tp = target.value;
  const source = exit.dataset.autoSource || "";
  if (!tp) {
    if (source === "tp") {
      exit.value = "";
      exit.dataset.autoSource = "";
      updateRRPreview();
    }
    return;
  }
  if (!exit.value || source === "tp") {
    exit.value = tp;
    exit.dataset.autoSource = "tp";
    updateRRPreview();
  }
}

function syncTradeStatus() {
  var status = $("#tradeStatus")?.value;
  var exit = $("#exitPrice");
  var isWinField = $("#isWin");
  if (!status || !exit) return;
  if (status === "open") {
    // Trade ouvert → pas de prix de sortie, PnL inconnu
    exit.value = "";
    exit.disabled = true;
    exit.dataset.autoSource = "";
    if (isWinField) isWinField.value = "";
  } else {
    // Trade clos → prix de sortie actif
    exit.disabled = false;
    // Re-essayer auto-fill depuis TP si exit vide
    if (!exit.value) autoFillExitFromTarget();
  }
  updateRRPreview();
}

function updateRRPreview() {
  const entry = numOrNull("entryPrice");
  const stop  = numOrNull("stopLoss");
  const target = numOrNull("takeProfit");
  const exit  = numOrNull("exitPrice");
  const qty   = numOrNull("positionSize") || 1;
  const prev = $("#rrPreview");
  const rrField = $("#rr");
  const pnlField = $("#pnl");
  const isWinField = $("#isWin");
  if (!prev) return;
  const selectedDirection = getPill("direction");
  const inferredDirection = inferDirectionFromPrices(entry, stop, target);
  const direction = selectedDirection || inferredDirection;
  var tradeStatus = $("#tradeStatus")?.value || "closed";

  let rrValue = null;
  if (entry != null && stop != null && target != null && stop !== entry) {
    rrValue = Math.abs(target - entry) / Math.abs(entry - stop);
  }
  if (rrField) rrField.value = rrValue != null ? rrValue.toFixed(2) : "";

  let pnlValue = null;
  if (tradeStatus === "closed" && direction && entry != null && exit != null) {
    pnlValue = (direction === "long" ? (exit - entry) : (entry - exit)) * qty;
    if (pnlField) pnlField.value = pnlValue.toFixed(2);
    // Deriver is_win depuis le PnL (champ hidden)
    if (isWinField) {
      isWinField.value = pnlValue > 0 ? "1" : pnlValue < 0 ? "0" : "";
    }
  } else if (tradeStatus === "open") {
    // Trade ouvert: PnL = 0, pas de win/loss
    if (pnlField) pnlField.value = "0";
    if (isWinField) isWinField.value = "";
  }

  if (entry != null && stop != null && target != null && stop !== entry) {
    const riskPerContract = Math.abs(entry - stop);
    const rewardPerContract = Math.abs(target - entry);
    const gainEstimate = rewardPerContract * qty;
    const lossEstimate = riskPerContract * qty;
    const dirLabel = direction === "short" ? "Short" : "Long";

    if (tradeStatus === "open") {
      prev.textContent = dirLabel + " - RR theorique: " + rrValue.toFixed(2) + "R - Estimation (" + qty + " contrat" + (qty > 1 ? "s" : "") + "): +" + gainEstimate.toFixed(2) + " / -" + lossEstimate.toFixed(2) + " (trade ouvert)";
      prev.className = "rr-preview visible";
    } else {
      // SL = TP → warning
      var slEqualsTp = stop === target || Math.abs(stop - target) < 0.01;
      if (slEqualsTp) {
        prev.textContent = dirLabel + " - SL = TP: impossible de calculer un RR theorique pertinent.";
        prev.className = "rr-preview visible warn";
      } else {
        prev.textContent = dirLabel + " - RR theorique: " + rrValue.toFixed(2) + "R - Estimation (" + qty + " contrat" + (qty > 1 ? "s" : "") + "): +" + gainEstimate.toFixed(2) + " / -" + lossEstimate.toFixed(2);
        prev.className = "rr-preview visible";
      }
    }
  } else {
    prev.textContent = "";
    prev.className = "rr-preview";
  }
}
