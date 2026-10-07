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

export function repondre(objet, code = 0) {
  process.stdout.write(JSON.stringify(objet));
  process.exit(code);
}

/**
 * Format de l'entrée : « claude » (Claude Code : hook_event_name, tool_name, tool_input)
 * ou « cursor » (command, file_path, workspace_roots à plat).
 */
export function formatEntree(valeur) {
  const v = valeur ?? {};
  return typeof v.hook_event_name === "string" || "tool_name" in v || "tool_input" in v ? "claude" : "cursor";
}

export function commandeDe(valeur) {
  return String(valeur.tool_input?.command ?? valeur.command ?? "");
}

export function fichierDe(valeur) {
  return String(valeur.tool_input?.file_path ?? valeur.file_path ?? "");
}

/** Racines du dépôt : `workspace_roots` (Cursor) ou `cwd` (Claude Code). */
export function racinesDe(valeur) {
  if (Array.isArray(valeur.workspace_roots)) return valeur.workspace_roots.map(String);
  return typeof valeur.cwd === "string" ? [valeur.cwd] : [];
}

/** Dossier du projet : variable de l'outil, sinon dossier courant. */
export function dossierProjet() {
  return process.env.CURSOR_PROJECT_DIR || process.env.CLAUDE_PROJECT_DIR || process.cwd();
}

/**
 * « Pas d'objection » du garde. Cursor : allow explicite. Claude Code : réponse vide, pour que la liste
 * d'autorisation et le mode de permission décident ; un « allow » explicite les court-circuiterait.
 */
export function autoriser(valeur) {
  repondre(formatEntree(valeur) === "claude" ? {} : { permission: "allow" });
}

/** Refus. Cursor : permission deny ; Claude Code : hookSpecificOutput.permissionDecision deny. */
export function refuser(valeur, messageUtilisateur, messageAgent = "") {
  if (formatEntree(valeur) === "claude") {
    repondre({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: [messageUtilisateur, messageAgent].filter(Boolean).join(" "),
      },
    });
  }
  const reponse = { permission: "deny", user_message: messageUtilisateur };
  if (messageAgent) reponse.agent_message = messageAgent;
  repondre(reponse);
}

/**
 * Refus quand l'entrée est illisible : le format est inconnu, donc réponse dans les deux formats,
 * raison sur stderr et code 2 (blocage dans les deux outils) : fail-closed.
 */
export function refuserIllisible(messageUtilisateur, messageAgent = "") {
  console.error(messageUtilisateur);
  const reponse = {
    permission: "deny",
    user_message: messageUtilisateur,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: [messageUtilisateur, messageAgent].filter(Boolean).join(" "),
    },
  };
  if (messageAgent) reponse.agent_message = messageAgent;
  repondre(reponse, 2);
}
