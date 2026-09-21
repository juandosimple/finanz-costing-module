//! Plans: how the contractors/consultants template is sold.
//!
//! A contractor or consultant doesn't bring buildings; they buy a plan that
//! includes a number of active projects and an amount of storage, and what it
//! costs is a fixed share of the platform plus that storage: it fills over the
//! year — so it costs more every month — and every month roughly as much is
//! downloaded as was added. Only year 1 is priced.

use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::num::{clamp01, div, money, ratio};
use crate::project::{quantity_of, resolve, stream, BlockedItem, PriceRule, Project, Recurrence, StreamResult};

const MONTHS: Decimal = dec!(12);
/// 1 + 2 + … + 12: how many GB-months a year of steady uploads adds up to,
/// per GB uploaded each month.
const STORED_GB_MONTHS_PER_GB: Decimal = dec!(78);

/// Step 2 for plans: what one account's usage costs.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UsageCosts {
    /// Platform share of one account, whatever plan it is on, per month.
    #[ts(type = "number")]
    pub per_account_monthly: Decimal,
    /// Platform share of one active project, per month.
    #[ts(type = "number")]
    pub per_project_monthly: Decimal,
    /// What the platform costs every month whether or not anyone buys it. It is
    /// a cost of the business, not of an account, so no plan carries a share.
    #[ts(type = "number")]
    pub platform_fixed_monthly: Decimal,
    /// Blob storage plus its backup copy, per GB kept, per month.
    #[ts(type = "number")]
    pub storage_per_gb_month: Decimal,
    /// Outbound transfer, per GB downloaded.
    #[ts(type = "number")]
    pub download_per_gb: Decimal,
    /// GB downloaded each month for every GB added that month (1 = the same).
    #[ts(type = "number")]
    pub download_share: Decimal,
}

impl Default for UsageCosts {
    fn default() -> Self {
        UsageCosts {
            per_account_monthly: dec!(0.5),
            per_project_monthly: dec!(0.05),
            platform_fixed_monthly: dec!(100),
            storage_per_gb_month: dec!(0.035),
            download_per_gb: dec!(0.07),
            download_share: Decimal::ONE,
        }
    }
}

/// Who holds the account. Both buy the same plans at their own price.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum AccountType {
    Contractor,
    Consultant,
}

/// Step 4 for this template: one plan on sale.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Plan {
    pub id: String,
    pub name: String,
    /// Active projects the plan includes.
    #[ts(type = "number")]
    pub projects: Decimal,
    /// Users the plan is sold to. Every user gets the whole plan, so the
    /// subscription is simply multiplied by them.
    #[serde(default = "one")]
    #[ts(type = "number")]
    pub users: Decimal,
    /// Storage a contractor account on this plan carries, in GB, after a year.
    #[serde(default)]
    #[ts(type = "number")]
    pub contractor_storage_gb: Decimal,
    /// The same for a consultant account, who keeps less.
    #[serde(default)]
    #[ts(type = "number")]
    pub consultant_storage_gb: Decimal,
    /// How a contractor is charged. `None` follows the project margin; an
    /// amount is the yearly price of one account.
    #[serde(default)]
    pub contractor_price: Option<PriceRule>,
    /// How a consultant is charged, with the same rules.
    #[serde(default)]
    pub consultant_price: Option<PriceRule>,
    /// Ids of the onboarding elements this plan includes, per account.
    #[serde(default)]
    pub onboarding: Vec<String>,
}

fn one() -> Decimal {
    Decimal::ONE
}

