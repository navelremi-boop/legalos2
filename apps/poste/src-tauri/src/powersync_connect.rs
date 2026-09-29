use std::error::Error;
use std::fmt;
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use futures_lite::StreamExt;
use powersync::error::PowerSyncError;
use powersync::{
    BackendConnector, CrudEntry, PowerSyncCredentials, PowerSyncDatabase, SyncOptions, UpdateType,
};
use reqwest::StatusCode;
use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Runtime};
use tauri_plugin_powersync::PowerSyncExt;

#[derive(Clone)]
struct SessionSync {
    instance_url: String,
    access_token: String,
}

#[derive(Debug)]
struct UploadMessage(String);

impl fmt::Display for UploadMessage {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl Error for UploadMessage {}

fn upload_err(message: impl Into<String>) -> PowerSyncError {
    PowerSyncError::upload_error(UploadMessage(message.into()))
}

struct CabinetConnector {
    db: PowerSyncDatabase,
    session: Arc<Mutex<SessionSync>>,
}

#[tauri::command]
pub async fn connect_powersync<R: Runtime>(
    app: AppHandle<R>,
    handle: usize,
    instance_url: String,
    access_token: String,
) -> tauri_plugin_powersync::Result<()> {
    let ps = app.powersync();
    let database = ps.database_from_javascript_handle(handle)?;
    let session = Arc::new(Mutex::new(SessionSync {
        instance_url: instance_url.clone(),
        access_token: access_token.clone(),
    }));
    let connector = CabinetConnector {
        db: database.clone(),
        session: Arc::clone(&session),
    };
    database
        .connect(SyncOptions::new(CabinetConnector {
            db: database.clone(),
            session,
        }))
        .await;
    if let Ok(reader) = database.reader().await {
        if let Ok(n) = reader.query_row("SELECT COUNT(*) FROM ps_crud", [], |row| {
            row.get::<_, i64>(0)
        }) {
            eprintln!("file crud: {n}");
        }
    }
    // Le SDK ne vide pas la file au redémarrage. L'envoi manuel doit aussi
    // retirer `ps_updated_rows`, sinon le journal téléchargé ne s'applique pas.
    if let Err(err) = connector.upload_data().await {
        eprintln!("upload file: {err}");
    }
    // Le téléchargement ne réapplique pas un checkpoint tant que l'acteur d'envoi
    // n'a pas signalé la fin. L'envoi manuel ne le fait pas : on reconnecte pour
    // que l'acteur voie une file vide et débloque le journal.
    database.disconnect().await;
    database
        .connect(SyncOptions::new(CabinetConnector {
            db: database.clone(),
            session: Arc::new(Mutex::new(SessionSync {
                instance_url,
                access_token,
            })),
        }))
        .await;
    Ok(())
}

#[async_trait]
impl BackendConnector for CabinetConnector {
    async fn fetch_credentials(&self) -> Result<PowerSyncCredentials, PowerSyncError> {
        let session = self
            .session
            .lock()
            .map_err(|_| upload_err("session sync verrouillée"))?;
        if session.access_token.is_empty() {
            return Err(upload_err("jeton d'accès absent"));
        }
        // `Url::join("sync/stream")` remplace le dernier segment s'il n'y a pas de barre finale.
        // Avec `/sync/`, la requête est `/sync/sync/stream` ; Caddy retire un préfixe et le service reçoit `/sync/stream`.
        let endpoint = format!("{}/sync/", session.instance_url.trim_end_matches('/'));
        Ok(PowerSyncCredentials {
            endpoint,
            token: session.access_token.clone(),
        })
    }

