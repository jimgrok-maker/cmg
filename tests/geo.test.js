"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");
const { ctx } = load();
const G = ctx.CMGGeo;

test("haversine and bearing match known values", () => {
  // One degree of latitude is 60 nm on this sphere (R = 3440.065 nm).
  assert.ok(Math.abs(G.haversineNm({ lat: 41, lon: -82 }, { lat: 42, lon: -82 }) - 60.04) < 0.05);
  assert.ok(Math.abs(G.initialBearing({ lat: 41, lon: -82 }, { lat: 42, lon: -82 }) - 0) < 1e-9);
  assert.ok(Math.abs(G.initialBearing({ lat: 41.6, lon: -82.8 }, { lat: 41.6, lon: -82.7 }) - 90) < 0.1);
  const p = G.destPoint({ lat: 41.6, lon: -82.8 }, 45, 10);
  assert.ok(Math.abs(G.haversineNm({ lat: 41.6, lon: -82.8 }, p) - 10) < 1e-6);
  assert.ok(Math.abs(G.initialBearing({ lat: 41.6, lon: -82.8 }, p) - 45) < 0.1);
});

test("angle helpers wrap 0/360", () => {
  assert.equal(G.wrap360(-10), 350);
  assert.equal(G.wrap360(370), 10);
  assert.equal(G.angleDiff(350, 10), 20);
  assert.equal(G.angleDiff(0, 360), 0);
});

test("indexed pointInRing agrees with the plain even-odd test", () => {
  function plain(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-12) + xi)) inside = !inside;
    }
    return inside;
  }
  const ring = ctx.CMGLakeById("erie").ring;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 3000; k++) {
    const lon = -83.6 + rnd() * 4.9, lat = 41.3 + rnd() * 1.7;
    assert.equal(G.pointInRing(lon, lat, ring), plain(lon, lat, ring), `${lat},${lon}`);
  }
});
