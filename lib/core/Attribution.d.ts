import { Scene } from "@babylonjs/core/scene.js";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/index.js";
export default class Attribution {
    advancedTexture: AdvancedDynamicTexture;
    private readonly attributionList;
    private ourRightPanel;
    private ourLeftPanel;
    constructor(scene: Scene);
    addAttribution(provider: string): void;
    private addLink;
    private addMapboxLogo;
}
