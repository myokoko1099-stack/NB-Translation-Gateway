# MNB Translation Gateway (Phase 05-B1)

MNB Android Novel Browser အတွက် သီးခြား Backend Gateway ၏ **အခြေခံ (foundation) ဗားရှင်း `0.1.0`**။

> **အခြေအနေ**: `GET /health` သာ အလုပ်လုပ်သည်။ `POST /v1/translate` သည် contract သာ သတ်မှတ်ထားပြီး valid request အတွက် `501 NOT_IMPLEMENTED` ပြန်သည်။ Gemini နှင့် မချိတ်ရသေး၊ Authentication / Retry / Quota / Android integration မရှိသေး။

Base: Phase 04-I10-D merge commit `ed46035f628cec6380ed04aa42d3529910e4ab3c`။ ဤ project သည် Android source နှင့် MNB translation pipeline ကို မထိခိုက်ပါ (သီးခြား directory)။

## လိုအပ်ချက်

- Node.js **20 သို့မဟုတ် အထက်** (v22.23.4 ဖြင့် စမ်းသပ်ထား)
- npm dependency **မရှိ** (`dependencies` / `devDependencies` နှစ်ခုစလုံး ဗလာ) — `npm install` မလိုပါ

## Run

```bash
# Development (127.0.0.1:8080)
npm run dev

# .env ဖိုင်သုံးလိုလျှင် (Node 20.6+)
cp .env.example .env
node --env-file=.env src/index.js

# Production-style (PORT မဖြစ်မနေ လိုအပ်)
NODE_ENV=production PORT=10000 npm start
```

```bash
curl http://127.0.0.1:8080/health
# {"status":"ok","service":"mnb-translation-gateway","version":"0.1.0"}

curl -X POST http://127.0.0.1:8080/v1/translate \
  -H 'content-type: application/json' \
  -d '{"sourceLanguage":"ja","targetLanguage":"my","text":"こんにちは"}'
# 501 {"error":{"code":"NOT_IMPLEMENTED", ...}}
```

## Test

```bash
npm test      # node:test, 49 tests
```

## Configuration

Variable စာရင်းနှင့် default များကို `.env.example` နှင့် `ARCHITECTURE.md` တွင် ကြည့်ပါ။ အရေးကြီးသည်များ:

- `NODE_ENV=production` တွင် `PORT` မရှိလျှင် server မစတင်ဘဲ `exit 1`။
- Secret များကို Git ထဲ မထည့်ပါနှင့်။ `.env` ကို `.gitignore` လုပ်ထားသည်။ နောက် Phase ၏ `GEMINI_API_KEY` ကို hosting dashboard တွင်သာ သတ်မှတ်ပါ။

## စာရွက်စာတမ်းများ

| ဖိုင် | အကြောင်းအရာ |
|---|---|
| `ARCHITECTURE.md` | အလွှာများ၊ API contract၊ configuration |
| `HOSTING-DECISION.md` | Free-tier hosting ရွေးချယ်မှု၊ Verified / UNVERIFIED |
| `SECURITY-NOTES.md` | Secret handling၊ လုံခြုံရေး ကွာဟချက်များ |
| `TEST-REPORT.md` | QA report |
| `CHANGED_FILES.md` | ဖိုင်စာရင်း |

## Scope

ဤ Phase တွင် မပါဝင်သည်: Authentication၊ Gemini Adapter၊ Retry System၊ Quota Management၊ Android Integration၊ Deployment။ နောက် Phase ကို စတင်ရန် သီးခြား ညွှန်ကြားချက် လိုအပ်သည်။
