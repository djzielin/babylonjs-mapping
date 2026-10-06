import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import webpack from 'webpack';
import { chromium } from 'playwright';

const output = resolve('test-results/navigation');
mkdirSync(output, { recursive: true });
await new Promise((done, reject) => webpack({
    mode: 'development', entry: resolve('tests/navigation-fixture.ts'),
    output: { path: output, filename: 'fixture.js' },
    resolve: { extensions: ['.ts', '.js'], alias: { '@babylonjs/core': resolve('node_modules/@babylonjs/core') } },
    module: { rules: [{ test: /\.ts$/, loader: resolve('node_modules/ts-loader'), options: { transpileOnly: true } }] },
}, (error, stats) => error || stats.hasErrors() ? reject(error ?? new Error(stats.toString())) : done()));
const html = `<style>body{margin:0;font:16px system-ui}canvas{width:800px;height:500px;display:block}pre{font-size:12px}</style>
<label>Mode<select id="mode"><option>fly</option><option>orbit</option><option>globe</option></select></label>
<input aria-label="Address"/><button id="reset">Recreate</button><button id="alternate">Switch camera</button>
<canvas id="renderCanvas" width="800" height="500"></canvas><pre id="state"></pre><script src="/fixture.js"></script>`;
const server = createServer((req, res) => { const script = req.url.endsWith('.js'); res.setHeader('Content-Type', script ? 'application/javascript' : 'text/html'); res.end(script ? readFileSync(resolve(output, basename(req.url))) : html); });
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch(process.env.NAVIGATION_EDGE === '1' ? { channel: 'msedge' } : {});
try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 750 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#state').filter({ hasText: 'eye' }).waitFor();
    const state = async () => JSON.parse(await page.locator('#state').textContent());
    const settle = () => page.waitForTimeout(100);
    const drag = async button => { await page.mouse.move(400, 250); await page.mouse.down({ button }); await page.mouse.move(470, 280, { steps: 5 }); await page.mouse.up({ button }); await settle(); };
    const still = async before => { await settle(); assert.deepEqual(await state(), before); };
    for (const mode of ['fly', 'orbit', 'globe']) {
        await page.selectOption('#mode', mode); await settle();
        const touch = await page.context().newCDPSession(page);
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 400, y: 250 }] });
        const touchBefore = await state();
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 460, y: 270 }] });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await settle();
        assert.notDeepEqual(await state(), touchBefore, `${mode}: touch drag moves camera`);
        await touch.detach();
        for (let repeat = 0; repeat < 3; repeat++) {
            await page.click('#renderCanvas', { position: { x: 400, y: 250 } });
            const before = await state();
            await drag(mode === 'fly' ? 'right' : 'left');
            assert.notDeepEqual(await state(), before, `${mode}: drag moves camera`);
            const looked = await state();
            await drag('middle');
            const panned = await state();
            assert.notDeepEqual(panned, looked, `${mode}: middle drag moves camera`);
            if (mode === 'orbit') { assert.deepEqual(panned.alpha, looked.alpha); assert.deepEqual(panned.beta, looked.beta); assert.notDeepEqual(panned.target, looked.target); }
            if (mode === 'globe') assert.deepEqual(panned.target, [0, 0, 0]);
            await page.keyboard.down(mode === 'fly' ? 'w' : 'ArrowLeft'); await settle();
            const moving = await state(); assert.notDeepEqual(moving, panned);
            await drag(mode === 'fly' ? 'right' : 'left');
            const releasedDrag = await state(); await settle();
            assert.notDeepEqual(await state(), releasedDrag, `${mode}: releasing look drag preserves held movement`);
            await page.getByLabel('Address').click(); await page.keyboard.up(mode === 'fly' ? 'w' : 'ArrowLeft'); await settle();
            const blurred = await state(); await still(blurred);
            await page.getByLabel('Address').fill('wasd'); await still(blurred);
            await page.click('#renderCanvas');
            await page.keyboard.press('Escape'); await settle(); await still(await state());
            await page.click('#renderCanvas'); await page.mouse.move(400, 250); await page.mouse.down();
            await page.mouse.move(440, 260); await page.dispatchEvent('#renderCanvas', 'pointercancel', { pointerId: 1 });
            await settle(); const cancelled = await state(); await page.mouse.move(480, 290); await page.mouse.up(); await still(cancelled);
            await page.click('#renderCanvas'); await page.mouse.move(400, 250); await page.mouse.down({ button: 'middle' });
            await page.mouse.move(440, 260); await page.dispatchEvent('#renderCanvas', 'lostpointercapture', { pointerId: 1 });
            await settle(); const lost = await state(); await page.mouse.move(480, 290); await page.mouse.up({ button: 'middle' }); await still(lost);
            await page.click('#renderCanvas'); const zoomBefore = await state(); await page.mouse.wheel(0, -100); await settle();
            assert.notDeepEqual(await state(), zoomBefore, `${mode}: wheel moves camera`);
            await page.keyboard.down(mode === 'fly' ? 'w' : 'ArrowLeft'); await settle();
            await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await settle();
            const interrupted = await state(); await page.keyboard.up(mode === 'fly' ? 'w' : 'ArrowLeft'); await still(interrupted);
            await page.click('#alternate'); await settle(); assert.equal((await state()).active, false);
            const inactive = await state(); await page.keyboard.press('w'); await still(inactive);
            await page.click('#alternate'); await page.click('#reset'); await settle();
            assert.equal(await page.locator('.navigation-help').count(), 1, 'dispose removes old listeners/help');
        }
        console.log(`PASS ${mode}: drag, middle pan, keyboard, form focus, Escape, cancel, camera switch, repeated disposal`);
    }
    assert.deepEqual(errors, []);
    await page.screenshot({ path: resolve(output, 'controls.png') });
} finally { await browser.close(); await new Promise(done => server.close(done)); }