    async fn upload_data(&self) -> Result<(), PowerSyncError> {
        let mut transactions = self.db.crud_transactions();
        while let Some(mut tx) = transactions.try_next().await? {
            let crud = std::mem::take(&mut tx.crud);
            for entry in &crud {
                // Un refus (400/403/404/409, table inconnue, DELETE) est consigné et la file avance.
                // Seules les erreurs transitoires (réseau, 5xx) bloquent pour réessai.
                traiter_entree(&self.session, &self.db, entry).await?;
                oublier_maj_locale(&self.db, &entry.id).await?;
            }
            tx.complete().await?;
        }
        Ok(())
    }
}

async fn traiter_entree(
    session: &Arc<Mutex<SessionSync>>,
    db: &PowerSyncDatabase,
    entry: &CrudEntry,
) -> Result<(), PowerSyncError> {
    match &entry.update_type {
        UpdateType::Delete => {
            // Intercalaires personnalisés et rattachements : retrait explicite (API DELETE).
            // Les autres tables : refus consigné, file non bloquée (docs/conflits.md § 5).
            if let Some(suppression) = ressource_suppression(&entry.table) {
                return envoyer_delete(session, db, suppression, entry).await;
            }
            consign_refus(
                db,
                &entry.table,
                &entry.id,
                "DELETE",
                None,
                "Les suppressions ne sont pas autorisées.",
            )
            .await?;
            return Ok(());
        }
        UpdateType::Put | UpdateType::Patch => {}
    }

    let Some(ressource) = ressource_connue(&entry.table) else {
        consign_refus(
            db,
            &entry.table,
            &entry.id,
            op_label(&entry.update_type),
            None,
            &format!("Table inconnue : {}.", entry.table),
        )
        .await?;
        return Ok(());
    };

    match &entry.update_type {
        UpdateType::Put => envoyer_put(session, db, ressource, entry).await,
        UpdateType::Patch => envoyer_patch(session, db, ressource, entry).await,
        UpdateType::Delete => Ok(()),
    }
}

struct Ressource {
    table: &'static str,
    patch_chemin: fn(&str) -> String,
    put_chemin: fn(&Map<String, Value>) -> Result<String, String>,
    champs_modifiables: &'static [&'static str],
    /// Champs numériques envoyés en entier JSON.
    champs_entiers: &'static [&'static str],
    /// Champs booléens (SQLite stocke 0/1).
    champs_booleens: &'static [&'static str],
}

