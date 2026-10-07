"""Audit frozen launch content and author delta only. No CMS writes."""
import collections
import hashlib
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parent
FROZEN = "ba9ed931f756488ce4f67f945cffad9552842c09"


def read(kind):
    return json.loads(subprocess.check_output(["git", "show", FROZEN + ":launch-content/" + kind + ".json"], cwd=ROOT.parent, text=True))


def write(name, data):
    path = ROOT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


EVENT_ADDITIONS = [
    ("theme-reading", "테마 이름과 이용 조건 따로 읽기", "/products", "상품 안내 보기",
     "상품 이름은 장면의 주제를 구별하기 위한 이름입니다. 실제 주식·ETF·금속·코인을 사거나 보유하는 뜻이 아니에요. 기업이나 운용사와의 제휴를 뜻하지 않습니다.\n\n장면 설명과 실제 적용 조건을 각각 읽어 보세요. 속도와 한도는 다르며, 이름이나 그림으로 금액을 예상하지 않습니다. 이 안내를 읽어도 추가 보상은 없습니다.", "기업 이름으로 실제 자산 소유·제휴를 기대하는 오해", "무표식 산업 장치와 읽기용 여백; 로고 없음"),
    ("semiconductor-worlds", "반도체 장면의 차이 살펴보기", "/products", "장면 안내 보기",
     "반도체를 주제로 한 장면은 웨이퍼 공정, 메모리 층, 저장 장치처럼 서로 다른 모습을 보여 줄 수 있어요. 같은 반도체 분류라도 장면의 중심 물체와 움직임은 다릅니다.\n\n어떤 모습이 더 편하게 보이는지 설명부터 살펴보세요. 장면의 정교함은 투자 성과나 받을 금액을 뜻하지 않습니다. 아직 공개되지 않은 테마는 이용 가능한 상품으로 안내하지 않습니다. 추가 보상은 없습니다.", "산업 이미지를 실제 회사 설비나 생산 성과로 오인", "웨이퍼·적층 패키지·저장 블록의 서로 다른 실루엣"),
    ("ai-compute-reading", "AI 연산 장면 읽는 방법", "/products", "상품 설명 읽기",
     "AI 연산을 주제로 한 장면에서는 연산 장치와 냉각관, 연결선을 볼 수 있어요. 화면의 빛과 작은 움직임은 가상 장면을 표현합니다. 실제 회사의 작업량이나 외부 AI 사용량을 보여 주는 자료가 아닙니다.\n\n확인 전 금액과 확정 금액은 채굴·지갑의 안내에서 구별해 주세요. 반짝임이 늘었다고 추가 보상이 생기지 않습니다. 이 안내의 별도 보상은 없습니다.", "AI 성장·연산량을 보상과 연결", "고정 카메라 GPU 장치와 냉각관의 국소 반사"),
    ("mobility-reading", "자동차 테마의 작업 흐름 보기", "/products", "테마 살펴보기",
     "자동차를 주제로 한 테마는 조립 장치와 검사등처럼 작업 흐름을 보여 주는 가상 장면입니다. 차를 구매하거나 차량 소유권을 얻는 서비스가 아닙니다.\n\n검사등이 순서대로 켜지는 모습은 화면 표현입니다. 속도나 한도는 공개된 이용 조건을 따로 읽어 주세요. 선택하지 않아도 이 안내를 확인할 수 있으며 추가 보상은 없습니다.", "차량·차량 소유권 제공 오인", "자동차 로고 없는 구동계 검사실"),
    ("battery-reading", "배터리 테마의 순서등 살펴보기", "/products", "테마 설명 보기",
     "배터리 테마에서는 작은 셀 묶음과 검사 장치를 주제로 한 장면을 볼 수 있어요. 실제 배터리의 생산량·충전량·전력 판매량을 보여 주는 화면은 아닙니다.\n\n셀의 밝기가 달라져도 보상이 자동으로 늘지 않습니다. 금액은 정산 후 지갑의 확정 기록으로 확인합니다. 이용 조건을 이해하지 못했다면 선택 전에 도움말을 읽어 주세요. 추가 보상은 없습니다.", "전력 생산·에너지 판매 수익과 연결", "밀폐 셀 모듈과 국소 검사등"),
    ("space-reading", "우주 테마의 임무 장면 이해하기", "/products", "상품 안내 읽기",
     "우주 테마는 발사체 점검과 임무 준비를 떠올린 가상 장면입니다. 실제 발사 일정이나 성공 결과에 따라 보상이 바뀌는 서비스가 아닙니다.\n\n짧고 강한 불빛은 장면의 리듬일 뿐 당첨·추가 지급을 뜻하지 않습니다. 기업 이름과 상품 이용 가능 여부는 현재 공개된 안내로 확인해 주세요. 이 안내에는 추가 보상이 없습니다.", "실제 발사 결과·상장 소문·당첨 보상 오인", "화염·발사 없이 고정된 점검 격납고"),
    ("etf-reading", "ETF 테마는 어떤 이름인가요?", "/products", "묶음 테마 안내",
     "ETF는 여러 대상을 묶는 금융 상품의 한 종류입니다. 퍼뜩의 ETF 테마는 그 묶음 개념을 가상 장면으로 표현합니다. 실제 ETF를 매수하거나 구성 종목을 보유하는 뜻이 아닙니다.\n\n실제 배당·분배금·지수 수익률이 퍼뜩 채굴보상으로 들어오지 않습니다. 공개 여부와 이용 조건은 별도 안내로 확인해 주세요. 이 안내의 추가 보상은 없습니다.", "실제 ETF 투자·배당·분산투자 안전성 오인", "서로 다른 작업 구역을 연결한 장면; 종목 로고 없음"),
    ("single-and-basket", "한 기업 테마와 묶음 테마 구별하기", "/products", "설명 비교하기",
     "한 기업에서 떠올린 테마와 여러 대상을 묶는 상품에서 떠올린 테마는 설명 방식이 다릅니다. 하나는 특정 산업 장면을, 다른 하나는 여러 작업 구역을 함께 보여 줄 수 있어요.\n\n묶음 장면을 선택한다고 실제 자산이 분산되거나 한도가 늘어나는 것은 아닙니다. 테마 수나 슬롯 수만 보고 받을 금액을 더하지 마세요. 실제 적용 조건을 읽어 주세요. 추가 보상은 없습니다.", "슬롯·ETF 구성 수만큼 global 용량 중복 계산", "단일 모듈과 다중 작업 구역의 대비"),
    ("crypto-labels", "코인 이름과 지갑 금액 구별하기", "/products", "테마 이름 읽기",
     "코인 이름을 쓴 테마는 디지털 자산을 떠올린 가상 장면입니다. 그 코인을 직접 채굴해 내 코인 지갑으로 보내는 뜻이 아닙니다. 외부 네트워크 활동이나 코인 가격으로 보상이 정해지지 않습니다.\n\nUSDT 입출금 안내와 채굴 테마는 별도로 읽어 주세요. 입출금 방식이 있다고 같은 이름의 채굴 상품이 자동으로 생기지 않습니다. 지갑의 실제 확정 기록을 확인하세요. 추가 보상은 없습니다.", "실제 코인 채굴·사용자 USDT 잔액 오인", "통화 기호·금화 없이 블록과 연결판 장면"),
    ("metal-reading", "금·은 장면을 차분하게 살펴보기", "/products", "귀금속 테마 보기",
     "금과 은 테마는 광물 정제와 표면 검사를 떠올린 가상 장면입니다. 실제 금속을 사거나 맡겨 두는 서비스가 아닙니다. 테마 이름은 원금 보장이나 가격 상승을 뜻하지 않습니다.\n\n움직임이 차분해도 다른 테마보다 안전한 금융 상품이라는 뜻은 아닙니다. 화면의 색과 속도 대신 실제 이용 조건을 확인해 주세요. 이 안내의 추가 보상은 없습니다.", "금 실물 보관·안전자산·원금 보장 오인", "정제 받침·은 표면 검사선; 소유증서 없음"),
]

