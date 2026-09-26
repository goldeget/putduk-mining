# Development Conventions

## Language
- User-facing copy: Korean-first
- Code/system naming: English

## TypeScript
- variables/functions: camelCase
- components/types/interfaces: PascalCase
- constants: UPPER_SNAKE_CASE

## Database
- tables: plural snake_case
- columns: snake_case
- migrations: timestamp + descriptive snake_case name

## APIs
Versioned:
```text
/api/v1/...
```

## Git
Branches:
```text
main
develop
feature/*
fix/*
hotfix/*
refactor/*
chore/*
```

Commits:
```text
feat:
fix:
refactor:
docs:
test:
chore:
```

## Architecture rules
- server-authoritative mining
- server-authoritative time
- ledger-first asset mutations
- idempotent settlement/funding/reward operations
- rule versioning with effective timestamps
- RLS for exposed user data
- secret/service-role keys never shipped to client
- admin economic/asset changes audited
- AI cannot mutate balances or approvals

## Pull requests
PRs should state:
- domain(s) changed
- schema/migration impact
- ledger impact
- rule-version impact
- admin impact
- analytics impact
- security/RLS impact
- UX impact
- test evidence
