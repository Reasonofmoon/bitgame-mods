# game-dev-floor — 터미널 안의 픽셀 아트 개발실

## Context
지금 GAME MODE mod 22종은 텍스트와 블록 문자로 그린 HUD와 로그입니다. 사용자는 eojeon(브라우저에 그린 픽셀 아트 궁궐)처럼 **눈으로 즐거운 장면**을 원하지만, 똑같이 만들기는 원하지 않습니다. 원하는 그림은 **개발자들이 일하는 작업공간**입니다.
결정된 사항:
- 등장 인물은 **이 세션의 에이전트**입니다. 메인 Claude는 LEAD 책상에, 서브에이전트는 빈 책상에 앉습니다.
- 그리는 방식은 **반블록 Raster 셀 그림**입니다.
- 로고나 실제 회사, 실제 인물은 그리지 않고 오리지널 캐릭터만 씁니다.

eojeon과는 무엇이 다른가:
- 매체가 터미널 pane입니다. 브라우저도, PTY 서버도 쓰지 않습니다.
- 테마가 현대 개발실입니다.
- 저장소 규칙("모든 요소는 실제 수치를 보여 준다")을 그대로 따릅니다.

## 확인한 기술 근거
API 출처는 plugin-authoring 스킬의 `types/claude-code.d.ts`입니다.
- `Raster` 요소: `columns × rows` 크기의 셀 격자이고, 각 셀은 `[codePoint, fg, bg]` 세 개의 u32 값입니다. 이 값을 base64로 담아 그립니다. 한 번에 1024가지 색 쌍까지 그릴 수 있습니다.
- `$.ui.blit({ requestId, key, cells })`: 화면을 통째로 다시 그리지 않고 그 자리만 갈아 끼웁니다. 초당 120회까지 받고, 실제로 보이는 것은 60프레임 안팎입니다. 반복 실행에는 `$.clock.every(ms, fn)`을 쓰고, 이 함수가 돌려주는 해제 함수로 멈춥니다.
- 반블록 `▀`은 fg가 윗 픽셀, bg가 아랫 픽셀입니다. 그래서 셀 하나가 세로 2픽셀이 됩니다. 72열 × 22행이면 72×44 픽셀 캔버스입니다.
- 사용자가 요청하지 않았는데 pane을 자동으로 여는 것은 144열 이상(한 번 요청한 id는 110열 이상)일 때만 됩니다. 그보다 좁으면 pane은 대기합니다. `/devfloor`로 직접 열면 너비와 상관없이 열립니다.

## 장면 요소와 각자 하는 일 (실제 데이터만)
| 장면 요소 | 보여 주는 실제 값 | 데이터 출처 (기존 패턴 재사용) |
|---|---|---|
| 창밖 하늘 (낮 → 노을 → 밤) | 컨텍스트 남은 %. HUD의 HP와 같은 값 | `session.measure` `e.context.percent` (game-hud와 같음) |
| LEAD 책상의 개발자 | 메인 에이전트가 지금 하는 도구 | `tool.call` (`e.agentId === undefined`) |
| 입장하는 개발자 → 빈 책상 | 서브에이전트 시작과 끝 (CLEAR면 퇴장, FAIL이면 엎드림) | `agent.spawn`, `turn.complete` (game-party와 같음) |
| 모니터 색과 애니메이션 | 도구 종류. Read/Grep/Glob은 파란 스크롤, Edit/Write는 초록 +줄, Bash는 검은 화면과 커서, Web*는 지구본, Agent는 전화 | `e.tool` |
| 모니터가 빨갛게 번쩍 + 연기 | 실패한 호출 (`isError`) | `tool.call` 결과 |
| 천장 경광등 + 경비원 NPC | 가드 거부 (TRAP / BARRIER / LOOP). 문구 `game-<plugin> blocked this call:`로 판정 | `session.append` door `tool-result` (game-battle-log와 같음) |
| 손 든 개발자 + `!` 말풍선 | 지금 사용자의 승인을 기다림 | `tool.check` 결과의 `decision === 'ask'` (game-earcons와 같음) |
| 책상 위 커피잔 개수 | 세션 비용 (단계별, 예: $1마다 한 잔, 최대 5잔) | `session.measure` `e.cost.usd` |
| 서버랙 LED | 요금제 사용량 남은 % | `session.measure` `e.rateLimits` (HUD의 `limitOf` 로직) |
| 조명이 어두워지고 Zzz | 턴이 끝난 뒤 지난 시간 (유휴) | `turn.complete` 시각과 `$.clock.now()` |
| 하단 한 줄 자막 | 지금 동작을 텍스트로. 화면 판독기와 Image가 안 되는 곳용 대체 | 같은 상태 |

순수 장식은 넣지 않습니다. 화분이나 포스터 같은 것은 PR에 이유가 없으면 빼는 것이 원칙입니다.