NOTICE_ADDITIONS = [
    ("product-release", "새 테마 공개 전 확인 안내", "새 테마를 순서대로 안내합니다.",
     "새로 안내하는 테마: {{approved_product_names}}\n공개 시각: {{effective_at_kst}}\n이용 가능한 대상: {{approved_audience}}\n\n상품 화면에서 설명과 적용 조건을 읽어 주세요. 이름과 그림은 실제 자산 매수나 소유, 기업 제휴를 뜻하지 않습니다. 공개 안내를 보았다는 이유로 상품 선택이나 추가 보상이 완료되지 않습니다.\n\n선택 가능 여부는 내 계정에 표시된 최신 안내에서 확인합니다. 안내가 보이지 않으면 같은 요청을 반복하지 말고 고객지원으로 알려 주세요.", ["approved_product_names", "effective_at_kst", "approved_audience"], "/products"),
    ("theme-positioning", "테마 이름과 실제 자산은 다릅니다", "상품 이름의 의미를 먼저 확인해 주세요.",
     "퍼뜩의 테마 이름과 장면은 가상 채굴 주제를 설명합니다. 실제 주식·ETF·금속·코인을 매수하거나 소유하는 뜻이 아닙니다. 해당 기업·운용사와의 제휴나 보증을 뜻하지 않습니다.\n\n시장가격·배당·분배금이 채굴보상을 결정하지 않습니다. 이용 조건과 금액은 공개된 안내 및 실제 정산·지갑 기록으로 확인합니다.\n\n이름이나 그림 때문에 실제 자산이 생긴 것으로 생각했다면 선택 전에 고객지원에 문의해 주세요.", [], "/products"),
    ("availability", "상품 선택 가능 상태 안내", "공개와 선택 가능 여부는 다를 수 있습니다.",
     "상품 설명이 보이더라도 지금 선택할 수 없는 경우가 있습니다. 이용 대상, 적용 시각, 일시 중지 여부를 상품 안내에서 확인하세요.\n\n선택 버튼이 보이지 않거나 이용이 중지되었다면 반복해서 요청하지 마세요. 이름만 보고 내 계정에서 사용할 수 있다고 판단하지 않습니다.\n\n내 기록에 영향이 있는 변경은 별도 안내합니다. 선택 가능 여부가 분명하지 않으면 고객지원으로 확인을 요청할 수 있어요.", [], "/products"),
    ("retired", "테마의 새 선택 중지 안내", "기존 기록의 영향과 새 선택을 구분해 안내합니다.",
     "새 선택이 중지되는 테마: {{approved_product_names}}\n적용 시각: {{effective_at_kst}}\n기존 이용과 정산 기록에 미치는 영향: {{verified_existing_impact}}\n이용 가능한 다음 단계: {{approved_next_steps}}\n\n새 선택 중지는 기존 금액·거래 기록 삭제를 뜻하지 않습니다. 기존 기록과 실제 적용 상태를 채굴·지갑에서 확인해 주세요. 이 변경으로 추가 보상이나 환급이 자동 발생한다고 생각하지 마세요.\n\n기록이 예상과 다르면 같은 요청을 반복하지 말고 해당 내역으로 고객지원에 문의합니다.", ["approved_product_names", "effective_at_kst", "verified_existing_impact", "approved_next_steps"], "/products"),
    ("scene-money", "장면 움직임과 확정 금액 안내", "장면의 표현이 금액을 결정하지 않습니다.",
     "빛, 기계 움직임, 작업 신호는 가상 장면의 표현입니다. 불빛이 강해지거나 화면이 빨라졌다고 보상이 추가되거나 금액이 확정되지 않습니다.\n\n채굴 화면의 확인 전 기록과 지갑의 확정 기록은 다릅니다. 정산을 마친 실제 기록을 기준으로 출금 가능 여부를 확인하세요.\n\n앱을 다시 열거나 장면을 바꾸어도 같은 금액을 중복 지급하지 않습니다. 금액이 다르게 보이면 시각과 해당 내역을 고객지원에 알려 주세요.", [], "/mining"),
    ("speed-policy-review", "채굴 속도 조건 변경 사전 안내", "변경 내용과 기존 이용 영향을 확인해 주세요.",
     "변경 대상: {{approved_product_names}}\n변경 전 속도 조건: {{approved_before_speed}}\n변경 후 속도 조건: {{approved_after_speed}}\n적용 시각: {{effective_at_kst}}\n주기 한도와 기존 이용에 미치는 영향: {{verified_existing_impact}}\n\n속도는 진행 속도를 뜻하며 주기 안에서 적용되는 한도와 다릅니다. 더 빠르게 보인다고 총액이 자동으로 늘지 않습니다. 안내에 적힌 적용 시각 전에는 새 조건을 사용하지 않습니다.\n\n금액과 상태는 실제 적용된 안내 및 정산 기록을 확인해 주세요. 이해되지 않는 내용은 고객지원으로 문의할 수 있습니다.", ["approved_product_names", "approved_before_speed", "approved_after_speed", "effective_at_kst", "verified_existing_impact"], "/mining"),
    ("effective-version", "상품 안내가 달라졌을 때 확인하는 방법", "내 이용에 적용된 안내를 확인하세요.",
     "새 상품 안내가 공개되어도 모든 기록에 새 조건이 소급 적용되는 것은 아닙니다. 적용 시각과 기존 이용에 미치는 영향은 변경 공지에서 확인하세요.\n\n이전 기록을 새 상품 설명과 단순 비교해 금액을 더하거나 빼지 마세요. 채굴과 지갑에 표시된 실제 적용 상태를 확인합니다.\n\n설명과 내 기록이 다르면 해당 화면과 발생 시각을 고객지원에 알려 주세요. 비밀번호·인증 코드는 보내지 않습니다.", [], "/events"),
    ("etf-basket", "ETF 테마의 묶음 표현 안내", "묶음 장면은 실제 투자 포트폴리오가 아닙니다.",
     "ETF는 여러 대상을 묶는 금융 상품의 한 종류입니다. 퍼뜩의 ETF 테마는 묶음 개념을 가상 장면으로 설명합니다. 실제 ETF나 구성 종목을 매수하거나 보유하는 뜻이 아닙니다.\n\n지수의 성과나 배당·분배금이 채굴보상으로 반영되지 않습니다. 여러 장치가 보여도 받을 금액이나 슬롯별 한도가 자동으로 늘지 않습니다.\n\n공개 여부와 선택 가능 조건은 상품 화면의 실제 안내로 확인해 주세요.", [], "/products"),
]

