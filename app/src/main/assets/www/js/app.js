(function () {
  const STORE = "cmg.v1";
  const state = {
    lakeId: "erie", windSource: "hrrr", depth: "noaa", boatId: "mac26x", genericLwl: 23,
    magnetic: false, hybrid: false, tws: 10, twd: 270,
    windPack: null, waypoints: [], lakeRing: null, islands: [], route: null, outline: null
  };
  let map, routeLayer, wpLayer, islandLayer, windLayer, poiLayer;

  function lake() { return CMGLakeById(state.lakeId); }
  function poisHere() { return CMG_POIS.filter(function (p) { return p.lake === state.lakeId; }); }
  function islandsHere() { return state.lakeId === "erie" ? (window.CMG_ISLANDS || []) : []; }
  function boat() {
    return state.boatId === "generic" ? CMGPolars.genericClass(state.genericLwl) : CMGPolars.CLASSES[state.boatId];
  }
  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        lakeId: state.lakeId, boatId: state.boatId, genericLwl: state.genericLwl,
        windSource: state.windSource, magnetic: state.magnetic
      }));
    } catch (e) {}
  }
  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(STORE) || "{}");
      if (p.lakeId) state.lakeId = p.lakeId;
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
    const d = state.magnetic ? CMGGeo.wrap360(trueDeg + lake().variationW) : trueDeg;
    return String(Math.round(d)).padStart(3, "0") + "°" + (state.magnetic ? "M" : "T");
  }
  function showSetup(on) {
    document.getElementById("setup").classList.toggle("hidden", !on);
    document.getElementById("planner").classList.toggle("hidden", on);
  }
  function fillLakes() {
    const sel = document.getElementById("lake");
    sel.innerHTML = "";
    CMG_LAKES.forEach(function (l) {
      const o = document.createElement("option"); o.value = l.id; o.textContent = l.name; sel.appendChild(o);
    });
    sel.value = state.lakeId;
  }
  function fillPois() {
    const s = document.getElementById("poi");
    s.innerHTML = '<option value="">Add a listed mark…</option>';
    poisHere().forEach(function (p) {
      const o = document.createElement("option"); o.value = p.id; o.textContent = p.name; s.appendChild(o);
    });
  }
  function bindSetup() {
    document.getElementById("lake").value = state.lakeId;
    document.getElementById("windSource").value = state.windSource;
    document.getElementById("depth").value = state.depth;
    document.getElementById("boat").value = state.boatId;
    document.getElementById("genericLwl").value = state.genericLwl;
    document.getElementById("genericWrap").classList.toggle("hidden", state.boatId !== "generic");
    document.getElementById("mag").checked = state.magnetic;
    document.getElementById("varLabel").textContent = "Var " + lake().variationW.toFixed(1) + "°W";
    document.getElementById("setupTitle").textContent = lake().name;
    document.getElementById("headerSub").textContent = lake().name;
    const b = boat();
    document.getElementById("boatMeta").textContent = b.name + " · LWL " + b.lwl.toFixed(1) + " ft · hull " + CMGPolars.hullSpeed(b.lwl).toFixed(2) + " kn · " + (b.notes || "");
    fillPois();
  }
  function renderBoatOptions() {
    const sel = document.getElementById("boat");
    sel.innerHTML = "";
    Object.values(CMGPolars.CLASSES).forEach(function (c) {
      const o = document.createElement("option"); o.value = c.id; o.textContent = c.name; sel.appendChild(o);
    });
    const g = document.createElement("option"); g.value = "generic"; g.textContent = "Generic (LWL formula)"; sel.appendChild(g);
    sel.value = state.boatId;
  }
  function resizeMap() {
    if (!map) return;
    map.invalidateSize({ animate: false });
  }
  function applyLake() {
    const Ldef = lake();
    state.lakeRing = Ldef.ring;
    state.islands = islandsHere();
    if (state.outline) map.removeLayer(state.outline);
    state.outline = L.polygon(Ldef.ring.map(function (c) { return [c[1], c[0]]; }), { color:"#2e6a78", weight:1, fill:false }).addTo(map);
    islandLayer.clearLayers();
    state.islands.forEach(function (isl) {
      L.polygon(isl.ring.map(function (c) { return [c[1], c[0]]; }), { color:"#4a6a52", weight:1, fillColor:"#1c2a20", fillOpacity:0.28 }).addTo(islandLayer).bindTooltip(isl.name, { sticky:true });
    });
    if (poiLayer) poiLayer.clearLayers();
    poisHere().forEach(function (p) {
      L.marker([p.lat, p.lon], { icon: L.divIcon({ className:"poi-div", html: p.short || p.name }) })
        .addTo(poiLayer).on("click", function () { addWp({ lat:p.lat, lon:p.lon, name:p.name }); });
    });
    map.setView(Ldef.center, Ldef.zoom);
  }
  function addWp(pt) {
    state.waypoints.push({ lat: pt.lat, lon: pt.lon, name: pt.name || ("Mark " + (state.waypoints.length + 1)) });
    drawWaypoints(); renderWpList(); compute();
  }
  function drawWaypoints() {
    if (!wpLayer) return;
    wpLayer.clearLayers();
    state.waypoints.forEach(function (w, i) {
      L.circleMarker([w.lat, w.lon], { radius:7, color:"#e7efe8", fillColor:"#3d9a6a", fillOpacity:1, weight:2 }).addTo(wpLayer).bindTooltip((i+1) + " · " + w.name);
    });
  }
  function renderWpList() {
    const box = document.getElementById("wps"); box.innerHTML = "";
    state.waypoints.forEach(function (w, i) {
      const d = document.createElement("div"); d.className = "wp";
      d.innerHTML = "<span>" + (i+1) + " · " + w.name + "</span>";
      const rm = document.createElement("button"); rm.className = "ghost"; rm.textContent = "remove";
      rm.onclick = function () { state.waypoints.splice(i, 1); drawWaypoints(); renderWpList(); compute(); };
      d.appendChild(rm); box.appendChild(d);
    });
  }
  function drawRoute(rt) {
    if (!routeLayer) return;
    routeLayer.clearLayers();
    if (!rt) return;
    rt.segs.forEach(function (s) {
      L.polyline([[s.from.lat, s.from.lon], [s.to.lat, s.to.lon]], { color:s.color, weight:s.land?2:5, dashArray:s.land?"6 6":null, opacity:0.95 })
        .addTo(routeLayer).bindTooltip(
          fmtCrs(s.course) + " · " + s.dist.toFixed(2) + " nm · TWA " + Math.round(s.twa) + "° · " +
          (s.mode==="motor" ? "motor 4 kn" : s.bsp.toFixed(1)+" kn") +
          (s.twd != null ? " · wind FROM " + String(Math.round(s.twd)).padStart(3,"0") + "°" : "")
        );
    });
  }
  function windAtHours(hFromNow) {
    if (state.windPack) {
      const w = CMGWind.atTime(state.windPack, Date.now() + hFromNow * 3600000);
      if (w && w.twd != null) return { tws: w.tws, twd: w.twd, clock: w.time };
    }
    return { tws: state.tws, twd: state.twd, clock: null };
  }
  function windBarbSvg(rotDeg) {
    return '<div class="wind-vec"><svg viewBox="0 0 32 32" style="transform:rotate(' + rotDeg + 'deg)">' +
      '<circle cx="16" cy="16" r="14" fill="#111814" fill-opacity="0.35"/>' +
      '<polygon points="16,3 24,16 16,12 8,16" fill="#1a1f18" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>' +
      '<rect x="14.2" y="12" width="3.6" height="14" rx="1" fill="#1a1f18" stroke="#fff" stroke-width="1.6"/>' +
      '<line x1="16" y1="26" x2="24" y2="30" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>' +
      '<line x1="16" y1="26" x2="23" y2="26.8" stroke="#f0d060" stroke-width="2" stroke-linecap="round"/>' +
      '</svg></div>';
  }
  function placeWindArrow(lat, lon, hours, w) {
    const from = CMGGeo.wrap360(w.twd);
    const to = CMGGeo.wrap360(from + 180);
    const when = hours < 0.05 ? "now" : "+" + Math.round(hours) + "h";
    const tip = when + " · wind FROM " + String(Math.round(from)).padStart(3,"0") + "°T · " +
      (w.tws != null ? Number(w.tws).toFixed(0) + " kn" : "") +
      " · blowing toward " + String(Math.round(to)).padStart(3,"0") + "°" +
      (w.clock ? " · " + String(w.clock).slice(11,16) : "");
    L.marker([lat, lon], {
      icon: L.divIcon({ className: "wind-mark", html: windBarbSvg(to), iconSize: [36, 36], iconAnchor: [18, 18] }),
      interactive: true, keyboard: false, zIndexOffset: 400
    }).addTo(windLayer).bindTooltip(tip);
    const off = CMGGeo.destPoint({ lat: lat, lon: lon }, to, 0.55);
    L.marker([off.lat, off.lon], {
      icon: L.divIcon({
        className: "wind-mark",
        html: '<div class="wind-lab">' + when + " FROM " + String(Math.round(from)).padStart(3,"0") + "°</div>",
        iconSize: [86, 18], iconAnchor: [43, 9]
      }),
      interactive: true, keyboard: false, zIndexOffset: 401
    }).addTo(windLayer).bindTooltip(tip);
  }
  function drawWindArrows(rt) {
    if (!windLayer) return;
    windLayer.clearLayers();
    if (!rt || !rt.segs.length) return;
    const total = isFinite(rt.tHours) ? rt.tHours : 0;
    const step = total > 10 ? 2 : 1;
    const marks = [];
    function addMark(h, lat, lon) {
      const hh = Math.round(h * 10) / 10;
      if (marks.some(function (m) { return Math.abs(m.h - hh) < 0.2; })) return;
      marks.push({ h: hh, lat: lat, lon: lon });
    }
    addMark(0, rt.segs[0].from.lat, rt.segs[0].from.lon);
    let acc = 0;
    rt.segs.forEach(function (s) {
      const h = isFinite(s.hours) ? s.hours : 0;
      const start = (s.startH != null) ? s.startH : acc;
      const end = start + h;
      for (let t = step; t < end + 1e-6; t += step) {
        if (t + 1e-6 < start) continue;
        const frac = h > 0 ? (t - start) / h : 1;
        const f = Math.max(0, Math.min(1, frac));
        addMark(t, s.from.lat + (s.to.lat - s.from.lat) * f, s.from.lon + (s.to.lon - s.from.lon) * f);
      }
      acc = end;
    });
    marks.sort(function (a, b) { return a.h - b.h; });
    marks.forEach(function (m) { placeWindArrow(m.lat, m.lon, m.h, windAtHours(m.h)); });
  }
  function compute() {
    const out = document.getElementById("stats");
    if (!map || state.waypoints.length < 2) {
      state.route = null;
      if (routeLayer) routeLayer.clearLayers();
      if (windLayer) windLayer.clearLayers();
      out.innerHTML = "";
      return;
    }
    const rt = CMGRoute.buildRoute(
      state.waypoints, boat(), state.tws, state.twd,
      state.lakeRing, state.islands, state.hybrid, windAtHours
    );
    state.route = rt; drawRoute(rt); drawWindArrows(rt);
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
    if (src === "manual") {
      el.textContent = "Manual " + state.tws + " kn FROM " + String(Math.round(state.twd)).padStart(3,"0") + "°";
      compute();
      return;
    }
    el.textContent = "Fetching " + src + "…";
    try {
      const pack = await CMGWind.fetchForecast(map.getCenter().lat, map.getCenter().lng, src, lake().tz);
      state.windPack = pack;
      const now = CMGWind.atTime(pack, Date.now());
      if (now && now.tws != null) {
        state.tws = now.tws; state.twd = now.twd;
        document.getElementById("tws").value = Math.round(state.tws * 10) / 10;
        document.getElementById("twd").value = Math.round(state.twd);
        el.textContent = src.toUpperCase() + " " + now.tws.toFixed(0) + " kn FROM " +
          String(Math.round(now.twd)).padStart(3,"0") + "° @ " + (now.time || "").slice(11,16);
      }
    } catch (e) {
      const cached = CMGWind.loadCache();
      if (cached) {
        state.windPack = cached;
        const now = CMGWind.atTime(cached, Date.now());
        if (now) { state.tws = now.tws; state.twd = now.twd; }
        el.textContent = "Cached wind " + state.tws.toFixed(0) + " kn FROM " + Math.round(state.twd) + "°";
      } else el.textContent = "Wind fetch failed — using manual";
    }
    compute();
  }
  function initMap() {
    if (map) return;
    const Ldef = lake();
    map = L.map("map", { zoomControl: true, fadeAnimation: false }).setView(Ldef.center, Ldef.zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 16, attribution: "&copy; OpenStreetMap", updateWhenIdle: false, keepBuffer: 2
    }).addTo(map);
    islandLayer = L.layerGroup().addTo(map);
    poiLayer = L.layerGroup().addTo(map);
    routeLayer = L.layerGroup().addTo(map);
    wpLayer = L.layerGroup().addTo(map);
    windLayer = L.layerGroup().addTo(map);
    map.on("click", function (e) { addWp({ lat:e.latlng.lat, lon:e.latlng.lng, name:"Tap " + (state.waypoints.length + 1) }); });
    window.addEventListener("resize", resizeMap);
  }
  function changeLake(id) {
    state.lakeId = id;
    state.waypoints = [];
    state.route = null;
    if (routeLayer) routeLayer.clearLayers();
    if (windLayer) windLayer.clearLayers();
    drawWaypoints(); renderWpList();
    bindSetup();
    if (map) applyLake();
  }
  function openChart() {
    save();
    showSetup(false);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        initMap();
        applyLake();
        resizeMap();
        refreshWind();
      });
    });
  }
  document.addEventListener("DOMContentLoaded", function () {
    loadPrefs(); fillLakes(); renderBoatOptions(); bindSetup();
    document.getElementById("poi").onchange = function () {
      const p = CMG_POIS.find(function (x) { return x.id === document.getElementById("poi").value; });
      if (p) addWp({ lat:p.lat, lon:p.lon, name:p.name });
      document.getElementById("poi").value = "";
    };
    document.getElementById("openChart").onclick = openChart;
    document.getElementById("editSetup").onclick = function () { showSetup(true); };
    document.getElementById("lake").onchange = function (e) { changeLake(e.target.value); };
    document.getElementById("boat").onchange = function (e) {
      state.boatId = e.target.value;
      document.getElementById("genericWrap").classList.toggle("hidden", state.boatId !== "generic");
      bindSetup();
    };
    document.getElementById("genericLwl").onchange = function (e) { state.genericLwl = Number(e.target.value) || 23; bindSetup(); };
    document.getElementById("windSource").onchange = function (e) { state.windSource = e.target.value; };
    document.getElementById("depth").onchange = function (e) { state.depth = e.target.value; };
    document.getElementById("mag").onchange = function (e) { state.magnetic = e.target.checked; compute(); };
    document.getElementById("tws").oninput = function (e) { state.tws = Number(e.target.value); compute(); };
    document.getElementById("twd").oninput = function (e) { state.twd = Number(e.target.value); compute(); };
    document.getElementById("hybrid").onchange = function (e) { state.hybrid = e.target.checked; compute(); };
    document.getElementById("clearWp").onclick = function () { state.waypoints = []; drawWaypoints(); renderWpList(); compute(); };
    document.getElementById("tws").value = state.tws;
    document.getElementById("twd").value = state.twd;
  });
})();
