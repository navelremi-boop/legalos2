import { fr } from "@/lib/fr";

type InfosDossierProps = {
  juridiction: string;
  numeroRg: string;
  client: string;
  adversaire: string;
  confrere?: string;
  typeDossier?: string;
  etape?: string;
  lies?: string;
};

export function InfosDossier({
  juridiction,
  numeroRg,
  client,
  adversaire,
  confrere,
  typeDossier,
  etape,
  lies,
}: InfosDossierProps) {
  return (
    <dl className="infos-dossier" data-testid="infos-dossier">
      <div>
        <dt>{fr("Juridiction")}</dt>
        <dd>{fr(juridiction)}</dd>
      </div>
      <div>
        <dt>{fr("n° RG")}</dt>
        <dd>{fr(numeroRg)}</dd>
      </div>
      <div>
        <dt>{fr("Client")}</dt>
        <dd data-testid="dossier-client">{fr(client)}</dd>
      </div>
      <div>
        <dt>{fr("Adversaire")}</dt>
        <dd data-testid="dossier-adversaire">{fr(adversaire)}</dd>
      </div>
      <div>
        <dt>{fr("Confrère")}</dt>
        <dd data-testid="dossier-confrere">{fr(confrere || "—")}</dd>
      </div>
      <div>
        <dt>{fr("Type")}</dt>
        <dd data-testid="dossier-type-affiche">{fr(typeDossier || "—")}</dd>
      </div>
      <div>
        <dt>{fr("Étape")}</dt>
        <dd data-testid="dossier-etape-affiche">{fr(etape || "—")}</dd>
      </div>
      <div>
        <dt>{fr("Dossiers liés")}</dt>
        <dd data-testid="dossier-liens">{fr(lies || "—")}</dd>
      </div>
    </dl>
  );
}
