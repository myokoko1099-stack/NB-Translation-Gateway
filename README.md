# MNB Translation Gateway (Phase 05-B2.2)

MNB Android Novel Browser အတွက် သီးခြား Backend Gateway ၏ **အခြေခံ (foundation) ဗားရှင်း `0.1.0`**။

> **အခြေအနေ**: `GET /health` သည် public ဖြစ်ပြီး အလုပ်လုပ်သည်။ `POST /v1/translate` သည် **Bearer Token Authentication** (Phase 05-B2.1) ဖြင့် ကာကွယ်ထားသည်။ Authenticate ပြီးသော request များကို client IP အလိုက် **Rate Limiting** (Phase 05-B2.2) ဖြင့် ကန့်သတ်သည်။ ကန့်သတ်ချက်အတွင်း valid request အတွက် `501 NOT_IMPLEMENTED` ပြန်သည် (provider မချိတ်ရသေး)။ Gemini နှင့် မချိတ်ရသေး၊ CORS / Security Headers / Retry / Quota / Android integration မရှိသေး။

Base: Phase 05-B2.1 merge commit `ef4b2daf6710e26e927ebd87a87ef096fdae3ee1` (B1: `c19e83f7ded1ec2a6e4b0daa38ee6e29cfde3370`)။ ဤ project သည် Android source နှင့် MNB translation pipeline ကို မထိခိုက်ပါ (သီးခြား directory)။

## လိုအပ်ချက်

- Node.js **20 သို့မဟုတ် အထက်** (v22.23.4 ဖြင့် စမ်းသပ်ထား)
- npm dependency **မရှိ** (`dependencies` / `devDependencies` နှစ်ခုစလုံး ဗလာ) — `npm install` မလိုပါ

## Run

```bash
# Development (127.0.0.1:8080) - token မသတ်မှတ်လျှင် authentication မကျင့်သုံးပါ
npm run dev

# Development ဖြင့် authentication စမ်းလိုလျှင်
GATEWAY_CLIENT_TOKEN='<your-local-token>' npm run dev

# .env ဖိုင်သုံးလိုလျှင် (Node 20.6+)
cp .env.example .env
node --env-file=.env src/index.js

# Production (PORT နှင့် GATEWAY_CLIENT_TOKEN နှစ်ခုလုံး မဖြစ်မနေ လိုအပ်)
NODE_ENV=production PORT=10000 GATEWAY_CLIENT_TOKEN='<set-in-hosting-dashboard>' npm start
```

```bash
curl http://127.0.0.1:8080/health
# {"status":"ok","service":"mnb-translation-gateway","version":"0.1.0"}

curl -X POST http://127.0.0.1:8080/v1/translate \
  -H 'authorization: Bearer <your-local-token>' \
  -H 'content-type: application/json' \
  -d '{"sourceLanguage":"ja","targetLanguage":"my","text":"こんにちは"}'
# 501 {"error":{"code":"NOT_IMPLEMENTED", ...}}   (authenticated, provider မရှိသေး)
```

## Authentication (Phase 05-B2.1)

- `POST /v1/translate` သည် `Authorization: Bearer <token>` header လိုအပ်သည်။ `GET /health` သည် public (မပြောင်းလဲ)။
- Token ကို environment variable `GATEWAY_CLIENT_TOKEN` မှ ဖတ်သည်။ Source code / `.env.example` တွင် တန်ဖိုး မထည့်ပါ။
- Header မပါ၊ ပုံစံမမှန် (malformed)၊ token မမှန် — အားလုံး `401 UNAUTHORIZED` (တူညီသော message၊ `WWW-Authenticate: Bearer`)။ Token ကို response / log ထဲ မထည့်ပါ။
- Authentication မအောင်မြင်ပါက body parsing၊ validation နှင့် translation provider ကို လုံးဝ မခေါ်ပါ။
- Token နှိုင်းယှဉ်ခြင်းကို SHA-256 digest + `crypto.timingSafeEqual` ဖြင့် လုပ်သည်။
- `NODE_ENV=production` တွင် `GATEWAY_CLIENT_TOKEN` မရှိ/ဗလာ/ပုံစံမမှန်လျှင် server မစတင်ဘဲ `exit 1`။
- Development / test တွင် token မသတ်မှတ်လျှင် authentication မကျင့်သုံးပါ (B1 behaviour အတိုင်း၊ startup တွင် warning log ထုတ်သည်)။

## Rate Limiting (Phase 05-B2.2)

