const fs = require('node:fs');
const path = require('node:path');

// Keep production assets consistent with webpack-dev-server's public directory.
module.exports = class CopyPublicAssets {
    apply(compiler) {
        const root = path.join(compiler.context, 'public');
        compiler.hooks.thisCompilation.tap('CopyPublicAssets', compilation => {
            compilation.contextDependencies.add(root);
            compilation.hooks.processAssets.tap({
                name: 'CopyPublicAssets',
                stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL,
            }, () => {
                if (!fs.existsSync(root)) return;
                const visit = directory => {
                    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                        const file = path.join(directory, entry.name);
                        if (entry.isDirectory()) visit(file);
                        else if (entry.isFile()) {
                            compilation.fileDependencies.add(file);
                            const name = path.relative(root, file).split(path.sep).join('/');
                            if (!compilation.getAsset(name))
                                compilation.emitAsset(name, new compiler.webpack.sources.RawSource(fs.readFileSync(file)));
                        }
                    }
                };
                visit(root);
            });
        });
    }
};
