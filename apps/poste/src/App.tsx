import { useCallback, useEffect, useState } from "react";
import { DEFAULT_INSTANCE_URL } from "@/lib/auth/client";
import { isOnboardingComplete, loadInstanceUrl } from "@/lib/session/storage";
import { FirstLaunchFlow } from "@/onboarding/FirstLaunchFlow";
import { JourneePreview } from "@/screens/JourneePreview";

function resolveThemeSystem(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function App() {
  const [instanceUrl, setInstanceUrl] = useState(
    () => loadInstanceUrl() ?? DEFAULT_INSTANCE_URL,
  );
  const [authenticated, setAuthenticated] = useState(() => isOnboardingComplete());

  useEffect(() => {
    document.documentElement.dataset.theme = resolveThemeSystem();
  }, []);

  const handleFirstLaunchComplete = useCallback((result: { instanceUrl: string }) => {
    setInstanceUrl(result.instanceUrl);
    setAuthenticated(true);
  }, []);

  const handleResetSession = useCallback(() => {
    setAuthenticated(false);
  }, []);

  if (!authenticated) {
    return (
      <FirstLaunchFlow initialInstanceUrl={instanceUrl} onComplete={handleFirstLaunchComplete} />
    );
  }

  return (
    <JourneePreview instanceUrl={instanceUrl} onResetSession={handleResetSession} />
  );
}

export default App;
