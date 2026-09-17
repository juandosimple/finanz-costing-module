//! Step 5: ask a model for a price, given everything the project already knows.
//!
//! Two providers answer the same question with the same facts: a model running
//! locally through Ollama (no key, no cost) or Anthropic's API with your own key.
//! Either way the answer comes back in a fixed JSON shape, so the UI never parses
//! prose — and the arithmetic stays ours: the model is told what cost-plus already
//! suggests, and is asked for judgement on top of it.

use std::time::Duration;

use pricing_engine::{AiSuggestion, BandSuggestion, Project, ProjectResult};
use rust_decimal::Decimal;
use serde::Deserialize;
use serde_json::{json, Value};

const ANTHROPIC_URL: &str = "https://api.anthropic.com/v1/messages";
const CLAUDE_MODEL: &str = "claude-opus-5";
const API_VERSION: &str = "2023-06-01";
/// Scalar `fallbacks: "default"` needs this beta; the array form uses another one.
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";

const SYSTEM: &str = "You price B2B software. You are given a company's real internal costs, \
what their own cost-plus calculation already suggests, and what they know about their market. \
Trust their arithmetic: your job is judgement — where the price should sit against competitors, \
how it should change with volume, and what could make it wrong. Never invent competitor facts \
you were not given: if the market context is thin, say so and stay close to the cost-plus figure. \
Always write in English, even when the notes you are given are in another language.";

/// Repeated at the very end of the prompt: small local models follow the last
/// instruction they read, and would otherwise answer in the language of the notes.
const LANGUAGE_RULE: &str = "Write every text field (positioning, rationale, risks, notes) in English.";

/// The JSON the model must answer with.
fn schema() -> Value {
    json!({
        "type": "object",
        "required": [
            "subscription_price_per_building_monthly",
            "onboarding_price_per_building",
            "positioning",
            "rationale",
            "risks",
            "bands"
        ],
        "properties": {
            "subscription_price_per_building_monthly": {
                "type": "number",
                "description": "Recommended monthly subscription price for one building, in the project's currency"
            },
            "onboarding_price_per_building": {
                "type": "number",
                "description": "Recommended one-off onboarding price for one building"
            },
            // The length caps are load-bearing: without them small local models
            // write paragraphs here and repeat the same risk several times.
            "positioning": {
                "type": "string",
                "maxLength": 160,
                "description": "One short sentence: where this price sits against the competition"
            },
            "rationale": {
                "type": "string",
                "maxLength": 600,
                "description": "Two or three sentences explaining the recommendation, referring to the costs given"
            },
            "risks": {
                "type": "array",
                "minItems": 1,
                "maxItems": 4,
                "items": { "type": "string", "maxLength": 200 },
                "description": "Distinct risks that could make this price wrong. Never repeat a risk."
            },
            "bands": {
                "type": "array",
                "description": "One entry per band received, in the same order",
                "items": {
                    "type": "object",
                    "required": ["buildings", "subscription_price_per_building_monthly", "note"],
                    "properties": {
                        "buildings": { "type": "number" },
                        "subscription_price_per_building_monthly": { "type": "number" },
                        "note": { "type": "string" }
                    }
                }
            }
        }
    })
}

#[derive(Deserialize)]
struct Payload {
    subscription_price_per_building_monthly: Decimal,
    onboarding_price_per_building: Decimal,
    positioning: String,
    rationale: String,
    risks: Vec<String>,
    bands: Vec<BandPayload>,
}

#[derive(Deserialize)]
struct BandPayload {
    buildings: Decimal,
    subscription_price_per_building_monthly: Decimal,
    note: String,
}

/// Prices are quoted per month, the way the user types them; the project stores
/// the year, so every price the model returns is multiplied here, once.
const MONTHS: Decimal = Decimal::from_parts(12, 0, 0, false, 0);

