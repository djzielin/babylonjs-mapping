import { Engine } from "@babylonjs/core/Engines/engine";
import { Scene } from "@babylonjs/core/scene";
import { Vector2 } from "@babylonjs/core/Maths/math";
import { Vector3 } from "@babylonjs/core/Maths/math";
import { Color3 } from "@babylonjs/core/Maths/math";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { ActionManager, Material, ParticleBlendMultiplyBlock } from "@babylonjs/core";
import { ExecuteCodeAction } from "@babylonjs/core";
import { AdvancedDynamicTexture } from "@babylonjs/gui/2D/advancedDynamicTexture";
import { Button } from "@babylonjs/gui/2D/controls/button";
import { Control, Checkbox, ColorPicker} from "@babylonjs/gui/2D/controls"; 
import { StackPanel, Rectangle, TextBlock } from "@babylonjs/gui/2D/controls"; 
import {Game} from "./index";
//import TileSet from "../../../lib/TileSet";
import TileSet from "babylonjs-mapping";

export default class PropertyGUI {
    private valuesFound: string[] = [];
    private ourMaterials: StandardMaterial[]=[];
    private visibilityStatus: boolean[]=[];
    private valueLine: StackPanel[]=[];
    private colorPreviews: Button[]=[];
    private visibilityToggle: Button[]=[];

    private colorPicker: ColorPicker | null=null;
    private ourPanel: StackPanel;
    private areButtonsActive=false;

    constructor(public property: string, public game: Game) {

        for (let i = 0; i < this.game.allBuildings.length; i++) {
            const b = this.game.allBuildings[i];
            const prop = b.metadata as Map<string, string>;

            const value = prop.get(property)

            if (value !== undefined) {

                if (this.valuesFound.indexOf(value) == -1) {

                    this.valuesFound.push(value);
                    this.visibilityStatus.push(true);

                    const buildingMaterial = new StandardMaterial("buildingMaterial" + i, this.game.scene);
                    buildingMaterial.diffuseColor = new Color3(0.8, 0.8, 0.8);
                    this.ourMaterials.push(buildingMaterial);
                }
            }
        }
    }

    public generateGUI(panel: StackPanel) {
        this.ourPanel=panel;
        const propText = Button.CreateSimpleButton("button for " + this.property, this.property);
        propText.height = "30px"
        propText.width = "200px";
        
        propText.paddingTopInPixels=3;
        propText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
        if(propText.textBlock){
            propText.textBlock.textHorizontalAlignment=Control.HORIZONTAL_ALIGNMENT_LEFT;
            propText.textBlock.paddingLeftInPixels=5;
        }
        propText.color = "white";
        propText.background = "black";
        this.ourPanel.addControl(propText);

        propText.onPointerClickObservable.add(() => {
            for (let pgui of this.game.propertyGUIs) {
                pgui.hideModifiers();
            }
            this.showModifiers();          
        });
        console.log("examining property: " + this.property)
        for (let i = 0; i < this.valuesFound.length; i++) {
            const s = this.valuesFound[i];
            console.log("data: " + s);

            ////////////////////////////////////////////
            // PANEL
            ////////////////////////////////////////////
            var subpanel = new StackPanel("line for " + s);
            subpanel.height = "30px";
            subpanel.width = "300px";
            subpanel.isVertical = false;
            subpanel.paddingTopInPixels=3;
            subpanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            subpanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
            this.valueLine.push(subpanel);
            this.ourPanel.addControl(subpanel);

            ////////////////////////////////////////////        
            // VISIBILITY 
            ////////////////////////////////////////////
            var visibility = Button.CreateImageOnlyButton("visibility toggle for " + s, "textures/120px-Downyu.png");
            visibility.width = "30px";
            visibility.height = "30px";
            visibility.color = "white";
            visibility.paddingLeftInPixels=5;
            
            visibility.background="white";
            visibility.onPointerClickObservable.add(() => {
               this.visibilityStatus[i]=!this.visibilityStatus[i]; //toggle
               this.applyFilters();
            });
            this.visibilityToggle.push(visibility);
            subpanel.addControl(visibility);

            ////////////////////////////////////////////
            // COLOR
            ////////////////////////////////////////////     
            const colorPreview = Button.CreateSimpleButton("color swatch for " + this.property,"");
            colorPreview.height = "30px"
            colorPreview.width = "35px";
            //header.marginLeft = "5px";
            colorPreview.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            colorPreview.color = "white";   
            colorPreview.paddingLeftInPixels=5;
    
            colorPreview.onPointerClickObservable.add(() => {
                if (this.areButtonsActive) {
                    this.removeColorPicker();

                    const picker: ColorPicker = new ColorPicker();
                    picker.value = this.ourMaterials[i].diffuseColor;
                    picker.height = "200px";
                    picker.width = "200px";
                    picker.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
                    picker.onValueChangedObservable.add((value: Color3) => {  // value is a color3
                        this.ourMaterials[i].diffuseColor.copyFrom(value);
                        this.colorPreviews[i].background = this.ourMaterials[i].diffuseColor.toHexString();
                    });
                    this.ourPanel.addControl(picker);
                    this.colorPicker = picker;
                }      
            });

            this.colorPreviews.push(colorPreview);
            subpanel.addControl(colorPreview);

            ////////////////////////////////////////////
            // TEXT
            ////////////////////////////////////////////
            let checkText=s;
            if(checkText==""){
                checkText="<no value>";
            }
            var textBlock = new TextBlock("text block for " + s, checkText);

            textBlock.height="30px"
            textBlock.width="200px";      
            textBlock.paddingLeftInPixels=5;      
            //textBlock.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            textBlock.color = "black";           

            textBlock.textHorizontalAlignment=Control.HORIZONTAL_ALIGNMENT_LEFT;

            subpanel.addControl(textBlock);
        }

        var spacer = new StackPanel("spacer"); //functions as a spacer
            spacer.height = "30px";
            spacer.width = "300px";
            spacer.isVertical = false;
            spacer.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            spacer.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
            subpanel.addControl(spacer);
 
        this.hideModifiers();
    }

