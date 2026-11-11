# WORKROOM administrator, themes and domestic banks

## Authorized scope and visual target

The owner requested a complete administrator UI/UX cleanup matching the current
member cash screens, real menu/function verification and production deployment.
They also requested system/light/dark member themes, desktop/mobile layouts and
all domestic first-tier banks that receive personal account transfers.

The existing WORKROOM cash screen is the visual target: mint actions, clear
surface hierarchy, readable Korean typography, deliberate form spacing and
explicit real-cash versus practice-point labels. No replacement prototype,
fabricated balances or decorative financial charts are introduced.

## Current audit evidence

Fresh screenshots captured on 2026-11-11 are stored in the task evidence folder
`F:/가상대리점/workroom-admin-theme-bank-20261111/screenshots/`:

- `member-deposit-before-pc.jpg`: approved cash-screen design reference.
- `admin-invites-before-pc.jpg`: predecessor P symbol, dense ungrouped navigation
  and wide invitation form.
- `admin-light-before-pc.jpg`: light preference selected while main console
  surfaces remain dark.

The original administrator menu has fourteen entries. `/content` redirects to
WORKROOM because its former event editor and mutations are retired. Remove that
misleading menu entry, preserve its retirement guards, and group the thirteen
actual operating destinations. Preserve existing review, MFA, permission,
idempotency and financial-command behavior.

## Implementation

1. Unify administrator shell, cards, forms, tables, states and responsive menu
   with semantic light/dark tokens. Reuse the existing WORKROOM W asset.
2. Expose the existing system/light/dark preference in member and authentication
   headers. Make WORKROOM, cash, nested forms and charts follow that preference;
   preserve persistence, OS changes and cross-tab synchronization.
3. Share a nineteen-bank catalog across member validation and administrator
   labels. Keep the original nine internal codes and destination fingerprints.
   Use native grouped bank options and reject unregistered input codes.
4. Append an audited version-two KRW bank policy after verification and backup;
   preserve original policy rows, USDT policy, fees, minimums and all ledgers.
   This is a configuration addition, not a schema/ACL change or transfer.

Domestic scope is seven commercial, five regional, three internet and four
specialized deposit banks. EXIM, nonbank cooperatives, post and savings banks
are outside this domestic deposit-bank list. Names/codes are checked against
[iM Bank's official transfer-code list](https://imbank.co.kr/cms/fsv/sdb_2/sdb_22/sdb_222/1187032_1468.html)
and [Bank of Korea's institution classification](https://www.bok.or.kr/portal/main/contents.do?menuNo=200319).

## Verification and release

Use real disposable Auth/database/browser fixtures for commands and permissions.
Check every active administrator destination, mobile menu behavior and both
palettes. Check member system/light/dark selection, actual surface changes,
preference persistence and narrow layouts. Test complete bank options,
unknown-code rejection, unchanged legacy normalization and policy append/replay.

Production verification is read-only: authenticated menu/data reads, theme
selection, bank choices and layout screenshots. Do not fabricate production
accounts, bank destinations, deposits, payouts or manual practice adjustments.
Preserve original work and historical migrations/manifests. Refresh the additive
source manifest, require successful candidate gates, verify the merged tree,
deploy the existing two Workers and record live verification separately.
