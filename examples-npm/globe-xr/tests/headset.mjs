import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// npm run build && npx playwright install chromium && npm run test:xr [-- --gpu <chrome>]
// Drives the demo in Meta's IWER Quest 3 emulator: enters VR, then checks each control moves the user as it should.
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = resolve(dirname(require.resolve('iwer')), '../build/iwer.min.js');
const results = resolve(root, 'test-results');
await mkdir(results, { recursive: true });
const gpu = process.argv.indexOf('--gpu');
const types = { '.js': 'text/javascript', '.html': 'text/html', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.wasm': 'application/wasm' };
// The demo at /globe-xr/, the globe demo's models beside it, as on Pages.
const server = createServer(async (request, response) => {
    try {
        const path = new URL(request.url, 'http://localhost').pathname;
        const [base, prefix] = path.startsWith('/globe-mode/') ? [resolve(root, '../globe-mode/public'), '/globe-mode/'] : [resolve(root, 'dist'), '/globe-xr/'];
        const relative = path.slice(prefix.length) || 'index.html';
        const file = resolve(base, relative);
        if (!file.startsWith(base + '/')) throw new Error('Invalid path');
        response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream');
        response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/globe-xr/`;

const browser = await chromium.launch(gpu > 0
    ? { executablePath: process.argv[gpu + 1], headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan'] }
    : { headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(60000);
const errors = [];
page.on('pageerror', error => { const text = error.stack || `${error.name}: ${error.message}` || String(error); errors.push(text); console.error('page error:', text); });
page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource|net::/.test(message.text())) console.error(message.text()); });
await page.addInitScript({ path: runtime });
await page.addInitScript(() => {
    const offsetSpace = IWER.XRReferenceSpace.prototype.getOffsetReferenceSpace;
    IWER.XRReferenceSpace.prototype.getOffsetReferenceSpace = function (transform) {
        return offsetSpace.call(this, transform.matrix);
    };
    window.headset = new IWER.XRDevice(IWER.metaQuest3, { stereoEnabled: true });
    headset.installRuntime({ forceInstall: true });
    headset.position.set(0, 1.6, 0);
    headset.controllers.left.position.set(-0.2, 1.2, -0.3);
    headset.controllers.right.position.set(0.2, 1.2, -0.3);
});

const rig = () => page.evaluate(() => { const r = demo.xrControls.rig; return { latitude: r.latitude, longitude: r.longitude, heading: r.heading, scale: r.scale }; });
const frames = n => page.evaluate(n => new Promise(done => { let k = 0; const o = demo.scene.onAfterRenderObservable.add(() => { if (++k >= n) { demo.scene.onAfterRenderObservable.remove(o); done(); } }); }), n);
const hand = (side, fn) => page.evaluate(([side, fn]) => new Function('c', fn)(headset.controllers[side]), [side, fn]);

try {
    await page.goto(url);
    await page.waitForFunction(() => !document.querySelector('#enterVR').disabled);
    await page.click('#enterVR');
    await page.waitForFunction(() => demo.xr?.baseExperience.state === 2 && demo.xr.input.controllers.length === 2
        && demo.xr.input.controllers.every(c => c.motionController));
    await frames(30);
    const start = await rig();
    console.log('In VR at', start);

    // The first time, the menu opens on the controls; Y puts it away.
    await page.waitForFunction(() => demo.menu.isOpen, null, { timeout: 10000 });
    await hand('left', "c.updateButtonValue('y-button', 1)");
    await frames(3);
    await hand('left', "c.updateButtonValue('y-button', 0)");
    await frames(3);
    assert.equal(await page.evaluate(() => demo.menu.isOpen), false, 'Y closes the menu');
    console.log('Controls shown on entry; Y closes the menu');
    assert.ok(Math.abs(start.latitude - 40.73) < 0.1 && start.scale > 100, 'starts above New York, large');
    await page.waitForTimeout(8000);
    await page.screenshot({ path: resolve(results, 'xr-new-york.png') });

    // Left stick forward: moves the way the head faces.
    await hand('left', "c.updateAxes('thumbstick', 0, -1)");
    await frames(45);
    await hand('left', "c.updateAxes('thumbstick', 0, 0)");
    const walked = await rig();
    assert.notEqual(walked.latitude, start.latitude, 'left stick moves');
    assert.equal(walked.scale, start.scale, 'moving keeps the scale');
    console.log('Left stick moves');

    // Right stick up: rises (grows).
    await hand('right', "c.updateAxes('thumbstick', 0, -1)");
    await frames(30);
    await hand('right', "c.updateAxes('thumbstick', 0, 0)");
    const risen = await rig();
    assert.ok(risen.scale > walked.scale * 1.3, 'right stick up grows the user');
    // Right stick right: one snap turn per push.
    await hand('right', "c.updateAxes('thumbstick', 1, 0)");
    await frames(10);
    await hand('right', "c.updateAxes('thumbstick', 0, 0)");
    await frames(3);
    const turned = await rig();
    assert.ok(Math.abs(((turned.heading - risen.heading + 540) % 360) - 180 - 30) < 0.5, 'snap turns 30 degrees');
    console.log('Right stick rises and snap turns');

    // One grip: the world follows the hand.
    await hand('right', "c.updateButtonValue('squeeze', 1)");
    await frames(3);
    for (let i = 0; i < 20; i++) { await hand('right', 'c.position.x -= 0.02'); await frames(1); }
    await hand('right', "c.updateButtonValue('squeeze', 0)");
    await frames(3);
    const dragged = await rig();
    assert.ok(Math.abs(dragged.longitude - turned.longitude) + Math.abs(dragged.latitude - turned.latitude) > 1e-5, 'grip drags the world');
    assert.ok(Math.abs(dragged.scale - turned.scale) < 1e-6, 'dragging keeps the scale');
    console.log('Grip drags');

    // Both grips apart: the world grows, the user shrinks.
    await hand('left', "c.updateButtonValue('squeeze', 1)");
    await hand('right', "c.updateButtonValue('squeeze', 1)");
    await frames(3);
    for (let i = 0; i < 20; i++) {
        await page.evaluate(() => { headset.controllers.left.position.x -= 0.01; headset.controllers.right.position.x += 0.01; });
        await frames(1);
    }
    await hand('left', "c.updateButtonValue('squeeze', 0)");
    await hand('right', "c.updateButtonValue('squeeze', 0)");
    await frames(3);
    const pinched = await rig();
    assert.ok(pinched.scale < dragged.scale * 0.8, 'pulling apart shrinks the user');
    console.log('Two-handed zoom', dragged.scale.toFixed(0), '->', pinched.scale.toFixed(0));

    // Trigger, pointing at the ground: zooms toward it.
    await page.evaluate(() => {
        const c = headset.controllers.right;
        c.position.set(0.2, 1.2, -0.3);
        c.quaternion.set(-0.5, 0, 0, 0.866);
        c.updateButtonTouch('trigger', true);
    });
    await frames(10);
    assert.equal(await page.evaluate(() => demo.xrControls.marker.isShown), true, 'destination marked on the ground');
    await hand('right', "c.updateButtonValue('trigger', 1)");
    await frames(3);
    await hand('right', "c.updateButtonValue('trigger', 0)");
    await page.waitForFunction(() => !demo.xrControls.isFlying);
    const zoomed = await rig();
    // Up to a good viewing height, a click keeps it; from higher, it comes down toward it.
    assert.ok(Math.abs(zoomed.latitude - pinched.latitude) + Math.abs(zoomed.longitude - pinched.longitude) > 1e-5, 'click moves to the point');
    assert.ok(pinched.scale > 300 ? zoomed.scale < pinched.scale : Math.abs(zoomed.scale / pinched.scale - 1) < 0.01, 'click keeps a good viewing height');
    console.log('Point and click moves', pinched.scale.toFixed(0), '->', zoomed.scale.toFixed(0));

    // The left trigger while gliding speeds the glide: it neither points nor clicks, then or after.
    await hand('right', "c.updateButtonTouch('trigger', false)");
    await hand('left', "c.updateAxes('thumbstick', 0, -1)");
    await frames(5);
    await hand('left', "c.updateButtonTouch('trigger', true); c.updateButtonValue('trigger', 1)");
    await frames(10);
    assert.equal(await page.evaluate(() => demo.xrControls.isFlying), false, 'the glide boost is not a click');
    await hand('left', "c.updateAxes('thumbstick', 0, 0)");
    await frames(10);
    assert.equal(await page.evaluate(() => demo.xrControls.isFlying), false, 'a trigger held from gliding is not a click');
    await hand('left', "c.updateButtonValue('trigger', 0); c.updateButtonTouch('trigger', false)");
    await frames(3);
    console.log('Left trigger while gliding: no click');

    // Either hand points: the left, raised alone, has the laser and the click.
    await page.evaluate(() => {
        const c = headset.controllers.left;
        c.position.set(-0.2, 1.2, -0.3);
        c.quaternion.set(-0.5, 0, 0, 0.866);
        c.updateButtonTouch('trigger', true);
    });
    await frames(10);
    assert.equal(await page.evaluate(() => demo.xrControls.marker.isShown), true, 'the left hand marks a destination');
    await hand('left', "c.updateButtonValue('trigger', 1)");
    await frames(3);
    await hand('left', "c.updateButtonValue('trigger', 0); c.updateButtonTouch('trigger', false)");
    assert.equal(await page.evaluate(() => demo.xrControls.isFlying), true, 'the left hand clicks to move');
    await page.waitForFunction(() => !demo.xrControls.isFlying);
    console.log('Left hand points and clicks');

    // Settling out of a flight after the head has moved: no jump.
    await page.evaluate(() => { void demo.xrControls.flyTo({ ...demo.xrControls.headPose, latitude: demo.xrControls.headPose.latitude + 0.5 }, 6000); });
    await frames(5);
    await page.evaluate(() => headset.position.set(0.5, 1.6, 0.3));
    await frames(10);
    const jump = await page.evaluate(() => new Promise(done => {
        const c = demo.xrControls, cam = demo.xr.baseExperience.camera, m = demo.globe.metresToWorld;
        let last = cam.globalPosition.clone(), steps = [];
        const o = demo.scene.onAfterRenderObservable.add(() => {
            const eye = cam.globalPosition.clone();
            steps.push(eye.subtract(last).length() / m / c.rig.scale);
            last = eye;
            if (steps.length === 4) headset.controllers.right.updateAxes('thumbstick', 0, -0.6);
            if (steps.length === 10) { demo.scene.onAfterRenderObservable.remove(o); headset.controllers.right.updateAxes('thumbstick', 0, 0); done(steps); }
        });
    }));
    // Physical metres the eyes moved per frame: the flight's own slow start, never the head's offset.
    assert.ok(Math.max(...jump.slice(4, 7)) < 0.1, `no jump settling after a head move (${jump.map(x => x.toFixed(3)).join(' ')})`);
    await page.waitForFunction(() => !demo.xrControls.isTilted);
    await page.evaluate(() => headset.position.set(0, 1.6, 0));
    console.log('Settling after a head move: largest step', Math.max(...jump.slice(4, 7)).toFixed(3), 'm');

    // A: on to the next stop, Duke University.
    await hand('right', "c.updateButtonValue('a-button', 1)");
    await frames(3);
    await hand('right', "c.updateButtonValue('a-button', 0)");
    await page.waitForFunction(() => demo.xrControls.isFlying);
    await page.waitForFunction(() => !demo.xrControls.isFlying, null, { timeout: 30000 });
    const duke = await rig();
    assert.ok(Math.abs(duke.latitude - 36.0) < 0.1 && Math.abs(duke.longitude + 78.94) < 0.1, 'A flies to the next stop');
    console.log('Tour button flies to', duke);
    await page.waitForTimeout(10000);
    await page.screenshot({ path: resolve(results, 'xr-duke.png') });
    console.log('fps', await page.evaluate(() => demo.governor.fps.toFixed(1)), 'quality level', await page.evaluate(() => demo.governor.level));

    await page.evaluate(() => demo.xr.baseExperience.exitXRAsync());
    await page.waitForFunction(() => demo.xr.baseExperience.state === 3);
    assert.equal(errors.length, 0, 'no page errors');
    console.log('Exited VR; all checks passed');
} finally {
    await browser.close();
    server.close();
}
