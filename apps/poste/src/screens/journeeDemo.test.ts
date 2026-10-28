import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JOURNEE_DEMO } from "./journeeDemo.ts";

describe("galerie de La journée", () => {
  it("propose Classer sur chaque mail déjà suggéré", () => {
    const suggeres = JOURNEE_DEMO.mails.filter((mail) => mail.meta.startsWith("Suggéré"));
    assert.equal(suggeres.length, 2);
    for (const mail of suggeres) {
      const classer = mail.classer;
      if (!classer) throw new Error("classement absent");
      assert.equal(classer.messageId, mail.id);
      assert.notEqual(classer.dossierId, "");
    }
  });
});
