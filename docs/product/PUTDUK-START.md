# PUTDUK START — 24-Hour Trial

## Goal
Every eligible new member should understand PUTDUK's core loop within the first day:
```text
Start mining → see the first result → close the app → return → see accumulated trial result → finish quota → continue with a real mining account
```

## Hard rules
- Trial duration: max 24 hours
- Trial quota: 100%
- Completion: quota reaches 100% OR 24 hours expires
- Trial ledger and real wallet ledger are separate
- Server time is authoritative
- Trial continues while the app/browser/device is closed
- Operator-configurable target experience: KRW 3,000–10,000 equivalent
- First trial world: KOREA

## User experience
### First minutes
1. Signup completes.
2. PUTDUK START is created automatically.
3. A KOREA trial farm is generated.
4. One primary CTA: "첫 채굴 시작".
5. Within a few minutes the user sees the first non-zero mining result.

### Main trial screen
Show only what matters:
- current mining state
- trial earnings
- usage %
- remaining time
- mining visual

Do not expose complex world economics during the first experience.

### Quota
The primary mental model is usage, not a seven-day calendar:
```text
무료 체험 사용량
████████░░ 82%
```

### Reward curve
The curve is configuration, not hardcoded UI logic.

Suggested phases:
- 0–30m: prove that mining moves
- 30m–3h: visible initial growth
- 3–12h: meaningful accumulation
- 12–24h: approach configured trial target

Tables:
```text
trial_programs
trial_accounts
trial_sessions
trial_ledger
trial_reward_curves
trial_completions
```

### Completion
Completion screen:
- total trial result
- mining time
- status
- usage 100%
- one primary CTA: "내 채굴 시작하기"

The next step leads naturally into funding; it must not visually resemble an aggressive pop-up ad.

## Admin configuration
Operator controls:
- enabled
- duration
- target reward
- first-result timing
- quota speed
- auto-mining enabled
- first world
- completion copy
- completion CTA
- reward curve version

All changes are versioned and only apply from their effective time.
