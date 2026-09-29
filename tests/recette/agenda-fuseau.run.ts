import { instantPourHeureParis, murParis } from "../../apps/poste/src/agenda/fuseauParis.ts";

function fail(message: string): never {
  console.error(`agenda-fuseau: FAIL — ${message}`);
  process.exit(1);
}

const stocke = instantPourHeureParis("2026-10-27", 9, 30);
const mur = murParis(stocke);
if (mur.jour !== "2026-10-27" || mur.heure !== "09" || mur.minute !== "30") {
  fail(`9 h 30 le 27/10/2026 lu ${mur.jour} ${mur.heure}:${mur.minute} (${stocke})`);
}

const avant = murParis(instantPourHeureParis("2026-10-24", 9, 30));
if (avant.jour !== "2026-10-24" || avant.heure !== "09" || avant.minute !== "30") {
  fail(`9 h 30 le 24/10/2026 lu ${avant.jour} ${avant.heure}:${avant.minute}`);
}

const naif = murParis("2026-10-27T09:30:00.000Z");
if (naif.heure === "09" && naif.minute === "30") {
  fail("essai négatif muet : un instant UTC naïf 09:30 passe pour 9 h 30 à Paris");
}

const ete = murParis("2026-10-27T07:30:00.000Z");
if (ete.heure === "09" && ete.minute === "30") {
  fail("essai négatif muet : le décalage d'été (07:30 UTC) passe pour 9 h 30 après l'heure d'hiver");
}

if (stocke === "2026-10-27T09:30:00.000Z" || stocke === "2026-10-27T07:30:00.000Z") {
  fail(`instant stocké égal à un décalage faux (${stocke})`);
}

console.log(`agenda-fuseau: OK — 27/10/2026 09:30 Europe/Paris = ${stocke}`);
