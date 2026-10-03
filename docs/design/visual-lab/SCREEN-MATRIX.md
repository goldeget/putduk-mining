# Canonical Screen Matrix

Benchmark: `visual-lab-2026.09.27-v1`

Common obligations for all screens: System/Light/Dark, keyboard and visible focus, Korean readability, 200% zoom, reduced motion, deterministic data truth, mobile/tablet/desktop, and meaningful loading/error states. Values shown below describe hierarchy, never seeded economic truth.

| Experience | Production route | Purpose and composition | Responsive behavior | Required states and accessibility |
| --- | --- | --- | --- | --- |
| Landing | `/` | Full-bleed Earth/mining hero; concise product definition; PUTDUK START promise; five worlds; trust/verification; signup/login actions. Brand asset leads, copy remains real text. | Desktop uses asymmetric hero and world rail; tablet compresses evidence; mobile keeps one primary CTA and crops imagery intentionally. | loading for critical imagery, success-free default, offline-safe public copy; semantic headings and decorative image alt discipline. |
| Login | `/login` | Dedicated secure-entry composition, brand/trust panel, login ID/email and password, recovery paths, safe return target. | Split composition becomes a single focused panel; keyboard never crosses decorative regions. | validation, generic auth failure, pending, provider unavailable, success redirect; password managers, paste and show/hide supported. |
| Signup | `/signup` | Progressive account creation for name, DOB, phone, login ID, recovery email, password confirmation and versioned consent. | Desktop groups related fields without dense walls; mobile preserves natural input order and sticky final action only when safe. | availability checking, per-field validation, password mismatch, required/optional consent, pending, confirmation email and recovery. |
| PUTDUK START active | `/start` | Guided KOREA trial with persistent mining presence, server state, first-result guidance, quota/time progress and trial/real separation. | Desktop pairs world stage and next action; tablet balances both; mobile keeps status and next action before supporting detail. | ready, starting, active, settlement pending, stale, offline/reconnect, error and reduced motion; progress has text equivalent. |
| PUTDUK START complete | `/start` | Premium completion summary, trial evidence, qualification path, welcome conversion state and eligible first-withdrawal path without funding. | Summary and next step remain above exploration content at every width. | qualifying, review, converted, ineligible with reason/recovery, withdrawal pending/completed; never visually relabel trial value as real KRW. |
| Home | `/home` | Authenticated daily overview: living mining presence, authoritative status, real wallet summary, tasks, events and return context. | Desktop information bands; tablet two columns; mobile single priority stream with mining status always discoverable. | loading, new-account empty, partial-data warning, offline last-known label and reconnect. |
| Mining World | `/mining` | Five-world selector, active equipment/session status, energy/resource flow and settlement evidence. | Desktop uses world rail plus stage; mobile uses accessible horizontal selector and bounded scene. | no session, active, reduced/maintenance/stopped, settlement reveal, error, offline return and performance tier fallback. |
| Wallet | `/wallet` | KRW-first available/held totals, reward provenance, ledger history, deposit/withdrawal actions and receipts; USDT secondary. | Desktop separates summary and history; mobile keeps available KRW and holds before transaction list. | empty, loading, partial read, pending/confirmed/failed transaction, receipt success, offline read-only. |
| Deposit | `/wallet/deposit` | Manual KRW bank-transfer request, approved instructions, amount/promotion explanation and verification timeline. No PG implication. | Desktop form and timeline; mobile ordered step flow with retained input. | validation, request pending, awaiting transfer, review, confirmed, rejected/recovery and special configured promotion. |
| Withdrawal | `/wallet/withdraw` | Available balance, destination, policy/fee, hold and status timeline; welcome first withdrawal explicitly supports no-funding eligibility. | Desktop form and control summary; mobile shows amount/result before secondary policy details. | no policy, encryption unavailable, validation, step-up if required, pending, processing, completed, rejected/released and recovery. |
| Events | `/events` and `/events/[slug]` | Published event cards, detail, factual progress, completion/payout and notices; no fake urgency. | Desktop editorial grid; tablet two columns; mobile chronological list with clear eligibility. | empty, scheduled, active, completed, payout pending/paid, expired and error. |
| Notifications | `/notifications` and `/settings/notifications` | Notification center with category, read state, deep link and preferences; publication fanout is automatic from outbox policy. | Desktop center plus preference rail; mobile list first, settings secondary. | empty, loading, unread/read, delivery warning, offline and reconnect; swipe is never the only action. |
| PUTDUK AI | `/ai` | PUTDUK-identity conversation, suggested questions, genuine streaming, citations/context labels and bounded failure recovery. | Desktop conversation with contextual side rail; mobile one-column composer with safe-area handling. | empty, tool lookup, streaming, cancellation, provider unavailable, ambiguous follow-up, refusal and offline; status announced without fake typing timers. |
| 오늘의 퍼뜩 | admin `/` | Operator attention queue, automated success, failures/reasons, system health, operations assistant, security/audit and emergency status. Every operator control avoids SQL/RPC jargon and internal keys; no separate advanced mode. | Desktop control-plane rail and prioritized grid; tablet keeps attention first; mobile becomes an intentional queue, not a squeezed table. | loading, no-action success, partial subsystem failure, unauthorized, MFA/step-up required and offline-denied. |
| Member 360 | admin `/members?id={memberUuid}` | Identity/account, KYC, START, wallet/ledger, funding, mining, referrals/events, notifications, devices/sessions, risk, AI activity, notes and audit timeline. | Desktop summary plus evidence sections; tablet staged sections; mobile uses anchored sections and redacts sensitive fields. | not found, permission denied, sensitive-data step-up, partial query failure, empty domain history and audited note success. |

