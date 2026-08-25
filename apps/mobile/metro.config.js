const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(projectRoot);

// `packages/*` are consumed as TypeScript source through `file:` links, so
// Metro has to watch and transform files that live outside `apps/mobile`.
config.watchFolders = [monorepoRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

/*
 * Hierarchical lookup stays ON, which is Node's normal resolution: walk up the
 * directory tree through every parent `node_modules`.
 *
 * This was previously disabled, which is the setup Expo's monorepo guide
 * suggests for hoisted workspaces. It does not hold here. `apps/mobile` is not
 * a workspace member, so npm installs it as its own tree and is free to nest a
 * package instead of hoisting it. It does exactly that with `expo-modules-core`,
 * `expo-asset`, and `expo-keep-awake`, which land in `node_modules/expo/
 * node_modules/`. With the lookup disabled Metro only ever checks the two paths
 * above, never a nested one, and the bundle dies on `expo-modules-core` before
 * a single line of app code is reached.
 *
 * Whether npm hoists or nests varies with install order, so leaving this off
 * makes bundling depend on luck. Node's own algorithm handles both.
 */

module.exports = config;
