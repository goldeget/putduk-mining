# 상품 접근권과 Funding Tier — Owner 최종 교정

기준: 2026-10-07 사용자의 `OWNER POLICY CORRECTION` 원문. 현재 Phase 2
후보와 시각 검증을 보존하며 즉시 적용한다. 기존 승인 manifest와 원본
승인 문서의 digest를 변경하지 않는다. 원격 적용·배포 승인이 아니다.

## 상품 접근권

Funding Tier는 상품을 해금하거나 잠그지 않는다. 적격 회원은 실제
published/available인 모든 상품 중에서 선택할 수 있다. L1도 NVIDIA,
Tesla, SpaceX, SK hynix, BTC, ETF, Gold를 같은 가용성 계약으로 선택한다.
이 목록은 접근권 예시이며 공개 catalog를 React에 하드코딩하는 지시가 아니다.

```text
Eligible Principal
→ Funding Tier
→ Mining Power / Capacity / Entitlement / Slot Count
→ Product Selection
→ Product Modifier
→ User / Event / Temporary Modifiers
→ Final 1.50x Cap Once
→ Reward Producer → Pending → Settlement → Verified
```

Tier는 원금 기반 mining scale, 서버 mining power, capacity/entitlement,
승인된 slot 수와 Tier 경제혜택을 정한다. Product는 상품별 personality,
Scene/visual identity, 승인된 speed modifier와 experience를 정한다.
동시 선택 수 제한은 slot 계약이며 개별 상품 접근권 제한이 아니다.

상품 잠금·비활성 사유는 authoritative unpublished/paused/maintenance/
unavailable 또는 account/security eligibility여야 한다. API/UI는 이를
Funding Tier 미달로 바꾸지 않는다. 특정 상품에 최소 Tier/원금을 붙이거나
"이 상품은 L13부터 해금됩니다", "원금이 부족해 NVIDIA를 선택할 수 없습니다"
같은 안내를 만들지 않는다. 운영상 가용 상태와 회원 적격 상태를 분리한다.

## Tier speed — 현재 SSOT와 엔진 판정

`economy-v1-approved-2026-10-03.json`은 공통 `baseCycleRateBps`와 원금
구간별 retention/slots를 승인한다. `domain/mining/funding-entitlement.ts`의
`conditions`는 적격 원금 × 공통 base rate로 `fullBaseSpeedPerCycle`를
계산한다. 현재 default SQL producer도 서버 원금·공통 base bps·경과시간을
소비한다. 별도의 Tier base-speed 데이터는 없다.

따라서 현재 `TIER_SPEED_CONTRACT_REQUIRED`의 판정은 **원금 비례 기본
accrual이 이미 Tier mining power를 표현한다**이다. Tier 번호나 Scene에서
두 번째 속도 배수를 생성하지 않는다. 별도 Tier speed를 추후 도입하려면
명시적인 새 승인 rule/version과 서버 연결 증거가 필요하다. 화면은 서버
snapshot을 표시하고 브라우저에 권위 있는 경제 공식을 복제하지 않는다.

## Capacity와 modifiers

- `GLOBAL_CYCLE` capacity/entitlement를 보존한다. 상품 수·slot 수로
  capacity를 곱하거나 각 상품에 full capacity를 지급하지 않는다.
- catalog proposal의 상품 배수 범위 **1.00x~1.10x**는
  **PROPOSED_NOT_APPROVED**다. 기존 정책 validator의 허용 범위는 개별
  상품 배수의 승인·게시 증거가 아니다. 현재 neutral runtime의 1.00x를
  제안값으로 교체하지 않는다.
- product modifier는 시장 수익률·주가와 연동하지 않으며 서버가 승인된
  version에서 소비한다. 기존 global allocation 상품 weight를 먼저
  적용하고 product/user/event/temporary speed를 정확한 정수 비율로
  결합한 뒤 최종 BASE speed에 1.50x cap을 한 번만 적용한다.
- capacity와 원금 유지 혜택은 speed 배수 및 speed cap과 독립이다.
  중간 반올림·개별 상품별 cap으로 최종 합성을 바꾸지 않는다.

## Tier 하락·원금 HOLD

Tier 하락은 상품 자체를 선택 불가로 만들지 않는다. 미래 원금 기반 경제,
capacity와 slots만 새 Tier 기준으로 평가한다. history/mining age/cycle/
used/carry/Verified ledger를 보존하고 과거 보상을 삭제하지 않는다.
`used >= new capacity`이면 남은 capacity는 0이며 used를 깎지 않는다.

원금 HOLD는 **PAUSE_NOT_RESET**이다. 보류된 portion의 유지 자격 시간만
멈추고 기존 age를 보존한다. 취소 후 미래 시간부터 재개하며 보류 기간은
제외하고 소급 보상하지 않는다. 같은 lot의 부분 회수 순서는 기존
[승인 계약](ECONOMY-V1-USER-APPROVAL-2026-10-06.md)을 유지한다.

## 현재 구현과 남은 서버 gate

현재 member catalog/card와 allocation 입력에는 상품별 Tier 필드가 없다.
현재 SQL 명령은 게시 영수증·available 상태·승인 neutral rule을 검사하고,
Tier는 전체 선택 수의 slot 한도로만 소비한다. 기존 정책과 native migration
증거를 바꾸지 않고 이 분리를 보존한다.

**`TIER_DOWNGRADE_SLOT_POLICY_REQUIRED`는 아직 열려 있다.** 현재
`app_private.assert_prospective_allocation`은 새 slot 수보다 많은 기존
allocation을 거절한다. 이 거절은 결정적 유지/pause 정책의 구현 증거가
아니다. 후속 서버 변경은 다음을 한 원자적 전이로 증명해야 한다.

1. 회원 직렬화와 서버 effective instant에서 이전 구간을 기존 조건으로 마감.
2. 승인된 새 Tier slots로 유지/pause 대상을 안정적인 저장 순서로 결정.
   DB 반환 순서·브라우저 순서·상품 Tier 조건으로 결정하지 않는다.
3. 상품 접근권·원래 allocation/session 이력은 보존하고 pause 이유는
   slot 감소로 구분. paused weight를 자동으로 다른 상품에 재배분하지 않는다.
4. 기존 cycle/used/carry/ledger/lot age를 보존하고 미래 snapshot·revision·
   audit/outbox·idempotent replay에 같은 결정을 고정.
5. 실제 여러 slot→한 slot 하락, HOLD/CANCEL, 동률 순서, 동시 변경,
   재시도/worker/정산을 isolated native DB에서 검증.

이 문서는 미구현 전이를 성공으로 표시하거나 불변 원본/검증 fingerprint를
바꾸는 수단이 아니다. 새 migration에는 별도의 실제 native 증거가 필요하다.

## 병렬 작업

Secondary corrected catalog package:
`parallel/catalog-product-ops@33d87fe1772d53dcff2feddd4df54c986054ea57`.
필요한 경우 같은 승인 repository에서 읽기 전용으로 참조한다. 현재
Primary UI/UX 작업에 merge하지 않는다. Admin presentation 소유권을
유지하고 공통 backend/security 계약은 Primary가 담당한다.
