/**
 * Serveur Vite de développement pour les recettes d'écran (Playwright sur la galerie `?galerie=1`).
 * Sous Windows, `child.kill()` ne tue que cmd.exe (shell: true) et laisse le port 1420 occupé :
 * l'arrêt passe par `taskkill /T`.
 */
import { spawn, spawnSync } from "node:child_process";

export const URL_GALERIE = "http://127.0.0.1:1420/?galerie=1";

export function demarrerVite(racine) {
  return spawn(
    "pnpm",
    ["--filter", "@legal-os/poste", "exec", "vite", "--host", "127.0.0.1", "--port", "1420"],
    { cwd: racine, shell: true, stdio: "ignore" },
  );
}

export function arreterVite(child) {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill();
  }
}

export async function attendreUrl(url, delaiMs) {
  const debut = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* pas encore */
    }
    if (Date.now() - debut > delaiMs) throw new Error(`${url} ne répond pas après ${delaiMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

/** Luminance relative WCAG d'une couleur « rgb(…) » ou « rgba(…) » (alpha ignoré). */
export function luminance(rgb) {
  const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(rgb);
  if (m === null) throw new Error(`couleur illisible : ${rgb}`);
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
