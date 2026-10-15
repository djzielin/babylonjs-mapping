const { merge } = require('webpack-merge');
const path = require('path');
const common = require('./webpack.common.js');

module.exports = merge(common, {
    mode: 'development',
    devtool: 'inline-source-map',
    devServer: {
        compress: true,
        hot: true,
        open: true,
        static: path.resolve(process.cwd(), 'public'),
        // Live aircraft for the demo: adsb.lol's open ADS-B API, which does
        // not answer cross-origin requests from browsers.
        proxy: [{ context: ['/adsb'], target: 'https://api.adsb.lol', changeOrigin: true, pathRewrite: { '^/adsb': '' },
            headers: { 'User-Agent': 'babylonjs-mapping-globe-demo/1.0 (+https://github.com/djzielin/babylonjs-mapping)' } }],
        headers: {
            'Access-Control-Allow-Origin': '*'
        }
    }
});