fn ressource_connue(table: &str) -> Option<&'static Ressource> {
    static CABINETS: Ressource = Ressource {
        table: "cabinets",
        patch_chemin: |id| format!("/api/cabinets/{id}"),
        put_chemin: |_| Err("création de cabinet non prise en charge depuis le poste".into()),
        champs_modifiables: &["nom", "slug"],
        champs_entiers: &[],
        champs_booleens: &[],
    };
    static DOSSIERS: Ressource = Ressource {
        table: "dossiers",
        patch_chemin: |id| format!("/api/dossiers/{id}"),
        put_chemin: |_| Ok("/api/dossiers".into()),
        champs_modifiables: &[
            "nom",
            "chemise",
            "juridiction",
            "numero_rg",
            "type_dossier",
            "etape",
        ],
        champs_entiers: &[],
        champs_booleens: &["restreint"],
    };
    static PARTIES: Ressource = Ressource {
        table: "parties",
        patch_chemin: |id| format!("/api/parties/{id}"),
        put_chemin: |data| {
            let dossier_id = json_text(data.get("dossier_id"))
                .ok_or_else(|| "dossier de la partie absent".to_string())?;
            Ok(format!("/api/dossiers/{dossier_id}/parties"))
        },
        champs_modifiables: &["role", "nom"],
        champs_entiers: &[],
        champs_booleens: &[],
    };
    static TEMPS: Ressource = Ressource {
        table: "temps_saisis",
        patch_chemin: |id| format!("/api/temps/{id}"),
        put_chemin: |_| Ok("/api/temps".into()),
        champs_modifiables: &["minutes", "libelle", "taux_centimes_heure"],
        champs_entiers: &["minutes", "taux_centimes_heure"],
        champs_booleens: &[],
    };
    static BROUILLONS: Ressource = Ressource {
        table: "brouillons_facture",
        patch_chemin: |id| format!("/api/brouillons-facture/{id}"),
        put_chemin: |_| Ok("/api/brouillons-facture".into()),
        champs_modifiables: &["libelle", "taux_centimes_heure"],
        champs_entiers: &["taux_centimes_heure", "ht_centimes"],
        champs_booleens: &[],
    };
    static TAUX: Ressource = Ressource {
        table: "taux_horaires",
        patch_chemin: |id| format!("/api/taux-horaires/{id}"),
        put_chemin: |_| Ok("/api/taux-horaires".into()),
        champs_modifiables: &["centimes_par_heure"],
        champs_entiers: &["centimes_par_heure"],
        champs_booleens: &[],
    };
    static INTERCALAIRES: Ressource = Ressource {
        table: "intercalaires_personnalises",
        patch_chemin: |id| format!("/api/intercalaires/{id}"),
        put_chemin: |data| {
            let dossier_id = json_text(data.get("dossier_id"))
                .ok_or_else(|| "dossier de l'intercalaire absent".to_string())?;
            Ok(format!("/api/dossiers/{dossier_id}/intercalaires"))
        },
        champs_modifiables: &["nom"],
        champs_entiers: &[],
        champs_booleens: &["restreint"],
    };
    static INTERCALAIRE_ELEMENTS: Ressource = Ressource {
        table: "intercalaire_elements",
        // Pas de PATCH métier (création / détachement seulement).
        patch_chemin: |id| format!("/api/intercalaire-elements/{id}"),
        put_chemin: |data| {
            let intercalaire_id = json_text(data.get("intercalaire_id"))
                .ok_or_else(|| "intercalaire du rattachement absent".to_string())?;
            Ok(format!("/api/intercalaires/{intercalaire_id}/elements"))
        },
        champs_modifiables: &[],
        champs_entiers: &[],
        champs_booleens: &["restreint"],
    };
    static CONTACTS: Ressource = Ressource {
        table: "contacts",
        patch_chemin: |id| format!("/api/contacts/{id}"),
        put_chemin: |_| Ok("/api/contacts".into()),
        champs_modifiables: &["nom", "siren", "numero_tva", "type_client"],
        champs_entiers: &[],
        champs_booleens: &[],
    };
    static DOSSIER_LIENS: Ressource = Ressource {
        table: "dossier_liens",
        patch_chemin: |id| format!("/api/dossier-liens/{id}"),
        put_chemin: |data| {
            let dossier_id = json_text(data.get("dossier_id"))
                .ok_or_else(|| "dossier du lien absent".to_string())?;
            Ok(format!("/api/dossiers/{dossier_id}/liens"))
        },
        champs_modifiables: &[],
        champs_entiers: &[],
        champs_booleens: &["restreint"],
    };
    static AGENDA: Ressource = Ressource {
        table: "agenda_elements",
        patch_chemin: |id| format!("/api/agenda/{id}"),
        put_chemin: |data| {
            let dossier_id = json_text(data.get("dossier_id"))
                .ok_or_else(|| "dossier de l'agenda absent".to_string())?;
            Ok(format!("/api/dossiers/{dossier_id}/agenda"))
        },
        champs_modifiables: &["titre", "debut", "rappel_le"],
        champs_entiers: &[],
        champs_booleens: &["restreint"],
    };
    match table {
        "cabinets" => Some(&CABINETS),
        "dossiers" => Some(&DOSSIERS),
        "parties" => Some(&PARTIES),
        "temps_saisis" => Some(&TEMPS),
        "brouillons_facture" => Some(&BROUILLONS),
        "taux_horaires" => Some(&TAUX),
        "intercalaires_personnalises" => Some(&INTERCALAIRES),
        "intercalaire_elements" => Some(&INTERCALAIRE_ELEMENTS),
        "contacts" => Some(&CONTACTS),
        "dossier_liens" => Some(&DOSSIER_LIENS),
        "agenda_elements" => Some(&AGENDA),
        _ => None,
    }
}

struct Suppression {
    table: &'static str,
    chemin: fn(&str) -> String,
}

fn ressource_suppression(table: &str) -> Option<&'static Suppression> {
    static INTERCALAIRES: Suppression = Suppression {
        table: "intercalaires_personnalises",
        chemin: |id| format!("/api/intercalaires/{id}"),
    };
    static ELEMENTS: Suppression = Suppression {
        table: "intercalaire_elements",
        chemin: |id| format!("/api/intercalaire-elements/{id}"),
    };
    match table {
        "intercalaires_personnalises" => Some(&INTERCALAIRES),
        "intercalaire_elements" => Some(&ELEMENTS),
        _ => None,
    }
}

async fn envoyer_delete(
    session: &Arc<Mutex<SessionSync>>,
    db: &PowerSyncDatabase,
    suppression: &Suppression,
    entry: &CrudEntry,
) -> Result<(), PowerSyncError> {
    let mut body = Map::new();
    body.insert(
        "idempotence_cle".into(),
        json!(format!("{}:{}:delete", entry.id, suppression.table)),
    );
    let chemin = (suppression.chemin)(&entry.id);
    envoyer_http(
        session,
        db,
        suppression.table,
        &entry.id,
        "DELETE",
        &chemin,
        &body,
    )
    .await
}

fn op_label(op: &UpdateType) -> &'static str {
    match op {
        UpdateType::Put => "PUT",
        UpdateType::Patch => "PATCH",
        UpdateType::Delete => "DELETE",
    }
}

