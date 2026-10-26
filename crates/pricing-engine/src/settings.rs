use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::{Currency, ProjectTemplate, SharedCost};

/// Appearance mode of the app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Theme {
    /// Follow the operating system.
    System,
    Light,
    Dark,
}

/// Who answers the pricing suggestion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AiProvider {
    /// A model running on this machine through Ollama. No key, no cost.
    #[default]
    Local,
    /// Anthropic's API, with your own key.
    Claude,
    /// Nobody: step 5 is off.
    None,
}

fn default_local_url() -> String {
    "http://localhost:11434".into()
}

/// App-wide preferences shared by every screen.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AppSettings {
    /// Currency every screen shows results in.
    pub currency: Currency,
    pub theme: Theme,
    #[serde(default)]
    pub ai_provider: AiProvider,
    /// Where Ollama listens.
    #[serde(default = "default_local_url")]
    pub local_url: String,
    /// Which installed model to ask. Empty means "the first one available".
    #[serde(default)]
    pub local_model: String,
    /// Platform and services lists saved by name, to import into another project.
    #[serde(default)]
    pub cost_templates: Vec<CostTemplate>,
}

/// A saved list of platform costs. It only imports into projects of the
/// template it was saved from.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CostTemplate {
    pub name: String,
    /// Lists saved before this was recorded came from building-owners projects.
    #[serde(default = "building_owners")]
    pub template: ProjectTemplate,
    pub shared: Vec<SharedCost>,
}

fn building_owners() -> ProjectTemplate {
    ProjectTemplate::BuildingOwners
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            currency: Currency::USD,
            theme: Theme::System,
            ai_provider: AiProvider::default(),
            local_url: default_local_url(),
            local_model: String::new(),
            cost_templates: Vec::new(),
        }
    }
}
