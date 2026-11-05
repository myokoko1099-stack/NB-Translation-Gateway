# Phase 05-B3 — Gemini Provider Integration (Report)

- Project: NB-Translation-Gateway
- Base commit: `b944e9c`
- Git commit / push / pull request: မလုပ်ပါ
- **Test: Local တွင် မ run ပါ။ GitHub Actions (Node 20 / 22) ၏ ရလဒ်ကို စောင့်ရမည်။** ဤ report သည် test အောင်မြင်ကြောင်း မဆိုပါ။

## 1. အခြေအနေ — ပြီးစီး / မပြီးသေး

| အချက် | အခြေအနေ |
|---|---|
| Config (`TRANSLATION_PROVIDER` / `GEMINI_*`) | ပြီး |
| Provider files ၃ ခု (`geminiProvider`, `geminiPrompt`, `createProvider`) | ပြီး |
| `errorResponse.js` ကို `server.js` နှင့် ချိတ်ခြင်း | ပြီး |
| Logger သို့ Secret values ပေးခြင်း | ပြီး (`src/index.js`၊ default logger in `compose.js`) |
| `productionGuard.js` | **မချိတ်** (ညွှန်ကြားချက်အတိုင်း) — §5 |
| Test ဖိုင် ၃ ခု + `secret-exposure.test.js` ပြင်ဆင်ခြင်း | ရေးပြီး၊ **မ run ရသေး** |
| README / `.env.example` / `SECURITY-NOTES.md` | ပြင်ပြီး |
| `B3.patch`, `B3.zip`, ဤ report, `CHANGED_FILES-B3.md` | ထုတ်ပြီး |
| စစ်ဆေးပြီးသည်များ | `node --check` (syntax သာ)၊ secret pattern scan၊ `git apply --check` (patch applicability) |
| စစ်ဆေးမပြီးသေးသည်များ | Test run၊ Real Gemini API တွင် တကယ်ခေါ်ကြည့်ခြင်း |

## 2. ပြောင်းလဲမှုအကျဉ်း

- **Config** — `TRANSLATION_PROVIDER` = `none` (default) / `gemini`။ `none` တွင် Gemini variable များကို မဖတ်/မစစ်၊ 501 behaviour ထိန်းသိမ်း။ `gemini` တွင် `GEMINI_API_KEY` ကို `Secret` ဖြင့် သိမ်းပြီး မရှိလျှင် / `GEMINI_MODEL` / `GEMINI_TIMEOUT_MS` မမှန်လျှင် `ConfigError` (variable နာမည်သာ)။ Default model `gemini-3.1-flash-lite` ကို `src/config/translationProvider.js` တစ်နေရာတည်းတွင်သာ သတ်မှတ်။
- **GeminiProvider** — `POST …/v1beta/interactions`၊ header `x-goog-api-key`၊ body `{ model, input, system_instruction, store:false }`၊ native `fetch`၊ `redirect:'error'`၊ `AbortSignal.timeout`၊ retry မရှိ၊ endpoint ပုံသေ။ Response: `status === 'completed'` နှင့် `steps[]` ၏ `model_output` → `content[]` → `text` သာ။ Legacy outputs မသုံး။
- **Prompt** — Request schema မပြောင်း။ Language direction + စည်းမျဉ်းများသည် `system_instruction`၊ စာသားသည် `input` အတိုင်း။ Language tag ကို prompt မတည်ဆောက်မီ ပြန်စစ်သည်။
- **Error mapping** — 400/401/403/404/500 (နှင့် မမျှော်လင့်သော status) → `502 UPSTREAM_ERROR`၊ 429 → `429 UPSTREAM_RATE_LIMITED`၊ 503 → `503 UPSTREAM_UNAVAILABLE`၊ 504 (upstream) / Timeout → `504 UPSTREAM_TIMEOUT`၊ Network / Invalid JSON / Empty / Incomplete → `502 UPSTREAM_ERROR`။ Raw error များ client သို့ မပို့။
- **server.js** — catch block သည် `toClientError()` ကို သုံးသည်။ Non-AppError → `logger.error('unhandled error', {requestId, errorName, errorMessage})` (redacted/bounded)၊ 5xx AppError → `logger.error('server error', {requestId, status, code})`။
- **index.js** — provider config ကို load၊ Logger သို့ `[auth.token, gemini apiKey]` ပေး၊ `createProvider()` ဖြင့် `buildApp(…, { provider })`။ Startup log တွင် `translationProvider` / `translationModel` ထည့် (secret မဟုတ်)။
- **compose.js** — default logger သည် `auth.token` ကို scrub (logger ကို override မလုပ်သည့်အခါ)။

