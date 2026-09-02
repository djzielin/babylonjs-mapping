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
        headers: {
            'Access-Control-Allow-Origin': '*'
        }
    }
});