## Canonical state vocabulary

- Loading: content-shaped skeletons, no fabricated numeric values.
- Empty: explains why the state is empty and names a valid next action.
- Error: preserves entered data, shows recovery and a non-sensitive reference ID where available.
- Success: confirms the authoritative result and links to its receipt/evidence.
- Offline: last-known information is labelled; financial/account mutations remain disabled until reconnection.
- Unauthorized: reveals no privileged entity existence beyond what the caller may know.

## Per-screen visual anatomy

### Landing

- Typography: compact uppercase eyebrow → cinematic display headline → readable Korean lead → tabular trust facts.
- Components: brand header, hero copy, Earth/miner scene, primary/secondary CTA, START proof strip, five-world rail and verification footer.
- Spacing: desktop hero uses generous asymmetric negative space; copy groups at 8/16/24/40 token intervals; mobile keeps at least 24 px between narrative blocks.
- Interaction/motion: CTA and trust links have restrained lift/press; Earth glow and orbital accents may drift slowly; reduced motion renders a static composed hero.

### Login

- Typography: security eyebrow → direct Korean title → one-sentence reassurance → clear field labels and recovery actions.
- Components: brand/trust panel, credential form, show/hide control, find-ID/password recovery links and safe-return notice.
- Spacing: the form is a single decision column with 16 px field rhythm and 24–32 px group separation.
- Interaction/motion: validation appears beside its field without layout shock; pending locks duplicate submit; success uses an immediate authoritative transition.

### Signup

- Typography: short progress label → stage heading → plain-language field help → consent hierarchy.
- Components: identity/contact/account sections, availability state, password criteria, all/required/optional consent and confirmation summary.
- Spacing: related field pairs may share a desktop row; mobile always follows legal/natural input order with 20–24 px section separation.
- Interaction/motion: debounced availability is announced; password visibility never clears input; section progression is a short opacity/position transition and collapses under reduced motion.

### PUTDUK START active

- Typography: world/status eyebrow → mining state heading → authoritative result/value → explanatory next action.
- Components: world stage, mascot guidance, quota/time meters, first-result receipt, Guided Quest and trial/real boundary.
- Spacing: the stage owns roughly two-thirds of wide layouts; status and next action remain within one visual scan.
- Interaction/motion: coach marks anchor to real controls; machinery/energy motion reflects server state; number interpolation stops exactly on returned values.

### PUTDUK START complete

- Typography: completion status → real/trial-separated amounts → qualification explanation → one primary next action.
- Components: completion crest, trial receipt, qualification/conversion timeline, welcome wallet result and eligible first-withdrawal CTA.
- Spacing: evidence precedes exploration; no promotional content interrupts the conversion/withdrawal sequence.
- Interaction/motion: reveal follows confirmed settlement/conversion only; celebratory accents are brief, optional and removed under reduced motion.

### Home