## 3. Behaviour ပြောင်းလဲမှု (မှတ်တမ်း)

1. **501 response message** — `server.js` သည် `errorResponse.js` ကို သုံးလာသဖြင့် `NOT_IMPLEMENTED` ၏ message သည် `Not implemented.` ဖြစ်သွားသည် (အရင်: `Translation is not implemented in this build (Phase 05-B1 foundation only).`)။ Status `501` နှင့် code `NOT_IMPLEMENTED` မပြောင်း။ Existing tests များသည် status / code သာ စစ်သည် (ဖတ်ရှုရသော tests အရ)။
2. **5xx AppError** — message / details / extra headers ကို client သို့ မပို့တော့ (B2.4 ၏ ရည်ရွယ်ချက်အတိုင်း၊ ယခု အမှန်တကယ် သက်ရောက်)။
3. **Logging** — 5xx AppError သည် ယခင်က log မထွက်၊ ယခု `server error` (requestId/status/code) ထွက်။ Non-AppError log field များ (`errorName`, `errorMessage`) အမည်တူ၊ သို့သော် redact + အရှည်ကန့်သတ်ထား။
4. **Startup** — `TRANSLATION_PROVIDER=gemini` နှင့် `GEMINI_API_KEY` မရှိ/မမှန်လျှင် `exit 1` (`none` default တွင် မသက်ရောက်)။
5. **`.env.example`** — `TRANSLATION_PROVIDER=none` နှင့် ဗလာ `GEMINI_API_KEY=` ကို comment မလုပ်ဘဲ ထည့်။ ထို့ကြောင့် `secret-exposure` ၏ `*_API_KEY` regex ကို ပြင်ရသည် (§6)။

## 4. Security စစ်ဆေးချက်

- API Key သည် server-side သာ၊ `Secret` wrapper၊ `x-goog-api-key` header သာ (URL/body မပါ)၊ response/log/error ထဲ မပါ။
- `GEMINI_API_KEY` ကို src/ တွင် `src/config/translationProvider.js` တစ်ခုတည်းသာ ရည်ညွှန်း (grep ဖြင့် စစ်ပြီး၊ test ဖြင့်လည်း ပြဋ္ဌာန်း)။
- Provider သည် upstream response body / status text / error message ကို error သို့ log သို့ မကူး။ Failure log = `reason` + `upstreamStatus` / `causeCode` (ECONNREFUSED ကဲ့သို့) သာ။
- Request/translated text ကို log မထုတ်။
- Auth → Rate limit → Validation အစီအစဉ် မပြောင်း၊ မအောင်မြင်သော request များက Gemini ကို မခေါ် (test ရေးထား)။

## 5. `productionGuard.js` — မချိတ်ခြင်း၏ အကျိုးဆက်

Base commit တွင် `src/index.js` သည် `assertProductionConfig` ကို မခေါ်ပါ၊ B3 တွင်လည်း မချိတ်ပါ။ ထို့ကြောင့် runtime တွင် **ယခုလည်း မလုပ်သည်များ**: production တွင် placeholder client token ကို မပယ်ချ၊ `LOG_LEVEL=debug` ကို မပယ်ချ။ (production တွင် `GATEWAY_CLIENT_TOKEN` မဖြစ်မနေလိုခြင်းမှာ `loadAuthConfig` / `buildApp` က ဆက်လုပ်ပေးသည်။) ယခင် `SECURITY-NOTES.md` တွင် ဤစစ်ဆေးချက်များကို active ဟု ရေးထားခြင်းသည် မမှန်သဖြင့် B3 တွင် ပြင်ထားသည်။ ချိတ်ခြင်းသည် behaviour ပြောင်းလဲမှုဖြစ်၍ သီးခြား phase အတွက် ထားသင့်သည်။

## 6. Tests

ဖိုင်သစ် ၃ ခု (Mock `fetch` သာ — Real API / Real Key မသုံး):

