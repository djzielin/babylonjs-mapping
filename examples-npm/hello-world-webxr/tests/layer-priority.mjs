import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import webpack from 'webpack';
import { chromium } from 'playwright';

const output = resolve('test-results/layer-priority');
mkdirSync(output, { recursive: true });
await new Promise((done, reject) => webpack({
    mode: 'development', entry: resolve('tests/layer-priority-fixture.ts'),
    output: { path: output, filename: 'fixture.js' },
    resolve: { extensions: ['.ts', '.js'], alias: { '@babylonjs/core': resolve('node_modules/@babylonjs/core') } },
    module: { rules: [{ test: /\.ts$/, loader: resolve('node_modules/ts-loader'), options: { transpileOnly: true } }] },
}, (error, stats) => error || stats.hasErrors() ? reject(error ?? new Error(stats.toString())) : done()));
const html = `<label>Phase<select id="phase"><option>coarse</option><option>partial</option><option>complete</option><option>retained</option><option>google</option></select></label>
<canvas id="canvas" width="400" height="400" style="width:400px;height:400px;display:block"></canvas><pre id="pixels"></pre><script src="/fixture.js"></script>`;
const server = createServer((req, res) => { const script = req.url.endsWith('.js'); res.setHeader('Content-Type', script ? 'application/javascript' : 'text/html'); res.end(script ? readFileSync(resolve(output, basename(req.url))) : html); });
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch(process.env.NAVIGATION_EDGE === '1' ? { channel: 'msedge' } : {});
try {
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    await page.goto(`http://127.0.0.1:${server.address().port}/?baseline`, { waitUntil: 'commit' });
    await page.selectOption('#phase', 'partial');
    await page.waitForFunction(() => JSON.parse(document.getElementById('pixels').textContent || '{}').phase === 'partial');
    assert.deepEqual(JSON.parse(await page.locator('#pixels').textContent()).left, [255, 0, 0], 'old shared tier priority reproduces coarse overwrite');
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'commit' });
    for (const [phase, left, right] of [
        ['coarse', [255, 0, 0], [255, 0, 0]],
        ['partial', [0, 255, 0], [255, 0, 0]],
        ['complete', [0, 255, 0], [0, 255, 0]],
        ['retained', [0, 255, 0], [255, 0, 0]],
        ['google', [0, 0, 255], [255, 0, 0]],
        ['coarse', [255, 0, 0], [255, 0, 0]],
    ]) {
        await page.selectOption('#phase', phase);
        await page.waitForFunction(phase => JSON.parse(document.getElementById('pixels').textContent || '{}').phase === phase, phase);
        const pixels = JSON.parse(await page.locator('#pixels').textContent());
        assert.deepEqual(pixels.left, left, `${phase}: finer surface owns covered pixels`);
        assert.deepEqual(pixels.right, right, `${phase}: preserve uncovered fallback`);
    }
    assert.deepEqual(errors, []);
    console.log('PASS real GPU pixel ownership: coarse, partial finer, complete finer, retained finer, Google, retirement');
} finally { await browser.close(); await new Promise(done => server.close(done)); }
