import { ProjectionType } from "./TileMath";
import { BuildingRequest } from "./Buildings";
import Tile from "./Tile";
import TileSet from "./TileSet";
import Buildings from "./Buildings";
import * as GeoJSON from './GeoJSON';
export default class BuildingsCustom extends Buildings {
    url: string;
    projection: ProjectionType;
    private BuildingsOnTile;
    constructor(name: string, url: string, projection: ProjectionType, tileSet: TileSet);
    private setupMap;
    SubmitLoadTileRequest(tile: Tile): void;
    ProcessGeoJSON(request: BuildingRequest, topLevel: GeoJSON.topLevel): void;
}
