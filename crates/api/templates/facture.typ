#set page(paper: "a4", margin: 2cm)
#set text(size: 11pt)
#pdf.attach(
  "factur-x.xml",
  relationship: "alternative",
  mime-type: "text/xml",
  description: "Factur-X",
)

= Facture n° NUMERO

Cabinet fictif LEGAL OS

LIBELLE : HT_EUR € HT

TVA : TVA_EUR €

Total : TTC_EUR € TTC
