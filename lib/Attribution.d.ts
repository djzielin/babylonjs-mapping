import { Scene } from "@babylonjs/core/scene";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/";
export default class Attribution {
    private scene;
    advancedTexture: AdvancedDynamicTexture;
    private buttonOSM;
    private buttonMB;
    private buttonMBLogo;
    private buttonImprov;
    private buttonOSMBuildings;
    private attributionList;
    private ourRightPanel;
    private ourLeftPanel;
    constructor(scene: Scene);
    addAttribution(provider: string): void;
    private addAttributionOSM;
    private addAttributionOSMBuildings;
    private addAttributionMapbox;
}
