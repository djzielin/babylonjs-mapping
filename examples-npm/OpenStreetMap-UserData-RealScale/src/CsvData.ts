import { fetch } from 'cross-fetch'
import { parse } from 'papaparse'
import { Vector2} from "@babylonjs/core/Maths/math";

export default class CsvData 
{ 
    private parseData: string[][] = [];

    constructor(){
        
    }

    public async processURL(url: string) {
        console.log("trying to fetch: " + url);
        const res = await fetch(url);
        console.log("  fetch returned: " + res.status);

        if (res.status != 200) {
            throw new Error(`Unable to load CSV: HTTP ${res.status}`);
        }

        const text = await res.text();
        //console.log("raw text: " + JSON.stringify(text));

        const parseResult = parse<string[]>(text, { skipEmptyLines: true });
        if (parseResult.errors.length > 0) {
            throw new Error(parseResult.errors[0].message);
        }
        this.parseData = parseResult.data;

        //console.log("parseData: " + this.parseData);
    }

    public getRow(row: number): string[] {
        return this.parseData[row+1]; //skip header
    }

    public getCoordinates(row:number) : Vector2{
        return new Vector2(Number(this.parseData[row+1][1]),Number(this.parseData[row+1][0])); //lon, lat
    }

    public numRows() : number{
        return this.parseData.length-1; //account for header
    }

}