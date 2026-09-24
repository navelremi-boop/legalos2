import eslint from "@eslint/js";
import css from "@eslint/css";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import { legalOsPoste } from "./eslint-rules/index.mjs";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "src-tauri/**",
      "node_modules/**",
      "eslint-rules/**",
      "eslint.config.js",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [eslint.configs.recommended, ...tseslint.configs.strictTypeChecked],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "legal-os-poste": legalOsPoste,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "legal-os-poste/no-hardcoded-colors": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/\\brgb\\s*\\(/i]",
          message:
            "Couleur en dur rgb() interdite : utiliser les jetons de design/tokens.css.",
        },
        {
          selector: "Literal[value=/\\bhsl\\s*\\(/i]",
          message:
            "Couleur en dur hsl() interdite : utiliser les jetons de design/tokens.css.",
        },
        {
          selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b/]",
          message:
            "Couleur en dur #hex interdite : utiliser les jetons de design/tokens.css.",
        },
        {
          selector: "TemplateElement[value.raw=/\\brgb\\s*\\(/i]",
          message:
            "Couleur en dur rgb() interdite : utiliser les jetons de design/tokens.css.",
        },
        {
          selector: "TemplateElement[value.raw=/\\bhsl\\s*\\(/i]",
          message:
            "Couleur en dur hsl() interdite : utiliser les jetons de design/tokens.css.",
        },
        {
          selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}\\b/]",
          message:
            "Couleur en dur #hex interdite : utiliser les jetons de design/tokens.css.",
        },
      ],
    },
  },
  {
    files: ["src/**/*.css"],
    plugins: { css, "legal-os-poste": legalOsPoste },
    language: "css/css",
    rules: {
      "legal-os-poste/no-hardcoded-colors": "error",
    },
  },
);
