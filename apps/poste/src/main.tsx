import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const params = new URLSearchParams(window.location.search);
const galerieDev = import.meta.env.DEV && params.get("galerie") === "1";

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