/// One account type on one plan, over year 1.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AccountResult {
    pub account: AccountType,
    #[ts(type = "number")]
    pub uploaded_gb_per_month: Decimal,
    /// What this account stores once the year is over.
    #[ts(type = "number")]
    pub stored_gb_end_of_year: Decimal,
    #[ts(type = "number")]
    pub cost_first_month: Decimal,
    #[ts(type = "number")]
    pub cost_last_month: Decimal,
    /// Year 1 of the subscription for one account.
    pub subscription: StreamResult,
    /// Year 1 of the subscription for all the plan's users together.
    pub all_users: StreamResult,
    /// Billed once, for one account.
    pub onboarding: StreamResult,
    /// Yearly price that would hit the project margin.
    #[ts(type = "number | null")]
    pub suggested_price: Option<Decimal>,
    pub price_is_manual: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PlanResult {
    pub plan_id: String,
    /// 1-based place in the project's list.
    pub position: u32,
    pub name: String,
    #[ts(type = "number")]
    pub projects: Decimal,
    #[ts(type = "number")]
    pub users: Decimal,
    pub onboarding_ids: Vec<String>,
    pub blocked: Vec<BlockedItem>,
    pub contractor: AccountResult,
    pub consultant: AccountResult,
}

/// The plans every contractors project starts with.
pub fn default_plans(onboarding: &[String]) -> Vec<Plan> {
    let plan = |id: &str, name: &str, projects: Decimal, storage: Decimal| Plan {
        id: id.into(),
        name: name.into(),
        projects,
        users: Decimal::ONE,
        contractor_storage_gb: storage,
        consultant_storage_gb: storage,
        contractor_price: None,
        consultant_price: None,
        onboarding: onboarding.to_vec(),
    };
    vec![
        plan("basic", "Basic", dec!(20), dec!(250)),
        plan("platinum", "Platinum", dec!(50), dec!(600)),
        plan("gold", "Gold", dec!(100), dec!(1200)),
    ]
}

