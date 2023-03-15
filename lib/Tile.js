//based on this example: https://www.babylonjs-playground.com/#866PVL#5
//import "@babylonjs/core/Materials/standardMaterial"
//import "@babylonjs/inspector";
export default class Tile {
    constructor() {
        //////////////////////////////////
        // BUILDINGS
        //////////////////////////////////
        this.buildings = [];
        this.terrainLoaded = false;
        this.eastSeamFixed = false;
        this.northSeamFixed = false;
        this.northEastSeamFixed = false;
    }
    deleteBuildings() {
        for (let m of this.buildings) {
            m.dispose();
        }
        this.buildings = [];
    }
}
//# sourceMappingURL=Tile.js.map