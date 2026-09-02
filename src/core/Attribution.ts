import { Scene } from "@babylonjs/core/scene.js";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/index.js";
import { Button, Control, Rectangle, StackPanel, TextBlock } from "@babylonjs/gui/2D/controls/index.js";

export default class Attribution {
     public advancedTexture: AdvancedDynamicTexture;

    private buttonOSM: Button;
    private buttonMB: Button;
    private buttonMBLogo: Button;
    private buttonImprov: Button;
    private buttonOSMBuildings: Button;
    private buttonOverture: Button;
    private buttonGEBCO: Button;
    private buttonGoogle: Button;
    private googleDataAttribution: TextBlock;

    private attributionList: string[]=[];
    private ourRightPanel: StackPanel;
    private ourLeftPanel: StackPanel;
    
    constructor(private scene: Scene) {
        this.advancedTexture = AdvancedDynamicTexture.CreateFullscreenUI("UI");

        this.ourRightPanel = new StackPanel("attribution right panel");
        this.ourRightPanel.height = "25px";
        this.ourRightPanel.isVertical = false;
        this.ourRightPanel.paddingTopInPixels=3;
        this.ourRightPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.ourRightPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.advancedTexture.addControl(this.ourRightPanel);

        this.ourLeftPanel = new StackPanel("attribution left panel");
        this.ourLeftPanel.height = "25px";
        this.ourLeftPanel.isVertical = false;
        this.ourLeftPanel.paddingTopInPixels=3;
        this.ourLeftPanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        this.ourLeftPanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.advancedTexture.addControl(this.ourLeftPanel);
    }

    public addAttribution(provider: string) {
        //TODO: rewrite this as apparently includes is not in ES2015
        /*if(this.attributionList.includes(provider)){
            return; //we already contain this provider
        }*/
              
        if (provider == "MB") {
            this.addAttributionOSM();
            this.attributionList.push("OSM");

            this.addAttributionMapbox();           
        }

        if (provider == "MBMODEL") {
            this.addAttributionMapbox();
        }

        if (provider == "OSM") {
            this.addAttributionOSM();
        }

        if (provider == "OSMB") {
            this.addAttributionOSMBuildings();
        }

        if (provider == "OVERTURE") {
            this.addAttributionOSM();
            this.addAttributionOverture();
        }

        if (provider == "GEBCO") {
            this.addAttributionGEBCO();
        }

        if (provider == "GOOGLE") {
            this.addAttributionGoogle();
        }

        this.attributionList.push(provider);
    }

    /** Updates the sorted data credits returned by Google's 3D Tiles. */
    public setGoogleAttributions(attributions: readonly string[]): void {
        if (!this.googleDataAttribution) {
            this.googleDataAttribution = new TextBlock("google data attribution");
            this.googleDataAttribution.width = "500px";
            this.googleDataAttribution.height = "25px";
            this.googleDataAttribution.color = "white";
            this.googleDataAttribution.alpha = 0.9;
            this.googleDataAttribution.fontSize = "11px";
            this.googleDataAttribution.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
            this.googleDataAttribution.textVerticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
            this.ourRightPanel.addControl(this.googleDataAttribution);
        }
        this.googleDataAttribution.text = attributions.length > 0
            ? attributions.join("; ")
            : "";
    }
    
    private addAttributionOSM() {
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

    private addAttributionOSMBuildings() {
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

    private addAttributionOverture() {
        this.buttonOverture = Button.CreateSimpleButton("button_overture", "© Overture Maps");
        this.buttonOverture.width = "105px";
        this.buttonOverture.height = "25px";
        this.buttonOverture.color = "blue";
        this.buttonOverture.alpha = 0.75;
        this.buttonOverture.thickness = 0;
        this.buttonOverture.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.buttonOverture.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.buttonOverture.fontSize = "12px";
        this.buttonOverture.background = "";
        this.buttonOverture.onPointerUpObservable.add(function () {
            window.open("https://docs.overturemaps.org/attribution/");
        });

        this.ourRightPanel.addControl(this.buttonOverture);
    }

    private addAttributionGEBCO() {
        this.buttonGEBCO = Button.CreateSimpleButton("button_gebco", "© GEBCO");
        this.buttonGEBCO.width = "70px";
        this.buttonGEBCO.height = "25px";
        this.buttonGEBCO.color = "blue";
        this.buttonGEBCO.alpha = 0.75;
        this.buttonGEBCO.thickness = 0;
        this.buttonGEBCO.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_RIGHT;
        this.buttonGEBCO.verticalAlignment = Control.VERTICAL_ALIGNMENT_BOTTOM;
        this.buttonGEBCO.fontSize = "12px";
        this.buttonGEBCO.background = "";
        this.buttonGEBCO.onPointerUpObservable.add(function () {
            window.open("https://www.gebco.net/data-products/gebco-web-services/web-map-service");
        });

        this.ourRightPanel.addControl(this.buttonGEBCO);
    }

    private addAttributionGoogle() {
        this.buttonGoogle = Button.CreateSimpleButton("button_google", "Google");
        this.buttonGoogle.width = "60px";
        this.buttonGoogle.height = "25px";
        this.buttonGoogle.color = "white";
        this.buttonGoogle.alpha = 0.9;
        this.buttonGoogle.thickness = 0;
        this.buttonGoogle.fontSize = "12px";
        this.buttonGoogle.background = "";
        this.buttonGoogle.onPointerUpObservable.add(function () {
            window.open("https://developers.google.com/maps/documentation/tile/policies");
        });

        this.ourRightPanel.addControl(this.buttonGoogle);
    }


    /* 
       https://docs.mapbox.com/help/getting-started/attribution/
    */
    private addAttributionMapbox() {
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