async fn envoyer_patch(
    session: &Arc<Mutex<SessionSync>>,
    db: &PowerSyncDatabase,
    ressource: &Ressource,
    entry: &CrudEntry,
) -> Result<(), PowerSyncError> {
    let data = entry.data.as_ref().cloned().unwrap_or_default();
    let mut champs = Map::new();
    for nom in ressource.champs_modifiables {
        if let Some(valeur) = data.get(*nom) {
            champs.insert((*nom).to_string(), valeur.clone());
        }
    }
    // Une modification d'un seul champ part ; on n'exige aucun champ accompagnateur.
    // S'il n'y a aucun champ métier, on envoie quand même la révision pour ne pas retirer
    // silencieusement l'entrée : le serveur répondra 400 et le refus sera consigné.
    let base_revision = lire_revision(db, ressource.table, &entry.id).await?;
    let idempotence_cle = cle_idempotence(&entry.id, base_revision, &champs);
    let mut body = Map::new();
    body.insert("base_revision".into(), json!(base_revision));
    body.insert("idempotence_cle".into(), json!(idempotence_cle));
    for (k, v) in champs {
        let normalisee = normaliser_valeur(ressource, &k, v);
        body.insert(k, normalisee);
    }
    let chemin = (ressource.patch_chemin)(&entry.id);
    envoyer_http(
        session,
        db,
        ressource.table,
        &entry.id,
        "PATCH",
        &chemin,
        &body,
    )
    .await
}

async fn envoyer_put(
    session: &Arc<Mutex<SessionSync>>,
    db: &PowerSyncDatabase,
    ressource: &Ressource,
    entry: &CrudEntry,
) -> Result<(), PowerSyncError> {
    let data = entry.data.as_ref().cloned().unwrap_or_default();
    let chemin = match (ressource.put_chemin)(&data) {
        Ok(c) => c,
        Err(message) => {
            consign_refus(db, ressource.table, &entry.id, "PUT", None, &message).await?;
            return Ok(());
        }
    };
    let mut body = Map::new();
    body.insert("id".into(), json!(entry.id));
    body.insert(
        "idempotence_cle".into(),
        json!(format!("{}:{}:put", entry.id, ressource.table)),
    );
    // Envoi de tous les champs présents (y compris un seul) — pas d'exigence d'accompagnateurs.
    for (k, v) in &data {
        if k == "id" {
            continue;
        }
        body.insert(k.clone(), normaliser_valeur(ressource, k, v.clone()));
    }
    envoyer_http(
        session,
        db,
        ressource.table,
        &entry.id,
        "PUT",
        &chemin,
        &body,
    )
    .await
}

fn normaliser_valeur(ressource: &Ressource, cle: &str, valeur: Value) -> Value {
    if ressource.champs_booleens.contains(&cle) {
        return match &valeur {
            Value::Bool(_) => valeur,
            Value::Number(n) => Value::Bool(n.as_i64().unwrap_or(0) != 0),
            Value::String(s) => Value::Bool(s == "1" || s.eq_ignore_ascii_case("true")),
            _ => valeur,
        };
    }
    if ressource.champs_entiers.contains(&cle) {
        match &valeur {
            Value::Number(_) => valeur,
            Value::String(s) => s.parse::<i64>().map(Value::from).unwrap_or(valeur),
            Value::Bool(b) => Value::from(i64::from(*b)),
            _ => valeur,
        }
    } else {
        valeur
    }
}

fn cle_idempotence(id: &str, base_revision: i64, champs: &Map<String, Value>) -> String {
    let mut parties: Vec<String> = champs.iter().map(|(k, v)| format!("{k}={}", v)).collect();
    parties.sort();
    format!("{id}:{base_revision}:{}", parties.join("|"))
}

