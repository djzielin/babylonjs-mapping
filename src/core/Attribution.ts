import { MAPBOX_LOGO } from "./MapboxLogo.js";
import { Scene } from "@babylonjs/core/scene.js";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/index.js";
import { Button, Control, StackPanel, TextBlock } from "@babylonjs/gui/2D/controls/index.js";

export default class Attribution {
    private texture?: AdvancedDynamicTexture;
    /** Explicit access creates a deferred GUI and replays its stored credits. */
    public get advancedTexture(): AdvancedDynamicTexture {
        if (!this.texture) this.createGUI();
        return this.texture!;
    }
    public set advancedTexture(texture: AdvancedDynamicTexture) {
        if (this.texture) this.texture = texture;
        else this.createGUI(texture);
    }

    private buttonGoogle: Button;
    private googleDataAttribution: TextBlock;
    private readonly attributionList = new Set<string>();
    private readonly displayProviders = new Set<string>();
    private googleAttributions?: readonly string[];
    private ourRightPanel: StackPanel;
    private ourLeftPanel: StackPanel;
    
    constructor(private readonly scene: Scene, private readonly deferred = false) {
        if (!deferred) this.createGUI();
    }

    private createGUI(suppliedTexture?: AdvancedDynamicTexture): void {
        this.texture = suppliedTexture ?? AdvancedDynamicTexture.CreateFullscreenUI("UI", true, this.scene);
        if (!suppliedTexture && this.deferred && this.texture.layer) this.texture.layer.isEnabled = false;

        this.ourRightPanel = new StackPanel("attribution right panel");
        this.ourRightPanel.height = "25px";
        this.ourRightPanel.isVertical = false;
        this.ourRightPanel.paddingTopInPixels=3;
        this.ourRightPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.ourRightPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.texture.addControl(this.ourRightPanel);

        this.ourLeftPanel = new StackPanel("attribution left panel");
        this.ourLeftPanel.height = "25px";
        this.ourLeftPanel.isVertical = false;
        this.ourLeftPanel.paddingTopInPixels=3;
        this.ourLeftPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.ourLeftPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.texture.addControl(this.ourLeftPanel);
        for (const provider of this.displayProviders) this.displayAttribution(provider);
        if (this.googleAttributions) this.displayGoogleAttributions(this.googleAttributions);
    }

    public addAttribution(provider: string): void {
        if (this.attributionList.has(provider)) return;
        this.attributionList.add(provider);

        if (provider === "MB") {
            this.addAttribution("OSM");
            this.addAttribution("MBMODEL");
            return;
        }
        if (provider === "OVERTURE") this.addAttribution("OSM");
        this.displayProviders.add(provider);
        if (this.texture) this.displayAttribution(provider);
    }

    private displayAttribution(provider: string): void {
        switch (provider) {
            case "GOOGLE":
                this.addAttributionGoogle();
                break;
            case "MBMODEL":
                this.addLink("button_mb", "© Mapbox", 65, "https://www.mapbox.com/about/maps/");
                this.addLink("button_improve", "Improve this map", 100, "https://www.mapbox.com/map-feedback/");
                this.addMapboxLogo();
                break;
            case "OSM":
                this.addLink("button_osm", "© OpenStreetMap contributors", 175, "https://www.openstreetmap.org/copyright");
                break;
            case "OSMB":
                this.addLink("button_osmb", "© OSM Buildings", 100, "https://osmbuildings.org/copyright/");
                break;
            case "OVERTURE":
                this.addLink("button_overture", "© Overture Maps", 105, "https://docs.overturemaps.org/attribution/");
                break;
            case "GEBCO":
                this.addLink("button_gebco", "© GEBCO", 70, "https://www.gebco.net/data-products/gebco-web-services/web-map-service");
                break;
        }
    }

    /** Updates the sorted data credits returned by Google's 3D Tiles. */
    public setGoogleAttributions(attributions: readonly string[]): void {
        this.googleAttributions = [...attributions];
        if (this.texture) this.displayGoogleAttributions(this.googleAttributions);
    }

    private displayGoogleAttributions(attributions: readonly string[]): void {
        if (!this.googleDataAttribution) {
            this.googleDataAttribution = new TextBlock("google data attribution");
            this.googleDataAttribution.width = "100%";
            this.googleDataAttribution.paddingLeft = "12px";
            this.googleDataAttribution.paddingRight = "12px";
            this.googleDataAttribution.textWrapping = true;
            this.googleDataAttribution.resizeToFit = true;
            this.googleDataAttribution.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
            this.googleDataAttribution.top = "-28px";
            this.googleDataAttribution.outlineWidth = 3;
            this.googleDataAttribution.outlineColor = "#07101c";
            this.googleDataAttribution.height = "25px";
            this.googleDataAttribution.color = "white";
            this.googleDataAttribution.alpha = 0.9;
            this.googleDataAttribution.fontSize = "11px";
            this.googleDataAttribution.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            this.googleDataAttribution.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
            this.texture!.addControl(this.googleDataAttribution);
        }
        this.googleDataAttribution.text = attributions.length > 0
            ? attributions.join("; ")
            : "";
    }
    
    private addAttributionGoogle() {
        if (this.buttonGoogle) return;
        this.buttonGoogle = Button.CreateSimpleButton("button_google", "Google Maps");
        this.buttonGoogle.width = "100px";
        this.buttonGoogle.height = "25px";
        this.buttonGoogle.color = "white";
        this.buttonGoogle.alpha = 0.9;
        this.buttonGoogle.thickness = 0;
        this.buttonGoogle.fontSize = "16px";
        this.buttonGoogle.fontFamily = "Arial, sans-serif";
        this.buttonGoogle.background = "";
        this.buttonGoogle.onPointerUpObservable.add(function () {
            window.open("https://developers.google.com/maps/documentation/tile/policies");
        });

        this.ourRightPanel.addControl(this.buttonGoogle);
    }


    private addLink(name: string, label: string, width: number, url: string): void {
        const button = Button.CreateSimpleButton(name, label);
        button.width = `${width}px`;
        button.height = "25px";
        button.color = "white";
        if (button.textBlock) {
            button.textBlock.outlineWidth = 3;
            button.textBlock.outlineColor = "#07101c";
        }
        button.alpha = 0.75;
        button.thickness = 0;
        button.fontSize = "12px";
        button.background = "";
        button.onPointerUpObservable.add(() => window.open(url, "_blank", "noopener,noreferrer"));
        this.ourRightPanel.addControl(button);
    }

    private addMapboxLogo(): void {
        const logo = Button.CreateImageOnlyButton("button_logo", MAPBOX_LOGO);
        logo.width = "99px";
        logo.height = "30px";
        logo.paddingBottom = logo.paddingTop = logo.paddingLeft = logo.paddingRight = "5px";
        logo.background = "";
        logo.alpha = 0.75;
        logo.thickness = 0;
        logo.onPointerUpObservable.add(() => window.open("https://www.mapbox.com/about/maps/", "_blank", "noopener,noreferrer"));
        this.ourLeftPanel.addControl(logo);
    }
}
