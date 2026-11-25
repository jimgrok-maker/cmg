"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");
const { ctx, poi, route, dryNm } = load();
const G = ctx.CMGGeo, R = ctx.CMGRoute;
const CLE = { lat: 41.53, lon: -81.72, name: "Cleveland offshore" };

function assertWet(rt, label) {
  assert.equal(rt.landHit, false, label + ": landHit");
  for (const s of rt.segs) assert.ok(dryNm(s) < 0.05, `${label}: ${dryNm(s).toFixed(3)} nm dry on a leg`);
}

test("routes no longer cross islands (dock exemption was 2.4 nm)", () => {
  const cases = [
    ["kelleys-hbr", "pelee-scudder", 180], ["port-clinton", "pib-harbor", 225], ["east-harbor", "kelleys-n", 270],
    ["miller", "schoolhouse", 270], ["west-harbor", "nbi", 340], ["schoolhouse", "mbi-sp", 270]
  ];
  for (const [a, b, twd] of cases) assertWet(route([poi[a], poi[b]], 10, twd), `${a}->${b}`);
});

test("exact tack point: second board is on the layline", () => {
  const from = { lat: 41.5, lon: -82.0 }, to = { lat: 41.8, lon: -82.0 };
  const legs = R.tackLegs(from, to, 313, 47);
  const p = G.destPoint(from, 313, legs.s);
  assert.ok(Math.abs(G.initialBearing(p, to) - 47) < 0.5, "bearing tack->mark");
  assert.ok(Math.abs(legs.s - legs.t) < 0.05, "dead upwind: equal boards");
});

test("Cleveland -> PIB into a west wind: no zero-time no-go legs, realistic ETA", () => {
  const rt = route([CLE, poi["pib-harbor"]], 12, 270);
  assert.equal(rt.nogoNm, 0);
  for (const s of rt.segs) {
    assert.ok(Math.abs(s.twa) >= R.NOGO, "every leg sailable");
    assert.ok(s.hours > 0 || s.dist < 1e-6, "no leg is free");
  }
  // Was 7.96 h for 65.7 nm with a 31 nm no-go leg counted as 0 h.
  assert.ok(rt.tHours > 13 && rt.tHours < 20, "P50 " + rt.tHours);
  assertWet(rt, "CLE->PIB W");
});

test("a no-go leg is never 0 h (sail plan times it as tacking)", () => {
  const cls = ctx.CMGPolars.CLASSES.cat22;
  const h = R.tackingHours(cls, 12, 0, 10);
  const opt = Math.max(R.NOGO + 1, ctx.CMGPolars.bestUpwindTwa(cls, 12));
  const v = ctx.CMGPolars.boatSpeed(cls, 12, opt);
  assert.ok(Math.abs(h - 10 / Math.cos(opt * Math.PI / 180) / v) < 1e-9);
  // Open water, no islands, dead upwind leg with no room to tack is still timed.
  const ring = [[-83, 41], [-82, 41], [-82, 41.0005], [-83, 41.0005], [-83, 41]];
  const rt = route([{ lat: 41.0002, lon: -82.9 }, { lat: 41.0002, lon: -82.5 }], 12, 90, { ring, islands: [] });
  assert.ok(rt.nogoNm > 0 && isFinite(rt.tHours) && rt.tHours > 0);
});

test("tack and offset decisions use the forecast wind, not the stale fields", () => {
  // Fields say N, forecast says W: no tack needed and nothing no-go.
  const a = route([poi.sandusky, poi["kelleys-hbr"]], 12, 0, { windAt: () => ({ tws: 12, twd: 270 }) });
  assert.equal(a.nogoNm, 0);
  assert.equal(a.points.length, 2);
  // Fields say W, forecast says N: tacks are planned for the N wind.
  const b = route([poi.sandusky, poi["kelleys-hbr"]], 12, 270, { windAt: () => ({ tws: 12, twd: 0 }) });
  assert.equal(b.nogoNm, 0);
  assert.ok(b.points.length > 2 && isFinite(b.tHours));
});

test("long legs are split hour by hour with the forecast for each hour", () => {
  const calls = [];
  const windAt = (h) => { calls.push(h); return h < 1 ? { tws: 10, twd: 0 } : { tws: 10, twd: 90 }; };
  const rt = route([CLE, poi["pib-harbor"]], 10, 0, { windAt });
  assert.ok(rt.segs.length >= 10, "segments " + rt.segs.length);
  assert.ok(calls.length >= 10, "wind lookups " + calls.length);
  for (const s of rt.segs) if (s.startH >= 1) assert.equal(s.twd, 90);
  // Pieces follow the great circle: each piece ends on the leg's bearing line.
  for (let i = 1; i < rt.segs.length; i++) assert.equal(rt.segs[i].from, rt.segs[i - 1].to);
});

test("calm and bad input: no fake sailing ETA", () => {
  for (const tws of [0, 1, 2, NaN]) {
    const rt = route([poi.sandusky, poi["kelleys-hbr"]], tws, 270);
    assert.equal(isFinite(rt.tHours), false, "tws " + tws);
  }
  const hybrid = route([poi.sandusky, poi["kelleys-hbr"]], 0, 270, { hybrid: true });
  assert.ok(isFinite(hybrid.tHours) && hybrid.motorUsed, "hybrid motors the calm");
  // twd 0 and 360 are the same wind
  assert.equal(route([poi.sandusky, poi["kelleys-hbr"]], 12, 0).tHours, route([poi.sandusky, poi["kelleys-hbr"]], 12, 360).tHours);
});

