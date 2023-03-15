import { BuildingRequest } from "./Buildings";
import Tile from "./Tile";
import TileSet from "./TileSet";
import Buildings from "./Buildings";
import * as GeoJSON from './GeoJSON';
export default class BuildingsOSM extends Buildings {
    private serverNum;
    constructor(tileSet: TileSet);
    generateBuildings(): void;
    private osmBuildingServers;
    protected stripFilePrefix(original: string): string;
    SubmitLoadTileRequest(tile: Tile): void;
    ProcessGeoJSON(request: BuildingRequest, topLevel: GeoJSON.topLevel): void;
}
