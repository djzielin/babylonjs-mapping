import { Scene } from "@babylonjs/core/scene";
import { Engine } from "@babylonjs/core";
import { Vector2, Vector3 } from "@babylonjs/core/Maths/math";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { AdvancedDynamicTexture } from "@babylonjs/gui";
import { Observable } from "@babylonjs/core";
import Tile from './Tile';
import TileMath from './TileMath';
import Attribution from "./Attribution";
import Buildings from './Buildings';
import "@babylonjs/core/Materials/standardMaterial";
import "@babylonjs/inspector";
import '@babylonjs/core/Debug/debugLayer';
declare enum TileRequestType {
    LoadTile = 0
}
interface TileRequest {
    requestType: TileRequestType;
    tile: Tile;
    tileCoords: Vector3;
    url: string;
    mesh: Mesh;
    texture: Texture | null;
    inProgress: boolean;
}
export default class TileSet {
    scene: Scene;
    private engine;
    private xmin;
    private zmin;
    private xmax;
    private zmax;
    ourTiles: Tile[];
    ourTilesMap: Map<string, Tile>;
    doRasterResBoost: boolean;
    doTerrainResBoost: boolean;
    zoom: number;
    private tileCorner;
    centerCoords: Vector2;
    tileScale: number;
    private rasterProvider;
    private accessToken;
    private ourMB;
    private totalWidthMeters;
    private totalHeightMeters;
    ourAttribution: Attribution;
    ourTileMath: TileMath;
    protected tileRequests: TileRequest[];
    protected requestsProcessedSinceCaughtUp: number;
    onCaughtUpObservable: Observable<boolean>;
    numTiles: Vector2;
    tileWidth: number;
    meshPrecision: number;
    private isGeometrySetup;
    /**
    * this doesn't do much, just sets up a linkage between our library and users main project
    * @param scene the babylonjs scene, helps us get around a bug, where the main app and the library are in 2 different contexts
    * @param engine see above description for scene
    */
    constructor(scene: Scene, engine: Engine);
    /**
    * setup a ground plane tile set. this sets up just the underlying meshes, but doesn't populate them with content yet
    * @param numTiles how many tiles in the x and y directions
    * @param tileWidth width in meters of a single tile
    * @param meshPrecision how many numTiles in each tile's mesh. need more for terrain type meshes, less if no height change on mesh.
    */
    createGeometry(numTiles: Vector2, tileWidth: number, meshPrecision: number): void;
    protected prettyName(): string;
    processTileRequests(): void;
    getAdvancedDynamicTexture(): AdvancedDynamicTexture;
    makeSingleTileMesh(x: number, y: number, precision: number): Mesh;
    disableGroundCulling(): void;
    setRasterProvider(providerName: string, accessToken?: string): void;
    /**
    * update all the tiles in the tileset
    * @param lat latitude. conceptually the y position in decimal
    * @param lon longitude. conceptually the x position in decimal
    * @param zoom standard tile mapping zoom levels 0 (whole earth) - 20 (building)
    */
    updateRaster(lat: number, lon: number, zoom: number): void;
    private updateSingleRasterTile;
    /**
    * moves all the tiles in the set. when a tile reaches the edge, it is moved
    * to the opposite side of the tileset, e.g. a tile comes off the right
    * edge and moves to the left edge. useful for trying to achieve an endless
    * scrolling type effect, where the user doesn't move but the ground
    * underneath does
    * @param movX x, ie left-right amount to move
    * @param movZ z, ie forward-back amount to move
    * @param reloadLimitPerFrame limit how many tiles we update per frame, to prevent stuttering
    * @param doBuildingsOSM should we spawn OSM Buildings on the new tile?
    * @param doMerge should we merge all those OSM Buildings into one mesh? as an optimization
    */
    moveAllTiles(movX: number, movZ: number, reloadLimitPerFrame: number, buildingCreator: Buildings | null): void;
    private moveHelper;
    generateTerrain(exaggeration: number): Promise<void>;
    getTerrainLowestY(): number;
}
export {};
