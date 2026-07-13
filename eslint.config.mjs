import { defineConfig, globalIgnores } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig([
    // next lint (the removed v16 command this config replaces) only ever
    // linted the actual app source by its own built-in default scoping —
    // it silently never touched the dozens of loose one-off root-level
    // scripts (update-*.js, wipe.js, etc.) or ai-debt-os/ (a stale archived
    // copy of an older version of this app, already excluded from
    // tsconfig.json's own `exclude`). Plain `eslint .` has no such default
    // scoping and lints everything not explicitly ignored, so without this
    // ignore it surfaced ~575 pre-existing findings in code that was never
    // part of the linted surface before — restoring the prior effective
    // scope here keeps this purely a tooling migration, not a lint-policy
    // change.
    globalIgnores([
        "**/node_modules/", "**/.next/", "**/tests/", "**/scripts/",
        "ai-debt-os/**", "_docbuild/**", "_handover/**",
        "*.js", "*.mjs", "*.cjs", "*.ts",
    ]),
    ...nextCoreWebVitals,
    ...nextTypescript,
    // Kept as its own config object (not merged into the extends block
    // above): mixing a sibling `rules` key into the same object as `extends`
    // stopped ESLint from resolving `react-hooks/exhaustive-deps` — "could
    // not find plugin react-hooks" — even though nextCoreWebVitals genuinely
    // registers it. Re-declaring the plugin explicitly here removes the
    // dependency on that cross-object resolution behaving a particular way.
    {
        plugins: {
            "react-hooks": reactHooksPlugin,
        },
        rules: {
            "no-console": ["error", {
                allow: ["warn", "error"],
            }],

            "@next/next/no-img-element": "error",
            "react-hooks/exhaustive-deps": "warn",
        },
    },
]);