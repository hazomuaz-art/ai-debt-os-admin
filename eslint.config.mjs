import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig([
    globalIgnores(["**/node_modules/", "**/.next/", "**/tests/", "**/scripts/"]),
    {
        extends: [...nextCoreWebVitals, ...nextTypescript],

        rules: {
            "no-console": ["error", {
                allow: ["warn", "error"],
            }],

            "@next/next/no-img-element": "error",
            "react-hooks/exhaustive-deps": "warn",
        },
    },
]);