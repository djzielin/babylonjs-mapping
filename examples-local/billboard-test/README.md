# Tokyo–Fuji building and terrain LOD example

This scene uses live data at two aligned resolutions:

- An 8 × 6 zoom-11 landscape spans about 127 × 95 km along the Tokyo–Fuji
  corridor. Mapbox supplies 2× satellite imagery and Terrain-DEM elevation,
  exaggerated 2.5× so Mount Fuji remains legible at this scale.
- A merged zoom-11 Overture tier covers every landscape tile, with the Tokyo
  parent tile replaced by a merged zoom-13 tier. The innermost zoom-13 tile is
  replaced by four zoom-14 tiles. The innermost zoom-14 tile is replaced once
  more by four zoom-15 tiles: three stay merged and the tile around the camera
  uses accurate individual footprints and height attributes. Parent tiles
  covered by finer data are not requested.
- The innermost buildings use detailed geometry within 20 Babylon world units,
  billboards from 20 to 60, and are omitted beyond 60. The merged zoom-15,
  zoom-14, zoom-13, and zoom-11 meshes are culled at 100, 160, 250, and 500
  respectively, where the buildings would be subpixel.
- Overture Maps supplies the credential-free corridor and is the default
  detailed provider; ONEGEO/OSM Buildings remains available for the innermost
  tile as an optional alternative.
- Terrain starts at 64 subdivisions per tile and transitions through 48, 32,
  16, 8, 4, and 2 subdivisions before the final cull distance. The 32-step
  tier is retained through Mount Fuji so its cone stays recognizable. Stitched
  borders and skirts cover mixed-LOD tile transitions.

The initial camera sits over central Tokyo and looks southwest toward the real
terrain position of Mount Fuji.

## Credentials

Create this ignored file in `public/`:

- `mapbox-key.txt` containing a [Mapbox access token](https://account.mapbox.com/)

No building credential is required. The example resolves the newest public
[Overture building PMTiles release](https://docs.overturemaps.org/examples/overture-tiles/)
at startup. To use ONEGEO instead, also create `public/osmb-key.txt` containing
a [ONEGEO Maps key](https://onegeo.co/); its presence selects ONEGEO in place of
Overture.

Choose a provider explicitly with the URL:

- `http://localhost:8080/?buildings=overture`
- `http://localhost:8080/?buildings=onegeo`

Without a query parameter, the demo selects ONEGEO when `osmb-key.txt` exists
and otherwise uses Overture.

To work with this sample, you should have Node (and in particular, npm and npx) installed, which you can retrieve from [nodejs.org](http://nodejs.org).

## Running

You set up the initial project by pulling the dependencies from npm with
```
npm install
```

After that, you can compile and run a server with:
```
npm run start
```

For those familiar with Typescript, you do not have to run ```tsc``` to build the .js files from the .ts files;  ```npx``` builds them on the fly as part of running webpack.

Webpack opens the sample automatically. Otherwise visit
`http://localhost:8080/`.

## License

Material for the Web-Based VR Tutorial by [Evan Suma Rosenberg](https://illusioneering.umn.edu/) and [Blair MacIntyre](https://blairmacintyre.me/) is licensed under a [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License](http://creativecommons.org/licenses/by-nc-sa/4.0/).

The intent of choosing CC BY-NC-SA 4.0 is to allow individuals and instructors at non-profit entities to use this content.  This includes not-for-profit schools (K-12 and post-secondary). For-profit entities (or people creating courses for those sites) may not use this content without permission (this includes, but is not limited to, for-profit schools and universities and commercial education sites such as Coursera, Udacity, LinkedIn Learning, and other similar sites).