## 구조
새 plugin `plugins/game-dev-floor/`. 파일은 300줄 안팎으로 나눕니다.
- `.claude-plugin/plugin.json`: name `game-dev-floor`, `types`, userConfig는 `intensity`(off / casual / hardcore), `palette`(game-party와 같은 4종), `autoOpen`, `fps`(기본 12)
- `hooks/hooks.json` → `./register.tsx`
- `hooks/palette.ts`: game-hud 것을 **그대로 복사**합니다 (`scripts/check.sh`의 cmp 검사 때문).
- `hooks/register.tsx`: 이벤트 → `atom` 상태 갱신, `/devfloor` 명령, `ui.render` Pane(Raster 한 장과 자막 Text), 애니메이션 타이머
- `hooks/scene.ts`: 순수 함수 `drawScene(state, frame, cols, rows): Uint32Array`. 픽셀 버퍼(w×2h)를 반블록 셀로 접는 `fold()`와 base64 인코딩을 맡습니다. `$`를 받지 않으므로 테스트하기 쉽습니다.
- `hooks/sprites.ts`: 작은 비트맵 상수들. 개발자 4포즈(앉음, 타이핑, 손듦, 엎드림), 책상, 모니터 6종, 경광등, 커피잔, 서버랙. 문자열 격자에 팔레트 인덱스를 매기는 방식입니다.
- `types/index.d.ts`: `PluginState`의 `floor`. 상태는 desks[], lead, alarm, asking, cups, rackLeft, contextLeft, idleSince
- `tests/game-dev-floor.test.ts`, `README.md`, 그리고 marketplace.json 항목 추가

애니메이션 규칙:
- `$.clock.every(1000/fps)`는 pane이 placed 상태이고 움직일 것(타이핑, 입장, 경광등)이 있을 때만 켭니다. 유휴 상태로 30초가 지나면 끄고 정지 프레임만 남깁니다(CPU 절약).
- 프레임 번호는 모듈 변수로 둡니다. 렌더 중에는 `$.state`를 쓰면 안 된다는 규칙(AGENTS.md)을 지키기 위해서입니다.
- 크기가 바뀌면 `ui.render`가 다시 불리고 `e.viewport`로 cols와 rows를 다시 계산합니다. 크기 변화는 blit이 아니라 다시 그리기로 처리합니다.
- AGENTS.md 규칙을 지킵니다. `$` 호출은 전부 풀어 쓰고, 이벤트 이름은 문자열 리터럴로 씁니다. `$`를 넘기는 함수는 최상위에 선언하고, 관찰 hook에는 `.catch(($, e, next) => next(e))`를 답니다. 도구 호출은 `tool_use_id`마다 한 번만 셉니다(`session.append`와 `tool.call` 양쪽에서).

## 단계 (TDD)
1. `tasks/game-dev-floor.md`에 이 계획을 기록합니다 (사용자 규칙).
2. 테스트를 먼저 씁니다.
   - `scene.ts` 단위: `fold()`가 셀 개수와 반블록 색을 맞게 만드는지, 컨텍스트 10%면 밤 하늘 색이 되는지, 실패한 책상이 빨간 모니터인지
   - 통합 (`claude-code/testing`): agent.spawn을 하면 책상이 차는지, 실패하면 FAIL 포즈인지, 가드 deny면 alarm이 켜지는지, `/devfloor`를 하면 pane이 열리고 텍스트 요약이 오는지
3. `sprites.ts`와 `scene.ts`를 구현합니다.
4. `register.tsx`를 구현합니다: 상태 갱신, Pane 렌더, blit 타이머.
5. README(스크린샷 자리, 요소↔데이터 표), marketplace.json, CHANGELOG, 루트 README 목록을 반영합니다.
6. `bash scripts/check.sh`, `tsc -p plugins/game-dev-floor`를 돌리고 code-reviewer로 검토합니다.
7. 실제 세션에서 `claude --plugin-dir plugins/game-dev-floor`로 눈으로 확인합니다.

## 검증
- `claude plugin validate --strict plugins/game-dev-floor`, `claude plugin test plugins/game-dev-floor`
- `bash scripts/check.sh`가 전부 통과해야 합니다 (팔레트 사본 일치 포함).
- 실제 세션에서 확인할 것:
  - `/devfloor` → 서브에이전트를 2개 띄우는 작업 → 책상 입장, 모니터 변화, CLEAR 퇴장
  - `cat .env` 시도(trap-guard 설치 시) → 경광등
  - 권한 요청 → 손 든 포즈
  - 144열 미만에서는 자동으로 열리지 않음
- 버전은 새 plugin이라 `0.1.0`이고, marketplace metadata의 mod 수와 설명을 22 → 23으로 바꿉니다.

## 범위 밖 (나중에)
- kitty/Ghostty용 고해상도 `Image` 모드
- Codex·Gemini 같은 다른 CLI 세션을 옆방으로 보여 주기
- 사운드 (game-earcons가 이미 담당)
