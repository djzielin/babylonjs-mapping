const { merge } = require('webpack-merge');
const path = require('path');
const common = require('./webpack.common.js');
module.exports = merge(common, {
    mode: 'development',
    devtool: 'source-map',
    devServer: {
        host: '0.0.0.0',
        port: 8080,
        static: path.resolve(__dirname, 'public'),
        // For Quest: npm start -- --server-type https, then trust the certificate.
        // The deployed GitHub Pages demo already uses HTTPS.
        server: 'http',
    },
});
