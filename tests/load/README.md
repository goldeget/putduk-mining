# Load reference tests

The committed k6 test is a safe public-read baseline, not production capacity proof. Run it only against an explicitly authorized local or preview environment:

```powershell
$env:BASE_URL = "http://127.0.0.1:3000"
pnpm test:load
```

Do not point this script at production without an approved window, owner, abort thresholds and monitoring. Authenticated money-path tests require isolated synthetic users and balances; never reuse a real member token.

Before launch, add isolated scenarios for concurrent trial settlement, duplicate welcome conversion, outbox backlog recovery, job lease expiry, promotion budget contention, referral qualification batches, notification fanout and admin queue reads. Each scenario must reconcile row counts and money effects after load, not merely report HTTP latency.
