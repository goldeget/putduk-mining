"""Generate review artifacts from the actual Tier-aware proposal and evidence."""
import collections
import json
import pathlib
import subprocess

ROOT=pathlib.Path(__file__).resolve().parent
read=lambda name:json.loads((ROOT/name).read_text())
frac=lambda value: f"{value['numerator']}/{value['denominator']}"


if __name__ == "__main__":
    candidates=read("product-candidates.json");economy=read("product-economy-proposal.json")
    eligibility=read("product-tier-eligibility.json");simulation=read("economy-simulation-results.json")
    launch=read("launch-catalog-proposal.json");cmap={p['proposal_id']:p for p in candidates['candidates']}
    lmap={p['proposal_id']:p for p in launch['products']}
    matrix="| Product | Ticker | Asset | Wave | Grade | Personality | Speed | Min Tier | Capacity | Market linked | Scene family | Legal | Research | Policy |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n"
    for p in economy['products']:
        c=cmap[p['proposal_id']];l=lmap[p['proposal_id']]
        matrix+=f"| {p['product_name_hint_ko']} | {c['canonical_ticker'] or (c['ticker_hint'] or 'UNKNOWN')+' (HINT)'} | {c['asset_class']} | {c['proposed_wave']} | {p['grade']} | {p['personality_ko']} | {p['proposed_product_speed_multiplier']} | {p['minimum_funding_tier']} | INHERIT_TIER_CAPACITY | false | {l['scene_family_proposal']} | {c['legal_brand_review']} | {c['identity_status']} | PROPOSED_NOT_APPROVED |\n"
    (ROOT/'PRODUCT-ECONOMY-MATRIX.md').write_text("# 최종 조건부 25개 경제·Tier Matrix\n\n단일 추천은 Policy A + Funding Tier gate + inherited global capacity + product speed, 1.00–1.10. 전부 PROPOSED_NOT_APPROVED이고 approved speed는 null이다. Tier gate는 승인/구현되지 않았으며 원화 문턱을 상품에 복사하지 않는다. market_linked=false, 상품/slot별 capacity 증가 없음. HINT는 확인된 canonical ticker가 아니다. Grade는 가상 편성이며 증권/기업 등급이 아니다.\n\n"+matrix)
    table="| Tier | 인정 원금 범위: 승인 SSOT 참조 | Slots | 선택 수 | 신규 테마 | 최고 속도 | 최고속 선택지 | 다음 단계 |\n|---|---|---|---|---|---|---|---|\n"
    rows=simulation['comparison_bands'][0]['tiers']
    for t in rows:
        lo,hi=t['principal_range_krw_from_ssot_only']
        table+=f"| {t['tier']} | {lo}–{hi or '∞'} | {t['slots_from_ssot']} | {t['available_product_count']} | {', '.join(t['newly_unlocked'])} | {t['fastest_speed']} | {', '.join(t['fastest_products'])} | {t['next_unlock'] or '최종 단계'} |\n"
    bands="| 제안 Band | 최단 base-cap 도달: 정규화 | 최종 1.50 headroom | 중간 modifier cap 적용 상품 수 | 승인 문서 band 변경 |\n|---|---|---|---|---|\n"
    for b in simulation['comparison_bands']:
        bands+=f"| {b['name']} | {frac(b['fastest_days_to_cap'])}일 | {frac(b['fastest_headroom'])} | {b['moderate_stack_capped_count']} | {b['approved_document_band_change_required']} |\n"
    top=rows[-1]
    (ROOT/'TIER-PROGRESSION-ANALYSIS.md').write_text("# Tier-aware 선택 폭과 편중 분석\n\nNORMALIZED_INDEX_ONLY, 실제 수익/지급액 예측이 아니다. 승인 SSOT 14단계의 남은 인정 원금 범위와 slot을 그대로 참조했다. 아래 금액은 상품별 문턱이 아니라 정책 참조 표이며 회원 홍보 원고에 사용하지 않는다. live effective_from은 UNKNOWN이다. 각 비교는 해당 Tier의 accessible_product_set에만 적용한다. 모든 회원이 25개 전부 선택한다는 가정은 제거했다.\n\n"+table+"\n## 선택 폭\n\nL1은 4개, L2–L8은 매 단계 2개 추가, L9–L10은 1개, L11은 2개, L12–L14는 1개 추가다. 모든 단계가 이전 선택을 포함한다. 해금 0인 단계는 없지만 L9/L10 최고속은 이미 L8과 같고 L12–L14도 1.10보다 올라가지 않는다. 마지막 단계의 보상 우위를 새로 만들지 않는다. 최고 단계에는 서로 다른 5개 personality가 같은 최고속으로 배치된다. 실제 산업군은 반도체/메모리·모빌리티·우주에 집중돼 모든 자산군을 고르게 대표한다고 볼 수 없다.\n\nL1은 한국 금융/ETF/귀금속, 미국 단일 기업은 L3부터, crypto는 L7부터 열린다. 초기 모든 자산군을 의무 제공하지 않지만 삼성전자(L6)/BTC(L9) 같은 익숙한 테마가 뒤에 있어 입문자 박탈감을 만들 수 있다. 높은 승인 SSOT 원금 구간에서만 새 산업 장면을 제공하는 이 배치는 과도한 입금 유도 위험이 있다. 단계 상승을 홍보/보상 목표로 만들지 않고, 먼저 현재 선택 가능한 상품을 안내한다. OWNER는 접근성·적은 금액의 선택 폭·상품 수/scene 예산을 검토해야 한다. 이 편집 배치는 승인 전이며 gate 확대를 위해 임의 경제 혜택을 붙이지 않는다.\n\nL11–L14는 기존 slot 5/retention 2500bps가 같고 새 테마 외에는 추가 혜택을 주장하지 않는다. 현재 미확인 자료가 있는 P1 조건부 상품을 제거하면 실제 공개 선택 수가 줄어든다. 표는 25개 가정이며 launch-ready 수가 아니다. 자격 미확인·법무·Scene 실패 상품은 여전히 effective HOLD다. 미공개 해금 예고/과장 숫자 노출 금지.\n\n## 구간 비교\n\n"+bands+"\n비교 modifier는 product × 1.15 user × 1.10 event × 1.05 temporary의 가상 시나리오다. 현재 runtime effect scope를 입증하지 않는다. 1.18은 11개에서 최종 cap에 닿아 이벤트/임시 효과의 추가 여지가 소모된다. 1.10은 기존 승인 band 안이고 최고와 최저의 시간 차이를 좁혀 편중 인센티브를 줄인다. 1.12/1.18은 POLICY_VERSION_CHANGE_REQUIRED이며 1.10도 새로운 Tier gate와 효과 scope 때문에 별도 policy version 승인이 필요하다.\n\n각 Tier/각 band의 최저·최고·평균·평균 대비 최고·시간 차이·headroom·top pool·자산군은 JSON 42행에 유리수로 보존했다. base capacity index는 하나의 global 100이며 product/slot마다 복제되지 않는다. retention은 별도 조건부 승인 항목으로 이 정규화 표에 합치지 않았다.\n\n## 편중 전후\n\n과거 24개 unrestricted 모형의 1.18 NVIDIA 단독 최고는 전체 접근 가능이라는 역사적 가정이었다. 현재 실제 회원 선택 비율이 아니다. 이번에는 L1 top 3, L2–L8 top 2, L9 top 3, L10 top 4, L11 top 2, L12 top 3, L13 top 4, L14 top 5다. 상위 Tier의 NVIDIA 한 개가 속도 면에서 유일한 최선이라는 구조는 제거했다.\n\n그러나 speed-only 모형은 여전히 top pool 전체를 선택하고 낮은 속도 테마를 경제적으로 지배한다. 동점 상품을 균등 선택한다고 가정하면 L14 개별 1/5이나, 이는 측정치도 예측치도 아니다. ACTUAL_USER_CONCENTRATION_UNKNOWN. 무작위 금액·숨은 bonus/capacity·특정 테마 강제·불이익으로 다양성을 만들지 않는다. 출시 뒤 동의된 aggregate 선택/지원/중단 데이터를 보고 별도 수정안을 검토한다.\n\n## 하향 변경\n\n추천 B: 서버의 정확한 조건 변경 시각부터 자격 없는 선택만 PAUSE, 자동 대체 없이 새 slot/allocation을 확인한다. 원금 HOLD는 기존 PAUSE_NOT_RESET 우선이다. cycle/age/verified ledger/history/used/carry는 보존하고 reduced capacity를 넘으면 새 발생만 중지한다. release 뒤 소급 catch-up을 만들지 않는다. 모든 결과는 read-only proposal이고 실제 엔진 변경은 Primary/승인 정책의 권한 흐름으로만 가능하다.\n")
    (ROOT/'ECONOMY-MODEL-COMPARISON.md').write_text("# 경제 모델 비교와 단일 추천\n\n추천: **Policy A + Tier gate + inherited global capacity + product speed / 1.00–1.10**. 모든 값은 승인 전이며 runtime 적용/운영 수익 근거가 아니다.\n\n| Model | 속도 | Capacity | 결론 |\n|---|---|---|---|\n| A | 상품별 1.00–1.10, Tier별 accessible pool | 승인 Tier global cycle 상속 | 단일 추천; gate/effect scope 새 policy 승인 필요 |\n| B | 상품별 차이 | 상품마다 별도 capacity | payable ceiling을 바꾸므로 추천하지 않음; 구현/등록하지 않음 |\n| C | 모두 1.00, 성격만 다름 | 승인 Tier global cycle 상속 | 속도 우위 제거 비교용; 최종 추천 아님 |\n\n"+bands+"\n1.10은 승인 문서 product 0.90–1.10 안에 있지만 아직 non-default effect scope/자격 contract가 없어 활성화할 수 없다. 1.12와 1.18은 기존 band도 바꾸므로 별도의 POLICY_VERSION_CHANGE_REQUIRED. Grade/기업 유명세/시세는 경제 근거가 아니다. 두 개 50% slot에서 1.10과 1.10을 선택해도 rate=1.10, 한도=global100, 200이 아니다. 세부 비교는 TIER-PROGRESSION-ANALYSIS.md와 JSON을 읽는다.\n\n제품×사용자×이벤트×임시 효과는 정확한 유리수 곱 후 최종 한 번 1.50 제한 제안. 기존 campaign 15000 cap이 전체 scope 구현을 입증하지 않는다. 1.20×1.15×1.10=1.518→1.50이며, 1.18×1.20×1.25×0.80은 중간 cap 없이 1.416으로 유지해야 한다. Primary가 portion/priority/effective interval/source changes와 안전한 정산 연결을 검증해야 한다. 이 lane은 backend·ledger를 수정하지 않는다.\n")
    (ROOT/'ECONOMY-SIMULATION.md').write_text("# 오프라인 Tier-aware 시뮬레이션\n\n`node catalog-ops/economy-simulate.mjs`는 JSON의 25개 proposal/승인 SSOT/Tier profiles를 읽어 3 bands × 14 tiers를 계산한다. BigInt 정수 bps와 numerator/denominator, fractional carry/최종 cap 로직을 사용한다. capacity normalized100, 실제 KRW 예측 없음. 매 Tier의 eligible IDs/선택 수/top/평균/spread/시간차이/headroom/다음 해금/slot/cap 인센티브를 저장한다.\n\n"+bands+"\n기존 108개 baseline regression은 8f68be2의 exact 입력으로 보존했으며 새 연구/Tier 검증은 현재 입력으로 별도 실행한다. 소스 해시·실제 인용·SEC row·P0 상태·상속 자격·하향 PAUSE·duplicate/invalid tier·원화 문턱 금지·cap headroom을 검증한다. PASS_OFFLINE_SIMULATION은 정책 승인, live publication, wallet verified 금액, 실제 browser 렌더, 제품 완료를 뜻하지 않는다.\n")
    gaps=dict(status="BLOCKED_SCENE_PRODUCT_QA_REQUIRED",frozen_scene_ref="505e20c097be8de1b5d02bc65a2dcbd054fe56d1",
              proposed_product_count=25,new_specs_required=sum(cmap[p['proposal_id']]['repo_status']=='NOT_IN_REPOSITORY' for p in economy['products']),
              product_browser_acceptance_required=25,desktop_masters_generated=0,mobile_masters_generated=0,
              requirements=[dict(slug=p['slug'],requirements=p['scene_requirements'],approved_desktop_master=None,approved_mobile_master=None) for p in launch['products']])
    (ROOT/'evidence/scene-gap-final.json').write_text(json.dumps(gaps,ensure_ascii=False,indent=2)+'\n')
    review=read('event-notice-benchmark.json')
    review['benchmark_observation_scope']='HISTORICAL_8F68BE2_BLOCKED_ATTEMPTS_NOT_CURRENT_CONNECTIVITY_STATUS'
    (ROOT/'event-notice-benchmark.json').write_text(json.dumps(review,ensure_ascii=False,indent=2)+'\n')
    (ROOT/'EVENT-NOTICE-GAP-REVIEW.md').write_text("# 보존한 감사와 Tier 추가\n\nFrozen launch branch ba9ed931f756488ce4f67f945cffad9552842c09은 변경하지 않았다. 이벤트 21 KEEP / 5 REWRITE / 3 MERGE / 1 DROP / ADD10, 공지22 KEEP /4 REWRITE /ADD8 결론을 보존한다. 이번 Tier delta는 이벤트1/공지4/FAQ6/지원3/알림4만 추가한다. 최종 추가 패키지 총합은 이벤트11/공지12/FAQ22/지원11/알림12이며 rewrite 수는 그대로다. 삭제/병합은 아직 실행하지 않았고 기존 이력을 삭제하지 않는다.\n\n7개 benchmark의 ACCESS_BLOCKED annotation은 과거 8f68be2 조사 snapshot이다. 이번 실제 네트워크 접근과 동일한 상태라고 해석하지 않는다. 현재 사이트의 UX 패턴을 다시 감사했다고 주장하지 않는다. 세부 새 한국어 원고는 TIER-CONTENT-DELTA.md, 기계 등록 구조는 content-delta/*.json. 정책 승인/공개 상태/회원 자격/event receipt 확인 전 알림을 보내지 않는다.\n")
    (ROOT/'evidence/finalize-summary.json').write_text(json.dumps(dict(
        continuation_start_sha='8f68be2005e16f1ac257626b3418cd3b8a96f1e3',base_sha=candidates['base_sha'],
        identity_counts=read('evidence/research-sources.json')['status_counts'],
        wave_counts=dict(collections.Counter(p['proposed_wave'] for p in candidates['candidates'])),
        approved_speed_count=0,eligibility_count=len(eligibility['products']),tier_count=14,
        recommendation=economy['recommendation'],speed_band=economy['recommended_band'],
        policy_approval_ready=False,primary_review_ready=True,production_ready=False,
        actual_user_concentration='UNKNOWN',scene_gaps=gaps),ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'matrix':len(economy['products']),'tier_analysis':len(rows),'scenario_tier_rows':sum(len(b['tiers']) for b in simulation['comparison_bands'])}))
