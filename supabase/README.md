# supabase

Database workspace for PUTDUK MINING.

Structure target:
```text
supabase/
├── migrations/
├── seed/
├── functions/
└── tests/
```

Rules:
- enable appropriate RLS on exposed user-data tables
- never expose service-role or secret keys to clients
- migrations are the source of truth for schema changes
- economic/ledger migrations require rollback and verification thinking
- UPDATE policies must correctly constrain both existing and new row state
