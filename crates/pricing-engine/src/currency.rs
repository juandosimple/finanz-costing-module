use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum Currency {
    USD,
    ARS,
    CLP,
    COP,
    MXN,
    UYU,
    GBP,
    EUR,
}

impl Currency {
    pub const ALL: [Currency; 8] = [
        Currency::USD,
        Currency::ARS,
        Currency::CLP,
        Currency::COP,
        Currency::MXN,
        Currency::UYU,
        Currency::GBP,
        Currency::EUR,
    ];

    pub fn code(self) -> &'static str {
        match self {
            Currency::USD => "USD",
            Currency::ARS => "ARS",
            Currency::CLP => "CLP",
            Currency::COP => "COP",
            Currency::MXN => "MXN",
            Currency::UYU => "UYU",
            Currency::GBP => "GBP",
            Currency::EUR => "EUR",
        }
    }

    pub fn from_code(code: &str) -> Option<Currency> {
        Currency::ALL.into_iter().find(|c| c.code() == code)
    }
}

/// How many units of `currency` equal 1 USD.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Rate {
    pub currency: Currency,
    #[ts(type = "number")]
    pub per_usd: Decimal,
}

/// Reference rates, shown in Settings so amounts typed in one currency can be
/// re-stated in another by hand.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ExchangeRates {
    pub rates: Vec<Rate>,
    /// Date (as text) of the last rates update.
    pub updated_at: Option<String>,
    pub source: String,
}

impl ExchangeRates {
    pub fn per_usd(&self, currency: Currency) -> Option<Decimal> {
        if currency == Currency::USD {
            return Some(Decimal::ONE);
        }
        self.rates
            .iter()
            .find(|r| r.currency == currency)
            .map(|r| r.per_usd)
            .filter(|r| r.is_sign_positive() && !r.is_zero())
    }

    /// Initial rates (open.er-api.com, 2026-09-15). Refreshed from Settings.
    pub fn defaults() -> Self {
        let rate = |currency, per_usd| Rate { currency, per_usd };
        ExchangeRates {
            rates: vec![
                rate(Currency::USD, dec!(1)),
                rate(Currency::ARS, dec!(1510.3215)),
                rate(Currency::CLP, dec!(941.30807)),
                rate(Currency::COP, dec!(3078.939055)),
                rate(Currency::MXN, dec!(17.121071)),
                rate(Currency::UYU, dec!(40.193103)),
                rate(Currency::GBP, dec!(0.740963)),
                rate(Currency::EUR, dec!(0.865688)),
            ],
            updated_at: Some("2026-09-15".into()),
            source: "open.er-api.com (initial values)".into(),
        }
    }
}
