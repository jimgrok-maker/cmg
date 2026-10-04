# CMG — Course Made Good

Android sailing **trip planner** with a live SOG and gold GPS track. Not a website. Not a chartplotter.

Tap marks on an OSM map, get a polar-based course-made-good estimate from forecast wind, and see whether that rhumb stays inside a coarse shoreline. Always check official NOAA / CHS depths before you go.

**Current build:** `0.3.4` (`versionCode` 25) · package `com.cmg.erie` · debug-signed.

## Install

1. Repo → **Actions** → latest green **Build APK** run.
2. Download the artifact **cmg-apk**. The file inside is `cmg-0.3.4-debug.apk`.
3. On the phone, allow install from this source and tap the APK.

Push to `main` or **Actions → Build APK → Run workflow** to rebuild.

## What it does now

### Waters

Setup picker:

- Great Lakes: Erie, Ontario, Huron, Michigan, Superior
- Chesapeake Bay
- Ohio inland: Mosquito Creek, Buckeye, Alum Creek, Grand Lake St. Marys, Indian, Guilford

Each water has a **hairline fence** (no fill) used only as a wet/dry test for *planned* rhumbs. OSM under the map is the real shore. GPS track ignores the fence.

Western Lake Erie also has dashed keep-off hulls for Pelee, Middle Island, South / Middle / North Bass, Kelleys, Green, Rattlesnake. Those hulls are padded so a straight line does not cut an island. They are not the island shoreline.

Listed ramps / harbors exist per water (Erie islands in more detail).

### Wind

- Sources: Open-Meteo **HRRR** (default), GFS, ECMWF, or manual TWD / TWS
- TWD is meteorological **FROM**. Gold barbs point **downwind**. `Gxx` on a barb is gust knots at that hour.
- Two-pass field on a route: guess with map-center wind, then sample up to **12 HRRR cells** along the track (~every 8 nm) and time each cell to when you are predicted to be there.
- **Leave-at** clock (default now). Shift departure and every barb / polar hour moves with it. First barb says `dep` if leave-at is not “now.”
- Center forecast and the 12-cell field are cached on the phone. Offline uses the last pack and labels it stale. Refresh every **60 minutes** when a fetch works.

### Boats and routing

Working-sail synthetic polars scaled to hull speed `1.34 × √LWL`:

- MacGregor 26X (board down, full ballast)
- Catalina 22, Catalina 30, Hunter 34, S2 8.0
- Generic LWL formula

Default is **sail only**. Hybrid compare motors at 4 kn when VMG &lt; 2 kn. Goal band is 4 kn+ when the angle allows.

No-go inside ~40° TWA (red). Tight yellow, reach green, motor blue. A sail-only no-go blanks P50 / P90 (`—`) instead of showing `0h 00m`.

P50 is polar time in the forecast we have. P90 is that time × 1.22 (lulls / slop / a forecast that was 20° off — not a second model).

Units: nautical miles and knots. Courses true unless Magnetic is checked (local variation west).

### On the water

- HUD: live **SOG kn** (GPS), planned **avg kn**, **to dest**
- Gold polyline is the GPS wake, not the plan
- After ~20 min underway, **SOG vs polar** (`+/− kn`)
- Tap anywhere or pick a listed mark; two marks minimum for a plan
- **Export GPX** shares the planned route to Files / OpenCPN

## What it does not do

- Official depths, buoys, or ENC
- Currents, seiche, or lake breeze smaller than ~8 nm
- Racing router with many tacks (one upwind tack attempt only)
- Offset-rhumb compare (Pelee north vs south) — parked
- Daylight / sunset gate — parked

A wet rhumb that clips the fence draws dashed red and asks for another waypoint.

## Layout

Android WebView wrapping `app/src/main/assets/www`:

```
www/
  index.html          Setup + planner shell + FAQ
  css/app.css
  data/lakes.js       Waters, centers, coarse rings
  data/islands.js     Erie keep-off hulls
  js/pois.js          Listed marks
  js/geo.js           Distance, bearings, point-in-ring
  js/polars.js        Classes + hull speed
  js/wind.js          Open-Meteo + field cache
  js/route.js         Polar CMG + island detour + no-go
  js/fence.js         Hairline lake / island overlay
  js/gpx-bind.js      GPX share
  js/app.js           Map, HUD, GPS, leave-at
```

## FAQ in the app

Setup → **FAQ** covers TWD FROM vs the barb, two-pass wind, leave-at, cache, P50/P90, motor policy, fence vs chart, GPX, and island limits.
