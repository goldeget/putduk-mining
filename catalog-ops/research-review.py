"""Evidence-bound continuation of the frozen catalog draft, not a market feed.

Conclusions below are limited to the actual downloaded official responses.
Missing share class/listing detail remains partial, even with a valid SEC row.
Do not rerun the historical build-catalog.py over this reviewed package.
"""
import collections
import gzip
import hashlib
import html
import json
import pathlib
import re
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parent


def read(name):
    return json.loads((ROOT / name).read_text())


def write(name, data):
    (ROOT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


class Text(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts, self.hidden = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.hidden:
            self.hidden -= 1

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def body(key):
    path = ROOT / "evidence/source-responses" / (key + ".txt")
    return path.read_bytes() if path.exists() else gzip.decompress(path.with_suffix(".txt.gz").read_bytes())


def plain(key):
    parser = Text()
    parser.feed(body(key).decode(errors="replace"))
    return re.sub(r"\s+", " ", " ".join(parser.parts)).strip()


def quote(key, needle, raw=False):
    text = html.unescape(body(key).decode(errors="replace")) if raw else plain(key)
    index = text.find(needle)
    assert index >= 0, (key, needle)
    return text[max(0, index - 35):index + len(needle) + 95]


if __name__ == "__main__":
    data, research = read("product-candidates.json"), read("evidence/research-sources.json")
    sources = {s["id"]: s for s in research["sources"]}
    # Never use the successful QQQ page to verify a different issuer's TQQQ.
    sources["tqqq"]["purpose"] = "WRONG_SPONSOR_FOR_TQQQ_NOT_IDENTITY_EVIDENCE"
    sec = json.loads(body("sec"))
    sec_rows = {row[2]: row for row in sec["data"]}
    sources["sec"].update(verified=True, observation="RESPONSE_REVIEWED",
                          verified_facts=["Current directory fields: cik, name, ticker, exchange; not share-class or trade execution proof."],
                          freshness_confidence="CURRENT_RESPONSE_DIRECTORY_ONLY")
    specs = {
        "samsung-electronics": ("samsung-listing", "Samsung Electronics", "005930", "KRX", "COMMON", "KRX 005930", False),
        "sk-hynix": ("hynix", "SK hynix", None, None, None, "SK hynix", False),
        "lg-electronics": ("lg-stock", "LG Electronics", "066570", None, "COMMON_CLASS_LINK_PENDING", "custId=066570", True),
        "hyundai-motor": ("hyundai-stock", "Hyundai Motor", None, None, "COMMON_CLASS_LINK_PENDING", "Common Share", False),
        "lg-energy-solution": ("lgensol", "LG Energy Solution", None, None, None, "LG Energy Solution", False),
        "naver": ("naver-stock", "NAVER Corp.", "035420", "KRX/KOSPI", None, "네이버 035420", False),
        "kakao": ("kakao-stock", "카카오", "035720", "KRX/KOSPI", None, "kospi code", True),
        "samsung-biologics": ("samsungbio-stock", "Samsung Biologics", "207940", "KS (issuer designation)", "COMMON", "Ticker Common KS 207940", False),
        "kb-financial": ("kb-eng", "KB Financial Group", None, None, None, "KB Financial Group", False),
        "hanwha-aerospace": ("hanwha-stock", "한화에어로스페이스", None, None, "COMMON_CLASS_LINK_PENDING", "보통주", False),
        "sk-innovation": ("skinnov-stock", "SK Innovation Co., Ltd.", "096770", None, "COMMON_CLASS_LINK_PENDING", "code=096770", True),
        "spy": ("ssga", "State Street SPDR S&P 500 ETF Trust", "SPY", "NYSE Arca", "ETF_TRUST_SHARES", "NYSE ARCA Jan 22 1993 USD SPY", False),
        "qqq": ("invesco", "Invesco QQQ ETF", "QQQ", None, "ETF_SHARES", "Invesco QQQ ETF", False),
        "soxx": ("ishares", "iShares Semiconductor ETF", "SOXX", "Nasdaq", "ETF_SHARES", "iShares Semiconductor ETF (NASDAQ: SOXX)", False),
        "schd": ("schwab", "Schwab U.S. Dividend Equity ETF", "SCHD", "NYSE Arca, Inc.", "ETF_SHARES", "Exchange NYSE Arca, Inc.", False),
        "vti": ("vanguard", "Vanguard Morningstar Total Stock Market ETF", "VTI", "NYSE Arca", "ETF_SHARES", "ETF Shares are listed for trading on NYSE Arca", True),
        "aiq": ("globalx", "Global X Artificial Intelligence & Technology ETF", "AIQ", "Nasdaq", "ETF_SHARES", "Primary Exchange Nasdaq", False),
        "bnd": ("bnd", "Vanguard Total Bond Market ETF", "BND", "Nasdaq", "ETF_SHARES", "ETF Shares are listed for trading on Nasdaq", True),
        "iau": ("iau", "iShares Gold Trust", "IAU", "NYSE Arca", "GOLD_TRUST_SHARES", '"name":"Exchange","value":"NYSE Arca"', True),
        "kr-ai-etf-research": ("kodex", "KODEX AI반도체핵심장비 ETF", "471990", None, "ETF_SHARES", "KODEX AI반도체핵심장비 ETF (종목코드 : 471990)", False),
        "kodex-200": ("kodex-main200", "KODEX 200", "069500", None, "ETF_SHARES", '"identifier": "069500"', True),
        "bitcoin": ("bitcoin", "Bitcoin", "BTC", "NOT_APPLICABLE_PROTOCOL", "NATIVE_ASSET", "BTC", False),
        "ethereum": ("eth-native", "Ether", "ETH", "NOT_APPLICABLE_PROTOCOL", "NATIVE_ASSET", "Ether (ETH) is the native cryptocurrency", False),
        "solana": ("sol-token", "Solana / SOL", "SOL", "NOT_APPLICABLE_PROTOCOL", "NATIVE_ASSET", "fee paid in SOL", False),
        "bnb": ("bnb", "BNB / BNB Chain", "BNB", "NOT_APPLICABLE_PROTOCOL", "NATIVE_ASSET_DETAIL_PENDING", "BNB Chain", False),
        "xrp": ("xrp", "XRP / XRP Ledger", "XRP", "NOT_APPLICABLE_PROTOCOL", "NATIVE_ASSET_DETAIL_PENDING", "Direct XRP Payments", False),
        "usdc-rail": ("usdc-coinbase", "USD Coin (USDC)", "USDC", "NOT_APPLICABLE_PROTOCOL", "STABLECOIN_ISSUER_CHECK_PENDING", "USD Coin (USDC) is a stablecoin", False),
        "gold": ("lbma", "Gold", "XAU", "NOT_APPLICABLE_BULLION", "BULLION_THEME_NO_SECURITY_SHARE_CLASS", "Good Delivery Lists for both gold and silver", False),
        "silver": ("lbma", "Silver", "XAG", "NOT_APPLICABLE_BULLION", "BULLION_THEME_NO_SECURITY_SHARE_CLASS", "Good Delivery Lists for both gold and silver", False),
    }
    verified = {"samsung-electronics", "spy", "soxx", "schd", "vti", "aiq", "bnd", "iau", "bitcoin", "ethereum", "solana", "gold", "silver"}
    evidence = []
    for p in data["candidates"]:
        slug = p["slug"]
        facts, missing = [], []
        p.update(identity_status="PUBLIC_MARKET_UNKNOWN", canonical_name=None, canonical_name_ko=None,
                 canonical_name_en=None, canonical_ticker=None, canonical_exchange=None,
                 canonical_share_class=None, current_existence="UNKNOWN", identity_confidence="UNKNOWN")
        if p["asset_class"] == "US_STOCK" and p["ticker_hint"] in sec_rows:
            row = sec_rows[p["ticker_hint"]]
            facts = [dict(source_id="sec", quote=json.dumps(row, ensure_ascii=False), locator=f"data[ticker={row[2]}]", scope="NAME_TICKER_EXCHANGE_IN_CURRENT_SEC_DIRECTORY", cik=row[0])]
            p.update(identity_status="PUBLIC_MARKET_PARTIAL", canonical_name=row[1], canonical_name_en=row[1],
                     canonical_ticker=row[2], canonical_exchange=row[3], current_existence="PRESENT_IN_CURRENT_SEC_DIRECTORY", identity_confidence="HIGH_DIRECTORY_IDENTITY_PARTIAL_SHARE_CLASS")
            missing = ["CURRENT_SHARE_CLASS_PRIMARY_FILING_REQUIRED", "LISTING_DIRECTORY_IS_NOT_TRADE_OR_LICENSE_PROOF"]
            if "sec" not in p["source_ids"]:
                p["source_ids"].append("sec")
        elif slug in specs:
            key, name, ticker, exchange, share, needle, raw = specs[slug]
            snippet = quote(key, needle, raw)
            p.update(identity_status="PUBLIC_MARKET_VERIFIED" if slug in verified else "PUBLIC_MARKET_PARTIAL",
                     canonical_name=name, canonical_name_ko=p["name_hint_ko"], canonical_name_en=name,
                     canonical_ticker=ticker, canonical_exchange=exchange, canonical_share_class=share,
                     current_existence="CURRENT_PRIMARY_PAGE_IDENTIFIES_ASSET" if key != "usdc-coinbase" else "CURRENT_SECONDARY_PAGE_IDENTIFIES_ASSET",
                     identity_confidence="HIGH_SCOPE_LIMITED" if slug in verified else "PARTIAL_DETAILS_REQUIRED")
            facts = [dict(source_id=key, quote=snippet, locator="NORMALIZED_VISIBLE_TEXT" if not raw else "RAW_ISSUER_DOCUMENT", scope="IDENTITY_ONLY_NO_PRICE_OR_RETURN_INPUTS")]
            if key not in p["source_ids"]:
                p["source_ids"].append(key)
            if slug not in verified:
                missing = [field + "_REQUIRED" for field, value in (("TICKER", ticker), ("EXCHANGE", exchange), ("SHARE_CLASS", share)) if value is None or "PENDING" in value]
                if slug == "usdc-rail": missing.append("ISSUER_PRIMARY_SOURCE_REQUIRED")
                if not missing: missing.append("KS_VENUE_MEANING_PRIMARY_CONFIRMATION_REQUIRED")
            if slug in ("gold", "silver"):
                p["identifier_scope"] = "XAU_XAG_EXISTING_INTERNAL_CATALOG_CODES_NOT_LBMA_EXCHANGE_TICKERS"
            if slug == "kr-ai-etf-research":
                p["name_hint_ko"] = name
                p["ticker_hint"] = ticker
                p["resolved_generic_slot"] = True
            if slug == "vti":
                p["name_hint_ko"] = "Vanguard Morningstar Total Stock Market ETF"
                p["name_change_observation"] = "Current sponsor title differs from historical investigation hint; no performance implication."
        else:
            missing = ["SPECIFIC_CURRENT_OFFICIAL_IDENTITY_REQUIRED"]
        for fact in facts:
            source = sources[fact["source_id"]]
            assert source.get("http_status") == 200
            source.update(verified=True, observation="RESPONSE_REVIEWED", freshness_confidence="CURRENT_RESPONSE_SCOPE_LIMITED")
            if fact["quote"] not in source["verified_facts"]:
                source["verified_facts"].append(fact["quote"])
        p["verified_facts"] = facts
        p["unresolved_identity_fields"] = missing
        p["source_status"] = "RESPONSE_REVIEWED_SCOPE_LIMITED" if facts else "NO_PRODUCT_SPECIFIC_FACTS_VERIFIED"
        p["blocking_requirements"] = [g for g in p["blocking_requirements"] if g not in ("PUBLIC_IDENTITY_VERIFICATION_REQUIRED", "CURRENT_SPACEX_SPCX_LISTING_REQUIRED")]
        if p["identity_status"] != "PUBLIC_MARKET_VERIFIED":
            p["blocking_requirements"].append("PUBLIC_IDENTITY_DETAILS_REQUIRED")
        evidence.append(dict(proposal_id=p["proposal_id"], slug=slug, verification_status=p["identity_status"],
                             verified_name=p["canonical_name"], verified_name_ko=p["canonical_name_ko"], verified_name_en=p["canonical_name_en"],
                             verified_code=p["canonical_ticker"], verified_exchange=p["canonical_exchange"],
                             verified_asset_class=p["asset_class"] if facts else None, share_class=p["canonical_share_class"],
                             current_existence=p["current_existence"], confidence=p["identity_confidence"],
                             facts=facts, missing=missing, editorial_ko_label_status="TRANSLATION_NOT_REGISTERED_LEGAL_NAME",
                             sources=[dict(id=k, url=sources[k]["requested_url"], final_url=sources[k].get("final_url"),
                                           accessed_at=sources[k].get("accessed_at"), source_class=sources[k]["source_class"],
                                           response_sha256=sources[k].get("response_sha256"), observation=sources[k]["observation"])
                                      for k in p["source_ids"]], scope="PUBLIC_IDENTITY_NOT_PUTDUK_APPROVAL_OR_LIVE_CATALOG"))
    data["research_revision"] = 2
    data["research_completed"] = False
    research.update(assessment_completed=True, completed=False, all_identities_verified=False,
                    status_counts=dict(collections.Counter(p["identity_status"] for p in data["candidates"])),
                    note="All 55 candidates assessed against actual responses. Partial/unknown detail prevents full identity completion; no legal/economic approval or live DB proof.")
    write("product-candidates.json", data)
    write("evidence/research-sources.json", research)
    write("evidence/product-source-evidence.json", evidence)
    # Lossless evidence; digests remain of the original bytes, not compressed bytes.
    for path in (ROOT / "evidence/source-responses").glob("*.txt"):
        original = path.read_bytes()
        assert hashlib.sha256(original).hexdigest() == sources[path.stem]["response_sha256"]
        path.with_suffix(".txt.gz").write_bytes(gzip.compress(original, mtime=0))
        path.unlink()
    table = "| Slug | 현재 확인명 | Code | Exchange | Class | State | 남은 확인 |\n|---|---|---|---|---|---|---|\n"
    for e in evidence:
        table += f"| {e['slug']} | {e['verified_name'] or 'UNKNOWN'} | {e['verified_code'] or 'UNKNOWN'} | {e['verified_exchange'] or 'UNKNOWN'} | {e['share_class'] or 'UNKNOWN'} | {e['verification_status']} | {', '.join(e['missing']) or '근거 범위 내 확인'} |\n"
    (ROOT / "RESEARCH-SOURCES.md").write_text("# 현재 공식 자료 재검증\n\n실제 HTTPS 응답, 접근 시각, 원본 SHA256 및 짧은 인용 근거는 evidence/product-source-evidence.json에 있다. 원본은 lossless .txt.gz이며 압축 해제한 원본 해시를 validator가 비교한다. HTTP 200만으로 사실을 확인 처리하지 않았다. 한국어 이름은 편집 번역이며 법적 등록명이 아니다. SEC 명부는 현재 이름/티커/거래소 근거지만 주식 종류·거래 가능·사용권 근거가 아니어서 미국 주식은 PARTIAL이다. 금·은의 XAU/XAG는 기존 내부 코드이며 LBMA 거래소 티커라는 주장이 아니다.\n\n" + table + "\nSEC에 Space Exploration Technologies Corp / SPCX / Nasdaq가 실제 존재한다. 비상장이라는 과거 가정으로 제외하지 않는다. VTI 현재 공식 제목은 Vanguard Morningstar Total Stock Market ETF다. TQQQ는 ProShares 확인이 필요하며 Invesco QQQ 응답을 증거로 사용하지 않는다. 국내 AI 조사 슬롯은 실제 KODEX 홈페이지의 471990으로 특정했지만 상세 거래소 확인 전 HOLD다.\n\nKRX 공개 데이터 요청은 400/403, 일부 한국 회사는 JavaScript/외부 시세 프레임만 제공했다. 이를 추측으로 채우지 않았다. 추가 data.sec.gov / www.proshares.com / tether.to / www.circle.com 허용 초안을 저장했지만 현재 runtime 재요청은 여전히 차단됐다. Publish 후 같은 공식 요청을 재검증해야 한다.\n")
    print(json.dumps(research["status_counts"]))
