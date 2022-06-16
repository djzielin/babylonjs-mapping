const merge = require('webpack-merge');
const path = require('path');
const fs = require('fs');
const common = require('./webpack.common.js');

// App directory
const appDirectory = fs.realpathSync(process.cwd());

module.exports = merge(common, {
    mode: 'development',
    devtool: 'inline-source-map',

    devServer: {
        contentBase: path.resolve(appDirectory),
        publicPath: '/',
        compress: true,
        hot: true,
        open: "chrome",
        disableHostCheck: true,

        // enable to access from other devices on the network
        useLocalIp: true,
        host: '0.0.0.0', 

        // if you aren’t using ngrok, and want to connect locally, webxr requires https
        // https: true,

        headers:{
            "Access-Control-Allow-Origin": "*"
        }
    }    
});