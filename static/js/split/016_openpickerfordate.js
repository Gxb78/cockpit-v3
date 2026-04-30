var _dayPickerEscHandler = null;
var _dayPickerDays = null;

function openPickerForDate(dateKey, days) {
  closeDayPicker();
  var safeDays = (days || []).slice().sort((a, b) => String(a.instrument || "").localeCompare(String(b.instrument || "")));
  _dayPickerDays = safeDays;
  if (safeDays.length === 0) {
    wizOpen({ date: dateKey });
    return;
  }

  var overlay = document.createElement("div");
  overlay.className = "day-picker-overlay";
  overlay.id = "dayPickerOverlay";

  var itemHtml = safeDays.map(function (day, idx) {
    var trades = day.trades || [];
    var pnl = trades.reduce(function (sum, t) { return sum + Number(deriveTradeMetrics(t).pnl || 0); }, 0);
    return `
      <button type="button" class="day-picker-item" data-idx="${idx}">
        <span class="day-picker-main">${escapeHtml(wizInstrumentLabel(day.instrument))}</span>
        <span class="day-picker-sub">${trades.length} trade${trades.length > 1 ? "s" : ""} - ${fmtMoney(pnl)}</span>
      </button>
    `;
  }).join("");

  overlay.innerHTML = `
    <div class="day-picker-backdrop"></div>
    <div class="day-picker-panel" role="dialog" aria-modal="true" aria-label="Selection du jour">
      <div class="day-picker-head">
        <div class="day-picker-title">${escapeHtml(dateKey)}</div>
        <button type="button" class="day-picker-close" aria-label="Fermer">x</button>
      </div>
      <div class="day-picker-list">${itemHtml}</div>
    </div>
  `;

  var onEsc = function (e) {
    if (e.key === "Escape") close();
  };
  var close = function () {
    closeDayPicker();
  };

  overlay.querySelector(".day-picker-backdrop")?.addEventListener("click", close);
  overlay.querySelector(".day-picker-close")?.addEventListener("click", close);
  overlay.querySelector(".day-picker-list")?.addEventListener("click", function (e) {
    var btn = e.target.closest(".day-picker-item");
    if (!btn) return;
    var idx = Number(btn.dataset.idx);
    close();
    openExistingDay(_dayPickerDays[idx]);
  });

  _dayPickerEscHandler = onEsc;
  document.addEventListener("keydown", onEsc);
  document.body.appendChild(overlay);
}

function closeDayPicker() {
  if (_dayPickerEscHandler) {
    document.removeEventListener("keydown", _dayPickerEscHandler);
    _dayPickerEscHandler = null;
  }
  document.getElementById("dayPickerOverlay")?.remove();
}
