// ---------- Helpers ----------

function _lastInstrument() {
  const raw = String(state.allDays[0]?.instrument || "BTC").toUpperCase();
  return raw === "NAS" ? "NQ" : raw;
}






