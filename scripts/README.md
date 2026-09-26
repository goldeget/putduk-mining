# scripts

Operational and development scripts.

Any script that can affect production assets, economic configuration, settlements or user data must:
- default to non-production
- require explicit environment selection
- support dry-run where practical
- emit clear logs
- avoid embedding secrets
