import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// npm run build && npx playwright install chromium && npm run test:xr
// A null headset: Meta's IWER Quest 3 profile, with no physical XR hardware.
const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = resolve(dirname(require.resolve('iwer')), '../build/iwer.min.js');
const server = createServer(async (request, response) => {
    try {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        const file = resolve(root, 'dist', '.' + (pathname === '/' ? '/index.html' : pathname));
        if (!file.startsWith(resolve(root, 'dist') + '/')) throw new Error('Invalid path');
        response.setHeader('Content-Type', extname(file) === '.js' ? 'text/javascript' : 'text/html');
        response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript({ path: runtime });
    await page.addInitScript(() => {
        window.nullHeadset = new IWER.XRDevice(IWER.metaQuest3, { stereoEnabled: true });
        nullHeadset.installRuntime({ forceInstall: true });
        nullHeadset.position.set(0, 1.6, 0);
        const requestSession = navigator.xr.requestSession.bind(navigator.xr);
        navigator.xr.requestSession = async (...args) => {
            if (window.rejectNextSession) {
                window.rejectNextSession = false;
                throw new DOMException('Test permission denial', 'NotAllowedError');
            }
            const session = await requestSession(...args);
            window.testSession = session;
            window.testFrames = 0;
            const space = await session.requestReferenceSpace('local-floor');
            const frame = (_, xrFrame) => {
                window.testFrames++;
                window.testEyes = xrFrame.getViewerPose(space)?.views.map(view => view.eye);
                session.requestAnimationFrame(frame);
            };
            session.requestAnimationFrame(frame);
            return session;
        };
    });
    page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
    await page.goto(url);
    console.log('Loaded demo');
    await page.waitForFunction(() => !document.querySelector('#enter-vr').disabled);
    await page.evaluate(() => window.rejectNextSession = true);
    await page.click('#enter-vr');
    await page.waitForFunction(() => document.querySelector('#xr-status').textContent.includes('Could not enter VR'));
    assert.equal(await page.isDisabled('#enter-vr'), false);
    await page.click('#enter-vr');
    console.log('Requested immersive session');
    await page.waitForFunction(() => window.testFrames > 10 && helloWorldWebXR.xrExperience.input.controllers.length === 2);
    assert.deepEqual(await page.evaluate(() => testEyes), ['left', 'right']);
    await page.waitForFunction(() => helloWorldWebXR.scene.activeCamera.rigCameras.length === 2);
    assert.equal(await page.isHidden('#help'), true);
    console.log('Stereo and controllers ready');
    const before = await page.evaluate(() => helloWorldWebXR.scene.activeCamera.position.asArray());
    await page.evaluate(() => nullHeadset.position.x += 0.25);
    await page.waitForFunction(x => Math.abs(helloWorldWebXR.scene.activeCamera.position.x - x - 0.25) < 0.01, before[0]);
    await page.waitForFunction(() => helloWorldWebXR.xrExperience.input.controllers.every(c => c.motionController));
    console.log('Head tracking passed');
    const rotation = await page.evaluate(() => helloWorldWebXR.scene.activeCamera.rotationQuaternion.asArray());
    await page.evaluate(() => nullHeadset.controllers.right.updateAxes('thumbstick', 1, 0));
    await page.waitForFunction(previous => helloWorldWebXR.scene.activeCamera.rotationQuaternion.asArray().some((v, i) => Math.abs(v - previous[i]) > 0.1), rotation);
    await page.evaluate(() => nullHeadset.controllers.right.updateAxes('thumbstick', 0, 0));
    await page.waitForFunction(() => helloWorldWebXR.xrExperience.input.controllers.find(c => c.inputSource.handedness === 'right').motionController.getComponentOfType('thumbstick').axes.x === 0);
    console.log('Snap turn passed');
    // Return to the initial heading before aiming the right controller at the map.
    await page.evaluate(() => {
        helloWorldWebXR.scene.activeCamera.rotationQuaternion.set(0, 0, 0, 1);
        nullHeadset.controllers.right.position.set(0.25, 1.2, -0.3);
        nullHeadset.controllers.right.quaternion.set(-Math.sin(Math.PI / 8), 0, 0, Math.cos(Math.PI / 8));
        nullHeadset.controllers.right.updateAxes('thumbstick', 0, -1);
    });
    await page.waitForFunction(() => helloWorldWebXR.xrExperience.teleportation.teleportationTargetMesh.isVisible).catch(async error => {
        console.log(await page.evaluate(() => {
            const xr = helloWorldWebXR.xrExperience;
            return {camera: xr.baseExperience.camera.position.asArray(), controllers: xr.input.controllers.map(c => ({id:c.uniqueId, position:c.pointer.position.asArray(), rotation:c.pointer.rotationQuaternion.asArray(), axes:c.motionController.getComponentOfType('thumbstick').axes})), teleport: Object.keys(xr.teleportation), target:xr.teleportation.teleportationTargetMesh.position.asArray()};
        }));
        await page.screenshot({path: resolve(root, 'test-results/teleport-failure.png')});
        throw error;
    });
    console.log('Teleport target visible');
    const teleportStart = await page.evaluate(() => helloWorldWebXR.scene.activeCamera.position.asArray());
    await page.evaluate(() => nullHeadset.controllers.right.updateAxes('thumbstick', 0, 0));
    await page.waitForFunction(start => Math.hypot(helloWorldWebXR.scene.activeCamera.position.x - start[0], helloWorldWebXR.scene.activeCamera.position.z - start[2]) > 0.2, teleportStart);
    console.log('Teleport movement passed');
    await page.waitForFunction(() => document.querySelector('#building-status').textContent === 'Buildings ready.', null, { timeout: 90000 });
    console.log('Buildings ready');
    const buildings = await page.evaluate(() => helloWorldWebXR.map.ourTiles.reduce((n, tile) => n + tile.buildings.length, 0));
    assert.ok(buildings > 0);
    await page.evaluate(() => nullHeadset.quaternion.set(-Math.sin(Math.PI / 12), 0, 0, Math.cos(Math.PI / 12)));
    await page.waitForFunction(() => Math.abs(helloWorldWebXR.scene.activeCamera.rotationQuaternion.x) > 0.2);
    await page.screenshot({ path: resolve(root, 'test-results/null-headset-stereo.png') });
    await page.evaluate(() => testSession.end());
    await page.waitForFunction(() => helloWorldWebXR.scene.activeCamera.name === 'desktop' && !document.querySelector('#help').hidden);
    await page.click('#enter-vr');
    await page.waitForFunction(() => testFrames > 5 && document.querySelector('#help').hidden);
    await page.evaluate(() => testSession.end());
    assert.deepEqual(errors, []);
    console.log(`Quest 3 null headset passed: stereo frames, head tracking, two controllers, snap turn, teleport, exit/re-entry, permission retry, ${buildings} buildings.`);
    await page.close();

    const desktop = await browser.newPage();
    await desktop.addInitScript(() => Object.defineProperty(navigator, 'xr', { value: undefined }));
    await desktop.route('https://overturemaps-extras-us-west-2.s3.amazonaws.com/**', route => route.fulfill({ status: 503, body: 'Unavailable' }));
    await desktop.goto(url);
    await desktop.waitForFunction(() => document.querySelector('#xr-status').textContent.includes('VR unavailable'));
    await desktop.waitForFunction(() => document.querySelector('#building-status').textContent.includes('Buildings unavailable'));
    assert.equal(await desktop.isDisabled('#enter-vr'), true);
    assert.equal(await desktop.evaluate(() => helloWorldWebXR.scene.activeCamera.name), 'desktop');
    console.log('Desktop fallback and unavailable building service passed.');
} finally {
    await browser?.close();
    await new Promise(done => server.close(done));
}
