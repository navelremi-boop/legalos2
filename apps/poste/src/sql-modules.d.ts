declare module "*.sql?raw" {
  const contenu: string;
  export default contenu;
}

declare module "*.wasm?url" {
  const url: string;
  export default url;
}
