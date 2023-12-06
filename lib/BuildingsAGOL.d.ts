import { ProjectionType } from "./TileMath";
import Tile from "./Tile";
import TileSet from "./TileSet";
import Buildings from "./Buildings";
export default class BuildingsAGOL extends Buildings {
    url: string;
    layerName: string;
    projection: ProjectionType;
    constructor(name: string, url: string, layerName: string, projection: ProjectionType, tileSet: TileSet);
    SubmitLoadTileRequest(tile: Tile): void;
}
