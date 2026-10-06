import { AssetContainer } from "@babylonjs/core/assetContainer.js";
/** Avoid a city-wide parent snapshot when adding a self-contained static Google asset.
 * The native outer lifecycle, components, removals and disposal stay intact.
 */
export declare function attachGoogleStaticAssetContainer(asset: AssetContainer): boolean;