/// Every text the model wrote, joined, so its language can be checked in one go.
fn written_text(parsed: &Payload) -> String {
    let mut text = format!("{} {}", parsed.positioning, parsed.rationale);
    for risk in &parsed.risks {
        text.push(' ');
        text.push_str(risk);
    }
    for band in &parsed.bands {
        text.push(' ');
        text.push_str(&band.note);
    }
    text
}

/// The app is in English whatever language the user writes the notes in, so an
/// answer in another language is rejected. A plain word count is enough here:
/// the only other language in play is the Spanish of the user's own notes.
fn is_english(text: &str) -> bool {
    const ENGLISH: &[&str] = &["the", "and", "of", "to", "is", "for", "with", "per", "price", "cost"];
    const SPANISH: &[&str] = &[
        "el", "la", "los", "las", "de", "del", "que", "para", "por", "con", "una", "es", "precio", "costo",
        "edificio", "edificios",
    ];
    let lower = text.to_lowercase();
    let words: Vec<&str> = lower
        .split(|c: char| !c.is_alphabetic())
        .filter(|w| !w.is_empty())
        .collect();
    let count = |list: &[&str]| words.iter().filter(|w| list.contains(w)).count();
    let accents = lower.chars().filter(|c| "áéíóúñ¿¡".contains(*c)).count();
    count(ENGLISH) >= count(SPANISH) + accents
}

const NOT_ENGLISH: &str = "Your previous answer was not in English. Answer again with the same \
JSON shape, writing every text field in English only.";

/// Everything the model needs to know, as compact facts rather than prose.
fn prompt(project: &Project, result: &ProjectResult) -> String {
    let currency = project.currency.code();
    let hundred = Decimal::from(100);
    let mut out = String::new();

    out.push_str(&format!(
        "Currency: {currency}. Every figure below is in {currency}.\n\n\
         OUR COSTS\n\
         - Fixed costs, whole platform: {} per month\n\
         - Cost of one building: {} per month\n\
         - Payment fee on every charge: {}%\n\
         - Subscription margin we target: {}%\n\n",
        project.structure.fixed_monthly,
        project.structure.per_building_monthly,
        project.structure.fee_percent * hundred,
        project.subscription_margin * hundred,
    ));

    if !result.onboarding_lines.is_empty() {
        out.push_str("ONBOARDING, BILLED ONCE (cost -> price we charge today)\n");
        for line in &result.onboarding_lines {
            out.push_str(&format!(
                "- {}: costs {} per unit, we charge {}\n",
                line.name, line.unit_cost, line.unit_price
            ));
        }
        out.push('\n');
    }

    out.push_str("VOLUME BANDS. Subscription figures are per building per MONTH; onboarding is a one-off per building. The suggested column is our own cost-plus arithmetic — treat it as correct.\n");
    for band in &result.bands {
        out.push_str(&format!(
            "- Band {} — {} buildings: subscription costs us {} a month, cost-plus suggests {} a month, we charge {} a month today; onboarding costs {} and we charge {}\n",
            band.position,
            band.buildings,
            (band.subscription.cost_per_building.unwrap_or_default() / MONTHS).round_dp(2),
            (band.suggested_subscription_price.unwrap_or_default() / MONTHS).round_dp(2),
            (band.subscription.price_per_building.unwrap_or_default() / MONTHS).round_dp(2),
            band.onboarding.cost_per_building.unwrap_or_default(),
            band.onboarding.price_per_building.unwrap_or_default(),
        ));
    }

    let market = &project.market;
    let or_missing = |value: &str| {
        if value.trim().is_empty() {
            "not given".to_string()
        } else {
            value.trim().to_string()
        }
    };
    out.push_str("\nMARKET\n");
    out.push_str(&format!("- Industry: {}\n", or_missing(&market.industry)));
    out.push_str(&format!("- Competitors: {}\n", or_missing(&market.competitors)));
    out.push_str(&format!(
        "- Industry average subscription: {} per building per month\n",
        market.average_subscription_price
    ));
    out.push_str(&format!(
        "- Industry average onboarding: {} per building\n",
        market.average_onboarding_price
    ));
    if !market.notes.trim().is_empty() {
        out.push_str(&format!("- Notes: {}\n", market.notes.trim()));
    }

    out.push_str(
        "\nRecommend a MONTHLY subscription price per building and a one-off onboarding price \
         per building, plus a monthly price for each band in the order given. Every subscription \
         figure you return is per building per month. Ground every number in the costs above.\n",
    );
    out.push_str(LANGUAGE_RULE);
    out
}