    public removeColorPicker(){
        if(this.colorPicker){
            this.ourPanel.removeControl(this.colorPicker);
            this.colorPicker.dispose();
        }
    }

    private applyFilters() {
        for (let b of this.game.allBuildings) {
            const prop = b.metadata as Map<string, string>;

            for (let i = 0; i < this.valuesFound.length; i++) {
                const valueFound = this.valuesFound[i];
                const checkboxValue = this.visibilityStatus[i];

                if(this.visibilityStatus[i]){
                    this.visibilityToggle[i].image.source="textures/120px-Downyu.png";
                }
                else{
                    this.visibilityToggle[i].image.source="textures/120px-Downyu-gray.png";
                }

                const propValue = prop.get(this.property);
                if (propValue !== undefined) {
                    if (propValue == valueFound) {
                        b.setEnabled(checkboxValue);
                    }
                }
            }
        }
    }

    private showModifiers() {
        for (let b of this.game.allBuildings) {
            const prop = b.metadata as Map<string, string>;

            for (let i = 0; i < this.valuesFound.length; i++) {
                const valueFound = this.valuesFound[i];
                const mat = this.ourMaterials[i];

                const propValue = prop.get(this.property);
                if (propValue !== undefined) {
                    if (propValue == valueFound) {
                        b.material=mat;
                    }
                }
            }
        }

        for (let i = 0; i < this.valuesFound.length; i++) {
            //this.valueLine[i].background = this.ourMaterials[i].diffuseColor.toHexString();
            this.colorPreviews[i].background=this.ourMaterials[i].diffuseColor.toHexString();
        }

        /*for (let cb of this.visibilityToggle) {
            cb.isVisible=true;
        }*/
        for (let vl of this.valueLine) {
            vl.isVisible=true;
        }

        this.applyFilters();
        this.areButtonsActive=true;
    }

    private hideModifiers() {
        /*for (let cb of this.visibilityToggle) {
            cb.isVisible=false;
        }*/
        for (let vl of this.valueLine) {
            vl.isVisible=false;
        }
        for (let cp of this.colorPreviews) {
            cp.background="white";
        }

        this.removeColorPicker();
        this.areButtonsActive=false;
    }
}
