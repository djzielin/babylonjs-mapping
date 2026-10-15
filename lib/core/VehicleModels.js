/**
 * Low-poly vehicles. Aircraft are at true scale, built procedurally from a type's real
 * length and wingspan and its general arrangement: enough to tell an A380
 * from a regional jet or a Cessna at a glance, at a few hundred triangles each.
 *
 * Models are in metres: x to the right wingtip, y up, z forward, centred on
 * the fuselage.
 */
/** Material slots of a model's triangles, coloured by the renderer. */
export var VehiclePart;
(function (VehiclePart) {
    VehiclePart[VehiclePart["Body"] = 0] = "Body";
    VehiclePart[VehiclePart["Wing"] = 1] = "Wing";
    VehiclePart[VehiclePart["Engine"] = 2] = "Engine";
    VehiclePart[VehiclePart["Tail"] = 3] = "Tail";
    VehiclePart[VehiclePart["Dark"] = 4] = "Dark";
})(VehiclePart || (VehiclePart = {}));
/** Length and wingspan (rotor diameter for helicopters) in metres, and layout, by ICAO type designator. */
const TYPES = {
    A318: [31.4, 34.1, "twin"], A319: [33.8, 35.8, "twin"], A320: [37.6, 35.8, "twin"], A321: [44.5, 35.8, "twin"],
    A19N: [33.8, 35.8, "twin"], A20N: [37.6, 35.8, "twin"], A21N: [44.5, 35.8, "twin"],
    A332: [58.8, 60.3, "twin"], A333: [63.7, 60.3, "twin"], A338: [58.8, 64, "twin"], A339: [63.7, 64, "twin"],
    A359: [66.8, 64.8, "twin"], A35K: [73.8, 64.8, "twin"], A343: [63.7, 60.3, "quad"], A346: [75.3, 63.5, "quad"], A388: [72.7, 79.8, "quad"],
    B712: [37.8, 28.4, "rear"], B732: [30.5, 28.4, "twin"], B733: [33.4, 28.9, "twin"], B734: [36.4, 28.9, "twin"], B735: [31, 28.9, "twin"],
    B736: [31.2, 34.3, "twin"], B737: [33.6, 34.3, "twin"], B738: [39.5, 35.8, "twin"], B739: [42.1, 35.8, "twin"],
    B37M: [35.6, 35.9, "twin"], B38M: [39.5, 35.9, "twin"], B39M: [42.2, 35.9, "twin"], B3XM: [43.8, 35.9, "twin"],
    B752: [47.3, 38, "twin"], B753: [54.4, 38, "twin"], B762: [48.5, 47.6, "twin"], B763: [54.9, 47.6, "twin"], B764: [61.4, 51.9, "twin"],
    B772: [63.7, 60.9, "twin"], B77L: [63.7, 64.8, "twin"], B773: [73.9, 60.9, "twin"], B77W: [73.9, 64.8, "twin"],
    B778: [70.9, 71.8, "twin"], B779: [76.7, 71.8, "twin"], B788: [56.7, 60.1, "twin"], B789: [62.8, 60.1, "twin"], B78X: [68.3, 60.1, "twin"],
    B742: [70.6, 59.6, "quad"], B744: [70.7, 64.4, "quad"], B748: [76.3, 68.4, "quad"],
    MD11: [61.6, 51.7, "twin"], MD82: [45.1, 32.9, "rear"], MD83: [45.1, 32.9, "rear"], MD88: [45.1, 32.9, "rear"], MD90: [46.5, 32.9, "rear"],
    BCS1: [35, 35.1, "twin"], BCS3: [38.7, 35.1, "twin"], E170: [29.9, 26, "twin"], E75L: [31.7, 26, "twin"], E75S: [31.7, 26, "twin"],
    E190: [36.2, 28.7, "twin"], E195: [38.7, 28.7, "twin"], E290: [36.3, 33.7, "twin"], E295: [41.5, 35.1, "twin"],
    E135: [26.3, 20, "rear"], E145: [29.9, 20, "rear"], CRJ1: [26.8, 21.2, "rear"], CRJ2: [26.8, 21.2, "rear"], CRJ7: [32.5, 23.2, "rear"],
    CRJ9: [36.4, 24.9, "rear"], CRJX: [39.1, 26.2, "rear"], F100: [35.5, 28.1, "rear"], B461: [26.2, 26.3, "quad"],
    AT43: [22.7, 24.6, "turboprop"], AT45: [22.7, 24.6, "turboprop"], AT72: [27.2, 27, "turboprop"], AT75: [27.2, 27, "turboprop"],
    AT76: [27.2, 27, "turboprop"], DH8A: [22.3, 25.9, "turboprop"], DH8C: [25.7, 27.4, "turboprop"], DH8D: [32.8, 28.4, "turboprop"],
    SF34: [19.7, 21.4, "turboprop"], DHC6: [15.8, 19.8, "turboprop"], B190: [17.6, 17.7, "twin-prop"], BE20: [13.3, 16.6, "twin-prop"],
    BE9L: [10.8, 15.3, "twin-prop"], BE58: [9.1, 11.5, "twin-prop"], PA31: [10.6, 12.4, "twin-prop"], DA42: [8.6, 13.4, "twin-prop"], P68: [9.4, 12, "twin-prop"],
    C150: [7.3, 10.1, "single-high"], C152: [7.3, 10.1, "single-high"], C172: [8.3, 11, "single-high"], C182: [8.8, 11, "single-high"],
    C206: [8.6, 11, "single-high"], T206: [8.6, 11, "single-high"], C210: [8.6, 11.2, "single-high"], C208: [11.5, 15.9, "single-high"],
    PC6T: [11, 15.9, "single-high"], DHC2: [9.2, 14.6, "single-high"], KODI: [10.7, 13.7, "single-high"],
    P28A: [7.3, 10.7, "single-low"], P28B: [7.3, 10.7, "single-low"], P28R: [7.6, 10.8, "single-low"], PA32: [8.4, 11, "single-low"],
    PA46: [8.8, 13.1, "single-low"], SR20: [7.9, 11.7, "single-low"], SR22: [7.9, 11.7, "single-low"], S22T: [7.9, 11.7, "single-low"],
    DA40: [8, 11.9, "single-low"], BE35: [8.4, 10.2, "single-low"], BE36: [8.4, 10.2, "single-low"], M20P: [7.5, 11, "single-low"],
    M20T: [8.2, 11.1, "single-low"], PC12: [14.4, 16.3, "single-low"], TBM7: [10.6, 12.8, "single-low"], TBM9: [10.7, 12.8, "single-low"],
    GA6C: [6.7, 8.9, "single-low"], RV7: [6.2, 7.6, "single-low"], SIRA: [7, 10.4, "single-low"],
    C25A: [14.4, 15.5, "rear"], C25B: [15.6, 15.9, "rear"], C25C: [16.3, 15.5, "rear"], C510: [12.4, 13.2, "rear"], C525: [13, 14.3, "rear"],
    C550: [14.9, 15.9, "rear"], C560: [16.3, 16.5, "rear"], C56X: [16, 17.2, "rear"], C680: [19.4, 22, "rear"], C68A: [19.4, 22, "rear"],
    C700: [22.3, 21, "rear"], C750: [22, 19.4, "rear"], E50P: [12.8, 12.3, "rear"], E55P: [15.6, 16.2, "rear"], E545: [20.7, 20, "rear"],
    E550: [20.7, 20, "rear"], LJ35: [14.8, 12, "rear"], LJ45: [17.7, 14.6, "rear"], LJ60: [17.9, 13.4, "rear"], H25B: [15.6, 15.7, "rear"],
    CL30: [20.9, 19.5, "rear"], CL35: [20.9, 19.5, "rear"], CL60: [20.9, 19.6, "rear"], GL5T: [29.5, 28.7, "rear"], GLEX: [30.3, 28.7, "rear"],
    GL7T: [33.8, 31.7, "rear"], GLF4: [26.9, 23.7, "rear"], GLF5: [29.4, 28.5, "rear"], GLF6: [30.4, 30.4, "rear"], G280: [20.3, 19.2, "rear"],
    F2TH: [20.2, 19.3, "rear"], F900: [20.2, 19.3, "rear"], FA7X: [23.2, 26.2, "rear"], FA8X: [24.5, 26.3, "rear"], PRM1: [14, 13.6, "rear"],
    HDJT: [13, 12.1, "rear"], SF50: [9.4, 11.8, "single-low"],
    B06: [9.5, 10.2, "helicopter"], B407: [12.7, 10.7, "helicopter"], B429: [13.1, 11, "helicopter"], R22: [8.8, 7.7, "helicopter"],
    R44: [11.7, 10.1, "helicopter"], R66: [11.7, 10.1, "helicopter"], EC35: [12.2, 10.2, "helicopter"], EC45: [13, 11, "helicopter"],
    EC30: [12.6, 10.7, "helicopter"], AS50: [12.9, 10.7, "helicopter"], AS65: [13.7, 11.9, "helicopter"], S76: [16, 13.4, "helicopter"],
    A109: [13, 11, "helicopter"], A139: [16.7, 13.8, "helicopter"], H60: [19.8, 16.4, "helicopter"], S92: [20.9, 17.2, "helicopter"],
};
/** By ADS-B emitter category, when the type is unknown. */
const CATEGORIES = {
    A1: [8.3, 11, "single-high"], A2: [16, 17, "rear"], A3: [37.6, 35.8, "twin"], A4: [47.3, 38, "twin"],
    A5: [63.7, 60.9, "twin"], A6: [15, 10, "rear"], A7: [12, 10.7, "helicopter"], B1: [7, 15, "single-high"], B4: [6, 9, "single-high"],
};
const cache = new Map();
/**
 * A model for an ICAO aircraft type designator, or failing that an ADS-B
 * emitter category, or failing both a guess from ground speed.
 */
