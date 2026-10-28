"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load");
const { ctx } = load();
const P = ctx.CMGPolars;
const cat22 = P.CLASSES.cat22;

test("no boat speed below 2 kn of wind, and no NaN speed", () => {
  for (const tws of [0, 1, 2, NaN, -3]) assert.equal(P.boatSpeed(cat22, tws, 90), 0, "tws " + tws);
  assert.equal(P.boatSpeed(cat22, 10, NaN), 0);
});

test("wind scale is continuous from 2 kn up (no jump at 3 kn)", () => {
  let prev = P.boatSpeed(cat22, 2, 90);
  for (let tws = 2.05; tws <= 30; tws += 0.05) {
    const v = P.boatSpeed(cat22, tws, 90);
    assert.ok(Math.abs(v - prev) < 0.15, `jump at ${tws.toFixed(2)} kn: ${prev} -> ${v}`);
    prev = v;
  }
  assert.ok(P.boatSpeed(cat22, 4, 90) > P.boatSpeed(cat22, 3, 90));
});

test("speed is capped near hull speed and best upwind angle is outside the no-go cone", () => {
  for (const tws of [6, 12, 20, 30]) for (const twa of [50, 90, 150]) assert.ok(P.boatSpeed(cat22, tws, twa) <= P.hullSpeed(cat22.lwl) * 1.05 + 1e-9);
  for (const id of Object.keys(P.CLASSES)) assert.ok(P.bestUpwindTwa(P.CLASSES[id], 12) >= ctx.CMGRoute.NOGO);
});
