#!/usr/bin/env node
/**
 * S9 — XML CII EN 16931 (schematron officiel) et PDF/A-3b (veraPDF).
 * Les binaires Typst, Saxon et veraPDF sont locaux ou fournis par la CI.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
const xml = join(root, "target/facture-cii.xml");
const xsl = join(root, "tests/recette/en16931/EN16931-CII-validation.xslt");
const svrl = join(root, "target/svrl.xml");
const pdf = join(root, "target/facture.pdf");
const typDir = join(root, "tests/recette/facturx");

function fail(message) {
  console.error(`s9-facturx: FAIL — ${message}`);
  process.exit(1);
}

function run(cmd, args) {
  const enfant = spawnSync(cmd, args, { cwd: root, encoding: "utf8" });
  if (enfant.status !== 0) {
    fail(`${cmd} ${args.join(" ")} → ${enfant.status}\n${(enfant.stderr || enfant.stdout || "").slice(-500)}`);
  }
  return enfant.stdout ?? "";
}

if (!existsSync(xml)) {
  fail("target/facture-cii.xml absent — cargo test -p legalos-api --lib cii_contient_le_total");
}
copyFileSync(xml, join(typDir, "factur-x.xml"));

const saxonCp = process.env.SAXON_CP;
if (saxonCp) {
  run("java", ["-cp", saxonCp, "net.sf.saxon.Transform", `-s:${xml}`, `-xsl:${xsl}`, `-o:${svrl}`]);
} else {
  run("docker", [
    "run",
    "--rm",
    "-v",
    `${root}:/work`,
    "-w",
    "/work",
    "eclipse-temurin:21-jre-alpine",
    "java",
    "-cp",
    "/work/target/Saxon-HE-12.5.jar:/work/target/xmlresolver-5.2.2.jar",
    "net.sf.saxon.Transform",
    "-s:/work/target/facture-cii.xml",
    "-xsl:/work/tests/recette/en16931/EN16931-CII-validation.xslt",
    "-o:/work/target/svrl.xml",
  ]);
}
const rapport = readFileSync(svrl, "utf8");
if (rapport.includes("failed-assert")) fail("schematron : assertion en échec");
console.log("s9-facturx: schematron EN 16931 sans échec");

const typst =
  process.env.TYPST ??
  join(root, "target/typst/typst-x86_64-pc-windows-msvc/typst.exe");
if (!existsSync(typst) && !process.env.TYPST) fail(`typst introuvable (${typst})`);
run(process.env.TYPST ?? typst, [
  "compile",
  "--pdf-standard",
  "a-3b",
  join(typDir, "facture.typ"),
  pdf,
]);

const verapdf = process.env.VERAPDF;
if (verapdf) {
  const sortie = run(verapdf, ["--flavour", "3b", pdf]);
  if (!sortie.includes('isCompliant="true"')) fail("veraPDF non conforme");
} else {
  const sortie = run("docker", [
    "run",
    "--rm",
    "-v",
    `${root}/target:/work`,
    "-w",
    "/work",
    "eclipse-temurin:21-jre-alpine",
    "sh",
    "/work/verapdf/verapdf",
    "--flavour",
    "3b",
    "/work/facture.pdf",
  ]);
  if (!sortie.includes('isCompliant="true"')) fail("veraPDF non conforme");
}
console.log("s9-facturx: OK — PDF/A-3b conforme, XML EN 16931 valide");
