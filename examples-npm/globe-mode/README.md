# Globe mode

This example combines a permanent zoom-2 `GlobeSet` with a camera-following
detail layer managed by `GlobeNavigator`. The detail layer automatically
requests higher-resolution OpenStreetMap tiles as the camera approaches the
surface. It does not need an API key.

Use mouse/touch drag to orbit, scroll or pinch to zoom, and double-click a map
location to fly closer. The control panel includes named destinations,
latitude/longitude fly-to, home, zoom controls, and a live center-coordinate
and zoom readout. The red marker demonstrates `GlobeSet.getSurfacePosition()`
at Charlotte, North Carolina.

Run it with:

```sh
npm install
npm run start
```
