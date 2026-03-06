---
description: 단계별 레이아웃 의사결정 워크벤치 열기
agent: plan
---

현재 요청에 맞는 UI 레이아웃을 단계적으로 결정해야 합니다.

사용자 목표:
$ARGUMENTS

반드시 `layout_open_workbench` 툴을 즉시 호출해서
외부 의사결정 워크벤치를 먼저 여세요.

질문 목록을 직접 구성해서 tool args의 `questions` 배열로 전달하세요.
각 질문은 사용자의 요청과 맥락에 맞게 type, label, options, dependsOn 등을 설정하세요.

툴이 반환되기 전에는 레이아웃을 임의로 확정하지 마세요.
툴이 반환되면 아래를 간단히 정리하세요:
1. 최종 조합
2. 왜 이 조합이 적절한지
3. 남은 결정 사항