FAQ = [
    ("theme-not-ownership", "상품 이름이 있으면 그 주식을 가진 건가요?", "Product", "아니요. 테마 이름과 장면은 가상 채굴 주제를 설명합니다. 실제 주식·ETF·금속·코인을 매수하거나 보유하는 뜻이 아닙니다. 기업이나 운용사와의 제휴를 뜻하지도 않습니다. 실제 이용 조건은 공개된 상품 안내를 읽어 주세요.", "/products"),
    ("speed-capacity", "속도가 빠르면 한도도 늘어나나요?", "Mining", "속도와 한도는 서로 다른 조건입니다. 속도는 진행 속도이고, 한도는 주기 안에서 적용되는 범위입니다. 빠른 속도만으로 총액이 늘어나지 않습니다. 내 계정에 적용된 조건을 채굴 화면에서 확인하세요.", "/mining"),
    ("scene-money", "불빛이 강해졌는데 돈이 더 들어오나요?", "Mining Reward", "불빛이나 기계 움직임은 화면 표현입니다. 금액을 결정하거나 지급 완료를 뜻하지 않습니다. 확인 전 기록은 정산 뒤 지갑에 반영된 확정 기록과 구분해 주세요.", "/mining"),
    ("basket", "ETF 테마를 고르면 여러 자산에 투자하나요?", "Product", "아니요. 묶음 개념을 표현한 가상 장면이며 실제 투자 포트폴리오가 아닙니다. ETF와 구성 종목을 매수하거나 소유하지 않습니다. 지수 수익률이나 배당이 채굴보상으로 들어오지 않습니다.", "/products"),
    ("crypto", "비트코인 테마에서 BTC를 받나요?", "Wallet", "테마 이름만으로 그 코인을 받는 뜻은 아닙니다. 외부 네트워크에서 실제 코인을 채굴하는 화면도 아닙니다. 받을 수 있는 금액과 종류는 실제 공개된 이용 조건과 지갑의 확정 기록을 확인하세요.", "/products"),
    ("funding-rail", "USDT 입금이 있으면 USDT 채굴 상품도 있나요?", "Deposit", "입출금 방식과 채굴 상품은 별개입니다. 지원되는 입출금 방식이 같은 이름의 채굴 상품을 자동으로 만들지 않습니다. USDT 입금은 실제 안내된 전송 방식과 반영 조건을 확인하고 진행하세요.", "/wallet/deposit"),
    ("availability", "상품이 보이는데 선택할 수 없어요.", "Troubleshooting", "설명이 공개되어도 대상, 적용 시각, 일시 중지 상태에 따라 선택할 수 없을 수 있습니다. 상품 안내를 먼저 읽어 주세요. 같은 요청을 반복하지 말고, 안내가 분명하지 않으면 화면과 발생 시각을 고객지원에 알려 주세요.", "/products"),
    ("retire", "새 선택이 중지되면 내 기록도 없어지나요?", "Principal", "새 선택 중지와 기존 기록은 별개입니다. 기존 이용·정산·거래 기록에 미치는 영향은 해당 변경 공지와 내 실제 기록을 확인해야 합니다. 중지라는 표시만으로 환급이나 추가 지급이 생겼다고 판단하지 마세요.", "/events"),
    ("slots", "상품을 두 개 고르면 한도가 두 배인가요?", "Mining", "슬롯 수와 전체 주기 한도는 다릅니다. 상품 수만큼 전체 한도를 반복해서 더하지 않습니다. 어떤 조건이 내 계정에 적용되는지 실제 채굴 안내에서 확인해 주세요.", "/mining"),
    ("spacex-rumor", "상장 소문이 있는 테마는 언제 나오나요?", "Event", "소문이나 이름만으로 출시 시각을 정하지 않습니다. 확인과 승인 후 실제 공지에서 안내한 상품만 확인해 주세요. 공개되지 않은 상품을 이유로 미리 송금하거나 외부 링크에서 예약하지 마세요.", "/events"),
    ("revision", "새 상품 설명이 이전 기록에도 적용되나요?", "Mining", "새 안내가 모든 기록에 소급 적용되는 것은 아닙니다. 적용 시각과 기존 이용 영향은 변경 공지 및 실제 채굴 상태를 확인해 주세요. 이전 기록을 새 속도 안내와 단순 비교해 금액을 계산하지 않습니다.", "/events"),
    ("bonus-scene", "장면이 바뀌면 Bonus를 받나요?", "Bonus", "장면 변경만으로 Bonus가 생기지 않습니다. Bonus는 별도 승인된 대상·기간·조건과 실제 지급 기록으로 확인합니다. 이벤트를 읽거나 장면을 바꾸었다는 이유로 보상을 확정하지 마세요.", "/events"),
    ("hold-theme", "테마를 바꾸면 출금 보류가 풀리나요?", "Hold", "아니요. 테마 변경과 출금 검토는 별개입니다. 기존 출금 신청 내역의 안내를 확인하고 필요한 자료만 공식 고객지원으로 제출하세요. 보류를 풀기 위한 외부 송금은 하지 않습니다.", "/wallet/withdraw"),
    ("release-push", "새 상품 알림이 오면 이미 선택된 건가요?", "Notification", "알림은 안내이며 상품 선택 완료가 아닙니다. 연결된 화면에서 공개 여부와 적용 조건을 확인하세요. 알림을 받거나 읽었다는 이유로 금액이 지급되거나 계정 조건이 바뀌지 않습니다.", "/notifications"),
    ("brand-security", "기업 로고가 있는 링크에서 가입해도 되나요?", "Security", "이름이나 로고만으로 공식 서비스나 제휴를 판단하지 마세요. 퍼뜩의 공식 화면에서 직접 안내를 확인합니다. 다른 링크에 비밀번호·인증 코드·개인 키를 입력하지 마세요. 의심스러운 연락은 공식 고객지원으로 확인합니다.", "/support"),
    ("support-context", "상품 설명이 헷갈리면 무엇을 보내나요?", "Support", "어떤 상품 안내의 어느 부분이 어려웠는지, 화면과 확인 시각을 알려 주세요. 개인정보는 가리고 비밀번호·인증 코드·개인 키는 보내지 않습니다. 확인되지 않은 금액을 직접 계산해 확정할 필요는 없습니다.", "/support"),
]

