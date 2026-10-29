# Gemini 검토 스킬

Codex의 결과물을 공식 Antigravity CLI(`agy`)를 통해 별도 모델에 검토시키고, 그 결과를 직접 검증하도록 돕는 Windows용 스킬입니다. 브리지는 Node.js 내장 모듈만 사용합니다. 검토 요청을 보내면 입력한 자료가 외부 서비스로 전송됩니다.

## 설치

1. Node.js를 설치하고 터미널에서 `node --version`을 확인합니다. CLI는 [공식 설치 안내](https://antigravity.google/docs/cli/install/)에 따라 **본인이** 설치하고 로그인합니다. 이 패키지에는 CLI 바이너리, 계정 설정, OAuth 토큰이 없습니다.
2. [저장소](https://github.com/Kimhyuntae9665/codex-skill-gemini-cli)를 내려받거나 `git clone https://github.com/Kimhyuntae9665/codex-skill-gemini-cli.git`으로 복제한 뒤, 저장소 폴더의 PowerShell에서 `./install.ps1`을 실행합니다. 현재 사용자의 `~/.codex/skills/gemini-cli`에 복사합니다. 기존 폴더가 있으면 덮어쓰지 않고 중단합니다.
3. Codex를 다시 시작하거나 스킬 목록을 새로 고친 뒤 `$gemini-cli`로 호출합니다. 독립 검토는 명시적으로 허용된 자료만 보냅니다.

원본 `SKILL.md`는 바이트 단위로 보존하여 예시에 이전 사용자 경로 `C:/Users/user/.codex/skills/gemini-cli`가 남아 있습니다. 다른 사용자는 이 경로를 자신의 `$HOME/.codex/skills/gemini-cli`로 해석하고 PowerShell에서 다음처럼 실행하세요. 설치 스크립트는 원본 경로를 수정하거나 다른 사용자 폴더에 링크를 만들지 않습니다.

```powershell
$bridge = Join-Path $HOME '.codex/skills/gemini-cli/scripts/ask-antigravity.mjs'
node $bridge --help
```

원본의 특정 날짜, 사용자 승인, 모델명, 요금제, 계정 상태와 쿼터 관찰은 제작 당시의 기록이며 설치자의 승인이나 현재 계정의 이용 가능성을 보장하지 않습니다. 기본 모델 후보도 오래되었을 수 있습니다. 필요한 경우 사용자가 직접 계정에서 모델 목록과 쿼터를 확인하고 현재 지원되는 정확한 모델을 선택해야 합니다. 타 모델로 전환하기 전 사용자의 허용 범위를 확인하세요. 크레딧 초과 사용은 꺼진 상태로 유지합니다. 과거 Gemini CLI 경로는 명시적 요청이 있을 때만 사용합니다.

`--dry-run`은 실제 추론을 하지 않지만 표준 경로에 CLI가 있어야 하며 사용자 설정을 읽습니다. 이것으로 로그인이나 모델 접근을 증명할 수는 없습니다. 자동 설치·로그인·계정 변경은 하지 않습니다. 운영체제와 CLI 경로는 현재 Windows 표준 설치를 전제로 합니다.

## 오프라인 검증

```powershell
node --test scripts/tests/test-antigravity-bridge.mjs scripts/tests/test-fallback.mjs
```

일부 Windows 인자 검사는 표준 위치의 CLI 파일과 로컬 설정을 요구합니다. 테스트가 만드는 `work/`는 공개하지 마세요. 실제 계정·모델 접근을 검증하지 않습니다.

## 출처와 권리

이 저장소의 브리지와 스킬은 제공된 로컬 작업물입니다. 제공된 로컬 원본에는 라이선스가 없었으며, 이번 공개 배포의 독자적인 스킬·브리지·문서에는 [MIT 라이선스](LICENSE)를 부여합니다. Antigravity CLI는 별도 제품이며 이 저장소에 포함되지 않습니다. 설치와 사용은 해당 제공자의 조건을 따릅니다. 참조한 공식 자료는 [설치](https://antigravity.google/docs/cli/install/), [headless 프로토콜](https://antigravity.google/docs/cli/headless/), [모델](https://antigravity.google/docs/models), [크레딧](https://antigravity.google/docs/cli/credits/)입니다. 공개 배포를 위해 계정별 실행 보고는 삭제하고 동일 참조 위치에 설명을 두었습니다. 원본 무결성과 대체 파일은 `MANIFEST.sha256` 및 `PROVENANCE.md`를 확인하세요.

## 원문 보존과 패키지 검사

`SKILL.md`는 배포 기준 원본과 바이트 단위로 동일합니다. 개인 PC 경로와 과거 실행 관찰을 포함한 원문은 수정하지 않았으며, 설치·계정 설정에는 위의 현재 사용자 기준 안내를 적용하세요. 설정 파일과 비밀키는 포함하지 않습니다.

```sh
python tools/verify_package.py
```

`package-manifest.json`은 배포 파일 해시와 원본 SKILL 해시를 기록합니다. GitHub Actions도 해시·상대 문서 링크·Python 문법을 검사합니다. 테스트가 있어도 실제 계정 로그인·현재 모델 접근·잔여 한도·실제 모델 리뷰 성공을 증명하지는 않습니다.
