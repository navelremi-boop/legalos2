// Utilitaires communs aux hooks (Node, multiplateforme : Windows, macOS, Linux).

/**
 * Lit l'entrée JSON sur stdin.
 * En cas d'échec (vide, JSON illisible), résout `{ ok: false, erreur }` — jamais un objet vide silencieux.
 */
export function lireEntree() {
  return new Promise((resolve) => {
    const morceaux = [];
    process.stdin.on("data", (c) => morceaux.push(c));
    process.stdin.on("end", () => {
      const texte = decoder(Buffer.concat(morceaux)).replace(/^\uFEFF/, "").trim();
      if (!texte) {
        resolve({ ok: false, erreur: "stdin vide" });
        return;
      }
      try {
        const valeur = JSON.parse(texte);
        if (valeur === null || typeof valeur !== "object" || Array.isArray(valeur)) {
          resolve({ ok: false, erreur: "stdin JSON : objet attendu" });
          return;
        }
        resolve({ ok: true, valeur });
      } catch {
        console.error("hook: stdin JSON illisible");
        resolve({ ok: false, erreur: "stdin JSON illisible" });
      }
    });
  });
}

function decoder(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString("utf16le");
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const inverse = Buffer.from(buf);
    inverse.swap16();
    return inverse.toString("utf16le");
  }
  let nuls = 0;
  const echantillon = Math.min(buf.length, 64);
  for (let i = 1; i < echantillon; i += 2) if (buf[i] === 0) nuls += 1;
  if (echantillon >= 8 && nuls > echantillon / 4) return buf.toString("utf16le");
  return buf.toString("utf8");
}

export function repondre(objet) {
  process.stdout.write(JSON.stringify(objet));
  process.exit(0);
}
