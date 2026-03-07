# RisuAI Workbench Platform Decision — Final Analysis

> Date: 2026-03-05
> Author: NOEL + AI Analysis (Brainstorm 4-branch + Oracle deep analysis)
> Status: **DECISION DOCUMENT**

---

## 1. Problem Statement

RisuAI 봇 개발자의 현재 워크플로우:
- VSCode/LLM 프로바이더에서 description, Lua, HTML/CSS 작성
- RisuAI에 붙여넣기 후 실제 LLM 호출로 테스트
- 반복적인 컨텍스트 스위칭과 유료 LLM 비용 발생

**핵심 고통점**: 개발 진행도에 대한 가시성(visibility) 부재 — 얼마나 개발했는지, 어디까지 왔는지 파악 불가.

---

## 2. Brainstorm Findings Summary

### 2.1 워크플로우 현실
Mixed workflow — VSCode + LLM 프로바이더 + RisuAI를 오가며 작업. "절반씩 왔다갔다" 패턴.

### 2.2 워크벤치 핵심 기능 우선순위
1. **파이프라인 시뮬레이션**: lorebook 규칙 반영, regex/Lua 변환 적용, 단계별 로그로 실패 지점 특정. 유료 LLM 테스트 비용 절감.
2. **에이전트 호환**: 내장 skill/guidance 프롬프트로 RisuAI 컨텍스트를 반복 설명하지 않아도 되게.
3. **빠른 테스트/검증**: 구문/LSP 체크로 스크립트 정상 동작 즉시 확인.

### 2.3 플랫폼 선호
**Code-OSS fork 방향으로 기울어짐.**
- Hybrid는 현재 워크플로우를 의미있게 개선하지 못한다고 판단
- VSCode Extension UX가 너무 제한적이라고 느낌
- 코딩 에이전트 기반 개발로 높은 개발비용 수용 가능

### 2.4 Core CLI 우선순위
pack/unpack → analyze → simulate_regex → simulate_pipeline → validate → graph

**핵심 비기능 요구**: 확장성 — 플러그인이 아닌 스크립팅/자동화 중심. 기본 워크플로우 외 별도 워크플로우 도입 가능해야 함.

---

## 3. Code-OSS Fork — Reality Check

### 3.1 1인 개발자의 Fork 유지보수 현실

| 영역 | 부담 | 상세 |
|------|------|------|
| **Upstream 동기화** | 극히 높음 | VSCode 월간 릴리스 + 보안 패치. 지속적 merge/rebase 필요 |
| **빌드 파이프라인** | 높음 | Electron, 네이티브 모듈, 플랫폼별 패키징, CI 매트릭스 |
| **멀티플랫폼 배포** | 높음 | Windows 코드 서명, macOS 공증(notarization), Linux 패키지 포맷 |
| **자동 업데이트** | 중간 | 업데이트 서버/채널 운영 필요 |
| **Extension 호환** | 중간 | MS Marketplace 접근 불가 → Open VSX 의존, 일부 확장 비호환 |
| **보안 책임** | 높음 | Electron/Chromium CVE 즉시 대응 의무 |

### 3.2 Cursor/Windsurf와의 비교
Cursor, Windsurf는 "전문 fork"로 **전담 엔지니어링 팀**이 유지보수. 코딩 에이전트가 아무리 강력해도, **아키텍처 결정과 upstream 충돌 해결은 인간의 판단이 필요한 영역**. Fork 유지보수는 "코드 생성"이 아니라 "의사결정의 연속"이기 때문.

### 3.3 Fork가 정당화되는 시점 (Escalation Triggers)
- VSCode의 코어 워크벤치 플로우를 **대체**해야 할 때 (커스텀 레이아웃 모델, 커스텀 탐색기/에디터 동작)
- **완전히 브랜딩된 단일 목적 IDE**가 필요할 때 (VSCode 어포던스 최소화, 윈도우/메뉴 완전 통제)
- Extension 설치 모델이 **수용 불가능한 배포 요구사항**이 있을 때

**현 시점에서 이 중 어느 것도 해당하지 않음.**

---

## 4. "Extension UX가 제한적" — 기술적 현실 vs 인식

### 4.1 현대 VSCode Extension이 할 수 있는 것

