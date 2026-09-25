//! TVA en centimes. Taux en points de base : 2000 = 20,00 %.
//! Arrondi moitié vers le haut, à valider (docs/hypotheses-facturation.md).

pub fn tva_centimes(base_ht_centimes: i64, taux_bp: i32) -> i64 {
    let produit = base_ht_centimes * i64::from(taux_bp);
    (produit + 5_000) / 10_000
}

pub struct FactureCii<'a> {
    pub numero: i64,
    pub avoir: bool,
    pub date_aaaammjj: &'a str,
    pub libelle: &'a str,
    pub ht_centimes: i64,
    pub tva_centimes: i64,
    pub ttc_centimes: i64,
    pub taux_bp: i32,
}

/// CII D16B, profil EN 16931. Identités fictives : docs/hypotheses-facturation.md.
pub fn cii_en16931(facture: &FactureCii<'_>) -> String {
    let type_code = if facture.avoir { "381" } else { "380" };
    let ht = montant(facture.ht_centimes);
    let tva = montant(facture.tva_centimes);
    let ttc = montant(facture.ttc_centimes);
    let taux = format!("{}.{:02}", facture.taux_bp / 100, facture.taux_bp % 100);
    let libelle = echapper(facture.libelle);
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>urn:cen.eu:en16931:2017</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>{numero}</ram:ID>
    <ram:TypeCode>{type_code}</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">{date}</udt:DateTimeString>
    </ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>1</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>{libelle}</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice>
          <ram:ChargeAmount>{ht}</ram:ChargeAmount>
        </ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="H87">1</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>S</ram:CategoryCode>
          <ram:RateApplicablePercent>{taux}</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>{ht}</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>Cabinet fictif LEGAL OS</ram:Name>
        <ram:SpecifiedLegalOrganization>
          <ram:ID schemeID="0002">123456789</ram:ID>
        </ram:SpecifiedLegalOrganization>
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>69001</ram:PostcodeCode>
          <ram:LineOne>1 rue Fictive</ram:LineOne>
          <ram:CityName>Lyon</ram:CityName>
          <ram:CountryID>FR</ram:CountryID>
        </ram:PostalTradeAddress>
        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">FR32123456789</ram:ID>
        </ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>Client fictif</ram:Name>
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>69002</ram:PostcodeCode>
          <ram:LineOne>2 rue Imaginaire</ram:LineOne>
          <ram:CityName>Lyon</ram:CityName>
          <ram:CountryID>FR</ram:CountryID>
        </ram:PostalTradeAddress>
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>
      <ram:ActualDeliverySupplyChainEvent>
        <ram:OccurrenceDateTime>
          <udt:DateTimeString format="102">{date}</udt:DateTimeString>
        </ram:OccurrenceDateTime>
      </ram:ActualDeliverySupplyChainEvent>
    </ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradeSettlementPaymentMeans>
        <ram:TypeCode>30</ram:TypeCode>
        <ram:PayeePartyCreditorFinancialAccount>
          <ram:IBANID>FR7630006000011234567890189</ram:IBANID>
        </ram:PayeePartyCreditorFinancialAccount>
      </ram:SpecifiedTradeSettlementPaymentMeans>
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>{tva}</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:BasisAmount>{ht}</ram:BasisAmount>
        <ram:CategoryCode>S</ram:CategoryCode>
        <ram:RateApplicablePercent>{taux}</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>
      <ram:SpecifiedTradePaymentTerms>
        <ram:DueDateDateTime>
          <udt:DateTimeString format="102">{date}</udt:DateTimeString>
        </ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>{ht}</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>{ht}</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">{tva}</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>{ttc}</ram:GrandTotalAmount>
        <ram:DuePayableAmount>{ttc}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
"#,
        numero = facture.numero,
        date = facture.date_aaaammjj,
    )
}

fn montant(centimes: i64) -> String {
    let signe = if centimes < 0 { "-" } else { "" };
    let absolu = centimes.abs();
    format!("{signe}{}.{:02}", absolu / 100, absolu % 100)
}

fn echapper(texte: &str) -> String {
    texte
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::tva_centimes;

    #[test]
    fn vingt_pourcent_juste() {
        assert_eq!(tva_centimes(10_000, 2_000), 2_000);
    }

    #[test]
    fn arrondi_vers_le_bas_sous_la_moitie() {
        assert_eq!(tva_centimes(1_001, 2_000), 200);
    }

    #[test]
    fn arrondi_moitie_vers_le_haut() {
        assert_eq!(tva_centimes(1_003, 2_000), 201);
    }

    #[test]
    fn cii_contient_le_total() {
        let xml = super::cii_en16931(&super::FactureCii {
            numero: 1,
            avoir: false,
            date_aaaammjj: "20260925",
            libelle: "Honoraires fictifs",
            ht_centimes: 10_000,
            tva_centimes: 2_000,
            ttc_centimes: 12_000,
            taux_bp: 2_000,
        });
        assert!(xml.contains("<ram:GrandTotalAmount>120.00</ram:GrandTotalAmount>"));
        assert!(xml.contains("urn:cen.eu:en16931:2017"));
        let chemin =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/facture-cii.xml");
        assert!(std::fs::write(chemin, &xml).is_ok());
    }
}
