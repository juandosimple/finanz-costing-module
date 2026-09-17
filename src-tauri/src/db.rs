use std::{
    fmt::Display,
    path::Path,
    sync::{Mutex, MutexGuard},
};

use pricing_engine::{apply_catalogue_rules, AppSettings, ExchangeRates, Project, ProjectSummary};
use rusqlite::{params, Connection, OptionalExtension};

const RATES_KEY: &str = "exchange_rates";
const APP_SETTINGS_KEY: &str = "app_settings";

/// Local SQLite. Each project is stored as a JSON document.
pub struct Db(Mutex<Connection>);

/// Bands saved before the per-band selection existed carry no `onboarding` key.
/// They inherit whatever the project had ticked back then, so its numbers survive;
/// a band that simply holds an empty list is left alone — that is a real choice.
fn migrate_band_selection(value: &mut serde_json::Value) {
    if value["bands"]
        .as_array()
        .is_none_or(|bands| bands.iter().all(|band| band.get("onboarding").is_some()))
    {
        return;
    }

    let ticked: Vec<String> = value["onboarding"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter(|item| item["included"].as_bool().unwrap_or(false))
                .filter_map(|item| item["id"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let inherited = if ticked.is_empty() {
        pricing_engine::default_selection()
    } else {
        ticked
    };

    if let Some(bands) = value["bands"].as_array_mut() {
        for band in bands {
            if band.get("onboarding").is_none() {
                band["onboarding"] = serde_json::json!(inherited);
            }
        }
    }
}

pub fn err(e: impl Display) -> String {
    e.to_string()
}

impl Db {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS projects (
                 id         TEXT PRIMARY KEY,
                 data       TEXT NOT NULL,
                 updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS settings (
                 key   TEXT PRIMARY KEY,
                 value TEXT NOT NULL
             );",
        )?;
        Ok(Db(Mutex::new(conn)))
    }

    fn conn(&self) -> MutexGuard<'_, Connection> {
        self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn list_projects(&self) -> Result<Vec<ProjectSummary>, String> {
        let conn = self.conn();
        let mut stmt = conn
            .prepare("SELECT data FROM projects ORDER BY updated_at DESC")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(err)?;

        let mut summaries = Vec::new();
        for data in rows {
            // Projects from an older model are skipped rather than breaking the list.
            if let Ok(project) = serde_json::from_str::<Project>(&data.map_err(err)?) {
                summaries.push(project.summary());
            }
        }
        Ok(summaries)
    }

    /// Old shapes are migrated and catalogue rules re-applied on load, so a project
    /// saved before a rule existed obeys it as soon as it is opened.
    pub fn get_project(&self, id: &str) -> Result<Project, String> {
        let data: Option<String> = self
            .conn()
            .query_row(
                "SELECT data FROM projects WHERE id = ?1",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(err)?;
        let data = data.ok_or_else(|| "Project not found".to_string())?;

        let mut value: serde_json::Value = serde_json::from_str(&data).map_err(err)?;
        migrate_band_selection(&mut value);
        let mut project: Project = serde_json::from_value(value).map_err(err)?;
        apply_catalogue_rules(&mut project);
        Ok(project)
    }

    pub fn upsert_project(&self, project: &Project) -> Result<(), String> {
        let data = serde_json::to_string(project).map_err(err)?;
        self.conn()
            .execute(
                "INSERT INTO projects (id, data, updated_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
                params![project.id, data, project.updated_at],
            )
            .map_err(err)?;
        Ok(())
    }

    pub fn delete_project(&self, id: &str) -> Result<(), String> {
        self.conn()
            .execute("DELETE FROM projects WHERE id = ?1", params![id])
            .map_err(err)?;
        Ok(())
    }

    /// Saved rates, or the initial ones if none have been saved yet.
    pub fn rates(&self) -> Result<ExchangeRates, String> {
        Ok(self
            .setting(RATES_KEY)?
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_else(ExchangeRates::defaults))
    }

    pub fn save_rates(&self, rates: &ExchangeRates) -> Result<(), String> {
        self.put_setting(RATES_KEY, rates)
    }

    /// App-wide preferences (currency, theme), or the defaults.
    pub fn app_settings(&self) -> Result<AppSettings, String> {
        Ok(self
            .setting(APP_SETTINGS_KEY)?
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_default())
    }

    pub fn save_app_settings(&self, settings: &AppSettings) -> Result<(), String> {
        self.put_setting(APP_SETTINGS_KEY, settings)
    }

    fn setting(&self, key: &str) -> Result<Option<String>, String> {
        self.conn()
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .optional()
            .map_err(err)
    }

    fn put_setting<T: serde::Serialize>(&self, key: &str, value: &T) -> Result<(), String> {
        let value = serde_json::to_string(value).map_err(err)?;
        self.conn()
            .execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![key, value],
            )
            .map_err(err)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_band_without_the_field_inherits_what_the_project_had_ticked() {
        let mut value = json!({
            "onboarding": [
                {"id": "scan-to-bim", "included": true},
                {"id": "measured-survey", "included": false},
                {"id": "spine-unit", "included": true},
            ],
            "bands": [{"id": "b1", "buildings": 5}, {"id": "b2", "buildings": 20}],
        });

        migrate_band_selection(&mut value);

        for band in value["bands"].as_array().unwrap() {
            assert_eq!(band["onboarding"], json!(["scan-to-bim", "spine-unit"]));
        }
    }

    #[test]
    fn a_band_that_chose_nothing_is_left_alone() {
        let mut value = json!({
            "onboarding": [{"id": "scan-to-bim", "included": true}],
            "bands": [{"id": "b1", "buildings": 5, "onboarding": []}],
        });

        migrate_band_selection(&mut value);

        assert_eq!(value["bands"][0]["onboarding"], json!([]));
    }

    #[test]
    fn without_the_old_flag_the_default_selection_is_used() {
        let mut value = json!({
            "onboarding": [{"id": "scan-to-bim"}],
            "bands": [{"id": "b1", "buildings": 5}],
        });

        migrate_band_selection(&mut value);

        assert_eq!(
            value["bands"][0]["onboarding"],
            json!(pricing_engine::default_selection())
        );
    }
}
