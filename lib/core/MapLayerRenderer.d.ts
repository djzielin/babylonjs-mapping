import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
export interface MapLayerRendererOptions {
    /** Use the same long-range depth encoding for terrain and all building materials. */
    logarithmicDepth?: boolean;
}
/** Finer map coverage replaces coarse coverage, with one shared depth buffer. */
export default class MapLayerRenderer {
    private scene;
    private maximumLevel;
    private options;
    private meshes;
    private observer;
    private dirty;
    private detach;
    constructor(scene: Scene, maximumLevel?: number, options?: MapLayerRendererOptions);
    add(mesh: AbstractMesh, level: number): void;
    private configure;
    private configureMaterial;
    dispose(): void;
}
