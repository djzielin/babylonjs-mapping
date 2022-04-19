"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var OpenStreetMap = /** @class */ (function () {
    function OpenStreetMap() {
    }
    OpenStreetMap.getRasterURL = function (tileCoords, zoom) {
        var extension = ".png";
        var prefix = this.osmServers[this.index % 3];
        this.index++;
        var url = prefix + zoom + "/" + (tileCoords.x) + "/" + (tileCoords.y) + extension;
        return url;
    };
    OpenStreetMap.osmServers = ["https://a.tile.openstreetmap.org/", "https://b.tile.openstreetmap.org/", "https://c.tile.openstreetmap.org/"];
    OpenStreetMap.index = 0;
    return OpenStreetMap;
}());
exports.default = OpenStreetMap;
