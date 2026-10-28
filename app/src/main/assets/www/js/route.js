(function (w) {
  const NOGO = 45;
  const MOTOR_KN = 4;
  const OFFSET_NM = 8;
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
  // Rounding marks around an island: bbox corners and edge midpoints at two
  // clearances (~0.25 nm and ~0.8 nm).
  function candidatesFor(isl) {
    const b = ringBounds(isl.ring);
    const out = [];
    [[0.0042, 0.0056], [0.014, 0.018]].forEach(function (m) {
      const dLat = m[0], dLon = m[1];
      out.push(
        { lat: b.maxLat + dLat, lon: b.cLon }, { lat: b.minLat - dLat, lon: b.cLon },
        { lat: b.cLat, lon: b.maxLon + dLon }, { lat: b.cLat, lon: b.minLon - dLon },
        { lat: b.maxLat + dLat, lon: b.maxLon + dLon }, { lat: b.maxLat + dLat, lon: b.minLon - dLon },
        { lat: b.minLat - dLat, lon: b.maxLon + dLon }, { lat: b.minLat - dLat, lon: b.minLon - dLon });
    });
    return out;
  }
  // Shortest wet path from -> to through island rounding marks (A* over a
  // lazily-checked visibility graph). Only islands near the leg are used.
  // Returns the intermediate points, or [] when the leg is already wet or no
  // wet path was found (the leg is then drawn and flagged as crossing land).
  function detourAround(from, to, lakeRing, islands) {
    if (segmentWet(from, to, lakeRing, islands)) return [];
    if (!CMGGeo.onWater(from, lakeRing, islands) || !CMGGeo.onWater(to, lakeRing, islands)) return [];
    const pad = 0.12;
    const minLat = Math.min(from.lat, to.lat) - pad, maxLat = Math.max(from.lat, to.lat) + pad;
    const minLon = Math.min(from.lon, to.lon) - pad * 1.35, maxLon = Math.max(from.lon, to.lon) + pad * 1.35;
    const nodes = [from, to];
    (islands || []).forEach(function (isl) {
      const b = ringBounds(isl.ring);
      if (b.maxLat < minLat || b.minLat > maxLat || b.maxLon < minLon || b.minLon > maxLon) return;
      if (b.maxLat - b.minLat < 0.003 && b.maxLon - b.minLon < 0.004) return; // islets: bigger islands' marks clear them
      candidatesFor(isl).forEach(function (p) { if (CMGGeo.onWater(p, lakeRing, islands)) nodes.push(p); });
    });
    // Lazy A*: a node's edge from its best parent is only checked for water
    // when the node is popped. A dry edge is remembered and the node is
    // re-parented to its next-best closed neighbour (no check yet), so each
    // pop costs one water check.
    const n = nodes.length;
    const g = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), done = new Array(n).fill(false);
    const hs = nodes.map(function (p) { return CMGGeo.haversineNm(p, to); });
    const dist = function (i, j) { return CMGGeo.haversineNm(nodes[i], nodes[j]); };
    const bad = {};
    const closed = [0];
    g[0] = 0; done[0] = true;
    for (let v = 1; v < n; v++) { g[v] = dist(0, v); prev[v] = 0; }
    function reparent(u) {
      g[u] = Infinity; prev[u] = -1;
      for (let k = 0; k < closed.length; k++) {
        const c = closed[k];
        if (bad[c + ":" + u]) continue;
        const d = g[c] + dist(c, u);
        if (d < g[u]) { g[u] = d; prev[u] = c; }
      }
    }
    for (let checks = 0; checks < 3000; checks++) {
      let u = -1, best = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && g[i] + hs[i] < best) { best = g[i] + hs[i]; u = i; }
      if (u < 0) break;
      if (!segmentWet(nodes[prev[u]], nodes[u], lakeRing, islands)) {
        bad[prev[u] + ":" + u] = true;
        reparent(u);
        continue;
      }
      done[u] = true; closed.push(u);
      if (u === 1) break;
      for (let v = 0; v < n; v++) {
        if (done[v] || bad[u + ":" + v]) continue;
        const cand = g[u] + dist(u, v);
        if (cand < g[v]) { g[v] = cand; prev[v] = u; }
      }
    }
    if (!done[1] || prev[1] < 0) return [];
    const pts = [];
    for (let v = prev[1]; v > 0; v = prev[v]) pts.unshift(nodes[v]);
    return pts;
  }
  // Exact tack point: the intersection of the first-tack line from `from` and
  // the second-tack line into `to`, solved in a local flat frame (fine at
  // lake scale). Returns { s, t } leg lengths in nm, or null if the lines do
  // not meet ahead of both points.
  function tackLegs(from, to, h1, h2) {
    const k = Math.cos(CMGGeo.toRad((from.lat + to.lat) / 2));
    const dx = (to.lon - from.lon) * 60 * k, dy = (to.lat - from.lat) * 60;
    const u1 = [Math.sin(CMGGeo.toRad(h1)), Math.cos(CMGGeo.toRad(h1))];
    const u2 = [Math.sin(CMGGeo.toRad(h2)), Math.cos(CMGGeo.toRad(h2))];
    const det = u1[0] * u2[1] - u1[1] * u2[0];
    if (Math.abs(det) < 1e-9) return null;
    const s = (dx * u2[1] - dy * u2[0]) / det;
    const t = (u1[0] * dy - u1[1] * dx) / det;
    if (s < -1e-9 || t < -1e-9) return null;
    return { s: Math.max(0, s), t: Math.max(0, t) };
  }
  // Zig-zag of n tack pairs (2n legs) that stays on the exact laylines.
  function zigzag(from, to, h1, h2, legs, n) {
    const pts = [];
    let cur = from;
    for (let i = 0; i < n; i++) {
      const p1 = CMGGeo.destPoint(cur, h1, legs.s / n);
      pts.push(p1);
      if (i === n - 1) break;
      cur = CMGGeo.destPoint(p1, h2, legs.t / n);
      pts.push(cur);
    }
    return pts;
  }
  function pathWet(from, pts, to, lakeRing, islands) {
    const all = [from].concat(pts, [to]);
    for (let i = 0; i < all.length - 1; i++) if (!segmentWet(all[i], all[i + 1], lakeRing, islands)) return false;
    return true;
  }
  // Tack points for a leg that lies inside the no-go cone of wind w. Tries
  // the exact single tack on each board first, then more, shorter tacks;
  // if the boards still hit land, splits the leg along the (wet) rhumb line
  // and tacks each half (multi-tack fallback). Returns null if nothing fits.
  function beatToMark(from, to, cls, w, lakeRing, islands, depth) {
    depth = depth || 0;
    const destBrg = CMGGeo.initialBearing(from, to);
    if (Math.abs(twaForCourse(w.twd, destBrg)) >= NOGO) return [];
    const opt = Math.max(NOGO + 1, CMGPolars.bestUpwindTwa(cls, w.tws));
    const stbd = CMGGeo.wrap360(w.twd + opt);
    const port = CMGGeo.wrap360(w.twd - opt);
    const preferStbd = CMGGeo.angleDiff(stbd, destBrg) <= CMGGeo.angleDiff(port, destBrg);
    const orders = preferStbd ? [[stbd, port], [port, stbd]] : [[port, stbd], [stbd, port]];
    for (let n = 1; n <= 4; n++) {
      for (let o = 0; o < orders.length; o++) {
        const legs = tackLegs(from, to, orders[o][0], orders[o][1]);
        if (!legs) continue;
        const pts = zigzag(from, to, orders[o][0], orders[o][1], legs, n);
        if (pathWet(from, pts, to, lakeRing, islands)) return pts;
      }
    }
    const dist = CMGGeo.haversineNm(from, to);
    if (depth >= 4 || dist < 1) return null;
    const mid = CMGGeo.destPoint(from, destBrg, dist / 2);
    if (!CMGGeo.onWater(mid, lakeRing, islands)) return null;
    const left = beatToMark(from, mid, cls, w, lakeRing, islands, depth + 1);
    if (!left) return null;
    const right = beatToMark(mid, to, cls, w, lakeRing, islands, depth + 1);
    if (!right) return null;
    // `mid` is only kept when a tack does not already turn there.
    return left.concat([mid], right);
  }
  // Time to cover a no-go leg by tacking at the best upwind angle: sailed
  // distance = dist * cos(offWind) / cos(opt).
  function tackingHours(cls, tws, twa, dist) {
    const opt = Math.max(NOGO + 1, CMGPolars.bestUpwindTwa(cls, tws));
    const v = CMGPolars.boatSpeed(cls, tws, opt);
    if (!(v > 0.15)) return Infinity;
    return dist * Math.cos(CMGGeo.toRad(Math.abs(twa))) / Math.cos(CMGGeo.toRad(opt)) / v;
  }
  function evaluateSegment(a, b, cls, tws, twd, lakeRing, islands, motorKn, plan) {
    const mkn = (motorKn >= 2 && motorKn <= 8) ? motorKn : MOTOR_KN;
    const fast = plan === "fast";
    const course = CMGGeo.initialBearing(a, b);
    const dist = CMGGeo.haversineNm(a, b);
    const twa = twaForCourse(twd, course);
    let bsp = CMGPolars.boatSpeed(cls, tws, twa);
    let mode = "sail";
    let hours;
    if (Math.abs(twa) < NOGO) {
      bsp = 0; mode = "nogo";
      // A no-go leg is never free: fast plan motors it, sail plan is timed as
      // if tacked at the best upwind angle.
      hours = fast ? dist / mkn : tackingHours(cls, tws, twa, dist);
    } else {
      hours = dist < 1e-9 ? 0 : (bsp > 0.15 ? dist / bsp : Infinity);
    }
    const toward = bsp;
    const motorOffered = toward < 2 || mode === "nogo";
    const land = !segmentWet(a, b, lakeRing, islands);
    return { from:a, to:b, course, dist, twa, bsp, hours, toward, motorOffered, land, mode, motorKn: mkn, color: colorForTwa(twa), twd: twd, tws: tws };
  }
  // Promote a leg to motor when the engine would finish it sooner than the
  // sail speed (fast plan) or whenever a motor is offered (hybrid compare).
  function applyMotor(ev, mkn, fast, hybrid) {
    if ((fast && ev.mode !== "nogo" && ev.bsp < mkn) || (hybrid && ev.motorOffered)) {
      ev.mode = "motor"; ev.bsp = mkn; ev.hours = ev.dist / mkn; ev.color = "#6b8ea8"; ev.toward = mkn; ev.motorKn = mkn;
    }
    return ev;
  }
  function windAt(windAtFn, fallback, hours, pt) {
    const w = (windAtFn && windAtFn(hours, pt)) || fallback;
    return {
      tws: (w.tws != null && isFinite(w.tws)) ? w.tws : fallback.tws,
      twd: (w.twd != null && isFinite(w.twd)) ? w.twd : fallback.twd
    };
  }
  // Walk a leg hour by hour, evaluating each roughly one-hour piece at the
  // forecast wind for the time you are predicted to be there (max 48 pieces).
  function splitByHour(a, b, cls, lakeRing, islands, hybrid, startHours, windAtFn, fallback, motorKn, plan) {
    const mkn = (motorKn >= 2 && motorKn <= 8) ? motorKn : MOTOR_KN;
    const fast = plan === "fast";
    const out = [];
    let cursor = a;
    let acc = isFinite(startHours) ? startHours : 0;
    let guard = 0;
    while (guard++ < 48) {
      const w = windAt(windAtFn, fallback, acc, cursor);
      const ev = applyMotor(evaluateSegment(cursor, b, cls, w.tws, w.twd, lakeRing, islands, mkn, plan), mkn, fast, hybrid);
      if (!isFinite(ev.hours) || ev.dist < 0.12 || ev.hours <= 1.05 || guard === 48) {
        ev.startH = acc;
        out.push(ev);
        acc += isFinite(ev.hours) ? ev.hours : 0;
        if (!isFinite(ev.hours)) acc = Infinity;
        break;
      }
      // One hour's worth of this leg, along the great circle.
      const mid = CMGGeo.destPoint(cursor, ev.course, ev.dist / ev.hours);
      const piece = applyMotor(evaluateSegment(cursor, mid, cls, w.tws, w.twd, lakeRing, islands, mkn, plan), mkn, fast, hybrid);
      piece.startH = acc;
      out.push(piece);
      acc += piece.hours;
      cursor = mid;
    }
    return { segs: out, endHours: acc };
  }
  function buildRoute(waypoints, cls, tws, twd, lakeRing, islands, hybrid, windAtFn, motorKn, plan) {
    const fallback = { tws: tws, twd: twd };
    const path = (waypoints || []).slice();
    if (!path.length) return { points: [], segs: [], tHours: 0, totalNm: 0, sailNm: 0, motorNm: 0, nogoNm: 0, motorUsed: false, landHit: false, nogoHit: false, pctVmg2: 0, pctVmg4: 0 };
    const wet = [path[0]];
    for (let i = 0; i < path.length - 1; i++) {
      const a = wet[wet.length - 1], b = path[i + 1];
      detourAround(a, b, lakeRing, islands).forEach(function (p) {
        wet.push({ lat: p.lat, lon: p.lon, name: p.name || "Detour" });
      });
      wet.push(b);
    }
    // Legs are timed in order so each tack decision uses the forecast wind
    // at the time and place that leg starts.
    const expanded = [wet[0]];
    const segs = [];
    let tHours = 0, sailNm = 0, motorNm = 0, nogoNm = 0, motorUsed = false, landHit = false, nogoHit = false, vmg2 = 0, vmg4 = 0, totalNm = 0;
    let tack = 0;
    function runLeg(a, b) {
      const part = splitByHour(a, b, cls, lakeRing, islands, hybrid, tHours, windAtFn, fallback, motorKn, plan);
      part.segs.forEach(function (ev) {
        if (ev.mode === "motor") { motorUsed = true; motorNm += ev.dist; }
        else if (ev.mode === "nogo") { nogoHit = true; nogoNm += ev.dist; if (plan === "fast") motorNm += ev.dist; }
        else sailNm += ev.dist;
        if (ev.land) landHit = true;
        totalNm += ev.dist;
        if (ev.toward >= 2) vmg2 += ev.dist;
        if (ev.toward >= 4) vmg4 += ev.dist;
        segs.push(ev);
      });
      tHours = isFinite(tHours) ? part.endHours : Infinity;
    }
    for (let i = 0; i < wet.length - 1; i++) {
      const a = expanded[expanded.length - 1], b = wet[i + 1];
      const w = windAt(windAtFn, fallback, isFinite(tHours) ? tHours : 0, a);
      let legPts = [];
      if (Math.abs(twaForCourse(w.twd, CMGGeo.initialBearing(a, b))) < NOGO) {
        legPts = beatToMark(a, b, cls, w, lakeRing, islands, 0) || [];
      }
      let cur = a;
      legPts.forEach(function (p) {
        const tp = { lat: p.lat, lon: p.lon, name: "Tack " + (++tack) };
        runLeg(cur, tp); expanded.push(tp); cur = tp;
      });
      runLeg(cur, b);
      expanded.push(b);
    }
    return { points: expanded, segs, tHours, totalNm, sailNm, motorNm, nogoNm, motorUsed, landHit, nogoHit, pctVmg2: totalNm ? 100*vmg2/totalNm : 0, pctVmg4: totalNm ? 100*vmg4/totalNm : 0 };
  }

  // Default offset-mark distance. Single source of truth: app.js drawOffset()
  // calls offsetMarks() with this value, and the "Offset N nm" checkbox label
  // in index.html must read the same N.
  function offsetMarks(waypoints, twd, nm) {
    if (!waypoints || waypoints.length < 2) return null;
    const a = waypoints[0], b = waypoints[waypoints.length - 1];
    const dist = CMGGeo.haversineNm(a, b);
    if (dist < 1) return null;
    const mid = CMGGeo.destPoint(a, CMGGeo.initialBearing(a, b), dist / 2);
    const rhumb = CMGGeo.initialBearing(a, b);
    const left = CMGGeo.wrap360(rhumb - 90);
    const right = CMGGeo.wrap360(rhumb + 90);
    const wind = CMGGeo.wrap360(twd || 0);
    const dLeft = Math.abs(CMGGeo.angleDiff(left, wind));
    const dRight = Math.abs(CMGGeo.angleDiff(right, wind));
    const windwardBrg = dLeft <= dRight ? left : right;
    const leewardBrg = dLeft <= dRight ? right : left;
    const step = nm || OFFSET_NM;
    return {
      windward: Object.assign({ name: "Windward " + step + " nm" }, CMGGeo.destPoint(mid, windwardBrg, step)),
      leeward: Object.assign({ name: "Leeward " + step + " nm" }, CMGGeo.destPoint(mid, leewardBrg, step)),
      mid: mid
    };
  }
  w.CMGRoute = { twaForCourse, colorForTwa, buildRoute, offsetMarks, tackLegs, tackingHours, detourAround, MOTOR_KN, NOGO, OFFSET_NM };
})(window);
