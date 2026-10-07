"""Deterministic editorial proposals, not a market-data importer."""
# OWNER_CORRECTION_GENERATOR_GUARD
from pathlib import Path as _OwnerPath
if __name__ == "__main__" and (_OwnerPath(__file__).parent / "product-access-policy.json").exists():
    raise SystemExit("SUPERSEDED_BY_OWNER_CORRECTION: use owner-correction.py; do not regenerate the rejected Tier access model or overwrite reviewed evidence")

import collections
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent
BASE = "0a7e95ba8bf55539fe32fd6f4654ee49a0be226d"


def write(name, value):
    path = ROOT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


# Name, identifier and sector columns below are investigation hints. None are
# promoted to canonical identity without reading an official current response.
ROWS = [
    ("samsung-electronics", "삼성전자", "KR_STOCK", "KR", "005930", "반도체·기기", "samsung", "P0_LAUNCH_CORE"),
    ("sk-hynix", "SK하이닉스", "KR_STOCK", "KR", "000660", "메모리", "hynix", "P0_LAUNCH_CORE"),
    ("lg-electronics", "LG전자", "KR_STOCK", "KR", "066570", "가전", "lg", "P2_LATER"),
    ("hyundai-motor", "현대자동차", "KR_STOCK", "KR", "005380", "모빌리티", "hyundai", "P0_LAUNCH_CORE"),
    ("lg-energy-solution", "LG에너지솔루션", "KR_STOCK", "KR", "373220", "배터리", "lgensol", "P0_LAUNCH_CORE"),
    ("naver", "NAVER", "KR_STOCK", "KR", "035420", "인터넷", "naver", "P1_LAUNCH_EXPANSION"),
    ("kakao", "카카오", "KR_STOCK", "KR", "035720", "인터넷", "kakao", "P2_LATER"),
    ("samsung-biologics", "삼성바이오로직스", "KR_STOCK", "KR", "207940", "바이오", "samsungbio", "P2_LATER"),
    ("kb-financial", "KB금융", "KR_STOCK", "KR", "105560", "금융", "kb", "P1_LAUNCH_EXPANSION"),
    ("hanwha-aerospace", "한화에어로스페이스", "KR_STOCK", "KR", "012450", "방산·우주", "hanwha", "P2_LATER"),
    ("hd-hyundai-heavy", "HD현대중공업", "KR_STOCK", "KR", "329180", "조선", "hhi", "P2_LATER"),
    ("hd-hyundai-electric", "HD현대일렉트릭", "KR_STOCK", "KR", "267260", "산업·전력", "hdelectric", "P2_LATER"),
    ("sk-innovation", "SK이노베이션", "KR_STOCK", "KR", "096770", "에너지", "skinnovation", "P2_LATER"),
    ("amorepacific", "아모레퍼시픽", "KR_STOCK", "KR", "090430", "소비재", "amore", "P2_LATER"),
    ("nvidia", "엔비디아", "US_STOCK", "US", "NVDA", "AI 연산", "nvidia", "P0_LAUNCH_CORE"),
    ("tesla", "테슬라", "US_STOCK", "US", "TSLA", "모빌리티", "tesla", "P0_LAUNCH_CORE"),
    ("rocket-lab", "로켓랩", "US_STOCK", "US", "RKLB", "우주", "rocketlab", "P1_LAUNCH_EXPANSION"),
    ("sandisk", "샌디스크", "US_STOCK", "US", "SNDK", "저장장치", "sandisk", "P1_LAUNCH_EXPANSION"),
    ("spacex", "SpaceX", "US_STOCK", "US", "SPCX", "우주", "spacex", "HOLD"),
    ("apple", "애플", "US_STOCK", "US", "AAPL", "정밀 기기", "apple", "P0_LAUNCH_CORE"),
    ("microsoft", "마이크로소프트", "US_STOCK", "US", "MSFT", "클라우드", "microsoft", "P0_LAUNCH_CORE"),
    ("amazon", "아마존", "US_STOCK", "US", "AMZN", "물류·클라우드", "amazon", "P1_LAUNCH_EXPANSION"),
    ("alphabet-a", "알파벳", "US_STOCK", "US", "GOOGL", "정보·인터넷", "alphabet", "P1_LAUNCH_EXPANSION"),
    ("meta", "메타", "US_STOCK", "US", "META", "소셜 플랫폼", "meta", "P1_LAUNCH_EXPANSION"),
    ("amd", "AMD", "US_STOCK", "US", "AMD", "연산 반도체", "amd", "P2_LATER"),
    ("broadcom", "브로드컴", "US_STOCK", "US", "AVGO", "통신 반도체", "broadcom", "P2_LATER"),
    ("palantir", "팔란티어", "US_STOCK", "US", "PLTR", "데이터", "palantir", "P2_LATER"),
    ("jpmorgan", "JP모건", "US_STOCK", "US", "JPM", "금융", "jpm", "P2_LATER"),
    ("netflix", "넷플릭스", "US_STOCK", "US", "NFLX", "콘텐츠", "netflix", "P2_LATER"),
    ("spy", "SPY", "ETF", "US", "SPY", "미국 대표 지수", "ssga", "P0_LAUNCH_CORE"),
    ("qqq", "QQQ", "ETF", "US", "QQQ", "미국 기술 지수", "invesco", "P0_LAUNCH_CORE"),
    ("soxx", "SOXX", "ETF", "US", "SOXX", "반도체 묶음", "ishares", "P1_LAUNCH_EXPANSION"),
    ("schd", "SCHD", "ETF", "US", "SCHD", "배당 분류", "schwab", "P1_LAUNCH_EXPANSION"),
    ("vti", "VTI", "ETF", "US", "VTI", "미국 전체 시장", "vanguard", "P2_LATER"),
    ("aiq", "AIQ", "ETF", "US", "AIQ", "AI 묶음", "globalx", "P2_LATER"),
    ("bnd", "BND", "ETF", "US", "BND", "채권", "vanguard", "P2_LATER"),
    ("iau", "IAU", "ETF", "US", "IAU", "금 연계 ETF", "ishares", "P2_LATER"),
    ("kodex-200", "KODEX 200", "ETF", "KR", "069500", "한국 대표 지수", "kodex", "P2_LATER"),
    ("tiger-us-sp500", "TIGER 미국S&P500", "ETF", "KR", "360750", "미국 지수 국내 ETF", "tiger", "P2_LATER"),
    ("kodex-semiconductor", "KODEX 반도체", "ETF", "KR", "091160", "한국 반도체 묶음", "kodex", "P2_LATER"),
    ("kr-ai-etf-research", "국내 AI ETF 개별상품 조사", "ETF", "KR", None, "AI 묶음", "tiger", "HOLD"),
    ("kr-dividend-etf-research", "국내 배당 ETF 개별상품 조사", "ETF", "KR", None, "배당 분류", "kodex", "HOLD"),
    ("tiger-us-nasdaq100", "TIGER 미국나스닥100", "ETF", "KR", "133690", "미국 기술 지수 국내 ETF", "tiger", "P2_LATER"),
    ("kodex-gold-futures", "KODEX 골드선물(H) 조사안", "ETF", "KR", "132030", "금 선물·환헤지", "kodex", "HOLD"),
    ("kodex-treasury-3y", "KODEX 국고채3년 조사안", "ETF", "KR", "114260", "국내 채권", "kodex", "P2_LATER"),
    ("tqqq-review", "TQQQ 레버리지 조사안", "ETF", "US", "TQQQ", "레버리지", "invesco", "HOLD"),
    ("bitcoin", "비트코인", "CRYPTO", "PROTOCOL", "BTC", "크립토", "bitcoin", "P0_LAUNCH_CORE"),
    ("ethereum", "이더리움", "CRYPTO", "PROTOCOL", "ETH", "크립토", "ethereum", "P0_LAUNCH_CORE"),
    ("solana", "솔라나", "CRYPTO", "PROTOCOL", "SOL", "크립토", "solana", "P1_LAUNCH_EXPANSION"),
    ("bnb", "BNB", "CRYPTO", "PROTOCOL", "BNB", "크립토", "bnb", "P2_LATER"),
    ("xrp", "XRP", "CRYPTO", "PROTOCOL", "XRP", "크립토", "xrp", "P2_LATER"),
    ("usdt-rail", "USDT 결제 수단 조사", "CRYPTO", "PROTOCOL", "USDT", "입출금 수단", "sec", "REJECT"),
    ("usdc-rail", "USDC 결제 수단 조사", "CRYPTO", "PROTOCOL", "USDC", "입출금 수단", "sec", "REJECT"),
    ("gold", "금", "PRECIOUS", "METAL", "XAU", "귀금속", "lbma", "P0_LAUNCH_CORE"),
    ("silver", "은", "PRECIOUS", "METAL", "XAG", "귀금속", "lbma", "P0_LAUNCH_CORE"),
]

