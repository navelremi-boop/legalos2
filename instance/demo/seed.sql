-- Données fictives, hors migrations. Réservé à `cargo xtask demo` (LEGALOS_MODE=development).
INSERT INTO cabinets (id, slug, nom, totp_obligatoire)
VALUES (
    '01950000-0000-7000-8000-000000000001',
    'demo-fictif',
    'Cabinet fictif LEGAL OS',
    TRUE
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO utilisateurs (id, cabinet_id, email, password_hash, totp_secret_chiffre, actif)
VALUES (
    '01950000-0000-7000-8000-000000000002',
    '01950000-0000-7000-8000-000000000001',
    'demo@cabinet-fictif.example',
    '$argon2id$v=19$m=19456,t=2,p=1$IexKWEEtflNUNI/+r2OWZQ$QiYSmgY32hAt2ik6nrkz7tIQ1k2s30OiBfFp929Fs2I',
    'bGVnYWxvcy1kZW1vaN5wGHZGUzOAk20UHXmNR4HEPpOKaY7St3edVKzmtW2h4U1TP4NJKB/QL/SXCuuuuQ==',
    TRUE
)
ON CONFLICT (cabinet_id, email) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    totp_secret_chiffre = EXCLUDED.totp_secret_chiffre;
