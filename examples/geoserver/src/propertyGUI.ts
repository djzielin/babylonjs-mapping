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
import TileSet from "../../../lib/TileSet";

export default class PropertyGUI {
    private valuesFound: string[] = [];
    private ourMaterials: StandardMaterial[]=[];
    private checkBoxStatus: boolean[]=[];
    private valueLine: StackPanel[]=[];
    private ourCheckBoxes: Checkbox[]=[];

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
                    this.checkBoxStatus.push(true);

                    const buildingMaterial = new StandardMaterial("buildingMaterial" + i, this.game.scene);
                    buildingMaterial.diffuseColor = new Color3(0.8, 0.8, 0.8);
                    this.ourMaterials.push(buildingMaterial);
                }
            }
        }
    }

    public generateGUI(panel: StackPanel) {
        this.ourPanel=panel;
        const propText = Button.CreateSimpleButton("but", this.property);
        propText.height = "30px"
        propText.width = "200px";
        //header.marginLeft = "5px";
        propText.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
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

            var subpanel = new StackPanel();
            subpanel.height = "30px";
            subpanel.width = "300px";
            subpanel.isVertical = false;
            subpanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            subpanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
            this.ourPanel.addControl(subpanel);
            this.valueLine.push(subpanel);
        
            var checkbox = new Checkbox("test");
            checkbox.width = "20px";
            checkbox.height = "20px";
            checkbox.isChecked = true;
            checkbox.color = "black";
            checkbox.background="white";
            checkbox.onIsCheckedChangedObservable.add((value) => {
               this.checkBoxStatus[i]=value;
               this.applyFilters();
            });
            this.ourCheckBoxes.push(checkbox);
            subpanel.addControl(checkbox);

          
            let checkText=s;
            if(checkText==""){
                checkText="<no value>";
            }
            var header = Button.CreateSimpleButton("but", checkText);

            header.height="30px"
            header.width="200px";
            header.thickness=0;            
            header.background="";
            //header.marginLeft = "5px";
            //header.HorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            if (header.textBlock) {
                header.textBlock.textHorizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            }
            header.color = "black";

            header.onPointerClickObservable.add(() => {
                if (this.areButtonsActive) {
                    this.removeColorPicker();

                    const picker: ColorPicker = new ColorPicker();
                    picker.value = this.ourMaterials[i].diffuseColor;
                    picker.height = "200px";
                    picker.width = "200px";
                    picker.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_CENTER;
                    picker.onValueChangedObservable.add((value: Color3) => {  // value is a color3
                        this.ourMaterials[i].diffuseColor.copyFrom(value);
                        this.valueLine[i].background = this.ourMaterials[i].diffuseColor.toHexString();
                    });
                    this.ourPanel.addControl(picker);
                    this.colorPicker = picker;
                }
            });


            subpanel.addControl(header);
        }

        var subpanel = new StackPanel(); //functions as a spacer
            subpanel.height = "30px";
            subpanel.width = "300px";
            subpanel.isVertical = false;
            subpanel.horizontalAlignment = Control.HORIZONTAL_ALIGNMENT_LEFT;
            subpanel.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
            this.ourPanel.addControl(subpanel);
 
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
                const checkboxValue = this.checkBoxStatus[i];

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
            this.valueLine[i].background = this.ourMaterials[i].diffuseColor.toHexString();
        }

        for (let cb of this.ourCheckBoxes) {
            cb.isVisible=true;
        }

        this.applyFilters();
        this.areButtonsActive=true;
    }

    private hideModifiers() {
        for (let cb of this.ourCheckBoxes) {
            cb.isVisible=false;
        }
        for (let vl of this.valueLine) {
            vl.background="white";
        }

        this.removeColorPicker();
        this.areButtonsActive=false;
    }
}
