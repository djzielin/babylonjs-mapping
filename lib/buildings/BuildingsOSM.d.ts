import { RetrievalLocation } from "../shared/Retrieval.js";
import type Tile from "../core/Tile.js";
import type TileSet from "../core/TileSet.js";
import Buildings from "./Buildings.js";
export default class BuildingsOSM extends Buildings {
    private serverNum;
    accessToken: string;
    constructor(tileSet: TileSet, retrievalLocation?: RetrievalLocation);
    generateBuildings(): void;
    private osmBuildingServers;
    protected stripFilePrefix(original: string): string;
    SubmitLoadTileRequest(tile: Tile): void;
    SubmitLoadAllRequest(): void;
}
