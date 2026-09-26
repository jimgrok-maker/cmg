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
    if (a < 55) return "#c47b2b";
    if (a < 80) return "#c9b23a";
    if (a < 140) return "#3d9a6a";
    if (a < 165) return "#c9b23a";
    return "#8a6b3a";
  }
  function estimateTackPoint(from, to, firstCourse, secondCourse, dist) {
    const step = Math.max(0.15, dist / 24);
    let best = null, bestErr = 1e9;
    for (let d = step; d < dist * 1.6; d += step) {
      const p = CMGGeo.destPoint(from, firstCourse, d);
      const err = CMGGeo.angleDiff(CMGGeo.initialBearing(p, to), secondCourse);
      if (err < bestErr) { bestErr = err; best = p; }
      if (err < 3) break;
    }
    if (!best || bestErr > 18) return null;
    return best;
  }
  function beatToMark(from, to, cls, tws, twd) {
    const destBrg = CMGGeo.initialBearing(from, to);
    if (Math.abs(twaForCourse(twd, destBrg)) >= NOGO) return null;
    const opt = CMGPolars.bestUpwindTwa(cls, tws);
    const stbd = CMGGeo.wrap360(twd + opt);
    const port = CMGGeo.wrap360(twd - opt);
    const useStbd = CMGGeo.angleDiff(stbd, destBrg) <= CMGGeo.angleDiff(port, destBrg);
    const first = useStbd ? stbd : port;
    const second = useStbd ? port : stbd;
    const tack = estimateTackPoint(from, to, first, second, CMGGeo.haversineNm(from, to));
    return tack ? [tack] : null;
  }
  function evaluateSegment(a, b, cls, tws, twd, lakeRing, islands) {
    const course = CMGGeo.initialBearing(a, b);
    const dist = CMGGeo.haversineNm(a, b);
    const twa = twaForCourse(twd, course);
    let bsp = CMGPolars.boatSpeed(cls, tws, twa);
    let mode = "sail";
    if (Math.abs(twa) < NOGO) { bsp = 0; mode = "nogo"; }
    const toward = bsp;
    const hours = bsp > 0.15 ? dist / bsp : Infinity;
    const motorOffered = toward < 2 || !isFinite(hours);
    let land = false;
    const samples = CMGGeo.samplesOnSegment(a, b, Math.max(4, Math.ceil(dist * 8)));
    for (const s of samples) { if (!CMGGeo.onWater(s, lakeRing, islands)) { land = true; break; } }
    return { from:a, to:b, course, dist, twa, bsp, hours, toward, motorOffered, land, mode, color: colorForTwa(twa), twd: twd, tws: tws };
  }
  function splitByHour(a, b, cls, lakeRing, islands, hybrid, startHours, windAtFn, fallback) {
    const out = [];
    let cursor = a;
    let acc = startHours;
    let guard = 0;
    while (guard++ < 48) {
      const w = windAtFn ? (windAtFn(acc) || fallback) : fallback;
      const tws = w.tws != null ? w.tws : fallback.tws;
      const twd = w.twd != null ? w.twd : fallback.twd;
      const ev = evaluateSegment(cursor, b, cls, tws, twd, lakeRing, islands);
      if (hybrid && ev.motorOffered) {
        ev.mode = "motor"; ev.bsp = MOTOR_KN; ev.hours = ev.dist / MOTOR_KN; ev.color = "#6b8ea8"; ev.toward = MOTOR_KN;
      }
      if (!isFinite(ev.hours) || ev.hours <= 1.05 || ev.dist < 0.12) {
        ev.startH = acc;
        out.push(ev);
        acc += isFinite(ev.hours) ? ev.hours : 0;
        break;
      }
      const frac = 1 / ev.hours;
      const mid = { lat: cursor.lat + (b.lat - cursor.lat) * frac, lon: cursor.lon + (b.lon - cursor.lon) * frac };
      const piece = evaluateSegment(cursor, mid, cls, tws, twd, lakeRing, islands);
      if (hybrid && piece.motorOffered) {
        piece.mode = "motor"; piece.bsp = MOTOR_KN; piece.hours = piece.dist / MOTOR_KN; piece.color = "#6b8ea8"; piece.toward = MOTOR_KN;
      }
      piece.startH = acc;
      out.push(piece);
      acc += isFinite(piece.hours) ? piece.hours : 1;
      cursor = mid;
    }
    return { segs: out, endHours: acc };
  }
  function buildRoute(waypoints, cls, tws, twd, lakeRing, islands, hybrid, windAtFn) {
    const fallback = { tws: tws, twd: twd };
    const path = waypoints.slice();
    const expanded = [path[0]];
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i+1];
      if (Math.abs(twaForCourse(twd, CMGGeo.initialBearing(a, b))) < NOGO) {
        const extra = beatToMark(a, b, cls, tws, twd);
        if (extra) extra.forEach((p) => expanded.push(p));
      }
      expanded.push(b);
    }
    const segs = [];
    let tHours = 0, sailNm = 0, motorNm = 0, motorUsed = false, landHit = false, vmg2 = 0, vmg4 = 0, totalNm = 0;
    for (let i = 0; i < expanded.length - 1; i++) {
      const part = splitByHour(expanded[i], expanded[i+1], cls, lakeRing, islands, hybrid, tHours, windAtFn, fallback);
      part.segs.forEach((ev) => {
        if (ev.mode === "motor") { motorUsed = true; motorNm += ev.dist; } else sailNm += ev.dist;
        if (ev.land) landHit = true;
        if (isFinite(ev.hours)) tHours += ev.hours;
        totalNm += ev.dist;
        if (ev.toward >= 2) vmg2 += ev.dist;
        if (ev.toward >= 4) vmg4 += ev.dist;
        segs.push(ev);
      });
      tHours = part.endHours;
    }
    return { points: expanded, segs, tHours, totalNm, sailNm, motorNm, motorUsed, landHit, pctVmg2: totalNm ? 100*vmg2/totalNm : 0, pctVmg4: totalNm ? 100*vmg4/totalNm : 0 };
  }
  w.CMGRoute = { twaForCourse, colorForTwa, buildRoute, MOTOR_KN, NOGO };
})(window);
