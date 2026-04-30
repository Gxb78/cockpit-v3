// ---------- Heatmap ----------

var _hmLastActivity = null;  // cache: skip rerender if same reference
var _hmDelegated    = false; // flag: one-shot delegated listener

function renderHeatmap(activity) {
  if (activity === _hmLastActivity) return;
  _hmLastActivity = activity;

  const grid   = $("#heatmap");
  const months = $("#heatmapMonths");
  if (!grid || !months) return;

  const map = {};
  activity.forEach(a => { map[a.date] = a; });

  const today     = new Date();
  today.setHours(0,0,0,0);
  const totalDays = 365 + ((today.getDay() + 6) % 7);
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - totalDays + 1);

  let maxAbs = 1;
  Object.values(map).forEach(a => { if (Math.abs(a.pnl) > maxAbs) maxAbs = Math.abs(a.pnl); });

  // Build cells array (same logic, no DOM)
  const cells = [];
  const cur   = new Date(startDate);
  while (cur <= today) {
    const key = fmtDateKey(cur);
    const a   = map[key];
    let level = 0, cls = "";
    if (a) {
      if (a.pnl > 0)      { cls = "win";  level = Math.min(4, Math.ceil((Math.abs(a.pnl)/maxAbs)*4)); }
      else if (a.pnl < 0) { cls = "loss"; level = Math.min(4, Math.ceil((Math.abs(a.pnl)/maxAbs)*4)); }
      else                  level = Math.min(2, a.entries);
    }
    cells.push({ date: key, level, cls, info: a });
    cur.setDate(cur.getDate() + 1);
  }

  const weeks = Math.ceil(cells.length / 7);
  months.style.gridTemplateColumns = `repeat(${weeks}, 12px)`;

  // --- Month labels: innerHTML batch ---
  let lastMonth = -1;
  const monthParts = [];
  for (let w = 0; w < weeks; w++) {
    const cell = cells[w * 7];
    const m    = cell ? parseInt(cell.date.slice(5,7), 10) - 1 : -1;
    monthParts.push(
      (m !== -1 && m !== lastMonth)
        ? `<span>${MONTHS_FR[m].slice(0,3)}</span>`
        : `<span></span>`
    );
    if (m !== -1) lastMonth = m;
  }
  months.innerHTML = monthParts.join("");

  // --- Heatmap cells: innerHTML batch (no createElement per cell) ---
  const tk = todayKey();
  const cellParts = cells.map(c => {
    const cls = `hm-cell ${c.cls}${c.date === tk ? " today" : ""}`;
    const tt  = JSON.stringify(c.info
      ? { date: c.date, entries: c.info.entries, pnl: c.info.pnl, wins: c.info.wins, losses: c.info.losses }
      : { date: c.date, entries: 0, pnl: 0, wins: 0, losses: 0 }
    );
    return `<div class="${cls}" data-l="${c.level}" data-tt='${tt}'></div>`;
  });
  grid.innerHTML = cellParts.join("");

  // --- Single delegated listener (attached once) ---
  if (!_hmDelegated) {
    _hmDelegated = true;
    grid.addEventListener("mouseover", hmMouseOver);
    grid.addEventListener("mouseleave", hmMouseLeave);
    grid.addEventListener("click", hmClick);
  }
}

// ---------- Delegated event handlers ----------

var _hmCurrentCell = null;

function hmMouseOver(e) {
  const cell = e.target.closest(".hm-cell");
  if (cell && cell !== _hmCurrentCell) {
    _hmCurrentCell = cell;
    showHmTooltip(cell);
  }
}

function hmMouseLeave() {
  _hmCurrentCell = null;
  hideHmTooltip();
}

function hmClick(e) {
  const cell = e.target.closest(".hm-cell");
  if (!cell) return;
  const d = JSON.parse(cell.dataset.tt);
  const [y, m] = d.date.split("-").map(Number);
  state.currentMonth = new Date(y, m - 1, 1);
  goPage("journal");
  setTimeout(loadMonth, 50);
}

// ---------- Tooltip helpers (unchanged signatures) ----------

function showHmTooltip(el) {
  var tt = $("#hmTooltip");
  if (!tt) {
    tt = document.createElement("div");
    tt.id = "hmTooltip"; tt.className = "hm-tooltip";
    document.body.appendChild(tt);
  }
  var d = JSON.parse(el.dataset.tt);
  var pnlClass = d.pnl > 0 ? "pos" : d.pnl < 0 ? "neg" : "";
  tt.innerHTML = `<div class="hm-tt-date">${d.date}</div>
    ${d.entries === 0
      ? `<div class="hm-tt-meta">Aucune entrée</div>`
      : `<div class="hm-tt-pnl ${pnlClass}">${fmtMoney(d.pnl)}</div>
         <div class="hm-tt-meta">${d.entries} jour${d.entries>1?"s":""}${d.wins?" · "+d.wins+"W":""}${d.losses?" · "+d.losses+"L":""}</div>`}`;
  var rect = el.getBoundingClientRect();
  tt.style.left    = rect.left + rect.width/2 + "px";
  tt.style.top     = rect.top + "px";
  tt.style.display = "block";
}

function hideHmTooltip() {
  var tt = $("#hmTooltip");
  if (tt) tt.style.display = "none";
}
