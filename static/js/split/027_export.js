// ---------- Export ----------

function bindExport() {
  $("#exportBtn")?.addEventListener("click", async () => {
    try {
      const data = await api("/api/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `journal-export-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`Export ${data.count} jours ✓`, "success");
    } catch (err) { toast(err.message, "error"); }
  });
}

