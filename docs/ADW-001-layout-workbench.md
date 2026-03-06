좋아요. 이제 방향을 하나로 고정할게요.

**우리는 “OpenCode plugin + 별도 로컬 웹페이지(sidecar UI)” 구조로 갑니다.**
즉, OpenCode 안에 새 패널을 억지로 넣는 게 아니라, OpenCode의 **custom command + custom tool + plugin hook**을 써서 로컬 웹페이지를 열고, 거기서 단계별 의사결정을 진행한 뒤 결과를 다시 현재 OpenCode 세션으로 돌려주는 방식이에요. OpenCode 공식 문서는 플러그인을 이벤트 훅과 커스텀 툴 중심으로 설명하고 있고, 커스텀 명령은 `.opencode/commands/`나 config에서 정의할 수 있어요. 또 플러그인 함수는 `client`, `directory`, `worktree`, `$` 같은 컨텍스트를 받고, 커스텀 툴도 `@opencode-ai/plugin`으로 추가할 수 있어요. ([OpenCode][1])

이 방향을 택하는 이유도 분명해요.
OpenCode는 실행 시 TUI 뒤에서 HTTP 서버를 같이 띄우고, 그 서버는 OpenAPI와 SDK를 통해 프로그램적으로 다룰 수 있어요. 반면 공식 플러그인 문서에는 “플러그인이 TUI에 지속적인 커스텀 패널을 추가한다”는 식의 UI API는 보이지 않아요. 그래서 **플러그인은 orchestration**, **웹페이지는 rich UI**, **OpenCode 세션은 AI 백엔드**로 역할을 나누는 게 가장 현실적이에요. 커뮤니티의 Plannotator 플러그인도 비슷하게 명령을 감지해 별도 리뷰 UI를 열고, 사용자의 결정을 받은 뒤 다시 OpenCode 세션으로 피드백을 보내는 흐름을 택하고 있어요. ([OpenCode][2])

1. 이번 버전에서 만들 것과 만들지 않을 것부터 고정할게요.

만드는 것은 이거예요.

* `/layout` 명령으로 시작하는 레이아웃 의사결정 워크벤치
* 별도 브라우저 페이지에서 단계별 결정
* 각 단계마다 ASCII box 프리뷰
* 즉시 보이는 규칙 기반 추천
* 완료 시 OpenCode 세션으로 결과 요약 복귀
* `.opencode/plans/`와 별도 세션 JSON 저장

이번 버전에서 일부러 안 만드는 것은 이거예요.

* OpenCode TUI 안의 커스텀 패널
* 다중 브랜치 비교 UI
* IDE별 통합
* 처음부터 AI가 모든 추천을 실시간 생성하는 구조

이렇게 자르는 이유는, 공식적으로 바로 기대할 수 있는 건 **plugin hooks, commands, tools, server/client**이고, 그 위에 웹 UI를 얹는 편이 구현 리스크가 가장 낮기 때문이에요. 특히 `plan` 계열 흐름은 코드 수정 없이 계획과 분석에 쓰도록 설계돼 있고, `.opencode/plans/*.md`는 예외적으로 다룰 수 있어서 이번 기능과 잘 맞아요. ([OpenCode][3])

2. 진입 방식은 “custom command → custom tool → sidecar UI”로 갑니다.

여기서 중요한 결정은 **이벤트 훅으로 `/layout`을 가로채는 방식이 아니라**, `/layout` 명령이 LLM에게 **반드시 `layout_open_workbench` 툴을 호출하게 만드는 방식**으로 간다는 점이에요.
OpenCode는 커스텀 명령을 `.opencode/commands/*.md`로 정의할 수 있고, 커스텀 툴은 `@opencode-ai/plugin`으로 제공할 수 있어요. 이 둘을 조합하면 사용 흐름이 아주 단순해져요. `/layout`을 실행하면, 명령 프롬프트가 먼저 현재 요청을 정리하고, 곧바로 `layout_open_workbench` 툴을 호출해 로컬 웹페이지를 띄워요. 툴은 사용자가 완료할 때까지 대기한 뒤, 최종 선택 결과를 문자열/JSON 요약으로 반환해요. 그다음 OpenCode 응답이 “선택된 레이아웃, 이유, 다음 단계”를 정리해주면 돼요. ([OpenCode][4])

명령 파일은 이렇게 두면 돼요.

```md
# .opencode/commands/layout.md
---
description: 단계별 레이아웃 의사결정 워크벤치 열기
agent: plan
---

현재 요청에 맞는 UI 레이아웃을 단계적으로 결정해야 해요.

사용자 목표:
$ARGUMENTS

반드시 `layout_open_workbench` 툴을 즉시 호출해서
외부 의사결정 워크벤치를 먼저 열어요.

툴이 반환되기 전에는 레이아웃을 임의로 확정하지 말아요.
툴이 반환되면 아래를 간단히 정리해요.
1. 최종 조합
2. 왜 이 조합이 적절한지
3. 남은 결정 사항
```

