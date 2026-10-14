import { emettreNotificationBureau } from "@/lib/notificationBureau";
import { getPowerSyncDatabase } from "@/sync/database";

/** Émet une notification Tauri pour chaque rappel échu encore non signalé sur ce poste. */
export async function emettreRappelsEchus(): Promise<void> {
  const database = await getPowerSyncDatabase();
  await database.execute(
    "CREATE TABLE IF NOT EXISTS rappels_emis (id TEXT PRIMARY KEY, emis_le TEXT NOT NULL)",
  );
  const maintenant = new Date().toISOString();
  const deja = await database.getAll<{ id: string }>("SELECT id FROM rappels_emis");
  const connus = new Set(deja.map((ligne) => ligne.id));
  const candidats = await database.getAll<{ id: string; titre: string; type_element: string }>(
    `SELECT id, titre, type_element FROM agenda_elements
     WHERE rappel_le IS NOT NULL AND rappel_le <= ?`,
    [maintenant],
  );
  const dus = candidats.filter((ligne) => !connus.has(ligne.id));
  for (const ligne of dus) {
    if (!(await emettreNotificationBureau(ligne.titre, ligne.type_element))) return;
    await database.execute("INSERT INTO rappels_emis (id, emis_le) VALUES (?, ?)", [
      ligne.id,
      maintenant,
    ]);
  }
}
