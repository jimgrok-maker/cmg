(function () {
  function gpxEscape(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function ptsFromMap() {
    const pts = [];
    if (window.CMGGetRoute) {
      const rt = window.CMGGetRoute();
      if (rt && rt.points && rt.points.length >= 2) return rt.points;
      if (rt && rt.wps && rt.wps.length >= 2) return rt.wps;
    }
    return pts;
  }
  function buildGpx() {
    const pts = ptsFromMap();
    if (pts.length < 2) return null;
    const lakeName = (window.CMGGetRoute && window.CMGGetRoute().lakeName) || "CMG";
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<gpx version="1.1" creator="CMG" xmlns="http://www.topografix.com/GPX/1/1">\n';
    xml += '  <rte><name>' + gpxEscape("CMG " + lakeName) + '</name>\n';
    pts.forEach(function (p, i) {
      const label = p.name || (i === 0 ? "Start" : (i === pts.length - 1 ? "Dest" : "WP " + i));
      xml += '    <rtept lat="' + Number(p.lat).toFixed(6) + '" lon="' + Number(p.lon).toFixed(6) + '"><name>' + gpxEscape(label) + '</name></rtept>\n';
    });
    xml += '  </rte>\n</gpx>\n';
    return xml;
  }
  function exportGpx() {
    const xml = buildGpx();
    if (!xml) { alert("Add two marks first."); return; }
    const fn = "cmg-route.gpx";
    if (window.CMGNative && window.CMGNative.shareGpx) {
      window.CMGNative.shareGpx(fn, xml);
      return;
    }
    const blob = new Blob([xml], { type: "application/gpx+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fn;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  document.addEventListener("DOMContentLoaded", function () {
    const btn = document.getElementById("exportGpx");
    if (btn) btn.onclick = exportGpx;
  });
  window.CMGExportGpx = exportGpx;
})();
