# Rental-backend — 누리상사 법인차량 백엔드

누리상사 총무팀 **법인차량 예약·운행 기록** 웹앱의 서버(NestJS)입니다. 예약 겹침, 하루 전 신청, 면허, 좌석, 점검, 반납 확인, 개인 차량 정산 같은 **모든 규칙을 이 서버가 지킵니다.** 화면이 막아도 서버가 한 번 더 확인하고, 일부는 DB가 직접 막습니다.

- 화면(프론트엔드) 저장소: [Rental-frontend](https://github.com/midayo13-droid/Rental-frontend) (코어 웹 `web/`, 어드민 `admin/`)
- 기획서: [기획서.md](기획서.md) · API 목록: [API.md](API.md)
- 모든 이름·계정·차량·금액은 **가상 데이터**입니다.

> ## ⚠ 무료 서버라 첫 접속이 느릴 수 있어요
> 이 서버는 Render **무료 플랜**에 올라가 있습니다. 한동안 접속이 없으면 서버가 잠들고, 잠든 뒤 **첫 접속은 30초~1분쯤 걸릴 수 있습니다.** 화면에서 로그인이 오래 걸리면 "서버를 깨우는 중이에요"라는 안내가 뜹니다. 한 번 깨어나면 그다음부터는 바로 응답합니다.
> 시연 전에 주소 뒤에 `/health` 를 붙여 한 번 열어 두면(`https://서버주소/health`) 미리 깨워 둘 수 있습니다.

---

## 배포 주소 (확인용)

| 구분 | 주소 |
|---|---|
| 코어 웹(임직원용) | https://rental-web-one-puce.vercel.app |
| 어드민(총무팀용) | https://rental-admin-nine.vercel.app |
| 백엔드(서버) | https://rental-backend-r63r.onrender.com  (확인: `/health`) |

> 서버가 무료 플랜이라 **첫 접속은 30초~1분 걸릴 수 있어요.** 로그인 계정은 아래 "확인용 계정(가상)"을 쓰세요.

---

## 기술

| 항목 | 내용 |
|---|---|
| 서버 | NestJS 12 (Node 22 이상), TypeScript |
| DB | PostgreSQL (Render) — 이 과제는 DB 안의 **`hw2` 공간(스키마)만** 사용 |
| 인증 | 이메일+비밀번호(bcrypt 해시), 8시간짜리 JWT 출입증 |
| 챗봇 | Dify 호출(서버가 대신 호출, 키는 서버에만) |

## Render에 올리기

**가장 쉬운 방법 (Blueprint):** Render 대시보드 → **Blueprints → New Blueprint Instance** → 이 저장소(`Rental-backend`) 선택 → 설정이 `render.yaml` 에서 자동으로 채워지고, **`DATABASE_URL` 한 칸만** 붙여 넣으면 됩니다. 이후 `CORS_ORIGIN` 을 Vercel 주소로 바꿉니다. 아래 표는 같은 설정을 손으로 넣을 때의 값입니다.

1. (손으로 만들 때) Render 대시보드 → **New → Web Service** → 이 저장소(`Rental-backend`) 연결.
2. 아래 값을 넣습니다.

| 항목 | 값 |
|---|---|
| Language / Runtime | Node |
| **Build Command** | `npm install --include=dev && npm run build` |
| **Start Command** | `npm start` |
| Health Check Path | `/health` |
| Region | **DB와 같은 지역**(Virginia, US East) — 같은 지역이면 응답이 훨씬 빠릅니다 |
| Plan | Free |
| Root Directory | (비워 둠 — 저장소 맨 위에 `package.json` 이 있음) |

> 빌드 명령에 `--include=dev` 를 넣는 이유: 서버를 만드는 도구(Nest CLI, TypeScript)가 개발용 패키지에 들어 있어서, 이것까지 설치해야 `npm run build` 가 됩니다.

3. **Environment(환경변수)** 를 넣습니다. 값은 **Render 화면에만** 입력하고 GitHub에는 올리지 않습니다.

| 이름 | 뜻 | 필수 | 예시·메모 |
|---|---|---|---|
| `DATABASE_URL` | Render PostgreSQL 접속 주소 | ✔ | Render DB 화면의 **Internal Database URL**(같은 지역이면 빠름) 또는 External Database URL |
| `DB_SCHEMA` | 이 과제가 쓸 DB 공간 이름 | ✔ | **`hw2` 고정.** 다른 값이면 서버가 시작을 거부(1주차 테이블과 섞임 방지) |
| `JWT_SECRET` | 로그인 출입증을 서명하는 비밀 글자 | ✔ | 길고 아무도 모르는 글자. `render.yaml` 로 만들면 자동 생성 |
| `CORS_ORIGIN` | 이 서버를 불러도 되는 화면 주소들 | ✔ | Vercel 코어 웹·어드민 주소를 쉼표로. 끝에 `/` 없이. 예: `https://rental-web.vercel.app,https://rental-admin.vercel.app` |
| `NODE_VERSION` | Render가 쓸 Node 버전 | 권장 | `22` |
| `PORT` | 서버가 열 포트 | — | **넣지 않음**(Render가 자동으로 줌. 로컬 기본값 4000) |
| `DIFY_API_URL` | Dify API 주소(챗봇) | 선택 | 예: `https://api.dify.ai/v1` |
| `DIFY_API_KEY` | Dify 앱 API 키(`app-...`)(챗봇) | 선택 | 비워 두면 챗봇이 "아직 연결되지 않았어요"로 안내 |
| `DEMO_RESET_ENABLED` | 어드민의 "가상 데이터 다시 채우기" 허용 여부 | 선택 | `true`(기본) / `false`(배포 후 실수로 지우지 않으려면) |

4. 배포가 끝나면 `https://서버주소/health` 가 `{"ok":true,...}` 로 열리는지 확인합니다.

## DB 처음 만들기 (한 번만)

테이블과 가상 데이터는 **내 컴퓨터에서** 만듭니다(서버에서 하지 않음). `backend/.env` 에 `DATABASE_URL` 을 **External** 주소로 넣은 뒤:

```bash
npm install
npm run db:init     # hw2 안에 테이블 11개 만들기 (이미 있으면 건너뜀)
npm run db:seed     # 가상 직원·차량·예약·정산 채우기 (이번 달 초 ~ 11월 중순)
```

- `hw2` 가 아닌 공간이거나 `hw2` 안에 이 과제 것이 아닌 테이블이 있으면 **멈춥니다.**
- 데이터를 처음으로 되돌리려면 `npm run db:reset`, 또는 어드민(관리자)의 **"가상 데이터"** 화면의 버튼(로그인 계정은 유지).

## 로컬에서 실행

```bash
cp .env.example .env     # 값 채우기 (.env 는 GitHub 에 올라가지 않음)
npm install
npm run start:dev        # http://localhost:4000  (확인: /health)
```

## 테스트

서버를 켜 둔 상태에서:

```bash
npm run test:rules   # 규칙 시연 107개 (규칙을 어기는 요청이 정말 거절되는지)
npm run test:extra   # 보안·안전장치 36개 (위조 출입증, SQL 주입, hw2 분리 등)
```

두 테스트는 `hw2` 안의 데이터만 지우고 다시 채웁니다. 1주차 `public` 테이블은 건드리지 않습니다.

## 폴더

```
src/        서버 코드 (auth, reservations, claims, stats, accounts, chat, demo …)
db/         schema.sql (테이블 11개)
scripts/    db-init, db-seed, rules-test, extra-test
render.yaml Render 배포 설정(Blueprint)
```
