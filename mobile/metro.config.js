const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
const root = path.resolve(__dirname, '..');
config.watchFolders = [path.join(root, 'src/core')];
config.resolver.nodeModulesPaths = [path.join(__dirname, 'node_modules')];
config.resolver.extraNodeModules = { typebox: path.join(__dirname, 'node_modules/typebox') };
module.exports = config;
