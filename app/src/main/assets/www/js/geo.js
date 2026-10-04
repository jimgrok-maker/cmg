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
  function pointInRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const hit = ((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi);
      if (hit) inside = !inside;
    }
    return inside;
  }
  const DOCK_NM = 0.35;
  const DOCK_EXIT_NM = 2.4;
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
    if (isDock(pt)) return true;
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
    const samples = samplesOnSegment(a, b, Math.max(8, Math.ceil(dist * 14)));
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
