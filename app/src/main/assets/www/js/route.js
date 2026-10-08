(function (w) {
  const NOGO = 40;
  const MOTOR_KN = 4;
  function twaForCourse(twd, course) {
    let twa = CMGGeo.wrap360(course - twd);
    if (twa > 180) twa -= 360;
    return twa;
  }
  function colorForTwa(twa) {
    const a = Math.abs(twa);
    if (a < NOGO) return "#b54a3c";
    if (a < 55) return "#e07a2f";
    if (a < 80) return "#c9b23a";
    if (a < 140) return "#3d9a6a";
    if (a < 165) return "#5b7c99";
    return "#6b4423";
  }
  function segmentWet(a, b, lakeRing, islands) {
    return CMGGeo.segmentWet(a, b, lakeRing, islands);
  }
  function ringBounds(ring) {
    let minLon = 1e9, maxLon = -1e9, minLat = 1e9, maxLat = -1e9;
    ring.forEach(function (p) {
      minLon = Math.min(minLon, p[0]); maxLon = Math.max(maxLon, p[0]);
      minLat = Math.min(minLat, p[1]); maxLat = Math.max(maxLat, p[1]);
    });
    return { minLon: minLon, maxLon: maxLon, minLat: minLat, maxLat: maxLat,
      cLon: (minLon + maxLon) / 2, cLat: (minLat + maxLat) / 2 };
  }
  function islandHits(a, b, islands) {
    const hits = [];
    (islands || []).forEach(function (isl) {
      const dist = CMGGeo.haversineNm(a, b);
      const samples = CMGGeo.samplesOnSegment(a, b, Math.max(8, Math.ceil(dist * 14)));
      const crossed = samples.some(function (s) { return CMGGeo.pointInRing(s.lon, s.lat, isl.ring); });
      if (crossed) hits.push(isl);
    });
    return hits;
  }
  function candidatesFor(isl) {
    const b = ringBounds(isl.ring);
    const dLat = 0.014;
    const dLon = 0.018;
    return [
      { lat: b.maxLat + dLat, lon: b.cLon },
      { lat: b.minLat - dLat, lon: b.cLon },
      { lat: b.cLat, lon: b.maxLon + dLon },
      { lat: b.cLat, lon: b.minLon - dLon },
      { lat: b.maxLat + dLat, lon: b.maxLon + dLon },
      { lat: b.maxLat + dLat, lon: b.minLon - dLon },
      { lat: b.minLat - dLat, lon: b.maxLon + dLon },
      { lat: b.minLat - dLat, lon: b.minLon - dLon }
    ];
  }
  function detourAround(from, to, lakeRing, islands) {
    if (segmentWet(from, to, lakeRing, islands)) return [];
    const hits = islandHits(from, to, islands);
    const list = hits.length ? hits : (islands || []);
    let bestPts = null, bestLen = 1e9;
    list.forEach(function (isl) {
      const cands = candidatesFor(isl).filter(function (p) {
        return CMGGeo.onWater(p, lakeRing, islands);
      });
      cands.forEach(function (p) {
        if (!segmentWet(from, p, lakeRing, islands) || !segmentWet(p, to, lakeRing, islands)) return;
        const len = CMGGeo.haversineNm(from, p) + CMGGeo.haversineNm(p, to);
        if (len < bestLen) { bestLen = len; bestPts = [p]; }
      });
      for (let i = 0; i < cands.length; i++) {
        for (let j = 0; j < cands.length; j++) {
          if (i === j) continue;
          const p1 = cands[i], p2 = cands[j];
          if (!segmentWet(from, p1, lakeRing, islands)) continue;
          if (!segmentWet(p1, p2, lakeRing, islands)) continue;
          if (!segmentWet(p2, to, lakeRing, islands)) continue;
          const len = CMGGeo.haversineNm(from, p1) + CMGGeo.haversineNm(p1, p2) + CMGGeo.haversineNm(p2, to);
          if (len < bestLen) { bestLen = len; bestPts = [p1, p2]; }
        }
      }
    });
    return bestPts || [];
  }
  function estimateTackPoint(from, to, firstCourse, secondCourse, dist, lakeRing, islands) {
    const step = Math.max(0.12, dist / 36);
    let best = null, bestErr = 1e9;
    for (let d = step; d < dist * 1.8; d += step) {
      const p = CMGGeo.destPoint(from, firstCourse, d);
      if (!CMGGeo.onWater(p, lakeRing, islands)) continue;
      if (!segmentWet(from, p, lakeRing, islands)) continue;
      if (!segmentWet(p, to, lakeRing, islands)) continue;
      const err = CMGGeo.angleDiff(CMGGeo.initialBearing(p, to), secondCourse);
      if (err < bestErr) { bestErr = err; best = p; }
      if (err < 3) break;
    }
    if (!best || bestErr > 22) return null;
    return best;
  }
  function beatToMark(from, to, cls, tws, twd, lakeRing, islands) {
    const destBrg = CMGGeo.initialBearing(from, to);
    if (Math.abs(twaForCourse(twd, destBrg)) >= NOGO) return null;
    const opt = CMGPolars.bestUpwindTwa(cls, tws);
    const stbd = CMGGeo.wrap360(twd + opt);
    const port = CMGGeo.wrap360(twd - opt);
    const dist = CMGGeo.haversineNm(from, to);
    const stbdFirst = estimateTackPoint(from, to, stbd, port, dist, lakeRing, islands);
    const portFirst = estimateTackPoint(from, to, port, stbd, dist, lakeRing, islands);
    if (!stbdFirst && !portFirst) return null;
    if (stbdFirst && !portFirst) return [stbdFirst];
    if (portFirst && !stbdFirst) return [portFirst];
    const preferStbd = CMGGeo.angleDiff(stbd, destBrg) <= CMGGeo.angleDiff(port, destBrg);
    return [preferStbd ? stbdFirst : portFirst];
  }
  function evaluateSegment(a, b, cls, tws, twd, lakeRing, islands, motorKn) {
    const mkn = (motorKn >= 2 && motorKn <= 8) ? motorKn : MOTOR_KN;
    const course = CMGGeo.initialBearing(a, b);
    const dist = CMGGeo.haversineNm(a, b);
    const twa = twaForCourse(twd, course);
    let bsp = CMGPolars.boatSpeed(cls, tws, twa);
    let mode = "sail";
    if (Math.abs(twa) < NOGO) { bsp = 0; mode = "nogo"; }
    const toward = bsp;
    const hours = bsp > 0.15 ? dist / bsp : (mode === "nogo" ? dist / mkn : Infinity);
    const motorOffered = toward < 2 || mode === "nogo";
    const land = !segmentWet(a, b, lakeRing, islands);
    return { from:a, to:b, course, dist, twa, bsp, hours, toward, motorOffered, land, mode, color: colorForTwa(twa), twd: twd, tws: tws };
  }
  function splitByHour(a, b, cls, lakeRing, islands, hybrid, startHours, windAtFn, fallback, motorKn) {
    const mkn = (motorKn >= 2 && motorKn <= 8) ? motorKn : MOTOR_KN;
    const out = [];
    let cursor = a;
    let acc = isFinite(startHours) ? startHours : 0;
    let guard = 0;
    while (guard++ < 48) {
      const w = windAtFn ? (windAtFn(acc, cursor) || fallback) : fallback;
      const tws = w.tws != null ? w.tws : fallback.tws;
      const twd = w.twd != null ? w.twd : fallback.twd;
      const ev = evaluateSegment(cursor, b, cls, tws, twd, lakeRing, islands, mkn);
      if (hybrid && ev.motorOffered) {
        ev.mode = "motor"; ev.bsp = mkn; ev.hours = ev.dist / mkn; ev.color = "#6b8ea8"; ev.toward = mkn;
      }
      if (!isFinite(ev.hours) || ev.hours <= 1.05 || ev.dist < 0.12 || ev.mode === "nogo") {
        ev.startH = acc;
        out.push(ev);
        acc += (isFinite(ev.hours) && ev.hours > 0) ? ev.hours : 0;
        break;
      }
      const frac = 1 / ev.hours;
      const mid = { lat: cursor.lat + (b.lat - cursor.lat) * frac, lon: cursor.lon + (b.lon - cursor.lon) * frac };
      const piece = evaluateSegment(cursor, mid, cls, tws, twd, lakeRing, islands, mkn);
      if (hybrid && piece.motorOffered) {
        piece.mode = "motor"; piece.bsp = mkn; piece.hours = piece.dist / mkn; piece.color = "#6b8ea8"; piece.toward = mkn;
      }
      piece.startH = acc;
      out.push(piece);
      acc += (isFinite(piece.hours) && piece.hours > 0) ? piece.hours : 0;
      cursor = mid;
    }
    return { segs: out, endHours: acc };
  }
  function buildRoute(waypoints, cls, tws, twd, lakeRing, islands, hybrid, windAtFn, motorKn) {
    const fallback = { tws: tws, twd: twd };
    const path = waypoints.slice();
    const wet = [path[0]];
    for (let i = 0; i < path.length - 1; i++) {
      const a = wet[wet.length - 1], b = path[i + 1];
      detourAround(a, b, lakeRing, islands).forEach(function (p) {
        wet.push({ lat: p.lat, lon: p.lon, name: p.name || "Detour" });
      });
      wet.push(b);
    }
    const expanded = [wet[0]];
    for (let i = 0; i < wet.length - 1; i++) {
      const a = expanded[expanded.length - 1], b = wet[i + 1];
      if (Math.abs(twaForCourse(twd, CMGGeo.initialBearing(a, b))) < NOGO) {
        const extra = beatToMark(a, b, cls, tws, twd, lakeRing, islands);
        if (extra) extra.forEach(function (p) { expanded.push(p); });
      }
      expanded.push(b);
    }
    const segs = [];
    let tHours = 0, sailNm = 0, motorNm = 0, nogoNm = 0, motorUsed = false, landHit = false, nogoHit = false, vmg2 = 0, vmg4 = 0, totalNm = 0;
    for (let i = 0; i < expanded.length - 1; i++) {
      const part = splitByHour(expanded[i], expanded[i+1], cls, lakeRing, islands, hybrid, tHours, windAtFn, fallback, motorKn);
      part.segs.forEach(function (ev) {
        if (ev.mode === "motor") { motorUsed = true; motorNm += ev.dist; }
        else if (ev.mode === "nogo") { nogoHit = true; nogoNm += ev.dist; motorNm += ev.dist; }
        else sailNm += ev.dist;
        if (ev.land) landHit = true;
        if (isFinite(ev.hours) && ev.hours > 0) tHours += ev.hours;
        totalNm += ev.dist;
        if (ev.toward >= 2) vmg2 += ev.dist;
        if (ev.toward >= 4) vmg4 += ev.dist;
        segs.push(ev);
      });
      if (isFinite(part.endHours)) tHours = Math.max(tHours, part.endHours);
    }
    if (tHours <= 0 && nogoHit && nogoNm >= totalNm * 0.5) tHours = Infinity;
    return { points: expanded, segs, tHours, totalNm, sailNm, motorNm, nogoNm, motorUsed, landHit, nogoHit, pctVmg2: totalNm ? 100*vmg2/totalNm : 0, pctVmg4: totalNm ? 100*vmg4/totalNm : 0 };
  }
  w.CMGRoute = { twaForCourse, colorForTwa, buildRoute, MOTOR_KN, NOGO };
})(window);
