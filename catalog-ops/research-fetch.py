"""Read-only official-source requests. Never bypass the cloud egress proxy.

Run from the repository root. Stores observations, not inferred market facts.
No response means no verification. Re-run after environment settings apply.
"""
import concurrent.futures
import datetime
import hashlib
import json
import pathlib
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
SOURCES = [
    ("sec", "SEC", "https://www.sec.gov/files/company_tickers_exchange.json", "SEC_LISTING"),
    ("krx", "한국거래소", "https://data.krx.co.kr/contents/MDC/MAIN/main.jspx", "KR_LISTING"),
    ("samsung", "삼성전자 IR", "https://www.samsung.com/global/ir/", "COMPANY_IR"),
    ("hynix", "SK하이닉스", "https://www.skhynix.com/", "COMPANY_IR"),
    ("lg", "LG전자", "https://www.lg.com/global/investor-relations", "COMPANY_IR"),
    ("hyundai", "현대자동차", "https://www.hyundai.com/worldwide/en/company/ir", "COMPANY_IR"),
    ("lgensol", "LG에너지솔루션", "https://www.lgensol.com/en/index", "COMPANY_IR"),
    ("naver", "NAVER", "https://www.navercorp.com/", "COMPANY_IR"),
    ("kakao", "카카오", "https://www.kakaocorp.com/", "COMPANY_IR"),
    ("samsungbio", "삼성바이오로직스", "https://samsungbiologics.com/", "COMPANY_IR"),
    ("kb", "KB금융", "https://www.kbfg.com/", "COMPANY_IR"),
    ("hanwha", "한화에어로스페이스", "https://www.hanwhaaerospace.com/", "COMPANY_IR"),
    ("hhi", "HD현대중공업", "https://www.hhi.co.kr/", "COMPANY_IR"),
    ("hdelectric", "HD현대일렉트릭", "https://www.hd-hyundaielectric.com/", "COMPANY_IR"),
    ("skinnovation", "SK이노베이션", "https://www.skinnovation.com/", "COMPANY_IR"),
    ("amore", "아모레퍼시픽", "https://www.apgroup.com/", "COMPANY_IR"),
    ("nvidia", "NVIDIA IR", "https://investor.nvidia.com/", "COMPANY_IR"),
    ("tesla", "Tesla IR", "https://ir.tesla.com/", "COMPANY_IR"),
    ("rocketlab", "Rocket Lab IR", "https://investors.rocketlabcorp.com/", "COMPANY_IR"),
    ("sandisk", "SanDisk IR", "https://investor.sandisk.com/", "COMPANY_IR"),
    ("spacex", "SpaceX", "https://www.spacex.com/", "LISTING_RECHECK_REQUIRED"),
    ("apple", "Apple IR", "https://investor.apple.com/", "COMPANY_IR"),
    ("microsoft", "Microsoft IR", "https://www.microsoft.com/en-us/Investor/", "COMPANY_IR"),
    ("amazon", "Amazon IR", "https://ir.aboutamazon.com/", "COMPANY_IR"),
    ("alphabet", "Alphabet IR", "https://abc.xyz/investor/", "COMPANY_IR"),
    ("meta", "Meta IR", "https://investor.atmeta.com/", "COMPANY_IR"),
    ("amd", "AMD IR", "https://ir.amd.com/", "COMPANY_IR"),
    ("broadcom", "Broadcom IR", "https://investors.broadcom.com/", "COMPANY_IR"),
    ("palantir", "Palantir IR", "https://investors.palantir.com/", "COMPANY_IR"),
    ("jpm", "JPMorgan Chase", "https://www.jpmorganchase.com/ir", "COMPANY_IR"),
    ("netflix", "Netflix IR", "https://ir.netflix.net/", "COMPANY_IR"),
    ("ssga", "State Street SPDR", "https://www.ssga.com/us/en/individual/etfs/funds/spdr-sp-500-etf-trust-spy", "ETF_SPONSOR"),
    ("invesco", "Invesco QQQ", "https://www.invesco.com/qqq-etf/en/home.html", "ETF_SPONSOR"),
    ("ishares", "iShares", "https://www.ishares.com/us/products/239705/ishares-phlx-semiconductor-etf", "ETF_SPONSOR"),
    ("schwab", "Schwab", "https://www.schwabassetmanagement.com/products/schd", "ETF_SPONSOR"),
    ("vanguard", "Vanguard", "https://investor.vanguard.com/investment-products/etfs/profile/vti", "ETF_SPONSOR"),
    ("globalx", "Global X", "https://www.globalxetfs.com/funds/aiq/", "ETF_SPONSOR"),
    ("kodex", "삼성자산운용 KODEX", "https://www.samsungfund.com/etf/main.do", "ETF_SPONSOR"),
    ("tiger", "미래에셋 TIGER", "https://www.tigeretf.com/ko/main/index.do", "ETF_SPONSOR"),
    ("bitcoin", "Bitcoin", "https://bitcoin.org/en/", "PROTOCOL"),
    ("ethereum", "Ethereum", "https://ethereum.org/en/", "PROTOCOL"),
    ("solana", "Solana", "https://solana.com/", "PROTOCOL"),
    ("bnb", "BNB Chain", "https://www.bnbchain.org/en", "PROTOCOL"),
    ("xrp", "XRP Ledger", "https://xrpl.org/", "PROTOCOL"),
    ("lbma", "LBMA", "https://www.lbma.org.uk/", "PRECIOUS_IDENTITY"),
    ("toss", "토스", "https://toss.im/", "BENCHMARK_FINTECH"),
    ("schwab-help", "Schwab", "https://www.schwab.com/resource-center/insights", "BENCHMARK_BROKERAGE"),
    ("stripe", "Stripe Docs", "https://docs.stripe.com/", "BENCHMARK_PAYMENTS"),
    ("coinbase", "Coinbase Help", "https://help.coinbase.com/", "BENCHMARK_CRYPTO"),
    ("apple-help", "Apple Support", "https://support.apple.com/", "BENCHMARK_CONSUMER"),
    ("netflix-help", "Netflix Help", "https://help.netflix.com/", "BENCHMARK_SUBSCRIPTION"),
    ("starbucks", "Starbucks Rewards", "https://www.starbucks.com/rewards", "BENCHMARK_REWARDS"),
]


