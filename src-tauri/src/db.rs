use std::{
    fmt::Display,
    path::Path,
    sync::{Mutex, MutexGuard},
};

use pricing_engine::{apply_catalogue_rules, default_shared_costs, AppSettings, ExchangeRates, Project, ProjectSummary, SERVER};
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

/// Projects saved before the server became one of the shared services carry it,
/// and the costs once charged with a margin, as figures of their own. Both become
/// rows of the list at their full cost, so the project's numbers survive.
fn migrate_structure(value: &mut serde_json::Value) {
    let Some(fields) = value["structure"].as_object_mut() else {
        return;
    };
    let server = fields.remove("fixed_monthly");
    let other = [fields.remove("monthly_with_margin"), fields.remove("per_building_monthly")]
        .into_iter()
        .flatten()
        .find(|v| v.as_f64().is_some_and(|n| n > 0.0));
    fields.remove("fee_percent");
    if server.is_none() && other.is_none() {
        return;
    }

    let shared = fields
        .entry("shared")
        .or_insert_with(|| serde_json::json!(default_shared_costs()));
    let Some(rows) = shared.as_array_mut() else {
        return;
    };
    if let Some(server) = server {
        match rows.iter_mut().find(|row| row["id"] == SERVER) {
            Some(row) => row["monthly"] = server,
            None => rows.insert(
                0,
                serde_json::json!({"id": SERVER, "name": "Server", "monthly": server, "share": 1}),
            ),
        }
    }
    if let Some(other) = other {
        rows.push(serde_json::json!({"id": "other-costs", "name": "Other costs", "monthly": other, "share": 1}));
    }
}

/// Projects saved before prices became markups carry margins. Each one turns
/// into the markup that gives the same price (37.5% margin = 60% markup), so no
/// figure moves. Band rules already worked as markups and only change name.
fn migrate_to_markup(value: &mut serde_json::Value) {
    if value.get("subscription_markup").is_some() {
        return;
    }
    let as_markup = |margin: &serde_json::Value| {
        // A margin can't reach 100%; the app capped it at 95%.
        let margin = margin.as_f64().unwrap_or(0.0).clamp(0.0, 0.95);
        serde_json::json!(margin / (1.0 - margin))
    };
    let convert = |rule: &mut serde_json::Value, keep_value: bool| {
        if rule["type"] == "margin" {
            rule["type"] = serde_json::json!("markup");
            if !keep_value {
                rule["percent"] = as_markup(&rule["percent"]);
            }
        }
    };

    if let Some(fields) = value.as_object_mut() {
        let margin = fields
            .remove("subscription_margin")
            .or_else(|| fields.remove("target_margin"))
            .unwrap_or(serde_json::json!(0));
        fields.insert("subscription_markup".into(), as_markup(&margin));
    }
    for item in value["onboarding"].as_array_mut().into_iter().flatten() {
        convert(&mut item["price"], false);
    }
    for plan in value["plans"].as_array_mut().into_iter().flatten() {
        convert(&mut plan["contractor_price"], false);
        convert(&mut plan["consultant_price"], false);
    }
    for band in value["bands"].as_array_mut().into_iter().flatten() {
        convert(&mut band["price"], true);
    }
}

/// Reads a stored or exported project, bringing an older shape up to date.
pub fn parse_project(data: &str) -> Result<Project, String> {
    let mut value: serde_json::Value = serde_json::from_str(data).map_err(err)?;
    migrate_band_selection(&mut value);
    migrate_structure(&mut value);
    migrate_to_markup(&mut value);
    let mut project: Project = serde_json::from_value(value).map_err(err)?;
    apply_catalogue_rules(&mut project);
    Ok(project)
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
        parse_project(&data.ok_or_else(|| "Project not found".to_string())?)
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
    fn margins_become_the_markups_that_give_the_same_price() {
        let mut value = json!({
            "subscription_margin": 0.35,
            "onboarding": [{"price": {"type": "margin", "percent": 0.375}}, {"price": {"type": "amount", "value": 5000}}],
            "plans": [{"contractor_price": {"type": "margin", "percent": 0.5}, "consultant_price": null}],
            "bands": [{"price": {"type": "margin", "percent": 0.4}}],
        });

        migrate_to_markup(&mut value);

        assert!(value.get("subscription_margin").is_none());
        assert!((value["subscription_markup"].as_f64().unwrap() - 0.35 / 0.65).abs() < 1e-9);
        assert_eq!(value["onboarding"][0]["price"], json!({"type": "markup", "percent": 0.6}));
        assert_eq!(value["onboarding"][1]["price"], json!({"type": "amount", "value": 5000}));
        assert_eq!(value["plans"][0]["contractor_price"], json!({"type": "markup", "percent": 1.0}));
        assert_eq!(value["plans"][0]["consultant_price"], json!(null));
        // Already a markup in all but name.
        assert_eq!(value["bands"][0]["price"], json!({"type": "markup", "percent": 0.4}));

        // A project already on markups is left alone.
        let before = value.clone();
        migrate_to_markup(&mut value);
        assert_eq!(value, before);
    }

    #[test]
    fn the_old_server_and_other_costs_become_rows_of_the_shared_services() {
        let mut value = json!({"structure": {
            "fixed_monthly": 800,
            "per_building_monthly": 6,
            "fee_percent": 0.029,
        }});

        migrate_structure(&mut value);

        let structure = value["structure"].as_object().unwrap();
        assert_eq!(structure.len(), 1, "only the list is left: {structure:?}");
        let rows = structure["shared"].as_array().unwrap();
        let server = rows.iter().find(|row| row["id"] == SERVER).unwrap();
        assert_eq!(server["monthly"], json!(800));
        let other = rows.iter().find(|row| row["id"] == "other-costs").unwrap();
        assert_eq!(other["monthly"], json!(6));
        // The whole default list comes along, and nothing else.
        assert_eq!(rows.len(), default_shared_costs().len() + 1);
    }

    #[test]
    fn a_project_saved_with_a_list_but_no_server_row_gets_one() {
        let mut value = json!({"structure": {
            "fixed_monthly": 130,
            "monthly_with_margin": 0,
            "shared": [{"id": "mailgun", "name": "Mailgun", "monthly": 12, "share": 0.5}],
        }});

        migrate_structure(&mut value);

        let rows = value["structure"]["shared"].as_array().unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["id"], json!(SERVER));
        assert_eq!(rows[0]["monthly"], json!(130));
    }

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
