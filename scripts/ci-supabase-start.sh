#!/usr/bin/env bash
# CI-only startup scheduling. Preserve all Supabase services and health checks.
# The old GITHUB_JOB-only hash delayed all eight authenticated shards by 65s
# together; matrix lanes share that job name, so it did not stagger them.
set -euo pipefail

max_attempts="${CI_SUPABASE_START_ATTEMPTS:-6}"
if ! [[ "$max_attempts" =~ ^[1-6]$ ]]; then
  echo 'Invalid CI_SUPABASE_START_ATTEMPTS (expected 1..6)' >&2
  exit 1
fi

stagger="${CI_SUPABASE_START_STAGGER_SECONDS:-}"
if [ -n "$stagger" ]; then
  if ! [[ "$stagger" =~ ^([0-9]|[12][0-9]|30)$ ]]; then
    echo 'Invalid CI_SUPABASE_START_STAGGER_SECONDS (expected 0..30)' >&2
    exit 1
  fi
elif [ -n "${GITHUB_JOB:-}" ]; then
  # Non-matrix jobs use a short runner-specific delay. Matrix lanes set their
  # own distinct delay explicitly; no global Docker inventory or registry swap.
  stagger=$(printf '%s' "${GITHUB_JOB}:${RUNNER_NAME:-local}" | cksum | awk '{print $1 % 23}')
else
  stagger=0
fi
if [ "$stagger" -gt 0 ]; then
  echo "Staggering supabase start by ${stagger}s..." >&2
  sleep "$stagger"
fi

for attempt in $(seq 1 "$max_attempts"); do
  # Keep pipefail and redact before logs. Never print raw CLI credentials.
  if supabase start --yes 2>&1 | node scripts/redact-supabase-cli-stream.mjs; then
    exit 0
  fi
  if [ "$attempt" -eq "$max_attempts" ]; then
    echo "supabase start failed after ${max_attempts} attempts" >&2
    exit 1
  fi
  sleep_seconds=$((attempt * 12))
  echo "supabase start failed (attempt ${attempt}/${max_attempts}); retry in ${sleep_seconds}s..." >&2
  sleep "$sleep_seconds"
done
exit 1
