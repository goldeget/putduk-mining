"""Test-only launcher; no source overwrite, DB reset, or transfer provider."""
from hashlib import sha256
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
ORIGINAL = ROOT / "tests/integration/external-send-concurrency.py"
ORIGINAL_SHA = "ef224c4a352f5e0d20cb16381e3c6c41e96d2a4660807f3577cb3ea7b3058c0d"

def authorized_derivative(original):
    anchor = "          insert into esc_context(method,ordinal,member,destination)"
    history = """          insert into public.withdrawal_destination_history(destination_id,user_id,destination_type,
            action,display_hint,value_fingerprint,metadata,actor_user_id,request_id)
          select id,user_id,destination_type,'REGISTERED',display_hint,value_fingerprint,
            '{{"network":"TRC20","fixture":"EXPLICIT_195_SYNTHETIC_ORIGINAL"}}'::jsonb,user_id,gen_random_uuid()
            from public.withdrawal_destinations where id='{destination}' and destination_type='USDT_ADDRESS';
"""
    calls = [line for line in original.split("\n") if 'return f"public.record_usdt_external_send(' in line]
    if original.count(anchor) != 1 or len(calls) != 1 or original.count(calls[0]) != 1:
        raise RuntimeError("USDT195_CONCURRENCY_EXACT_SOURCE_SPANS_REQUIRED")
    replacement = """    evidence = json.dumps({"version": 1, "basis": "OPERATOR_MANUAL_FULL_PAYOUT", "withdrawalId": withdrawal,
        "requestedKrwAmount": "5000", "actualUsdtAmount": "1.25",
        "network": "TRC20", "feeKrw": "0", "fullPayoutConfirmed": True}, separators=(",", ":"))
    return f"public.record_usdt_external_send('{withdrawal}','TRC20','esc-tx-{run}',{amount},'{evidence}'::jsonb,'{admin}','{sent_at}','{key}')" """
    # The JS adapter's last string has no trailing space.
    replacement = replacement.rstrip(" ")
    return original.replace(anchor, history + anchor).replace(calls[0], replacement)


def main():
    if sys.version_info < (3, 11) or len(sys.argv) != 2 or not re.fullmatch(r"[0-9a-f]{64}", sys.argv[1]):
        raise RuntimeError("USDT195_HOST_PYTHON_AND_DERIVATIVE_PIN_REQUIRED")
    if sha256(ORIGINAL.read_bytes()).hexdigest() != ORIGINAL_SHA:
        raise RuntimeError("USDT195_CONCURRENCY_ORIGINAL_CHANGED")
    source = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
    if len(source) > 8 * 1024 * 1024 or sha256(source).hexdigest() != sys.argv[1]:
        raise RuntimeError("USDT195_CONCURRENCY_DERIVATIVE_CHANGED")
    expected = authorized_derivative(ORIGINAL.read_text(encoding="utf-8"))
    if source.decode("utf-8") != expected:
        raise RuntimeError("USDT195_CONCURRENCY_UNAUTHORIZED_DERIVATIVE")
    # The original guard still checks ROOT, platform, Git, config, container and DB.
    # Filename/context preservation is essential: an external emitted .py has another ROOT.
    namespace = {"__file__": str(ORIGINAL), "__name__": "__main__"}
    exec(compile(source.decode("utf-8"), str(ORIGINAL), "exec"), namespace)

if __name__ == "__main__":
    try:
        main()
    except RuntimeError as error:
        print(str(error))
        raise SystemExit(1)
    except Exception:
        print("USDT195_CONCURRENCY_BOOTSTRAP_FAILED")
        raise SystemExit(1)
