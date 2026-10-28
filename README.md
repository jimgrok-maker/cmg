# CMG — Course Made Good

Android sailing **trip planner** with a live SOG and gold GPS track. Not a website. Not a chartplotter.

Tap marks on an OSM map, get a polar-based course-made-good estimate from forecast wind, and see whether each leg stays on the water. Legs that cross land are flagged. Always check official NOAA / CHS depths before you go.

**Current build:** `0.3.22` (`versionCode` 43) · package `com.cmg.erie` · debug-signed.

## Install

1. Repo → **Actions** → latest green **Build APK** run.
2. Download the artifact **cmg-apk**. The file inside is `cmg-0.3.22-debug.apk`.
3. On the phone, allow install from this source and tap the APK.

Push to `main` or **Actions → Build APK → Run workflow** to rebuild.

## What it does now

### Waters

Setup picker: Great Lakes (Erie, Ontario, Huron, Michigan, Superior), Chesapeake Bay, and the big Ohio inland lakes (Mosquito Creek, Buckeye, Alum Creek, Grand Lake St. Marys, Indian, Guilford).

Each water has a hairline outline used only as a wet/dry test for planned legs. Lake Erie uses an OpenStreetMap shoreline (about 90 m simplification) and 177 OSM islands, and routes around them; marks are placed in the water just off their harbors. Every other water uses a rough hand-drawn outline with no islands. Shoreline and island data © OpenStreetMap contributors (ODbL).

### Wind

Open-Meteo HRRR (default), GFS, ECMWF, or manual. TWD is meteorological FROM. Gold barbs point downwind. One barb per hour. Gxx is gust knots. Up to 12 cells along the track, timed to when you are predicted to be there. Leave-at shifts every hour. The last forecast and route wind points are cached for offline use, with their age shown (STALE after about 4 hours). Refresh every 60 minutes; the route's wind points are rebuilt when they are an hour old. Beyond a model's range (HRRR is about 2 days) legs fall back to the TWS / TWD boxes with a warning. With a live source those boxes are only a fallback; use Manual to plan your own wind.

### Plan

Setup has two plans and a motor-speed dropdown (2–8 kn, default 4):

- **Maximize sailing time.** Never motors. A leg under 45° off the wind gets planned tacks (about 47° off the wind, exact tack points, more tacks or a split leg if land is in the way). If no tacks fit, the leg is dashed and timed as if tacked.
- **Maximize fastest time.** A dashed no-go is still dashed, but those miles are in the P50 at the motor speed. A sail leg slower than the motor speed is drawn blue and timed at that speed.
- **Hybrid compare** (checkbox) motors legs under 2 kn of boat speed and legs inside the no-go angle.

Under 2 kn of wind the modelled boat does not move: the sail plan shows no ETA (one calm hour makes the whole ETA —); Fastest and Hybrid motor it.

No-go is 45°, not 40, so a few degrees of wind shift does not flip a west leg from dashed to solid. Pinched is 45–55°, tight 55–80°, reach 80–140°, deep 140–165°, run over 165°.

P50 is the planned time from the boat formula and forecast wind, plus any motor time. P90 is simply P50 × 1.22. Boat speeds come from a formula (waterline length, wind speed and angle, per-boat factor), not measured polars. Units are nm and knots. Courses true unless Magnetic is checked.

### On the water

HUD: live SOG, planned average, time to dest. Gold line is the GPS track. SOG vs polar after about 20 minutes underway. Export GPX shares the planned route (marks, island detours and tack points) through the Android share sheet. Marks are saved across restarts; the GPS track is not recorded in the background; map tiles need a connection.

## What it does not do

- Official depths, buoys, or ENC
- Currents, leeway, waves, seiche, or a lake breeze smaller than about 8 nm
- A racing router (tacks are planned per leg; mainland obstacles are flagged, not routed around)
- Offset 8 nm is on the planner: rhumb vs one windward mark vs one leeward mark. Not a new router.
- Daylight / sunset gate — parked
