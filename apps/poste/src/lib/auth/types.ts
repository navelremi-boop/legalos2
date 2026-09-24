/** Contrat aligné sur crates/api/src/routes/auth.rs (OpenAPI). */

export type ConnexionRequest = {
  email: string;
  password: string;
  nom_appareil: string;
};

export type ConnexionResponse = {
  totp_requis: boolean;
  access_token?: string;
  /** Jeton provisoire si totp_requis (à exposer côté API lors de l’implémentation S2). */
  session_token?: string;
};

export type TotpVerifyRequest = {
  session_token: string;
  code_totp: string;
};

export type TotpVerifyResponse = {
  access_token: string;
  refresh_token: string;
};

export type ApiErrorBody = {
  code: string;
  message: string;
};
