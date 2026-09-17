//! A project answers one question: what does a building cost us, and what do we
//! charge for it? It is built in five steps — template, costs, pricing, the
//! scenarios per building band, and a suggestion — and the number of clients never
//! enters the maths: everything is expressed per building.
//!
//! Money comes in two separate streams, because the client pays them separately:
//! **onboarding**, billed once (modelling, surveys, drawings, hardware), and the
//! **subscription**, billed every year.
//!
//! Step 2 declares what every element costs — none of them is optional there.
//! Step 3 says what to charge for each. Step 4 is where a scenario picks which
//! onboarding elements it actually needs: a client with drawings already doesn't
//! pay for a scan.

use rust_decimal::Decimal;
use rust_decimal_macros::dec;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::num::{clamp01, div, money, ratio};
use crate::plans::{default_plans, plan_plans, Plan, PlanResult, UsageCosts};
use crate::Currency;

fn default_price_rule() -> PriceRule {
    PriceRule::Margin { percent: dec!(0.375) }
}

/// What a band includes unless you say otherwise.
const DEFAULT_SELECTION: [&str; 6] = [
    "scan-to-bim",
    "fire-strategy-embed",
    "onboarding",
    "go-live",
    "spine-unit",
    "support-overhead",
];

/// Categories a contractor or consultant never buys from us: they bring their
/// own models, surveys, drawings and compliance work, and no hardware.
const BUILDING_SIDE_CATEGORIES: [&str; 5] = [
    "Data & Modelling",
    "Surveys",
    "Drawings & Registers",
    "Compliance",
    "Hardware",
];

/// Ongoing services a contractor or consultant doesn't buy either.
const BUILDING_SIDE_ITEMS: [&str; 2] = ["compliance-review", "emergency-integration"];

/// Whether a contractor or consultant can be offered this element.
fn offered_to_contractors(item: &OnboardingItem) -> bool {
    !BUILDING_SIDE_CATEGORIES.contains(&item.category.as_str()) && !BUILDING_SIDE_ITEMS.contains(&item.id.as_str())
}

/// What a project starts from. The old names are still read, so projects saved
/// before the rename open unchanged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ProjectTemplate {
    /// Platform costs plus the whole onboarding catalogue (surveys, modelling, hardware…).
    #[serde(alias = "modle")]
    BuildingOwners,
    /// Platform costs plus the setup and ongoing services a contractor buys.
    #[serde(alias = "technical_only")]
    Contractors,
}

impl ProjectTemplate {
    /// The onboarding catalogue a new project of this template starts with.
    pub fn catalogue(self) -> Vec<OnboardingItem> {
        let catalogue = modle_catalogue();
        match self {
            ProjectTemplate::BuildingOwners => catalogue,
            ProjectTemplate::Contractors => catalogue.into_iter().filter(offered_to_contractors).collect(),
        }
    }
}

/// Step 2a: what running the platform costs, regardless of the deal.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StructureCosts {
    /// Monthly costs that don't grow with buildings (hosting, team, tools).
    /// They are spread across the buildings of each band.
    #[ts(type = "number")]
    pub fixed_monthly: Decimal,
    /// Monthly cost of one building (connectivity, storage, AI, licences).
    #[ts(type = "number")]
    pub per_building_monthly: Decimal,
    /// Payment fee taken out of every charge.
    #[ts(type = "number")]
    pub fee_percent: Decimal,
}

/// How the quantity of an onboarding line is counted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CostBasis {
    /// One per building in the band.
    PerBuilding,
    /// A fixed quantity for the whole deal.
    PerProject,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Recurrence {
    /// Billed once, on top of the subscription.
    OneOff,
    /// Billed every year with the subscription.
    Annual,
}

/// Step 3: what to charge for one cost — a margin over it, or a fixed price.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(export)]
pub enum PriceRule {
    /// Price = cost / (1 − percent). 37.5% is the same as multiplying by 1.6.
    Margin {
        #[ts(type = "number")]
        percent: Decimal,
    },
    /// A price per unit typed by hand: the Spine unit costs 2,000 and sells at 5,000.
    Amount {
        #[ts(type = "number")]
        value: Decimal,
    },
}

impl PriceRule {
    /// Sale price of one unit with this rule.
    pub fn price_for(self, cost: Decimal) -> Decimal {
        let cost = cost.max(Decimal::ZERO);
        match self {
            PriceRule::Amount { value } => value.max(Decimal::ZERO),
            PriceRule::Margin { percent } => {
                let room = Decimal::ONE - clamp01(percent);
                div(cost, room).unwrap_or(cost)
            }
        }
    }

    pub fn is_amount(self) -> bool {
        matches!(self, PriceRule::Amount { .. })
    }
}

/// One element of the onboarding catalogue: what it costs (step 2) and what it is
/// charged at (step 3). Every element always exists — a scenario decides whether
/// it is used.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OnboardingItem {
    pub id: String,
    pub category: String,
    pub name: String,
    pub basis: CostBasis,
    pub recurrence: Recurrence,
    /// Used when the basis doesn't follow the building count.
    #[ts(type = "number")]
    pub quantity: Decimal,
    #[ts(type = "number")]
    pub internal_unit_cost: Decimal,
    #[serde(default = "default_price_rule")]
    pub price: PriceRule,
    /// Elements sharing a group are alternatives: a band can only take one.
    #[serde(default)]
    pub exclusive_group: Option<String>,
    /// Ids this element already covers, so a band can't take both.
    #[serde(default)]
    pub makes_unnecessary: Vec<String>,
}

/// Why an element can't be picked in a band with its current selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum BlockedReason {
    /// Another option of the same group is in.
    Alternative,
    /// Another element already includes this work.
    Covered,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BlockedItem {
    pub id: String,
    /// Name of the element that rules this one out.
    pub blocked_by: String,
    pub reason: BlockedReason,
}

