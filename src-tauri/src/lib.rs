pub mod ai;
mod db;
mod keys;
mod rates;

use db::Db;
use pricing_engine::{
    plan_project, AiProvider, AiSuggestion, AppSettings, Currency, ExchangeRates, Project,
    ProjectResult, ProjectSummary, ProjectTemplate,
};
use tauri::{Manager, State};

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[tauri::command]
fn list_projects(db: State<'_, Db>) -> Result<Vec<ProjectSummary>, String> {
    db.list_projects()
}

#[tauri::command]
fn create_project(
    db: State<'_, Db>,
    name: String,
    client: String,
    template: ProjectTemplate,
    currency: Currency,
) -> Result<Project, String> {
    let name = match name.trim() {
        "" => "New project".to_string(),
        trimmed => trimmed.to_string(),
    };
    let project = Project::from_template(
        new_id(),
        name,
        client.trim().to_string(),
        now(),
        template,
        currency,
    );
    db.upsert_project(&project)?;
    Ok(project)
}

#[tauri::command]
fn get_project(db: State<'_, Db>, id: String) -> Result<Project, String> {
    db.get_project(&id)
}

#[tauri::command]
fn save_project(db: State<'_, Db>, mut project: Project) -> Result<Project, String> {
    project.updated_at = now();
    db.upsert_project(&project)?;
    Ok(project)
}

#[tauri::command]
fn duplicate_project(db: State<'_, Db>, id: String) -> Result<Project, String> {
    let mut project = db.get_project(&id)?;
    project.id = new_id();
    project.name = format!("{} (copy)", project.name);
    project.created_at = now();
    project.updated_at = project.created_at.clone();
    db.upsert_project(&project)?;
    Ok(project)
}

#[tauri::command]
fn delete_project(db: State<'_, Db>, id: String) -> Result<(), String> {
    db.delete_project(&id)
}

#[tauri::command]
fn plan(project: Project) -> ProjectResult {
    plan_project(&project)
}

/// True when an Anthropic key is stored in the keychain.
#[tauri::command]
fn has_api_key() -> Result<bool, String> {
    Ok(keys::read()?.is_some())
}

#[tauri::command]
fn save_api_key(key: String) -> Result<(), String> {
    if key.trim().is_empty() {
        return keys::clear();
    }
    keys::save(&key)
}

/// Models installed in the local Ollama, for the Settings dropdown.
#[tauri::command]
async fn list_local_models(db: State<'_, Db>) -> Result<Vec<String>, String> {
    let settings = db.app_settings()?;
    ai::local_models(&settings.local_url).await
}

/// Step 1: change the template of a project that already exists.
#[tauri::command]
fn switch_template(mut project: Project, template: ProjectTemplate) -> Project {
    project.set_template(template);
    project
}

/// Asks for a price, using the project's costs and its market context.
/// The provider chosen in Settings decides who answers.
#[tauri::command]
async fn suggest_prices(db: State<'_, Db>, project: Project) -> Result<AiSuggestion, String> {
    if project.template == ProjectTemplate::Contractors {
        return Err("AI suggestions work with building bands; plans aren't supported yet.".into());
    }
    let settings = db.app_settings()?;
    let result = plan_project(&project);
    match settings.ai_provider {
        AiProvider::Local => {
            ai::suggest_local(
                &project,
                &result,
                &settings.local_url,
                &settings.local_model,
                now(),
            )
            .await
        }
        AiProvider::None => Err("No AI provider is selected. Pick one in Settings.".into()),
        AiProvider::Claude => {
            let key = keys::read()?
                .ok_or("Add your Anthropic API key in Settings, or switch to a local model.")?;
            ai::suggest_claude(&project, &result, &key, now()).await
        }
    }
}

#[tauri::command]
fn get_settings(db: State<'_, Db>) -> Result<AppSettings, String> {
    db.app_settings()
}

#[tauri::command]
fn save_settings(db: State<'_, Db>, settings: AppSettings) -> Result<(), String> {
    db.save_app_settings(&settings)
}

#[tauri::command]
fn get_rates(db: State<'_, Db>) -> Result<ExchangeRates, String> {
    db.rates()
}

#[tauri::command]
fn save_rates(db: State<'_, Db>, rates: ExchangeRates) -> Result<ExchangeRates, String> {
    db.save_rates(&rates)?;
    Ok(rates)
}

#[tauri::command]
async fn refresh_rates(db: State<'_, Db>) -> Result<ExchangeRates, String> {
    let mut latest = rates::fetch_latest().await?;
    // Keep currencies the service didn't return.
    for rate in db.rates()?.rates {
        if !latest.rates.iter().any(|r| r.currency == rate.currency) {
            latest.rates.push(rate);
        }
    }
    db.save_rates(&latest)?;
    Ok(latest)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Settings updates the app in place and restarts it, so no installer
            // is ever downloaded by hand.
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;

            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(Db::open(&dir.join("analyzer.db"))?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_projects,
            create_project,
            get_project,
            save_project,
            duplicate_project,
            delete_project,
            plan,
            switch_template,
            has_api_key,
            save_api_key,
            list_local_models,
            suggest_prices,
            get_settings,
            save_settings,
            get_rates,
            save_rates,
            refresh_rates,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