- `POST /v1/translate` ကို client IP တစ်ခုချင်းစီအတွက် **fixed window** ဖြင့် ကန့်သတ်သည် (default: 60 requests / 60 စက္ကန့်)။ `GET /health` ကို ကန့်သတ်ခြင်း မရှိ။
- **Authentication ပြီးမှ** rate limit စစ်သည်။ Token မမှန်/မပါသော request များသည် limiter record မဖန်တီး၊ budget မစား (memory မဖြည့်နိုင်စေရန်)။
- ကျော်လွန်လျှင် `429 RATE_LIMITED` + `Retry-After` (စက္ကန့်) + `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset` headers။ Body parsing၊ validation နှင့် provider ကို မခေါ်ပါ။ အောင်မြင်သော response များတွင်လည်း `RateLimit-*` headers ပါသည်။
- IP ကို TCP peer address မှသာ ယူသည်။ `X-Forwarded-For` ကို **အလိုအလျောက် မယုံပါ**။ Reverse proxy နောက်ကွယ်တွင် run လျှင်သာ `GATEWAY_TRUSTED_PROXY_HOPS=<proxy အရေအတွက်>` ဟု ကိုယ်တိုင်သတ်မှတ်ပါ (server ကို proxy မှတစ်ဆင့်သာ ရောက်နိုင်မှ)။ မသတ်မှတ်ဘဲ proxy နောက်ကွယ်တွင် run လျှင် client အားလုံး proxy IP တစ်ခုတည်းကို မျှဝေမိမည်။
- IPv6 ကို /64 prefix အလိုက် ရေတွက်သည်။
- State သည် **memory ထဲတွင်သာ** — instance တစ်ခုတည်းအတွက်သာ မှန်ကန်သည်၊ restart လုပ်လျှင် ပျောက်သည်၊ instance များအကြား မမျှဝေပါ (distributed limiting မပါ)။
- Memory ကာကွယ်ချက်: expired record များကို periodic sweep ဖြင့် ဖယ်ရှားသည်၊ store ကို 10,000 key အထိ ကန့်သတ်ထားသည် (ပြည့်လျှင် key အသစ်ကို ငြင်းပယ်သည်)။

Config: `GATEWAY_RATE_LIMIT_MAX` (1–100000)၊ `GATEWAY_RATE_LIMIT_WINDOW_MS` (1000–3600000)၊ `GATEWAY_TRUSTED_PROXY_HOPS` (0–10)။ တန်ဖိုးမမှန်လျှင် startup မစတင်ဘဲ variable နာမည်ပါသော error ပြသည်။

## Test

```bash
npm test      # node:test, 104 tests (B1: 49 + B2.1: 22 + B2.2: 33)
```

## Configuration

Variable စာရင်းနှင့် default များကို `.env.example` နှင့် `ARCHITECTURE.md` တွင် ကြည့်ပါ။ အရေးကြီးသည်များ:

- `NODE_ENV=production` တွင် `PORT` မရှိလျှင် server မစတင်ဘဲ `exit 1`။
- `NODE_ENV=production` တွင် `GATEWAY_CLIENT_TOKEN` မရှိလျှင် server မစတင်ဘဲ `exit 1`။
- Rate limit: `GATEWAY_RATE_LIMIT_MAX`, `GATEWAY_RATE_LIMIT_WINDOW_MS`, `GATEWAY_TRUSTED_PROXY_HOPS` (အထက်ပါ Rate Limiting အပိုင်း ကြည့်ပါ)။
- Secret များကို Git ထဲ မထည့်ပါနှင့်။ `.env` ကို `.gitignore` လုပ်ထားသည်။ နောက် Phase ၏ `GEMINI_API_KEY` နှင့် `GATEWAY_CLIENT_TOKEN` ကို hosting dashboard တွင်သာ သတ်မှတ်ပါ။

## စာရွက်စာတမ်းများ

| ဖိုင် | အကြောင်းအရာ |
|---|---|
| `ARCHITECTURE.md` | အလွှာများ၊ API contract၊ configuration (B1 အချိန်က — B2.1 မပါသေး) |
| `HOSTING-DECISION.md` | Free-tier hosting ရွေးချယ်မှု၊ Verified / UNVERIFIED |
| `SECURITY-NOTES.md` | Secret handling၊ လုံခြုံရေး ကွာဟချက်များ (B1 အချိန်က) |
| `TEST-REPORT.md` | B1 QA report |
| `CHANGED_FILES.md` | B1 ဖိုင်စာရင်း |
| `B2.1-REPORT.md` | Phase 05-B2.1 report |
| `CHANGED_FILES-B2.1.md` | Phase 05-B2.1 ပြောင်းလဲသော ဖိုင်စာရင်း |
| `B2.2-REPORT.md` | Phase 05-B2.2 report |
| `CHANGED_FILES-B2.2.md` | Phase 05-B2.2 ပြောင်းလဲသော ဖိုင်စာရင်း |

## Scope

ဤ Phase (B2.2) တွင် မပါဝင်သည်: Gemini Adapter၊ Distributed (multi-instance) Rate Limiting၊ CORS / Security Headers၊ Retry System၊ Quota Management၊ Android Integration၊ Deployment။ နောက် Phase ကို စတင်ရန် သီးခြား ညွှန်ကြားချက် လိုအပ်သည်။