def fetch(source):
    key, publisher, url, purpose = source
    row = dict(id=key, publisher=publisher, requested_url=url,
               hostname=urllib.parse.urlparse(url).hostname, purpose=purpose,
               attempted_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
               source_class="PRIMARY_TARGET", accessed_at=None,
               verified_facts=[], freshness_confidence="UNKNOWN", verified=False)
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "PUTDUK catalog research (read-only)"})
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read(4_000_000)
            row.update(http_status=response.status, final_url=response.url,
                       accessed_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                       observation="RESPONSE_OBTAINED_REVIEW_REQUIRED",
                       response_sha256=hashlib.sha256(body).hexdigest())
            (ROOT / "evidence" / "source-responses").mkdir(exist_ok=True)
            (ROOT / "evidence" / "source-responses" / (key + ".txt")).write_bytes(body)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        row.update(observation="ACCESS_BLOCKED" if "403" in str(exc) else "FETCH_FAILED", error=str(exc))
    return row


if __name__ == "__main__":
    (ROOT / "evidence").mkdir(exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        observations = list(pool.map(fetch, SOURCES))
    report = {"schema_version": 1, "completed": False,
              "note": "Response receipt alone is not factual verification; review name/ticker/exchange/class individually.",
              "sources": observations}
    (ROOT / "evidence" / "research-sources.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"attempted": len(observations), "obtained": sum(x.get("http_status") == 200 for x in observations),
                      "blocked": sum(x["observation"] == "ACCESS_BLOCKED" for x in observations)}))
