# NSFDHR Netlify GitHub 배포 방법

압축파일 드래그 업로드는 화면 파일만 올라가고 `netlify/functions` 저장 서버가 빠질 수 있습니다. 여러 사람이 같은 입사 날짜, 근무표, 휴가 데이터를 보려면 GitHub 연결 배포로 올려야 합니다.

## GitHub에 올릴 파일

이 폴더 전체를 GitHub 저장소에 올리면 됩니다. 단, `.gitignore` 때문에 아래 파일들은 자동으로 제외됩니다.

- `node_modules/`
- `*.zip`
- `.agents/`
- `.codex/`

## Netlify 설정

Netlify에서 사이트를 GitHub 저장소와 연결할 때 아래처럼 설정합니다.

- Build command: 비워둠
- Publish directory: `.`
- Functions directory: `netlify/functions`

`netlify.toml`에 이미 같은 설정을 넣어두었기 때문에 Netlify가 자동으로 읽을 수 있습니다.

## 배포 후 확인

배포가 끝나면 아래 주소가 `404`가 아니어야 서버 저장이 살아있는 상태입니다.

`https://nsfdhr.netlify.app/.netlify/functions/hr-data`

정상이라면 `{}` 또는 저장된 데이터가 글자로 보입니다.
