import { useCallback, useState, type SubmitEvent } from "react";
import {
  ErrorMessage,
  Field,
  PrimaryButton,
  SecondaryButton,
  TextInput,
} from "@/components/onboarding/FormControls";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import {
  connexion,
  DEFAULT_INSTANCE_URL,
  normalizeInstanceUrl,
  verifierTotp,
} from "@/lib/auth/client";
import { fr } from "@/lib/fr";
import {
  saveAccountEmail,
  saveInstanceUrl,
  saveSessionTokens,
} from "@/lib/session/storage";
export type FirstLaunchComplete = {
  instanceUrl: string;
};

type Step = "instance" | "connexion" | "totp";

type FirstLaunchFlowProps = {
  initialInstanceUrl: string;
  onComplete: (result: FirstLaunchComplete) => void;
};

export function FirstLaunchFlow({ initialInstanceUrl, onComplete }: FirstLaunchFlowProps) {
  const [step, setStep] = useState<Step>("instance");
  const [instanceUrl, setInstanceUrl] = useState(initialInstanceUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nomAppareil, setNomAppareil] = useState("");
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [codeTotp, setCodeTotp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finishWithTokens = useCallback(
    (accessToken: string, refreshToken: string, url: string) => {
      saveInstanceUrl(url);
      saveAccountEmail(email.trim());
      void saveSessionTokens(accessToken, refreshToken).then(() => {
        onComplete({ instanceUrl: url });
      });
    },
    [onComplete, email],
  );

  const handleInstanceSubmit = (event: SubmitEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const fromForm = new FormData(form).get("instanceUrl");
    const raw =
      typeof fromForm === "string" && fromForm.trim() !== "" ? fromForm : instanceUrl;
    const normalized = normalizeInstanceUrl(raw);
    setInstanceUrl(normalized);
    saveInstanceUrl(normalized);
    setError(null);
    setStep("connexion");
  };

  const handleConnexionSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const url = normalizeInstanceUrl(instanceUrl);
    const result = await connexion(url, {
      email: email.trim(),
      password,
      nom_appareil: nomAppareil.trim(),
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.error.message);
      return;
    }

    const { data } = result;
    if (data.totp_requis) {
      if (data.session_token === undefined || data.session_token === "") {
        setError(
          "Double authentification requise mais le serveur n’a pas fourni de session. Contactez l’administrateur de l’instance.",
        );
        return;
      }
      setSessionToken(data.session_token);
      setPassword("");
      setStep("totp");
      return;
    }

    if (data.access_token === undefined || data.access_token === "") {
      setError("Connexion refusée : jeton d’accès manquant dans la réponse du serveur.");
      return;
    }

    finishWithTokens(data.access_token, "", url);
  };

  const handleTotpSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (sessionToken === null) {
      setError("Session expirée. Recommencez la connexion.");
      setStep("connexion");
      return;
    }
    setBusy(true);
    setError(null);
    const url = normalizeInstanceUrl(instanceUrl);
    const result = await verifierTotp(url, {
      session_token: sessionToken,
      code_totp: codeTotp.trim(),
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.error.message);
      return;
    }

    finishWithTokens(result.data.access_token, result.data.refresh_token, url);
  };

  if (step === "instance") {
    return (
      <OnboardingShell
        title="Connexion à votre cabinet"
        subtitle="Indiquez l’adresse de l’instance LEGAL OS de votre cabinet."
      >
        <form onSubmit={handleInstanceSubmit}>
          {error !== null ? <ErrorMessage message={error} /> : null}
          <Field
            id="instance-url"
            label="Adresse de l’instance"
            hint="Exemple : https://legalos.votre-cabinet.fr"
          >
            <TextInput
              id="instance-url"
              name="instanceUrl"
              type="text"
              inputMode="url"
              autoComplete="url"
              required
              value={instanceUrl}
              placeholder={DEFAULT_INSTANCE_URL}
              onChange={(event) => {
                setInstanceUrl(event.target.value);
              }}
            />
          </Field>
          <PrimaryButton type="submit" disabled={busy}>
            {fr("Continuer")}
          </PrimaryButton>
        </form>
      </OnboardingShell>
    );
  }

  if (step === "connexion") {
    return (
      <OnboardingShell
        title="Identifiants"
        subtitle="Connectez ce poste à l’instance et enregistrez-le dans le registre des postes."
      >
        <form onSubmit={(event) => void handleConnexionSubmit(event)}>
          {error !== null ? <ErrorMessage message={error} /> : null}
          <p className="mb-4 text-[length:var(--font-size-meta)] text-graphite">
            {fr(`Instance : ${normalizeInstanceUrl(instanceUrl)}`)}
          </p>
          <Field id="email" label="Adresse e-mail">
            <TextInput
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          </Field>
          <Field id="password" label="Mot de passe">
            <TextInput
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
          </Field>
          <Field id="nom-appareil" label="Nom de ce poste" hint="Visible dans le registre des postes du cabinet.">
            <TextInput
              id="nom-appareil"
              name="nomAppareil"
              type="text"
              autoComplete="off"
              required
              value={nomAppareil}
              placeholder="Poste de Me Dupont"
              onChange={(event) => {
                setNomAppareil(event.target.value);
              }}
            />
          </Field>
          <div className="flex flex-col gap-2">
            <PrimaryButton type="submit" disabled={busy}>
              {busy ? fr("Connexion…") : fr("Se connecter")}
            </PrimaryButton>
            <SecondaryButton
              disabled={busy}
              onClick={() => {
                setError(null);
                setStep("instance");
              }}
            >
              {fr("Modifier l’adresse de l’instance")}
            </SecondaryButton>
          </div>
        </form>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell
      title="Double authentification"
      subtitle="Saisissez le code à six chiffres de votre application d’authentification."
    >
      <form onSubmit={(event) => void handleTotpSubmit(event)}>
        {error !== null ? <ErrorMessage message={error} /> : null}
        <Field id="code-totp" label="Code TOTP">
          <TextInput
            id="code-totp"
            name="codeTotp"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={codeTotp}
            onChange={(event) => {
              setCodeTotp(event.target.value.replace(/\D/g, "").slice(0, 6));
            }}
          />
        </Field>
        <div className="flex flex-col gap-2">
          <PrimaryButton type="submit" disabled={busy || codeTotp.length !== 6}>
            {busy ? fr("Vérification…") : fr("Valider")}
          </PrimaryButton>
          <SecondaryButton
            disabled={busy}
            onClick={() => {
              setSessionToken(null);
              setCodeTotp("");
              setError(null);
              setStep("connexion");
            }}
          >
            {fr("Retour")}
          </SecondaryButton>
        </div>
      </form>
    </OnboardingShell>
  );
}