test("edge cases: empty, single, duplicate waypoints", () => {
  assert.equal(route([], 10, 270).segs.length, 0);
  assert.equal(route([poi.sandusky], 10, 270).segs.length, 0);
  const d = route([poi.sandusky, poi.sandusky, poi["kelleys-hbr"]], 10, 270);
  assert.ok(isFinite(d.tHours) && d.tHours > 0);
});

test("all Erie mark pairs: legs stay wet unless flagged, and routing is fast enough", () => {
  const ids = ctx.CMG_POIS.filter((p) => p.lake === "erie").map((p) => p.id);
  let worstMs = 0, unflaggedDry = 0;
  for (const a of ids) for (const b of ids) {
    if (a === b) continue;
    for (const twd of [0, 180]) {
      const t = Date.now();
      const rt = route([poi[a], poi[b]], 12, twd);
      worstMs = Math.max(worstMs, Date.now() - t);
      if (!rt.landHit) for (const s of rt.segs) if (dryNm(s) >= 0.05) unflaggedDry++;
    }
  }
  assert.equal(unflaggedDry, 0);
  assert.ok(worstMs < 2000, "worst route " + worstMs + " ms");
});

test("other lakes still route (no islands)", () => {
  const ont = ctx.CMGLakeById("ontario");
  const p = ctx.CMG_POIS.filter((x) => x.lake === "ontario");
  const rt = route([{ lat: 43.55, lon: -79.2 }, { lat: 43.45, lon: -77.6 }], 12, 0, { ring: ont.ring, islands: [] });
  assert.ok(isFinite(rt.tHours) && rt.tHours > 0 && !rt.landHit);
  assert.ok(p.length > 0);
});

test("fast plan skips zig-zag tacks when direct motoring is faster and sets motorUsed", () => {
  const a = { lat: 41.60, lon: -82.30 }, b = { lat: 41.75, lon: -82.30 }; // due north, open Lake Erie
  // Dead upwind (twd 0), 10 kn wind, 6 kn motor: motoring is much faster than tacking -> straight no-go motor leg
  const fast = route([a, b], 10, 0, { plan: "fast", motor: 6 });
  assert.equal(fast.points.length, 2, "no unnecessary zig-zag tacks");
  assert.equal(fast.motorUsed, true, "fast-mode no-go leg sets motorUsed");
  assert.ok(fast.motorNm > 8 && Math.abs(fast.tHours - fast.totalNm / 6) < 0.05);
  // Dead upwind, 18 kn wind, 2 kn motor: tacking VMG > 2 kn -> still generates tacks
  const slowMotor = route([a, b], 18, 0, { plan: "fast", motor: 2 });
  assert.ok(slowMotor.points.length > 2, "tacks when sailing is faster than 2 kn motor");
});

test("hybrid skips zig-zag tacks when tack speed < 2 kn, and calm skips tacks", () => {
  const a = { lat: 41.60, lon: -82.30 }, b = { lat: 41.75, lon: -82.30 };
  // Very light upwind (2.8 kn): tack speed < 2 kn -> hybrid motors straight without zig-zagging
  const hyb = route([a, b], 2.8, 0, { hybrid: true, motor: 4 });
  assert.equal(hyb.points.length, 2, "hybrid skips zig-zag when tack speed < 2 kn");
  assert.equal(hyb.motorUsed, true);
  assert.ok(isFinite(hyb.tHours) && hyb.tHours > 0);
  // Calm upwind (1 kn): sail plan does not emit zig-zag tacks
  const calm = route([a, b], 1, 0);
  assert.equal(calm.points.length, 2, "calm wind skips zig-zag tacks");
  assert.equal(isFinite(calm.tHours), false);
});

test("zero-distance duplicate legs take 0 h even in calm or no-go wind", () => {
  const a = { lat: 41.60, lon: -82.30 }, b = { lat: 41.60, lon: -82.10 }; // east leg
  // Duplicate start point with twd=0 (bearing(a,a)=0 -> no-go) and tws=12:
  const nogoDup = route([a, a, b], 12, 0);
  assert.ok(isFinite(nogoDup.tHours) && nogoDup.tHours > 0);
  assert.equal(nogoDup.segs[0].hours, 0);
  // Duplicate start point in dead calm (tws=0), only duplicate points:
  const calmDup = route([a, a], 0, 0);
  assert.equal(calmDup.tHours, 0);
  assert.equal(calmDup.motorUsed, false);
  // Duplicate start point in fast mode does not falsely flag motorUsed on 0 nm:
  const fastDup = route([a, a], 12, 0, { plan: "fast" });
  assert.equal(fastDup.tHours, 0);
  assert.equal(fastDup.motorUsed, false);
});

test("CMGGeo.ringBounds returns cached bounding box", () => {
  const ring = ctx.CMGLakeById("erie").ring;
  const b1 = G.ringBounds(ring);
  const b2 = G.ringBounds(ring);
  assert.strictEqual(b1, b2, "cached in WeakMap");
  assert.ok(b1.minLon < b1.cLon && b1.cLon < b1.maxLon);
  assert.ok(b1.minLat < b1.cLat && b1.cLat < b1.maxLat);
});
