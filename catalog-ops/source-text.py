"""Reproduce visible evidence text from losslessly stored official bytes."""
import gzip
import importlib.util
import json
import pathlib
import re
import sys

sys.dont_write_bytecode = True

root = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("review", root / "research-review.py")
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)
out = {}
for path in (root / "evidence/source-responses").glob("*.txt.gz"):
    parser = review.Text()
    parser.feed(gzip.decompress(path.read_bytes()).decode(errors="replace"))
    out[path.name[:-7]] = re.sub(r"\s+", " ", " ".join(parser.parts)).strip()
print(json.dumps(out, ensure_ascii=False))
