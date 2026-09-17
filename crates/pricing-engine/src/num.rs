//! Shared numeric helpers. Money is always `Decimal`, never `f64`.

use rust_decimal::Decimal;

pub(crate) fn div(a: Decimal, b: Decimal) -> Option<Decimal> {
    if b.is_zero() {
        None
    } else {
        a.checked_div(b)
    }
}

pub(crate) fn clamp01(d: Decimal) -> Decimal {
    d.max(Decimal::ZERO).min(Decimal::ONE)
}

pub(crate) fn money(d: Decimal) -> Decimal {
    d.round_dp(2)
}

pub(crate) fn ratio(d: Decimal) -> Decimal {
    d.round_dp(4)
}