# Each art concept and proposed relative value is authored for this catalog.
# It is not an assertion about a company's actual facility or market return.
PROFILES = {
    "samsung-electronics": ("1.12", "PRECISION_SCAN", "정밀 스캔형", "넓은 웨이퍼 공정실", "백색·코발트", "미세한 빛이 웨이퍼를 차례로 읽는 장면", "한국 입문 대표", "기기와 웨이퍼를 함께 읽는 안내가 가능해 A의 하단 1.12. HBM 1.15와 다른 차분한 흐름을 유지한다."),
    "sk-hynix": ("1.15", "LAYER_PULSE", "층별 신호형", "적층 메모리 공정실", "시안·구리", "메모리 층 가장자리에서 순서대로 켜지는 작은 신호", "정밀 기술 확장", "이미 승인된 메모리 family 방향과 층별 리듬을 S 입구 1.15에 배치. 연산 주력 1.18보다 낮춰 기술군 독점을 줄인다."),
    "nvidia": ("1.18", "COMPUTE_STREAM", "연산 흐름형", "액체 냉각 연산 시설", "에메랄드·구리", "광학 연결선의 국소 흐름과 냉각관 반사", "연산 주력", "밀도 높은 연산 흐름을 최고 1.18로 제안. 1.20보다 여유를 남겨 사용자·이벤트 적용 공간을 보존한다. 시장 성과 근거는 없다."),
    "tesla": ("1.13", "ASSEMBLY_RHYTHM", "조립 리듬형", "정밀 구동계 조립실", "백색·적색", "정지한 구동계 주위에 작업 확인등이 차례로 켜지는 장면", "모빌리티 대비", "자동차 주력 장면을 A 중간 1.13으로 제안. 로켓 임무 1.16보다 낮고 현대 조립 1.09와 다른 리듬을 강조한다."),
    "apple": ("1.08", "PRECISION_FOCUS", "정밀 관찰형", "작은 기기 부품 검사실", "상아색·은색", "사파이어 렌즈 아래 미세 부품의 반사", "쉬운 글로벌 입문", "알아보기 쉬운 소형 정밀 장면을 B 중간 1.08에 배치. 유명세만으로 S를 주지 않고 입문 상품의 과도한 속도 선택을 피한다."),
    "microsoft": ("1.10", "NETWORK_WEAVE", "연결 흐름형", "여러 층의 클라우드 작업실", "청색·유리", "분리된 노드 사이의 얇은 광학 신호", "연결형 기준", "분산 연결을 보여 주는 A 입구 1.10. 단일 GPU 1.18과 시각·속도 모두 구분하고 기존 승인 상한 안의 기준점으로 사용한다."),
    "hyundai-motor": ("1.09", "CONVEYOR_STEADY", "차례 진행형", "구동 장치 검수 작업실", "강철·청록", "레일의 확인등과 구동 장치의 작은 검사 움직임", "한국 비반도체 분산", "반도체 중심 편성을 완화하는 B 상단 1.09. 테슬라 1.13보다 검수 중심의 일정한 시각 리듬을 선택한다."),
    "lg-energy-solution": ("1.08", "CELL_SEQUENCE", "셀 순서형", "밀폐 배터리 셀 검사실", "짙은 청색·라임", "셀 묶음마다 켜지는 국소 상태등", "에너지 산업 분산", "셀 순서와 정밀 검수의 B 1.08. 가상 테마이며 충전량·실제 배터리 생산량을 보상으로 오인하지 않도록 빠른 최고값을 피한다."),
    "naver": ("1.07", "INDEX_PATH", "정보 탐색형", "계층형 정보 연결 공간", "녹색·먹색", "서로 다른 정보 선반 사이의 짧은 빛 경로", "국내 인터넷 분산", "읽기 쉬운 정보 경로를 B 하단 1.07에 배치. 연산 1.18과 시각적 주제를 분리하면서 한국 인터넷 대표 자리를 확보한다."),
    "kb-financial": ("1.02", "ARCHIVE_ORDER", "기록 정리형", "차분한 기록 보관실", "황금색·석재", "금고가 아닌 문서 보관 장치의 작은 확인등", "낮은 강도 선택", "기록 정리와 차분한 장면을 C 1.02로 제안. 금융 이름을 높은 보상과 연결하지 않고 실제 예금·투자 계좌 오인을 막는다."),
    "rocket-lab": ("1.16", "MISSION_BURST", "임무 단계형", "발사체 점검 격납고", "청회색·주황", "고정된 발사체 옆 검사 장치의 짧은 순차 신호", "우주 장면 대비", "임무 단계의 강한 시각 대비로 S 1.16. 최고 1.18보다 낮으며 burst는 화면 리듬일 뿐 확률 보너스나 일시 수익이 아니다."),
    "sandisk": ("1.09", "STORAGE_ORDER", "저장 정리형", "플래시 저장 모듈 검사실", "주홍·은색", "저장 블록별 미세 검사선", "메모리와 저장 구별", "HBM 적층 대신 저장 블록 정렬을 B 1.09로 제안. SK하이닉스 1.15와 시각·경제 순위를 중복하지 않는다."),
    "amazon": ("1.07", "LOGISTICS_PATH", "경로 정리형", "다층 물류 경로 작업실", "호박색·흑연", "무표식 운반 모듈이 짧은 구간만 움직이는 장면", "연산 밖 글로벌 분산", "물류 경로의 B 1.07. 최고 연산 상품과 경쟁하는 수익 포지셔닝 대신 산업 주제 분산을 맡긴다."),
    "alphabet-a": ("1.11", "KNOWLEDGE_LINK", "지식 연결형", "빛의 색이 분리된 검색 연결실", "청색·따뜻한 백색", "여러 층의 경로가 하나의 관찰 렌즈로 모이는 장면", "정보 연결 확장", "A 하단 1.11로 정보 노드의 복잡성을 표현. MSFT 1.10과 한 단계만 차이 나며 주식 클래스는 공식 자료 확인 전 확정하지 않는다."),
    "meta": ("1.06", "SOCIAL_NODE", "노드 교류형", "다중 연결 통로 공간", "보라·회청색", "서로 다른 작은 연결점이 교대로 밝아지는 장면", "글로벌 소비자 대비", "B 하단 1.06으로 부담 없는 연결 테마를 제안. 사용자 데이터나 실제 대화가 화면에 흐르는 것으로 오해시키지 않는다."),
    "bitcoin": ("1.14", "BLOCK_SEQUENCE", "블록 순서형", "단단한 블록 처리 작업실", "구리·먹색", "금화 대신 직육면체 장치의 순서등", "크립토 기준", "반복 블록의 A 상단 1.14. SOL 1.13보다 한 단계 높지만 실제 BTC 채굴 수량이나 시세와 무관하다."),
    "ethereum": ("1.12", "PROTOCOL_WEAVE", "구조 연결형", "다층 프로토콜 연결실", "보라·회백색", "투명한 연결판 사이의 작은 빛 흐름", "크립토 구조 대비", "A 1.12로 연결 구조를 강조. BTC 1.14보다 낮아 같은 분류 안의 장면 선호와 속도 선택을 구분한다. 실제 네트워크 채굴 설명이 아니다."),
    "solana": ("1.13", "PARALLEL_LANES", "나란한 흐름형", "여러 개의 평행 검사 통로", "민트·보라", "평행 레인에서 동시에 켜지는 국소 신호", "크립토 후속 분산", "A 1.13으로 병렬 장면의 강도를 표현. 실제 처리량·수수료·체인 성능을 검증하거나 금융 조건으로 반영한 값은 아니다."),
    "gold": ("1.00", "REFINERY_STEADY", "정제 관찰형", "광물 정제 작업실", "황금색·석재", "고정된 광물 받침과 천천히 켜지는 관찰등", "경제·시각 기준점", "차분한 정제 장면을 C 기준 1.00에 고정한 제안. 안전자산·원금 보호 효과가 아니라 시뮬레이션 비교용 기준이다."),
    "silver": ("1.04", "POLISH_SCAN", "표면 검사형", "은색 소재 검사실", "은색·청백색", "표면을 천천히 읽는 검사선", "귀금속 대비", "금 1.00보다 표면 검사 리듬이 강한 C 상단 1.04. 가격 상승 기대나 금과 은의 실제 수익 차이가 근거는 아니다."),
    "spy": ("1.03", "BASKET_BALANCE", "묶음 균형형", "여러 구역의 균형 작업실", "남색·온백색", "서로 다른 장치가 함께 켜지는 짧은 확인등", "넓은 묶음 입문", "ETF 입문 C 1.03. 분산투자 안전성이나 배당을 약속하지 않고 여러 테마가 함께 보이는 장면을 낮은 강도로 제안한다."),
    "qqq": ("1.06", "BASKET_LINK", "묶음 연결형", "층별 기술 장치 연결실", "자주·청색", "여러 검사 장치의 짧은 광학 연결", "기술 묶음 대비", "SPY 1.03보다 기술 장면 강도가 높은 B 1.06. 지수 성과를 추종하지 않으며 NVDA/SOXX와 중복되는 안내는 통합한다."),
    "soxx": ("1.10", "BASKET_SCAN", "묶음 검사형", "여러 반도체 공정의 분리 공간", "코발트·은색", "서로 다른 웨이퍼·패키지 검사선의 교대 점등", "단일 회사 밖 반도체", "A 입구 1.10으로 여러 공정을 하나의 장면에 묶는다. 단일 NVDA 1.18보다 낮춰 기술군 속도 독점을 완화한다."),
    "schd": ("1.01", "BASKET_ARCHIVE", "묶음 기록형", "차분한 다중 기록 작업실", "올리브·석재", "구역별 기록 확인등", "차분한 ETF 선택", "C 1.01로 기록 중심 장면을 제안. 실제 배당 지급·배당률·예금 같은 표현을 쓰지 않고 저강도 선택을 남긴다."),
}


