const path = require('path');
const fs = require('fs');
const { DefinePlugin } = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

const appDirectory = fs.realpathSync(process.cwd());

const keyFile = path.join(appDirectory, 'mapbox-key.txt');
const mapboxToken = process.env.MAPBOX_PUBLIC_TOKEN || (fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8').trim() : '');

module.exports = {
    resolve: {
        extensions: ['.ts', '.js']
    },
    output: {
        filename: 'js/babylonBundle.js',
        path: path.resolve('./dist/')
    },
    module: {
        rules: [
            {
                test: /\.(js|mjs|jsx|ts|tsx)$/,
                loader: 'source-map-loader',
                enforce: 'pre'
            },
            {
                test: /\.m?js$/,
                resolve: {
                    fullySpecified: false
                }
            },
            {
                test: /\.tsx?$/,
                loader: 'ts-loader',
                exclude: /node_modules/
            }
        ]
    },
    plugins: [
        new CleanWebpackPlugin(),
        new DefinePlugin({ DEMO_MAPBOX_TOKEN: JSON.stringify(mapboxToken) }),
        new HtmlWebpackPlugin({
            inject: true,
            template: path.resolve(appDirectory, 'index.html')
        })
    ]
};
