// ---------- RR preview ----------

function bindRRPreview() {
  ["entryPrice","stopLoss","takeProfit","exitPrice","positionSize"].forEach(id =>
    document.getElementById(id)?.addEventListener("input", updateRRPreview)
  );
  $("#takeProfit")?.addEventListener("input", autoFillExitFromTarget);
  $("#exitPrice")?.addEventListener("input", () => {
    const exit = $("#exitPrice");
    if (exit) exit.dataset.autoSource = "manual";
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

  let rrValue = null;
  if (entry != null && stop != null && target != null && stop !== entry) {
    rrValue = Math.abs(target - entry) / Math.abs(entry - stop);
  }
  if (rrField) rrField.value = rrValue != null ? rrValue.toFixed(2) : "";

  let pnlValue = null;
  if (direction && entry != null && exit != null) {
    pnlValue = (direction === "long" ? (exit - entry) : (entry - exit)) * qty;
    if (pnlField) pnlField.value = pnlValue.toFixed(2);
    if (isWinField) isWinField.value = pnlValue > 0 ? "1" : pnlValue < 0 ? "0" : "";
  }

  if (entry != null && stop != null && target != null && stop !== entry) {
    const riskPerContract = Math.abs(entry - stop);
    const rewardPerContract = Math.abs(target - entry);
    const gainEstimate = rewardPerContract * qty;
    const lossEstimate = riskPerContract * qty;
    const dirLabel = direction === "short" ? "Short" : "Long";
    prev.textContent = `${dirLabel} - RR theorique: ${rrValue.toFixed(2)}R - Estimation (${qty} contrat${qty > 1 ? "s" : ""}): +${gainEstimate.toFixed(2)} / -${lossEstimate.toFixed(2)}`;
    prev.className = "rr-preview visible";
  } else {
    prev.textContent = "";
    prev.className = "rr-preview";
  }
}

