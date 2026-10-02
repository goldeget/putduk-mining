#!/usr/bin/env bash
# CI 8-shard 병렬 supabase start 시 Docker Hub rate limit(toomanyrequests) 완화.
set -euo pipefail

if [ -n "${GITHUB_JOB:-}" ]; then
  stagger=$(printf '%s' "$GITHUB_JOB" | cksum | awk '{print ($1 % 120) + 10}')
  echo "Staggering supabase start by ${stagger}s (job=${GITHUB_JOB})..." >&2
  sleep "$stagger"
fi

max_attempts="${CI_SUPABASE_START_ATTEMPTS:-6}"
for attempt in $(seq 1 "$max_attempts"); do
  if supabase start --yes; then
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
