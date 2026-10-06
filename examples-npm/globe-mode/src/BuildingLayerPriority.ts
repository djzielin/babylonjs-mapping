// Leave a rendering group between current building tiers for retained detail.
// A ready finer tier owns its pixels even where a coarse extrusion is taller.
export const MAP_MAX_LEVEL = 20;
export const MODEL_LEVEL = 18;
export function buildingLayerLevel(zoom: number): number {
    return 8 + 2 * (Math.max(10, Math.min(14, Math.floor(zoom))) - 10);
}
