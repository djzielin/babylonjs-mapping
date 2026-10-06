import { Scene } from "@babylonjs/core/scene.js";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/index.js";
export default class Attribution {
    private readonly scene;
    private readonly deferred;
    private texture?;
    /** Explicit access creates a deferred GUI and replays its stored credits. */
    get advancedTexture(): AdvancedDynamicTexture;
    set advancedTexture(texture: AdvancedDynamicTexture);
    private buttonGoogle;
    private googleDataAttribution;
    private readonly attributionList;
    private readonly displayProviders;
    private googleAttributions?;
    private ourRightPanel;
    private ourLeftPanel;
    constructor(scene: Scene, deferred?: boolean);
    private createGUI;
    addAttribution(provider: string): void;
    private displayAttribution;
    /** Updates the sorted data credits returned by Google's 3D Tiles. */
    setGoogleAttributions(attributions: readonly string[]): void;
    private displayGoogleAttributions;
    private addAttributionGoogle;
    private addLink;
    private addMapboxLogo;
}