이렇게 `agent: plan`을 쓰는 이유는, 공식 문서상 plan은 `write`, `edit`, `patch`, `bash`가 기본적으로 제한돼 있어서 “코딩으로 샛길 새는 것”을 막기 좋아서예요. ([OpenCode][4])

3. 파일 구조는 “로컬 플러그인으로 먼저 검증”하는 형태가 가장 좋아요.

OpenCode는 로컬 플러그인을 `.opencode/plugins/`에서 자동 로드하고, 로컬 명령은 `.opencode/commands/`에서 읽어요. 로컬 플러그인과 도구는 `.opencode/package.json`에 의존성을 선언하면 OpenCode가 시작 시 Bun으로 설치해줘요. 그래서 배포 전에 먼저 **프로젝트 로컬 플러그인**으로 검증하는 게 제일 빠르고 안정적이에요. ([OpenCode][1])

추천 구조는 이거예요.

```text
.opencode/
  package.json
  commands/
    layout.md
    layout-resume.md
    layout-export.md
  plugins/
    layout-workbench.ts
    lw-types.ts
    lw-store.ts
    lw-graph.ts
    lw-reducer.ts
    lw-score.ts
    lw-ascii.ts
    lw-server.ts
    lw-browser.ts
    lw-ai.ts
  plans/
    layout/
  layout-workbench/
    sessions/
    exports/
    ui/
      index.html
      assets/...
```

여기서 역할은 이렇게 나눠요.

* `layout-workbench.ts`: OpenCode plugin entry
* `lw-server.ts`: 로컬 HTTP 서버
* `lw-browser.ts`: 브라우저 열기
* `lw-graph.ts`, `lw-reducer.ts`: decision-core
* `lw-ascii.ts`: ASCII renderer
* `lw-ai.ts`: AI commentary/recommendation 호출
* `layout-workbench/sessions/`: 진행 중 세션 저장
* `plans/layout/`: 최종 markdown 산출물

나중에 npm 플러그인으로 배포할 때는 `plugin` 배열에 패키지명을 넣는 방식으로 옮기면 돼요. 다만 공식 문서는 **플러그인 로딩**과 **커스텀 명령 정의**를 별개로 설명하고 있어서, 배포판에서도 `/layout` 같은 명령은 설치 스니펫이나 보조 config가 같이 필요하다고 보는 게 안전해요. ([OpenCode][1])

4. decision-core는 단순하게 갑니다. 이번 버전은 “브랜치”보다 “순차 진행 + 이력”에 집중해요.

V1에서 필요한 상태는 이 정도면 충분해요.

```ts
type StageId = "shell" | "left" | "center" | "right" | "final";

interface WorkbenchDraft {
  shell: {
    mode: "three-column" | "two-column-right-drawer" | "center-focus";
    widths: { left: number; center: number; right: number };
  };
  left: {
    primary?: "tree" | "sections" | "tabs";
    secondary: Array<"filters" | "presets" | "history">;
  };
  center: {
    primary?: "cards-first" | "preview-first" | "split";
    secondary: Array<"ascii-preview" | "diff-view" | "detail-form">;
  };
  right: {
    primary?: "commentary" | "decision-log" | "inspector";
    secondary: Array<"recommendation" | "risks" | "a11y-notes">;
  };
}

interface DecisionEvent {
  nodeId: string;
  selectedOptionIds: string[];
  at: string;
}

interface WorkbenchSession {
  id: string;
  opencodeSessionId: string;
  brief: string;
  currentStage: StageId;
  draft: WorkbenchDraft;
  answers: Record<string, string[]>;
  history: DecisionEvent[];
}
```

핵심은 `draft`보다 `history`예요.
사용자가 원한 건 “완성된 UI만”이 아니라 “내가 어떤 결정을 했는지”였죠. 그래서 **결정 이력 자체가 1급 데이터**여야 해요. 현재 초안은 `history`를 replay해서 재생성할 수 있어야 하고, 오른쪽 패널의 로그도 이걸 그대로 보여주면 돼요.

질문 그래프도 이번 버전은 8개로 고정하세요.

* `shell.mode`
* `left.primary`
* `left.secondary`
* `center.primary`
* `center.secondary`
* `right.primary`
* `right.secondary`
* `final.review`

이렇게 작게 잡아야 sidecar UI, ASCII renderer, export까지 빨리 묶을 수 있어요.

5. ASCII renderer는 “예쁘게”보다 “항상 동일하게”가 핵심이에요.

웹페이지에서 보여줘도 렌더러는 순수 함수로 두세요.

```ts
renderPreview(draft, { width: 100, charset: "unicode" })
renderOptionPreview(draft, patch, { width: 60 })
renderDiff(currentDraft, candidateDraft, { width: 100 })
```

