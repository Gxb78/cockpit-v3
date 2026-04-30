// ---------- Markdown preview ----------

const MARKDOWN_FIELDS = ["htfContext","midnightOpen","dailyNotes","whyTrade","whyEntry","whyStop","stdvLevel","lessonsLearned"];

function bindMarkdownToggles() {
  MARKDOWN_FIELDS.forEach(fid => {
    const ta    = document.getElementById(fid);
    if (!ta) return;
    const field = ta.closest(".field");
    if (!field || field.querySelector(".field-h")) return;
    const label = field.querySelector("label");
    if (!label) return;

    const h   = document.createElement("div"); h.className = "field-h";
    label.parentNode.insertBefore(h, label);
    h.appendChild(label);
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "field-toggle"; btn.title = "Aperçu Markdown";
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    h.appendChild(btn);
    const prev  = document.createElement("div");
    prev.className = "md-preview hidden"; prev.id = fid + "Preview";
    ta.after(prev);
    btn.addEventListener("click", () => {
      const isPreview = btn.classList.toggle("active");
      if (isPreview) {
        prev.innerHTML = renderMarkdown(ta.value) || `<span class="md-empty">— rien à prévisualiser —</span>`;
        prev.classList.remove("hidden"); ta.classList.add("hidden");
      } else {
        prev.classList.add("hidden"); ta.classList.remove("hidden"); ta.focus();
      }
    });
  });
}

function renderMarkdown(text) {
  if (!text) return "";
  let html = escapeHtml(text);
  html = html.replace(/```([\s\S]*?)```/g, (_, code) =>
    `<pre style="background:rgba(0,0,0,0.3);padding:10px 12px;border-radius:8px;overflow-x:auto;font-family:JetBrains Mono,monospace;font-size:12px;color:var(--cyan);border:1px solid var(--border)"><code>${code}</code></pre>`);
  html = html.replace(/^### (.+)$/gm,"<h3>$1</h3>").replace(/^## (.+)$/gm,"<h2>$1</h2>").replace(/^# (.+)$/gm,"<h1>$1</h1>");
  html = html.replace(/^&gt; (.+)$/gm,"<blockquote>$1</blockquote>");
  html = html.replace(/^---+$/gm,"<hr>");
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,'<img src="$2" alt="$1" class="md-inline-image" loading="lazy">');
  html = html.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>");
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g,"<em>$1</em>");
  html = html.replace(/`([^`]+)`/g,"<code>$1</code>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/(^|[\s,;])#([a-zA-Z][\w-]*)/g,'$1<span class="md-tag">#$2</span>');
  html = html.replace(/^([-*]) (.+)$/gm,"<li>$2</li>");
  html = html.replace(/(?:<li>.*<\/li>\s*)+/g, m => `<ul>${m}</ul>`);
  html = html.replace(/\n(?!<\/?(h[1-3]|ul|li|blockquote|hr|pre))/g,"<br>");
  return html;
}

