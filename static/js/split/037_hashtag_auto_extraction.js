// ---------- Hashtag auto-extraction ----------

function bindHashtagSync() {
  MARKDOWN_FIELDS.forEach(fid => {
    document.getElementById(fid)?.addEventListener("blur", syncHashtagsFromText);
  });
}
function syncHashtagsFromText() {
  const allText = MARKDOWN_FIELDS.map(fid => document.getElementById(fid)?.value || "").join(" ");
  const found   = [...new Set([...allText.matchAll(/(?:^|[\s,;.])#([a-zA-Z][\w-]+)/g)].map(m => m[1]))];
  found.forEach(t => addTag(t));
}

