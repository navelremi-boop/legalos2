import { useEffect, useRef, useState } from "react";
import { IconLink, IconList, IconListNumbers, IconPaperclip } from "@tabler/icons-react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { fr } from "@/lib/fr";
import { lienAdmis, nettoyerCollage } from "@/messagerie/nettoyageHtml";

type EditeurMessageProps = {
  /** HTML de départ ; l'éditeur ne le relit plus ensuite (c'est lui qui fait foi pendant la rédaction). */
  contenuInitial: string;
  onChange: (html: string) => void;
  /** Masque la citation d'origine (dernier bloc), sans la retirer du message. */
  historiqueMasque: boolean;
  onJoindre: () => void;
};

/**
 * Éditeur du message : gras, italique, listes, liens, citation. Rien d'autre n'entre : le schéma de l'éditeur
 * ne connaît ni image, ni tableau, ni style, et le texte collé passe d'abord par `nettoyerCollage` (Word,
 * Outlook, pages web : aucun script, aucun contenu distant, mise en forme parasite retirée).
 */
export function EditeurMessage({ contenuInitial, onChange, historiqueMasque, onJoindre }: EditeurMessageProps) {
  const editeur = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        code: false,
        codeBlock: false,
        strike: false,
        underline: false,
        horizontalRule: false,
        trailingNode: false,
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          defaultProtocol: "https",
          protocols: ["mailto", "tel"],
          isAllowedUri: (url) => lienAdmis(url) !== null,
          HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
        },
      }),
    ],
    content: contenuInitial,
    editorProps: {
      attributes: {
        class: "mails-redac__corps",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": fr("Message"),
        "data-testid": "redac-corps",
      },
      transformPastedHTML: (html) => nettoyerCollage(html),
    },
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  const actif = useEditorState({
    editor: editeur,
    selector: ({ editor: courant }) => ({
      gras: courant.isActive("bold"),
      italique: courant.isActive("italic"),
      puces: courant.isActive("bulletList"),
      numerotee: courant.isActive("orderedList"),
      lien: courant.isActive("link"),
    }),
  });

  const [lienOuvert, setLienOuvert] = useState(false);
  const [adresse, setAdresse] = useState("");
  const [lienRefuse, setLienRefuse] = useState(false);
  const champLien = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (lienOuvert) champLien.current?.focus();
  }, [lienOuvert]);

  const ouvrirLien = () => {
    const courant = editeur.getAttributes("link") as { href?: unknown };
    setAdresse(typeof courant.href === "string" ? courant.href : "");
    setLienRefuse(false);
    setLienOuvert(true);
  };

  const validerLien = () => {
    const texte = adresse.trim();
    if (texte === "") {
      editeur.chain().focus().extendMarkRange("link").unsetLink().run();
      setLienOuvert(false);
      return;
    }
    const complet = /^[a-z][a-z0-9+.-]*:/iu.test(texte) ? texte : `https://${texte}`;
    if (lienAdmis(complet) === null) {
      setLienRefuse(true);
      return;
    }
    editeur.chain().focus().extendMarkRange("link").setLink({ href: complet }).run();
    setLienOuvert(false);
  };

  return (
    <div className="mails-redac__editeur" data-historique={historiqueMasque ? "masque" : "visible"}>
      <div className="mails-redac__outils" role="toolbar" aria-label={fr("Mise en forme")}>
        <button
          type="button"
          className="mails-redac__outil"
          data-testid="outil-gras"
          aria-label={fr("Gras")}
          aria-pressed={actif.gras}
          onClick={() => {
            editeur.chain().focus().toggleBold().run();
          }}
        >
          <b aria-hidden>G</b>
        </button>
        <button
          type="button"
          className="mails-redac__outil"
          data-testid="outil-italique"
          aria-label={fr("Italique")}
          aria-pressed={actif.italique}
          onClick={() => {
            editeur.chain().focus().toggleItalic().run();
          }}
        >
          <i aria-hidden>I</i>
        </button>
        <button
          type="button"
          className="mails-redac__outil"
          data-testid="outil-puces"
          aria-label={fr("Liste à puces")}
          aria-pressed={actif.puces}
          onClick={() => {
            editeur.chain().focus().toggleBulletList().run();
          }}
        >
          <IconList stroke={1.7} aria-hidden />
        </button>
        <button
          type="button"
          className="mails-redac__outil"
          data-testid="outil-numerotee"
          aria-label={fr("Liste numérotée")}
          aria-pressed={actif.numerotee}
          onClick={() => {
            editeur.chain().focus().toggleOrderedList().run();
          }}
        >
          <IconListNumbers stroke={1.7} aria-hidden />
        </button>
        <button
          type="button"
          className="mails-redac__outil"
          data-testid="outil-lien"
          aria-label={fr("Lien")}
          aria-pressed={actif.lien}
          onClick={ouvrirLien}
        >
          <IconLink stroke={1.7} aria-hidden />
        </button>
        <span className="mails-redac__sep" aria-hidden />
        <button
          type="button"
          className="mails-redac__outil mails-redac__outil--texte"
          data-testid="outil-joindre"
          onClick={onJoindre}
        >
          <IconPaperclip stroke={1.7} aria-hidden />
          {fr("Joindre")}
        </button>
      </div>
      {lienOuvert ? (
        <div className="mails-redac__lien" role="group" aria-label={fr("Lien")}>
          <label htmlFor="redac-lien-adresse">{fr("Adresse du lien")}</label>
          <input
            id="redac-lien-adresse"
            ref={champLien}
            data-testid="redac-lien-adresse"
            type="text"
            inputMode="url"
            value={adresse}
            aria-invalid={lienRefuse}
            onChange={(event) => {
              setAdresse(event.target.value);
              setLienRefuse(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                validerLien();
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setLienOuvert(false);
                editeur.commands.focus();
              }
            }}
          />
          <button type="button" data-testid="redac-lien-valider" onClick={validerLien}>
            {fr("Valider")}
          </button>
          <button
            type="button"
            onClick={() => {
              setLienOuvert(false);
              editeur.commands.focus();
            }}
          >
            {fr("Annuler")}
          </button>
          {lienRefuse ? (
            <span className="mails-erreur" role="alert" data-testid="redac-lien-refuse">
              {fr("Seules les adresses http, https, mailto et tel sont admises.")}
            </span>
          ) : null}
        </div>
      ) : null}
      <EditorContent editor={editeur} />
    </div>
  );
}
