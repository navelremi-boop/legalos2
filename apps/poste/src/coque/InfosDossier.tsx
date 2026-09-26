import { fr } from "@/lib/fr";

type InfosDossierProps = {
  juridiction: string;
  numeroRg: string;
  client: string;
  adversaire: string;
};

export function InfosDossier({ juridiction, numeroRg, client, adversaire }: InfosDossierProps) {
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
        <dd>{fr(client)}</dd>
      </div>
      <div>
        <dt>{fr("Adversaire")}</dt>
        <dd>{fr(adversaire)}</dd>
      </div>
    </dl>
  );
}