/// Step 4: a volume scenario, with the onboarding it actually needs.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Band {
    pub id: String,
    #[ts(type = "number")]
    pub buildings: Decimal,
    /// How this band's subscription is charged. `None` follows the project margin.
    #[serde(default)]
    pub price: Option<PriceRule>,
    /// Ids of the onboarding elements this scenario includes.
    #[serde(default)]
    pub onboarding: Vec<String>,
}

/// Step 5: what the market looks like, so a suggestion can be priced against it.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MarketContext {
    pub industry: String,
    /// One competitor per line, with whatever you know about their pricing.
    pub competitors: String,
    /// What the industry charges per building per year, if you know it.
    #[ts(type = "number")]
    pub average_subscription_price: Decimal,
    /// What the industry charges to onboard one building.
    #[ts(type = "number")]
    pub average_onboarding_price: Decimal,
    pub notes: String,
}

/// What the model suggests for one band.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BandSuggestion {
    #[ts(type = "number")]
    pub buildings: Decimal,
    #[ts(type = "number")]
    pub subscription_price_per_building: Decimal,
    pub note: String,
}

/// A suggestion produced from the project's costs and its market.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AiSuggestion {
    #[ts(type = "number")]
    pub subscription_price_per_building: Decimal,
    #[ts(type = "number")]
    pub onboarding_price_per_building: Decimal,
    /// Where this lands against the competition, in one line.
    pub positioning: String,
    pub rationale: String,
    pub risks: Vec<String>,
    pub bands: Vec<BandSuggestion>,
    /// Which model answered, and when.
    pub model: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub client: String,
    #[serde(default)]
    pub notes: String,
    pub template: ProjectTemplate,
    pub currency: Currency,
    /// Step 3: margin the suggested subscription price leaves.
    #[serde(alias = "target_margin")]
    #[ts(type = "number")]
    pub subscription_margin: Decimal,
    pub structure: StructureCosts,
    /// What one account's usage costs. Only plans use it.
    #[serde(default)]
    pub usage: UsageCosts,
    pub onboarding: Vec<OnboardingItem>,
    /// Building bands: how a building-owners project is priced.
    pub bands: Vec<Band>,
    /// Plans: how a contractors project is priced.
    #[serde(default)]
    pub plans: Vec<Plan>,
    /// Step 5 inputs and the last suggestion returned for them.
    #[serde(default)]
    pub market: MarketContext,
    #[serde(default)]
    pub last_suggestion: Option<AiSuggestion>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub client: String,
    pub template: ProjectTemplate,
    pub currency: Currency,
    pub updated_at: String,
}

/// One element of the catalogue, priced. Per unit: quantities belong to a band.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OnboardingLine {
    pub id: String,
    pub category: String,
    pub name: String,
    pub recurrence: Recurrence,
    #[ts(type = "number")]
    pub unit_cost: Decimal,
    #[ts(type = "number")]
    pub unit_price: Decimal,
    /// True when the price was typed instead of derived from a margin.
    pub manual_price: bool,
    #[ts(type = "number | null")]
    pub margin: Option<Decimal>,
}

/// One money stream of a band: what it costs, what it bills and what it leaves.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StreamResult {
    #[ts(type = "number")]
    pub cost: Decimal,
    #[ts(type = "number | null")]
    pub cost_per_building: Option<Decimal>,
    #[ts(type = "number")]
    pub price: Decimal,
    #[ts(type = "number | null")]
    pub price_per_building: Option<Decimal>,
    #[ts(type = "number")]
    pub fees: Decimal,
    #[ts(type = "number")]
    pub profit: Decimal,
    #[ts(type = "number | null")]
    pub margin: Option<Decimal>,
}

