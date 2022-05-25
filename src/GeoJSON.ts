
export interface topLevel {
    "type": string;
    "features": features[];
}

export interface features {
    "id": string;
    "type": string;
    "properties": properties;
    "geometry": geometry;
}

export interface properties {
    "name": string;
    "type": string;
    "height": number;
    "levels": number;
}
export interface geometry {
    "type": string;
    "coordinates": unknown;
}

export interface multiPolygonSet extends Array<polygonSet> { } 
export interface polygonSet extends Array<coordinateSet> { }
export interface coordinateSet extends Array<coordinatePair> { }
export interface coordinatePair extends Array<number> { }

