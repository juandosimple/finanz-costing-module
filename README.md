# Finanz analyzer

Desktop app (Tauri 2 + React) that answers one question: **what does a building cost us, and what do we charge for it?** A project is built in four steps and the maths is driven by how many buildings a client has — the number of clients never enters it.

## Usage

```bash
pnpm install
pnpm tauri dev                  # run the app in development mode
cargo test -p pricing-engine    # engine tests + regenerates src/bindings/*.ts
pnpm tauri build                # build the installer
```

## The five steps

1. **Project** — name, client and the template chosen when creating it.
2. **Costs** — only costs, never prices:
   - *Structure*: fixed monthly costs (shared across the buildings of each scenario), cost per building per month, payment fee.
   - *Onboarding*: the catalogue for the chosen template of surveys, modelling, compliance, hardware and setup work, each with its internal cost, its basis (per building or per project) and whether it is billed once or every year. Nothing is optional here — every element carries a cost; which ones a deal actually needs is decided in step 4.
3. **Pricing** — what to charge, kept apart from what things cost. One **subscription margin** sets the monthly price per building (covering the structure costs and the payment fee), and a **list of the selected onboarding costs** says what to charge for each: a margin over its cost, or a fixed price. The Spine unit costs 2,000 and sells at 5,000.
4. **Scenarios** — numbered bands (1, 2, 3…): how many buildings each one prices (a project starts with 5, 20, 50, 70, 100 and 200) and **which onboarding it needs**, ticked per band — a client who already has drawings doesn't pay for a scan, and the alternatives rules below are resolved inside each band. The onboarding list folds away per band, with a one-line summary of what is selected. Each band shows both streams as totals for its buildings — the onboarding billed once and the annual subscription, each with its cost, its price and its margin — and a last column, **profit per year**: what a repeating year leaves once its cost and the payment fee are taken off. The table is colour-coded so the three kinds of number never blur together: grey for what it costs us, ink for what the client pays, green or red for what we keep. Each band can follow the project margin, carry its own margin, or be given a fixed price per building.

5. **AI suggestion** — you add what the app can't know (industry, competitors, what the market charges) and Claude reads every cost and price already in the project, then suggests a monthly subscription price per building, a one-off onboarding price, and a monthly price for each band, with its reasoning and the risks. The answer comes back in a fixed shape (structured outputs), is saved with the project and can be applied to the bands in one click. Two providers answer the same question: a **model running locally through Ollama** (the default — no key, no cost) or **Claude** with your own API key. The app's own arithmetic stays authoritative: the model is told what cost-plus already suggests and is asked for judgement on top.

## Report

The **Report** button in the project header opens the whole project as one document: what it costs us, what is charged for each cost, every scenario with its totals and its quote per building per month, and what the model suggested, with the market it was told about. Printing it (*Print / Save as PDF*) is how a quote leaves the app — the app's own screen never prints, the page goes white whatever theme is on screen, and no table row is cut in half by a page break.

## Templates

- **Modle - Building owners** — structure costs plus the whole onboarding catalogue.
- **Modle - Contractors/Consultants** — sold as **plans**, per account, instead of building bands. It keeps the catalogue without the building-side work (no *Data & Modelling*, *Surveys*, *Drawings & Registers*, *Compliance* or *Hardware*, and none of the *Ongoing Services*: the annual compliance data review and the emergency services / door entry integration), so *Platform Setup* and *Other* remain, with onboarding/training, go-live and support overhead ticked by default.
  - *Costs (step 2)*: the platform per account and per active project per month, the platform's own fixed cost per month (a cost of the business — no account carries a share of it), storage per GB per month (with its backup copy), downloads per GB, and how much is downloaded against what is added.
  - *Plans (step 4)*: Basic (20 projects, 250 GB), Platinum (50, 600 GB) and Gold (100, 1,200 GB) to start with. The storage is what the account holds after a year and is typed per account type, so a consultant can carry less than a contractor on the same plan; it fills a twelfth at a time, which is what the storage and download costs are charged on. The screen shows one account type at a time — contractor or consultant — and the table follows that choice. What the platform costs per account and per project is typed in step 2; each plan only shows the total it adds up to. A contractor and a consultant buy the same plans at their own price — project margin, their own margin, or a fixed price per account per month.
  - Evidence is kept, so storage grows every month: each plan shows the cost of month 1 and month 12, and prices **year 1** of one account. AI suggestions don't cover plans yet.

Projects saved under the old template names (`modle`, `technical_only`) open unchanged.

## Rules between onboarding elements

Some elements rule each other out, and the engine enforces it so two can never be priced at once:

- The three ways of getting a model (scan, build from client plans, import existing BIM) are alternatives.
- A scan already covers the measured survey and the asset data capture.

These relations are re-applied whenever a project is opened, so a project saved before a rule existed obeys it too.

## Updating

Settings has an **Updates** card: it asks GitHub for the latest release, installs it over the running app and restarts — no installer is downloaded by hand. Releases are signed with a key that never leaves the machine that made it; the public half sits in `src-tauri/tauri.conf.json` and the private half is a repository secret used by the release workflow (`TAURI_SIGNING_PRIVATE_KEY`). A build without that secret produces installers the updater will refuse.

## Settings

App-wide and saved in the local database: the **currency** every screen uses, the **theme** (System / Light / Dark) and reference **exchange rates**, editable or updated from open.er-api.com. Settings also picks who answers step 5: a local Ollama model (with its address and model name) or Claude. The **Anthropic API key** is the exception to "saved in the database": it goes to the macOS keychain, never to the database or a file.

## Structure

```
crates/pricing-engine/   Calculation engine in Rust (pure logic, rust_decimal, tests)
src-tauri/               Tauri shell: commands, local SQLite
src/bindings/            TS types generated from Rust with ts-rs (don't edit by hand)
src/features/            Screens: projects (list + new), project (the wizard), settings
```

The bundle is named *Finanz analyzer*, but the app identifier stays `com.juando.aianalyzer`, so the database keeps its place and every saved project opens as before.

Data lives in SQLite in the app data folder (`~/Library/Application Support/com.juando.aianalyzer/analyzer.db`).
