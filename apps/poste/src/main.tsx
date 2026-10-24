import { invoke } from "@tauri-apps/api/core";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installerJournalErreurs } from "@/lib/journalErreurs";
import { exposeRecetteHooksIfEnabled } from "@/sync/recetteHooks";
import "./index.css";

const params = new URLSearchParams(window.location.search);
const galerieDev = import.meta.env.DEV && params.get("galerie") === "1";

// Journal d'erreurs du poste (D4) : les erreurs JavaScript non capturées sont consignées côté Rust, avant tout le reste.
installerJournalErreurs(window, (commande, args) => invoke(commande, args));

// Recette : hooks disponibles avant la fin de l'auth / sync (écritures hors ligne).
exposeRecetteHooksIfEnabled();

async function monter() {
  const el = document.getElementById("root");
  if (!el) {
    throw new Error("Élément #root introuvable");
  }
  const root = ReactDOM.createRoot(el);
  if (galerieDev) {
    const { GalerieDemo } = await import("@/screens/GalerieDemo");
    root.render(
      <React.StrictMode>
        <GalerieDemo />
      </React.StrictMode>,
    );
    return;
  }
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void monter();
