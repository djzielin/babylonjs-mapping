# babylonjs-mapping
This project is to help do mapping inside BabylonJS. 

Currently supported data sources include:
* OpenStreetMaps and OpenStreetMaps Buildings
![lots of gray buildings on top of map of roads](https://raw.githubusercontent.com/djzielin/babylonjs-mapping/main/doc/charlotte.jpg "Open Street Maps Demo")
* Mapbox (satellite and terrain)
![grand canyon with river at bottom](https://raw.githubusercontent.com/djzielin/babylonjs-mapping/main/doc/grand_canyon.jpg "Mapbox Terrain Demo")

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

New (as of 3/14/2023)  
Try the "Hello World" in the BabylonJS Plaground  
https://playground.babylonjs.com/#XJVMUY#4 
  
This is published on NPM at:  
https://www.npmjs.com/package/babylonjs-mapping  
  
Note: when installing use Node v16.13.1  
The current Node LTS v18.14.2 FAILS!  

