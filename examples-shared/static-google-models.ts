interface StaticTransform {
    computeWorldMatrix(force?: boolean): unknown;
    freezeWorldMatrix(): unknown;
}

interface StaticMesh extends StaticTransform {
    material: { freeze(): void } | null;
    cullingStrategy: number;
}

interface StaticGoogleModel {
    root: StaticTransform;
    asset: { meshes: readonly StaticMesh[] };
}

export function optimizeStaticGoogleModels(models: readonly StaticGoogleModel[]): void {
    for (const model of models) {
        model.root.computeWorldMatrix(true);
        model.root.freezeWorldMatrix();
        for (const mesh of model.asset.meshes) {
            mesh.computeWorldMatrix(true);
            mesh.freezeWorldMatrix();
            mesh.material?.freeze();
            // Babylon's enclosing-sphere strategy is conservative: it can retain
            // extra offscreen geometry but never discard geometry inside the view.
            mesh.cullingStrategy = 1; // CULLINGSTRATEGY_BOUNDINGSPHERE_ONLY
        }
    }
}
