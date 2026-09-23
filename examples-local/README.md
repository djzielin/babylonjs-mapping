These examples (in the examples-local) directory, use the local copy of the babylonjs-mapping library. 

The [live traffic demo](live-traffic/README.md) combines NYC DOT road speeds, OpenSky aircraft, and AISStream vessels in one map. Its sample scene runs without credentials; live ships require a server-side AISStream key.

The `billboard-test` example combines tens of thousands of Tokyo buildings with
a high-resolution stitched terrain corridor extending to Mount Fuji.
This is ideal for trying to modify the mapping library and work on new features. 
You will need to do an 'npm run build' in the root, if you do modify the mapping library. 
