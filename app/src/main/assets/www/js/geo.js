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
  function onWater(pt, lakeRing, islands) {
    if (lakeRing && !pointInRing(pt.lon, pt.lat, lakeRing)) return false;
    if (islands) {
      for (const isl of islands) {
        if (pointInRing(pt.lon, pt.lat, isl.ring)) return false;
      }
    }
    return true;
  }
  function samplesOnSegment(a, b, n) {
    const out = [];
    for (let i = 1; i < n; i++) {
      const t = i / n;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t });
    }
    return out;
  }
  w.CMGGeo = { toRad, toDeg, haversineNm, initialBearing, destPoint, angleDiff, wrap360, pointInRing, onWater, samplesOnSegment };
})(window);
