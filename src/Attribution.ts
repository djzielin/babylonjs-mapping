import { Scene } from "@babylonjs/core/scene";
import { Engine, EngineStore, FloatArray, Observable, ThinEngine, VertexBuffer } from "@babylonjs/core";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/";
import { Button } from "@babylonjs/gui/2D/controls";
import { Control } from "@babylonjs/gui/2D/controls"; 

export default class Attribution {
    private currentProvider: string = "";
    public advancedTexture: AdvancedDynamicTexture;
    private buttonOSM: Button;
    private buttonMB: Button;
    private buttonMBLogo: Button;
    private buttonImprov: Button;

    constructor(private scene: Scene) {
        this.advancedTexture = AdvancedDynamicTexture.CreateFullscreenUI("UI");
    }

    public showAttribution(provider: string) {
        if (provider == this.currentProvider) { //already setup, no need to go further
            return;
        }

        if (provider != this.currentProvider) {
            if (this.currentProvider == "OSM") {
                this.removeAttributionOSM();
            }
            if (this.currentProvider == "MB") {
                this.removeAttributionMapbox();
            }
        }

        console.log("scene is ready, so lets setup the attribution!");
      
        if (provider == "MB") {
            this.showAttributionMapbox();
        }

        if (provider == "OSM") {
            this.showAttributionOSM();
        }

        this.currentProvider = provider;   
    }
    
    private showAttributionOSM() {
        this.buttonOSM = Button.CreateSimpleButton("button_osm", "© OpenStreetMap contributors");
        this.buttonOSM.width = "175px";
        this.buttonOSM.height = "25px";
        this.buttonOSM.color = "blue";
        this.buttonOSM.alpha = 0.75;
        this.buttonOSM.thickness = 0;
        this.buttonOSM.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.buttonOSM.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.buttonOSM.fontSize = "12px";
        this.buttonOSM.background = "white";
        this.buttonOSM.onPointerUpObservable.add(function () {
            window.open("https://www.openstreetmap.org/copyright");
        });

        this.advancedTexture.addControl(this.buttonOSM);
    }

    private removeAttributionOSM() {
        this.advancedTexture.removeControl(this.buttonOSM);
    }

    /* 
       https://docs.mapbox.com/help/getting-started/attribution/
    */
    private showAttributionMapbox() {
        this.buttonMB = Button.CreateSimpleButton("button_mb", "© Mapbox");
        this.buttonMB.width = "65px";
        this.buttonMB.left = "-200px";
        this.buttonMB.height = "25px";
        this.buttonMB.color = "blue";
        this.buttonMB.alpha = 0.75;
        this.buttonMB.thickness = 0;
        this.buttonMB.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.buttonMB.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.buttonMB.fontSize = "12px";
        this.buttonMB.background = "";
        this.buttonMB.onPointerUpObservable.add(function () {
            window.open("https://www.mapbox.com/about/maps/");
        });

        this.buttonOSM = Button.CreateSimpleButton("button_osm", "© OpenStreetMap");
        this.buttonOSM.width = "100px";
        this.buttonOSM.left = "-100px";
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

        this.buttonImprov = Button.CreateSimpleButton("button_improve", "Improve this map");
        this.buttonImprov.width = "100px";
        this.buttonImprov.height = "25px";
        this.buttonImprov.color = "blue";
        this.buttonImprov.alpha = 0.75;
        this.buttonImprov.thickness = 0;
        this.buttonImprov.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.buttonImprov.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
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
        this.buttonMBLogo.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.buttonMBLogo.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.buttonMBLogo.fontSize = "12px";
        this.buttonMBLogo.onPointerUpObservable.add(function () {
            window.open("https://www.mapbox.com/about/maps/");
        });

        this.advancedTexture.addControl(this.buttonOSM);
        this.advancedTexture.addControl(this.buttonMB);
        this.advancedTexture.addControl(this.buttonImprov);
        this.advancedTexture.addControl(this.buttonMBLogo);
    }

    private removeAttributionMapbox() {
        this.advancedTexture.removeControl(this.buttonOSM);
        this.advancedTexture.removeControl(this.buttonMB);
        this.advancedTexture.removeControl(this.buttonImprov);
        this.advancedTexture.removeControl(this.buttonMBLogo);
    }

}