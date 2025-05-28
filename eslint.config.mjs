import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";
import pluginJest from "eslint-plugin-jest";

export default defineConfig([
  { files: ["**/*.{js,mjs,cjs}"], plugins: { js }, extends: ["js/recommended"] },
  { files: ["**/*.js"], languageOptions: { sourceType: "commonjs" } },
  { files: ["**/*.{js,mjs,cjs}"], languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  { files: ["**/*.test.js"], languageOptions: { globals: { ...globals.jest } }, plugins: { jest: pluginJest } },
  {
    rules: {
      "no-unused-vars": [
        "warn", // or "error"
        {
          "argsIgnorePattern": "^_",
        }
      ]
    }
  },
  {}
]);