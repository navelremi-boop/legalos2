import { $, browser } from "@wdio/globals";

describe("premier écran", () => {
  it("affiche l'accueil du poste", async () => {
    await browser.waitUntil(
      async () => {
        const texte = await browser.execute(() => document.body?.innerText ?? "");
        return typeof texte === "string" && texte.trim().length > 0;
      },
      { timeout: 60_000, timeoutMsg: "le document est resté vide" },
    );
    const champ = await $("#instance-url");
    const barre = await $("[data-testid=barre-haut]");
    const champOk = await champ.isExisting();
    const barreOk = await barre.isExisting();
    if (!champOk && !barreOk) {
      const texte = await browser.execute(() => document.body?.innerText?.slice(0, 500) ?? "");
      throw new Error(String(texte));
    }
  });
});
