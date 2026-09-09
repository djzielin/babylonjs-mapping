import { Scene } from "@babylonjs/core/scene.js";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/index.js";
export default class Attribution {
    advancedTexture: AdvancedDynamicTexture;
    private buttonGoogle;
    private googleDataAttribution;
    private readonly attributionList;
    private ourRightPanel;
    private ourLeftPanel;
    constructor(scene: Scene);
    addAttribution(provider: string): void;
    /** Updates the sorted data credits returned by Google's 3D Tiles. */
    setGoogleAttributions(attributions: readonly string[]): void;
    private addAttributionGoogle;
    private addLink;
    private addMapboxLogo;
}