def grade(speed):
    bps = int(speed.replace(".", "")) * 100
    return "S" if bps >= 11500 else "A" if bps >= 11000 else "B" if bps >= 10500 else "C"


def build():
    current = json.loads((ROOT / "current-catalog-audit.json").read_text())
    old = {p["slug"]: p for p in current["products"]}
    sources = json.loads((ROOT / "evidence/research-sources.json").read_text())["sources"]
    source_map = {s["id"]: s for s in sources}
    dimensions = ["korean_recognition", "global_recognition", "asset_representation", "sector_diversity",
                  "catalog_diversity", "low_overlap", "story_value", "visual_differentiation", "production_potential",
                  "beginner_clarity", "operations_simplicity", "support_simplicity", "legal_clarity",
                  "data_confidence", "launch_usefulness", "content_expansion"]
    products, launch, copy, economy, source_evidence = [], [], [], [], []
    for slug, name, asset, market, hint, sector, source, wave in ROWS:
        profile = PROFILES.get(slug)
        identity_sources = [source] + (["sec"] if asset == "US_STOCK" and source != "sec" else ["krx"] if market == "KR" else [])
        # No source was accessible in this run. Legal/market scoring remains low.
        scores = {d: 3 for d in dimensions}
        scores.update(data_confidence=1, legal_clarity=1, korean_recognition=4 if market == "KR" else 3,
                      global_recognition=4 if market == "US" else 3,
                      launch_usefulness=4 if profile else 2,
                      visual_differentiation=4 if profile else 2,
                      operations_simplicity=2 if asset == "ETF" else 3,
                      low_overlap=2 if sector in ["AI 연산", "메모리", "반도체 묶음"] else 4)
        p = {
            "proposal_id": "catalog-v1-" + slug, "slug": slug, "name_hint_ko": name,
            "asset_class": asset, "market": market, "ticker_hint": hint, "canonical_ticker": None,
            "canonical_name": None, "canonical_exchange": None, "sector_hint": sector,
            "share_class_hint": "CLASS_A_TO_VERIFY" if slug == "alphabet-a" else None,
            "identity_status": "UNKNOWN", "status": "PUTDUK_PROPOSED", "operator_approval": None,
            "proposed_wave": wave, "effective_wave": "REJECT" if wave == "REJECT" else "HOLD",
            "classification_reason_ko": "조건부 24개 편성의 산업·장면 분산 후보" if profile else
                "자산 종류·상장 및 복잡성 재검토 후 편성" if wave == "HOLD" else
                "입출금 수단을 채굴 상품으로 자동 편성하지 않음" if wave == "REJECT" else
                "초기 24개와의 중복 또는 추가 제작 부담으로 후속 검토",
            "repo_status": "REPOSITORY_DRAFT" if slug in old else "NOT_IN_REPOSITORY",
            "repository_draft_id": old[slug]["product_id"] if slug in old else None,
            "live_status": "LIVE_DB_UNKNOWN", "source_ids": identity_sources,
            "source_status": "ACCESS_BLOCKED", "verified_facts": [], "scores": scores,
            "score_status": "EDITORIAL_HYPOTHESIS_NOT_MEASURED", "market_linked": False,
            "legal_brand_review": "LEGAL_BRAND_REVIEW_REQUIRED", "partnership_claim_allowed": False,
            "scene_status": "SPEC_IN_FROZEN_LANE_PRODUCT_QA_REQUIRED" if slug in old else "SCENE_SPEC_REQUIRED",
            "registration_ready": False,
            "blocking_requirements": ["PUBLIC_IDENTITY_VERIFICATION_REQUIRED", "LEGAL_BRAND_REVIEW_REQUIRED", "APPROVED_CATALOG_COMMAND_REQUIRED"],
        }
        if asset == "ETF": p["blocking_requirements"].append("ETF_CATEGORY_CONTRACT_REQUIRED")
        if slug == "spacex": p["blocking_requirements"].append("CURRENT_SPACEX_SPCX_LISTING_REQUIRED")
        if slug in ["tqqq-review", "kodex-gold-futures"]: p["blocking_requirements"].append("COMPLEX_PRODUCT_REVIEW_REQUIRED")
        products.append(p)
        source_evidence.append({"proposal_id": p["proposal_id"], "requested_sources": [source_map[x]["requested_url"] for x in identity_sources],
                                "verified_name": None, "verified_code": None, "verified_market": None,
                                "verified_exchange": None, "verified_asset_class": None, "checked_at": None,
                                "scope": "INVESTIGATION_HINTS_ONLY", "verification_status": "UNKNOWN"})
        if not profile: continue
        speed, personality, personality_ko, world, palette, motion, role, rationale = profile
        bps = int(speed.replace(".", "")) * 100
        e = {
            "proposal_id": p["proposal_id"], "slug": slug, "product_name_hint_ko": name,
            "proposed_wave": wave, "grade": grade(speed), "mining_personality": personality,
            "personality_ko": personality_ko, "mining_difficulty": "설명과 시각 밀도만 표시; 손실·수익·자격의 난이도가 아님",
            "proposed_product_speed_multiplier": speed, "proposed_product_speed_bps": bps,
            "approved_product_speed_multiplier": None, "policy_status": "PROPOSED_NOT_APPROVED",
            "policy_approval_required": True, "capacity_policy": "INHERIT_TIER_CAPACITY",
            "product_capacity_override": None, "market_linked": False,
            "existing_policy_compatibility": "POLICY_VERSION_CHANGE_REQUIRED" if bps > 11000 else "WITHIN_DOCUMENT_BAND_RUNTIME_SCOPE_UNRESOLVED",
            "capacity_scope": "GLOBAL_CYCLE", "retention_policy": "INHERIT_SEPARATE_APPROVED_RETENTION",
            "slots_policy": "INHERIT_TIER_SLOTS_NOT_MULTIPLICATIVE",
            "speed_rationale_ko": rationale,
            "catalog_role": role, "visual_intensity": "높음" if grade(speed) == "S" else "중간" if grade(speed) in ["A", "B"] else "차분함",
            "main_money_display": "WHOLE_KRW_ONLY", "minimum_main_step_krw": "1",
            "cue": "1원 단위 확정 기록이 늘어난 뒤 짧게 표시; 소수 원·로컬 애니메이션을 확정 잔액으로 표시하지 않음",
            "settlement_style": "Pending → Settlement → Verified; 실제 승인된 서버 정산·원장 readback만 확정",
            "risk_flags": ["PROPOSAL_NOT_ACTIVE", "NON_DEFAULT_EFFECT_SCOPE_UNRESOLVED", "FASTEST_PRODUCT_CONCENTRATION", "LEGAL_BRAND_REVIEW_REQUIRED"],
        }
        economy.append(e)
        l = {
            "proposal_id": p["proposal_id"], "slug": slug, "planned_wave": wave,
            "effective_wave": "HOLD", "effective_from": None, "status": "PROPOSED_NOT_APPROVED",
            "available_to": None, "display_order": len(launch) + 1,
            "featured": wave == "P0_LAUNCH_CORE", "trial_available": None,
            "scene_family_proposal": world, "scene_keywords": [world, palette, motion],
            "desktop_master": None, "mobile_master": None,
            "scene_requirements": ([] if slug in old else ["SCENE_SPEC_REQUIRED"]) + ["DESKTOP_MASTER_REQUIRED", "MOBILE_MASTER_REQUIRED", "REAL_BROWSER_ACCEPTANCE_REQUIRED"],
            "legal_brand_review": "LEGAL_BRAND_REVIEW_REQUIRED", "public_identity": "UNKNOWN",
            "approved": False, "registration_ready": False,
            "registration_status": "APPROVED_CATALOG_COMMAND_REQUIRED", "policy_status": "POLICY_APPROVAL_REQUIRED",
        }
        launch.append(l)
        # No ticker hint, numeric speed proposal or technical enum leaks into member copy.
        short = world + "을 둘러보는 가상 채굴 테마예요."
        body = (name + "에서 떠올린 산업 이미지를 가상 채굴 장면으로 표현한 테마입니다. " + world + "에서 " + motion + "을 살펴보세요.\n\n"
                "테마 이름은 실제 주식·ETF·금속·코인의 매수나 소유를 뜻하지 않습니다. 시세나 배당이 채굴보상을 결정하지 않습니다. 해당 기업·운용사와의 제휴를 뜻하지 않습니다.\n\n"
                "채굴 속도와 주기 한도는 서로 다른 조건입니다. 장면의 움직임이 금액을 확정하지 않습니다. 확인 전 기록은 정산 뒤 지갑에 반영된 확정 기록과 구분해 주세요. 선택 가능 여부와 적용 조건은 실제 공개된 상품 안내에서 확인하세요.")
        copy.append({"proposal_id": p["proposal_id"], "slug": "copy-" + slug,
                     "title_ko": name + " 테마", "short_description_ko": short, "body_ko": body,
                     "beginner_help_ko": "장면을 먼저 살펴보세요. 금액은 지갑에서 확정된 기록으로 확인해요.",
                     "asset_class_help_ko": {"KR_STOCK": "한국 기업에서 떠올린 테마", "US_STOCK": "미국 기업에서 떠올린 테마",
                                              "ETF": "여러 대상을 묶는 상품에서 떠올린 테마", "CRYPTO": "디지털 자산에서 떠올린 테마",
                                              "PRECIOUS": "귀금속에서 떠올린 테마"}[asset],
                     "personality_help_ko": personality_ko + ": " + motion + ". 추가 보상을 뜻하지 않아요.",
                     "scene_keywords": l["scene_keywords"], "cta": {"label": "상품 안내 보기", "route": "/products"},
                     "linked_faq_slugs": ["catalog-help-theme-not-ownership", "catalog-help-speed-capacity", "catalog-help-scene-money"],
                     "linked_notice_slugs": ["catalog-notice-theme-positioning", "catalog-notice-product-release"],
                     "linked_event_slugs": ["catalog-event-theme-reading"],
                     "operator_note_ko": "이름·상장 확인, 법무 검토, 최종 공개 원고 확인 전 게시 금지. 속도 제안은 회원 원고에 넣지 않음.",
                     "status": "DRAFT", "legal_copy_status": "LEGAL_COPY_REQUIRED", "registration_ready": False})
    write("product-candidates.json", {"schema_version": 1, "base_sha": BASE, "research_completed": False,
        "counts": dict(collections.Counter(x["asset_class"] for x in products)), "candidates": products})
    write("launch-catalog-proposal.json", {"schema_version": 1, "status": "PROPOSED_NOT_APPROVED",
        "planned_product_count": len(launch), "effective_launch_count": 0, "approved": False, "products": launch})
    write("product-copy.json", copy)
    write("evidence/product-source-evidence.json", source_evidence)
    write("product-economy-proposal.json", {"schema_version": 1, "status": "PROPOSED_NOT_APPROVED",
        "recommended_policy": "A", "recommended_band": {"minimum": "1.00", "maximum": "1.18", "step": "0.01"},
        "allowed_proposal_band": {"minimum_bps": 10000, "maximum_bps": 12000},
        "approved_policy_product_band_bps": {"minimum": 9000, "maximum": 11000},
        "market_linked": False, "combined_speed_cap_bps": 15000, "clamp_stage": "FINAL_COMBINED_ONCE",
        "modifier_scope": "PROPOSED_FULL_PRODUCT_TIMES_USER_TIMES_EVENT_TIMES_TEMPORARY",
        "modifier_runtime_status": "EFFECT_SCOPE_UNRESOLVED", "micro_krw_per_krw": "1000000",
        "capacity_policy": "INHERIT_TIER_CAPACITY", "policy_approval_required": True,
        "approved_policy_version": None, "products": economy})
    write("launch-wave-plan.json", {"schema_version": 1, "status": "PROPOSED_NOT_APPROVED",
        "schedule": None, "timezone": "Asia/Seoul", "waves": [
            {"name": w, "products": [x["proposal_id"] for x in products if x["proposed_wave"] == w],
             "entry_gates": ["CURRENT_OFFICIAL_IDENTITY", "LEGAL_BRAND_APPROVAL", "POLICY_APPROVAL",
                             "APPROVED_COMMAND", "LOCAL_REGISTRATION_READBACK_RENDER_ROLLBACK", "PRODUCT_SCENE_QA"],
             "delay_if_failed": True, "economic_activation": False}
            for w in ["P0_LAUNCH_CORE", "P1_LAUNCH_EXPANSION", "P2_LATER", "HOLD", "REJECT"]]})
    table = "| 상품(조사 힌트) | 편성 제안 | Grade | 장면 성격 | 제안 속도 | Capacity | 기존 정책 |\n|---|---|---|---|---|---|---|\n"
    for e in economy:
        table += f"| {e['product_name_hint_ko']} | {e['proposed_wave']} | {e['grade']} | {e['personality_ko']} | {e['proposed_product_speed_multiplier']} | INHERIT_TIER_CAPACITY | {e['existing_policy_compatibility']} |\n"
    (ROOT / "PRODUCT-ECONOMY-MATRIX.md").write_text("# 상품별 경제 제안\n\n모든 값은 PROPOSED_NOT_APPROVED다. 승인값은 null이다. Grade는 가상 상품 편성 표기이며 투자 등급·기업 평가가 아니다. 각 값의 비교 근거, whole KRW cue, Pending/Settlement/Verified 경계는 JSON에 있다.\n\n" + table)
    proposal = "# 조건부 출시 상품 편성\n\n시장 사실을 확인한 24개가 아니라 조사 차단 상태에서 설계한 24개 조건부 후보다. effective_wave는 모두 HOLD이며 출시 시각은 null이다. 현재 공개 상품 수나 사용자의 자산 소유를 뜻하지 않는다.\n\n"
    for wave in ["P0_LAUNCH_CORE", "P1_LAUNCH_EXPANSION", "P2_LATER", "HOLD", "REJECT"]:
        proposal += "## " + wave + "\n\n" + ", ".join(x["name_hint_ko"] for x in products if x["proposed_wave"] == wave) + "\n\n"
    proposal += "현재 seed의 BNB/XRP만 P2로 보류 제안한다. 나머지 기존 9개는 조건부 출시 편성에 남긴다. 소스·코드·법적 사용권이 확인되지 않으면 공개하지 않는다.\n\n한국 산업과 미국 산업, 4개 ETF, 3개 크립토, 2개 귀금속으로 장면을 분산한다. 반도체 단일기업과 SOXX/QQQ는 설명 중복을 줄이고 묶음과 단일 기업의 의미를 구별한다. VTI/SPY 중복, AMD/NVDA 중복과 새 Scene 제작 부담 때문에 P2를 한꺼번에 공개하지 않는다.\n\n"
    proposal += "SpaceX는 현재 SPCX 상장 여부를 확인하지 못했다. 상장/비상장 어느 쪽도 단정하지 않는다. SNDK도 현재 발행회사·분리 후 상장·거래소를 확인해야 한다. Alphabet은 A주 GOOGL 가설로만 편성하며 공식 share class 교차 확인이 필요하다. 국내 AI·배당 ETF는 특정 상품 이름과 코드가 미정인 조사 슬롯이므로 출시 후보에 넣지 않았다. 레버리지·선물·헤지 상품은 추가 복잡성 검토가 필요하다. USDT/USDC는 채굴상품 편성 거절이며 입출금 지원 여부를 새로 주장하지 않는다.\n\n"
    proposal += "신규 15개 출시 제안은 기존 catalog/scene 패키지에 없다: " + ", ".join(x["name_hint_ko"] for x in products if x["slug"] in PROFILES and x["repo_status"] == "NOT_IN_REPOSITORY") + ". 모든 신규 후보에 SCENE_SPEC_REQUIRED, DESKTOP_MASTER_REQUIRED, MOBILE_MASTER_REQUIRED를 연결했다. 24개 모두 실제 상품 browser QA가 필요하다.\n"
    (ROOT / "PRODUCT-CATALOG-PROPOSAL.md").write_text(proposal)
    (ROOT / "PRODUCT-COPY.md").write_text("# 상품 원고 초안\n\n전체 회원 원고는 법무 검토 전 DRAFT다. 기업 제휴·실제 자산 매수·가격 연동을 주장하지 않는다. 숫자 제안은 회원 공개 원고에 넣지 않았다.\n\n" + "\n\n".join("## " + x["title_ko"] + "\n\n" + x["short_description_ko"] + "\n\n" + x["body_ko"] + "\n\n처음 이용 안내: " + x["beginner_help_ko"] for x in copy))
    (ROOT / "LAUNCH-WAVE-PLAN.md").write_text("# 단계별 편성 계획\n\nP0 14개, P1 10개 총 24개를 조건부 편성한다. 날짜와 실제 선택 가능 여부는 정하지 않았다. 같은 날짜에 전부 노출하거나 자동 예약하지 않는다.\n\n1. 공식 신원·이름·코드·자산 분류와 법적 표현을 확정한다. ETF 분류 계약이 없으면 ETF를 다른 분류로 게시하지 않는다.\n2. P0의 승인된 경제 policy version, Scene desktop/mobile와 돈 표시 QA, 실제 catalog command preview를 확인한다.\n3. 격리 LOCAL에서 draft ID → readback → 권한/노출 검증 → 실제 렌더 → cancel/archive → readback을 증거로 남긴다. 기존 기록 손실이 없어야 한다.\n4. 사용자 출시 승인 뒤 Primary가 게시한다. 이 lane은 게시하지 않는다.\n5. P1은 실제 노출·오류·지원 문의 집계가 확인된 뒤 별도 승인한다. 집계가 없으면 UNKNOWN으로 보고한다. 수치나 회원 반응을 지어내지 않는다.\n6. P2/HOLD는 부족한 근거와 추가 제작 부담을 해결하기 전 공개하지 않는다. retirement는 선택 중지와 기존 기록 보존을 분리한다.\n\n어느 gate든 실패하면 해당 상품은 HOLD에 남긴다. 일정이 급하다는 이유로 승인·금융·보안 검사를 생략하지 않는다.\n")
    print(json.dumps({"candidates": len(products), "counts": dict(collections.Counter(x["asset_class"] for x in products)),
                      "planned_launch": len(launch), "effective_launch": 0, "economy_values": len(economy)}))


if __name__ == "__main__":
    build()
