import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { Scene } from "@babylonjs/core/scene.js";
/** Finer map coverage replaces coarse coverage, with one shared depth buffer. */
export default class MapLayerRenderer {
    private scene;
    private maximumLevel;
    private meshes;
    private observer;
    constructor(scene: Scene, maximumLevel?: number);
    add(mesh: AbstractMesh, level: number): void;
    private configure;
    dispose(): void;
}
