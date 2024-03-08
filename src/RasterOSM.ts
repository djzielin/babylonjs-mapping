import { Vector2 } from "@babylonjs/core/Maths/math";

export default class OpenStreetMap {

    private static osmServers: string[] = ["https://a.tile.openstreetmap.org/", "https://b.tile.openstreetmap.org/", "https://c.tile.openstreetmap.org/"];
    private static index=0;


    public static getRasterURL(tileCoords: Vector2, zoom: number): string {
        const extension = ".png";
        const prefix = this.osmServers[this.index % 3];
        this.index++;

        const url = prefix + zoom + "/" + (tileCoords.x) + "/" + (tileCoords.y) + extension;    
        
        return url;
    }
}