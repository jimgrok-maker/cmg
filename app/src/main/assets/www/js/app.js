(function () {
  const STORE = "cmg.v1";
  const TRACK_STORE = "cmg.track.v1";
  const state = {
    lakeId: "erie", windSource: "hrrr", depth: "noaa", boatId: "mac26x", genericLwl: 23,
    magnetic: false, hybrid: false, tws: 10, twd: 270,
    windPack: null, windField: null, departMs: Date.now(), waypoints: [], lakeRing: null, islands: [], route: null, outline: null
  };
  let map, routeLayer, wpLayer, islandLayer, windLayer, poiLayer;
  let lastFix = null, boatMark = null, gpsWatch = null, trackLine = null;
  let gpsTrack = [];
  let fieldBusy = false, refreshTimer = null, movingSince = null, lastSogKn = null;

  function lake() {
    if (typeof CMGLakeById === "function") return CMGLakeById(state.lakeId);
    return { id: state.lakeId || "erie", name: "Lake Erie", center: [41.66, -82.82], zoom: 9, variationW: 7.6, tz: "America/New_York", ring: [] };
  }
  function poisHere() { return (window.CMG_POIS || []).filter(function (p) { return p.lake === state.lakeId; }); }
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
  function loadTrack() {
    try {
      const raw = JSON.parse(localStorage.getItem(TRACK_STORE) || "[]");
      if (Array.isArray(raw)) gpsTrack = raw.filter(function (p) { return p && p.length === 2; }).slice(-4000);
    } catch (e) { gpsTrack = []; }
  }
  function saveTrack() {
    try { localStorage.setItem(TRACK_STORE, JSON.stringify(gpsTrack.slice(-4000))); } catch (e) {}
  }
  function fmtHrs(h) {
    if (!isFinite(h)) return "\u2014";
    const m = Math.round(h * 60);
    return Math.floor(m / 60) + "h " + String(m % 60).padStart(2, "0") + "m";
  }
  function fmtCrs(trueDeg) {
    const d = state.magnetic ? CMGGeo.wrap360(trueDeg + lake().variationW) : trueDeg;
    return String(Math.round(d)).padStart(3, "0") + "\u00b0" + (state.magnetic ? "M" : "T");
  }
  function clockMs() { return state.departMs || Date.now(); }
  function toLocalInput(ms) {
    const d = new Date(ms);
    const pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function setDepart(ms) {
    state.departMs = ms;
    const el = document.getElementById("depart");
    if (el) el.value = toLocalInput(ms);
  }
  function windAgeText() {
    const bits = [];
    if (state.windField && state.windField.length) {
      const t0 = state.windField[0].fetchedAt;
      if (t0) bits.push(state.windField.length + " cells");
      const age = t0 ? (Date.now() - t0) / 3600000 : null;
      if (age != null) bits.push(age < 1.1 ? "fresh" : age.toFixed(1) + "h stale");
    }
    return bits.length ? bits.join(" \u00b7 ") : "";
  }
  function setHud(spd, ttd) {
    const s = document.getElementById("hudSpd");
    const t = document.getElementById("hudTtd");
    if (s) s.textContent = spd;
    if (t) t.textContent = ttd;
  }
  function setSog(txt) {
    const el = document.getElementById("hudSog");
    if (el) el.textContent = txt;
  }
  function ensureTrackLine() {
    if (!map) return;
    if (!trackLine) trackLine = L.polyline(gpsTrack, { color: "#f0d060", weight: 3.5, opacity: 0.95 }).addTo(map);
    else trackLine.setLatLngs(gpsTrack);
  }
  function appendTrack(lat, lon) {
    const pt = [lat, lon];
    if (gpsTrack.length) {
      const last = gpsTrack[gpsTrack.length - 1];
      if (CMGGeo.haversineNm({ lat: last[0], lon: last[1] }, { lat: lat, lon: lon }) < 0.008) return;
    }
    gpsTrack.push(pt);
    if (gpsTrack.length > 4000) gpsTrack = gpsTrack.slice(-4000);
    ensureTrackLine();
    if (gpsTrack.length % 8 === 0) saveTrack();
  }
  function clearTrack() {
    gpsTrack = []; saveTrack();
    if (trackLine) trackLine.setLatLngs([]);
  }
  function startGps() {
    if (!navigator.geolocation) { setSog("n/a"); return; }
    if (gpsWatch != null) return;
    setSog("\u2026");
    gpsWatch = navigator.geolocation.watchPosition(onFix, function () { setSog("off"); }, {
      enableHighAccuracy: true, maximumAge: 1000, timeout: 20000
    });
  }
  function onFix(pos) {
    const lat = pos.coords.latitude, lon = pos.coords.longitude;
    let kn = null;
    if (pos.coords.speed != null && isFinite(pos.coords.speed) && pos.coords.speed >= 0) kn = pos.coords.speed * 1.943844;
    else if (lastFix) {
      const hours = (pos.timestamp - lastFix.t) / 3600000;
      if (hours > 0.00008) kn = CMGGeo.haversineNm({ lat: lastFix.lat, lon: lastFix.lon }, { lat: lat, lon: lon }) / hours;
    }
    lastFix = { lat: lat, lon: lon, t: pos.timestamp };
    lastSogKn = kn;
    if (kn != null && kn >= 0.4 && !movingSince) movingSince = pos.timestamp;
    setSog(kn == null ? "\u2026" : kn.toFixed(1));
    updatePolarDelta();
    appendTrack(lat, lon);
    if (map) {
      if (!boatMark) boatMark = L.circleMarker([lat, lon], { radius: 8, color: "#fff", weight: 2, fillColor: "#3d9a6a", fillOpacity: 1 }).addTo(map).bindTooltip("You");
      else boatMark.setLatLng([lat, lon]);
    }
  }
  function showSetup(on) {
    document.getElementById("setup").classList.toggle("hidden", !on);
    document.getElementById("planner").classList.toggle("hidden", on);
  }
  function showFaq(on) {
    document.getElementById("setupPane").classList.toggle("hidden", on);
    document.getElementById("faqPane").classList.toggle("hidden", !on);
    document.getElementById("tabSetup").classList.toggle("on", !on);
    document.getElementById("tabFaq").classList.toggle("on", on);
  }
  function fillLakes() {
    const sel = document.getElementById("lake");
    if (!sel.options.length && window.CMG_LAKES) {
      window.CMG_LAKES.forEach(function (l) {
        const o = document.createElement("option"); o.value = l.id; o.textContent = l.name; sel.appendChild(o);
      });
    }
    sel.value = state.lakeId || "erie";
    if (!sel.value) sel.selectedIndex = 0;
  }
  function fillPois() {
    const s = document.getElementById("poi");
    s.innerHTML = '<option value="">Add a listed mark\u2026</option>';
    poisHere().forEach(function (p) {
      const o = document.createElement("option"); o.value = p.id; o.textContent = p.name; s.appendChild(o);
    });
  }
  function bindSetup() {
    document.getElementById("lake").value = state.lakeId || "erie";
    document.getElementById("windSource").value = state.windSource;
    document.getElementById("depth").value = state.depth;
    document.getElementById("boat").value = state.boatId;
    document.getElementById("genericLwl").value = state.genericLwl;
    document.getElementById("genericWrap").classList.toggle("hidden", state.boatId !== "generic");
    document.getElementById("mag").checked = state.magnetic;
    document.getElementById("varLabel").textContent = "Var " + lake().variationW.toFixed(1) + "\u00b0W";
    document.getElementById("setupTitle").textContent = lake().name;
    document.getElementById("headerSub").textContent = lake().name;
    const b = boat();
    document.getElementById("boatMeta").textContent = b.name + " \u00b7 LWL " + b.lwl.toFixed(1) + " ft \u00b7 hull " + CMGPolars.hullSpeed(b.lwl).toFixed(2) + " kn \u00b7 " + (b.notes || "");
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
  function resizeMap() { if (map) map.invalidateSize({ animate: false }); }
  function applyLake() {
    const Ldef = lake();
    state.lakeRing = Ldef.ring || null;
    state.islands = islandsHere();
    if (state.outline) map.removeLayer(state.outline);
    if (Ldef.ring && Ldef.ring.length) {
      state.outline = L.polygon(Ldef.ring.map(function (c) { return [c[1], c[0]]; }), { color:"#2e6a78", weight:1, fill:false }).addTo(map);
    }
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
    ensureTrackLine();
  }
  function addWp(pt) {
    state.waypoints.push({ lat: pt.lat, lon: pt.lon, name: pt.name || ("Mark " + (state.waypoints.length + 1)) });
    state.windField = null;
    drawWaypoints(); renderWpList(); compute();
  }
  function drawWaypoints() {
    if (!wpLayer) return;
    wpLayer.clearLayers();
    state.waypoints.forEach(function (w, i) {
      L.circleMarker([w.lat, w.lon], { radius:7, color:"#e7efe8", fillColor:"#3d9a6a", fillOpacity:1, weight:2 }).addTo(wpLayer).bindTooltip((i+1) + " \u00b7 " + w.name);
    });
  }
  function renderWpList() {
    const box = document.getElementById("wps"); box.innerHTML = "";
    state.waypoints.forEach(function (w, i) {
      const d = document.createElement("div"); d.className = "wp";
      d.innerHTML = "<span>" + (i+1) + " \u00b7 " + w.name + "</span>";
      const rm = document.createElement("button"); rm.className = "ghost"; rm.textContent = "remove";
      rm.onclick = function () { state.waypoints.splice(i, 1); state.windField = null; drawWaypoints(); renderWpList(); compute(); };
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
          fmtCrs(s.course) + " \u00b7 " + s.dist.toFixed(2) + " nm \u00b7 TWA " + Math.round(s.twa) + "\u00b0 \u00b7 " +
          (s.mode==="motor" ? "motor 4 kn" : s.bsp.toFixed(1)+" kn") +
          (s.twd != null ? " \u00b7 wind FROM " + String(Math.round(s.twd)).padStart(3,"0") + "\u00b0" : "")
        );
    });
  }
  function windAtHours(hFromNow, pt) {
    const when = clockMs() + hFromNow * 3600000;
    if (state.windField && state.windField.length && pt) {
      const w = CMGWind.atPlace(state.windField, pt.lat, pt.lon, when);
      if (w && w.twd != null) return { tws: w.tws, twd: w.twd, gust: w.gust, clock: w.time };
    }
    if (state.windPack) {
      const w = CMGWind.atTime(state.windPack, when);
      if (w && w.twd != null) return { tws: w.tws, twd: w.twd, gust: w.gust, clock: w.time };
    }
    return { tws: state.tws, twd: state.twd, gust: null, clock: null };
  }
  function sampleRoutePoints(rt) {
    const pts = [];
    if (!rt || !rt.segs.length) return pts;
    const total = rt.totalNm || rt.segs.reduce(function (n, s) { return n + (s.dist || 0); }, 0);
    const n = Math.max(2, Math.min(12, Math.round(total / 8) + 1));
    const step = total / Math.max(1, n - 1);
    let acc = 0, next = step;
    pts.push({ lat: rt.segs[0].from.lat, lon: rt.segs[0].from.lon });
    rt.segs.forEach(function (s) {
      const d = s.dist || 0;
      while (next + 1e-6 < acc + d && pts.length < n) {
        const f = d > 0 ? (next - acc) / d : 1;
        const ff = Math.max(0, Math.min(1, f));
        pts.push({ lat: s.from.lat + (s.to.lat - s.from.lat) * ff, lon: s.from.lon + (s.to.lon - s.from.lon) * ff });
        next += step;
      }
      acc += d;
    });
    const last = rt.segs[rt.segs.length - 1].to;
    const tail = pts[pts.length - 1];
    if (!tail || CMGGeo.haversineNm(tail, last) > 1) pts.push({ lat: last.lat, lon: last.lon });
    return pts.slice(0, 12);
  }
  function setWindLine(cur, extra) {
    const base = String(cur || "").split(" \u00b7 ")[0];
    return extra ? base + " \u00b7 " + extra : base;
  }
  function updatePolarDelta() {
    const el = document.getElementById("polarDelta");
    if (!el) return;
    const rt = state.route;
    const polar = rt && isFinite(rt.tHours) && rt.tHours > 0 ? rt.totalNm / rt.tHours : null;
    if (lastSogKn == null || lastSogKn < 0.3 || polar == null || !movingSince) { el.textContent = ""; return; }
    const mins = (Date.now() - movingSince) / 60000;
    if (mins < 20) { el.textContent = "SOG vs polar after 20 min underway (" + Math.round(20 - mins) + " min left)"; return; }
    const d = lastSogKn - polar;
    el.textContent = "SOG " + lastSogKn.toFixed(1) + " vs polar " + polar.toFixed(1) + " \u00b7 " + (d >= 0 ? "+" : "") + d.toFixed(1) + " kn";
  }
  async function refineWindField(rt) {
    if (fieldBusy || state.windSource === "manual" || !rt) return;
    const pts = sampleRoutePoints(rt);
    if (pts.length < 2) return;
    fieldBusy = true;
    const el = document.getElementById("windLabel");
    if (el) el.textContent = setWindLine(el.textContent, "sampling " + pts.length + " cells\u2026");
    try {
      const field = await CMGWind.fetchMany(pts, state.windSource, lake().tz);
      if (field && field.length) {
        state.windField = field;
        compute(true);
        if (el) el.textContent = setWindLine(el.textContent, field.length + " cells along track");
      }
    } catch (e) {}
    fieldBusy = false;
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
    const when = hours < 0.05 ? (Math.abs(clockMs() - Date.now()) < 120000 ? "now" : "dep") : "+" + Math.round(hours) + "h";
    const gust = (w.gust != null && isFinite(w.gust)) ? " G" + Math.round(w.gust) : "";
    const lab = when + " FROM " + String(Math.round(from)).padStart(3,"0") + "\u00b0" + gust;
    const tip = lab + (w.tws != null ? " \u00b7 " + Number(w.tws).toFixed(0) + " kn" : "") +
      " \u00b7 blowing toward " + String(Math.round(to)).padStart(3,"0") + "\u00b0" +
      (w.clock ? " \u00b7 " + String(w.clock).slice(11,16) : "");
    const html = '<div class="wind-stack">' + windBarbSvg(to) + '<div class="wind-lab">' + lab + "</div></div>";
    L.marker([lat, lon], {
      icon: L.divIcon({ className: "wind-mark", html: html, iconSize: [92, 58], iconAnchor: [46, 18] }),
      interactive: true, keyboard: false, zIndexOffset: 400
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
    marks.forEach(function (m) { placeWindArrow(m.lat, m.lon, m.h, windAtHours(m.h, m)); });
  }
  function compute(skipRefine) {
    const out = document.getElementById("stats");
    if (!map || state.waypoints.length < 2) {
      state.route = null;
      if (routeLayer) routeLayer.clearLayers();
      if (windLayer) windLayer.clearLayers();
      out.innerHTML = "";
      setHud("\u2014", "\u2014");
      return;
    }
    const rt = CMGRoute.buildRoute(state.waypoints, boat(), state.tws, state.twd, state.lakeRing, state.islands, state.hybrid, windAtHours);
    state.route = rt; drawRoute(rt); drawWindArrows(rt);
    const avg = (isFinite(rt.tHours) && rt.tHours > 0) ? (rt.totalNm / rt.tHours) : 0;
    setHud(avg ? avg.toFixed(1) : "\u2014", fmtHrs(rt.tHours));
    out.innerHTML =
      '<div class="stat"><b>' + rt.totalNm.toFixed(1) + '</b><span>nm sailed</span></div>' +
      '<div class="stat"><b>' + fmtHrs(rt.tHours) + '</b><span>P50 ETA</span></div>' +
      '<div class="stat"><b>' + fmtHrs(rt.tHours * 1.22) + '</b><span>P90 ETA</span></div>' +
      '<div class="stat"><b>' + Math.round(rt.pctVmg2) + '%</b><span>VMG \u2265 2 kn</span></div>' +
      '<div class="stat"><b>' + Math.round(rt.pctVmg4) + '%</b><span>VMG \u2265 4 kn</span></div>' +
      '<div class="stat"><b>' + (rt.motorUsed ? "yes" : "no") + '</b><span>motor offered</span></div>';
    const warn = [];
    if (rt.landHit) warn.push("A leg crosses land or an island \u2014 add a waypoint.");
    if (rt.motorUsed) warn.push("VMG < 2 kn on a leg; motor at 4 kn used in hybrid compare.");
    const rw = document.getElementById("routeWarn");
    rw.innerHTML = warn.join(" "); rw.classList.toggle("hidden", warn.length === 0);
    updatePolarDelta();
    const needField = !state.windField || (rt.totalNm > 20 && state.windField.length < 4);
    if (!skipRefine && needField) refineWindField(rt);
  }
  async function refreshWind() {
    const src = state.windSource;
    const el = document.getElementById("windLabel");
    if (src === "manual") {
      el.textContent = "Manual " + state.tws + " kn FROM " + String(Math.round(state.twd)).padStart(3,"0") + "\u00b0";
      compute();
      return;
    }
    el.textContent = "Fetching " + src + "\u2026";
    try {
      const pack = await CMGWind.fetchForecast(map.getCenter().lat, map.getCenter().lng, src, lake().tz);
      state.windPack = pack;
      const now = CMGWind.atTime(pack, Date.now());
      if (now && now.tws != null) {
        state.tws = now.tws; state.twd = now.twd;
        document.getElementById("tws").value = Math.round(state.tws * 10) / 10;
        document.getElementById("twd").value = Math.round(state.twd);
        el.textContent = src.toUpperCase() + " " + now.tws.toFixed(0) + " kn FROM " +
          String(Math.round(now.twd)).padStart(3,"0") + "\u00b0 @ " + (now.time || "").slice(11,16);
      }
    } catch (e) {
      const cached = CMGWind.loadCache();
      const field = CMGWind.loadField();
      if (field && field.field && field.field.length) state.windField = field.field;
      if (cached) {
        state.windPack = cached;
        const now = CMGWind.atTime(cached, clockMs());
        if (now) { state.tws = now.tws; state.twd = now.twd; }
        const age = cached.fetchedAt ? ((Date.now() - cached.fetchedAt) / 3600000).toFixed(1) + "h stale" : "cached";
        el.textContent = "Offline " + state.tws.toFixed(0) + " kn FROM " + Math.round(state.twd) + "\u00b0 \u00b7 " + age;
        const extra = windAgeText();
        if (extra) el.textContent += " \u00b7 " + extra;
      } else el.textContent = "Wind fetch failed \u2014 using manual";
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
    ensureTrackLine();
    map.on("click", function (e) { addWp({ lat:e.latlng.lat, lon:e.latlng.lng, name:"Tap " + (state.waypoints.length + 1) }); });
    window.addEventListener("resize", resizeMap);
  }
  function changeLake(id) {
    if (!id) return;
    state.lakeId = id;
    state.waypoints = []; state.route = null; state.windField = null;
    if (routeLayer) routeLayer.clearLayers();
    if (windLayer) windLayer.clearLayers();
    drawWaypoints(); renderWpList(); setHud("\u2014", "\u2014"); bindSetup();
    if (map) applyLake();
  }
  function restoreField() {
    const saved = CMGWind.loadField && CMGWind.loadField();
    if (saved && saved.field && saved.field.length) state.windField = saved.field;
    const cached = CMGWind.loadCache();
    if (cached) state.windPack = cached;
  }
  function startRefreshTimer() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(function () {
      if (state.windSource !== "manual") refreshWind();
    }, 60 * 60 * 1000);
  }
  function openChart() {
    save();
    showSetup(false);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        initMap(); applyLake(); resizeMap(); startGps(); restoreField(); startRefreshTimer(); refreshWind();
      });
    });
  }
  document.addEventListener("DOMContentLoaded", function () {
    loadPrefs(); loadTrack(); fillLakes(); renderBoatOptions(); bindSetup(); startGps();
    document.getElementById("poi").onchange = function () {
      const p = (window.CMG_POIS || []).find(function (x) { return x.id === document.getElementById("poi").value; });
      if (p) addWp({ lat:p.lat, lon:p.lon, name:p.name });
      document.getElementById("poi").value = "";
    };
    document.getElementById("openChart").onclick = openChart;
    document.getElementById("editSetup").onclick = function () { showSetup(true); };
    document.getElementById("tabSetup").onclick = function () { showFaq(false); };
    document.getElementById("tabFaq").onclick = function () { showFaq(true); };
    document.getElementById("lake").onchange = function (e) { changeLake(e.target.value); };
    document.getElementById("boat").onchange = function (e) {
      state.boatId = e.target.value;
      document.getElementById("genericWrap").classList.toggle("hidden", state.boatId !== "generic");
      bindSetup();
    };
    document.getElementById("genericLwl").onchange = function (e) { state.genericLwl = Number(e.target.value) || 23; bindSetup(); };
    document.getElementById("windSource").onchange = function (e) { state.windSource = e.target.value; state.windField = null; };
    document.getElementById("depth").onchange = function (e) { state.depth = e.target.value; };
    document.getElementById("mag").onchange = function (e) { state.magnetic = e.target.checked; compute(); };
    document.getElementById("tws").oninput = function (e) { state.tws = Number(e.target.value); compute(true); };
    document.getElementById("twd").oninput = function (e) { state.twd = Number(e.target.value); compute(true); };
    document.getElementById("hybrid").onchange = function (e) { state.hybrid = e.target.checked; compute(true); };
    document.getElementById("clearWp").onclick = function () { state.waypoints = []; state.windField = null; drawWaypoints(); renderWpList(); compute(); };
    document.getElementById("clearTrack").onclick = clearTrack;
    document.getElementById("tws").value = state.tws;
    document.getElementById("twd").value = state.twd;
    setDepart(Date.now());
    document.getElementById("depart").onchange = function (e) {
      const ms = Date.parse(e.target.value);
      if (isFinite(ms)) { state.departMs = ms; compute(); }
    };
    document.getElementById("departNow").onclick = function () { setDepart(Date.now()); compute(); };
  });
})();
