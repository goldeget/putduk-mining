# V1 후속 운영 계약 사용자 승인

승인일: 2026-10-06. 기존 [V1 수치 승인](ECONOMY-V1-USER-APPROVAL-2026-10-03.md)을
유지하며 아래 후속 의미를 적용한다. 원본 승인 문서/manifest digest를 바꾸지 않는다.

## 2026-10-06 후속 사용자 승인: 예약 portion과 modifier 범위

이 후속 승인은 앞의 개별 V1 범위/ceiling을 바꾸지 않는다. 설명 예시의
상품1.20x/1.30x는 상품 허용 범위0.90x~1.10x를 확장하는 승인이 아니다.
원격 적용·실채굴 활성화·배포의 승인이 아니다.

원금 hold는 예약된 금액 portion의 retention eligible clock만 중지한다.
해당 portion의 원래 lot age와 이미 누적한 적격 시간, cycle anchor를 보존한다.
release는 그 시점부터 미래 적격 시간을 다시 누적하며 hold 구간은 제외한다.
hold 기간의 유지 혜택을 소급 지급하지 않는다. 부분 hold의 각 portion은
독립적으로 처리하고 영향을 받지 않은 portion의 clock은 계속 진행한다.
부분 회수나 release 때문에 전체 lot age를 초기화하지 않는다.
사용자 승인 예: 원금1,000,000원을20일 유지한 뒤300,000원을3일 hold하면,
700,000원 portion은23일,300,000원 portion은20일을 보존한다. release 이후
300,000원 portion도 미래 시간부터 다시 누적한다.

상품/사용자 multiplier는 기본 채굴(BASE)의 SPEED에만 적용한다.
retention과 Capacity를 늘리지 않는다. 상품·사용자·임시·event 등 적용 가능한
모든 BASE speed modifier는 정확한 정수 비율로 곱한 다음 최종 유효 speed
multiplier를1.50x로 제한한다. 사용자 원문 공식:
`effective_speed = base_speed × min(product_speed × user_speed × temporary_speed × event_speed, 1.50)`.
복수 상품은 승인된 global allocation의 상품 weight를 먼저 적용하고 공통
modifier를 결합한 뒤 전역 BASE speed cap을 한 번 적용한다. 최종 결합 전에 반올림하거나 각 중간 곱셈에서
값을 버리지 않는다. 개별 상품·사용자·campaign 허용 범위는 계속 검증한다.

Capacity는 명시적인 capacity 효과로만 변경하며 기존 개별/동시 ceiling을
보존한다. 유지 혜택은 별도의 승인된 유지 조건을 따르며 채굴 multiplier의
영향을 받지 않는다. 이 승인으로 portion clock과 effect scope의 의미는
확정되었지만 실제 receipt·segment·settlement·worker 연결 증거는 별도다.

## Phase 2 추가 사용자 승인: 동일 lot 내부 부분 회수 순서

사용자 확정 원문:

> 원금 부분 회수 시 lot 선택은 기존과 같이 최근 입금 lot부터 적용한다.
> 동일 lot 내부에 서로 다른 적격 유지기간의 원금 부분이 존재하는 경우,
> 적격 유지기간이 가장 짧은 부분부터 보류한다. 동일한 적격 유지기간을
> 가진 부분 간에는 시스템이 정의한 안정적인 결정적 순서를 적용한다.

기존 lot 선택의 `effective_at DESC`, `recorded_at DESC`, lot ID DESC는
유지한다. 같은 lot 안에서는 잠금으로 직렬화한 서버 effective instant의
적격 누적 유지시간 오름차순으로 부분을 선택한다. 동률은 변경 불가능한
portion ID 오름차순으로 결정한다. 부분을 분할할 때 부모와 원본 이력,
이미 누적한 적격 시간을 보존한다. 보류 기간은 제외하며 해제 이후부터
다시 누적하고, 전체 lot 나이를 초기화하거나 소급 보상하지 않는다.
이 승인은 실제 portion 원본·동시성·정산 검증을 대신하지 않는다.

유지 혜택 계산 기준은 사용자 후속 원문
`maintenance_benefit = eligible_principal × approved_maintenance_rule`이다.
상품 allocation weight는 BASE speed에만 적용하며 유지 혜택의 원금 기준이나
승인된 유지 rule을 줄이거나 늘리지 않는다. 유지 혜택은 조건부이며 원래
cycle/portion의 유지 자격 확인 전에는 확정 잔액으로 지급하지 않는다.
