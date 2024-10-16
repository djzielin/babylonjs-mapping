import { EPSG_Type } from "./TileMath";
import Tile from "./Tile";
import TileSet from "./TileSet";
import Buildings from "./Buildings";
export default class BuildingsWFS extends Buildings {
    url: string;
    layerName: string;
    epsg: EPSG_Type;
    urlService: string;
    urlOutput: string;
    urlRequest: string;
    flipWinding: boolean;
    constructor(name: string, url: string, layerName: string, epsg: EPSG_Type, tileSet: TileSet);
    setupAGOL(): void;
    setupGeoServer(): void;
    SubmitLoadTileRequest(tile: Tile): void;
}
