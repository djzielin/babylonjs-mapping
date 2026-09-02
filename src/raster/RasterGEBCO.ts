import { Vector2 } from "@babylonjs/core/Maths/math.js";
import Raster from "./Raster.js";
import type TileSet from "../core/TileSet.js";

/** The public GEBCO WMS endpoint for the latest available grid. */
export const GEBCO_WMS_URL = "https://wms.gebco.net/mapserv";

/** The GEBCO WMS layer with colour-shaded elevation and bathymetry. */
export const GEBCO_DEFAULT_LAYER = "GEBCO_LATEST_2";

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
    private static readonly WEB_MERCATOR_HALF_WORLD = 20037508.342789244;

    public serviceUrl: string;
    public layer: string;
    public style: string;
    public version: string;
    public tileSize: number;
    public format: string;
    public transparent: boolean;

    constructor(tileSet: TileSet, options: RasterGEBCOOptions = {}) {
        super("GEBCO", tileSet);

        this.serviceUrl = options.serviceUrl ?? GEBCO_WMS_URL;
        this.layer = options.layer ?? GEBCO_DEFAULT_LAYER;
        this.style = options.style ?? "default";
        this.version = options.version ?? "1.3.0";
        this.tileSize = options.tileSize ?? 256;
        this.format = options.format ?? "image/png";
        this.transparent = options.transparent ?? false;

        if (!Number.isInteger(this.tileSize) || this.tileSize <= 0) {
            throw new RangeError("RasterGEBCO tileSize must be a positive integer.");
        }
    }

    /**
     * Builds a WMS GetMap URL for the slippy-map tile at the requested zoom.
     * The WMS is requested in EPSG:3857 so the image lines up with the
     * library's existing OSM, Mapbox, and WMTS providers.
     */
    public override getRasterURL(tileCoords: Vector2, zoom: number): string {
        if (!Number.isInteger(zoom) || zoom < 0) {
            throw new RangeError("RasterGEBCO zoom must be a non-negative integer.");
        }

        const tileCount = 2 ** zoom;
        const wrappedX = ((Math.floor(tileCoords.x) % tileCount) + tileCount) % tileCount;
        const clampedY = Math.max(0, Math.min(tileCount - 1, Math.floor(tileCoords.y)));
        const tileSpan = (RasterGEBCO.WEB_MERCATOR_HALF_WORLD * 2) / tileCount;

        const minX = -RasterGEBCO.WEB_MERCATOR_HALF_WORLD + wrappedX * tileSpan;
        const maxX = minX + tileSpan;
        const maxY = RasterGEBCO.WEB_MERCATOR_HALF_WORLD - clampedY * tileSpan;
        const minY = maxY - tileSpan;

        const url = new URL(this.serviceUrl);
        const parameters = {
            service: "WMS",
            version: this.version,
            request: "GetMap",
            layers: this.layer,
            styles: this.style,
            crs: "EPSG:3857",
            bbox: [minX, minY, maxX, maxY].join(","),
            width: String(this.tileSize),
            height: String(this.tileSize),
            format: this.format,
            transparent: String(this.transparent),
        };

        for (const [key, value] of Object.entries(parameters)) {
            url.searchParams.set(key, value);
        }

        return url.toString();
    }
}
