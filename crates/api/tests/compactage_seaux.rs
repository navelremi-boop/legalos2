//! Tâche planifiée de compactage, selon la procédure de PowerSync 1.26.1
//! (docs.powersync.com/maintenance-ops/compacting-buckets, consignée dans docs/versions.md) :
//! commande `compact` sur tous les seaux, toutes les heures. La défragmentation
//! réécrit les lignes sources et n'est pas dans cette tâche.
#![allow(clippy::expect_used)]

use std::path::PathBuf;

fn racine() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn bloc_compactage(compose: &str) -> Result<&str, String> {
    let marque = "\n  powersync-compact:\n";
    let debut = compose
        .find(marque)
        .ok_or("service powersync-compact absent")?;
    let depuis = &compose[debut + 1..];
    let octets = depuis.as_bytes();
    let mut i = 1usize;
    while i + 3 < octets.len() {
        if octets[i] == b'\n' && octets[i + 1] == b' ' && octets[i + 2] == b' ' && octets[i + 3] != b' ' {
            return Ok(&depuis[..=i]);
        }
        i += 1;
    }
    Ok(depuis)
}

fn verifier_compactage(bloc: &str) -> Result<(), String> {
    if !bloc.contains("image: journeyapps/powersync-service:1.26.1") {
        return Err("l'image n'est pas celle figée dans docs/versions.md".into());
    }
    if !bloc.contains("node service/lib/entry.js compact") {
        return Err("la commande compact de l'image manque".into());
    }
    if bloc.contains("compact -b") || bloc.contains("--buckets") {
        return Err("le compactage ne vise pas tous les seaux".into());
    }
    if !bloc.contains("sleep 3600") {
        return Err("le passage n'est pas horaire (stockage version 4)".into());
    }
    if bloc.contains("teardown") || bloc.contains("UPDATE ") {
        return Err("la tâche ne doit ni vider le seau ni réécrire les lignes sources".into());
    }
    Ok(())
}

#[test]
fn compactage_seaux() {
    let compose = std::fs::read_to_string(racine().join("instance/docker-compose.yml")).expect("docker-compose");
    let bloc = bloc_compactage(&compose).expect("service");
    verifier_compactage(bloc).expect("procédure");
    let versions = std::fs::read_to_string(racine().join("docs/versions.md")).expect("versions");
    assert!(
        versions.contains("compacting-buckets") && versions.contains("toutes les heures"),
        "la procédure n'est pas consignée dans docs/versions.md"
    );
    let mauvais = bloc.replace("sleep 3600", "sleep 86400");
    assert!(verifier_compactage(&mauvais).is_err(), "un passage quotidien doit échouer");
    let vidage = format!("{bloc}\n    teardown TEARDOWN\n");
    assert!(verifier_compactage(&vidage).is_err(), "vider le seau doit échouer");
}
