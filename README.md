# CMG — Course Made Good

Lake Erie sailing planner. **Android APK**, not a website.

Planning aid only. Not a chartplotter. Stay inside the shoreline and check official NOAA / CHS depths.

## Install the APK

1. Open **Actions** on this repo, open the latest **Build APK** run.
2. Download the artifact **cmg-apk** (`cmg-0.1.0-debug.apk`).
3. On the phone allow install from this source, then tap the APK.

Debug-signed. Fine for your boat; not Play Store.

Re-run anytime: Actions → Build APK → Run workflow.

## App

- Full Lake Erie OSM map, western-basin + Pelee + Middle Island
- Wind: HRRR / GFS / ECMWF / manual
- Boats: MacGregor 26X (board down, ballast full), Catalina 22, Catalina 30, Hunter 34, S2 8.0, generic hull speed 1.34√LWL
- Sail-only default; hybrid motors at 4 kn if VMG < 2 kn
- nm / kn

Package: `com.cmg.erie`
