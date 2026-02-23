 class OpenStreetMap {
    static getRasterURL(tileCoords, zoom) {
        const extension = ".png";
        const prefix = this.osmServers[this.index % this.osmServers.length];
        this.index++;
        const url = prefix + zoom + "/" + (tileCoords.x) + "/" + (tileCoords.y) + extension;
        return url;
    }
}
OpenStreetMap.osmServers = ["https://tile.openstreetmap.org/"];
OpenStreetMap.index = 0;
