"""Append task-scoped HTTPS observations; never infer facts from HTTP success.

Input is a JSON list of [source_id, publisher, URL, purpose]. Existing evidence
is retained. Requests are read-only and use the normal verified egress path.
"""
import concurrent.futures
import importlib.util
import json
import pathlib
import sys

root = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("research_fetch", root / "research-fetch.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

if __name__ == "__main__":
    requests = json.loads(pathlib.Path(sys.argv[1]).read_text())
    report_path = root / "evidence/research-sources.json"
    report = json.loads(report_path.read_text())
    existing = {row["id"] for row in report["sources"]}
    assert all(row[0] not in existing and row[2].startswith("https://") for row in requests)
    assert len({row[0] for row in requests}) == len(requests)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        rows = list(pool.map(module.fetch, requests))
    report["sources"].extend(rows)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    for row in rows:
        print(json.dumps({key: row.get(key) for key in ("id", "http_status", "error", "final_url")}, ensure_ascii=False))
