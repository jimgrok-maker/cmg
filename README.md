# CMG — Course Made Good

Android sailing **trip planner** with a live SOG and gold GPS track. Not a website. Not a chartplotter.

Tap marks on an OSM map, get a polar-based course-made-good estimate from forecast wind, and see whether that rhumb stays inside a coarse shoreline. Always check official NOAA / CHS depths before you go.

**Current build:** `0.3.18` (`versionCode` 39) · package `com.cmg.erie` · debug-signed.

## Install

1. Repo → **Actions** → latest green **Build APK** run.
2. Download the artifact **cmg-apk**. The file inside is `cmg-0.3.18-debug.apk`.
3. On the phone, allow install from this source and tap the APK.

Push to `main` or **Actions → Build APK → Run workflow** to rebuild.

## What it does now

### Waters

Setup picker: Great Lakes (Erie, Ontario, Huron, Michigan, Superior), Chesapeake Bay, and the big Ohio inland lakes (Mosquito Creek, Buckeye, Alum Creek, Grand Lake St. Marys, Indian, Guilford).

Each water has a hairline fence used only as a wet/dry test for planned rhumbs. OSM under the map is the real shore. Western Lake Erie also has keep-off hulls for Pelee, Middle Island, the Bass islands, Kelleys, Green, and Rattlesnake.

### Wind

Open-Meteo HRRR (default), GFS, ECMWF, or manual. TWD is meteorological FROM. Gold barbs point downwind. One barb per hour. Gxx is gust knots. Up to 12 cells along the track, timed to when you are predicted to be there. Leave-at shifts every hour. Last pack is cached for offline. Refresh every 60 minutes.

### Plan

Setup has two plans and a motor-speed dropdown (2–8 kn, default 4):

- **Maximize sailing time.** Sail every leg you can. A no-go (under 45° off the wind) is dashed and left out of the clock and the average. Tack, or switch plans.
- **Maximize fastest time.** A dashed no-go is still dashed, but those miles are in the P50 at the motor speed. A sail leg slower than the motor speed is drawn blue and timed at that speed.

No-go is 45°, not 40, so a few degrees of wind shift does not flip a west leg from dashed to solid. Pinched is 45–55°, tight 55–80°, reach 80–140°, deep 140–165°, run over 165°.

P50 is polar time plus motor time on the fast plan. P90 is that time × 1.22. Units are nm and knots. Courses true unless Magnetic is checked.

### On the water

HUD: live SOG, planned average, time to dest. Gold line is the GPS track. SOG vs polar after about 20 minutes underway. Export GPX shares the planned route.

## What it does not do

- Official depths, buoys, or ENC
- Currents, seiche, or a lake breeze smaller than about 8 nm
- A racing router with many tacks
- Offset 8 nm is on the planner: rhumb vs one windward mark vs one leeward mark. Not a new router.
- Daylight / sunset gate — parked
