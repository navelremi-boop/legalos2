import { Feuille } from "@/coque/Feuille";
import { fr } from "@/lib/fr";

type StubProps = {
  titre: string;
  testId: string;
};

export function EcranStub({ titre, testId }: StubProps) {
  return (
    <div className="fond-neutre relative flex h-full min-h-0 flex-col px-[42px] pt-[28px]" data-testid={testId}>
      <h1 className="mb-4 text-[length:var(--font-size-journee)] font-extrabold text-sur-chemise">
        {fr(titre)}
      </h1>
      <Feuille uneColonne className="min-h-[280px]">
        <div className="p-[22px]">
          <p className="text-graphite">{fr("Écran à venir — même coque et mêmes composants.")}</p>
        </div>
      </Feuille>
    </div>
  );
}
