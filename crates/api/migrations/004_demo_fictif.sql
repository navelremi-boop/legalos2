-- Données fictives pour recette S2 (cabinet de démonstration).
-- Mot de passe : MotDePasseDemo123! | Secret TOTP (base32) : JBSWY3DPEHPK3PXP
-- SECRETS_CHIFFREMENT_KEY dev : legalos_demo_chiffrement_32oct!! (32 octets UTF-8)

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
    'avocat.demo@cabinet-fictif.example',
    '$argon2id$v=19$m=19456,t=2,p=1$KHevPFrID/jDexX1UAsbCg$07gGBERVn0Fvq1d4BUAFCpVOSQ0jQgfTH6A084wAxVE',
    'bGVnYWxvcy1kZW1vb9pxCGhBJCWIgWwHZ3OZQ+TAwWT/2lEK+EDulsA86MQ=',
    TRUE
)
ON CONFLICT (cabinet_id, email) DO UPDATE SET
    password_hash = EXCLUDED.password_hash,
    totp_secret_chiffre = EXCLUDED.totp_secret_chiffre;
