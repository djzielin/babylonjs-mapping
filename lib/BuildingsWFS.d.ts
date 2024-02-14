import { ProjectionType } from "./TileMath";
import Tile from "./Tile";
import TileSet from "./TileSet";
import Buildings from "./Buildings";
export default class BuildingsWFS extends Buildings {
    url: string;
    layerName: string;
    projection: ProjectionType;
    urlService: string;
    urlOutput: string;
    urlRequest: string;
    flipWinding: boolean;
    constructor(name: string, url: string, layerName: string, projection: ProjectionType, tileSet: TileSet);
    setupAGOL(): void;
    setupGeoServer(): void;
    SubmitLoadTileRequest(tile: Tile): void;
}
