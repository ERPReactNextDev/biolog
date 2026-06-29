// CJS stub for uuid v13 (pure ESM) — used only in Jest test environments.
// Provides the same interface as the real package but uses Node's built-in
// crypto.randomUUID() so no bundler/ESM support is required.

const { randomUUID } = require("crypto");

function v4() {
  return randomUUID();
}

function v1() {
  return randomUUID();
}

function v3() {
  return randomUUID();
}

function v5() {
  return randomUUID();
}

module.exports = { v4, v1, v3, v5 };
module.exports.v4 = v4;
module.exports.v1 = v1;
module.exports.v3 = v3;
module.exports.v5 = v5;
module.exports.default = { v4, v1, v3, v5 };
