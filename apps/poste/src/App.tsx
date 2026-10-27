import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { CoqueApp } from "@/coque/CoqueApp";
import { DEFAULT_INSTANCE_URL } from "@/lib/auth/client";
import { assurerJetonAcces } from "@/lib/session/rafraichir";
import {
  isOnboardingComplete,
  loadInstanceUrl,
  loadSessionTokens,
} from "@/lib/session/storage";
import { DEMO_CABINET_ID } from "@/sync/demoCabinet";
import { FirstLaunchFlow } from "@/onboarding/FirstLaunchFlow";
import { InitialSyncScreen } from "@/onboarding/InitialSyncScreen";
import { closePowerSyncDatabase, getPowerSyncDatabase } from "@/sync/database";
import { ecranDuPoste } from "@/sync/ecranDuPoste";
import { exposeRecetteHooksIfEnabled } from "@/sync/recetteHooks";

const STORAGE_SYNC_DONE = "legalos.initial_sync_done";

function resolveThemeSystem(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function App() {
  const [instanceUrl, setInstanceUrl] = useState(
    () => loadInstanceUrl() ?? DEFAULT_INSTANCE_URL,
  );
  const [authenticated, setAuthenticated] = useState(() => isOnboardingComplete());
  const [syncDone, setSyncDone] = useState(
    () => localStorage.getItem(STORAGE_SYNC_DONE) === "1",
  );
  const [localReady, setLocalReady] = useState(false);
  const [ecranPret, setEcranPret] = useState(false);
  /** Demande explicite de reconnexion (sinon travail hors ligne sur données locales). */
  const [forceLogin, setForceLogin] = useState(false);

  useEffect(() => {
    void (async () => {
      // Données locales suffisent pour le travail hors ligne ; le trousseau sert à la reprise API.
      try {
        const database = await getPowerSyncDatabase();
        const rows = await database.getAll<{ id: string }>(
          "SELECT id FROM cabinets WHERE id = ? LIMIT 1",
          [DEMO_CABINET_ID],
        );
        if (rows.length > 0) setLocalReady(true);
      } catch {
        const has = await invoke<boolean>("keyring_has_refresh").catch(() => false);
        if (has) setLocalReady(false);
      }
      setEcranPret(true);
    })();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolveThemeSystem();
  }, []);

  useEffect(() => {
    // Toujours exposer en mode recette (y compris redémarrage hors ligne).
    exposeRecetteHooksIfEnabled();
  }, []);

  // Après la sync initiale, reconnecter PowerSync dès qu'un jeton est en mémoire :
  // sans cela un redémarrage « sync déjà faite » n'appelle jamais connect_powersync
  // et la file ps_crud ne part pas (conflits hors ligne, S5, etc.).
  useEffect(() => {
    if (!authenticated || (!syncDone && !localReady)) return;
    const arret = { courant: false };
    void (async () => {
      const accessToken = await assurerJetonAcces();
      if (accessToken === null) return;
      try {
        const database = await getPowerSyncDatabase();
        if (arret.courant) return;
        await invoke("connect_powersync", {
          handle: database.rustHandle,
          instanceUrl,
          accessToken,
        });
      } catch {
        /* reconnexion : nouvel essai à la prochaine auth */
      }
    })();
    return () => {
      arret.courant = true;
    };
  }, [authenticated, syncDone, localReady, instanceUrl]);

  const handleFirstLaunchComplete = useCallback((result: { instanceUrl: string }) => {
    setInstanceUrl(result.instanceUrl);
    setAuthenticated(true);
    setForceLogin(false);
    setSyncDone(false);
    localStorage.removeItem(STORAGE_SYNC_DONE);
  }, []);

  const handleSyncComplete = useCallback(() => {
    localStorage.setItem(STORAGE_SYNC_DONE, "1");
    setSyncDone(true);
  }, []);

  const handleSyncError = useCallback(() => {
    setSyncDone(false);
    localStorage.removeItem(STORAGE_SYNC_DONE);
  }, []);

  const handleResetSession = useCallback(() => {
    void closePowerSyncDatabase();
    localStorage.removeItem(STORAGE_SYNC_DONE);
    setSyncDone(false);
    setAuthenticated(false);
    setForceLogin(true);
  }, []);

  const handleReconnect = useCallback(() => {
    setForceLogin(true);
    setAuthenticated(false);
  }, []);

  const ecran = ecranDuPoste({
    ecranPret,
    authenticated,
    localReady,
    forceLogin,
    syncDone,
    aUnJeton: loadSessionTokens().accessToken !== null && loadSessionTokens().accessToken !== "",
  });

  if (ecran === "attente") return null;

  // Données locales déjà présentes : la coque s'ouvre tout de suite. L'état du seau
  // (historique compacté ou non) ne retient pas un poste déjà synchronisé.
  if (ecran === "coque") {
    return (
      <CoqueApp
        instanceUrl={instanceUrl}
        onResetSession={handleResetSession}
        onReconnect={handleReconnect}
      />
    );
  }

  if (ecran === "coque-et-connexion") {
    return (
      <>
        <CoqueApp instanceUrl={instanceUrl} />
        <FirstLaunchFlow
          initialInstanceUrl={instanceUrl}
          onComplete={handleFirstLaunchComplete}
        />
      </>
    );
  }

  if (ecran === "connexion") {
    return (
      <FirstLaunchFlow initialInstanceUrl={instanceUrl} onComplete={handleFirstLaunchComplete} />
    );
  }

  return (
    <InitialSyncScreen
      instanceUrl={instanceUrl}
      onComplete={handleSyncComplete}
      onError={handleSyncError}
    />
  );
}

export default App;
