// Thin wrapper around the TypeORM CLI.
//
// npm workspace hoisting can put `typeorm` in the repo root's node_modules
// while `ts-node` lands only in this package's node_modules (or vice versa).
// The `typeorm-ts-node-commonjs` bin resolves `ts-node` relative to wherever
// `typeorm` itself was hoisted to, which breaks depending on the hoisting
// layout npm picked. Requiring both modules from *this* file's location
// resolves them the normal Node way (walking up from here), regardless of
// where npm decided to hoist either package.
require('ts-node/register');
require(require.resolve('typeorm/cli.js'));
