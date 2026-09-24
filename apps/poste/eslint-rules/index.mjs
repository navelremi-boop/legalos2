import { noHardcodedColors } from "./no-hardcoded-colors.mjs";

/** @type {import('eslint').ESLint.Plugin} */
export const legalOsPoste = {
  meta: { name: "legal-os-poste" },
  rules: {
    "no-hardcoded-colors": noHardcodedColors,
  },
};
