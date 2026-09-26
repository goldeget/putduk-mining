# Proprietary Technology Protection

Status: **CANONICAL P0 SECURITY CONTRACT**

## Server-only authority

The browser contains presentation and user intent. It never receives the
authoritative implementation of mining/economy/settlement calculations, risk
weights, anti-abuse thresholds, referral fraud rules, KYC decision logic,
promotion internals beyond transparent terms or privileged admin commands.

Domain calculations execute behind authenticated server commands and database
invariants. API responses disclose only what the member needs to understand the
result, including stable public error/receipt codes and request IDs.

## Source and asset protection

- GitHub remains private.
- Public production source maps are disabled.
- Private source maps, when used, have controlled access and retention.
- Secrets, service-role keys, VAPID private keys, database credentials,
  encryption/signing material and AI/Cloudflare keys never enter source control
  or client bundles.
- Lossless generated masters and 3D source files remain private under the
  documented master boundary; production receives optimized derivatives only.

## Request protection

Architecture is WAF-ready and uses authenticated expensive endpoints, rate and
velocity controls, bounded payloads, safe errors, correlation IDs and bot/abuse
signals. Obfuscation is never considered security.

Client IP comes only through a trusted-proxy adapter. Arbitrary
`X-Forwarded-For` supplied by a client is ignored. A provider-specific header is
accepted only when the request reached the configured trusted edge; the direct
origin path has its own authenticated transport boundary.

## Sensitive operations

KRW accounts and USDT addresses use encrypted/redacted storage, verification,
change history, cooldown/protection windows and risk-based step-up/MFA-ready
flows. KYC documents are protected, least-privilege and every access is audited.

## Supply chain and release

Dependencies are pinned with a committed lockfile. Security/RLS tests,
dependency review, private-source-map verification and secret/client-bundle
scans are release gates. Cloudflare security products are not provisioned until
the exact new account and approved runtime architecture are known.