async fn envoyer_http(
    session: &Arc<Mutex<SessionSync>>,
    db: &PowerSyncDatabase,
    table: &str,
    id: &str,
    operation: &str,
    chemin: &str,
    body: &impl Serialize,
) -> Result<(), PowerSyncError> {
    let (instance_url, token) = {
        let session = session
            .lock()
            .map_err(|_| upload_err("session sync verrouillée"))?;
        (session.instance_url.clone(), session.access_token.clone())
    };
    let url = format!("{}{chemin}", instance_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let request = match operation {
        "PATCH" => client.patch(&url),
        // PUT local → POST création côté API (idempotence_cle).
        "PUT" => client.post(&url),
        // DELETE local → DELETE API (corps idempotence_cle) pour intercalaires / rattachements.
        "DELETE" => client.delete(&url),
        other => {
            consign_refus(
                db,
                table,
                id,
                other,
                None,
                &format!("Opération non prise en charge : {other}."),
            )
            .await?;
            return Ok(());
        }
    };
    let response = request.bearer_auth(token).json(body).send().await?;
    let status = response.status();
    let corps = response.text().await.unwrap_or_default();
    if status == StatusCode::OK || status == StatusCode::CREATED {
        // Aligner la révision locale sur la réponse : le PATCH local ne touche pas
        // `revision`, et sans téléchargement immédiat la base_revision suivante serait périmée.
        if let Ok(valeur) = serde_json::from_str::<Value>(&corps) {
            if let Some(rev) = valeur.get("revision").and_then(Value::as_i64) {
                let _ = appliquer_revision_locale(db, table, id, rev).await;
            }
        }
        return Ok(());
    }
    if est_refus_definitif(status) {
        let message = message_refus(&corps, status);
        consign_refus(db, table, id, operation, Some(status.as_u16()), &message).await?;
        return Ok(());
    }
    Err(upload_err(format!(
        "upload {table} rejeté ({status}) {corps}"
    )))
}

fn est_refus_definitif(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::BAD_REQUEST
            | StatusCode::UNAUTHORIZED
            | StatusCode::FORBIDDEN
            | StatusCode::NOT_FOUND
            | StatusCode::CONFLICT
            | StatusCode::UNPROCESSABLE_ENTITY
    )
}

fn message_refus(corps: &str, status: StatusCode) -> String {
    if let Ok(valeur) = serde_json::from_str::<Value>(corps) {
        for cle in ["message", "erreur", "error", "detail"] {
            if let Some(texte) = valeur.get(cle).and_then(Value::as_str) {
                let t = texte.trim();
                if !t.is_empty() {
                    return t.to_string();
                }
            }
        }
    }
    let brut = corps.trim();
    if !brut.is_empty() {
        return brut.chars().take(400).collect();
    }
    format!("Modification refusée ({status}).")
}

/// Lève le marquage local après un envoi réussi, pour que le point de contrôle s'applique.
async fn oublier_maj_locale(db: &PowerSyncDatabase, id: &str) -> Result<(), PowerSyncError> {
    let conn = db.writer().await?;
    conn.execute(
        "DELETE FROM ps_updated_rows WHERE row_id = ?1",
        rusqlite::params![id],
    )
    .map_err(|err| upload_err(format!("oubli maj locale : {err}")))?;
    Ok(())
}

async fn consign_refus(
    db: &PowerSyncDatabase,
    table: &str,
    enregistrement_id: &str,
    operation: &str,
    statut: Option<u16>,
    message: &str,
) -> Result<(), PowerSyncError> {
    let conn = db.writer().await?;
    // Table locale PowerSync (`localOnly` dans AppSchema) : ne pas recréer un DDL parallèle.
    // Id unique à chaque refus pour ne jamais bloquer la file (UNIQUE).
    let id = format!(
        "refus-{}-{}-{}-{}",
        table,
        enregistrement_id,
        chrono_compact(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0)
    );
    let cree_le = chrono_iso();
    conn.execute(
        "INSERT OR REPLACE INTO refus_sync (id, table_cible, enregistrement_id, operation, statut, message, cree_le)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            id,
            table,
            enregistrement_id,
            operation,
            statut.map(i64::from),
            message,
            cree_le,
        ],
    )
    .map_err(|err| upload_err(format!("écriture refus_sync : {err}")))?;
    eprintln!("refus sync: {table}/{enregistrement_id} {operation} → {message}");
    Ok(())
}

fn chrono_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

fn chrono_compact() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis().to_string())
        .unwrap_or_else(|_| "0".into())
}

fn json_text(value: Option<&Value>) -> Option<&str> {
    value.and_then(Value::as_str).filter(|s| !s.is_empty())
}