규칙은 이 7개면 충분해요.

1. 폭 preset은 `80 / 100 / 120`만 둬요.
2. 기본 문자셋은 Unicode box drawing, fallback은 `+-|`예요.
3. pane 최소 폭은 12예요. 그보다 작으면 `collapsed`로 보여줘요.
4. 항상 `left -> center -> right` 순서로 그려요.
5. 텍스트는 잘라내고 `…` 또는 `...`로 끝내요.
6. 각 pane 내부 줄은 최대 4줄만 보여줘요.
7. diff는 “현재안 / 추천안” 두 장만 보여줘요.

예시는 이런 식이면 돼요.

```text
┌────────────────────── Workbench ──────────────────────┐
│ Mode: three-column                                    │
├──────────────┬────────────────────────────┬───────────┤
│ Left         │ Center                     │ Right     │
│ Tree         │ Decision Cards             │ UX Notes  │
│ Filters      │ ASCII Preview              │ Reco      │
│ Presets      │ Diff View                  │ Log       │
└──────────────┴────────────────────────────┴───────────┘
```

그리고 옵션 카드 안에도 미니 프리뷰를 같이 두세요.
예를 들어 `center.primary = split` 후보를 보여줄 때, 카드 우측에 작은 ASCII 미리보기를 넣으면 사용자는 “설명”보다 “형태”를 먼저 이해해요.

6. sidecar 웹페이지는 브라우저가 OpenCode 서버를 직접 치지 않게 설계하는 게 좋아요.

OpenCode 서버는 브라우저 origin 허용을 위해 `--cors` 설정을 따로 받아요. 또 TUI는 자체 서버를 뒤에 두고 돌아가고, 그 서버는 OpenAPI와 `/tui` 엔드포인트를 제공해요. 하지만 이번 플러그인에서는 **브라우저가 OpenCode 서버를 직접 호출하지 않게** 하는 게 더 단순하고 안전해요. 브라우저는 오직 **plugin이 띄운 localhost sidecar 서버**만 보고, 그 서버가 `ctx.client`나 OpenCode SDK를 통해 실제 OpenCode와 통신하면 돼요. 이렇게 하면 CORS, 인증, 현재 TUI 포트 노출 문제를 크게 줄일 수 있어요. ([OpenCode][2])

웹 구조는 이렇게 잡으면 돼요.

* 좌측: 단계 네비게이터
* 중앙: 질문 카드 + ASCII 프리뷰 + 후보 비교
* 우측: 추천 / 트레이드오프 / 결정 로그

API는 최소 이 정도면 돼요.

```text
GET  /api/session/:id
POST /api/answer
POST /api/recommend
POST /api/export
POST /api/complete
```

보안은 꼭 이렇게 두세요.

* `127.0.0.1`에만 바인딩
* 랜덤 포트
* 세션별 one-time token
* idle timeout 후 자동 종료
* 브라우저는 sidecar만 호출
* OpenCode session ID는 브라우저에 최소한으로만 노출

그리고 브라우저 자동 열기는 플러그인에서 외부 패키지를 써도 돼요. 로컬 플러그인도 `.opencode/package.json`에 의존성을 선언할 수 있고 OpenCode가 설치해줘요. ([OpenCode][1])

7. AI 추천은 처음부터 “전부 AI”로 가지 말고, 2단계로 나누세요.

이 부분이 중요해요.
사용자가 한 단계씩 고를 때마다 추천이 즉시 떠야 하잖아요. 그런데 모든 클릭마다 LLM을 부르면 느리고, 비용도 들고, 결과가 흔들릴 수 있어요. 그래서 추천 체계를 이렇게 나누는 게 좋아요.

**1차 추천: 규칙 기반**

* `three-column`이면 discoverability 가점
* `right commentary + log`면 traceability 가점
* `center split + ascii-preview`면 preview immediacy 가점
* 너무 많은 secondary module이면 complexity 패널티

**2차 코멘터리: AI 기반**

* 현재 노드가 안정되었을 때만 호출
* 또는 사용자가 “AI 설명 보기”를 눌렀을 때만 호출
* 결과는 `why`, `tradeoffs`, `risks`, `bestFor` 정도의 좁은 JSON만 받아요

OpenCode는 플러그인에 SDK client를 주고, 서버도 세션 생성/포크, 메시지 전송, 명령 실행 같은 HTTP API를 열어둬요. 그래서 AI 코멘터리는 **현재 세션을 직접 오염시키지 않게** 별도 helper session이나 forked session으로 보내는 방식이 좋아요. 서버는 세션 생성, 세션 포크, 메시지 전송 API를 제공하니까 이 구조가 가능해요. ([OpenCode][1])