| ဖိုင် | အကျုံးဝင်သည်များ |
|---|---|
| `test/geminiConfig.test.js` | Configuration (none/gemini/invalid/default/custom)၊ Provider Selection (`createProvider`)၊ Model Selection၊ startup `exit 1` (child process၊ network မခေါ်) |
| `test/geminiProvider.test.js` | Request Structure၊ Authentication Header၊ Successful Translation၊ Empty Response၊ Incomplete၊ Invalid JSON၊ 400/401/403/404/429/500/503/504 mapping၊ Network Failure၊ Timeout၊ no-retry၊ API Key Redaction၊ text မ log ခြင်း၊ prompt injection ကာကွယ်ချက် |
| `test/geminiGateway.test.js` | Full HTTP pipeline: success၊ error mapping + no raw leak၊ `errorResponse.js` wiring၊ provider `none` → 501၊ **Authentication regression**၊ **Rate Limit regression**၊ **HTTP Security regression** (CORS / preflight / security headers / 415 / 413 / 400)၊ secret exposure၊ logger secret scrubbing |

`test/secret-exposure.test.js` ပြင်ဆင်ချက်:
- `*_API_KEY` assignment regex ကို `\s*` အစား `[ \t]*` သုံးပြီး ဗလာ `GEMINI_API_KEY=` ၏ နောက်စာကြောင်းကို တန်ဖိုးအဖြစ် မှားမယူစေရန် ပြင်၊ comment / `""` ကိုလည်း ဗလာအဖြစ် သတ်မှတ်၊ regex ကိုယ်တိုင်အတွက် test ထည့်။
- "src ထဲ `GEMINI_API_KEY` မရှိရ" test ကို "`src/config/translationProvider.js` တစ်ခုတည်းသာ ရှိရ" သို့ ပြောင်း၊ provider adapter များ `process.env` မဖတ်ကြောင်း test ထည့်။

## 7. သတိပြုရန် / အတည်မပြုရသေးသည်များ

1. **Test များ မ run ရသေးပါ။** CI တွင် မအောင်မြင်သည်များ ရှိနိုင်သည် (အထူးသဖြင့် အသစ်ရေးထားသော test များ)။
2. **Real Gemini API တွင် မစမ်းရသေးပါ။** `system_instruction` ကို design အတိုင်း top-level field အဖြစ် ပို့ထားသည်။ Interactions API docs (ဖတ်ရသော အပိုင်း) တွင် `system_instruction` ကို agent config အောက်တွင် စာရင်းပြထားသဖြင့် top-level လက်ခံမှုကို staging တွင် တစ်ကြိမ် စစ်ပါ။ `gemini-3.1-flash-lite` model id သည်လည်း ညွှန်ကြားချက်မှ ယူထားခြင်းဖြစ်ပြီး ကိုယ်တိုင် မစစ်ရပါ။
3. Response ၏ `status` ကို `completed` မဟုတ်လျှင် error ဟု ပြင်းထန်စွာ သတ်မှတ်ထားသည် (docs တွင် `status` required)။
4. `src/domain/translation.js` ၏ comment တွင် success body ထဲ `requestId` ပါမည်ဟု ရေးထားသော်လည်း server သည် `x-request-id` header သာ ပို့သည် (B3 တွင် မပြောင်း)။
5. Patch ကို Repo တစ်ခုလုံး မရယူဘဲ ဖတ်ရသော ဖိုင်များမှ base ပြန်တည်ဆောက်၍ ထုတ်ထားသည် (shell မှ GitHub သို့ မရောက်နိုင်သောကြောင့်)။ ကိုယ့် repo တွင် `git checkout b944e9c && git apply --check B3.patch` ဖြင့် အတည်ပြုပါ။
6. Free-tier Gemini quota ကို ကာကွယ်ရန် Gateway rate limit သာ ရှိသည် (Quota Management မပါ)။

## 7.1 CI တွင် ကြည့်ရန် အချက်များ

- `node --test test/*.test.js` တွင် `geminiConfig.test.js` ၏ child-process test နှစ်ခုသည် `src/index.js` ကို `NODE_ENV=test` ဖြင့် spawn လုပ်ပြီး `exit 1` မျှော်လင့်သည်။
- Timeout tests (`timeoutMs: 25` / `30`) သည် အချိန်အနည်းငယ်သာ ကြာသည်။

## 8. ဖိုင်စာရင်း

`CHANGED_FILES-B3.md` ကို ကြည့်ပါ။
