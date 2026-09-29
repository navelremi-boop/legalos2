-- Lien entre une échéance d'agenda et le calcul de délai qui l'a produite. Ajouts seulement.

ALTER TABLE agenda_elements ADD COLUMN origine_calcul TEXT;
ALTER TABLE agenda_elements ADD COLUMN jours_calcul INTEGER;
ALTER TABLE agenda_elements ADD COLUMN mois_calcul INTEGER;
ALTER TABLE agenda_elements ADD COLUMN annees_calcul INTEGER;
