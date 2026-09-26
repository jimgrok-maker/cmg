(function () {
  const STORE = "cmg.v1";
  const VARIATION_W = 7.6;
  const state = {
    windSource: "hrrr", depth: "noaa", boatId: "mac26x", genericLwl: 23,
    magnetic: false, hybrid: false, tws: 10, twd: 270,
    windPack: null, waypoints: [], lakeRing: null, route: null, lakeReady: false
  };
  let map, routeLayer, wpLayer, islandLayer;

  function boat() {
    return state.boatId === "generic" ? CMGPolars.genericClass(state.genericLwl) : CMGPolars.CLASSES[state.boatId];
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify({ boatId: state.boatId, genericLwl: state.genericLwl, windSource: state.windSource, magnetic: state.magnetic })); } catch (e) {}
  }
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(STORE) || "{}");
      if (p.boatId) state.boatId = p.boatId;
      if (p.genericLwl) state.genericLwl = p.genericLwl;
      if (p.windSource) state.windSource = p.windSource;
      if (typeof p.magnetic === "boolean") state.magnetic = p.magnetic;
    } catch (e) {}
  }
  function fmtHrs(h) {
    if (!isFinite(h)) return "—";
    const m = Math.round(h * 60);
    return Math.floor(m / 60) + "h " + String(m % 60).padStart(2, "0") + "m";
  }
  function fmtCrs(trueDeg) {
    const d = state.magnetic ? CMGGeo.wrap360(trueDeg + VARIATION_W) : trueDeg;
    return String(Math.round(d)).padStart(3, "0") + "°" + (state.magnetic ? "M" : "T");
  }
  function showSetup(on) {
    document.getElementById("setup").classList.toggle("hidden", !on);
    document.getElementById("planner").classList.toggle("hidden", on);
  }
  function bindSetup() {
    document.getElementById("windSource").value = state.windSource;
    document.getElementById("depth").value = state.depth;
    document.getElementById("boat").value = state.boatId;
    document.getElementById("genericLwl").value = state.genericLwl;
    document.getElementById("genericWrap").classList.toggle("hidden", state.boatId !== "generic");
    document.getElementById("mag").checked = state.magnetic;
    const b = boat();
    document.getElementById("boatMeta").textContent = b.name + " · LWL " + b.lwl.toFixed(1) + " ft · hull " + CMGPolars.hullSpeed(b.lwl).toFixed(2) + " kn · " + (b.notes || "");
  }
  function renderBoatOptions() {
    const sel = document.getElementById("boat");
    sel.innerHTML = "";
    Object.values(CMGPolars.CLASSES).forEach((c) => {
      const o = document.createElement("option"); o.value = c.id; o.textContent = c.name; sel.appendChild(o);
    });
    const g = document.createElement("option"); g.value = "generic"; g.textContent = "Generic (LWL formula)"; sel.appendChild(g);
    sel.value = state.boatId;
  }
  function resizeMap() {
    if (!map) return;
    map.invalidateSize({ animate: false });
  }
  async function loadLake() {
    if (state.lakeReady || !map) return;
    const gj = await (await fetch("data/erie.json")).json();
    state.lakeRing = gj.features[0].geometry.coordinates[0];
    L.polygon(state.lakeRing.map((c) => [c[1], c[0]]), { color:"#2e6a78", weight:1, fill:false }).addTo(map);
    islandLayer.clearLayers();
    CMG_ISLANDS.forEach((isl) => {
      L.polygon(isl.ring.map((c) => [c[1], c[0]]), { color:"#6a8a72", weight:1, fillColor:"#1c2a20", fillOpacity:0.55 }).addTo(islandLayer).bindTooltip(isl.name, { sticky:true });
    });
    state.lakeReady = true;
  }
  function addWp(pt) {
    state.waypoints.push({ lat: pt.lat, lon: pt.lon, name: pt.name || ("Mark " + (state.waypoints.length + 1)) });
    drawWaypoints(); renderWpList(); compute();
  }
  function drawWaypoints() {
    if (!wpLayer) return;
    wpLayer.clearLayers();
    state.waypoints.forEach((w, i) => {
      L.circleMarker([w.lat, w.lon], { radius:7, color:"#e7efe8", fillColor:"#3d9a6a", fillOpacity:1, weight:2 }).addTo(wpLayer).bindTooltip((i+1) + " · " + w.name);
    });
  }
  function renderWpList() {
    const box = document.getElementById("wps"); box.innerHTML = "";
    state.waypoints.forEach((w, i) => {
      const d = document.createElement("div"); d.className = "wp";
      d.innerHTML = "<span>" + (i+1) + " · " + w.name + "</span>";
      const rm = document.createElement("button"); rm.className = "ghost"; rm.textContent = "remove";
      rm.onclick = () => { state.waypoints.splice(i, 1); drawWaypoints(); renderWpList(); compute(); };
      d.appendChild(rm); box.appendChild(d);
    });
  }
  function drawRoute(rt) {
    if (!routeLayer) return;
    routeLayer.clearLayers();
    if (!rt) return;
    rt.segs.forEach((s) => {
      L.polyline([[s.from.lat, s.from.lon], [s.to.lat, s.to.lon]], { color:s.color, weight:s.land?2:5, dashArray:s.land?"6 6":null, opacity:0.95 })
        .addTo(routeLayer).bindTooltip(fmtCrs(s.course) + " · " + s.dist.toFixed(2) + " nm · TWA " + Math.round(s.twa) + "° · " + (s.mode==="motor" ? "motor 4 kn" : s.bsp.toFixed(1)+" kn"));
    });
  }
  function compute() {
    const out = document.getElementById("stats");
    if (!map || state.waypoints.length < 2) { state.route = null; if (routeLayer) routeLayer.clearLayers(); out.innerHTML = ""; return; }
    const rt = CMGRoute.buildRoute(state.waypoints, boat(), state.tws, state.twd, state.lakeRing, window.CMG_ISLANDS, state.hybrid);
    state.route = rt; drawRoute(rt);
    out.innerHTML =
      '<div class="stat"><b>' + rt.totalNm.toFixed(1) + '</b><span>nm sailed</span></div>' +
      '<div class="stat"><b>' + fmtHrs(rt.tHours) + '</b><span>P50 ETA</span></div>' +
      '<div class="stat"><b>' + fmtHrs(rt.tHours * 1.22) + '</b><span>P90 ETA</span></div>' +
      '<div class="stat"><b>' + Math.round(rt.pctVmg2) + '%</b><span>VMG ≥ 2 kn</span></div>' +
      '<div class="stat"><b>' + Math.round(rt.pctVmg4) + '%</b><span>VMG ≥ 4 kn</span></div>' +
      '<div class="stat"><b>' + (rt.motorUsed ? "yes" : "no") + '</b><span>motor offered</span></div>';
    const warn = [];
    if (rt.landHit) warn.push("A leg crosses land or an island — add a waypoint.");
    if (rt.motorUsed) warn.push("VMG < 2 kn on a leg; motor at 4 kn used in hybrid compare.");
    const rw = document.getElementById("routeWarn");
    rw.innerHTML = warn.join(" "); rw.classList.toggle("hidden", warn.length === 0);
  }
  async function refreshWind() {
    const src = state.windSource;
    const el = document.getElementById("windLabel");
    if (src === "manual") { el.textContent = "Manual " + state.tws + " kn from " + String(Math.round(state.twd)).padStart(3,"0") + "°"; compute(); return; }
    el.textContent = "Fetching " + src + "…";
    try {
      const pack = await CMGWind.fetchForecast(map.getCenter().lat, map.getCenter().lng, src);
      state.windPack = pack;
      const now = CMGWind.atTime(pack, Date.now());
      if (now && now.tws != null) {
        state.tws = now.tws; state.twd = now.twd;
        document.getElementById("tws").value = Math.round(state.tws * 10) / 10;
        document.getElementById("twd").value = Math.round(state.twd);
        el.textContent = src.toUpperCase() + " " + now.tws.toFixed(0) + " kn from " + String(Math.round(now.twd)).padStart(3,"0") + "° @ " + (now.time || "").slice(11,16);
      }
    } catch (e) {
      const cached = CMGWind.loadCache();
      if (cached) {
        state.windPack = cached;
        const now = CMGWind.atTime(cached, Date.now());
        if (now) { state.tws = now.tws; state.twd = now.twd; }
        el.textContent = "Cached wind " + state.tws.toFixed(0) + " kn from " + Math.round(state.twd) + "°";
      } else el.textContent = "Wind fetch failed — using manual";
    }
    compute();
  }
  function initMap() {
    if (map) return;
    map = L.map("map", { zoomControl: true, fadeAnimation: false }).setView([41.66, -82.82], 10);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 16,
      attribution: "&copy; OpenStreetMap",
      updateWhenIdle: false,
      keepBuffer: 2
    }).addTo(map);
    islandLayer = L.layerGroup().addTo(map);
    routeLayer = L.layerGroup().addTo(map);
    wpLayer = L.layerGroup().addTo(map);
    map.on("click", (e) => addWp({ lat:e.latlng.lat, lon:e.latlng.lng, name:"Tap " + (state.waypoints.length + 1) }));
    CMG_POIS.forEach((p) => {
      L.marker([p.lat, p.lon], { icon: L.divIcon({ className:"poi-div", html: p.name.split(" ")[0] }) }).addTo(map).on("click", () => addWp({ lat:p.lat, lon:p.lon, name:p.name }));
    });
    window.addEventListener("resize", resizeMap);
  }
  function openChart() {
    save();
    showSetup(false);
    requestAnimationFrame(function () {
      requestAnimationFrame(async function () {
        initMap();
        resizeMap();
        await loadLake();
        resizeMap();
        refreshWind();
      });
    });
  }
  document.addEventListener("DOMContentLoaded", () => {
    loadPrefs(); renderBoatOptions(); bindSetup();
    const s = document.getElementById("poi");
    s.innerHTML = '<option value="">Add a listed mark…</option>';
    CMG_POIS.forEach((p) => { const o = document.createElement("option"); o.value = p.id; o.textContent = p.name; s.appendChild(o); });
    s.onchange = () => { const p = CMG_POIS.find((x) => x.id === s.value); if (p) addWp({ lat:p.lat, lon:p.lon, name:p.name }); s.value = ""; };
    document.getElementById("openChart").onclick = openChart;
    document.getElementById("editSetup").onclick = () => showSetup(true);
    document.getElementById("boat").onchange = (e) => { state.boatId = e.target.value; document.getElementById("genericWrap").classList.toggle("hidden", state.boatId !== "generic"); bindSetup(); };
    document.getElementById("genericLwl").onchange = (e) => { state.genericLwl = Number(e.target.value) || 23; bindSetup(); };
    document.getElementById("windSource").onchange = (e) => { state.windSource = e.target.value; };
    document.getElementById("depth").onchange = (e) => { state.depth = e.target.value; };
    document.getElementById("mag").onchange = (e) => { state.magnetic = e.target.checked; compute(); };
    document.getElementById("tws").oninput = (e) => { state.tws = Number(e.target.value); compute(); };
    document.getElementById("twd").oninput = (e) => { state.twd = Number(e.target.value); compute(); };
    document.getElementById("hybrid").onchange = (e) => { state.hybrid = e.target.checked; compute(); };
    document.getElementById("clearWp").onclick = () => { state.waypoints = []; drawWaypoints(); renderWpList(); compute(); };
    document.getElementById("tws").value = state.tws;
    document.getElementById("twd").value = state.twd;
  });
})();
