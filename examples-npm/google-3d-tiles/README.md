# Google Photorealistic 3D Tiles

This demo loads Google Maps Platform Photorealistic 3D Tiles directly into a
Babylon.js scene without Cesium. The API key is read at runtime from
`public/google-key.txt`, which is ignored by Git. The Pages workflow creates
the corresponding deployed file from the `GOOGLE_MAPS_API_KEY` repository
secret.

The key must have the Map Tiles API enabled in a billing-enabled Google Cloud
project.

Build the current library first, then install its tarball into this example:

```sh
cd ../..
npm ci
npm run build
npm pack --pack-destination /tmp/babylonjs-mapping-demo

cd examples-npm/google-3d-tiles
npm install /tmp/babylonjs-mapping-demo/babylonjs-mapping-1.1.44.tgz --no-save --no-package-lock
mkdir -p public
printf '%s' 'YOUR_KEY' > public/google-key.txt
npm run start
```

The default location loads automatically. Choose another location and select
**Load selected location** to move. Drag to orbit and scroll or pinch to zoom.
Changing location disposes the previous Google assets before loading the new
area.
