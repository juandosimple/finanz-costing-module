//! Cost and pricing engine.
//!
//! A project is built in steps — template, costs, target margin, scenarios. A
//! building-owners project prices bands of buildings; a contractors project
//! prices plans, per account. Money is always `Decimal`, never
//! `f64`. Ratios are stored as 0..1 fractions (e.g. 2.9% = 0.029); the UI shows
//! them as percentages.

mod currency;
mod num;
mod plans;
mod project;
mod settings;

pub use currency::*;
pub use plans::*;
pub use project::*;
pub use settings::*;
