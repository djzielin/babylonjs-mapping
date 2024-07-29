# babylonjs-mapping
This project is to help do mapping inside BabylonJS. 

Currently supported data sources include:
* OpenStreetMaps and OpenStreetMaps Buildings
![lots of gray buildings on top of map of roads](https://raw.githubusercontent.com/djzielin/babylonjs-mapping/main/doc/charlotte.jpg "Open Street Maps Demo")
* Mapbox (satellite and terrain)
![grand canyon with river at bottom](https://raw.githubusercontent.com/djzielin/babylonjs-mapping/main/doc/grand_canyon.jpg "Mapbox Terrain Demo")
* Custom Buildings from GeoServer and ArcGIS Online (WFS)

The "Hello World" of creating an OpenStreetMap tileset, along with extruded buildings is:

```
        this.ourTS = new TileSet(this.scene,this.engine);
        this.ourTS.setRasterProvider(new RasterOSM(this.ourTS)); //set basemap to pull from Open Street Maps
        this.ourTS.createGeometry(new Vector2(4,4), 20, 2); //4x4 tile set, 20m width of each tile, and 2 divisions on each tile
        this.ourTS.updateRaster(35.2258461, -80.8400777, 16); //lat, lon, zoom. takes us to charlotte. 

        this.ourOSM=new BuildingsOSM(this.ourTS); //lets pull building footprints from Open Street Map Buildings
        this.ourOSM.accessToken=accessToken;      //now requires Auth token
        this.ourOSM.generateBuildings();
```
Live Demos!  
https://people.duke.edu/~djzielin/babylonjs-mapping/HelloWorld/  
https://people.duke.edu/~djzielin/babylonjs-mapping/Terrain/  

Tested with:
Node 20.10.0 LTS
