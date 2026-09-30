(function () {
  function patchLeaflet() {
    if (!window.L || !L.polygon || L.polygon.__cmgHair) return;
    const orig = L.polygon;
    L.polygon = function (latlngs, options) {
      options = options || {};
      if (options.fillColor === "#1c2a20" || options.fillOpacity === 0.28) {
        options = Object.assign({}, options, {
          fill: false, fillOpacity: 0, color: "#8aa58a", weight: 1.4, dashArray: "4 5"
        });
      }
      if (options.color === "#2e6a78" && options.fill === false) {
        options = Object.assign({}, options, {
          color: "#6aa0a8", weight: 1.2, dashArray: "6 8", opacity: 0.85
        });
      }
      return orig.call(this, latlngs, options);
    };
    L.polygon.__cmgHair = true;
  }
  patchLeaflet();
  document.addEventListener("DOMContentLoaded", patchLeaflet);
})();