pub(crate) fn plan_plans(project: &Project, subscription_room: Decimal, fee: Decimal) -> Vec<PlanResult> {
    project
        .plans
        .iter()
        .enumerate()
        .map(|(index, plan)| {
            let (selection, blocked) = resolve(&project.onboarding, &plan.onboarding);

            // Onboarding is per account: a per-building element counts once.
            let mut one_off = (Decimal::ZERO, Decimal::ZERO);
            let mut annual = (Decimal::ZERO, Decimal::ZERO);
            for item in &selection {
                let quantity = quantity_of(item, Decimal::ONE);
                let cost = quantity * item.internal_unit_cost.max(Decimal::ZERO);
                let price = quantity * item.price.price_for(item.internal_unit_cost);
                match item.recurrence {
                    Recurrence::OneOff => {
                        one_off.0 += cost;
                        one_off.1 += price;
                    }
                    Recurrence::Annual => {
                        annual.0 += cost;
                        if item.price.is_amount() {
                            annual.1 += price;
                        }
                    }
                }
            }

            let account = |kind: AccountType, rule: Option<PriceRule>, storage: Decimal| {
                plan_account(project, plan, kind, rule, storage, one_off, annual, subscription_room, fee)
            };

            PlanResult {
                plan_id: plan.id.clone(),
                position: index as u32 + 1,
                name: plan.name.clone(),
                projects: plan.projects.max(Decimal::ZERO),
                users: plan.users.max(Decimal::ZERO),
                onboarding_ids: selection.iter().map(|item| item.id.clone()).collect(),
                blocked,
                contractor: account(AccountType::Contractor, plan.contractor_price, plan.contractor_storage_gb),
                consultant: account(AccountType::Consultant, plan.consultant_price, plan.consultant_storage_gb),
            }
        })
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn plan_account(
    project: &Project,
    plan: &Plan,
    kind: AccountType,
    rule: Option<PriceRule>,
    storage_gb: Decimal,
    (one_off_cost, one_off_price): (Decimal, Decimal),
    (annual_cost, annual_price): (Decimal, Decimal),
    subscription_room: Decimal,
    fee: Decimal,
) -> AccountResult {
    let usage = &project.usage;
    let projects = plan.projects.max(Decimal::ZERO);
    // The platform's own fixed cost is deliberately absent: it belongs to the
    // business, not to an account, so it never lands in a plan's margin.
    let fixed = usage.per_account_monthly.max(Decimal::ZERO) + projects * usage.per_project_monthly.max(Decimal::ZERO);
    let storage = usage.storage_per_gb_month.max(Decimal::ZERO);
    // The plan's storage is what a year adds up to, so a month adds a twelfth.
    let uploaded = storage_gb.max(Decimal::ZERO) / MONTHS;
    let downloads = uploaded * usage.download_share.max(Decimal::ZERO) * usage.download_per_gb.max(Decimal::ZERO);

    // Month m keeps m months of uploads.
    let month = |m: Decimal| fixed + uploaded * m * storage + downloads;
    let year_cost = MONTHS * (fixed + downloads) + storage * uploaded * STORED_GB_MONTHS_PER_GB + annual_cost;

    let recoverable = year_cost - annual_price;
    let price_at = |room: Decimal| {
        Some(recoverable)
            .filter(|_| room > Decimal::ZERO)
            .and_then(|cost| div(cost, room))
            .map(money)
    };
    let suggested_price = price_at(subscription_room);
    let price = match rule {
        None => suggested_price,
        Some(PriceRule::Amount { value }) => Some(money(value.max(Decimal::ZERO))),
        Some(PriceRule::Margin { percent }) => price_at(Decimal::ONE - fee - clamp01(percent)),
    };
    let subscription_price = price.unwrap_or_default() + annual_price;
    let subscription = stream(year_cost, subscription_price, fee, Decimal::ONE);
    // Built from the rounded figures, so N users are exactly N times one.
    let users = plan.users.max(Decimal::ZERO);
    let all_users = stream(subscription.cost * users, subscription.price * users, fee, Decimal::ONE);

    AccountResult {
        account: kind,
        uploaded_gb_per_month: ratio(uploaded),
        stored_gb_end_of_year: ratio(uploaded * MONTHS),
        cost_first_month: money(month(Decimal::ONE)),
        cost_last_month: money(month(MONTHS)),
        subscription,
        all_users,
        onboarding: stream(one_off_cost, one_off_price, fee, Decimal::ONE),
        suggested_price,
        price_is_manual: rule.is_some(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::{plan_project, ProjectResult, ProjectTemplate};
    use crate::Currency;

    fn contractors() -> Project {
        let mut p = Project::from_template(
            "p".into(),
            "Test".into(),
            String::new(),
            "now".into(),
            ProjectTemplate::Contractors,
            Currency::GBP,
        );
        // The storage figures are checked on their own.
        for plan in &mut p.plans {
            plan.onboarding.clear();
        }
        p
    }

    fn plan<'a>(result: &'a ProjectResult, id: &str) -> &'a PlanResult {
        result.plans.iter().find(|p| p.plan_id == id).unwrap()
    }

    #[test]
    fn a_contractors_project_starts_with_three_plans_and_no_bands() {
        let p = Project::from_template(
            "p".into(),
            "Test".into(),
            String::new(),
            "now".into(),
            ProjectTemplate::Contractors,
            Currency::GBP,
        );
        let names: Vec<&str> = p.plans.iter().map(|plan| plan.name.as_str()).collect();
        assert_eq!(names, ["Basic", "Platinum", "Gold"]);
        assert!(p.bands.is_empty());
        assert_eq!(p.plans[0].onboarding, ["onboarding", "go-live", "support-overhead"]);
    }

    #[test]
    fn the_plan_storage_fills_over_the_year_and_costs_more_every_month() {
        let mut p = contractors();
        for plan in &mut p.plans {
            if plan.id == "gold" {
                plan.consultant_storage_gb = dec!(400);
            }
        }
        let result = plan_project(&p);

        // Gold: 1,200 GB after a year, so 100 GB are added each month.
        let gold = &plan(&result, "gold").contractor;
        assert_eq!(gold.uploaded_gb_per_month, dec!(100));
        assert_eq!(gold.stored_gb_end_of_year, dec!(1200));
        assert_eq!(gold.cost_first_month, dec!(16)); // 5.50 platform + 3.50 storage + 7 downloads
        assert_eq!(gold.cost_last_month, dec!(54.5)); // 5.50 + 42 + 7
        assert_eq!(gold.subscription.cost, dec!(423));

        // Basic: 250 GB, and a platform share of 0.50 + 20 × 0.05.
        let basic = &plan(&result, "basic").contractor;
        assert_eq!(basic.cost_first_month, dec!(3.69));
        assert_eq!(basic.cost_last_month, dec!(11.71));

        // A consultant on the same plan can keep less, and then costs less.
        let consultant = &plan(&result, "gold").consultant;
        assert_eq!(consultant.stored_gb_end_of_year, dec!(400));
        assert_eq!(consultant.subscription.cost, dec!(185));
    }

    #[test]
    fn each_account_type_gets_its_own_price() {
        let mut p = contractors();
        p.subscription_margin = dec!(0.35);
        p.structure.fee_percent = dec!(0.029);
        for plan in &mut p.plans {
            if plan.id == "gold" {
                plan.consultant_price = Some(PriceRule::Amount { value: dec!(120) });
            }
        }
        let result = plan_project(&p);
        let gold = plan(&result, "gold");

        // 423 a year / (1 − 0.029 − 0.35)
        assert_eq!(gold.contractor.suggested_price, Some(dec!(681.16)));
        assert_eq!(gold.contractor.subscription.price, dec!(681.16));
        assert!(!gold.contractor.price_is_manual);
        assert!((gold.contractor.subscription.margin.unwrap() - dec!(0.35)).abs() < dec!(0.001));

        assert!(gold.consultant.price_is_manual);
        assert_eq!(gold.consultant.subscription.price, dec!(120));
        // 120 − 3.48 fee − 423 cost: a fixed price well under what it costs.
        assert_eq!(gold.consultant.subscription.profit, dec!(-306.48));
    }

    #[test]
    fn onboarding_is_charged_once_per_account_whatever_its_basis() {
        let mut p = contractors();
        for plan in &mut p.plans {
            plan.onboarding = vec!["support-overhead".into(), "api-integration".into()];
        }
        let result = plan_project(&p);
        let basic = plan(&result, "basic");

        // 1,000 per building counts once; the API integration is a per-project 5,000.
        assert_eq!(basic.contractor.onboarding.cost, dec!(6000));
        assert_eq!(basic.consultant.onboarding.cost, dec!(6000));
    }

    #[test]
    fn the_platform_fixed_cost_is_not_carried_by_any_plan() {
        let mut p = contractors();
        let before = plan_project(&p).plans[0].contractor.subscription.cost;
        p.usage.platform_fixed_monthly = dec!(100_000);
        assert_eq!(plan_project(&p).plans[0].contractor.subscription.cost, before);
    }

    #[test]
    fn the_subscription_is_multiplied_by_the_plans_users() {
        let mut p = contractors();
        p.plans[0].users = dec!(5);
        let result = plan_project(&p);
        let basic = &plan(&result, "basic").contractor;

        assert_eq!(basic.all_users.cost, basic.subscription.cost * dec!(5));
        assert_eq!(basic.all_users.price, basic.subscription.price * dec!(5));
        assert_eq!(basic.all_users.margin, basic.subscription.margin);
        // A single user is the account itself.
        let gold = &plan(&result, "gold").contractor;
        assert_eq!(gold.all_users.price, gold.subscription.price);
    }

    #[test]
    fn a_plans_project_needs_no_bands_to_be_valid() {
        let result = plan_project(&contractors());
        assert!(result.bands.is_empty());
        assert!(!result.warnings.iter().any(|w| w.contains("band")));
    }
}
