import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_INSTANCE_URL } from "@/lib/auth/client";
import {
  isOnboardingComplete,
  loadInstanceUrl,
  loadSessionTokens,
} from "@/lib/session/storage";
import { DEMO_CABINET_ID } from "@/sync/demoCabinet";
import { FirstLaunchFlow } from "@/onboarding/FirstLaunchFlow";
import { InitialSyncScreen } from "@/onboarding/InitialSyncScreen";
import { JourneePreview } from "@/screens/JourneePreview";
import { closePowerSyncDatabase, getPowerSyncDatabase } from "@/sync/database";
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

  useEffect(() => {
    void (async () => {
      const has = await invoke<boolean>("keyring_has_refresh").catch(() => false);
      if (has) {
        const database = await getPowerSyncDatabase();
        const rows = await database.getAll<{ id: string }>(
          "SELECT id FROM cabinets WHERE id = ? LIMIT 1",
          [DEMO_CABINET_ID],
        );
        if (rows.length > 0) setLocalReady(true);
      }
      setEcranPret(true);
    })();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolveThemeSystem();
  }, []);

  useEffect(() => {
    if (authenticated && syncDone) {
      exposeRecetteHooksIfEnabled();
    }
  }, [authenticated, syncDone]);

  const handleFirstLaunchComplete = useCallback((result: { instanceUrl: string }) => {
    setInstanceUrl(result.instanceUrl);
    setAuthenticated(true);
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
  }, []);

  if (!ecranPret) {
    return null;
  }

  if (!authenticated && localReady) {
    return (
      <>
        <JourneePreview instanceUrl={instanceUrl} />
        <FirstLaunchFlow
          initialInstanceUrl={instanceUrl}
          onComplete={handleFirstLaunchComplete}
        />
      </>
    );
  }

  if (!authenticated) {
    return (
      <FirstLaunchFlow initialInstanceUrl={instanceUrl} onComplete={handleFirstLaunchComplete} />
    );
  }

  if (!syncDone && loadSessionTokens().accessToken) {
    return (
      <InitialSyncScreen
        instanceUrl={instanceUrl}
        onComplete={handleSyncComplete}
        onError={handleSyncError}
      />
    );
  }

  return (
    <JourneePreview instanceUrl={instanceUrl} onResetSession={handleResetSession} />
  );
}

export default App;