SUPPORT = [
    ("ownership", "실제 자산 소유 문의", "문의하신 테마는 가상 채굴 주제를 설명합니다. 실제 주식·ETF·금속·코인을 매수하거나 보유하는 뜻이 아닙니다. 기업·운용사와의 제휴도 뜻하지 않습니다. 어느 화면의 표현이 헷갈리셨는지 알려 주시면 해당 안내를 확인하겠습니다.", "읽은 화면 문구만 확인. 법적 상품 분류 결론을 상담자가 추가하지 않음."),
    ("speed", "속도와 한도 문의", "속도와 주기 한도는 다른 조건입니다. 빠른 속도만으로 받을 수 있는 총액이 자동으로 늘지 않습니다. 문의하신 계정에 실제 적용된 안내를 확인하겠습니다. 확인할 화면과 시각을 알려 주세요. 지금 확인되지 않은 금액이나 완료 시각은 말씀드리지 않겠습니다.", "계정·policy·유효시각 확인 후 답변. 제안 배율을 붙여 넣지 않음."),
    ("availability", "선택 불가 문의", "상품 설명과 선택 가능 여부는 다를 수 있습니다. 문의하신 화면과 발생 시각을 알려 주시면 대상·적용 시각·중지 여부를 확인하겠습니다. 같은 요청을 반복하지 않아도 됩니다. 비밀번호와 인증 코드는 보내지 마세요.", "실제 선택 command 부재를 회원에게 구현 완료로 설명하지 않음."),
    ("scene", "움직임과 금액 불일치 문의", "장면의 불빛과 움직임은 금액의 확정 여부를 뜻하지 않습니다. 채굴의 확인 전 기록과 지갑의 확정 기록을 따로 확인하겠습니다. 화면과 발생 시각을 알려 주세요. 개인정보는 가려 주시고 같은 거래 요청은 반복하지 마세요.", "진짜 잔액 readback 없이 정상·오류·보상 지급을 확답하지 않음."),
    ("retire", "새 선택 중지 문의", "새 선택 중지와 기존 이용 기록은 별개입니다. 안내된 적용 시각과 내 기록에 미치는 영향을 확인하겠습니다. 문의하신 상품 안내와 해당 내역을 알려 주세요. 확인 전에는 환급·추가 보상·기록 삭제 여부를 확답하지 않겠습니다.", "기존 session/ledger 보존과 실제 변경 영수증 확인. 환급을 대신 실행하지 않음."),
    ("etf", "ETF 배당 문의", "퍼뜩의 ETF 테마는 묶음 개념을 표현하는 가상 장면입니다. 실제 ETF나 구성 종목을 매수·보유하는 뜻이 아니며 배당·분배금이 채굴보상으로 반영되지 않습니다. 추가로 헷갈리는 설명을 알려 주시면 확인하겠습니다.", "ETF 계약·법무 승인 전 공개 답변 금지."),
    ("rumor", "SpaceX·새 상품 소문 문의", "현재 공개된 공지에서 확인할 수 있는 상품만 안내드립니다. 소문을 근거로 출시 시각이나 선택 가능 여부를 약속하지 않습니다. 새 상품을 이유로 외부 링크에서 예약하거나 별도 송금하지 마세요. 확인된 안내가 나오면 공식 화면에서 확인할 수 있습니다.", "SPCX 상장/비상장을 기억으로 단정하지 않음. 실제 확인된 공개 항목만 전달."),
    ("hold", "테마 변경과 출금 보류 문의", "테마 변경과 출금 검토는 별개입니다. 기존 출금 신청의 안내를 확인하겠습니다. 필요한 자료는 공식 상담에서 최소한으로 요청하며 비밀번호·인증 코드·개인 키는 받지 않습니다. 보류 해제를 위해 외부 송금을 하지 마세요.", "출금 해제·승인을 실행하거나 약속하지 않음. 담당 승인 절차로 연결."),
]

