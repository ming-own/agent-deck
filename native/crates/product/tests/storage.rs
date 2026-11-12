use agentdeck_product::{Catalog, ValidatedDocument, storage};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::PathBuf,
};

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("agentdeck-product-{}", agentdeck_product::new_id()));
        fs::create_dir(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        Self(path)
    }
    fn path(&self) -> PathBuf {
        self.0.join("catalog.json")
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn persistence_reopen_is_private_and_leaves_no_temporary_files() {
    let f = Fixture::new();
    let mut catalog = Catalog::new();
    catalog.add_space("Persisted");
    let space = &mut catalog.spaces[0];
    let session = space.add_session("Session");
    space
        .add_agent(
            &session,
            "Unconfigured Agent",
            canvas_core::Point::default(),
        )
        .unwrap();
    storage::save(&f.path(), &catalog).unwrap();
    assert_eq!(storage::load::<Catalog>(&f.path()).unwrap(), catalog);
    assert_eq!(
        fs::metadata(f.path()).unwrap().permissions().mode() & 0o777,
        0o600
    );
    storage::save(&f.path(), &catalog).unwrap();
    assert_eq!(fs::read_dir(&f.0).unwrap().count(), 1);
}

#[test]
fn corruption_unknown_version_and_schema_are_never_overwritten() {
    let f = Fixture::new();
    for bad in [
        "{",
        r#"{"version":999,"spaces":[],"active_space_id":""}"#,
        r#"{"version":1,"spaces":[],"active_space_id":"","unexpected":true}"#,
    ] {
        fs::write(f.path(), bad).unwrap();
        assert!(storage::load::<Catalog>(&f.path()).is_err());
        assert!(storage::save(&f.path(), &Catalog::new()).is_err());
        assert_eq!(fs::read_to_string(f.path()).unwrap(), bad);
        assert_eq!(fs::read_dir(&f.0).unwrap().count(), 1);
    }
}

#[derive(Debug, Deserialize)]
struct SerializationFails;
impl Serialize for SerializationFails {
    fn serialize<S: serde::Serializer>(&self, _: S) -> Result<S::Ok, S::Error> {
        Err(serde::ser::Error::custom("forced failure"))
    }
}
impl ValidatedDocument for SerializationFails {
    fn validate(&self) -> agentdeck_product::Result<()> {
        Ok(())
    }
}

#[test]
fn invalid_or_unserializable_document_preserves_original_bytes() {
    let f = Fixture::new();
    storage::save(&f.path(), &Catalog::new()).unwrap();
    let before = fs::read(f.path()).unwrap();
    assert!(storage::save(&f.path(), &SerializationFails).is_err());
    let mut invalid = Catalog::new();
    invalid.version = 999;
    assert!(storage::save(&f.path(), &invalid).is_err());
    assert_eq!(fs::read(f.path()).unwrap(), before);
    assert_eq!(fs::read_dir(&f.0).unwrap().count(), 1);
}

#[test]
fn refuses_symlink_target_parent_and_oversized_file() {
    let f = Fixture::new();
    let original = f.0.join("original.json");
    fs::write(&original, "untouched").unwrap();
    symlink(&original, f.path()).unwrap();
    assert!(storage::load::<Catalog>(&f.path()).is_err());
    assert!(storage::save(&f.path(), &Catalog::new()).is_err());
    assert_eq!(fs::read_to_string(&original).unwrap(), "untouched");
    fs::remove_file(f.path()).unwrap();
    fs::File::create(f.path())
        .unwrap()
        .set_len(storage::MAX_DOCUMENT_BYTES + 1)
        .unwrap();
    assert!(storage::load::<Catalog>(&f.path()).is_err());
    let alias = f.0.join("alias");
    symlink(&f.0, &alias).unwrap();
    assert!(storage::save(&alias.join("other.json"), &Catalog::new()).is_err());
}

#[test]
fn duplicate_map_keys_are_corrupt_and_not_replaced() {
    let f = Fixture::new();
    let mut catalog = Catalog::new();
    let id = catalog.add_space("Workspace");
    let mut value = serde_json::to_value(&catalog).unwrap();
    value["spaces"][0]["resources"] = serde_json::json!({ "skill": { "id": "skill", "title": "Skill", "content": "one", "kind": "skill", "revision": 1 } });
    let json = serde_json::to_string(&value).unwrap();
    let needle = r#""resources":{"skill":{"content":"one","id":"skill","kind":"skill","revision":1,"title":"Skill"}}"#;
    assert!(json.contains(needle));
    let bad = json.replace(needle, r#""resources":{"skill":{"id":"skill","title":"Skill","content":"first","kind":"skill","revision":1},"skill":{"id":"skill","title":"Skill","content":"second","kind":"skill","revision":1}}"#);
    fs::write(f.path(), &bad).unwrap();
    assert!(
        storage::load::<Catalog>(&f.path()).is_err(),
        "duplicate keys must not silently discard data in {id}"
    );
    assert!(storage::save(&f.path(), &catalog).is_err());
    assert_eq!(fs::read_to_string(f.path()).unwrap(), bad);
}
