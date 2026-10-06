/** Proves that the existing coastal repair cannot discard a triangle. */
export function safeToSkipGoogleCoastalRepair(positions, matrix, metresToWorld, globeRadius) {
    if (!Number.isInteger(positions.length) || positions.length < 9 || positions.length % 3 || matrix.length !== 16
        || !Number.isFinite(metresToWorld) || metresToWorld <= 0
        || globeRadius !== undefined && (!Number.isFinite(globeRadius) || globeRadius < 0))
        return false;
    for (let index = 0; index < 16; index++)
        if (!Number.isFinite(matrix[index]))
            return false;
    if (matrix[3] !== 0 || matrix[7] !== 0 || matrix[11] !== 0 || matrix[15] !== 1)
        return false;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let index = 0; index < positions.length; index += 3) {
        const x = positions[index], y = positions[index + 1], z = positions[index + 2];
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
            return false;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
    }
    const lengthX = Math.hypot(matrix[0], matrix[1], matrix[2]);
    const lengthY = Math.hypot(matrix[4], matrix[5], matrix[6]);
    const lengthZ = Math.hypot(matrix[8], matrix[9], matrix[10]);
    if (!Number.isFinite(lengthX + lengthY + lengthZ) || !lengthX || !lengthY || !lengthZ)
        return false;
    const ux = matrix[0] / lengthX, uy = matrix[1] / lengthX, uz = matrix[2] / lengthX;
    const vx = matrix[4] / lengthY, vy = matrix[5] / lengthY, vz = matrix[6] / lengthY;
    const wx = matrix[8] / lengthZ, wy = matrix[9] / lengthZ, wz = matrix[10] / lengthZ;
    const uv = Math.abs(ux * vx + uy * vy + uz * vz);
    const uw = Math.abs(ux * wx + uy * wy + uz * wz);
    const vw = Math.abs(vx * wx + vy * wy + vz * wz);
    // Only floating-point drift from an orthogonal transform is accepted.
    // The projection bounds below still account for that residual drift.
    if (Math.max(uv, uw, vw) > 1e-10)
        return false;
    const absX = Math.max(Math.abs(minX), Math.abs(maxX));
    const absY = Math.max(Math.abs(minY), Math.abs(maxY));
    const absZ = Math.max(Math.abs(minZ), Math.abs(maxZ));
    let arithmeticScale = Math.abs(globeRadius ?? 0) + 1;
    for (let axis = 0; axis < 3; axis++)
        arithmeticScale += Math.abs(matrix[12 + axis])
            + absX * Math.abs(matrix[axis]) + absY * Math.abs(matrix[4 + axis]) + absZ * Math.abs(matrix[8 + axis]);
    if (!Number.isFinite(arithmeticScale))
        return false;
    const margin = 128 * Number.EPSILON * arithmeticScale;
    let lower, upper;
    if (globeRadius === undefined) {
        lower = matrix[13] + Math.min(minX * matrix[1], maxX * matrix[1])
            + Math.min(minY * matrix[5], maxY * matrix[5]) + Math.min(minZ * matrix[9], maxZ * matrix[9]);
        upper = matrix[13] + Math.max(minX * matrix[1], maxX * matrix[1])
            + Math.max(minY * matrix[5], maxY * matrix[5]) + Math.max(minZ * matrix[9], maxZ * matrix[9]);
    }
    else {
        const centerX = minX / 2 + maxX / 2, centerY = minY / 2 + maxY / 2, centerZ = minZ / 2 + maxZ / 2;
        const x = centerX * matrix[0] + centerY * matrix[4] + centerZ * matrix[8] + matrix[12];
        const y = centerX * matrix[1] + centerY * matrix[5] + centerZ * matrix[9] + matrix[13];
        const z = centerX * matrix[2] + centerY * matrix[6] + centerZ * matrix[10] + matrix[14];
        const halfX = (maxX / 2 - minX / 2) * lengthX;
        const halfY = (maxY / 2 - minY / 2) * lengthY;
        const halfZ = (maxZ / 2 - minZ / 2) * lengthZ;
        const closestX = Math.max(0, Math.abs(x * ux + y * uy + z * uz) - halfX - uv * halfY - uw * halfZ);
        const closestY = Math.max(0, Math.abs(x * vx + y * vy + z * vz) - halfY - uv * halfX - vw * halfZ);
        const closestZ = Math.max(0, Math.abs(x * wx + y * wy + z * wz) - halfZ - uw * halfX - vw * halfY);
        // Residual non-orthogonality bounds the projection matrix's largest
        // eigenvalue. This keeps the closest-point estimate a lower bound.
        const projectionScale = Math.sqrt(1 + Math.max(uv + uw, uv + vw, uw + vw));
        lower = Math.hypot(closestX, closestY, closestZ) / projectionScale - globeRadius;
        upper = -Infinity;
        for (const localX of [minX, maxX])
            for (const localY of [minY, maxY])
                for (const localZ of [minZ, maxZ]) {
                    const cornerX = localX * matrix[0] + localY * matrix[4] + localZ * matrix[8] + matrix[12];
                    const cornerY = localX * matrix[1] + localY * matrix[5] + localZ * matrix[9] + matrix[13];
                    const cornerZ = localX * matrix[2] + localY * matrix[6] + localZ * matrix[10] + matrix[14];
                    upper = Math.max(upper, Math.hypot(cornerX, cornerY, cornerZ) - globeRadius);
                }
    }
    // The repair stores each measured height in Float32 before finding its
    // lower fifth and cutoff. Monotone rounding preserves these widened bounds.
    const minimumStored = Math.fround((lower - margin) / metresToWorld);
    const maximumStored = Math.fround((upper + margin) / metresToWorld);
    if (!Number.isFinite(minimumStored) || !Number.isFinite(maximumStored) || minimumStored > maximumStored)
        return false;
    return minimumStored >= 5 || maximumStored < -15 || maximumStored - minimumStored <= 25;
}
//# sourceMappingURL=GoogleCoastalBounds.js.map