NOTIFICATIONS = [
    ("product-release", "새 테마 안내가 있습니다", "공개된 상품 설명과 적용 조건을 확인해 주세요. 알림은 상품 선택 완료를 뜻하지 않습니다.", "/products", "EVENT"),
    ("product-delay", "테마 공개 일정 안내", "테마 공개 안내가 변경되었습니다. 확인된 일정과 이용 가능한 대안은 공지에서 읽어 주세요.", "/events", "NOTICE"),
    ("product-paused", "상품 선택 상태 안내", "상품의 선택 가능 상태가 변경되었습니다. 대상과 적용 시각을 상품 안내에서 확인해 주세요.", "/products", "NOTICE"),
    ("product-retired", "새 선택 중지 안내", "테마의 새 선택 중지와 기존 이용 영향은 공지에서 확인해 주세요. 금액은 내 기록에서 따로 확인합니다.", "/events", "NOTICE"),
    ("speed-policy", "채굴 조건 변경 안내", "속도 조건의 적용 시각과 기존 이용 영향을 확인해 주세요. 주기 한도와 속도는 다릅니다.", "/mining", "NOTICE"),
    ("theme-guide", "테마 이름 읽는 방법", "테마 이름은 실제 자산 매수나 소유를 뜻하지 않습니다. 상품 설명을 먼저 읽어 주세요.", "/products", "NOTICE"),
    ("scene-guide", "장면과 금액 안내", "빛과 움직임이 금액을 확정하지 않습니다. 확인 전 기록과 확정 기록을 구분해 주세요.", "/mining", "NOTICE"),
    ("product-support", "상품 문의 답변 안내", "공식 고객지원에서 문의 답변을 확인해 주세요. 확인되지 않은 금액과 이용 조건은 답변으로 확정하지 않습니다.", "/notifications", "SUPPORT"),
]


def base_metadata(route, label):
    return {"audience": "MEMBERS", "cta": {"label": label, "route": route},
            "approval": {"required": True, "status": "PENDING", "approved_by": None},
            "economy": {"impact": "NONE", "policy_status": "NOT_APPLICABLE", "values": {}},
            "publication_gate": "REVIEW_REQUIRED", "registration_ready": False,
            "legal_copy_status": "LEGAL_COPY_REQUIRED", "variables": [],
            "required_phrases": [], "source_baseline": "0a7e95ba8bf55539fe32fd6f4654ee49a0be226d"}


