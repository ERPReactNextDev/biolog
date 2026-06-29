// jest.setup.js
// Global test setup

// Polyfill structuredClone if needed
if (typeof structuredClone === "undefined") {
  global.structuredClone = (obj) => JSON.parse(JSON.stringify(obj));
}

// Suppress Next.js server-component warnings in JSDOM
process.env.NODE_ENV = "test";

// Provide a basic TextEncoder/TextDecoder for jsdom
const { TextEncoder, TextDecoder } = require("util");
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
