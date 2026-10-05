export type TrafficIconKind = "aircraft" | "ship";

/** Draws a small, transparent map symbol into a Babylon DynamicTexture canvas. */
export function drawTrafficIcon(context: CanvasRenderingContext2D, kind: TrafficIconKind): void {
    const color = kind === "aircraft" ? "#8ee4ff" : "#ceb2ff";
    context.clearRect(0, 0, 128, 128);
    context.save();
    context.translate(64, 64);
    context.fillStyle = color;
    context.strokeStyle = "#123445";
    context.lineWidth = 3;
    context.lineJoin = "round";
    context.beginPath();
    if (kind === "aircraft") {
        context.moveTo(0, -43);
        context.lineTo(8, -10);
        context.lineTo(40, 11);
        context.lineTo(40, 18);
        context.lineTo(8, 9);
        context.lineTo(6, 34);
        context.lineTo(18, 42);
        context.lineTo(18, 46);
        context.lineTo(0, 40);
        context.lineTo(-18, 46);
        context.lineTo(-18, 42);
        context.lineTo(-6, 34);
        context.lineTo(-8, 9);
        context.lineTo(-40, 18);
        context.lineTo(-40, 11);
        context.lineTo(-8, -10);
    } else {
        context.moveTo(0, -40);
        context.lineTo(24, -12);
        context.lineTo(19, 26);
        context.quadraticCurveTo(0, 42, -19, 26);
        context.lineTo(-24, -12);
    }
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
}

/** A short geographic point behind a moving vehicle's reported heading. */
export function trailingPoint(latitude: number, longitude: number, heading: number, distanceDegrees: number): { latitude: number; longitude: number } {
    const angle = heading * Math.PI / 180;
    return {
        latitude: latitude - Math.cos(angle) * distanceDegrees,
        longitude: longitude - Math.sin(angle) * distanceDegrees / Math.cos(latitude * Math.PI / 180),
    };
}
