const { merge } = require('webpack-merge');
const path = require('path');
const common = require('./webpack.common.js');
module.exports = merge(common, {
    mode: 'development',
    devtool: 'source-map',
    devServer: {
        host: '0.0.0.0',
        port: 8080,
        static: [
            { directory: path.resolve(__dirname, 'public') },
            // Reuse the standalone demo's ignored configuration in place;
            // no key is duplicated into the WebXR demo or its build output.
            { directory: path.resolve(__dirname, '../google-3d-tiles/public'),
              publicPath: '/google-3d-tiles', serveIndex: false, watch: false },
        ],
        // For Quest: npm start -- --server-type https, then trust the certificate.
        // The deployed GitHub Pages demo already uses HTTPS.
        server: 'http',
    },
});