| 기능 | 구현 방식 | 워크벤치 적용 |
|------|----------|-------------|
| **전용 Activity Bar** | `viewsContainers` contribution | "RisuAI Workbench" 전용 아이콘 + 사이드바 |
| **풀 Webview 패널** | `WebviewPanel` (본질적으로 Chrome 창) | 파이프라인 시뮬레이터, CBS 에디터, 그래프 뷰 |
| **커스텀 에디터** | `CustomEditorProvider` | .charx 뷰어, .cbs 에디터, lorebook 에디터 |
| **LSP 통합** | Language Server Protocol | CBS 자동완성, 호버 문서, 진단, go-to-definition |
| **Task/Terminal** | Task Provider + Terminal API | simulate, validate, graph 원클릭 실행 |
| **Debug Adapter** | DAP (Debug Adapter Protocol) | 파이프라인 시뮬레이션을 "디버그 세션"처럼 step-through |
| **Virtual Filesystem** | `FileSystemProvider` | 캐릭터 카드 내부를 가상 파일 시스템으로 마운트 |
| **진단 (Problems)** | `DiagnosticCollection` | validate/analyze 결과를 Problems 패널에 표시 |

### 4.2 Extension으로 할 수 없는 것

| 불가능한 것 | 영향 | 대안 |
|------------|------|------|
| 코어 레이아웃 대체 | 에디터 그리드 동작 변경 불가 | Webview 패널 내에서 자체 레이아웃 구현 |
| 윈도우 크롬 커스텀 | 타이틀바/메뉴 변경 불가 | 실질적 영향 미미 |
| 네이티브 메뉴 완전 통제 | 메뉴 항목 추가만 가능 | Command Palette + 키바인딩으로 대체 |
| 단일 목적 IDE 느낌 | VSCode 어포던스가 보임 | 실제 사용 시 워크벤치 모드에 집중하면 문제 없음 |

### 4.3 핵심 통찰

> **"Extension UX 제한"에 대한 불만의 대부분은 실제 기술적 제약이 아니라, Extension이 "작은 사이드바 위젯"이라는 인식에 기반한다.**

풀 Webview 패널은 본질적으로 독립적인 Chrome 창이다. 기존 SvelteKit UI를 그대로 Webview 안에 렌더링할 수 있으며, 여기에 LSP + 진단 + Task 통합이 더해지면 오히려 독립 웹앱보다 **더 강력한** 통합 경험을 제공한다.

---

## 5. Theia — Code-OSS Fork의 현실적 대안

Eclipse Theia는 "커스텀 IDE를 만들기 위한 프레임워크"로, Code-OSS fork와 다른 접근:

| 비교 | Code-OSS Fork | Theia |
|------|:---:|:---:|
| 목적 | 제품을 fork해서 수정 | 프레임워크로 제품 구축 |
| Upstream 추종 | 매월 merge 필요 | 프레임워크 업데이트만 |
| VSCode Extension 호환 | 거의 완전 (Open VSX) | 좋지만 완벽하지 않음 |
| 커스텀 자유도 | 높음 (코어 수정 가능) | 높음 (composition 기반) |
| 배포 복잡도 | 극히 높음 | 높음 (하지만 설계된 것) |
| 유지보수 부담 | 극히 높음 | 중간 |

**만약 "독립 IDE"가 최종 목표라면, Theia가 Code-OSS fork보다 현실적인 선택지.**
하지만 이것도 Phase 0이 아니라 "졸업(graduation)" 단계에서 고려할 사안.

---

## 6. Recommended Architecture: Layered Graduation Model

### 6.1 핵심 원칙

```
┌─────────────────────────────────────────────────────────────────┐
│  "UI는 교체 가능한 클라이언트. Core Engine이 진실의 원천."       │
│                                                                 │
│  어떤 UI를 선택하든, Core가 먼저 존재해야 한다.                  │
│  Fork든 Extension이든 Web이든, Core 없이는 모두 의미 없다.       │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 아키텍처 다이어그램

```
                    ┌──────────────────────────────────────────┐
                    │         risu-workbench-core               │
                    │      (Node.js Library + CLI + Daemon)     │
                    │                                          │
                    │  pack/unpack │ analyze │ simulate │ graph │
                    │                                          │
                    │  Protocol: JSON Lines / RPC               │
                    │  Input: 파일시스템 (manifest + components) │
                    │  Output: artifacts + event log + diag     │
                    └──────┬──────────────┬───────────────┬────┘
                           │              │               │
                    ┌──────▼──────┐ ┌─────▼──────┐ ┌─────▼──────┐
                    │ Coding Agent│ │ VSCode Ext │ │ (Future)   │
                    │ (CLI 직접)  │ │ "Thick"    │ │ Theia/Fork │
                    │             │ │            │ │ if needed  │
                    │ • AGENT.md  │ │ • LSP      │ │            │
                    │ • CLI calls │ │ • Webview  │ │ 동일 Core  │
                    │ • JSON out  │ │ • Custom Ed│ │ 동일 UI    │
                    └─────────────┘ │ • Diag     │ └────────────┘
                                    │ • DAP      │
                                    │ • Tasks    │
                                    └────────────┘