/// One year of a band. Year 1 carries the onboarding billed once; the years after
/// it are the subscription alone.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct YearResult {
    pub year: u32,
    #[ts(type = "number")]
    pub price: Decimal,
    #[ts(type = "number | null")]
    pub price_per_building: Option<Decimal>,
    #[ts(type = "number")]
    pub cost: Decimal,
    #[ts(type = "number | null")]
    pub cost_per_building: Option<Decimal>,
    #[ts(type = "number")]
    pub profit: Decimal,
    #[ts(type = "number | null")]
    pub profit_per_building: Option<Decimal>,
    #[ts(type = "number | null")]
    pub margin: Option<Decimal>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct BandResult {
    pub band_id: String,
    /// 1-based place in the project's list, which is what names the band.
    pub position: u32,
    #[ts(type = "number")]
    pub buildings: Decimal,
    /// Onboarding elements actually priced in this band.
    pub onboarding_ids: Vec<String>,
    /// Elements this band can't take, and why.
    pub blocked: Vec<BlockedItem>,
    /// Billed once, separately from the subscription.
    pub onboarding: StreamResult,
    /// Billed every year.
    pub subscription: StreamResult,
    /// Subscription price per building that would hit the target margin.
    #[ts(type = "number | null")]
    pub suggested_subscription_price: Option<Decimal>,
    /// True when the band's subscription price was typed by hand.
    pub subscription_price_is_manual: bool,
    /// Share of the fixed costs carried by one building.
    #[ts(type = "number | null")]
    pub fixed_cost_per_building: Option<Decimal>,
    /// Years 1, 2 and 3.
    pub years: Vec<YearResult>,
    /// The three years added up.
    #[ts(type = "number")]
    pub three_year_price: Decimal,
    #[ts(type = "number | null")]
    pub three_year_price_per_building: Option<Decimal>,
    #[ts(type = "number")]
    pub three_year_profit: Decimal,
    #[ts(type = "number | null")]
    pub three_year_profit_per_building: Option<Decimal>,
    #[ts(type = "number | null")]
    pub three_year_margin: Option<Decimal>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ProjectResult {
    pub currency: Currency,
    pub bands: Vec<BandResult>,
    pub plans: Vec<PlanResult>,
    /// Every catalogue element with its cost and price, per unit.
    pub onboarding_lines: Vec<OnboardingLine>,
    pub warnings: Vec<String>,
}

/// Relations that always hold for the MODLE catalogue, whatever a saved project says.
fn catalogue_rules(id: &str) -> (Option<&'static str>, &'static [&'static str]) {
    match id {
        "scan-to-bim" => (Some("model-source"), &["measured-survey", "asset-capture"]),
        "model-from-plans" | "import-bim" => (Some("model-source"), &[]),
        _ => (None, &[]),
    }
}

/// Re-attaches the catalogue relations and drops picks a band can't hold together,
/// so a project saved before a rule existed obeys it as soon as it is opened.
pub fn apply_catalogue_rules(project: &mut Project) {
    // A contractors project saved before an element was withdrawn loses it on
    // open; the band and plan selections below then drop it too.
    if project.template == ProjectTemplate::Contractors {
        project.onboarding.retain(offered_to_contractors);
    }
    for item in &mut project.onboarding {
        let (group, covers) = catalogue_rules(&item.id);
        if let Some(group) = group {
            item.exclusive_group = Some(group.to_string());
        }
        if !covers.is_empty() {
            item.makes_unnecessary = covers.iter().map(|id| id.to_string()).collect();
        }
    }

    let catalogue = project.onboarding.clone();
    let keep = |wanted: &[String]| -> Vec<String> {
        let (kept, _) = resolve(&catalogue, wanted);
        kept.iter().map(|item| item.id.clone()).collect()
    };
    for band in &mut project.bands {
        band.onboarding = keep(&band.onboarding);
    }
    for plan in &mut project.plans {
        plan.onboarding = keep(&plan.onboarding);
    }
}

/// Walks the catalogue in order, keeping what a band can actually hold.
pub(crate) fn resolve<'a>(
    catalogue: &'a [OnboardingItem],
    wanted: &[String],
) -> (Vec<&'a OnboardingItem>, Vec<BlockedItem>) {
    let mut chosen: Vec<(&str, &str)> = Vec::new();
    let mut covered: Vec<(&str, &str)> = Vec::new();
    let mut kept: Vec<&OnboardingItem> = Vec::new();
    let mut blocked: Vec<BlockedItem> = Vec::new();

    for item in catalogue.iter().filter(|item| wanted.contains(&item.id)) {
        if let Some((_, by)) = covered.iter().find(|(id, _)| *id == item.id) {
            blocked.push(BlockedItem {
                id: item.id.clone(),
                blocked_by: (*by).to_string(),
                reason: BlockedReason::Covered,
            });
            continue;
        }
        if let Some(group) = item.exclusive_group.as_deref() {
            match chosen.iter().find(|(g, _)| *g == group) {
                Some((_, picked)) => {
                    blocked.push(BlockedItem {
                        id: item.id.clone(),
                        blocked_by: (*picked).to_string(),
                        reason: BlockedReason::Alternative,
                    });
                    continue;
                }
                None => chosen.push((group, item.name.as_str())),
            }
        }
        for id in &item.makes_unnecessary {
            covered.push((id.as_str(), item.name.as_str()));
        }
        kept.push(item);
    }

    // What the band hasn't picked but couldn't pick either, so the UI can grey it out.
    for item in catalogue.iter().filter(|item| !wanted.contains(&item.id)) {
        if let Some((_, by)) = covered.iter().find(|(id, _)| *id == item.id) {
            blocked.push(BlockedItem {
                id: item.id.clone(),
                blocked_by: (*by).to_string(),
                reason: BlockedReason::Covered,
            });
        } else if let Some(group) = item.exclusive_group.as_deref() {
            if let Some((_, picked)) = chosen.iter().find(|(g, _)| *g == group) {
                blocked.push(BlockedItem {
                    id: item.id.clone(),
                    blocked_by: (*picked).to_string(),
                    reason: BlockedReason::Alternative,
                });
            }
        }
    }

    (kept, blocked)
}

/// Costs, prices and margins for every band.
pub fn plan_project(project: &Project) -> ProjectResult {
    let fee = clamp01(project.structure.fee_percent);
    let subscription_room = Decimal::ONE - fee - clamp01(project.subscription_margin);
    let mut warnings = Vec::new();

    if subscription_room <= Decimal::ZERO {
        warnings.push(
            "The payment fee plus the subscription margin reach 100%: no subscription price can be suggested."
                .into(),
        );
    }
    match project.template {
        ProjectTemplate::BuildingOwners if project.bands.is_empty() => {
            warnings.push("Add at least one building band.".into());
        }
        ProjectTemplate::Contractors if project.plans.is_empty() => {
            warnings.push("Add at least one plan.".into());
        }
        _ => {}
    }

    // Bands keep the order you put them in: that order is their name.
    let bands: Vec<BandResult> = project
        .bands
        .iter()
        .enumerate()
        .map(|(index, band)| {
            plan_band(project, band, index as u32 + 1, subscription_room, fee)
        })
        .collect();

    let onboarding_lines: Vec<OnboardingLine> = project.onboarding.iter().map(price_line).collect();

    for line in onboarding_lines.iter().filter(|l| l.unit_price < l.unit_cost) {
        warnings.push(format!("\"{}\" is priced below its internal cost.", line.name));
    }

    ProjectResult {
        currency: project.currency,
        bands,
        plans: plan_plans(project, subscription_room, fee),
        onboarding_lines,
        warnings,
    }
}

fn price_line(item: &OnboardingItem) -> OnboardingLine {
    let unit_cost = item.internal_unit_cost.max(Decimal::ZERO);
    let unit_price = item.price.price_for(unit_cost);
    OnboardingLine {
        id: item.id.clone(),
        category: item.category.clone(),
        name: item.name.clone(),
        recurrence: item.recurrence,
        unit_cost: money(unit_cost),
        unit_price: money(unit_price),
        manual_price: item.price.is_amount(),
        margin: div(unit_price - unit_cost, unit_price).map(ratio),
    }
}

pub(crate) fn quantity_of(item: &OnboardingItem, buildings: Decimal) -> Decimal {
    match item.basis {
        CostBasis::PerBuilding => buildings,
        CostBasis::PerProject => item.quantity.max(Decimal::ZERO),
    }
}

pub(crate) fn stream(cost: Decimal, price: Decimal, fee: Decimal, buildings: Decimal) -> StreamResult {
    let fees = price * fee;
    let profit = price - fees - cost;
    StreamResult {
        cost: money(cost),
        cost_per_building: div(cost, buildings).map(money),
        price: money(price),
        price_per_building: div(price, buildings).map(money),
        fees: money(fees),
        profit: money(profit),
        margin: div(profit, price).map(ratio),
    }
}

fn plan_band(
    project: &Project,
    band: &Band,
    position: u32,
    subscription_room: Decimal,
    fee: Decimal,
) -> BandResult {
    let buildings = band.buildings.max(Decimal::ZERO);
    let structure = &project.structure;
    let (selection, blocked) = resolve(&project.onboarding, &band.onboarding);

    let mut one_off_cost = Decimal::ZERO;
    let mut one_off_price = Decimal::ZERO;
    let mut annual_service_cost = Decimal::ZERO;
    let mut annual_service_price = Decimal::ZERO;
    for item in &selection {
        let quantity = quantity_of(item, buildings);
        let cost = quantity * item.internal_unit_cost.max(Decimal::ZERO);
        let price = quantity * item.price.price_for(item.internal_unit_cost);
        match item.recurrence {
            Recurrence::OneOff => {
                one_off_cost += cost;
                one_off_price += price;
            }
            Recurrence::Annual => {
                annual_service_cost += cost;
                // A recurring service priced by hand bills on top of the
                // subscription; on a margin it is covered by the subscription price.
                if item.price.is_amount() {
                    annual_service_price += price;
                }
            }
        }
    }

    let fixed_annual = structure.fixed_monthly.max(Decimal::ZERO) * dec!(12);
    let per_building_annual =
        structure.per_building_monthly.max(Decimal::ZERO) * dec!(12) * buildings;
    let subscription_cost = fixed_annual + per_building_annual + annual_service_cost;

    // What the subscription has to recover per building, before margin and fees.
    let recoverable_per_building = div(subscription_cost - annual_service_price, buildings);
    let price_at = |room: Decimal| {
        recoverable_per_building
            .filter(|_| room > Decimal::ZERO)
            .and_then(|per_building| div(per_building, room))
            .map(money)
    };

    let suggested_subscription_price = price_at(subscription_room);
    let subscription_price_per_building = match band.price {
        None => suggested_subscription_price,
        Some(PriceRule::Amount { value }) => Some(money(value.max(Decimal::ZERO))),
        Some(PriceRule::Margin { percent }) => price_at(Decimal::ONE - fee - clamp01(percent)),
    };
    let subscription_price = subscription_price_per_building
        .map(|price| price * buildings + annual_service_price)
        .unwrap_or(annual_service_price);

    let onboarding = stream(one_off_cost, one_off_price, fee, buildings);
    let subscription = stream(subscription_cost, subscription_price, fee, buildings);

    // Year 1 pays the onboarding on top; years 2 and 3 are the subscription again.
    let year = |year: u32, price: Decimal, cost: Decimal, profit: Decimal| YearResult {
        year,
        price: money(price),
        price_per_building: div(price, buildings).map(money),
        cost: money(cost),
        cost_per_building: div(cost, buildings).map(money),
        profit: money(profit),
        profit_per_building: div(profit, buildings).map(money),
        margin: div(profit, price).map(ratio),
    };
    let years = vec![
        year(
            1,
            onboarding.price + subscription.price,
            onboarding.cost + subscription.cost,
            onboarding.profit + subscription.profit,
        ),
        year(2, subscription.price, subscription.cost, subscription.profit),
        year(3, subscription.price, subscription.cost, subscription.profit),
    ];
    let three_year_price: Decimal = years.iter().map(|y| y.price).sum();
    let three_year_profit: Decimal = years.iter().map(|y| y.profit).sum();

    BandResult {
        band_id: band.id.clone(),
        position,
        buildings,
        onboarding_ids: selection.iter().map(|item| item.id.clone()).collect(),
        blocked,
        suggested_subscription_price,
        subscription_price_is_manual: band.price.is_some(),
        fixed_cost_per_building: div(fixed_annual, buildings).map(money),
        three_year_price: money(three_year_price),
        three_year_price_per_building: div(three_year_price, buildings).map(money),
        three_year_profit: money(three_year_profit),
        three_year_profit_per_building: div(three_year_profit, buildings).map(money),
        three_year_margin: div(three_year_profit, three_year_price).map(ratio),
        years,
        onboarding,
        subscription,
    }
}

impl Project {
    pub fn summary(&self) -> ProjectSummary {
        ProjectSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            client: self.client.clone(),
            template: self.template,
            currency: self.currency,
            updated_at: self.updated_at.clone(),
        }
    }

    /// Step 1: the template can still be changed. The catalogue is rebuilt for the
    /// new one, keeping the costs and prices of every element both share, and the
    /// scenarios the new template prices with are created if it has none yet.
    pub fn set_template(&mut self, template: ProjectTemplate) {
        if self.template == template {
            return;
        }
        self.template = template;
        let kept = std::mem::take(&mut self.onboarding);
        self.onboarding = template
            .catalogue()
            .into_iter()
            .map(|fresh| {
                kept.iter()
                    .find(|item| item.id == fresh.id)
                    .cloned()
                    .unwrap_or(fresh)
            })
            .collect();
        match template {
            ProjectTemplate::BuildingOwners if self.bands.is_empty() => {
                self.bands = default_bands(template);
            }
            ProjectTemplate::Contractors if self.plans.is_empty() => {
                self.plans = default_plans(&default_selection_for(template));
            }
            _ => {}
        }
        apply_catalogue_rules(self);
    }

    /// Step 1: a project ready for step 2.
    pub fn from_template(
        id: String,
        name: String,
        client: String,
        now: String,
        template: ProjectTemplate,
        currency: Currency,
    ) -> Self {
        let mut project = Project {
            id,
            name,
            client,
            notes: String::new(),
            template,
            currency,
            subscription_margin: dec!(0.35),
            structure: StructureCosts {
                fixed_monthly: dec!(800),
                per_building_monthly: dec!(6),
                fee_percent: dec!(0.029),
            },
            onboarding: template.catalogue(),
            usage: UsageCosts::default(),
            bands: match template {
                ProjectTemplate::BuildingOwners => default_bands(template),
                ProjectTemplate::Contractors => Vec::new(),
            },
            plans: match template {
                ProjectTemplate::BuildingOwners => Vec::new(),
                ProjectTemplate::Contractors => default_plans(&default_selection_for(template)),
            },
            market: MarketContext::default(),
            last_suggestion: None,
            created_at: now.clone(),
            updated_at: now,
        };
        apply_catalogue_rules(&mut project);
        project
    }
}

