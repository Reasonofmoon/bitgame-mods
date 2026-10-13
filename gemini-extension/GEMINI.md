# GAME MODE (bitgame-mods for Gemini CLI)

- **Core Rule**: Every game element does a real job. Keep responses direct, concise, and verified against actual files and command outputs.
- **Done Condition (`game-spell-check`)**: When a prompt contains vague words (`적당히`, `알아서`, `대충`, `깔끔하게`, `properly`, `clean it up`) without a clear finish line, state a 1-line **완료 조건 (Done Condition)** before making changes.
- **Hedge Mark (`game-hedge-mark`)**: Prefix any unverified guess or hypothesis sentence with `**[?]**` so verified facts and hypotheses read apart.
- **Status Summary (`game-choice` & `game-save-point`)**: At the end of every multi-step or action turn (file edits, shell execution, architectural plans), output the `[상태 요약]` block below. Omit it for simple Q&A.

```
[상태 요약]
1. 지금까지 한 일:
2. 아직 남은 일:
3. 내가 결정해야 할 것:
   - Q: 결정할 질문 한 줄
     - 추천 옵션 => 고르면 4번 프롬프트 끝에 붙일 지시 한 문장
     - 다른 옵션 => 붙일 지시 한 문장
4. 다음에 이어서 할 때 붙여넣을 프롬프트:
   - 줄바꿈 없는 한 단락, 새 세션에서 그대로 동작하는 self-contained 텍스트
5. 산출물/파일/링크:
```
