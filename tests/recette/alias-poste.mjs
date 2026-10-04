import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const posteSrc = join(dirname(fileURLToPath(import.meta.url)), "../../apps/poste/src");

export function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const fichier = join(posteSrc, `${specifier.slice(2)}.ts`);
    return next(pathToFileURL(fichier).href, context);
  }
  return next(specifier, context);
}
