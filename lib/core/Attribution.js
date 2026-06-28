import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/";
import { Button } from "@babylonjs/gui/2D/controls";
import { Control } from "@babylonjs/gui/2D/controls";
import { StackPanel } from "@babylonjs/gui/2D/controls";
export default class Attribution {
    constructor(scene) {
        this.scene = scene;
        this.attributionList = [];
        this.advancedTexture = AdvancedDynamicTexture.CreateFullscreenUI("UI");
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
        //TODO: rewrite this as apparently includes is not in ES2015
        /*if(this.attributionList.includes(provider)){
            return; //we already contain this provider
        }*/
        if (provider == "MB") {
            this.addAttributionOSM();
            this.attributionList.push("OSM");
            this.addAttributionMapbox();
        }
        if (provider == "OSM") {
            this.addAttributionOSM();
        }
        if (provider == "OSMB") {
            this.addAttributionOSMBuildings();
        }
        this.attributionList.push(provider);
    }
    addAttributionOSM() {
        this.buttonOSM = Button.CreateSimpleButton("button_osm", "© OpenStreetMap contributors");
        this.buttonOSM.width = "175px";
        this.buttonOSM.height = "25px";
        this.buttonOSM.color = "blue";
        this.buttonOSM.alpha = 0.75;
        this.buttonOSM.thickness = 0;
        this.buttonOSM.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.buttonOSM.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.buttonOSM.fontSize = "12px";
        this.buttonOSM.background = "";
        this.buttonOSM.onPointerUpObservable.add(function () {
            window.open("https://www.openstreetmap.org/copyright");
        });
        this.ourRightPanel.addControl(this.buttonOSM);
    }
    addAttributionOSMBuildings() {
        this.buttonOSMBuildings = Button.CreateSimpleButton("button_osm", "© OSM Buildings");
        this.buttonOSMBuildings.width = "100px";
        this.buttonOSMBuildings.height = "25px";
        this.buttonOSMBuildings.color = "blue";
        this.buttonOSMBuildings.alpha = 0.75;
        this.buttonOSMBuildings.thickness = 0;
        this.buttonOSMBuildings.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.buttonOSMBuildings.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.buttonOSMBuildings.fontSize = "12px";
        this.buttonOSMBuildings.background = "";
        this.buttonOSMBuildings.onPointerUpObservable.add(function () {
            window.open("https://osmbuildings.org/copyright/");
        });
        this.ourRightPanel.addControl(this.buttonOSMBuildings);
    }
    /*
       https://docs.mapbox.com/help/getting-started/attribution/
    */
    addAttributionMapbox() {
        this.buttonMB = Button.CreateSimpleButton("button_mb", "© Mapbox");
        this.buttonMB.width = "65px";
        //this.buttonMB.left = "-200px";
        this.buttonMB.height = "25px";
        this.buttonMB.color = "blue";
        this.buttonMB.alpha = 0.75;
        this.buttonMB.thickness = 0;
        //this.buttonMB.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        //this.buttonMB.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.buttonMB.fontSize = "12px";
        this.buttonMB.background = "";
        this.buttonMB.onPointerUpObservable.add(function () {
            window.open("https://www.mapbox.com/about/maps/");
        });
        this.buttonImprov = Button.CreateSimpleButton("button_improve", "Improve this map");
        this.buttonImprov.width = "100px";
        this.buttonImprov.height = "25px";
        this.buttonImprov.color = "blue";
        this.buttonImprov.alpha = 0.75;
        this.buttonImprov.thickness = 0;
        //this.buttonImprov.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        //this.buttonImprov.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.buttonImprov.fontSize = "12px";
        this.buttonImprov.background = "";
        this.buttonImprov.onPointerUpObservable.add(function () {
            window.open("https://www.mapbox.com/map-feedback/");
        });
        //logo via https://commons.wikimedia.org/wiki/File:Mapbox_logo_2019.svg
        this.buttonMBLogo = Button.CreateImageOnlyButton("button_logo", "https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Mapbox_logo_2019.svg/320px-Mapbox_logo_2019.svg.png");
        this.buttonMBLogo.width = "99px";
        this.buttonMBLogo.height = "30px";
        this.buttonMBLogo.paddingBottom = "5px";
        this.buttonMBLogo.paddingTop = "5px";
        this.buttonMBLogo.paddingLeft = "5px";
        this.buttonMBLogo.paddingRight = "5px";
        this.buttonMBLogo.background = "";
        this.buttonMBLogo.alpha = 0.75;
        this.buttonMBLogo.thickness = 0;
        //this.buttonMBLogo.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        //this.buttonMBLogo.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.buttonMBLogo.fontSize = "12px";
        this.buttonMBLogo.onPointerUpObservable.add(function () {
            window.open("https://www.mapbox.com/about/maps/");
        });
        this.ourRightPanel.addControl(this.buttonMB);
        this.ourRightPanel.addControl(this.buttonImprov);
        this.ourLeftPanel.addControl(this.buttonMBLogo);
    }
}
//# sourceMappingURL=Attribution.js.map