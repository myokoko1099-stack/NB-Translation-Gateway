# MNB Translation Gateway (Phase 05-B2.1)

MNB Android Novel Browser အတွက် သီးခြား Backend Gateway ၏ **အခြေခံ (foundation) ဗားရှင်း `0.1.0`**။

> **အခြေအနေ**: `GET /health` သည် public ဖြစ်ပြီး အလုပ်လုပ်သည်။ `POST /v1/translate` သည် **Bearer Token Authentication** (Phase 05-B2.1) ဖြင့် ကာကွယ်ထားသည်။ Authenticate ပြီးသော valid request အတွက် `501 NOT_IMPLEMENTED` ပြန်သည် (provider မချိတ်ရသေး)။ Gemini နှင့် မချိတ်ရသေး၊ Rate Limiting / CORS / Retry / Quota / Android integration မရှိသေး။

Base: Phase 05-B1 commit `c19e83f7ded1ec2a6e4b0daa38ee6e29cfde3370`။ ဤ project သည် Android source နှင့် MNB translation pipeline ကို မထိခိုက်ပါ (သီးခြား directory)။

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

## Test

```bash
npm test      # node:test, 71 tests (B1: 49 + B2.1: 22)
```

## Configuration

Variable စာရင်းနှင့် default များကို `.env.example` နှင့် `ARCHITECTURE.md` တွင် ကြည့်ပါ။ အရေးကြီးသည်များ:

- `NODE_ENV=production` တွင် `PORT` မရှိလျှင် server မစတင်ဘဲ `exit 1`။
- `NODE_ENV=production` တွင် `GATEWAY_CLIENT_TOKEN` မရှိလျှင် server မစတင်ဘဲ `exit 1`။
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

## Scope

ဤ Phase (B2.1) တွင် မပါဝင်သည်: Gemini Adapter၊ Rate Limiting၊ CORS / Security Headers၊ Retry System၊ Quota Management၊ Android Integration၊ Deployment။ နောက် Phase ကို စတင်ရန် သီးခြား ညွှန်ကြားချက် လိုအပ်သည်။
