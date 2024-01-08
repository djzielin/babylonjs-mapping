# babylonjs-mapping
This project is to help do mapping inside BabylonJS. 

Currently supported data sources include:
* OpenStreetMaps and OpenStreetMaps Buildings
![lots of gray buildings on top of map of roads](https://raw.githubusercontent.com/djzielin/babylonjs-mapping/main/doc/charlotte.jpg "Open Street Maps Demo")
* Mapbox (satellite and terrain)
![grand canyon with river at bottom](https://raw.githubusercontent.com/djzielin/babylonjs-mapping/main/doc/grand_canyon.jpg "Mapbox Terrain Demo")
* GeoServer via WFS

The "Hello World" of creating an OpenStreetMap tileset, along with extruded buildings is:

```
this.ourTS = new TileSet(this.scene,this.engine);
this.ourTS.createGeometry(new Vector2(4,4), 20, 2);
this.ourTS.setRasterProvider("OSM");
this.ourTS.updateRaster(35.2258461, -80.8400777, 16); //charlotte

this.ourOSM=new BuildingsOSM(this.ourTS);
this.ourOSM.doMerge=true; //merge all buildings on a tile
this.ourOSM.exaggeration=3;
this.ourOSM.generateBuildings();
```


Tested with:
Node 20.10.0 LTS
