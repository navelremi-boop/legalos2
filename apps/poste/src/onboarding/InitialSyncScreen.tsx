import { useEffect, useState } from "react";
import { ErrorMessage } from "@/components/onboarding/FormControls";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { fr } from "@/lib/fr";
import { runInitialSync, type InitialSyncProgress } from "@/sync/initialSync";

type InitialSyncScreenProps = {
  instanceUrl: string;
  onComplete: () => void;
  onError: () => void;
};

export function InitialSyncScreen({ instanceUrl, onComplete, onError }: InitialSyncScreenProps) {
  const [progress, setProgress] = useState<InitialSyncProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        await runInitialSync(instanceUrl, (p) => {
          if (!abort.signal.aborted) {
            setProgress(p);
          }
        });
        if (!abort.signal.aborted) {
          onComplete();
        }
      } catch (err) {
        if (!abort.signal.aborted) {
          setError(
            err instanceof Error
              ? err.message
              : "La synchronisation initiale a échoué. Vérifiez l’instance et réessayez.",
          );
          onError();
        }
      }
    })();
    return () => {
      abort.abort();
    };
  }, [instanceUrl, onComplete, onError]);

  return (
    <OnboardingShell
      title="Synchronisation initiale"
      subtitle="Téléchargement des données autorisées pour ce poste."
    >
      {error !== null ? <ErrorMessage message={error} /> : null}
      <p className="text-[length:var(--font-size-dense)] text-graphite">
        {progress !== null ? fr(progress.detail) : fr("Initialisation…")}
      </p>
    </OnboardingShell>
  );
}
