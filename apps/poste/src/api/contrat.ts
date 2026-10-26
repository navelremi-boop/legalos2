import type { components } from "@/api/schema";

/**
 * Contrat de l'API (D9) : types générés depuis `crates/api/openapi.json` par `pnpm --filter @legal-os/poste gen:api`
 * (`schema.d.ts`, ne se modifie jamais à la main ; un contrôle de la CI vérifie qu'il est à jour).
 */
export type { components, paths } from "@/api/schema";

/** Schéma nommé du contrat. */
export type Schema<N extends keyof components["schemas"]> = components["schemas"][N];

/**
 * Objet reçu de l'API, lu sans confiance : chaque valeur reste `unknown` (les lecteurs vérifient le type à l'exécution)
 * mais les **noms** des clés viennent du contrat. Une clé renommée ou retirée côté API fait échouer `tsc`, au lieu de
 * produire silencieusement une valeur par défaut sur le poste.
 */
export type Recu<N extends keyof components["schemas"]> = { [K in keyof Schema<N>]?: unknown };

/** Corps de requête d'une opération du contrat, tel que l'API l'attend (types exacts). */
export type CorpsRequete<N extends keyof components["schemas"]> = Schema<N>;
