# ACA – Auto Contract Analyzer

An internal AI review assistant for **AtliQ** (Codebasics AI PM capstone, Deliverable #5).

KD, AtliQ's CEO, reviews and signs every client and partner contract himself, late at night and from memory. ACA checks every clause of an incoming contract against:
- KD's positions
- every contract AtliQ has already signed
- past incidents

It returns the **top 3 real risks, each with the exact clause quoted next to the clause it collides with**, in under a minute. Sensitive data is masked before anything leaves AtliQ. **ACA never signs or sends anything. KD decides and signs.**

> Author: Vaibhav Soni (AI PM) · Built on the synthetic AtliQ dataset · PRD: *3_AI_PRD_ACA_V1.0* · Cost model: *4_Cost_Estimation_ACA_V1.0*

---

## What it does

| PRD requirement | In the prototype |
|---|---|
| FR-1 Intake | Upload a contract (.docx, .md, .txt) **or a forwarded email (.eml)**. The attachment is taken from the email and the POC is read from the sender. |
| FR-2 OCR | **Simulated.** The Orbit "scanned" contract in the dataset is already OCR text, including its OCR errors. PDF and image upload are not supported yet. |
| FR-3 Scope | Freelancer and employee contracts are stopped with "Out of scope – HR signs". This is a fixed rule, not AI. |
| FR-4 Privacy gate | IDs, bank details, addresses, emails and phone numbers are masked. AtliQ's own IDs get labelled tokens (e.g. `[ATLIQ_PVT_LTD_GSTIN]`). Patient-data lines are **withheld entirely**. A final leak check blocks the call if anything still looks like an ID. A **"What left AtliQ"** view shows the exact text sent. |
| FR-5 / FR-17 Commitments register | AI extracts non-competes, exclusivity, MFN pricing, IP handed over, no-hire, data-location limits and waivers from every signed contract. Each entry has its verified clause quote. **Only KD can confirm or reject an entry.** |
| FR-6 Conflict check | Every draft is compared with the register, tuned for recall. Uncertain cases are marked "Needs KD check". |
| FR-7 / FR-8 Rules (no AI) | Fixed rules check: entity vs client region, contracting vs invoicing entity, governing law and venue, uncapped liability and LD, liability above 1x contract value, BAA before patient data moves, insurance vs AtliQ's $1M cyber cover, and GDPR DPA. A fixed regulation list by country and sector is always worded "likely applies – confirm with counsel". |
| FR-9 / FR-11 KD's positions | Clauses are compared with KD's checklist, negotiation notes and stated principles. Each flag shows KD's position and whether a past exception was **deliberate** (Al Noor 10% LD cap) or **waved through** (Brightwater). |
| FR-10 Fairness | "Mutual" NDAs are tested clause by clause. AtliQ's own paper is checked for fairness to the vendor, and for whether it passes the client's obligations down (Kriti ↔ Rheinwerk). |
| FR-12 Brief | Top 3, most serious first. Each one shows the draft quote, source quote, why it matters, KD's position, history and "Suggestion – KD decides". The other flags, every check run, the deal paperwork and the regulations are one click away. |
| FR-13 Queue | All contracts ranked by most serious flag, then nearest deadline, with POC, deadline and status. |
| FR-14 – FR-16 | Comments; KD asks named people for feedback; KD records a decision (sign / negotiate / counsel / reject); KD marks a flag useful, dismissed or wrong (a reason is required). |
| FR-15 Signing | Only KD can **record** that he signed the contract himself, outside ACA. There is no e-signature or send code anywhere. |
| FR-18 Audit log | Every upload, analysis, outbound call, flag decision, register change and signing record is logged. In Supabase a database trigger blocks any edit or delete. |

### Stage 1 alpha test result

**40 / 40 test cases pass**: the brief's 7 case types on the dataset, plus 25 synthetic edge cases (hidden conflicts, things that must *not* be flagged, disguised one-sided terms, robustness and safety). The full write-up is in [`tests/TESTING_SUMMARY.md`](tests/TESTING_SUMMARY.md) and the raw run in [`tests/eval_report.md`](tests/eval_report.md).

| Eval (PRD §11) | Result |
|---|---|
| Test cases with the expected result | **40 / 40** |
| Conflict recall (known collisions with signed contracts) | **10 / 10** |
| Groundedness | Every flag shown has a verified quote ("no source, no flag") |
| Privacy: unmasked IDs or patient data in outbound calls | **0** |
| Prompt-injection attempts that changed the result | **0 / 3** |
| Latency | 4–46 s per contract (target < 5 min) |
| Cost | $0.08–0.28 per contract (cost estimate Median: $0.16) |

Clause-risk precision (≥ 80%) is measured from KD's "useful / wrong" clicks in the app.

---|---|
| Brief's test cases + edge cases | **19 / 19 expected results** |
| Conflict recall: Gulf Crown, BlueOrchid and TravelHub vs Al Noor; Datavane vs CloudSpan; Lakeshore vs Crestline MFN; Rheinwerk vs Northwind PipeKit | **6 / 6** |
| Groundedness | Every flag shown has a verified quote. Unverifiable findings are removed and listed ("no source, no flag"). |
| Privacy: unmasked IDs or patient data in outbound calls | **0** |
| Latency | ~20–45 s per contract (target < 5 min) |
| Cost | ~$0.12–0.29 per contract, average ~$0.21 (cost estimate Median: $0.16) |

Clause-risk precision (≥ 80%) is measured from KD's "useful / wrong" clicks in the app.

---

## How a review works

```
upload / forwarded email
   │
   ├─ scope rule ──► freelancer / employee → "Out of scope – HR signs" (no AI call)
   ▼
privacy gate: withhold patient-data lines, mask IDs & bank details, leak check
   ▼
4 Claude calls in parallel (masked text only, structured JSON output)
   ├─ 1. key terms (entity, law, value, liability, LD, data, insurance…)
   ├─ 2. clause review vs KD's checklist, negotiation notes, principles, incidents
   ├─ 3. conflicts vs the commitments register (recall first)
   └─ 4. fairness, mutuality and flow-down (linked deal documents)
   ▼
fixed rules on the key terms (no AI): entity/law/invoicing, 1x proportionality,
uncapped LD/liability, BAA before patient data, insurance, DPA, regulation list
   ▼
citation check: every quote must exist word-for-word in its source, or the flag is removed
   ▼
merge duplicates → rank (critical first; then commitment breach → healthcare/BAA →
uncapped exposure → rest) → top 3 + full list + checks run → queue rank
```

**Architecture.** Everything runs in one free Vercel project:

| Layer | Choice |
|---|---|
| Frontend | React, pre-built into `public/app.js` so Vercel needs no build step |
| Data API | Node.js functions: `api/data.js`, `api/action.js` |
| AI | Python functions with no third-party packages: `api/review.py`, `api/extract.py`, `api/intake.py` |
| Model | Claude API, `claude-sonnet-5-5` |
| Database | Supabase (Postgres) |

The Python and Node code calls Claude and Supabase over plain HTTPS using only the standard library, so there is nothing to install.

```
dataset/         the synthetic AtliQ dataset (loaded on first start)
public/          index.html, styles.css, app.js (built), samples/ (edge-case test contracts)
web/src/         React source (bundled with esbuild by dev/build_web.sh)
api/             Vercel functions: data.js, action.js (Node) · intake.py, review.py, extract.py (Python)
server/          Node data API + storage (Supabase or local JSON)
aca/             Python core: masking, prompts, rules, citations, review pipeline, register, storage
supabase/        schema.sql
tests/           test_core.py (offline guardrail tests), run_evals.py (alpha test gate), eval_report.md
dev/             local dev server, dataset loader, helper scripts
```

---

## Deploy (free tiers)

**1. Supabase (database)**
1. Go to [supabase.com](https://supabase.com) → New project (Free plan).
2. Open **SQL Editor → New query**, paste [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
3. Open **Project Settings → API**. Copy the **Project URL** and the **service_role** key. The service_role key is secret: keep it only in Vercel.

**2. Vercel (hosting)**
1. **Add New → Project →** import this GitHub repo. Framework preset: **Other**. Leave the build settings as they are; `vercel.json` sets them.
2. Add these **Environment Variables**:

   | Name | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your Claude API key |
   | `SUPABASE_URL` | the Supabase Project URL |
   | `SUPABASE_SERVICE_KEY` | the Supabase service_role key |
   | `ACA_PASSCODE` | *(recommended)* any passcode; the app asks for it once per browser, so strangers can't spend your API credit |
   | `ACA_TODAY` | *(optional)* defaults to `2026-09-28`, the dataset's "today" |

3. Click **Deploy**. Stay on the free Hobby plan.

**3. Load the data in the app**
1. Open the app. The synthetic AtliQ dataset in [`dataset/`](dataset/) **loads automatically** the first time the queue opens. (**Setup and costs → Load the included dataset** reloads it; **Choose a Dataset folder** loads your own copy.)
2. Go to **Commitments register →** extract from the 17 signed contracts (about 1 minute, about $0.70). As KD, confirm the entries.
3. Go to **Contract queue → Analyse all**.
4. Optional: **Setup → Add the edge-case contracts.**

> The dataset is the course's **fully synthetic** AtliQ data (no real clients or contracts). It is included in [`dataset/`](dataset/) so the deployed app loads it on first start (decided 10 Oct).

## Run locally

Needs Node 20+ and Python 3.12+.

```bash
export ANTHROPIC_API_KEY=...            # without Supabase variables, data is kept in ./.localdb (JSON)
python3 dev/load_dataset.py dataset
node dev/server.mjs 3000                # http://localhost:3000
python3 -m unittest discover -s tests   # offline guardrail tests
python3 tests/run_evals.py              # alpha test gate (uses the API, ~$3)
sh dev/build_web.sh                     # rebuild public/app.js after editing web/src (needs esbuild + react)
```

---

## Dataset additions (synthetic edge cases written for ACA)

25 fictional contracts in [`public/samples/`](public/samples/) (generator: [`tests/make_edge_cases.py`](tests/make_edge_cases.py)). They are not part of the original dataset; the brief allows extending it. **Setup → Add the edge-case contracts** loads them into the app.

| Group | Cases |
|---|---|
| Earlier edge cases | Instruction to the AI planted in a contract · patient data pasted into a SOW · forwarded email (.eml) for a Dubai resort deal · $500k liability on a $24k deal |
| A. Hidden conflicts | GCC hotels only in an annex · hotel group behind a real-estate affiliate · Crestline MFN undercut via free hours + rebate · Seaside renewal outside the Al Noor waiver |
| B. Must not be flagged | Orbit non-compete expired · competing platform limited to Europe · US healthcare with de-identified data · long MSA on KD's terms |
| C. Disguised one-sided terms | LD renamed "service credits" · carve-outs that empty the liability cap · client's changeable online terms prevail · "mutual" NDA with one-way residuals · US client on the India entity · UK personal data with no DPA |
| D. Robustness and safety | Invoice uploaded by mistake · empty file · OCR-garbled scan · hidden HTML/footnote instructions · SSN and bank numbers · duplicate upload · Arabic version prevails |

Expected and actual results for every case are in [`tests/TESTING_SUMMARY.md`](tests/TESTING_SUMMARY.md).

## Prototype limits and assumptions

- **Login is simplified.** You pick who you are (KD, Bhavin, Dhaval, Jay or Pranav), and an optional shared passcode protects the deployment. Role rules are enforced on the server: only KD can decide, mark Signed, act on flags or confirm the register. A real rollout would use proper sign-in.
- **Email intake is simulated** by uploading the forwarded `.eml`. A real intake address is a PRD open question.
- **OCR is simulated**, and **PDF upload is not supported yet**.
- **"Today" is 28 Sep 2026** (the dataset date), so deadlines read as they did for AtliQ.
- **Cost vs estimate.** Real cost averages about $0.21 per contract against the estimate's $0.16. The extra comes from the model's reasoning tokens and the size of the register sent on every conflict check.
- **Model.** Every call uses Claude Sonnet 5.5, matching the cost estimate's business-case model. The key-terms call uses low reasoning effort; the other calls use medium.
