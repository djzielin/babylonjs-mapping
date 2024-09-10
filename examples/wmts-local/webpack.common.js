const path = require('path');

console.log('Webpack configuration:', JSON.stringify(module.exports, null, 2));


const fs = require('fs');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const {
    CleanWebpackPlugin
} = require('clean-webpack-plugin');

// App directory
const appDirectory = fs.realpathSync(process.cwd());

//console.log('Resolved path:', path.resolve(__dirname, '../../lib'));  // Add this line

module.exports = {
    resolve: {
        extensions: ['.ts', '.js']
    },
    output: {
        filename: 'js/babylonBundle.js',
        path: path.resolve(__dirname,"./dist/")
    },
    module: {
        rules: [{
                test: /\.(js|mjs|jsx|ts|tsx)$/,
                loader: 'source-map-loader',
                enforce: 'pre',
            },
            { //per https://stackoverflow.com/questions/70964723/webpack-5-in-ceate-react-app-cant-resolve-not-fully-specified-routes
                test: /\.m?js$/,
                resolve: {
                    fullySpecified: false,
                },
            },
            { 
                test: /\.tsx?$/,
                loader: 'ts-loader',
                exclude: /node_modules/
            },
            {
                test: /\.(png|jpg|gif|env|glb|stl)$/i,
                use: [{
                    loader: 'url-loader',
                    options: {
                        limit: 8192,
                    },
                }, ],
            }
        ]
    },
    plugins: [
        new CleanWebpackPlugin(),
        new HtmlWebpackPlugin({
            inject: true,
            template: path.resolve(appDirectory, "index.html"),
        }),
    ],
}