"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");
const { ctx, erie, poi } = load();
const G = ctx.CMGGeo;
const ISL = ctx.CMG_ISLANDS;
const water = (lat, lon) => G.onWater({ lat, lon }, erie.ring, ISL);

test("Erie shoreline: known land is land", () => {
  const land = {
    "Catawba Island": [41.570, -82.850], "Lakeside/Marblehead": [41.540, -82.750], "Cedar Point": [41.482, -82.683],
    "Sandusky downtown": [41.455, -82.711], "Port Clinton downtown": [41.508, -82.938], "Johnson Island": [41.499, -82.731],
    "Point Pelee": [41.920, -82.510], "Cleveland downtown": [41.499, -81.694], "Kelleys Island": [41.610, -82.700],
    "South Bass Island": [41.648, -82.835], "Pelee Island": [41.780, -82.660], "Middle Bass Island": [41.690, -82.806]
  };
  for (const [name, [la, lo]] of Object.entries(land)) assert.equal(water(la, lo), false, name);
});

test("Erie shoreline: known water is water", () => {
  const wet = {
    "Cleveland harbor entrance": [41.508, -81.716], "off Huron": [41.410, -82.548], "Lorain": [41.475, -82.180],
    "Sandusky Bay": [41.465, -82.800], "mid-lake off Cleveland": [41.70, -81.75], "North Passage": [41.72, -82.75],
    "South Passage": [41.63, -82.78]
  };
  for (const [name, [la, lo]] of Object.entries(wet)) assert.equal(water(la, lo), true, name);
});

test("every Erie mark is in open water, not inside an island", () => {
  for (const p of ctx.CMG_POIS.filter((x) => x.lake === "erie")) {
    assert.equal(G.pointInRing(p.lon, p.lat, erie.ring), true, p.id + " in lake");
    assert.equal(G.islandAt(p, ISL), null, p.id + " not on an island");
  }
});

test("island marks sit near their real harbors (OSM/Nominatim positions)", () => {
  const near = {
    "pib-harbor": [41.6519, -82.8187, 0.4], "kelleys-hbr": [41.5970, -82.7102, 0.5], "pelee-scudder": [41.8127, -82.6586, 0.3],
    "pelee-s": [41.7372, -82.6747, 0.4], "mbi-sp": [41.6768, -82.8098, 0.5], "east-harbor": [41.5558, -82.8023, 0.2],
    "marblehead": [41.5418, -82.7281, 0.3]
  };
  for (const [id, [la, lo, maxNm]] of Object.entries(near)) {
    const d = G.haversineNm(poi[id], { lat: la, lon: lo });
    assert.ok(d <= maxNm, `${id} is ${d.toFixed(2)} nm from its harbor`);
  }
});

test("other lakes keep their outlines and marks", () => {
  for (const lake of ctx.CMG_LAKES) {
    assert.ok(Array.isArray(lake.ring) && lake.ring.length >= 4, lake.id);
    assert.ok(G.pointInRing(lake.center[1], lake.center[0], lake.ring), lake.id + " center inside its ring");
  }
});
