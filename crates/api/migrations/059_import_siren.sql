-- Source et date d'un import de registre. Ajouts seulement.

ALTER TABLE contacts ADD COLUMN source_import TEXT;
ALTER TABLE contacts ADD COLUMN importe_le TIMESTAMPTZ;
