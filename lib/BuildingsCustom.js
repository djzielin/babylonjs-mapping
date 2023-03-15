import { BuildingRequestType } from "./Buildings";
import Buildings from "./Buildings";
export default class BuildingsCustom extends Buildings {
    constructor(name, url, projection, tileSet) {
        super(name, tileSet);
        this.url = url;
        this.projection = projection;
        this.BuildingsOnTile = new Map();
    }
    setupMap(request, topLevel) {
        for (const f of topLevel.features) {
            if (request.projectionType !== undefined) {
                const tileCoord = this.ourGeoJSON.getFirstCoordinateTile(f, request.projectionType, this.tileSet.zoom);
                const tileCoordString = tileCoord.toString();
                console.log(this.prettyName() + "this building is for tile: " + tileCoordString);
                let fArray = this.BuildingsOnTile.get(tileCoordString);
                if (fArray === undefined) { //first time seeing this tile, need to initialize the array
                    fArray = [];
                }
                fArray.push(f);
                this.BuildingsOnTile.set(tileCoordString, fArray);
            }
        }
        console.log(this.prettyName() + "map is now setup with size: " + this.BuildingsOnTile.size);
    }
    SubmitLoadTileRequest(tile) {
        const request = {
            requestType: BuildingRequestType.LoadTile,
            tile: tile,
            tileCoords: tile.tileCoords.clone(),
            projectionType: this.projection,
            url: this.url,
            inProgress: false
        };
        this.buildingRequests.push(request);
    }
    ProcessGeoJSON(request, topLevel) {
        if (request.tile.tileCoords.equals(request.tileCoords) == false) {
            console.warn(this.prettyName() + "tile coords have changed while we were loading, not adding buildings to queue!");
            return;
        }
        console.log(this.prettyName() + "trying to submit building requests for tile: " + request.tileCoords);
        let buildingsAdded = 0;
        //if we want to filter each time we get called, instead of using the map (cached sorting) of features into appropriate tiles
        /*for (const f of topLevel.features) {
            const tileCoord = this.ourGeoJSON.getFirstCoordinateTile(f, this.projection, this.tileSet.zoom);

            if (tileCoord.equals(request.tileCoords)) { //check if this feature is in our requested tile
                const brequest: BuildingRequest = {
                    requestType: BuildingRequestType.CreateBuilding,
                    tile: request.tile,
                    tileCoords: request.tile.tileCoords.clone(),
                    projectionType: request.projectionType,
                    feature: f
                }
                this.buildingRequests.push(brequest);
                buildingsAdded++;
            }
        }*/
        if (this.BuildingsOnTile.size == 0) {
            console.log(this.prettyName() + "map hasn't yet been setup!");
            this.setupMap(request, topLevel);
        }
        const features = this.BuildingsOnTile.get(request.tileCoords.toString());
        if (features) {
            for (const f of features) {
                const brequest = {
                    requestType: BuildingRequestType.CreateBuilding,
                    tile: request.tile,
                    tileCoords: request.tile.tileCoords.clone(),
                    projectionType: request.projectionType,
                    feature: f,
                    inProgress: false
                };
                this.buildingRequests.push(brequest);
                buildingsAdded++;
            }
        }
        if (this.doMerge) {
            //console.log("queueing up merge request for tile: " + tile.tileCoords);
            const mrequest = {
                requestType: BuildingRequestType.MergeAllBuildingsOnTile,
                tile: request.tile,
                tileCoords: request.tile.tileCoords.clone(),
                inProgress: false
            };
            this.buildingRequests.push(mrequest);
        }
        console.log(this.prettyName() + buildingsAdded + " building generation requests queued for tile: " + request.tile.tileCoords);
    }
}
//# sourceMappingURL=BuildingsCustom.js.map