fn into_suggestion(parsed: Payload, model: String, now: String) -> AiSuggestion {
    AiSuggestion {
        subscription_price_per_building: parsed.subscription_price_per_building_monthly * MONTHS,
        onboarding_price_per_building: parsed.onboarding_price_per_building,
        positioning: parsed.positioning,
        rationale: parsed.rationale,
        risks: parsed.risks,
        bands: parsed
            .bands
            .into_iter()
            .map(|band| BandSuggestion {
                buildings: band.buildings,
                subscription_price_per_building: band.subscription_price_per_building_monthly * MONTHS,
                note: band.note,
            })
            .collect(),
        model,
        created_at: now,
    }
}

/// Models installed in the local Ollama, newest first as it reports them.
pub async fn local_models(base_url: &str) -> Result<Vec<String>, String> {
    let url = format!("{}/api/tags", base_url.trim_end_matches('/'));
    let response = reqwest::Client::new()
        .get(&url)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|_| "Ollama isn't answering. Start it with `ollama serve`.".to_string())?;

    let payload: Value = response
        .json()
        .await
        .map_err(|e| format!("Ollama returned something unreadable: {e}"))?;

    Ok(payload["models"]
        .as_array()
        .map(|models| {
            models
                .iter()
                .filter_map(|m| m["name"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default())
}

/// Asks a model running on this machine. No key, no cost.
pub async fn suggest_local(
    project: &Project,
    result: &ProjectResult,
    base_url: &str,
    model: &str,
    now: String,
) -> Result<AiSuggestion, String> {
    let model = if model.trim().is_empty() {
        local_models(base_url)
            .await?
            .first()
            .cloned()
            .ok_or("No local model installed. Pull one with `ollama pull llama3`.")?
    } else {
        model.trim().to_string()
    };

    let url = format!("{}/api/chat", base_url.trim_end_matches('/'));
    let mut messages = vec![
        json!({ "role": "system", "content": SYSTEM }),
        json!({ "role": "user", "content": prompt(project, result) }),
    ];

    // Small models drift into the language of the notes; one reminder is
    // usually enough, and a second miss is reported rather than saved.
    for attempt in 1..=2 {
        let (text, parsed) = ask_local_with_fallback(&url, &model, &messages).await?;
        if is_english(&written_text(&parsed)) {
            return Ok(into_suggestion(parsed, format!("{model} (local)"), now));
        }
        if attempt == 2 {
            break;
        }
        messages.push(json!({ "role": "assistant", "content": text }));
        messages.push(json!({ "role": "user", "content": NOT_ENGLISH }));
    }
    Err(format!(
        "{model} answered in another language twice, so nothing was saved. Try again or pick a bigger model in Settings."
    ))
}

/// Reasoning models (Qwen 3.5 and the like) can spend their whole budget
/// thinking and hand back an empty answer. The first try lets them think with
/// room to spare; if nothing usable comes back, the question is asked again
/// with thinking off, which always yields the JSON.
async fn ask_local_with_fallback(
    url: &str,
    model: &str,
    messages: &[Value],
) -> Result<(String, Payload), String> {
    match ask_local(url, model, messages, true).await {
        Ok(answer) => Ok(answer),
        Err(LocalError::Unusable(_)) => ask_local(url, model, messages, false)
            .await
            .map_err(LocalError::into_message),
        Err(other) => Err(other.into_message()),
    }
}

enum LocalError {
    /// Ollama answered, but not with the JSON asked for.
    Unusable(String),
    /// Ollama couldn't be reached or refused the request.
    Failed(String),
}

impl LocalError {
    fn into_message(self) -> String {
        match self {
            LocalError::Unusable(message) | LocalError::Failed(message) => message,
        }
    }
}

/// One round trip to Ollama: the raw answer, and the same answer parsed.
async fn ask_local(
    url: &str,
    model: &str,
    messages: &[Value],
    think: bool,
) -> Result<(String, Payload), LocalError> {
    let body = json!({
        "model": model,
        "stream": false,
        // Ollama takes the JSON schema directly in `format`.
        "format": schema(),
        // Ignored by models that don't reason. Their thinking comes back in a
        // separate field, so `content` stays pure JSON either way.
        "think": think,
        // Ollama's default context is small; a model that reasons needs room for
        // the prompt, its thinking and the answer together.
        "options": { "temperature": 0.2, "num_ctx": 32768 },
        "messages": messages,
    });

    let response = reqwest::Client::new()
        .post(url)
        // Generous on purpose: the local server has no GPU, and a model that
        // reasons before answering can take many minutes there. Speed isn't the goal.
        .timeout(Duration::from_secs(45 * 60))
        .json(&body)
        .send()
        .await
        .map_err(|_| LocalError::Failed("Ollama isn't answering. Start it with `ollama serve`.".into()))?;

    let status = response.status();
    let payload: Value = response
        .json()
        .await
        .map_err(|e| LocalError::Failed(format!("Ollama returned something unreadable: {e}")))?;

    if !status.is_success() {
        let message = payload["error"].as_str().unwrap_or("unknown error");
        return Err(LocalError::Failed(format!("Ollama answered {status}: {message}")));
    }

    let text = payload["message"]["content"].as_str().unwrap_or_default().to_string();
    let parsed: Payload = serde_json::from_str(&text).map_err(|e| {
        LocalError::Unusable(format!(
            "{model} didn't answer in the expected shape ({e}). A bigger model handles this better."
        ))
    })?;
    Ok((text, parsed))
}

/// Asks Claude. `api_key` is the user's own Anthropic key.
pub async fn suggest_claude(
    project: &Project,
    result: &ProjectResult,
    api_key: &str,
    now: String,
) -> Result<AiSuggestion, String> {
    let body = json!({
        "model": CLAUDE_MODEL,
        "max_tokens": 16000,
        "thinking": { "type": "adaptive" },
        // A policy decline retries on another model inside the same call.
        "fallbacks": "default",
        "output_config": { "format": { "type": "json_schema", "schema": schema() } },
        "system": SYSTEM,
        "messages": [{ "role": "user", "content": prompt(project, result) }],
    });

    let response = reqwest::Client::new()
        .post(ANTHROPIC_URL)
        .header("content-type", "application/json")
        .header("x-api-key", api_key)
        .header("anthropic-version", API_VERSION)
        .header("anthropic-beta", FALLBACK_BETA)
        .timeout(Duration::from_secs(300))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Couldn't reach the Claude API: {e}"))?;

    let status = response.status();
    let payload: Value = response
        .json()
        .await
        .map_err(|e| format!("The Claude API returned something unreadable: {e}"))?;

    if !status.is_success() {
        let message = payload["error"]["message"].as_str().unwrap_or("unknown error");
        return Err(match status.as_u16() {
            401 => "The API key was rejected. Check it in Settings.".to_string(),
            429 => "Rate limited by the Claude API. Try again in a moment.".to_string(),
            _ => format!("The Claude API answered {status}: {message}"),
        });
    }

    // Always check the stop reason before reading the content.
    if payload["stop_reason"] == "refusal" {
        return Err("Claude declined to answer this request.".into());
    }

    let text = payload["content"]
        .as_array()
        .and_then(|blocks| {
            blocks
                .iter()
                .find(|block| block["type"] == "text")
                .and_then(|block| block["text"].as_str())
        })
        .ok_or("The Claude API returned no text to read.")?;

    let parsed: Payload = serde_json::from_str(text)
        .map_err(|e| format!("The answer didn't match the expected shape: {e}"))?;

    if !is_english(&written_text(&parsed)) {
        return Err("Claude answered in another language, so nothing was saved. Try again.".into());
    }

    Ok(into_suggestion(
        parsed,
        payload["model"].as_str().unwrap_or(CLAUDE_MODEL).to_string(),
        now,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use pricing_engine::{plan_project, Currency, ProjectTemplate};

    fn project() -> Project {
        let mut project = Project::from_template(
            "p".into(),
            "MODLE".into(),
            String::new(),
            "now".into(),
            ProjectTemplate::BuildingOwners,
            Currency::GBP,
        );
        project.market.industry = "Building compliance software".into();
        project.market.competitors = "Acme — 5,000 per building".into();
        project
    }

    #[test]
    fn the_schema_asks_for_every_field_the_ui_reads() {
        let schema = schema();
        let required: Vec<&str> = schema["required"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert!(required.contains(&"subscription_price_per_building_monthly"));
        assert!(required.contains(&"onboarding_price_per_building"));
        assert!(required.contains(&"bands"));
        assert_eq!(
            schema["properties"]["bands"]["items"]["required"].as_array().unwrap().len(),
            3
        );
    }

    #[test]
    fn a_monthly_answer_is_stored_as_the_year_the_project_works_in() {
        let parsed: Payload = serde_json::from_str(
            r#"{"subscription_price_per_building_monthly": 90,
                "onboarding_price_per_building": 1700,
                "positioning": "mid", "rationale": "because", "risks": ["churn"],
                "bands": [{"buildings": 5, "subscription_price_per_building_monthly": 120, "note": "small"}]}"#,
        )
        .unwrap();

        let suggestion = into_suggestion(parsed, "m".into(), "now".into());

        assert_eq!(suggestion.subscription_price_per_building, Decimal::from(1080));
        assert_eq!(suggestion.bands[0].subscription_price_per_building, Decimal::from(1440));
        // A one-off price is not a rate: it is stored exactly as answered.
        assert_eq!(suggestion.onboarding_price_per_building, Decimal::from(1700));
    }

    #[test]
    fn the_prompt_carries_the_costs_the_bands_and_the_market() {
        let project = project();
        let text = prompt(&project, &plan_project(&project));

        assert!(text.contains("GBP"));
        assert!(text.contains("Fixed costs"));
        assert!(text.contains("Scan to BIM"));
        assert!(text.contains("Band 1 — 5 buildings"));
        assert!(text.contains("Band 6 — 200 buildings"));
        assert!(text.contains("Building compliance software"));
        assert!(text.contains("Acme"));
    }

    #[test]
    fn the_prompt_anchors_the_model_to_our_own_arithmetic() {
        let project = project();
        let text = prompt(&project, &plan_project(&project));
        assert!(text.contains("cost-plus suggests"));
        assert!(text.contains("treat it as correct"));
    }

    #[test]
    fn the_answer_is_asked_for_in_english_whatever_the_notes_say() {
        let mut project = project();
        project.market.notes = "Qué consume un edificio por mes".into();
        let text = prompt(&project, &plan_project(&project));

        assert!(SYSTEM.contains("Always write in English"));
        assert!(text.trim_end().ends_with(LANGUAGE_RULE));
    }

    #[test]
    fn a_spanish_answer_is_told_apart_from_an_english_one() {
        assert!(!is_english(
            "El precio sugerido de suscripción por edificio mensual es de 81 GBP para edificios individuales."
        ));
        assert!(is_english(
            "The suggested monthly price per building sits above the cost-plus figure and below Brocade."
        ));
        // Competitor names and currency codes alone don't make a text Spanish.
        assert!(is_english("Priced between Brocade and BlockPro, with the cost of the Spine unit recovered."));
    }

    #[test]
    fn a_missing_market_is_stated_rather_than_left_blank() {
        let mut project = project();
        project.market = pricing_engine::MarketContext::default();
        let text = prompt(&project, &plan_project(&project));
        assert!(text.contains("Industry: not given"));
        assert!(text.contains("Competitors: not given"));
    }
}
