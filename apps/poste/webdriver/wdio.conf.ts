import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ici = dirname(fileURLToPath(import.meta.url));
const exe = process.platform === "win32" ? "legal-os-poste.exe" : "legal-os-poste";
const candidats = [
  join(ici, "../src-tauri/target/debug", exe),
  join(ici, "../../../target/debug", exe),
];
const depuisEnv = process.env.LEGALOS_POSTE_EXE;
const application = depuisEnv && existsSync(depuisEnv)
  ? depuisEnv
  : candidats.find((chemin) => existsSync(chemin));
if (application === undefined) {
  throw new Error(`binaire test-webdriver absent (${candidats.join(" | ")})`);
}

export const config = {
  runner: "local",
  specs: [join(ici, "premier-ecran.spec.ts")],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "tauri",
      "tauri:options": {
        application,
      },
    },
  ],
  logLevel: "info",
  framework: "mocha",
  reporters: ["spec"],
  services: [["@wdio/tauri-service", { driverProvider: "embedded" }]],
  mochaOpts: {
    timeout: 120_000,
  },
};
