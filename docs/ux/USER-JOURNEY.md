# Core User Journey

## First 24 hours
```text
Sign up
→ PUTDUK START automatically created
→ KOREA trial farm automatically created
→ First mining CTA
→ First visible result within minutes
→ User closes app
→ Server-time trial mining continues
→ User returns
→ Automatic trial settlement
→ Usage quota progresses
→ Trial completes at quota 100% or 24h
→ Completion summary
→ Identity/KYC and anti-abuse qualification
→ Up to KRW 5,000 converts exactly once to the real KRW wallet
→ First withdrawal WITHOUT funding
→ Receipt and trust confirmation
→ Optional funding decision
→ Real wallet
→ Real mining
→ Auto settlement
```

## UX priorities
1. User understands the first action immediately.
2. The first mining result appears quickly enough to prove the system is active.
3. Main screens show only essential numbers.
4. Trial and real assets are visibly distinct.
5. KRW is the default mental model.
6. USDT appears only when the user deliberately selects it.
7. Push permission is requested only after product value is understood.
8. Emoji are not used as the production navigation language; PUTDUK SVG assets are.
9. Trial and real wallet balances remain visibly and technically separate.
10. No onboarding tutorial or first welcome withdrawal requires funding.
11. Unauthenticated protected deep links preserve an allowlisted intended path
    through login and return safely after authentication.

## Lifecycle segments

```text
visitor
→ signup
→ trial_started
→ first_mining
→ trial_completed
→ first_welcome_withdrawal
→ withdrawal_completed_no_funding
→ first_funding
→ first_real_mining
→ active_7d
→ active_30d
→ long_term_active
```

`withdrawal_completed_no_funding` may receive preference-aware, capped
re-engagement. Already-earned money is never made conditional on later funding.
