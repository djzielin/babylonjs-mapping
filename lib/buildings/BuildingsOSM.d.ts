import { RetrievalLocation } from "../shared/Retrieval";
import type Tile from "../core/Tile";
import type TileSet from "../core/TileSet";
import Buildings from "./Buildings";
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
