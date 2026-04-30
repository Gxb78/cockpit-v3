// ---------- Enhanced select : remplace les <select> natifs par un dropdown custom ----------
//
// Le select natif est cache mais garde sa valeur (utilise pour la compatibilité formulaire).
// Un bouton + dropdown stylisé le remplace visuellement.
//
// Usage : enhanceSelects() apres tout render qui ajoute/modifie des selects.
// Les selects deja enhances (data-enhanced="1") sont ignores.

function enhanceSelects(container) {
  const root = container || document;
  const selects = root.querySelectorAll(".select-wrapper select:not([data-enhanced])");
  if (!selects.length) return;

  selects.forEach(function (select) {
    if (select.dataset.enhanced) return;
    select.dataset.enhanced = "1";

    // Cacher la fleche native
    var arrowSvg = select.parentNode.querySelector(".select-arrow");
    if (arrowSvg) arrowSvg.style.display = "none";

    // Cacher le select natif
    select.style.position = "absolute";
    select.style.opacity = "0";
    select.style.width = "0";
    select.style.height = "0";
    select.style.pointerEvents = "none";

    // Trigger button
    var trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "custom-select-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    var label = document.createElement("span");
    label.className = "trigger-label";
    label.textContent = _getSelectedText(select);

    var arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    arrow.setAttribute("viewBox", "0 0 16 16");
    arrow.setAttribute("width", "12");
    arrow.setAttribute("height", "12");
    arrow.setAttribute("fill", "none");
    arrow.setAttribute("stroke", "currentColor");
    arrow.setAttribute("stroke-width", "1.8");
    arrow.setAttribute("stroke-linecap", "round");
    arrow.setAttribute("stroke-linejoin", "round");
    arrow.className = "trigger-arrow";
    var polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("points", "4 6 8 10 12 6");
    arrow.appendChild(polyline);

    trigger.appendChild(label);
    trigger.appendChild(arrow);

    // Dropdown
    var dropdown = document.createElement("div");
    dropdown.className = "custom-select-dropdown";
    dropdown.setAttribute("role", "listbox");
    dropdown.setAttribute("aria-label", select.id || "Options");

    Array.from(select.options).forEach(function (opt, i) {
      if (opt.disabled && !opt.value) return; // sauter le placeholder disabled

      var item = document.createElement("div");
      item.className = "custom-select-item";
      item.dataset.value = opt.value;
      item.textContent = opt.textContent;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", opt.selected ? "true" : "false");
      if (opt.selected) item.classList.add("selected");

      item.addEventListener("click", function (e) {
        e.stopPropagation();
        _selectOption(select, opt.value, trigger, dropdown);
      });

      dropdown.appendChild(item);
    });

    // Insertion dans le DOM
    select.parentNode.appendChild(trigger);
    select.parentNode.appendChild(dropdown);

    // Toggle dropdown
    trigger.addEventListener("click", function (e) {
      e.stopPropagation();
      _toggleSelect(trigger, dropdown, select);
    });

    // Fermer si click ailleurs
    trigger._docHandler = function () { _closeSelect(trigger, dropdown); };
    document.addEventListener("click", trigger._docHandler);
  });
}

function _getSelectedText(select) {
  var idx = select.selectedIndex;
  if (idx >= 0 && select.options[idx]) return select.options[idx].textContent;
  return "\u2014";
}

function _selectOption(select, value, trigger, dropdown) {
  select.value = value;
  trigger.querySelector(".trigger-label").textContent = _getSelectedText(select);
  dropdown.querySelectorAll(".custom-select-item").forEach(function (el) {
    var sel = el.dataset.value === value;
    el.classList.toggle("selected", sel);
    el.setAttribute("aria-selected", sel ? "true" : "false");
  });
  _closeSelect(trigger, dropdown);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function _toggleSelect(trigger, dropdown, select) {
  var isOpen = dropdown.classList.contains("open");
  document.querySelectorAll(".custom-select-dropdown.open").forEach(function (d) {
    if (d !== dropdown) {
      d.classList.remove("open");
      var t = d._trigger;
      if (t) { t.classList.remove("open"); t.setAttribute("aria-expanded", "false"); }
    }
  });
  if (isOpen) {
    _closeSelect(trigger, dropdown);
  } else {
    _openSelect(trigger, dropdown, select);
  }
}

function _openSelect(trigger, dropdown, select) {
  dropdown.classList.add("open");
  trigger.classList.add("open");
  trigger.setAttribute("aria-expanded", "true");
  dropdown._trigger = trigger;

  // Positionnement sous le trigger
  var rect = trigger.getBoundingClientRect();
  var ddH = Math.min(dropdown.scrollHeight || 200, 240);
  var spaceBelow = window.innerHeight - rect.bottom;
  var spaceAbove = rect.top;

  if (spaceBelow >= ddH || spaceBelow > spaceAbove) {
    dropdown.style.top = rect.bottom + "px";
    dropdown.style.left = rect.left + "px";
    dropdown.style.width = Math.max(rect.width, 160) + "px";
    dropdown.style.maxHeight = (spaceBelow - 4) + "px";
    dropdown.style.transformOrigin = "top";
  } else {
    dropdown.style.top = (rect.top - ddH) + "px";
    dropdown.style.left = rect.left + "px";
    dropdown.style.width = Math.max(rect.width, 160) + "px";
    dropdown.style.maxHeight = (spaceAbove - 4) + "px";
    dropdown.style.transformOrigin = "bottom";
  }

  // Scroll vers l'option selectionnée
  var sel = dropdown.querySelector(".custom-select-item.selected");
  if (sel) sel.scrollIntoView({ block: "nearest" });
}

function _closeSelect(trigger, dropdown) {
  dropdown.classList.remove("open");
  if (trigger) { trigger.classList.remove("open"); trigger.setAttribute("aria-expanded", "false"); }
}
