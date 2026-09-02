import { Vector2 } from "@babylonjs/core/Maths/math.js";
import Raster from "./Raster.js";
import type TileSet from "../core/TileSet.js";
/** The public GEBCO WMS endpoint for the latest available grid. */
export declare const GEBCO_WMS_URL = "https://wms.gebco.net/mapserv";
/** The GEBCO WMS layer with colour-shaded elevation and bathymetry. */
export declare const GEBCO_DEFAULT_LAYER = "GEBCO_LATEST_2";
export interface RasterGEBCOOptions {
    /** Override the GEBCO WMS endpoint, for example to use a versioned service. */
    serviceUrl?: string;
    /** WMS layer name. Defaults to the latest colour-shaded GEBCO grid. */
    layer?: string;
    /** WMS style name. */
    style?: string;
    /** WMS protocol version. */
    version?: string;
    /** Width and height of each requested WMS image tile. */
    tileSize?: number;
    /** Image format returned by the WMS. */
    format?: string;
    /** Whether the WMS image should include transparency. */
    transparent?: boolean;
}
/**
 * Requests colour-shaded GEBCO bathymetry as Web Mercator map tiles.
 *
 * GEBCO publishes its full-resolution grids as downloadable files. Its WMS
 * is the browser-friendly way to stream the global grid into a tileset, so
 * this provider deliberately handles imagery rather than bundling a global
 * multi-gigabyte elevation file with an application.
 */
export default class RasterGEBCO extends Raster {
    private static readonly WEB_MERCATOR_HALF_WORLD;
    serviceUrl: string;
    layer: string;
    style: string;
    version: string;
    tileSize: number;
    format: string;
    transparent: boolean;
    constructor(tileSet: TileSet, options?: RasterGEBCOOptions);
    /**
     * Builds a WMS GetMap URL for the slippy-map tile at the requested zoom.
     * The WMS is requested in EPSG:3857 so the image lines up with the
     * library's existing OSM, Mapbox, and WMTS providers.
     */
    getRasterURL(tileCoords: Vector2, zoom: number): string;
}
