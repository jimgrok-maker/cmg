(function () {
  document.addEventListener("DOMContentLoaded", function () {
    const sheet = document.getElementById("plannerSheet");
    const btn = document.getElementById("sheetToggle");
    if (!sheet || !btn) return;
    let mode = "normal"; // "normal" | "expanded" | "collapsed"
    function sync() {
      sheet.classList.toggle("sheet-collapsed", mode === "collapsed");
      sheet.classList.toggle("sheet-expanded", mode === "expanded");
      btn.textContent = mode === "collapsed" ? "Show panel" : (mode === "expanded" ? "Hide panel" : "Expand");
      if (window.CMGMap && typeof window.CMGMap.invalidateSize === "function") {
        setTimeout(function () {
          try { window.CMGMap.invalidateSize({ animate: false }); } catch (e) {}
        }, 220);
      }
    }
    btn.onclick = function () {
      mode = mode === "normal" ? "expanded" : (mode === "expanded" ? "collapsed" : "normal");
      sync();
    };
  });
})();
