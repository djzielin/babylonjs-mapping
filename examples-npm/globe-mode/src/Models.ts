import type { VehicleReport } from "babylonjs-mapping";

/**
 * glTF models of common aircraft and ships, from Sketchfab under CC BY 4.0
 * (see public/models/CREDITS.md), each standing in for its type and its
 * close relatives. Vehicles with no model here keep the built-in shapes.
 */
const MODELS = "models/";

/** Sketchfab authors by model file, credited while their models are drawn. */
export const MODEL_AUTHORS: Record<string, string> = {
    a220: "Duh anime addict", a320: "Dave Love SketchFab", a321: "Dave Bored SketchFab", a330: "Dave Love SketchFab",
    a350: "manilov.ap", at72: "Oyan3D", b737: "AMPG", b744: "zairiqzairiq", b757: "manilov.ap", b767: "manilov.ap",
    b777: "mamont nikita", b787: "manilov.ap", c172: "NLM", cargo: "hungry_drifter", container: "RM02",
    crj9: "CityJet Training", cruise: "farhad.Guli", dh8d: "Sofyan Kurniawan", ec35: "GRIP420", fishing: "Batuhan13",
    pa28: "helijah", sr22: "KOG_THORNS", yacht: "Sergei",
};

/** ICAO type designators by model. */
const AIRCRAFT: Record<string, string[]> = {
    a320: ["A318", "A319", "A320", "A19N", "A20N"],
    a321: ["A321", "A21N"],
    b737: ["B731", "B732", "B733", "B734", "B735", "B736", "B737", "B738", "B739", "B37M", "B38M", "B39M", "B3XM"],
    crj9: ["CRJ1", "CRJ2", "CRJ7", "CRJ9", "CRJX", "B712", "MD82", "MD83", "MD87", "MD88", "MD90", "F100", "E135", "E145"],
    a220: ["BCS1", "BCS3", "E170", "E75L", "E75S", "E190", "E195", "E290", "E295"],
    b777: ["B772", "B773", "B77L", "B77W", "B778", "B779", "MD11"],
    b787: ["B788", "B789", "B78X"],
    b767: ["B762", "B763", "B764"],
    b757: ["B752", "B753"],
    a330: ["A332", "A333", "A337", "A338", "A339", "A342", "A343", "A345", "A346"],
    a350: ["A359", "A35K"],
    b744: ["B741", "B742", "B743", "B744", "B748", "B74S", "A388"],
    dh8d: ["DH8A", "DH8B", "DH8C", "DH8D"],
    at72: ["AT43", "AT44", "AT45", "AT46", "AT72", "AT73", "AT75", "AT76", "SF34"],
    c172: ["C150", "C152", "C162", "C170", "C172", "C177", "C182", "C206", "T206", "C210", "C208", "P210", "DHC2", "KODI"],
    pa28: ["P28A", "P28B", "P28R", "P28T", "PA32", "P32R", "PA46", "BE35", "BE36", "M20P", "M20T", "DA40", "GA6C", "RV7"],
    sr22: ["SR20", "SR22", "S22T", "SF50", "TBM7", "TBM8", "TBM9", "PC12"],
    ec35: ["EC35", "EC30", "EC45", "EC55", "EC75", "AS50", "AS55", "AS65", "A109", "A119", "A139", "A169", "B06", "B407", "B429", "R22", "R44", "R66", "S76", "H500"],
};
const BY_TYPE = new Map(Object.entries(AIRCRAFT).flatMap(([model, types]) => types.map(type => [type, model])));

/** By ADS-B emitter category, when the type is unknown or has no model. */
const BY_CATEGORY: Record<string, string> = { A1: "c172", A2: "crj9", A3: "a320", A4: "b757", A5: "b777", A7: "ec35" };

/** The model for an aircraft by type, or failing that by its emitter category. */
export function aircraftModelUrl(report: VehicleReport): string | undefined {
    const model = (report.type && BY_TYPE.get(report.type.toUpperCase())) || (report.category && BY_CATEGORY[report.category.toUpperCase()]);
    return model ? `${MODELS}${model}.glb` : undefined;
}

/** The model for a ship by its AIS type (tens: 3 special, 6 passenger, 7 cargo, 8 tanker) and length. */
export function shipModelUrl(report: VehicleReport): string | undefined {
    const type = Number(report.category), length = report.length;
    if (!length) return undefined;
    const tens = Math.floor(type / 10);
    let model: string;
    if (type === 36 || type === 37) model = "yacht";
    else if (tens === 6) model = length >= 120 ? "cruise" : length < 30 ? "yacht" : "fishing";
    else if (tens === 7 || tens === 8) model = length >= 250 ? "container" : "cargo";
    else model = length < 25 ? "yacht" : length < 90 ? "fishing" : "cargo";
    return `${MODELS}${model}.glb`;
}

/** The file name of a model URL, without extension. */
export function modelKey(url: string): string {
    return url.slice(url.lastIndexOf("/") + 1).replace(/\.glb$/, "");
}