- Typography: time-aware greeting → mining state → KRW summary → task/event headings.
- Components: persistent mining presence, wallet summary, next task, recent receipt, event/notice and return/offline status.
- Spacing: desktop bands form a deliberate overview rather than equal cards; mobile priority order is mining → money → action → discovery.
- Interaction/motion: world ambience is low amplitude; task completion and reconnect refresh use factual status transitions.

### Mining World

- Typography: selected world label → server state → pending/settled values → equipment/supporting detail.
- Components: accessible world selector, scene, machine/resource flow, state controls, settlement receipt and status explanation.
- Spacing: selector and scene remain spatially connected; technical details live below the primary world outcome.
- Interaction/motion: selector change preserves status continuity; LOD/performance tier changes are invisible to truth; stopped/maintenance states visibly stop ambience.

### Wallet

- Typography: available KRW as primary amount → held/reserved → provenance categories → transaction rows/receipts.
- Components: balance summary, reward breakdown, deposit/withdraw actions, filters and immutable transaction history.
- Spacing: money groups use tabular alignment and stronger separation than ordinary content; mobile keeps actions adjacent to available amount.
- Interaction/motion: expanding a receipt preserves scroll position; status updates cross-fade without animating invented amount deltas.

### Deposit

- Typography: amount and method first → bank-transfer instruction → verification timeline → promotion terms.
- Components: KRW amount form, approved bank instruction, copy affordance, request receipt, timeline and configured promotion panel.
- Spacing: input/summary and process evidence are separate regions; mobile keeps transfer instruction readable without horizontal squeeze.
- Interaction/motion: success appears only after request creation; copying gives non-color feedback; pending/confirmed transitions use server refresh.

### Withdrawal

- Typography: available/eligible amount → destination and fee → confirmation → processing receipt.
- Components: currency/policy, amount, destination, welcome-withdrawal eligibility, security/step-up, status timeline and receipt.
- Spacing: policy details remain subordinate but reachable; destructive/financial confirmation is visually isolated.
- Interaction/motion: amount preview is local-only and labelled; submit requires authoritative validation; processing progress is discrete status, not a fake percentage.

### Events

- Typography: event status/date → title → factual progress → reward/payout state.
- Components: editorial list, detail hero, mission/progress, terms, payout receipt, notice stream and expiry state.
- Spacing: featured content differs from standard list without random card treatment; legal/eligibility text remains readable.
- Interaction/motion: progress changes after domain events; completion reveal is bounded; no countdown urgency unless a real server deadline exists.

### Notifications

- Typography: unread category/time → concise message → destination; preferences use labelled grouped controls.
- Components: filter, read/unread list, deep-link item, delivery warning and preferences.
- Spacing: list density remains scannable with at least 12–16 px item separation and a clear unread marker not based on color alone.
- Interaction/motion: read state changes immediately only after accepted command; swipe is optional; reconnect refresh is announced.

### PUTDUK AI

- Typography: assistant identity/status → conversation text → grounded fact/source metadata → composer/help text.
- Components: conversation list, suggestion chips, messages, tool/knowledge status, source/as-of labels, composer, stop/retry and privacy boundary.
- Spacing: message measure is capped for Korean reading; account fact cards remain visually distinct from conversational prose.
- Interaction/motion: genuine stream deltas only; tool progress uses real events; cancellation is immediate; no fake typing animation or exposed chain of thought.

### 오늘의 퍼뜩

- Typography: attention count/severity → plain-language task → cause and recommended action → technical detail only in Expert Mode.
- Components: attention queue, automation summary, failures, KYC/funding/settlement exceptions, health, Operations AI, audit and emergency state.
- Spacing: urgent owned work precedes healthy automation; desktop grid is asymmetric and mobile becomes a prioritized queue.
- Interaction/motion: queue resolution requires readback and reason where applicable; live status changes are subtle and never celebratory for money/security work.

### Member 360

- Typography: identity/account state → risk/KYC/financial status → section headings → immutable timeline metadata.
- Components: summary, KYC gate, START/conversion, wallet/ledger, deposits/withdrawals, mining, referral/events, notifications, devices/sessions, AI activity, notes and audit.
- Spacing: sensitive sections have explicit boundaries and permission labels; timeline and receipts use consistent alignment.
- Interaction/motion: section anchors preserve context; sensitive reveal and high-impact actions require permission/step-up; no impersonation control exists.