여기서 helper session을 쓰는 이유는 단순해요.
메인 세션은 사용자의 작업 맥락을 유지하고, AI 코멘터리용 보조 세션은 “이 노드에서 어떤 선택이 좋은가”만 평가하게 분리하면 로그가 훨씬 덜 지저분해져요.

8. 플러그인 entry와 툴은 아주 작게 시작하세요.

이번 버전에서 plugin hook은 최소만 씁니다.

* `tool.layout_open_workbench`
* `event.session.deleted` → sidecar/session cleanup
* `event.session.compacted` → 저장 갱신 정도만 선택적
* `client.app.log()` → 구조화된 로그

OpenCode 공식 문서는 플러그인이 이벤트를 구독할 수 있고, `client.app.log()`로 구조화 로그를 남기라고 안내해요. 커스텀 툴도 `tool()` 헬퍼와 Zod 스키마로 만들 수 있어요. ([OpenCode][1])

entry 개념은 이 정도예요.

```ts
export const LayoutWorkbenchPlugin: Plugin = async (ctx) => {
  return {
    tool: {
      layout_open_workbench: tool({
        description: "Open the layout decision workbench in a browser and wait for the user's decisions.",
        args: {
          brief: tool.schema.string().describe("What the user wants to design"),
        },
        async execute(args, toolContext) {
          const session = await createWorkbenchSession({
            opencodeSessionId: toolContext.sessionID,
            brief: args.brief,
          });

          const server = await startWorkbenchServer({ session, ctx });
          await openBrowser(server.url);

          const result = await server.waitForCompletion();
          await persistResult(result);

          return formatToolResult(result);
        },
      }),
    },

    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        await cleanupDeletedSession(event);
      }
    },
  };
};
```

이 구조의 장점은 분명해요.
OpenCode에게는 그냥 “도구 하나”로 보이고, 사용자에게는 “별도 웹 워크벤치”로 보여요. 즉, OpenCode의 강점인 명령/세션/툴 체계는 유지하면서, UI는 브라우저에서 자유롭게 만들 수 있어요.

9. 저장 포맷도 지금 정하세요. 나중에 바꾸면 제일 아파요.

저장물은 두 개만 있으면 돼요.

첫째, 이어서 작업하기 위한 JSON 세션.

```text
.opencode/layout-workbench/sessions/<session-id>.json
```

둘째, 사람이 읽는 최종 markdown 계획.

```text
.opencode/plans/layout/<timestamp>-layout-plan.md
```

이렇게 두는 이유는, plan 계열 작업과 자연스럽게 연결하려면 최종 결과가 `.opencode/plans/*.md` 쪽에 있는 게 좋아서예요. 공식 문서상 plan은 `.opencode/plans/*.md` 쪽 계획 문서를 다루는 흐름과 잘 맞아요. ([OpenCode][3])

Markdown에는 최소 이 내용만 내보내세요.

* 사용자 brief
* 최종 레이아웃 조합
* 단계별 선택 이력
* 추천안과 실제 선택의 차이
* 아직 미정인 항목

10. 구현 순서는 이렇게 가면 돼요.

**M1. 로컬 플러그인 부트**

* `.opencode/plugins/layout-workbench.ts`
* `.opencode/commands/layout.md`
* `/layout` 실행 시 툴이 호출되는지 확인

**M2. sidecar 웹페이지**

* localhost 서버
* 브라우저 자동 오픈
* “Hello Workbench” 대신 하드코딩 질문 2개만 먼저

**M3. decision-core**

* 8개 고정 노드
* reducer
* history
* resume

**M4. ASCII renderer**

* 전체 프리뷰
* 옵션 미니 프리뷰
* current vs candidate diff

**M5. export**

* session JSON
* markdown plan
* `/layout-resume`, `/layout-export`

**M6. 추천**

* 규칙 기반 점수 즉시 표시
* AI commentary는 버튼형 또는 debounce형으로 추가

**M7. 패키징**

* 로컬 플러그인 검증 끝난 뒤 npm 패키지화
* 설치 문서에 `plugin` 설정과 command 설정 같이 제공

핵심을 한 줄로 줄이면 이거예요.

**이번 플러그인은 “OpenCode 안에서 모든 UI를 만들기”가 아니라, “OpenCode의 command/tool/session을 트리거로 써서 별도 웹 워크벤치를 여는 플러그인”으로 설계하는 게 맞아요.**
이렇게 해야 ASCII box 기반 단계별 결정, 추천, 이력, 최종 요약이 가장 안정적으로 붙어요. ([OpenCode][1])

[1]: https://opencode.ai/docs/plugins/ "Plugins | OpenCode"
[2]: https://opencode.ai/docs/server/ "Server | OpenCode"
[3]: https://opencode.ai/docs/modes/ "Modes | OpenCode"
[4]: https://opencode.ai/docs/commands/ "Commands | OpenCode"