```

### 6.3 Graduation Path

```
Phase 0: Core Engine + CLI          ← 에이전트 즉시 활용 가능
    ↓
Phase 1: "Thick" VSCode Extension   ← 인간 개발자 UX 제공
    ↓
(검증) Extension UX가 실제로 제한적인가?
    ↓
  YES → Phase 2: Theia 기반 독립 IDE (Core + UI 재활용)
  NO  → Extension 계속 발전
```

---

## 7. Phase별 구현 계획

### Phase 0: Core Engine (2-3주)

**목표**: UI 없이 파일 + CLI만으로 완전한 개발/검증 사이클 가능하게.

```bash
# 에이전트/인간 모두 사용 가능
risu-workbench unpack my-card.charx --output ./my-bot/
risu-workbench pack ./my-bot/ --output my-card.charx

risu-workbench analyze ./my-bot/
# → reports/analysis.json (missing links, unused vars, dependency map)

risu-workbench simulate regex --input "test text" --script regex/01-capture.json
# → structured event log (JSON Lines)

risu-workbench simulate pipeline --input "test text" --vars "mode=1,imgtag="
# → step-by-step pipeline trace

risu-workbench validate ./my-bot/
risu-workbench graph ./my-bot/ --format json
```

**핵심 설계 원칙**:
- 모든 출력은 `--format json` 지원 (에이전트/CI 친화적)
- Event log는 versioned schema (UI와 에이전트가 동일하게 소비)
- 확장성: 커스텀 워크플로우를 스크립트로 조합 가능

**우선순위 (brainstorm 결과 반영)**:
1. `pack` / `unpack` — .charx ↔ 프로젝트 변환
2. `analyze` — 변수/의존성 분석, missing link 감지
3. `simulate regex` — 개별 regex + CBS 평가
4. `simulate pipeline` — 전체 파이프라인 시뮬레이션
5. `validate` — 프로젝트 구조 검증
6. `graph` — 의존성 그래프 생성

### Phase 1: Thick VSCode Extension (3-4주)

**목표**: "워크벤치 모드"를 VSCode 안에서 제공. 컨텍스트 스위칭 제거.

| 컴포넌트 | VSCode API | 설명 |
|---------|-----------|------|
| Character Explorer | TreeDataProvider | regex/, lua/, lorebooks/, html/ 트리 뷰 |
| CBS Language Support | LSP + TextMate Grammar | 구문 강조, 자동완성, 호버 문서, 진단 |
| Pipeline Simulator | WebviewPanel (SvelteKit) | 기존 PRD UI를 Webview에 임베드 |
| .charx Viewer | CustomEditorProvider | 카드 구조 시각화 + pack/unpack 연동 |
| Diagnostics | DiagnosticCollection | validate/analyze 결과 → Problems 패널 |
| Run Tasks | TaskProvider | simulate, validate, graph 원클릭 |
| Pipeline Debugger | DAP (optional) | 시뮬레이션을 step-through 디버깅처럼 |

**기존 자산 재활용**:
- SvelteKit UI 컴포넌트 → Webview 패널 내에서 그대로 렌더링
- CBS 에디터 코드 (autocomplete, signature, types) → LSP 서버로 전환
- workbench.svelte.ts 상태 관리 → Extension 상태 + Webview 메시징

### Phase 2: Graduation (필요 시)

Extension UX의 실제 제약이 확인된 경우에만 진행.

**Theia 경로** (권장):
- Core Engine 그대로 사용
- Webview UI 코드 대부분 재활용
- Theia의 composition 모델로 커스텀 레이아웃 구현
- Open VSX 통한 Extension 호환

**Code-OSS Fork 경로** (최후 수단):
- 위 모든 것 + upstream merge 부담 수용
- 코어 워크벤치 동작 변경이 필수적일 때만

---

## 8. 확장성 설계 (핵심 비기능 요구)

brainstorm에서 "플러그인보다 스크립팅/자동화"를 강조했으므로:

```bash
# 커스텀 워크플로우 예시: CI에서 자동 검증
risu-workbench validate ./my-bot/ --format json | jq '.errors | length'

