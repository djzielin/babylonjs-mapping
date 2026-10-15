import "@babylonjs/core/Culling/ray.js";
import { TargetCamera } from "@babylonjs/core/Cameras/targetCamera.js";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector.js";
import { Observable } from "@babylonjs/core/Misc/observable.js";
const DEGREES = Math.PI / 180;
const EARTH_RADIUS = 6378137;
export const GLOBE_CONTROLS_HELP = "Drag to look around (from space, to spin the globe) · middle drag or Ctrl drag to pan · wheel to fly toward the cursor · WASD or arrows move · Q/E down and up · I/K/J/L look · Shift moves faster";
/**
 * Globe navigation for a free camera: the horizon stays level, movement
 * follows the surface and its speed scales with altitude, so the same
 * controls work from orbit down to street level.
 *
 * - Drag (left or right button, or one finger) looks around; from globe
 *   height a left drag spins the globe instead, and so does moving.
 * - Middle drag, Ctrl drag or two fingers grab and pan the ground.
 * - The wheel or a pinch flies toward the point under the cursor.
 * - WASD/arrows move, Q/E or PageDown/PageUp descend and climb, I/K/J/L
 *   look, and Shift moves four times faster.
 */
export default class GlobeControls {
    globe;
    camera;
    canvas;
    /** Fires on any user input, e.g. to stop an automatic tour. */
    onUserInputObservable = new Observable();
    /** Accept user input. Flights and `setView` work either way. */
    enabled = true;
    minimumClearance;
    maximumHeight;
    adaptiveClipping;
    position = new Vector3();
    heading = 0;
    pitch = -30;
    keys = new Set();
    pointers = new Map();
    drag;
    pinch;
    flight;
    destination;
    groundHeight = 0;
    groundAge = Infinity;
    abort = new AbortController();
    observer;
    heightAt;
    constructor(globe, camera, canvas, options = {}) {
        this.globe = globe;
        this.camera = camera;
        this.canvas = canvas;
        this.heightAt = options.heightAt;
        this.minimumClearance = options.minimumClearance ?? 2;
        this.maximumHeight = options.maximumHeight ?? 4 * EARTH_RADIUS;
        this.adaptiveClipping = options.adaptiveClipping ?? true;
        this.position.copyFrom(camera.position);
        camera.rotationQuaternion ??= new Quaternion();
        this.attach();
        const scene = camera.getScene();
        let last = performance.now();
        this.observer = scene.onBeforeRenderObservable.add(() => {
            const now = performance.now();
            this.tick(Math.min(0.1, (now - last) / 1000), now);
            last = now;
        });
    }
    /** The camera's current location and orientation. */
    getView() {
        const coordinates = this.globe.getSurfaceCoordinates(this.position);
        return {
            latitude: coordinates.latitude,
            longitude: coordinates.longitude,
            height: coordinates.elevation / this.globe.metresToWorld,
            heading: this.heading,
            pitch: this.pitch,
        };
    }
    /** Metres between the camera and the ground beneath it. */
    get heightAboveGround() {
        return this.getView().height - this.groundHeight;
    }
    /** Move the camera at once, cancelling any flight. */
    setView(view) {
        this.cancelFlight();
        const pose = this.pose(view);
        this.position.copyFrom(pose.position);
        this.heading = pose.heading;
        this.pitch = pose.pitch;
        this.groundAge = Infinity;
        this.refreshGround();
        this.apply();
    }
    /**
     * Fly to a view along a rising arc. Resolves true on arrival, or false
     * when user input or another flight interrupts it.
     */
    flyTo(view, durationMs) {
        this.cancelFlight();
        const m = this.globe.metresToWorld;
        const end = this.pose(view);
        const from = this.orbitOf({ position: this.position.clone(), heading: this.heading, pitch: this.pitch }, this.groundHeight);
        const to = "range" in view
            ? orbitAt(this.globe.getSurfacePosition(view.latitude, view.longitude, (view.height ?? 0) * m), view.range * m, view.heading, view.pitch)
            : this.orbitOf(end, this.heightAt?.(view.latitude, view.longitude) ?? 0);
        const distance = Math.acos(Math.max(-1, Math.min(1, Vector3.Dot(from.direction, to.direction)))) * EARTH_RADIUS;
        // Fast travel: pull back to a map view high enough to hold both ends,
        // glide across, and drop in. Short hops just ease between the views.
        const near = Math.max(from.range, to.range) / m;
        const cruise = Math.max(near, Math.min(1.5e7, distance * 1.1)) * m;
        const overhead = smoothstep(1.5, 5, distance / near);
        const cruisePitch = (from.pitch + to.pitch) / 2 * (1 - overhead) - 89.5 * overhead;
        const duration = durationMs ?? Math.min(6500, 2400 + Math.log10(1 + distance / 1000) * 800);
        return new Promise(resolve => {
            this.flight = { from, to, end, cruise, cruisePitch, start: performance.now(), duration, resolve };
            if (this.destination)
                this.placeCamera(end, this.destination);
        });
    }
    /** The orbit equivalent to a pose: what it looks at on the ground at `groundHeight` metres, or ahead of it. */
    orbitOf(pose, groundHeight) {
        const m = this.globe.metresToWorld;
        const { forward } = frame(pose.position, pose.heading, pose.pitch);
        const ground = this.globe.radius + groundHeight * m;
        const p = pose.position;
        // The ray's hit on the ground sphere; looking above it, a point ahead.
        const b = Vector3.Dot(p, forward), c = p.lengthSquared() - ground * ground;
        const disc = b * b - c;
        let range = disc > 0 && -b - Math.sqrt(disc) > 0 ? -b - Math.sqrt(disc) : 0;
        if (!range)
            range = Math.max(1000 * m, (p.length() - ground) * 3);
        const target = p.add(forward.scale(range));
        const look = angles(target, forward);
        return { direction: target.normalize(), radius: Math.max(ground, target.length()), range, heading: look.heading, pitch: look.pitch };
    }
    get isFlying() {
        return this.flight !== undefined;
    }
    /**
     * A camera at the end of the current flight, or undefined when not
     * flying: give it to a layer's `prefetchCamera` to load the destination
     * on the way there.
     */
    get flightDestination() {
        if (!this.flight)
            return undefined;
        if (!this.destination) {
            this.destination = new TargetCamera("globe flight destination", Vector3.Zero(), this.camera.getScene(), false);
            this.placeCamera(this.flight.end, this.destination);
        }
        return this.destination;
    }
    /**
     * Point any camera at a view with this camera's field of view and the
     * clipping it would have there, e.g. for prefetching the next place.
     */
    placeCamera(view, camera) {
        const pose = "position" in view ? view : this.pose(view);
        camera.position.copyFrom(pose.position);
        camera.rotationQuaternion ??= new Quaternion();
        const { forward, up } = frame(pose.position, pose.heading, pose.pitch);
        Quaternion.FromLookDirectionLHToRef(forward, up, camera.rotationQuaternion);
        camera.fov = this.camera.fov;
        const { latitude, longitude } = this.globe.getSurfaceCoordinates(pose.position);
        const clip = this.clipping(pose.position, this.heightAt?.(latitude, longitude) ?? 0);
        camera.minZ = clip.near;
        camera.maxZ = clip.far;
    }
    /** The camera view that looks at a target from `range` metres away. */
    lookAt(target) {
        const pose = this.pose(target);
        const coordinates = this.globe.getSurfaceCoordinates(pose.position);
        return {
            latitude: coordinates.latitude, longitude: coordinates.longitude,
            height: coordinates.elevation / this.globe.metresToWorld, heading: pose.heading, pitch: pose.pitch,
        };
    }
    dispose() {
        this.cancelFlight();
        this.abort.abort();
        this.camera.getScene().onBeforeRenderObservable.remove(this.observer);
        this.destination?.dispose();
        this.onUserInputObservable.clear();
    }
    pose(view) {
        const m = this.globe.metresToWorld;
        if (!("range" in view)) {
            return { position: this.globe.getSurfacePosition(view.latitude, view.longitude, view.height * m), heading: view.heading, pitch: view.pitch };
        }
        const target = this.globe.getSurfacePosition(view.latitude, view.longitude, (view.height ?? 0) * m);
        const { forward } = frame(target, view.heading, view.pitch);
        const position = target.subtract(forward.scale(view.range * m));
        const look = target.subtract(position).normalize();
        const { heading, pitch } = angles(position, look);
        return { position, heading, pitch };
    }
    refreshGround() {
        this.groundAge = 0;
        if (!this.heightAt)
            return;
        const { latitude, longitude } = this.globe.getSurfaceCoordinates(this.position);
        this.groundHeight = this.heightAt(latitude, longitude) ?? this.groundHeight;
    }
    cancelFlight() {
        const flight = this.flight;
        this.flight = undefined;
        flight?.resolve(false);
    }
    userInput() {
        this.cancelFlight();
        this.onUserInputObservable.notifyObservers();
    }
    tick(seconds, now) {
        if (this.flight)
            this.fly(now);
        else if (this.keys.size && this.enabled)
            this.move(seconds);
        // Ground height beneath the camera, refreshed a few times a second.
        if (++this.groundAge > 6)
            this.refreshGround();
        this.apply();
    }
    /** Keep the camera above the ground and below the ceiling, then place it. */
    apply() {
        const m = this.globe.metresToWorld;
        const radius = this.position.length();
        const height = radius / m - this.globe.radius / m;
        const clamped = Math.min(this.maximumHeight, Math.max(this.groundHeight + this.minimumClearance, height));
        if (clamped !== height)
            this.position.scaleInPlace((this.globe.radius + clamped * m) / radius);
        this.camera.position.copyFrom(this.position);
        const { forward, up } = frame(this.position, this.heading, this.pitch);
        Quaternion.FromLookDirectionLHToRef(forward, up, this.camera.rotationQuaternion);
        if (!this.adaptiveClipping)
            return;
        const clip = this.clipping(this.position, this.groundHeight);
        this.camera.minZ = clip.near;
        this.camera.maxZ = clip.far;
    }
    /**
     * Near and far planes (world units) that follow the altitude: the depth
     * buffer's precision is spent on what can actually be seen.
     */
    clipping(position, groundHeight) {
        const m = this.globe.metresToWorld;
        const above = Math.max(1, position.length() / m - this.globe.radius / m - groundHeight);
        const near = Math.min(1000, Math.max(0.5, above * 0.02));
        const r = this.globe.radius / m, d = position.length() / m;
        const horizon = Math.sqrt(Math.max(0, d * d - r * r)) + Math.sqrt((r + 9000) ** 2 - r * r);
        return { near: near * m, far: Math.max(horizon, 50_000) * 1.05 * m };
    }
    fly(now) {
        const flight = this.flight;
        const t = Math.min(1, (now - flight.start) / flight.duration);
        const { from, to } = flight;
        // Overlapping phases: rise and tilt down, glide, drop and tilt up.
        const phase = (a, b) => smootherstep(Math.max(0, Math.min(1, (t - a) / (b - a))));
        const rise = phase(0, 0.45), glide = phase(0.2, 0.8), drop = phase(0.55, 1);
        const turn = phase(0.25, 0.75), tiltDown = phase(0, 0.4), tiltUp = phase(0.6, 1);
        const lerp = (a, b, e) => a + (b - a) * e;
        // Range in log space, so the climb and the fall feel even at every altitude.
        const range = Math.exp(lerp(lerp(Math.log(from.range), Math.log(flight.cruise), rise), Math.log(to.range), drop));
        const orbit = orbitAt(slerp(from.direction, to.direction, glide).scale(lerp(from.radius, to.radius, glide)), range, from.heading + shortest(to.heading - from.heading) * turn, lerp(lerp(from.pitch, flight.cruisePitch, tiltDown), to.pitch, tiltUp));
        this.position.copyFrom(t >= 1 ? flight.end.position : orbit.position);
        this.heading = t >= 1 ? flight.end.heading : orbit.heading;
        this.pitch = t >= 1 ? flight.end.pitch : orbit.pitch;
        if (t >= 1) {
            this.flight = undefined;
            flight.resolve(true);
        }
    }
    move(seconds) {
        const m = this.globe.metresToWorld;
        const above = Math.max(20, this.position.length() / m - this.globe.radius / m - this.groundHeight);
        const speed = above * 0.9 * (this.keys.has("Shift") ? 4 : 1) * seconds * m;
        const turn = 60 * seconds;
        const held = (...codes) => codes.some(code => this.keys.has(code));
        const up = this.position.normalizeToNew();
        const { forward: level, right } = frame(this.position, this.heading, 0);
        const shift = new Vector3();
        if (held("KeyW", "ArrowUp"))
            shift.addInPlace(level);
        if (held("KeyS", "ArrowDown"))
            shift.subtractInPlace(level);
        if (held("KeyD", "ArrowRight"))
            shift.addInPlace(right);
        if (held("KeyA", "ArrowLeft"))
            shift.subtractInPlace(right);
        if (held("KeyE", "PageUp"))
            shift.addInPlace(up);
        if (held("KeyQ", "PageDown"))
            shift.subtractInPlace(up);
        if (shift.lengthSquared() > 0) {
            shift.normalize().scaleInPlace(speed);
            if (above > GLOBE_VIEW_HEIGHT) {
                // From globe height, moving turns the globe beneath the camera.
                const climb = up.scale(Vector3.Dot(shift, up));
                this.rotateAboutCentre(this.position, this.position.add(shift.subtract(climb)));
                this.position.addInPlace(climb);
            }
            else
                this.translate(shift);
        }
        if (held("KeyI"))
            this.pitch = Math.min(89, this.pitch + turn);
        if (held("KeyK"))
            this.pitch = Math.max(-89, this.pitch - turn);
        if (held("KeyJ"))
            this.heading -= turn;
        if (held("KeyL"))
            this.heading += turn;
    }
    /** Move the camera, keeping its view direction fixed in space. */
    translate(shift) {
        const { forward } = frame(this.position, this.heading, this.pitch);
        this.position.addInPlace(shift);
        const look = angles(this.position, forward);
        this.heading = look.heading;
        this.pitch = look.pitch;
    }
    /** Rotate the camera about the globe's centre, carrying its orientation with it. */
    rotateAboutCentre(from, to) {
        const axis = Vector3.Cross(from, to);
        const sine = axis.length() / (from.length() * to.length());
        if (sine < 1e-12)
            return;
        const angle = Math.atan2(sine, Vector3.Dot(from, to) / (from.length() * to.length()));
        const rotation = Quaternion.RotationAxis(axis.normalize(), angle);
        const { forward } = frame(this.position, this.heading, this.pitch);
        this.position.rotateByQuaternionToRef(rotation, this.position);
        const look = angles(this.position, forward.rotateByQuaternionToRef(rotation, new Vector3()));
        this.heading = look.heading;
        this.pitch = look.pitch;
    }
    /** Where the ray through a canvas point meets the sphere of radius `radius`, if it does. */
    pick(x, y, radius) {
        const scene = this.camera.getScene();
        // Canvas CSS pixels; Babylon applies the hardware scaling itself.
        const ray = scene.createPickingRay(x, y, null, this.camera);
        const o = this.position, d = ray.direction;
        const b = Vector3.Dot(o, d), c = o.lengthSquared() - radius * radius;
        const disc = b * b - c;
        if (disc < 0)
            return undefined;
        const t = -b - Math.sqrt(disc);
        return t > 0 ? o.add(d.scale(t)) : undefined;
    }
    groundRadius() {
        return this.globe.radius + this.groundHeight * this.globe.metresToWorld;
    }
    attach() {
        const canvas = this.canvas;
        const options = { signal: this.abort.signal };
        canvas.tabIndex = 0;
        canvas.style.touchAction = "none";
        canvas.setAttribute("aria-label", `3D globe. ${GLOBE_CONTROLS_HELP}`);
        const point = (event) => {
            const rect = canvas.getBoundingClientRect();
            return { x: event.clientX - rect.left, y: event.clientY - rect.top };
        };
        canvas.addEventListener("contextmenu", event => event.preventDefault(), options);
        canvas.addEventListener("pointerdown", event => {
            if (!this.enabled)
                return;
            canvas.focus();
            canvas.setPointerCapture(event.pointerId);
            const p = point(event);
            this.pointers.set(event.pointerId, p);
            this.userInput();
            if (this.pointers.size === 2) {
                // Two fingers: pan with their midpoint, fly with their spread.
                const [a, b] = [...this.pointers.values()];
                this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
                const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                this.drag = { mode: "pan", ...mid, grab: this.pick(mid.x, mid.y, this.groundRadius()) };
                return;
            }
            // From globe height a plain drag spins the globe under the cursor.
            const pan = event.button === 1 || event.ctrlKey || event.button === 0 && this.heightAboveGround > GLOBE_VIEW_HEIGHT;
            this.drag = { mode: pan ? "pan" : "look", ...p, grab: pan ? this.pick(p.x, p.y, this.groundRadius()) : undefined };
            event.preventDefault();
        }, options);
        canvas.addEventListener("pointermove", event => {
            if (!this.pointers.has(event.pointerId) || !this.drag)
                return;
            this.pointers.set(event.pointerId, point(event));
            let p = point(event);
            if (this.pointers.size === 2) {
                const [a, b] = [...this.pointers.values()];
                const spread = Math.hypot(a.x - b.x, a.y - b.y);
                p = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                if (this.pinch)
                    this.flyToward(p.x, p.y, Math.log(spread / this.pinch) * 1.5);
                this.pinch = spread;
            }
            if (this.drag.mode === "look") {
                const sensitivity = 0.15;
                this.heading += (p.x - this.drag.x) * sensitivity;
                this.pitch = Math.max(-89, Math.min(89, this.pitch - (p.y - this.drag.y) * sensitivity));
            }
            else if (this.drag.grab) {
                const now = this.pick(p.x, p.y, this.drag.grab.length());
                if (now)
                    this.rotateAboutCentre(now, this.drag.grab);
            }
            this.drag.x = p.x;
            this.drag.y = p.y;
            this.userInput();
        }, options);
        const release = (event) => {
            this.pointers.delete(event.pointerId);
            this.pinch = undefined;
            if (this.pointers.size === 1) {
                const [p] = [...this.pointers.values()];
                this.drag = { mode: "look", ...p };
            }
            else if (!this.pointers.size)
                this.drag = undefined;
        };
        canvas.addEventListener("pointerup", release, options);
        canvas.addEventListener("pointercancel", release, options);
        canvas.addEventListener("wheel", event => {
            if (!this.enabled)
                return;
            event.preventDefault();
            this.userInput();
            const p = point(event);
            const lines = event.deltaMode === 1 ? event.deltaY * 33 : event.deltaMode === 2 ? event.deltaY * 400 : event.deltaY;
            this.flyToward(p.x, p.y, -lines / 400);
        }, { ...options, passive: false });
        canvas.addEventListener("keydown", event => {
            if (!this.enabled || event.metaKey || event.altKey || event.ctrlKey) {
                this.keys.clear();
                return;
            }
            if (event.key === "Escape") {
                this.keys.clear();
                canvas.blur();
                return;
            }
            const code = event.key === "Shift" ? "Shift" : event.code;
            if (/^(Key[WASDQEIJKL]|Arrow\w+|Page(Up|Down)|Shift)$/.test(code)) {
                this.keys.add(code);
                this.userInput();
                event.preventDefault();
            }
        }, options);
        canvas.addEventListener("keyup", event => this.keys.delete(event.key === "Shift" ? "Shift" : event.code), options);
        const clear = () => { this.keys.clear(); this.pointers.clear(); this.drag = undefined; };
        canvas.addEventListener("blur", clear, options);
        window.addEventListener("blur", clear, options);
    }
    /** Fly a fraction of the way to the ground point under the cursor (negative backs away). */
    flyToward(x, y, amount) {
        const m = this.globe.metresToWorld;
        const target = this.pick(x, y, this.groundRadius());
        const above = Math.max(this.minimumClearance, this.position.length() / m - this.globe.radius / m - this.groundHeight) * m;
        if (target && amount > 0) {
            const toward = target.subtract(this.position);
            const distance = toward.length();
            this.translate(toward.scale(Math.min(0.85, amount) * Math.min(1, Math.max(0, (distance - this.minimumClearance * m) / distance))));
            return;
        }
        // Back away along the view ray, or climb when it does not meet the ground.
        const scene = this.camera.getScene();
        const ray = scene.createPickingRay(x, y, null, this.camera);
        const step = Math.abs(amount) * Math.max(above, 50 * m) * 1.5;
        if (amount > 0)
            this.translate(ray.direction.scale(step));
        else
            this.translate(target ? ray.direction.scale(-step) : this.position.normalizeToNew().scale(step));
    }
}
/** Camera axes at `position` for a heading and pitch in degrees. */
/** Metres above the ground from which drags and movement turn the globe instead of the camera. */
const GLOBE_VIEW_HEIGHT = 250_000;
function frame(position, heading, pitch) {
    const up = position.normalizeToNew();
    let east = Vector3.Cross(up, Vector3.Up());
    if (east.lengthSquared() < 1e-12)
        east = new Vector3(-1, 0, 0);
    east.normalize();
    // Babylon is left-handed: right x up = forward.
    const north = Vector3.Cross(east, up);
    const h = heading * DEGREES, p = pitch * DEGREES;
    const level = north.scale(Math.cos(h)).addInPlace(east.scale(Math.sin(h)));
    const right = Vector3.Cross(up, level);
    const forward = level.scale(Math.cos(p)).addInPlace(up.scale(Math.sin(p)));
    const cameraUp = up.scale(Math.cos(p)).subtractInPlace(level.scale(Math.sin(p)));
    return { forward, up: cameraUp, right };
}
/** Heading and pitch of a world direction seen from `position`. */
function angles(position, direction) {
    const up = position.normalizeToNew();
    let east = Vector3.Cross(up, Vector3.Up());
    if (east.lengthSquared() < 1e-12)
        east = new Vector3(-1, 0, 0);
    east.normalize();
    const north = Vector3.Cross(east, up);
    const d = direction.normalizeToNew();
    return {
        heading: Math.atan2(Vector3.Dot(d, east), Vector3.Dot(d, north)) / DEGREES,
        pitch: Math.asin(Math.max(-1, Math.min(1, Vector3.Dot(d, up)))) / DEGREES,
    };
}
/** The pose looking at `target` from `range` away, along `heading` and `pitch` measured at the target. */
function orbitAt(target, range, heading, pitch) {
    const { forward } = frame(target, heading, pitch);
    const position = target.subtract(forward.scale(range));
    const look = angles(position, forward);
    return { position, heading: look.heading, pitch: look.pitch, direction: target.normalizeToNew(), radius: target.length(), range };
}
function smoothstep(a, b, x) {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
}
function smootherstep(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
}
function slerp(a, b, t) {
    const cos = Math.max(-1, Math.min(1, Vector3.Dot(a, b)));
    const angle = Math.acos(cos);
    if (angle < 1e-9)
        return a.clone();
    const s = Math.sin(angle);
    return a.scale(Math.sin((1 - t) * angle) / s).addInPlace(b.scale(Math.sin(t * angle) / s));
}
function shortest(degrees) {
    return ((degrees % 360) + 540) % 360 - 180;
}
//# sourceMappingURL=GlobeControls.js.map