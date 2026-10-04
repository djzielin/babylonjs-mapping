import { describe, expect, it, vi } from "vitest";
import { AssetContainer, NullEngine, Scene, Vector2 } from "@babylonjs/core";
import Google3DTiles from "../src/Google3DTiles";
import TileSet from "../src/TileSet";
import { googleTilesOptions } from "../examples-npm/google-3d-tiles/src/GoogleTilesOptions";

vi.mock("../src/core/Attribution", () => ({
    default: class {
        public addAttribution = vi.fn();
        public setGoogleAttributions = vi.fn();
    },
}));

describe("standalone Google demo refinement", () => {
    it.each([false, true])("preserves overview coverage until all detail succeeds (failure: %s)", async fail => {
        const engine = new NullEngine();
        const scene = new Scene(engine);
        const tileSet = new TileSet(scene, engine);
        tileSet.createGeometry(new Vector2(1, 1), 100, 1);
        tileSet.updateRaster(0, 0, 2);
        let release!: () => void;
        let signalFast!: () => void;
        const paused = new Promise<void>(resolve => { release = resolve; });
        const fastFinished = new Promise<void>(resolve => { signalFast = resolve; });
        const provider = new Google3DTiles(tileSet, {
            ...googleTilesOptions("test", 0),
            tilesetLoader: async () => ({ root: {
                content: { uri: "overview.glb" }, children: [
                    { content: { uri: "fast.glb" } }, { content: { uri: "slow.glb" } },
                ],
            } }),
            modelTileLoader: async url => {
                if (url.includes("slow.glb")) {
                    await paused;
                    if (fail) throw new Error("Detail download failed");
                }
                if (url.includes("fast.glb")) signalFast();
                return { asset: new AssetContainer(scene), attributions: [] };
            },
        });
        try {
            const [overview] = await provider.load();
            provider.maxDepth = 32;
            const refining = provider.load();
            await fastFinished;
            // Allow the fast child to finish the async publication path.
            await new Promise(resolve => setTimeout(resolve, 0));
            try {
                expect(overview.root.isEnabled()).toBe(true);
                expect(provider.loadedModelTiles.map(tile => tile.url)).toEqual([overview.url]);
            } finally {
                release();
                await refining;
            }
            expect(overview.root.isEnabled()).toBe(fail);
            expect(provider.loadedModelTiles).toHaveLength(fail ? 1 : 2);
        } finally {
            release();
            provider.dispose();
            scene.dispose();
            engine.dispose();
        }
    });
});
