/** @type {import('jest').Config} */
const config = {
  testEnvironment: "jsdom",
  transform: {
    "^.+\\.(ts|tsx)$": [
      "ts-jest",
      {
        tsconfig: {
          jsx: "react-jsx",
          esModuleInterop: true,
          moduleResolution: "node",
          paths: {
            "@/*": ["./*"],
          },
        },
      },
    ],
  },
  moduleNameMapper: {
    // Handle @/ path alias
    "^@/(.*)$": "<rootDir>/$1",
    // Handle CSS/image imports
    "\\.(css|less|scss|sass)$": "identity-obj-proxy",
    "\\.(png|jpg|jpeg|gif|svg)$": "<rootDir>/__mocks__/fileMock.js",
    // uuid v13 is pure ESM — map to a CJS-compatible stub for Jest
    "^uuid$": "<rootDir>/__mocks__/uuid.js",
  },
  setupFiles: ["<rootDir>/jest.setup.js"],
  testMatch: ["**/__tests__/**/*.test.(ts|tsx)", "**/*.test.(ts|tsx)"],
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json"],
  testPathIgnorePatterns: ["/node_modules/", "/.next/"],
  globals: {
    "ts-jest": {
      diagnostics: false,
    },
  },
};

module.exports = config;