export function aircraftModel(type, category, speed) {
    const known = (type && TYPES[type.toUpperCase()]) || (category && CATEGORIES[category.toUpperCase()]);
    const spec = known || ((speed ?? 0) > 110 ? CATEGORIES.A3 : CATEGORIES.A1);
    const key = spec.join();
    let model = cache.get(key);
    if (!model)
        cache.set(key, model = build(...spec));
    return model;
}
class Builder {
    positions = [];
    normals = [];
    parts = [];
    triangle(part, a, b, c) {
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const length = Math.hypot(nx, ny, nz) || 1;
        nx /= length;
        ny /= length;
        nz /= length;
        for (const p of [a, b, c]) {
            this.positions.push(p[0], p[1], p[2]);
            this.normals.push(nx, ny, nz);
            this.parts.push(part);
        }
    }
    quad(part, a, b, c, d) {
        this.triangle(part, a, b, c);
        this.triangle(part, a, c, d);
    }
    /** A tube along z through rings of [z, radius, y offset], with `sides` sides, capped. */
    tube(part, rings, sides, x = 0, y = 0, squash = 1) {
        const ring = ([z, r, dy]) => Array.from({ length: sides }, (_, i) => {
            const angle = (i / sides) * Math.PI * 2;
            return [x + Math.cos(angle) * r, y + (dy ?? 0) + Math.sin(angle) * r * squash, z];
        });
        const points = rings.map(ring);
        for (let k = 0; k + 1 < points.length; k++) {
            for (let i = 0; i < sides; i++) {
                const j = (i + 1) % sides;
                this.quad(part, points[k][i], points[k + 1][i], points[k + 1][j], points[k][j]);
            }
        }
        const first = points[0], last = points[points.length - 1];
        const centre = (p) => [x, p.reduce((s, q) => s + q[1], 0) / sides, p[0][2]];
        for (let i = 0; i < sides; i++) {
            const j = (i + 1) % sides;
            this.triangle(part, centre(first), first[j], first[i]);
            this.triangle(part, centre(last), last[i], last[j]);
        }
    }
    /**
     * A thin wing panel from root to tip on both sides (or one, `mirror`
     * false): root leading edge at `rootZ`, chords, sweep of the tip's
     * leading edge back from the root's, dihedral rise and thickness.
     */
    wing(part, root, tip, thickness, mirror = true) {
        for (const side of mirror ? [1, -1] : [1]) {
            const rl = [root.x * side, root.y, root.z], rt = [root.x * side, root.y, root.z - root.chord];
            const tl = [tip.x * side, root.y + tip.rise, root.z - tip.sweep], tt = [tip.x * side, root.y + tip.rise, root.z - tip.sweep - tip.chord];
            const lift = (p, dy) => [p[0], p[1] + dy, p[2]];
            const h = thickness / 2;
            const top = [lift(rl, h), lift(tl, h * 0.5), lift(tt, h * 0.5), lift(rt, h)];
            const bottom = [lift(rl, -h), lift(tl, -h * 0.5), lift(tt, -h * 0.5), lift(rt, -h)];
            const wind = (q) => side > 0 ? q : [q[0], q[3], q[2], q[1]];
            this.quad(part, ...wind(top));
            this.quad(part, ...wind([bottom[0], bottom[3], bottom[2], bottom[1]]));
            // Leading and trailing edges and tip.
            this.quad(part, ...wind([bottom[0], bottom[1], top[1], top[0]]));
            this.quad(part, ...wind([top[3], top[2], bottom[2], bottom[3]]));
            this.quad(part, ...wind([top[1], bottom[1], bottom[2], top[2]]));
        }
    }
    /** A vertical fin on the centreline. */
    fin(part, rootZ, rootY, chord, height, sweep, tipChord, thickness) {
        const h = thickness / 2;
        const p = (x, y, z) => [x, y, z];
        const rl = rootZ, rt = rootZ - chord, tl = rootZ - sweep, tt = tl - tipChord, top = rootY + height;
        this.quad(part, p(h, rootY, rl), p(h, rootY, rt), p(h * 0.5, top, tt), p(h * 0.5, top, tl));
        this.quad(part, p(-h, rootY, rl), p(-h * 0.5, top, tl), p(-h * 0.5, top, tt), p(-h, rootY, rt));
        this.quad(part, p(h, rootY, rl), p(h * 0.5, top, tl), p(-h * 0.5, top, tl), p(-h, rootY, rl));
        this.quad(part, p(h * 0.5, top, tl), p(h * 0.5, top, tt), p(-h * 0.5, top, tt), p(-h * 0.5, top, tl));
    }
    /** Thin blades radiating from `centre` in the plane of unit axes `u` and `v`. */
    blades(centre, u, v, radius, width, count) {
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2 + 0.4;
            const d = [u[0] * Math.cos(angle) + v[0] * Math.sin(angle), u[1] * Math.cos(angle) + v[1] * Math.sin(angle), u[2] * Math.cos(angle) + v[2] * Math.sin(angle)];
            const s = [-u[0] * Math.sin(angle) + v[0] * Math.cos(angle), -u[1] * Math.sin(angle) + v[1] * Math.cos(angle), -u[2] * Math.sin(angle) + v[2] * Math.cos(angle)];
            const at = (t, w) => [0, 1, 2].map(k => centre[k] + d[k] * t + s[k] * w);
            this.quad(VehiclePart.Dark, at(radius * 0.08, width / 2), at(radius, width * 0.3), at(radius, -width * 0.3), at(radius * 0.08, -width / 2));
        }
    }
    done(length) {
        return { positions: new Float32Array(this.positions), normals: new Float32Array(this.normals), parts: new Uint8Array(this.parts), length };
    }
}
function build(length, span, layout) {
    const b = new Builder();
    const L = length, half = L / 2;
    if (layout === "helicopter") {
        const r = L * 0.11;
        b.tube(VehiclePart.Body, [[half * 0.15 - L * 0.32, r * 0.7, 0], [half * 0.15 - L * 0.2, r, 0], [half * 0.15, r, 0], [half * 0.15 + L * 0.12, r * 0.4, -r * 0.3]], 8);
        // Tail boom and fin.
        b.tube(VehiclePart.Body, [[half * 0.15 - L * 0.32, r * 0.25, r * 0.2], [-half, r * 0.15, r * 0.35]], 6);
        b.fin(VehiclePart.Tail, -half + L * 0.08, r * 0.3, L * 0.08, r * 1.6, L * 0.04, L * 0.05, L * 0.01);
        // Main rotor and its mast.
        const y = r * 1.25;
        b.tube(VehiclePart.Dark, [[-r * 0.1, r * 0.12, 0], [r * 0.1, r * 0.12, 0]], 6, 0, y - r * 0.15);
        b.blades([0, y, 0], [1, 0, 0], [0, 0, 1], span / 2, span * 0.025, 4);
        return b.done(L);
    }
    const jet = layout === "twin" || layout === "quad" || layout === "rear";
    // Fuselage diameter relative to length: airliners ~0.1, light aircraft ~0.14.
    const r = L * (jet ? 0.052 : 0.07);
    const noseZ = half, tailZ = -half;
    b.tube(VehiclePart.Body, jet ? [
        [tailZ, r * 0.12, r * 0.55], [tailZ + L * 0.12, r * 0.55, r * 0.3], [tailZ + L * 0.28, r, 0],
        [noseZ - L * 0.12, r, 0], [noseZ - L * 0.04, r * 0.75, -r * 0.1], [noseZ, r * 0.2, -r * 0.25],
    ] : [
        [tailZ, r * 0.15, r * 0.4], [tailZ + L * 0.35, r * 0.6, r * 0.15], [tailZ + L * 0.6, r, 0],
        [noseZ - L * 0.12, r, 0], [noseZ - L * 0.02, r * 0.55, -r * 0.1], [noseZ, r * 0.2, -r * 0.1],
    ], jet ? 10 : 8);
    const semi = span / 2;
    if (jet) {
        const rootChord = layout === "rear" ? L * 0.16 : L * 0.2;
        const rootZ = layout === "rear" ? L * 0.08 : L * 0.1;
        const sweep = semi * (layout === "rear" ? 0.45 : 0.55);
        b.wing(VehiclePart.Wing, { x: r * 0.8, y: -r * 0.55, z: rootZ, chord: rootChord }, { x: semi, chord: rootChord * 0.28, sweep, rise: semi * 0.09 }, r * 0.22);
        const engineR = layout === "rear" ? r * 0.38 : layout === "quad" ? r * 0.36 : r * 0.5;
        const engineLength = L * (layout === "rear" ? 0.12 : 0.11);
        const nacelle = (x, y, z) => b.tube(VehiclePart.Engine, [[z - engineLength, engineR * 0.75, 0], [z - engineLength * 0.3, engineR, 0], [z, engineR, 0]], 8, x, y);
        if (layout === "rear") {
            for (const side of [1, -1])
                nacelle(side * (r + engineR * 1.1), r * 0.35, tailZ + L * 0.3);
            // T-tail.
            b.fin(VehiclePart.Tail, tailZ + L * 0.2, r * 0.6, L * 0.17, r * 2.6, L * 0.12, L * 0.09, r * 0.15);
            b.wing(VehiclePart.Tail, { x: 0, y: r * 0.6 + r * 2.5, z: tailZ + L * 0.08, chord: L * 0.085 }, { x: span * 0.17, chord: L * 0.045, sweep: L * 0.05, rise: 0 }, r * 0.1);
        }
        else {
            const stations = layout === "quad" ? [0.36, 0.66] : [0.34];
            for (const t of stations)
                for (const side of [1, -1]) {
                    const x = side * semi * t, z = rootZ - sweep * t + engineLength * 0.55;
                    nacelle(x, -r * 0.55 + semi * 0.09 * t - engineR * 1.05, z);
                }
            b.fin(VehiclePart.Tail, tailZ + L * 0.2, r * 0.5, L * 0.17, r * 2.9, L * 0.13, L * 0.08, r * 0.15);
            b.wing(VehiclePart.Wing, { x: r * 0.3, y: r * 0.45, z: tailZ + L * 0.17, chord: L * 0.1 }, { x: span * 0.18, chord: L * 0.04, sweep: L * 0.07, rise: span * 0.012 }, r * 0.1);
        }
        return b.done(L);
    }
    // Propeller aircraft: straight, tapered wings.
    const high = layout === "single-high" || layout === "turboprop";
    const chord = Math.max(L * 0.13, span * 0.11);
    const wingY = high ? r * 0.95 : -r * 0.55;
    const wingZ = L * (layout === "turboprop" ? 0.1 : 0.17);
    b.wing(VehiclePart.Wing, { x: r * 0.7, y: wingY, z: wingZ, chord }, { x: semi, chord: chord * 0.7, sweep: chord * 0.12, rise: high ? 0 : semi * 0.06 }, r * 0.25);
    b.fin(VehiclePart.Tail, tailZ + L * 0.14, r * 0.3, L * 0.16, r * (layout === "turboprop" ? 3.2 : 2.4), L * 0.1, L * 0.08, r * 0.14);
    b.wing(VehiclePart.Wing, { x: r * 0.2, y: layout === "turboprop" ? r * 3.3 : r * 0.35, z: tailZ + L * 0.13, chord: L * 0.09 }, { x: span * 0.17, chord: L * 0.06, sweep: L * 0.02, rise: 0 }, r * 0.12);
    const disc = (x, y, z, radius) => b.blades([x, y, z], [1, 0, 0], [0, 1, 0], radius, radius * 0.08, 3);
    if (layout === "turboprop" || layout === "twin-prop") {
        const engineR = r * 0.42, engineLength = L * 0.2;
        for (const side of [1, -1]) {
            const x = side * semi * 0.32, y = wingY - (high ? engineR * 0.6 : 0), z = wingZ + engineLength * 0.45;
            b.tube(VehiclePart.Engine, [[z - engineLength, engineR * 0.5, 0], [z - engineLength * 0.4, engineR, 0], [z, engineR * 0.7, 0]], 8, x, y);
            disc(x, y, z + L * 0.01, span * (layout === "turboprop" ? 0.13 : 0.09));
        }
    }
    else {
        disc(0, -r * 0.1, noseZ + L * 0.01, span * 0.08);
    }
    return b.done(L);
}
let ship;
/** A ship one unit long: hull, deck and a superstructure aft. */
export function shipModel() {
    if (ship)
        return ship;
    const b = new Builder();
    const beam = 0.085, deck = 0.05, keel = -0.03;
    // Deck outline from the bow aft, starboard side; the port side mirrors it.
    const outline = [[0, 0.5], [beam * 0.6, 0.38], [beam, 0.22], [beam, -0.44], [beam * 0.85, -0.5]];
    const side = (s) => outline.map(([x, z]) => [x * s, z]);
    for (const s of [1, -1]) {
        const o = side(s);
        for (let i = 0; i + 1 < o.length; i++) {
            const [ax, az] = o[i], [bx, bz] = o[i + 1];
            const quad = [[ax, deck, az], [ax * 0.8, keel, az], [bx * 0.8, keel, bz], [bx, deck, bz]];
            if (s > 0)
                b.quad(VehiclePart.Dark, quad[0], quad[1], quad[2], quad[3]);
            else
                b.quad(VehiclePart.Dark, quad[0], quad[3], quad[2], quad[1]);
            // Deck.
            if (s > 0)
                b.triangle(VehiclePart.Wing, [0, deck, az], [ax, deck, az], [bx, deck, bz]);
            else
                b.triangle(VehiclePart.Wing, [0, deck, az], [bx, deck, bz], [ax, deck, az]);
            if (s > 0)
                b.triangle(VehiclePart.Wing, [0, deck, az], [bx, deck, bz], [0, deck, bz]);
            else
                b.triangle(VehiclePart.Wing, [0, deck, az], [0, deck, bz], [bx, deck, bz]);
        }
    }
    // Transom.
    const [tx, tz] = outline[outline.length - 1];
    b.quad(VehiclePart.Dark, [tx, deck, tz], [-tx, deck, tz], [-tx * 0.8, keel, tz], [tx * 0.8, keel, tz]);
    // Superstructure aft, and a funnel.
    const box = (x, y0, y1, z0, z1, part) => {
        const p = (sx, y, z) => [sx * x, y, z];
        b.quad(part, p(1, y1, z1), p(1, y1, z0), p(-1, y1, z0), p(-1, y1, z1));
        b.quad(part, p(1, y0, z1), p(1, y0, z0), p(1, y1, z0), p(1, y1, z1));
        b.quad(part, p(-1, y0, z1), p(-1, y1, z1), p(-1, y1, z0), p(-1, y0, z0));
        b.quad(part, p(1, y0, z1), p(1, y1, z1), p(-1, y1, z1), p(-1, y0, z1));
        b.quad(part, p(1, y0, z0), p(-1, y0, z0), p(-1, y1, z0), p(1, y1, z0));
    };
    box(beam * 0.85, deck, deck + 0.07, -0.42, -0.22, VehiclePart.Body);
    box(beam * 0.3, deck + 0.07, deck + 0.13, -0.38, -0.3, VehiclePart.Tail);
    return ship = b.done(1);
}
//# sourceMappingURL=VehicleModels.js.map