async fn lire_revision(
    db: &PowerSyncDatabase,
    table: &str,
    id: &str,
) -> Result<i64, PowerSyncError> {
    let conn = db.reader().await?;
    let depuis_edition: i64 = conn
        .query_row(
            "SELECT revision FROM revision_edition WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .unwrap_or(0);
    let sql = match table {
        "cabinets" => "SELECT revision FROM cabinets WHERE id = ?1",
        "dossiers" => "SELECT revision FROM dossiers WHERE id = ?1",
        "parties" => "SELECT revision FROM parties WHERE id = ?1",
        "temps_saisis" => "SELECT revision FROM temps_saisis WHERE id = ?1",
        "brouillons_facture" => "SELECT revision FROM brouillons_facture WHERE id = ?1",
        "taux_horaires" => "SELECT revision FROM taux_horaires WHERE id = ?1",
        "intercalaires_personnalises" => {
            "SELECT revision FROM intercalaires_personnalises WHERE id = ?1"
        }
        "intercalaire_elements" => "SELECT revision FROM intercalaire_elements WHERE id = ?1",
        "contacts" => "SELECT revision FROM contacts WHERE id = ?1",
        "dossier_liens" => "SELECT revision FROM dossier_liens WHERE id = ?1",
        "agenda_elements" => "SELECT revision FROM agenda_elements WHERE id = ?1",
        _ => return Ok(depuis_edition.max(1)),
    };
    let depuis_ligne: i64 = conn
        .query_row(sql, [id], |row| row.get::<_, i64>(0))
        .unwrap_or(0);
    // Même règle que `memoriserRevision` (poste) : la base est la révision vue
    // (ligne synchronisée ou édition locale après PATCH), jamais l'une seule.
    Ok(depuis_ligne.max(depuis_edition).max(1))
}

async fn appliquer_revision_locale(
    db: &PowerSyncDatabase,
    table: &str,
    id: &str,
    revision: i64,
) -> Result<(), PowerSyncError> {
    let _ = table;
    let conn = db.writer().await?;
    // Uniquement la table locale : un UPDATE sur la ligne synchronisée créerait un
    // PATCH sans champ métier → 400 « Aucun champ à appliquer » en boucle.
    conn.execute(
        "CREATE TABLE IF NOT EXISTS revision_edition (id TEXT PRIMARY KEY, revision INTEGER NOT NULL)",
        [],
    )
    .map_err(|err| upload_err(format!("revision_edition : {err}")))?;
    conn.execute(
        "INSERT INTO revision_edition (id, revision) VALUES (?1, ?2)
         ON CONFLICT(id) DO UPDATE SET revision = excluded.revision",
        rusqlite::params![id, revision],
    )
    .map_err(|err| upload_err(format!("revision_edition upsert : {err}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ressource_par_table() {
        assert!(ressource_connue("cabinets").is_some());
        assert!(ressource_connue("taux_horaires").is_some());
        assert!(ressource_connue("intercalaires_personnalises").is_some());
        assert!(ressource_connue("intercalaire_elements").is_some());
        assert!(ressource_connue("contacts").is_some());
        assert!(ressource_connue("dossier_liens").is_some());
        assert!(ressource_connue("agenda_elements").is_some());
        assert!(ressource_connue("inconnue").is_none());
        assert!(ressource_suppression("intercalaires_personnalises").is_some());
        assert!(ressource_suppression("intercalaire_elements").is_some());
        assert!(ressource_suppression("dossiers").is_none());
    }

    #[test]
    fn refus_http_definitifs() {
        assert!(est_refus_definitif(StatusCode::BAD_REQUEST));
        assert!(est_refus_definitif(StatusCode::UNAUTHORIZED));
        assert!(est_refus_definitif(StatusCode::FORBIDDEN));
        assert!(est_refus_definitif(StatusCode::NOT_FOUND));
        assert!(est_refus_definitif(StatusCode::CONFLICT));
        assert!(est_refus_definitif(StatusCode::UNPROCESSABLE_ENTITY));
        assert!(!est_refus_definitif(StatusCode::INTERNAL_SERVER_ERROR));
        assert!(!est_refus_definitif(StatusCode::SERVICE_UNAVAILABLE));
    }

    #[test]
    fn cle_idempotence_stable() {
        let mut a = Map::new();
        a.insert("nom".into(), json!("A"));
        a.insert("slug".into(), json!("s"));
        let mut b = Map::new();
        b.insert("slug".into(), json!("s"));
        b.insert("nom".into(), json!("A"));
        assert_eq!(cle_idempotence("id", 3, &a), cle_idempotence("id", 3, &b));
    }

    #[test]
    fn message_depuis_json() {
        assert_eq!(
            message_refus(r#"{"message":"Donnée immuable."}"#, StatusCode::CONFLICT),
            "Donnée immuable."
        );
    }
}