# 커스텀 분석 파이프라인
risu-workbench analyze ./my-bot/ --format json \
  | node my-custom-checker.js \
  | risu-workbench report --input -

# 배치 시뮬레이션
for input in test-cases/*.txt; do
  risu-workbench simulate pipeline --input "$input" --vars vars.json
done | risu-workbench aggregate-results
```

**설계 원칙**:
- Unix 철학: 각 명령이 하나의 일을 잘 하고, 파이프로 조합
- JSON Lines 프로토콜: 스트리밍 + 파싱 용이
- 에이전트가 `AGENT.md`를 읽고 CLI를 호출하는 것만으로 완전한 워크플로우 수행

---

## 9. 에이전트 통합 시나리오

```
에이전트 워크플로우 (Phase 0부터 즉시 가능):

1. AGENT.md 읽음 → 프로젝트 구조 + CLI 명령 이해
2. tstl/modules/newFeature.ts 작성
3. npm run build:lua → dist/bundle.lua 생성
4. risu-workbench validate → 구조 검증 (JSON 결과 파싱)
5. risu-workbench analyze → missing link, 미사용 변수 감지
6. risu-workbench simulate pipeline --input "test" → 파이프라인 검증
7. 결과 확인 → 문제 있으면 수정 반복

→ UI 전혀 불필요. 파일 + CLI만으로 완전한 개발/검증 사이클.
→ 인간은 같은 결과를 VSCode Extension에서 시각적으로 확인.
```

---

## 10. Decision Summary

### 채택: Layered Graduation Model

| 결정 사항 | 선택 | 근거 |
|----------|------|------|
| **아키텍처** | Core Engine First | UI 독립적. 에이전트/CI/인간 모두 동일한 Core 사용 |
| **1차 UI** | Thick VSCode Extension | 컨텍스트 스위칭 제거, 기존 자산 재활용, 검증 후 졸업 가능 |
| **에이전트 전략** | CLI-First | JSON 출력, 파이프 조합, AGENT.md 가이드 |
| **확장성** | 스크립팅/자동화 | Unix 철학, JSON Lines, 파이프라인 조합 |
| **Code-OSS Fork** | 보류 | Extension UX 제약이 실제로 확인된 후 재검토. 그때도 Theia 먼저 |
| **패키지 구조** | Monorepo (core + extension + web-ui) | 코드 공유 극대화 |

### Code-OSS Fork에 대한 입장

> Fork를 완전히 배제하는 것이 아님. **"지금은 아니다"**가 핵심.
>
> Core Engine + Thick Extension을 먼저 구축하면:
> 1. Fork가 정말 필요한지 **데이터 기반으로 판단** 가능
> 2. Fork로 전환해도 Core + UI 코드 **100% 재활용**
> 3. Fork 없이 목표 달성 가능하면 **엄청난 유지보수 비용 절약**
>
> 코딩 에이전트가 코드 생성을 도와줄 수 있지만,
> upstream merge 충돌 해결, 빌드 파이프라인 디버깅, 보안 패치 적용은
> **"코드 생성"이 아니라 "의사결정의 연속"**이다.
> 이 부분은 에이전트가 대체하기 어렵다.

---

## 11. Immediate Next Steps

1. **Core 패키지 구조 설계** — monorepo 셋업 (packages/core, packages/vscode, packages/web-ui)
2. **manifest.json 스키마 정의** — 프로젝트 메타 + 컴포넌트 매핑
3. **pack/unpack 구현** — .charx ↔ 프로젝트 디렉토리 변환 (기존 extract.js 로직 활용)
4. **analyze 구현** — CBS 변수 추적, missing link, 의존성 맵
5. **AGENT.md 업데이트** — CLI 명령 가이드 추가

---

*이 문서는 4-branch brainstorm (워크플로우, 기능 우선순위, 플랫폼 선호, 아키텍처 깊이) + Oracle 심층 분석 (fork reality check, thick extension 역량, Theia 비교, phasing 전략)을 종합하여 작성되었습니다.*
