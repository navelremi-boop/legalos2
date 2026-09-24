/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LEGALOS_RECETTE_HOOKS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
