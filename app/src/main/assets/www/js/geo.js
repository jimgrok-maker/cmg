(function (w) {
  const R_NM = 3440.065;
  function toRad(d) { return d * Math.PI / 180; }
  function toDeg(r) { return r * 180 / Math.PI; }
  function haversineNm(a, b) {
    const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
    const dLat = lat2 - lat1;
    const dLon = toRad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function initialBearing(a, b) {
    const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
    const dLon = toRad(b.lon - a.lon);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }
  function destPoint(from, bearingDeg, distNm) {
    const lat1 = toRad(from.lat);
    const lon1 = toRad(from.lon);
    const br = toRad(bearingDeg);
    const ang = distNm / R_NM;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(ang) + Math.cos(lat1) * Math.sin(ang) * Math.cos(br));
    const lon2 = lon1 + Math.atan2(
      Math.sin(br) * Math.sin(ang) * Math.cos(lat1),
      Math.cos(ang) - Math.sin(lat1) * Math.sin(lat2)
    );
    return { lat: toDeg(lat2), lon: ((toDeg(lon2) + 540) % 360) - 180 };
  }
  function angleDiff(a, b) {
    let d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }
  function wrap360(d) { return (d % 360 + 360) % 360; }
  // Rings can have thousands of vertices (the Erie shoreline does), so each
  // ring gets a cached bounding box plus latitude-band edge index the first
  // time it is tested. Results are identical to the plain even-odd test.
  const BANDS = 128;
  const ringIndex = typeof WeakMap === "function" ? new WeakMap() : null;
  function indexFor(ring) {
    let ix = ringIndex && ringIndex.get(ring);
    if (ix) return ix;
    let minLon = 1e9, maxLon = -1e9, minLat = 1e9, maxLat = -1e9;
    for (let i = 0; i < ring.length; i++) {
      const x = ring[i][0], y = ring[i][1];
      if (x < minLon) minLon = x; if (x > maxLon) maxLon = x;
      if (y < minLat) minLat = y; if (y > maxLat) maxLat = y;
    }
    const h = (maxLat - minLat) / BANDS || 1e-9;
    const bands = [];
    for (let b = 0; b < BANDS; b++) bands.push([]);
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const y0 = Math.min(ring[i][1], ring[j][1]), y1 = Math.max(ring[i][1], ring[j][1]);
      const b0 = Math.max(0, Math.floor((y0 - minLat) / h)), b1 = Math.min(BANDS - 1, Math.floor((y1 - minLat) / h));
      for (let b = b0; b <= b1; b++) bands[b].push(i);
    }
    ix = { minLon, maxLon, minLat, maxLat, h, bands };
    if (ringIndex) ringIndex.set(ring, ix);
    return ix;
  }
  function pointInRing(lon, lat, ring) {
    if (!ring || ring.length < 3 || !isFinite(lon) || !isFinite(lat)) return false;
    const ix = indexFor(ring);
    if (lon < ix.minLon || lon > ix.maxLon || lat < ix.minLat || lat > ix.maxLat) return false;
    const band = ix.bands[Math.min(BANDS - 1, Math.floor((lat - ix.minLat) / ix.h))];
    let inside = false;
    const n = ring.length;
    for (let k = 0; k < band.length; k++) {
      const i = band[k], j = i === 0 ? n - 1 : i - 1;
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const hit = ((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
      if (hit) inside = !inside;
    }
    return inside;
  }
  // Only the listed mark itself counts as a dock (a wider radius let tack and
  // detour points that happened to be near a harbor sit on land).
  const DOCK_NM = 0.02;
  // Listed marks now sit in the water just off their harbors, so only a short
  // allowance remains for a mark that is right against a seawall.
  const DOCK_EXIT_NM = 0.2;
  let docks = [];
  function setDocks(list) {
    docks = (list || []).map(function (d) { return { lat: d.lat, lon: d.lon, name: d.name }; });
  }
  function isDock(pt) {
    if (!pt) return false;
    for (let i = 0; i < docks.length; i++) {
      if (haversineNm(pt, docks[i]) <= DOCK_NM) return true;
    }
    return false;
  }
  function islandAt(pt, islands) {
    if (!pt || !islands) return null;
    for (let i = 0; i < islands.length; i++) {
      if (pointInRing(pt.lon, pt.lat, islands[i].ring)) return islands[i];
    }
    return null;
  }
  function inLake(pt, lakeRing) {
    if (!lakeRing || !lakeRing.length) return true;
    return pointInRing(pt.lon, pt.lat, lakeRing);
  }
  function onWater(pt, lakeRing, islands) {
    if (!inLake(pt, lakeRing)) return false;
    // (A point near a listed mark is no longer treated as water automatically:
    // marks sit in the water now, and that shortcut let tack/detour points
    // land on islands.)
    if (islandAt(pt, islands)) return false;
    return true;
  }
  function samplesOnSegment(a, b, n) {
    const dist = haversineNm(a, b);
    const brg = initialBearing(a, b);
    const out = [];
    for (let i = 1; i < n; i++) out.push(destPoint(a, brg, dist * (i / n)));
    return out;
  }
  // Listed docks sit inside padded keep-off hulls. Allow a short exit or
  // arrival through that hull. A line that stays in the hull longer than
  // DOCK_EXIT_NM is still a crossing.
  function segmentWet(a, b, lakeRing, islands) {
    if (!a || !b || !inLake(a, lakeRing) || !inLake(b, lakeRing)) return false;
    const startDock = isDock(a);
    const endDock = isDock(b);
    const startIsl = startDock ? islandAt(a, islands) : null;
    const endIsl = endDock ? islandAt(b, islands) : null;
    if (!startDock && !onWater(a, lakeRing, islands)) return false;
    if (!endDock && !onWater(b, lakeRing, islands)) return false;
    const dist = haversineNm(a, b);
    const samples = samplesOnSegment(a, b, Math.max(8, Math.ceil(dist * 30)));
    let leftStart = !startIsl;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (!inLake(s, lakeRing)) return false;
      const isl = islandAt(s, islands);
      if (!isl) { leftStart = true; continue; }
      const along = haversineNm(a, s);
      const toEnd = haversineNm(s, b);
      if (startIsl && isl.id === startIsl.id && !leftStart && along <= DOCK_EXIT_NM) continue;
      if (endIsl && isl.id === endIsl.id && toEnd <= DOCK_EXIT_NM) continue;
      return false;
    }
    return true;
  }
  w.CMGGeo = { toRad, toDeg, haversineNm, initialBearing, destPoint, angleDiff, wrap360, pointInRing, onWater, samplesOnSegment, setDocks, isDock, islandAt, segmentWet, DOCK_NM, DOCK_EXIT_NM };
})(window);
