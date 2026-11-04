# TEST-REPORT.md — Phase 05-B1 QA Report

ရက်စွဲ: 2026-11-04 · Node v22.23.4 · Linux · `npm test` (`node --test`)

**ရလဒ်: 49 tests, 49 pass, 0 fail, 0 skipped** (~1 စက္ကန့်)

## Implemented

- Backend project (`mnb-translation-gateway/`) — dependency 0 ခု၊ Android project နှင့် သီးခြား
- Clean Architecture အလွှာများ (domain / ports / application / config / infrastructure)
- `GET /health` → `{status, service, version}`
- Configuration: env loader၊ development / test / production profiles၊ validation၊ `.env.example`
- Secret management interface (`SecretProvider`, `EnvSecretProvider`, redacting `Secret`)
- `POST /v1/translate` request validation + error envelope + `501 NOT_IMPLEMENTED` (provider မချိတ်)
- `TranslationProvider` port (provider-independent seam)
- Body size / Content-Type / unknown-field limits၊ request ID၊ JSON logger၊ graceful shutdown၊ server timeouts
- `.gitignore` (secret ဖိုင်များ)

## Tested (automated)

| Test ဖိုင် | Tests | ဖုံးလွှမ်းမှု |
|---|---|---|
| `health.test.js` | 5 | Body အတိအကျ၊ version = package.json၊ security headers + request id၊ 405 + `Allow`၊ 404 |
| `config.test.js` | 15 | Dev/prod defaults၊ env override၊ frozen config၊ **missing `PORT` ဖြင့် production fail**၊ unknown NODE_ENV၊ non-numeric/out-of-range/invalid LOG_LEVEL၊ ပြဿနာအားလုံး တစ်ပြိုင်နက် report၊ တန်ဖိုးကို error ထဲ မထည့်ခြင်း၊ `Secret` redaction၊ `EnvSecretProvider` |
| `translate.test.js` | 17 | Malformed/empty JSON (400)၊ 415၊ 413၊ non-object body၊ missing fields၊ wrong types၊ text length၊ unknown field၊ `auto` target ပယ်ခြင်း၊ text ကို error/log ထဲ မပြန်ခြင်း၊ 405၊ valid request → **501 (fake success မရှိ)**၊ provider port seam (test double) |
| `secret-exposure.test.js` | 12 | Project ဖိုင်အားလုံး scan (key patterns ၆ မျိုး)၊ `.env.example`၊ `.gitignore` rules၊ `.env`/key ဖိုင် မရှိခြင်း၊ src တွင် `GEMINI_API_KEY` မဖတ်ခြင်း၊ response/log တွင် sentinel secret မပေါ်ခြင်း |

Manual smoke test (လက်တွေ့ process): `NODE_ENV=production` + PORT မရှိ → `PORT is required`, exit 1 ✔ · `PORT=18080` server စတင်၍ `/health` 200, valid translate 501, invalid translate 400 ✔ · SIGTERM တွင် `shutting down` log ပြီး ပိတ်သည် ✔

## Not Tested

- Render (သို့မဟုတ် မည်သည့် host) ပေါ်သို့ **deploy မလုပ်ရသေး** — hosting ပေါ်တွင် အလုပ်လုပ်ကြောင်း မစစ်ဆေးရ
- Node 20 / 21 ဗားရှင်းများ (v22 တစ်ခုတည်း စမ်း)၊ Windows / macOS
- Load / concurrency၊ slow-client (`requestTimeout`, `headersTimeout`) လက်တွေ့ အပြုအမူ
- Graceful shutdown ကို automated test မရှိ (manual smoke သာ)
- Spin-down / cold-start ၏ Android client အပေါ် သက်ရောက်မှု
- Git history တွင် secret ကျန်/မကျန် (repo မရှိ)
- Gemini ချိတ်ဆက်မှု၊ Auth၊ Retry၊ Quota — scope ပြင်ပ

## Verified

(Official docs ဖြင့်၊ 2026-11-04) Render တွင် free web service ရှိခြင်း · managed TLS / HTTPS termination · `0.0.0.0` + `PORT` binding · Dashboard မှ environment variables သတ်မှတ်နိုင်ခြင်း · Blueprint `sync: false` ဖြင့် secret ကို file ပြင်ပ ထားနိုင်ခြင်း · Free tier ကန့်သတ်ချက်များ (spin-down 15 မိနစ်၊ 750 hrs၊ ephemeral FS၊ bandwidth ကုန်ပါက payment method မရှိလျှင် suspend) — အသေးစိတ် `HOSTING-DECISION.md`။

## Unverified

- Signup တွင် **billing/card မတောင်းခြင်း** (official docs က တိတိကျကျ မဖော်ပြ၊ third-party များ ဆန့်ကျင်ကြ)
- Request timeout ကိန်းဂဏန်း (100 မိနစ်ဟု ဆိုသော်လည်း docs စာမျက်နှာတွင် မတွေ့)
- Dashboard secret value ဝှက်ထားခြင်း / at-rest encryption
- Render ၏ Node.js version support၊ service-initiated traffic threshold ကိန်းဂဏန်း
- ဤ project ကို Render ပေါ်တွင် deploy လုပ်ပါက အလုပ်လုပ်မည်ဟူသော အချက် (`render.yaml` မရေးထား)

## Known Limitations

- Authentication မရှိ — endpoint ကို မည်သူမဆို ခေါ်နိုင်
- Rate limit / quota မရှိ
- `/v1/translate` သည် validation + 501 သာ
- Render Free: spin-down (~၁ မိနစ် cold start)၊ restart မည်သည့်အချိန်မဆို၊ single instance၊ ephemeral disk
- Secret scan သည် pattern-based သာ
- Plain Node HTTP router (route အနည်းငယ်အတွက်သာ သင့်တော်)၊ `HEAD` / `OPTIONS` မထောက်ပံ့ (405)
- Keep-alive timeout ကို default (5s) ထားထား — Render proxy နှင့် ဆက်စပ်မှု **UNVERIFIED**

## Next Phase Requirements (မစတင်ပါ)

1. User က hosting ရွေးချယ်မှုကို အတည်ပြုပြီး signup တွင် card မလိုကြောင်း စစ်ဆေးရန်
2. Authentication ပုံစံ ဆုံးဖြတ်ရန် (ဥပမာ app token) — သီးခြား Phase
3. Gemini adapter (`TranslationProvider` implement) နှင့် `GEMINI_API_KEY` ကို hosting dashboard တွင် သတ်မှတ်ခြင်း
4. Retry/timeout မူဝါဒ၊ Quota / rate limiting
5. Success response schema ကို အတည်ပြုရန် (`ARCHITECTURE.md` ၏ reserved shape)
6. Render service-initiated traffic threshold နှင့် free-tier hours ကို ထည့်သွင်းစဉ်းစားရန်
7. Android Integration (သီးခြား Phase)
