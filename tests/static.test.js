"use strict";
// Repo-level checks: every script parses, version stamps agree, GPX output
// matches the GPX 1.1 structure, Android config keeps the reviewed settings.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { load, WWW } = require("./load");
const ROOT = path.join(__dirname, "..");

test("all app JS parses", () => {
  for (const dir of ["js", "data"]) for (const f of fs.readdirSync(path.join(WWW, dir))) {
    if (!f.endsWith(".js")) continue;
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(WWW, dir, f), "utf8"), { filename: f }), f);
  }
});

test("BUILD stamp and README match versionName and versionCode", () => {
  const gradle = fs.readFileSync(path.join(ROOT, "app", "build.gradle.kts"), "utf8");
  const ver = gradle.match(/versionName = "([^"]+)"/)[1];
  const code = gradle.match(/versionCode = (\d+)/)[1];
  const { ctx } = load();
  assert.equal(ctx.CMGWind.BUILD, ver);
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  assert.ok(readme.includes("`" + ver + "`"), "README versionName");
  assert.ok(readme.includes("`versionCode` " + code), "README versionCode");
  assert.ok(readme.includes(`cmg-${ver}-debug.apk`), "README apk filename");
});

test("Android manifest and MainActivity keep the reviewed and hardened settings", () => {
  const m = fs.readFileSync(path.join(ROOT, "app", "src", "main", "AndroidManifest.xml"), "utf8");
  assert.match(m, /android:allowBackup="false"/);
  for (const c of ["orientation", "screenSize", "screenLayout", "smallestScreenSize", "uiMode"]) assert.match(m, new RegExp("configChanges=\"[^\"]*\\b" + c + "\\b"));
  const act = fs.readFileSync(path.join(ROOT, "app", "src", "main", "java", "com", "cmg", "erie", "MainActivity.java"), "utf8");
  for (const s of [
    "shouldOverrideUrlLoading", "onPause", "onResume", "onDestroy",
    "sanitizeFilename", "ClipData.newRawUri", "FLAG_GRANT_READ_URI_PERMISSION", "runOnUiThread",
    "isAppOrigin", "removeView(webView)", "private Object backCallback", "Api33Back", "OnBackInvokedCallback"
  ]) assert.ok(act.includes(s), s);
  assert.match(act, /"https"\.equalsIgnoreCase\(scheme\)\s*&&\s*APP_HOST\.equalsIgnoreCase/);
  assert.match(act, /"http"\.equalsIgnoreCase\(scheme\)\s*\|\|\s*"https"\.equalsIgnoreCase\(scheme\)/);
});

test("fence.js removed, CSS styles datetime-local, hybrid label updated, CI runs tests", () => {
  assert.equal(fs.existsSync(path.join(WWW, "js", "fence.js")), false, "fence.js removed");
  const html = fs.readFileSync(path.join(WWW, "index.html"), "utf8");
  assert.doesNotMatch(html, /fence\.js/);
  assert.match(html, /boat speed < 2 kn/);
  assert.doesNotMatch(html, /if VMG < 2 kn/);
  const css = fs.readFileSync(path.join(WWW, "css", "app.css"), "utf8");
  assert.match(css, /input\[type="datetime-local"\]/);
  const ci = fs.readFileSync(path.join(ROOT, ".github", "workflows", "android.yml"), "utf8");
  assert.match(ci, /pull_request:/);
  assert.match(ci, /needs:\s*test/);
  assert.match(ci, /node --test 'tests\/\*\.test\.js'/);
});

test("exported GPX has the GPX 1.1 route structure", () => {
  const { ctx, poi, route } = load();
  const rt = route([poi.marblehead, poi["pelee-s"]], 12, 0);
  ctx.document = { addEventListener() {} };
  ctx.CMGGetRoute = () => ({ points: rt.points.map((p) => ({ lat: p.lat, lon: p.lon, name: p.name || "" })), wps: [] });
  const src = fs.readFileSync(path.join(WWW, "js", "gpx-bind.js"), "utf8").replace("window.CMGExportGpx = exportGpx;", "window.CMGExportGpx = exportGpx; window.__buildGpx = buildGpx;");
  vm.runInThisContext(src);
  const xml = ctx.__buildGpx();
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<gpx version="1.1" creator="CMG" xmlns="http:\/\/www.topografix.com\/GPX\/1\/1">/);
  assert.match(xml, /<rte><name>CMG route<\/name>/);
  const pts = xml.match(/<rtept lat="-?\d+\.\d{6}" lon="-?\d+\.\d{6}"><name>[^<]*<\/name><\/rtept>/g);
  assert.equal(pts.length, rt.points.length);
  assert.ok(xml.trim().endsWith("</rte>\n</gpx>".trim()));
});
