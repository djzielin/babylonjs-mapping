import type { GlobeLookAt } from "babylonjs-mapping";

export interface TourStop extends GlobeLookAt {
    title: string;
    text: string;
    /** Degrees per second of slow orbit while lingering. */
    orbit?: number;
}

/** From orbit to street level and back: photorealistic cities and terrain. */
export const TOUR: TourStop[] = [
    {
        title: "New York", text: "Photorealistic 3D tiles, streamed and drawn in a single pass",
        latitude: 40.7484, longitude: -73.9857, height: 180, heading: 205, pitch: -24, range: 2600, orbit: 2.5,
    },
    {
        title: "Grand Canyon", text: "Satellite imagery over terrain, sharp to the horizon",
        latitude: 36.1003, longitude: -112.0941, height: 750, heading: 340, pitch: -22, range: 7500, orbit: 1.5,
    },
    {
        title: "San Francisco", text: "Golden Gate Bridge, with live road traffic",
        latitude: 37.8199, longitude: -122.4783, height: 120, heading: 300, pitch: -16, range: 3200, orbit: 2,
    },
    {
        title: "Tokyo", text: "Tokyo Tower and Minato",
        latitude: 35.6586, longitude: 139.7454, height: 150, heading: 330, pitch: -22, range: 2600, orbit: 2.5,
    },
    {
        title: "Mount Everest", text: "The roof of the world, 8,849 m",
        latitude: 27.9881, longitude: 86.9250, height: 7600, heading: 30, pitch: -8, range: 14000, orbit: 1.5,
    },
    {
        title: "Rio de Janeiro", text: "Christ the Redeemer above Guanabara Bay",
        latitude: -22.95192, longitude: -43.21049, height: 722, heading: 255, pitch: -6, range: 340, orbit: 2,
    },
    {
        title: "Mariana Trench", text: "Challenger Deep, nearly 11 km beneath the Pacific",
        latitude: 11.3733, longitude: 142.5917, height: -10850, heading: 90, pitch: -8, range: 2500, orbit: 2,
    },
    {
        title: "Sydney", text: "The Opera House and Harbour Bridge",
        latitude: -33.8568, longitude: 151.2153, height: 30, heading: 140, pitch: -20, range: 2000, orbit: 2.5,
    },
];