def build():
    old_events, old_notices = read("events"), read("notices")
    additions = []
    for slug, title, route, label, body, risk, scene in EVENT_ADDITIONS:
        slug = "catalog-event-" + slug
        meta = base_metadata(route, label)
        meta.update(card_title_ko=title, body_markdown=body, segment="ALL_MEMBERS",
            start_condition="원고·법무·실제 대상·일정·렌더 확인 후 사람이 승인", end_condition="승인된 종료 또는 cancel receipt 확인",
            schedule={"starts_at": None, "ends_at": None, "timezone": "Asia/Seoul", "status": "SCHEDULE_REQUIRED"},
            participation="설명 읽기; 입금·상품 선택·문의 생성 불필요", exclusion="미승인·미공개·사용 불가 기능을 실제 참여 대상으로 안내하지 않음",
            scene_brief=scene, notification_copy=title + " 안내를 읽어 주세요. 추가 보상은 없습니다.",
            kpi={"definition": "실제 승인된 공지 노출/도움말 클릭 및 관련 오해 문의의 확인 가능한 집계", "target": None, "measurement": "집계 계약 없음: UNKNOWN"},
            operator_note="보상 없는 교육 안내. reward rule/0원 reward를 만들지 않음. 본문·CTA 저장 계약 확인 필요.",
            rollback="기존 command cancel/archive와 노출·예약 중지 readback. 기존 기록 삭제 금지.", abuse_risk=risk,
            registration_kind="INFORMATIONAL_CAMPAIGN_PROPOSAL")
        additions.append({"slug": slug, "storage": {"slug": slug, "title_ko": title, "summary_ko": body.split("\n")[0][:220],
                          "status": "DRAFT", "starts_at": None, "ends_at": None, "published_at": None}, "metadata": meta})
    event_rewrites = {
        "event-phishing-check": "내 계정의 로그인 정보와 변경 안내를 확인하세요. 비밀번호는 다른 서비스와 함께 쓰지 않습니다. 낯선 로그인이나 변경을 발견하면 공식 고객지원으로 알려 주세요.\n\n입금 안내는 로그인한 퍼뜩 화면에서 직접 확인합니다. 문자나 메신저에 적힌 계좌·지갑 주소를 그대로 따라 송금하지 마세요. 출금 해제나 보상 수령을 이유로 별도 송금을 요구하면 중단합니다.\n\n상담에서도 비밀번호·인증 코드·개인 키를 보내지 않습니다. 화면을 공유할 때 개인정보를 가려 주세요. 이 확인 자체의 추가 보상은 없습니다.",
        "event-offline-guide": "앱을 닫았다고 화면 움직임이 보상을 만들거나 멈추는 것은 아닙니다. 실제 처리는 내 계정에 적용된 조건과 서비스 상태에 따릅니다.\n\n다시 접속한 뒤 채굴의 최신 기록과 지갑의 확정 기록을 구분해 확인하세요. 오래 갱신되지 않으면 공지와 고객지원 안내를 확인합니다. 안내를 읽는 것만으로 추가 보상은 없습니다.",
        "event-cycle-guide": "채굴 화면에서 내 주기의 시작·종료와 적용 조건을 확인하세요. 가입일이나 입금 신청일만으로 주기를 계산하지 않습니다.\n\n상품 수와 슬롯 수만큼 전체 한도를 반복해서 더하지 마세요. 추가 입금이 새 주기를 자동으로 시작하는 것도 아닙니다. 적용 정보가 보이지 않으면 같은 요청을 반복하지 말고 고객지원으로 문의하세요.",
        "event-pending-verified": "채굴 화면의 확인 전 기록은 아직 정산이 끝나지 않은 상태입니다. 실제 정산 뒤 지갑에 반영된 확정 기록을 따로 확인해 주세요.\n\n장면의 불빛·다시 접속·알림 수신이 금액을 확정하지 않습니다. 확인 전 금액을 지갑 잔액과 더하거나 바로 출금 가능한 금액으로 생각하지 마세요.",
        "event-capacity-policy-review": "속도는 진행 속도이고 주기 한도는 적용되는 전체 범위입니다. 빠르게 보인다고 받을 수 있는 총액이 자동으로 늘지 않습니다.\n\n여러 상품을 이용해도 상품 수만큼 전체 한도를 더하지 않습니다. 내 적용 조건은 채굴 화면의 실제 안내로 확인하세요. 아직 승인되지 않은 숫자나 장면 표현을 혜택으로 사용하지 마세요.",
    }
    event_merges = {"event-product-read": "catalog-event-theme-reading", "event-account-safety": "event-phishing-check",
                    "event-security-reminder": "event-phishing-check"}
    event_reasons = {
        "event-phishing-check": "계정 안전/안전한 상담 2개를 통합한 전체 원고. 외부 송금 거절과 낯선 계정 변경·상담정보 최소화를 함께 유지.",
        "event-offline-guide": "화면/실제 처리 구분은 유지하고 재접속 후 확인 경로를 명확화. 무조건 지급 문구 금지.",
        "event-cycle-guide": "주기 의미 유지, global capacity를 슬롯별 중복 계산하지 않는 설명 추가.",
        "event-pending-verified": "정산 과정과 실제 지갑 반영을 구분. 상품 장면과 함께 읽어도 확정 잔액 오인 방지.",
        "event-capacity-policy-review": "상품별 속도 제안 이후 혼동 방지. 기존 POLICY_VALUE_REQUIRED gate는 그대로 보존.",
        "event-product-read": "새 자산 소유/제휴/시장가격 교육 안내에 통합하여 같은 목적 노출 중복 방지.",
        "event-account-safety": "비밀번호/낯선 로그인 안내를 피싱 캠페인에 통합. 보안 내용을 삭제하지 않음.",
        "event-security-reminder": "기존 피싱 캠페인과 내용 중복. 계정 안전 내용과 함께 통합 제안.",
        "event-support-practice": "연습 참여용 상담 문의는 실제 운영 큐에 부담. 도움말/지원 공지로 안내하고 이벤트 노출 제외 제안.",
    }
    keep_event_reasons = {
        "event-welcome-tour": "입금 없는 첫 화면 안내와 별도 보상 없음이 명확.", "event-start-guide": "체험·실제 지갑 분리와 입금 불필요 경계 유지.",
        "event-phishing-check": "공식 입금 화면 확인과 외부 송금 거절이 핵심; 합쳐진 보안 내용도 포함 필요.",
        "event-wallet-tour": "원금·보상·Bonus를 실제 출금 조건과 구분.", "event-krw-ready": "입금 신청/송금/반영 차이를 설명하며 재신청 방지.",
        "event-usdt-ready": "주소·네트워크 오송금 위험과 수동 검토를 설명.", "event-withdraw-ready": "본인 확인·받는 곳·신청/완료 구분 유지.",
        "event-hold-guide": "보류와 실패·완료 차이, 자료 최소 제출 설명.", "event-notification-tour": "알림과 거래 완료 차이 유지.",
        "event-notification-choice": "선호 선택과 내역 확인을 분리; 출시 전 실제 설정 QA gate 필요.",
        "event-read-notices": "공지 읽음을 이벤트 참여/보상으로 오인하지 않음.", "event-status-check": "장애 중 재요청 금지 및 복구 뒤 개별 거래 확인.",
        "event-update-check": "재접속 전 작성 내용 보호, 보안정보 요청 거절.", "event-browser-readiness": "관찰 피드백이며 모든 기기 지원 약속 없음.",
        "event-theme-choice": "색상 선택과 경제 조건 독립; 실제 theme 기능 QA 필요.", "event-accessible-guide": "천천히 읽는 안내와 금전 보상 없음으로 고령 이용자 부담 완화.",
        "event-transaction-history": "신청/반영 시각과 실제 거래 기록 확인.", "event-privacy-check": "문의 개인정보 최소화와 권리 안내.",
        "event-weekend-guide": "미확인 처리 시간을 약속하지 않음.", "event-maintenance-ready": "점검 전 요청 결과 확인과 반복 금지.",
        "event-launch-feedback": "실제 불편만 지원으로 수집, 금전 유인 없음.", "event-welcome-policy-review": "입금 강제 금지와 전환 적격성 분리; 기존 경제 승인 gate 유지.",
    }
    event_review, event_delta = [], []
    for original in old_events:
        slug = original["slug"]
        decision = "REWRITE" if slug in event_rewrites else "MERGE" if slug in event_merges else "DROP" if slug == "event-support-practice" else "KEEP"
        assert slug in event_reasons or slug in keep_event_reasons
        event_review.append({"slug": slug, "title_ko": original["storage"]["title_ko"], "decision": decision,
            "reason_ko": event_reasons.get(slug, keep_event_reasons.get(slug)), "merge_into": event_merges.get(slug),
            "existing_body_sha256": hashlib.sha256(original["metadata"]["body_markdown"].encode()).hexdigest(),
            "economic_effect": original["metadata"]["economy"]["impact"],
            "operation_status": "PROPOSED_NOT_EXECUTED", "retains_historical_records": True})
        if decision == "REWRITE":
            x = json.loads(json.dumps(original)); x["metadata"]["body_markdown"] = event_rewrites[slug]
            x["metadata"]["change_reason"] = event_reasons[slug]; x["metadata"]["registration_ready"] = False
            event_delta.append(x)
    # Preserve final stored slug during rewrites; merge/drop are actions for
    # operator review, never automatic deletion or publication.
    write("content-delta/events-additions.json", additions)
    write("content-delta/events-rewrites.json", event_delta)
    notice_additions = []
    for slug, title, summary, body, variables, route in NOTICE_ADDITIONS:
        meta = base_metadata(route, "안내 확인"); meta["variables"] = variables
        if slug == "speed-policy-review":
            meta["economy"] = {"impact": "POLICY_EXPLANATION", "policy_status": "POLICY_VALUE_REQUIRED", "values": {}}
        meta.update(template=bool(variables), schedule_status="EFFECTIVE_TIME_REQUIRED" if variables else "REVIEW_REQUIRED",
                    operator_note="실제 승인값·적용 시각·대상만 채움. 미지원 metadata를 rule_payload에 숨기지 않음.")
        notice_additions.append({"slug": "catalog-notice-" + slug,
            "storage": {"slug": "catalog-notice-" + slug, "title_ko": title, "summary_ko": summary,
                        "body_markdown": body, "status": "DRAFT", "is_pinned": False, "published_at": None, "expires_at": None},
            "metadata": meta})
    notice_bodies = {
        "notice-introduction": "퍼뜩은 가상 채굴 주제와 이용 기록을 확인하는 서비스입니다. 처음이라면 START 체험과 도움말부터 읽어 주세요. 체험 기록과 실제 지갑은 구분됩니다.\n\n테마 이름과 장면은 실제 주식·ETF·금속·코인의 매수나 소유를 뜻하지 않습니다. 기업·운용사와의 제휴를 뜻하지 않습니다. 시장가격이 채굴보상을 결정하지 않습니다.\n\n장면의 움직임이 금액을 확정하지 않습니다. 실제 이용 조건과 정산·지갑 기록을 확인해 주세요.",
        "notice-products-mining": "상품 화면에서 현재 공개된 설명과 이용 조건을 확인하세요. 상품 설명이 보여도 대상이나 적용 시각에 따라 지금 선택할 수 없는 경우가 있습니다.\n\n테마 이름과 그림은 실제 주식·ETF·금속·코인을 매수하거나 보유한다는 뜻이 아닙니다. 기업 제휴나 시장가격·배당의 반영을 뜻하지 않습니다.\n\n속도와 주기 한도는 다릅니다. 장면 효과가 강해져도 한도나 확정 금액이 자동으로 늘지 않습니다. 안내를 이해하지 못했다면 선택 전에 도움말이나 고객지원을 확인하세요.",
        "notice-mining-cycle": "채굴 주기는 내 계정에 적용된 시작과 종료를 사용합니다. 가입일이나 입금 신청일로 직접 계산하지 마세요.\n\n추가 입금이나 재접속이 새 주기를 자동으로 시작하지 않습니다. 상품 수와 슬롯 수만큼 전체 주기 한도를 더하지 않습니다. 주기 한도와 속도는 별도 조건입니다.\n\n주기 종료 후 남은 한도가 자동 지급된다고 생각하지 마세요. 소액 누적 기록과 남은 한도도 다릅니다. 내 적용 상태와 실제 정산 기록을 확인하고, 안내가 없으면 고객지원으로 문의해 주세요.",
        "notice-pending-verified": "확인 전 기록은 아직 정산을 마치지 않은 상태입니다. 바로 출금할 수 있는 확정 잔액이 아닙니다.\n\n정산 뒤 실제 처리 기록을 통해 지갑에 반영된 확정 금액을 확인합니다. 화면 불빛, 재접속, 알림 수신만으로 금액이 확정되지 않습니다.\n\n지연되면 공지와 내역을 확인하세요. 확인 전 기록을 지갑 잔액과 더하거나 중복 보상을 기대하지 마세요.",
    }
    notice_reasons = {
        "notice-introduction": "상품 확장에 맞춰 가상 테마와 실제 자산·제휴·시장 연동 경계를 보강. 법무 검토 필요.",
        "notice-products-mining": "새 ETF/산업 테마에도 적용되는 설명/선택 구분과 속도/용량 독립성 추가.",
        "notice-mining-cycle": "global capacity/slot 중복 오인 방지와 잔여 한도·소액 carry 의미를 구분.",
        "notice-pending-verified": "Pending→정산→지갑 확정 구분을 단순 한국어로 명확화.",
    }
    keep_notice_reasons = {
        "notice-official-open": "실제 기능 확인 gate가 있으며 오픈 시각·혜택을 임의 확정하지 않음.",
        "notice-account-login": "번호 사용 가능 여부를 문자/소유 인증으로 오인하지 않음.", "notice-security-phishing": "공식 입금 안내와 보안정보 미제공 경계.",
        "notice-wallet-terms": "원금·보상·Bonus·보류와 출금가능 금액 구분.", "notice-principal-reward-bonus": "세금액 원천·자격 증가 오인 방지; wallet 공지와 목적이 달라 유지.",
        "notice-krw-deposit": "신청/송금/반영 차이 및 재요청 방지.", "notice-usdt-deposit": "네트워크/주소 확인과 실제 검토·원화 반영 분리.",
        "notice-withdrawal": "원화 잔액 기반 USDT 출금, 신청/실행 분리.", "notice-withdrawal-hold": "보류와 거절·송금 완료 분리, 미확인 처리시각 약속 없음.",
        "notice-notifications": "푸시 동의와 거래 완료를 분리; 실제 fanout 구현 gate 유지.", "notice-support": "실제 문의 정보 최소화와 미확인 운영시간 약속 없음.",
        "notice-scheduled-maintenance": "시간/영향 변수와 재요청 금지; 실제 값 확인 전 DRAFT.", "notice-urgent-maintenance": "확인 사실·다음 안내·종료 미정 분리.",
        "notice-incident": "관찰 현상과 원인/거래 영향 미확인 경계.", "notice-recovery": "기능 복구와 모든 거래 완료가 다름.",
        "notice-update": "회원 행동·작성 내용 보호·실제 적용 시간 변수.", "notice-policy-change": "전후 차이·기존 회원 영향·동의 내용 변수; 승인 필요.",
        "notice-privacy-change": "권리 행사/정확한 승인 route 필요; 법무 gate 유지.", "notice-browser-devices": "지원 범위를 실제 출시 QA로 한정, 모든 기기 보장 없음.",
        "notice-known-limitations": "현재 영향·대안·다음 안내를 확인된 사실로만 작성.", "notice-start-conversion": "체험/실제 전환 분리·입금 불필요 경계.",
        "notice-event-participation": "대상/기간/승인 보상/취소를 설명; 상품 공지와 목적 다름.",
    }
    notice_review, notice_delta = [], []
    for original in old_notices:
        slug = original["slug"]; decision = "REWRITE" if slug in notice_bodies else "KEEP"
        assert slug in notice_reasons or slug in keep_notice_reasons
        notice_review.append({"slug": slug, "title_ko": original["storage"]["title_ko"], "decision": decision,
            "reason_ko": notice_reasons.get(slug, keep_notice_reasons.get(slug)), "merge_into": None,
            "existing_body_sha256": hashlib.sha256(original["storage"]["body_markdown"].encode()).hexdigest(),
            "operation_status": "PROPOSED_NOT_EXECUTED", "retains_historical_records": True})
        if decision == "REWRITE":
            x = json.loads(json.dumps(original)); x["storage"]["body_markdown"] = notice_bodies[slug]
            x["metadata"].update(change_reason=notice_reasons[slug], legal_copy_status="LEGAL_COPY_REQUIRED", registration_ready=False)
            notice_delta.append(x)
    write("content-delta/notices-additions.json", notice_additions)
    write("content-delta/notices-rewrites.json", notice_delta)
    write("content-delta/faq-additions.json", [{"slug": "catalog-help-" + s, "title_ko": q, "body_ko": a,
        "category": c, "metadata": base_metadata(r, "관련 안내 보기"), "status": "DRAFT"} for s, q, c, a, r in FAQ])
    write("content-delta/support-additions.json", [{"slug": "catalog-support-" + s, "title_ko": t, "body_ko": b,
        "operator_note_ko": n, "metadata": base_metadata("/notifications", "알림 확인"), "status": "DRAFT",
        "review_before_send": True} for s, t, b, n in SUPPORT])
    write("content-delta/notifications-additions.json", [{"slug": "catalog-notification-" + s,
        "storage": {"category": {"EVENT": "events", "NOTICE": "service", "SUPPORT": "service"}[c], "title_ko": t, "body_ko": b, "route": r, "expires_at": None},
        "metadata": {**base_metadata(r, "안내 보기"), "channels": ["IN_APP", "WEB_PUSH"],
            "user_id": None, "source_event_id": None, "deduplication_key": None, "scheduled_at": None,
            "fanout_status": "APPROVED_DELIVERY_COMMAND_REQUIRED", "push_opt_in_required": True,
            "publication_is_delivery": False, "critical_override": False,
            "delivery_policy": "인앱 기록 먼저. 실제 푸시 동의·수신 선택·조용한 시간·cooldown·cap·재시도 dedup을 승인된 command가 검증. 발송 receipt 없으면 UNKNOWN.",
            "trigger_evidence": "실제 승인된 상품/공지/지원 답변 상태와 버전별 domain event readback 필요",
            "sensitive_data": "회원 이름·잔액·계좌·주소·risk 사유·거래 식별자를 push에 포함하지 않음"}} for s, t, b, r, c in NOTIFICATIONS])
    research = json.loads((ROOT / "evidence/research-sources.json").read_text())["sources"]
    benchmarks = [{"category": x["purpose"].removeprefix("BENCHMARK_"), "source_id": x["id"], "url": x["requested_url"],
                   "accessed_at": None, "observed_pattern": None, "verification_status": "ACCESS_BLOCKED",
                   "putduk_review_basis": "REPOSITORY_AND_EDITORIAL_REVIEW_NOT_OBSERVED_EXTERNAL_PATTERN"}
                  for x in research if x["purpose"].startswith("BENCHMARK_")]
    report = {"schema_version": 1, "frozen_ref": FROZEN, "public_benchmark_completed": False,
        "benchmarks": benchmarks, "event_review": event_review, "notice_review": notice_review,
        "event_counts": {**dict(collections.Counter(x["decision"] for x in event_review)), "ADD_MISSING": len(additions)},
        "notice_counts": {**dict(collections.Counter(x["decision"] for x in notice_review)), "ADD_MISSING": len(notice_additions)},
        "delta_counts": {"events_additions": len(additions), "events_rewrites": len(event_delta),
                         "notices_additions": len(notice_additions), "notices_rewrites": len(notice_delta),
                         "faq_additions": len(FAQ), "support_additions": len(SUPPORT), "notifications_additions": len(NOTIFICATIONS)}}
    write("event-notice-benchmark.json", report)
    write("content-delta/review-actions.json", {"status": "PROPOSED_NOT_EXECUTED", "actions": [x for x in event_review + notice_review if x["decision"] in ["MERGE", "DROP"]],
        "never_delete_historical_records": True, "registration_ready": False})
    body = "# 기존 출시 콘텐츠 개별 감사\n\n기준은 동결 launch-content SHA " + FROZEN + "다. 30개 이벤트와 26개 공지 각각의 본문을 읽었다. 승인·일정·실제 feature gate는 KEEP여도 자동 통과가 아니다. 외부 공식 벤치마크 7분야는 403으로 읽지 못해 완료되지 않았다. 외부 패턴을 관찰했다고 쓰지 않았다.\n\n"
    for title, entries, counts in [("이벤트", event_review, report["event_counts"]), ("공지", notice_review, report["notice_counts"])]:
        body += "## " + title + "\n\n" + json.dumps(counts, ensure_ascii=False) + "\n\n| 기존 slug | 판정 | 이유 | 통합 대상 |\n|---|---|---|---|\n"
        for x in entries: body += "| " + x["slug"] + " | " + x["decision"] + " | " + x["reason_ko"] + " | " + (x["merge_into"] or "—") + " |\n"
        body += "\n"
    body += "새 콘텐츠는 content-delta에만 작성했다. 보상 없는 교육 이벤트 10개, 공지 8개, FAQ 16개, support 8개, notification 8개다. 기존 5개 이벤트와 4개 공지의 전체 수정 본문만 별도 파일로 보관했다. 보안 MERGE의 실제 통합 본문도 event-phishing-check rewrite에 포함했다. publisher 준비 후 원고·링크·예약 중지·역사 보존을 preview하고 승인해야 한다. DROP은 운영 노출 제외 제안이며 삭제 실행이 아니다.\n\n"
    body += "광범위한 기본 가입/입출금/보안/점검/장애 템플릿은 동결 패키지에 충분히 있어 복제하지 않았다. 기존 FAQ 68개와 매크로 28개는 보존한다. 신규 FAQ는 테마/실제 자산·속도/한도·장면/정산·ETF·retire 오해를 다룬다. 새 값·돈·대상·날짜를 채운 실제 등록/발송은 하지 않았다.\n\n"
    body += "이벤트 storage에는 full body/CTA/audience 필드가 없고 일정 NOT NULL이다. 지금 null 일정은 안전한 초안이며 insert-ready 행이 아니다. 공지 상세 본문이 목록에 전부 렌더되는 계약도 미확인이다. 알림 user/source/dedup은 실제 domain command가 정해야 하며 초안 slug를 DB user_id처럼 쓰지 않는다.\n"
    (ROOT / "EVENT-NOTICE-GAP-REVIEW.md").write_text(body)
    print(json.dumps({"events": report["event_counts"], "notices": report["notice_counts"], "delta": report["delta_counts"]}))


if __name__ == "__main__":
    build()