/// What a band includes when nothing says otherwise.
pub fn default_selection() -> Vec<String> {
    DEFAULT_SELECTION.iter().map(|id| id.to_string()).collect()
}

/// The default elements this template's catalogue actually has.
fn default_selection_for(template: ProjectTemplate) -> Vec<String> {
    let catalogue = template.catalogue();
    DEFAULT_SELECTION
        .iter()
        .filter(|id| catalogue.iter().any(|item| item.id == **id))
        .map(|id| id.to_string())
        .collect()
}

/// The volume scenarios a building-owners project starts with.
pub fn default_bands(template: ProjectTemplate) -> Vec<Band> {
    let selection = default_selection_for(template);
    let band = |id: &str, buildings| Band {
        id: id.into(),
        buildings,
        price: None,
        onboarding: selection.clone(),
    };
    vec![
        band("b1", dec!(5)),
        band("b2", dec!(20)),
        band("b3", dec!(50)),
        band("b4", dec!(70)),
        band("b5", dec!(100)),
        band("b6", dec!(200)),
    ]
}

/// The full onboarding catalogue: costs, and the rule each one is charged at.
/// Each template starts from it (see `ProjectTemplate::catalogue`).
fn modle_catalogue() -> Vec<OnboardingItem> {
    use CostBasis::*;
    use Recurrence::*;

    let margin = default_price_rule();
    let amount = |value| PriceRule::Amount { value };

    let item = |id: &str,
                category: &str,
                name: &str,
                basis: CostBasis,
                recurrence: Recurrence,
                internal: Decimal,
                price: PriceRule| OnboardingItem {
        id: id.into(),
        category: category.into(),
        name: name.into(),
        basis,
        recurrence,
        quantity: Decimal::ONE,
        internal_unit_cost: internal,
        price,
        exclusive_group: None,
        makes_unnecessary: Vec::new(),
    };

    let data = "Data & Modelling";
    let surveys = "Surveys";
    let drawings = "Drawings & Registers";
    let compliance = "Compliance";
    let setup = "Platform Setup";
    let hardware = "Hardware";
    let ongoing = "Ongoing Services";
    let other = "Other";

    vec![
        item("scan-to-bim", data, "Scan to BIM", PerBuilding, OneOff, dec!(4000), margin),
        item("model-from-plans", data, "Build model using existing client plans", PerBuilding, OneOff, dec!(1000), margin),
        item("import-bim", data, "Import existing BIM model", PerBuilding, OneOff, dec!(1000), margin),
        item("bim-health-check", data, "BIM model validation and data health check", PerBuilding, OneOff, dec!(1500), margin),
        item("measured-survey", surveys, "Measured building survey", PerBuilding, OneOff, dec!(1400), margin),
        item("asset-capture", surveys, "Asset data capture", PerProject, OneOff, dec!(1000), margin),
        item("fire-strategy-integration", surveys, "Existing fire strategy integration", PerBuilding, OneOff, dec!(1000), margin),
        item("fire-strategy-new", surveys, "New fire strategy", PerBuilding, OneOff, dec!(5000), margin),
        item("fire-strategy-bim", surveys, "New fire strategy BIM integration", PerBuilding, OneOff, dec!(1000), margin),
        item("drawings-2d", drawings, "2D drawing production / update", PerBuilding, OneOff, dec!(800), margin),
        item("asset-registers", drawings, "Create asset registers and schedules", PerBuilding, OneOff, dec!(600), margin),
        item("door-window-mep", drawings, "Door, window and MEP schedules", PerBuilding, OneOff, dec!(600), margin),
        item("fire-strategy-embed", compliance, "Embed existing fire strategy", PerBuilding, OneOff, dec!(2500), margin),
        item("principal-designer", compliance, "Principal Designer service allowance", PerBuilding, OneOff, dec!(2000), margin),
        item("fire-engineer", compliance, "Fire Engineer service allowance", PerBuilding, OneOff, dec!(2000), margin),
        item("gateway-support", compliance, "Gateway submission / Golden Thread support", PerBuilding, OneOff, dec!(1500), margin),
        item("maintenance-setup", setup, "Planned maintenance setup and alerts", PerBuilding, OneOff, dec!(800), margin),
        item("sensor-integration", setup, "Sensor integration and threshold alerts", PerBuilding, OneOff, dec!(1200), margin),
        item("api-integration", setup, "API integration with existing systems", PerProject, OneOff, dec!(5000), margin),
        item("onboarding", setup, "Standard onboarding / training", PerProject, OneOff, Decimal::ZERO, amount(Decimal::ZERO)),
        item("go-live", setup, "Go-live support", PerProject, OneOff, Decimal::ZERO, amount(Decimal::ZERO)),
        item("spine-unit", hardware, "Spine unit supplied and installed", PerBuilding, OneOff, dec!(2000), amount(dec!(5000))),
        item("support-overhead", setup, "Software support overhead recovery", PerBuilding, OneOff, dec!(1000), margin),
        item("compliance-review", ongoing, "Annual compliance data review", PerBuilding, Annual, dec!(3000), margin),
        item("emergency-integration", ongoing, "Emergency services / door entry integration", PerBuilding, OneOff, dec!(6000), margin),
        item("custom-allowance", other, "Custom / other allowance", PerProject, OneOff, Decimal::ZERO, margin),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project(template: ProjectTemplate) -> Project {
        Project::from_template(
            "p".into(),
            "Test".into(),
            "Client".into(),
            "now".into(),
            template,
            Currency::GBP,
        )
    }

    /// A building-owners project whose bands pick no onboarding: structure costs only.
    fn structure_only() -> Project {
        let mut p = project(ProjectTemplate::BuildingOwners);
        for band in &mut p.bands {
            band.onboarding.clear();
        }
        p
    }

    fn band_of(result: &ProjectResult, buildings: Decimal) -> &BandResult {
        result.bands.iter().find(|b| b.buildings == buildings).unwrap()
    }

    fn line_of<'a>(result: &'a ProjectResult, id: &str) -> &'a OnboardingLine {
        result.onboarding_lines.iter().find(|l| l.id == id).unwrap()
    }

    fn set_band_selection(project: &mut Project, buildings: Decimal, ids: &[&str]) {
        for band in &mut project.bands {
            if band.buildings == buildings {
                band.onboarding = ids.iter().map(|id| id.to_string()).collect();
            }
        }
    }

    #[test]
    fn every_catalogue_element_is_priced_whether_a_band_uses_it_or_not() {
        let result = plan_project(&project(ProjectTemplate::BuildingOwners));
        assert_eq!(result.onboarding_lines.len(), 26);

        // Never selected by default, still priced and ready to be picked.
        let survey = line_of(&result, "measured-survey");
        assert_eq!(survey.unit_cost, dec!(1400));
        assert_eq!(survey.unit_price, dec!(2240));
        assert_eq!(survey.margin, Some(dec!(0.375)));
    }

    #[test]
    fn a_band_only_pays_for_what_it_picks() {
        let mut p = project(ProjectTemplate::BuildingOwners);
        // A client that already has drawings: no scan, no spine, just the model
        // from their plans.
        set_band_selection(&mut p, dec!(5), &["model-from-plans", "support-overhead"]);
        let result = plan_project(&p);

        let lean = band_of(&result, dec!(5));
        assert_eq!(lean.onboarding.cost_per_building, Some(dec!(2000))); // 1,000 + 1,000
        assert_eq!(lean.onboarding.price_per_building, Some(dec!(3200)));

        // The other bands keep the default selection.
        let full = band_of(&result, dec!(20));
        assert_eq!(full.onboarding.cost_per_building, Some(dec!(9500)));
        assert_eq!(full.onboarding.price_per_building, Some(dec!(17000)));
    }

    #[test]
    fn alternatives_are_resolved_inside_each_band() {
        let mut p = project(ProjectTemplate::BuildingOwners);
        set_band_selection(&mut p, dec!(5), &["scan-to-bim", "import-bim", "measured-survey"]);
        let result = plan_project(&p);
        let band = band_of(&result, dec!(5));

        // Only the scan is priced; the other two are reported as blocked.
        assert_eq!(band.onboarding_ids, ["scan-to-bim"]);
        assert_eq!(band.onboarding.cost_per_building, Some(dec!(4000)));

        let blocked: Vec<(&str, BlockedReason)> = band
            .blocked
            .iter()
            .map(|b| (b.id.as_str(), b.reason))
            .collect();
        assert!(blocked.contains(&("import-bim", BlockedReason::Alternative)));
        assert!(blocked.contains(&("measured-survey", BlockedReason::Covered)));
    }

    #[test]
    fn one_band_can_scan_while_another_imports() {
        let mut p = project(ProjectTemplate::BuildingOwners);
        set_band_selection(&mut p, dec!(5), &["scan-to-bim"]);
        set_band_selection(&mut p, dec!(20), &["import-bim"]);
        let result = plan_project(&p);

        assert_eq!(band_of(&result, dec!(5)).onboarding.cost_per_building, Some(dec!(4000)));
        assert_eq!(band_of(&result, dec!(20)).onboarding.cost_per_building, Some(dec!(1000)));
    }

    #[test]
    fn loading_repairs_a_band_that_holds_two_alternatives() {
        let mut p = project(ProjectTemplate::BuildingOwners);
        set_band_selection(&mut p, dec!(5), &["scan-to-bim", "model-from-plans", "measured-survey"]);
        apply_catalogue_rules(&mut p);

        let band = p.bands.iter().find(|b| b.buildings == dec!(5)).unwrap();
        assert_eq!(band.onboarding, ["scan-to-bim"]);
    }

    #[test]
    fn bands_are_priced_at_their_highest_building_count() {
        let result = plan_project(&project(ProjectTemplate::BuildingOwners));
        let buildings: Vec<Decimal> = result.bands.iter().map(|b| b.buildings).collect();
        assert_eq!(buildings, vec![dec!(5), dec!(20), dec!(50), dec!(70), dec!(100), dec!(200)]);
    }

    #[test]
    fn fixed_costs_are_spread_across_the_buildings_of_the_band() {
        let mut p = structure_only();
        p.structure = StructureCosts {
            fixed_monthly: dec!(1000),
            per_building_monthly: dec!(10),
            fee_percent: Decimal::ZERO,
        };
        let result = plan_project(&p);

        let small = band_of(&result, dec!(5));
        assert_eq!(small.fixed_cost_per_building, Some(dec!(2400)));
        assert_eq!(small.subscription.cost_per_building, Some(dec!(2520)));

        let large = band_of(&result, dec!(200));
        assert_eq!(large.fixed_cost_per_building, Some(dec!(60)));
        assert_eq!(large.subscription.cost_per_building, Some(dec!(180)));
    }

    #[test]
    fn the_suggested_subscription_price_leaves_its_margin() {
        let mut p = structure_only();
        p.subscription_margin = dec!(0.35);
        p.structure = StructureCosts {
            fixed_monthly: dec!(1000),
            per_building_monthly: dec!(10),
            fee_percent: dec!(0.029),
        };
        let result = plan_project(&p);
        let band = band_of(&result, dec!(200));

        // 180 a year per building / (1 − 0.029 − 0.35)
        assert_eq!(band.suggested_subscription_price, Some(dec!(289.86)));
        assert!(!band.subscription_price_is_manual);
        assert!((band.subscription.margin.unwrap() - dec!(0.35)).abs() < dec!(0.001));
    }

    #[test]
    fn a_band_price_can_be_typed_or_carry_its_own_margin() {
        let mut p = structure_only();
        p.subscription_margin = dec!(0.35);
        p.structure = StructureCosts {
            fixed_monthly: dec!(1000),
            per_building_monthly: dec!(10),
            fee_percent: Decimal::ZERO,
        };
        for band in &mut p.bands {
            match band.buildings {
                b if b == dec!(200) => band.price = Some(PriceRule::Amount { value: dec!(500) }),
                b if b == dec!(100) => band.price = Some(PriceRule::Margin { percent: dec!(0.5) }),
                _ => {}
            }
        }
        let result = plan_project(&p);

        let typed = band_of(&result, dec!(200));
        assert!(typed.subscription_price_is_manual);
        assert_eq!(typed.subscription.price, dec!(100000)); // 200 × 500
        assert_eq!(typed.subscription.margin, Some(dec!(0.64)));

        // 300 of cost per building at 50%
        let own_margin = band_of(&result, dec!(100));
        assert_eq!(own_margin.subscription.price_per_building, Some(dec!(480)));
        assert!((own_margin.subscription.margin.unwrap() - dec!(0.5)).abs() < dec!(0.001));
    }

    #[test]
    fn each_cost_is_charged_by_its_own_rule() {
        let result = plan_project(&project(ProjectTemplate::BuildingOwners));

        let spine = line_of(&result, "spine-unit");
        assert!(spine.manual_price);
        assert_eq!(spine.unit_price, dec!(5000));
        assert_eq!(spine.margin, Some(dec!(0.6)));

        let scan = line_of(&result, "scan-to-bim");
        assert!(!scan.manual_price);
        assert_eq!(scan.unit_price, dec!(6400)); // 4,000 / (1 − 0.375)
        assert_eq!(scan.margin, Some(dec!(0.375)));
    }

    #[test]
    fn onboarding_is_billed_once_and_apart_from_the_subscription() {
        let result = plan_project(&project(ProjectTemplate::BuildingOwners));
        let band = band_of(&result, dec!(5));

        assert_eq!(band.onboarding.cost_per_building, Some(dec!(9500)));
        assert_eq!(band.onboarding.price_per_building, Some(dec!(17000)));
        assert!(band.subscription.price > Decimal::ZERO);
        assert_eq!(band.years[0].price, band.onboarding.price + band.subscription.price);
    }

    #[test]
    fn year_one_carries_the_onboarding_and_the_years_after_it_dont() {
        let result = plan_project(&project(ProjectTemplate::BuildingOwners));
        let band = band_of(&result, dec!(5));

        assert_eq!(band.years.iter().map(|y| y.year).collect::<Vec<_>>(), [1, 2, 3]);

        // Year 1 = onboarding once + the first subscription.
        assert_eq!(
            band.years[0].price_per_building,
            Some(dec!(17000) + band.subscription.price_per_building.unwrap())
        );
        // Years 2 and 3 are the subscription alone, and identical.
        assert_eq!(band.years[1].price, band.subscription.price);
        assert_eq!(band.years[2].price, band.subscription.price);
        assert_eq!(band.years[1].margin, band.subscription.margin);

        // The three-year total adds them up.
        assert_eq!(
            band.three_year_price,
            band.years.iter().map(|y| y.price).sum::<Decimal>()
        );
        assert_eq!(band.three_year_price, band.onboarding.price + band.subscription.price * dec!(3));
    }

    #[test]
    fn every_year_reports_cost_price_and_profit_per_building() {
        let mut p = project(ProjectTemplate::BuildingOwners);
        set_band_selection(&mut p, dec!(5), &[]);
        for band in &mut p.bands {
            if band.buildings == dec!(5) {
                band.price = Some(PriceRule::Amount { value: dec!(250) });
            }
        }
        let result = plan_project(&p);
        let year = &band_of(&result, dec!(5)).years[1];

        // 9,960 of cost over 5 buildings, 250 of price, 2.9% of fee.
        assert_eq!(year.cost_per_building, Some(dec!(1992)));
        assert_eq!(year.price_per_building, Some(dec!(250)));
        assert_eq!(year.profit_per_building, Some(dec!(-1749.25)));
        // Price minus fee minus cost, per building.
        assert_eq!(
            year.profit_per_building,
            Some(dec!(250) - dec!(250) * dec!(0.029) - dec!(1992))
        );
    }

    #[test]
    fn a_scenario_without_onboarding_repeats_the_same_three_years() {
        let mut p = project(ProjectTemplate::BuildingOwners);
        set_band_selection(&mut p, dec!(5), &[]);
        let result = plan_project(&p);
        let band = band_of(&result, dec!(5));

        let prices: Vec<Decimal> = band.years.iter().map(|y| y.price).collect();
        assert_eq!(prices[0], prices[1]);
        assert_eq!(prices[1], prices[2]);
    }

    #[test]
    fn a_recurring_service_with_a_fixed_price_bills_on_top_of_the_subscription() {
        let mut p = project(ProjectTemplate::BuildingOwners);
        for item in &mut p.onboarding {
            if item.id == "compliance-review" {
                item.price = PriceRule::Amount { value: dec!(4800) }; // 3,000 cost
            }
        }
        set_band_selection(&mut p, dec!(5), &["compliance-review"]);
        let result = plan_project(&p);
        let band = band_of(&result, dec!(5));

        assert_eq!(band.subscription.cost, dec!(9600) + dec!(360) + dec!(15000));
        assert!(band.subscription.price > dec!(24000));
        assert_eq!(band.onboarding.price, Decimal::ZERO);
    }

    #[test]
    fn per_project_costs_do_not_grow_with_buildings() {
        let mut p = project(ProjectTemplate::BuildingOwners);
        set_band_selection(&mut p, dec!(5), &["api-integration"]);
        set_band_selection(&mut p, dec!(200), &["api-integration"]);
        for item in &mut p.onboarding {
            if item.id == "api-integration" {
                item.quantity = dec!(2);
            }
        }
        let result = plan_project(&p);

        assert_eq!(band_of(&result, dec!(5)).onboarding.cost, dec!(10000));
        assert_eq!(band_of(&result, dec!(200)).onboarding.cost, dec!(10000));
        assert_eq!(band_of(&result, dec!(200)).onboarding.cost_per_building, Some(dec!(50)));
    }

    #[test]
    fn the_contractors_template_drops_the_building_side_of_the_catalogue() {
        let p = project(ProjectTemplate::Contractors);
        let categories: Vec<&str> = p.onboarding.iter().map(|i| i.category.as_str()).collect();

        for gone in BUILDING_SIDE_CATEGORIES {
            assert!(!categories.contains(&gone), "{gone} should not be offered to contractors");
        }
        for kept in ["Platform Setup", "Other"] {
            assert!(categories.contains(&kept), "{kept} should be offered to contractors");
        }
        for gone in BUILDING_SIDE_ITEMS {
            assert!(p.onboarding.iter().all(|i| i.id != gone), "{gone} should not be offered to contractors");
        }
        assert_eq!(p.onboarding.len(), 7);
    }

    #[test]
    fn a_saved_contractors_project_loses_the_withdrawn_elements_on_open() {
        let mut p = project(ProjectTemplate::Contractors);
        p.onboarding = project(ProjectTemplate::BuildingOwners).onboarding;
        for plan in &mut p.plans {
            plan.onboarding.push("compliance-review".into());
        }

        apply_catalogue_rules(&mut p);

        assert_eq!(p.onboarding.len(), 7);
        assert!(p.plans.iter().all(|plan| !plan.onboarding.contains(&"compliance-review".to_string())));
    }

    #[test]
    fn switching_template_rebuilds_the_catalogue_and_keeps_edited_costs() {
        let mut p = project(ProjectTemplate::BuildingOwners);
        for item in &mut p.onboarding {
            if item.id == "go-live" {
                item.internal_unit_cost = dec!(777);
            }
        }

        p.set_template(ProjectTemplate::Contractors);

        // The building-side work is gone, the edited cost survived, and the
        // template now has the plans it prices with.
        assert_eq!(p.onboarding.len(), 7);
        assert!(p.onboarding.iter().all(|i| i.id != "scan-to-bim"));
        assert_eq!(
            p.onboarding.iter().find(|i| i.id == "go-live").unwrap().internal_unit_cost,
            dec!(777)
        );
        assert_eq!(p.plans.len(), 3);

        // Going back restores the full catalogue without touching the bands.
        p.set_template(ProjectTemplate::BuildingOwners);
        assert_eq!(p.onboarding.len(), 26);
        assert_eq!(p.bands.len(), 6);
    }

    #[test]
    fn building_owners_keep_the_ongoing_services() {
        let mut p = project(ProjectTemplate::BuildingOwners);
        apply_catalogue_rules(&mut p);
        assert!(p.onboarding.iter().any(|i| i.id == "compliance-review"));
        assert!(p.onboarding.iter().any(|i| i.id == "emergency-integration"));
    }

    #[test]
    fn projects_saved_under_the_old_template_names_still_open() {
        let old: ProjectTemplate = serde_json::from_str("\"modle\"").unwrap();
        assert_eq!(old, ProjectTemplate::BuildingOwners);
        let old: ProjectTemplate = serde_json::from_str("\"technical_only\"").unwrap();
        assert_eq!(old, ProjectTemplate::Contractors);
        assert_eq!(serde_json::to_string(&old).unwrap(), "\"contractors\"");
    }

    #[test]
    fn a_line_priced_below_cost_is_flagged() {
        let mut p = project(ProjectTemplate::BuildingOwners);
        for item in &mut p.onboarding {
            if item.id == "spine-unit" {
                item.price = PriceRule::Amount { value: dec!(1500) };
            }
        }
        let result = plan_project(&p);
        assert!(result.warnings.iter().any(|w| w.contains("below its internal cost")));
    }

    #[test]
    fn an_impossible_margin_suggests_no_price() {
        let mut p = structure_only();
        p.subscription_margin = dec!(0.98);
        p.structure.fee_percent = dec!(0.05);
        let result = plan_project(&p);
        assert!(result.bands.iter().all(|b| b.suggested_subscription_price.is_none()));
        assert!(result.warnings.iter().any(|w| w.contains("100%")));
    }

    #[test]
    fn project_round_trips_through_json() {
        let p = project(ProjectTemplate::BuildingOwners);
        let json = serde_json::to_string(&p).unwrap();
        let back: Project = serde_json::from_str(&json).unwrap();
        assert_eq!(back.onboarding.len(), p.onboarding.len());
        assert_eq!(back.bands.len(), 6);
        assert_eq!(back.bands[0].onboarding.len(), DEFAULT_SELECTION.len());
    }
}
