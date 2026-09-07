import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/index.js";
import { Button, Control, StackPanel } from "@babylonjs/gui/2D/controls/index.js";
export default class Attribution {
    constructor(scene) {
        this.attributionList = new Set();
        this.advancedTexture = AdvancedDynamicTexture.CreateFullscreenUI("UI", true, scene);
        this.ourRightPanel = new StackPanel("attribution right panel");
        this.ourRightPanel.height = "25px";
        this.ourRightPanel.isVertical = false;
        this.ourRightPanel.paddingTopInPixels = 3;
        this.ourRightPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.ourRightPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.advancedTexture.addControl(this.ourRightPanel);
        this.ourLeftPanel = new StackPanel("attribution left panel");
        this.ourLeftPanel.height = "25px";
        this.ourLeftPanel.isVertical = false;
        this.ourLeftPanel.paddingTopInPixels = 3;
        this.ourLeftPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.ourLeftPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.advancedTexture.addControl(this.ourLeftPanel);
    }
    addAttribution(provider) {
        if (this.attributionList.has(provider))
            return;
        this.attributionList.add(provider);
        switch (provider) {
            case "MB":
                this.addAttribution("OSM");
                this.addAttribution("MBMODEL");
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
                this.addAttribution("OSM");
                this.addLink("button_overture", "© Overture Maps", 105, "https://docs.overturemaps.org/attribution/");
                break;
            case "GEBCO":
                this.addLink("button_gebco", "© GEBCO", 70, "https://www.gebco.net/data-products/gebco-web-services/web-map-service");
                break;
        }
    }
    addLink(name, label, width, url) {
        const button = Button.CreateSimpleButton(name, label);
        button.width = `${width}px`;
        button.height = "25px";
        button.color = "blue";
        button.alpha = 0.75;
        button.thickness = 0;
        button.fontSize = "12px";
        button.background = "";
        button.onPointerUpObservable.add(() => window.open(url, "_blank", "noopener,noreferrer"));
        this.ourRightPanel.addControl(button);
    }
    addMapboxLogo() {
        const logo = Button.CreateImageOnlyButton("button_logo", "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Mapbox_logo_2019.svg/320px-Mapbox_logo_2019.svg.png");
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
//# sourceMappingURL=Attribution.js.map