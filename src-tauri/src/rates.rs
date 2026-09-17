use std::{collections::HashMap, time::Duration};

use pricing_engine::{Currency, ExchangeRates, Rate};
use rust_decimal::{prelude::FromPrimitive, Decimal};
use serde::Deserialize;

use crate::db::err;

const RATES_URL: &str = "https://open.er-api.com/v6/latest/USD";

#[derive(Deserialize)]
struct RatesResponse {
    result: String,
    time_last_update_utc: Option<String>,
    rates: HashMap<String, f64>,
}

/// Downloads today's rates (USD base) for the currencies the app supports.
pub async fn fetch_latest() -> Result<ExchangeRates, String> {
    let response: RatesResponse = reqwest::Client::new()
        .get(RATES_URL)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| format!("Couldn't reach the exchange rate service: {e}"))?
        .error_for_status()
        .map_err(err)?
        .json()
        .await
        .map_err(err)?;

    if response.result != "success" {
        return Err("The exchange rate service returned an error".into());
    }

    let rates = Currency::ALL
        .into_iter()
        .filter_map(|currency| {
            let per_usd = Decimal::from_f64(*response.rates.get(currency.code())?)?;
            Some(Rate {
                currency,
                per_usd: per_usd.round_dp(6),
            })
        })
        .collect();

    let updated_at = response.time_last_update_utc.map(|raw| {
        chrono::DateTime::parse_from_rfc2822(&raw)
            .map(|dt| dt.format("%Y-%m-%d %H:%M UTC").to_string())
            .unwrap_or(raw)
    });

    Ok(ExchangeRates {
        rates,
        updated_at,
        source: "open.er-api.com".into(),
    })
}
