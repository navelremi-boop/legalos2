//! Extraction de texte pour indexation (docx / couche texte PDF). Jamais journalisé.

use std::io::{Cursor, Read};

use quick_xml::events::Event;
use quick_xml::reader::Reader;
use zip::ZipArchive;

/// Extrait le texte indexable d'un fichier scellé.
/// - docx : `word/document.xml`, nœuds texte sans mise en forme ;
/// - pdf : couche texte seulement (pas d'OCR) ;
/// - sinon, ou pdf sans couche texte : chaîne vide.
pub fn extraire_texte(nom: &str, octets: &[u8]) -> String {
    let bas = nom.to_ascii_lowercase();
    if bas.ends_with(".docx") {
        return extraire_docx(octets).unwrap_or_default();
    }
    if bas.ends_with(".pdf") {
        return extraire_pdf(octets).unwrap_or_default();
    }
    String::new()
}

fn extraire_docx(octets: &[u8]) -> Result<String, ()> {
    let curseur = Cursor::new(octets);
    let mut archive = ZipArchive::new(curseur).map_err(|_| ())?;
    let mut fichier = archive.by_name("word/document.xml").map_err(|_| ())?;
    let mut xml = String::new();
    fichier.read_to_string(&mut xml).map_err(|_| ())?;
    Ok(texte_depuis_xml_docx(&xml))
}

fn texte_depuis_xml_docx(xml: &str) -> String {
    let mut lecteur = Reader::from_str(xml);
    lecteur.config_mut().trim_text(false);
    let mut buf = Vec::new();
    let mut morceaux = Vec::new();
    let mut dans_t = false;
    loop {
        match lecteur.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                dans_t = e.local_name().as_ref() == "t";
            }
            Ok(Event::End(e)) => {
                if e.local_name().as_ref() == "t" {
                    dans_t = false;
                }
            }
            Ok(Event::Text(t)) if dans_t => {
                morceaux.push(t.xml10_content().into_owned());
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
        buf.clear();
    }
    morceaux.join(" ")
}

fn extraire_pdf(octets: &[u8]) -> Result<String, ()> {
    let texte = pdf_extract::extract_text_from_mem(octets).map_err(|_| ())?;
    let nettoye = texte.trim();
    if nettoye.is_empty() {
        Ok(String::new())
    } else {
        Ok(nettoye.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn txt_reste_vide() {
        assert_eq!(extraire_texte("note.txt", b"hello"), "");
    }

    #[test]
    fn pdf_invalide_vide() {
        assert_eq!(extraire_texte("x.pdf", b"pas un pdf"), "");
    }
}
