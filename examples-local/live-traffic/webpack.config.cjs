const path = require('node:path');
module.exports = {
  entry: './src/index.ts',
  output: { filename: 'app.js', path: path.resolve(__dirname, 'dist'), clean: true },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: { '@babylonjs/core': path.dirname(require.resolve('@babylonjs/core/package.json')) },
  },
  module: { rules: [
    { test: /\.tsx?$/, loader: 'ts-loader', exclude: /node_modules/ },
    { test: /\.m?js$/, resolve: { fullySpecified: false } },
  ] },
  devtool: 'source-map',
};
