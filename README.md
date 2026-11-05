# MNB Translation Gateway (Phase 05-B4)

MNB Android Novel Browser အတွက် သီးခြား Backend Gateway ၏ **အခြေခံ (foundation) ဗားရှင်း `0.1.0`**။

> **အခြေအနေ**: `GET /health` သည် public ဖြစ်ပြီး အလုပ်လုပ်သည်။ `POST /v1/translate` သည် **Bearer Token Authentication** (Phase 05-B2.1) ဖြင့် ကာကွယ်ထားသည်။ Authenticate ပြီးသော request များကို client IP အလိုက် **Rate Limiting** (Phase 05-B2.2) ဖြင့် ကန့်သတ်သည်။ Response အားလုံးတွင် **Security Headers** ပါပြီး Browser Origin များကို **CORS Allowlist** (Phase 05-B2.3) ဖြင့်သာ လက်ခံသည်။ Request body ကို Content-Type / Size / Timeout ဖြင့် ကာကွယ်ထားသည်။ **Phase 05-B3**: `TRANSLATION_PROVIDER=gemini` ဖြစ်လျှင် valid request ကို Gemini Interactions API သို့ server-side မှ ပို့၍ ဘာသာပြန်ရလဒ်ပြန်သည်။ `TRANSLATION_PROVIDER=none` (default) ဖြစ်လျှင် ယခင်အတိုင်း `501 NOT_IMPLEMENTED` ပြန်သည်။ Upstream error များကို `errorResponse.js` ဖြင့် sanitise လုပ်၍ ပို့သည်။ Automatic Retry / Quota / Android integration မရှိသေး။ **Phase 05-B4**: `NODE_ENV=production` တွင် **Production Guard** ကို startup တွင် အမှန်တကယ် ချိတ်ဆက်ထားသည် — placeholder / မလုံခြုံသော client token နှင့် `LOG_LEVEL=debug` ဖြင့် server မစတင်ပါ (အောက်ပါ "Production Guard" အပိုင်း ကြည့်ပါ)။

Base: Phase 05-B2.2 merge commit `8e3d63382f9559ee2187abd6da48754bbe88001a`။ ဤ project သည် Android source နှင့် MNB translation pipeline ကို မထိခိုက်ပါ (သီးခြား directory)။

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
# Token သည် placeholder မဖြစ်ရ၊ အနည်းဆုံး ၁၆ လုံး၊ LOG_LEVEL=debug မဖြစ်ရ (Production Guard, Phase 05-B4)
# အောက်ပါ <set-in-hosting-dashboard> သည် ပုံစံပြ placeholder သာ — ဤတန်ဖိုးဖြင့် run လျှင် server မစတင်ပါ
NODE_ENV=production PORT=10000 GATEWAY_CLIENT_TOKEN='<set-in-hosting-dashboard>' npm start
```

```bash
curl http://127.0.0.1:8080/health
# {"status":"ok","service":"mnb-translation-gateway","version":"0.1.0"}

curl -X POST http://127.0.0.1:8080/v1/translate \
  -H 'authorization: Bearer <your-local-token>' \
  -H 'content-type: application/json' \
  -d '{"sourceLanguage":"ja","targetLanguage":"my","text":"こんにちは"}'
# TRANSLATION_PROVIDER=none (default): 501 {"error":{"code":"NOT_IMPLEMENTED", ...}}
# TRANSLATION_PROVIDER=gemini:         200 {"translatedText":"...","sourceLanguage":"ja","targetLanguage":"my","provider":"gemini"}
```

## Authentication (Phase 05-B2.1)

- `POST /v1/translate` သည် `Authorization: Bearer <token>` header လိုအပ်သည်။ `GET /health` သည် public (မပြောင်းလဲ)။
- Token ကို environment variable `GATEWAY_CLIENT_TOKEN` မှ ဖတ်သည်။ Source code / `.env.example` တွင် တန်ဖိုး မထည့်ပါ။
- Header မပါ၊ ပုံစံမမှန် (malformed)၊ token မမှန် — အားလုံး `401 UNAUTHORIZED` (တူညီသော message၊ `WWW-Authenticate: Bearer`)။ Token ကို response / log ထဲ မထည့်ပါ။
- Authentication မအောင်မြင်ပါက body parsing၊ validation နှင့် translation provider ကို လုံးဝ မခေါ်ပါ။
- Token နှိုင်းယှဉ်ခြင်းကို SHA-256 digest + `crypto.timingSafeEqual` ဖြင့် လုပ်သည်။
- `NODE_ENV=production` တွင် `GATEWAY_CLIENT_TOKEN` မရှိ/ဗလာ/ပုံစံမမှန်လျှင် server မစတင်ဘဲ `exit 1`။ Placeholder / တိုလွန်းသော / တူညီသောစာလုံးတစ်လုံးတည်းဖြင့် ပြုလုပ်ထားသော token ကိုလည်း Phase 05-B4 မှစ၍ ပယ်ချသည် (အောက်ပါ Production Guard)။
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

## HTTP Security (Phase 05-B2.3)

### CORS Allowlist

- `GATEWAY_CORS_ALLOWED_ORIGINS` (comma-separated) တွင် ပါသော Origin များကိုသာ Browser မှ လက်ခံသည်။ Entry တစ်ခုချင်းသည် `scheme://host[:port]` ပုံစံ (http/https၊ lowercase၊ path / trailing slash မပါ) ဖြစ်ရမည်။ ဥပမာ: `https://app.example.com,http://localhost:3000`
- **Wildcard `*` မသုံးပါ** — config တွင် `*` ပါလျှင် startup မစတင်ပါ။ Response တွင် `Access-Control-Allow-Origin: *` ကို မပို့ပါ၊ တောင်းဆိုသူ၏ Origin တစ်ခုတည်းကိုသာ ပြန်ထည့်သည်။
- `Origin: null` နှင့် allowlist ထဲမပါသော Origin များကို `403 ORIGIN_NOT_ALLOWED` ဖြင့် ပယ်ချသည်။ Allowlist ဗလာ (default) ဖြစ်လျှင် Browser Origin အားလုံး ပယ်ချသည်။
- **Origin header မပါသော request** (Native Android app၊ curl၊ server-to-server) ကို ခွင့်ပြုသည် — CORS မသက်ရောက်ပါ၊ ယခင်အတိုင်း အလုပ်လုပ်သည်။
- **OPTIONS Preflight** (`OPTIONS` + `Origin` + `Access-Control-Request-Method`): Origin ခွင့်ပြုထားပြီး Method / Headers မှန်လျှင် `204` ပြန်သည် (`Access-Control-Allow-Methods`, `Access-Control-Allow-Headers: authorization, content-type`, `Access-Control-Max-Age: 600`)။ Authentication မလို၊ Rate Limit budget မစားပါ။ မခွင့်ပြုသော Method / Header ဖြစ်လျှင် `403 CORS_PREFLIGHT_REJECTED`။ Preflight မဟုတ်သော `OPTIONS` သည် ယခင်အတိုင်း `405`။
- `Vary: Origin` ကို response အားလုံးတွင် ထည့်သည် (Preflight တွင် `Access-Control-Request-*` ပါ ထပ်ထည့်)။
- ခွင့်ပြုထားသော Origin သို့ error response များ (401 / 413 / 415 / 429 …) တွင်ပါ CORS headers ပါသဖြင့် Browser က ဖတ်နိုင်သည်။ `Access-Control-Expose-Headers`: `x-request-id`, `retry-after`, `ratelimit-*`။
- Credentials (cookies) မဖွင့်ပါ (`Access-Control-Allow-Credentials` မပို့ပါ)။

### Security Headers

Response အားလုံး (အောင်မြင်/error/preflight) တွင်:

| Header | တန်ဖိုး |
|---|---|
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `X-Frame-Options` | `DENY` |
| `Content-Security-Policy` | `default-src 'none'; frame-ancestors 'none'` |
| `Permissions-Policy` | `accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()` |

### HTTP Protection

- **Content-Type**: `POST /v1/translate` သည် `application/json` သာ လက်ခံသည် (`charset` ပါလျှင် UTF-8 သာ)။ မဟုတ်လျှင် `415 UNSUPPORTED_MEDIA_TYPE`။
- **Body size**: `MAX_BODY_BYTES` (default 1 MiB) ကျော်လျှင် `413 PAYLOAD_TOO_LARGE`။ `Content-Length` ကြေညာချက်ကြီးလျှင် body မဖတ်မီ ငြင်းပယ်သည်၊ chunked / streamed body ကို ဖတ်ရင်း ရေတွက်ပြီး ကန့်သတ်ချက်ရောက်သည်နှင့် ရပ်သည်။
- **Timeout**: Body ကို `REQUEST_TIMEOUT_MS` (default 30 စက္ကန့်) အတွင်း မပြည့်စုံစွာ မရလျှင် `408 REQUEST_TIMEOUT`။ Node ၏ `requestTimeout` / `headersTimeout` ကိုလည်း ဆက်သတ်မှတ်ထားသည်။
- 413 / 415 / 408 error များတွင် `Connection: close` ပါသည်။
- ဤစစ်ဆေးမှုများသည် Authentication နှင့် Rate Limiting **ပြီးမှ** ဖြစ်သည် (B2.1 / B2.2 အစီအစဉ် မပြောင်းပါ)။

### Request Pipeline (အစီအစဉ်)

1. CORS Origin စစ်ခြင်း (Origin ပါမှ) → `403`
2. Route ရှာခြင်း → `404`
3. CORS Preflight → `204` / `403` (auth / rate limit မလို)
4. Method စစ်ခြင်း → `405`
5. Bearer Authentication → `401`
6. Rate Limiting → `429`
7. Content-Type `415` → Size `413` → Timeout `408` → JSON `400` → Validation `400`

### ကန့်သတ်ချက်များ

- Node ကိုယ်တိုင် parse မလုပ်နိုင်သော ကွန်ရက်အဆင့် error များ (ဥပမာ header ကြီးလွန်းခြင်း၊ ပုံစံမမှန်သော HTTP) ကို Node က တိုက်ရိုက်ဖြေသဖြင့် ထို response များတွင် Security Headers မပါနိုင်ပါ။
- Allowlist ၏ `http://` Origin များကို ခွင့်ပြုသည် (local development အတွက်)။ Production တွင် `https://` သာ ထည့်ပါ။

## Translation Provider (Phase 05-B3)

### ဖွင့်ပုံ

```bash
# Gemini API Key ကို shell / hosting dashboard / git-ignored .env တွင်သာ သတ်မှတ်ပါ (ဤဖိုင်တွင် တန်ဖိုး မရေးပါ)
TRANSLATION_PROVIDER=gemini npm run dev
```

| Variable | အဓိပ္ပာယ် |
|---|---|
| `TRANSLATION_PROVIDER` | `none` (default) / `gemini`။ `none` ဖြစ်လျှင် `GEMINI_*` variable များကို လုံးဝ မဖတ်/မစစ်ပါ၊ `501 NOT_IMPLEMENTED` ပြန်သည် |
| `GEMINI_API_KEY` | `gemini` ဖြစ်လျှင် **မဖြစ်မနေ**။ `Secret` wrapper ဖြင့်သာ သိမ်းသည်။ `src/config/translationProvider.js` တစ်ခုတည်းသာ ဖတ်ခွင့်ရှိသည် |
| `GEMINI_MODEL` | default `gemini-3.1-flash-lite` (letters / digits / `.` `_` `-`၊ အများဆုံး 64) |
| `GEMINI_TIMEOUT_MS` | default `30000` (1000–120000) |

တန်ဖိုးမမှန်လျှင် startup မစတင်ဘဲ variable နာမည်ပါသော error ဖြင့် `exit 1` (တန်ဖိုးကို မပြပါ)။

### Gemini Request

- `POST https://generativelanguage.googleapis.com/v1beta/interactions` — endpoint ကို code ထဲတွင် ပုံသေထားသည်၊ environment / request field ဖြင့် မပြောင်းနိုင်ပါ။
- Header `x-goog-api-key`၊ body `{ model, input, system_instruction, store: false }`။
- Response ၏ `status` သည် `completed` ဖြစ်ရမည်၊ `steps[]` ထဲမှ `model_output` → `content[]` → `text` ကိုသာ ယူသည်။ `incomplete` / `failed` / ဗလာ ရလဒ်များသည် error။
- Node native `fetch`၊ `redirect: 'error'`၊ `AbortSignal.timeout`၊ **Automatic Retry မရှိ**၊ npm dependency အသစ် မရှိ။
- Request schema မပြောင်းပါ (`sourceLanguage`, `targetLanguage`, `text`)။ ဘာသာပြန်ရန် စာသားကို `input` အဖြစ်သာ ပို့ပြီး ညွှန်ကြားချက်များကို `system_instruction` တွင်သာ ထားသည် (စာသားထဲရှိ ညွှန်ကြားချက်များကို မလိုက်နာရန် ပါဝင်သည်)။

### Error Mapping

| Gemini | Client response |
|---|---|
| 400 / 401 / 403 / 404 | `502 UPSTREAM_ERROR` |
| 429 | `429 UPSTREAM_RATE_LIMITED` (gateway ၏ `RATE_LIMITED` နှင့် code ကွဲသည်၊ upstream `Retry-After` မပို့ပါ) |
| 500 | `502 UPSTREAM_ERROR` |
| 503 | `503 UPSTREAM_UNAVAILABLE` |
| Timeout | `504 UPSTREAM_TIMEOUT` |
| Network failure / Invalid JSON / Empty / Incomplete response | `502 UPSTREAM_ERROR` |

Raw Gemini error text၊ status line၊ URL၊ API Key တို့ကို client သို့ မပို့ပါ။ 5xx များသည် `errorResponse.js` ကြောင့် message ပုံသေ (`Upstream service error.` / `Service unavailable.` / `Upstream service timed out.`) သာ ပါသည်။

### လုံခြုံရေး

- API Key ကို server တွင်သာ သုံးသည်။ Android APK / Git / `.env.example` ထဲ မထည့်ပါ။
- Log ထဲသို့ API Key၊ Request Text၊ Translated Text မထည့်ပါ။ Provider သည် failure တွင် reason category နှင့် status ကိုသာ log ထုတ်သည်။
- `src/index.js` သည် Client Token နှင့် Gemini Key ၏ exact value များကို Logger သို့ ပေးထားသဖြင့် မှားယွင်း၍ ပါလာလျှင်လည်း `[REDACTED]` ဖြစ်သည်။
- Authentication → Rate Limiting → Validation အစီအစဉ် မပြောင်းပါ၊ ထို့ကြောင့် မအောင်မြင်သော request များက Gemini ကို မခေါ်ပါ။

## Production Guard (Phase 05-B4)

`src/config/productionGuard.js` (B2.4 တွင် ရေးထား၊ unit test သာ ရှိခဲ့) ကို B4 တွင် `src/index.js` နှင့် **အမှန်တကယ် ချိတ်ဆက်ပြီး** ဖြစ်သည်။

### Startup flow

`loadConfig()` → `loadAuthConfig()` → **`assertProductionConfig()`** → `loadTranslationProviderConfig()` → Logger → Provider → HTTP server။ Guard ပျက်ကွက်လျှင် `ConfigError` ကို အရင်ကဲ့သို့ပင် stderr သို့ ရေးပြီး `exit 1` လုပ်သည်။ ထိုအချိန်တွင် Logger၊ Provider၊ HTTP server မဖန်တီးရသေးသဖြင့် port မဖွင့်ပါ။

### စစ်ဆေးချက်များ (`NODE_ENV=production` တွင်သာ)

| စစ်ဆေးချက် | ပယ်ချသည့် အခြေအနေ | Error message (တန်ဖိုး မပါ) |
|---|---|---|
| Token မရှိ | `GATEWAY_CLIENT_TOKEN` မသတ်မှတ် / ဗလာ | `GATEWAY_CLIENT_TOKEN is required` |
| Placeholder | `changeme`, `your-token`, `password`, `xxxx` စသည် (အကြီးအသေး မခွဲ)၊ `<...>` ပုံစံ၊ `${...}` ပုံစံ | `GATEWAY_CLIENT_TOKEN must not be a placeholder value` |
| တိုလွန်းသော token | ၁၆ လုံးအောက် | `GATEWAY_CLIENT_TOKEN must be at least 16 characters` |
| စာလုံးတစ်လုံးတည်း | `aaaaaaaaaaaaaaaa` ကဲ့သို့ | `GATEWAY_CLIENT_TOKEN must not be a single repeated character` |
| Debug logging | `LOG_LEVEL=debug` | `LOG_LEVEL must not be "debug" in production` |

- Placeholder ဖြစ်လျှင် ထို token အတွက် problem တစ်ခုသာ ပြသည် ("တိုလွန်းသည်" ကို ထပ်မပြ)။ အခြား problem များ (ဥပမာ `LOG_LEVEL=debug`) နှင့်အတူ **တစ်ကြိမ်တည်း စုပြီး** ပြသည်။
- `LOG_LEVEL` မသတ်မှတ်လျှင် production default (`info`) ကို သုံးသဖြင့် ပယ်ချခြင်း မခံရပါ။ `silent` / `error` / `warn` / `info` ကို ခွင့်ပြုသည်။
- Environment variable အသစ် **မရှိ**။ ၁၆ လုံး အနိမ့်ဆုံးကို code ထဲ ပုံသေထားသည် (`MIN_CLIENT_TOKEN_LENGTH`)။
- **Development နှင့် Test ကို လုံးဝ မထိခိုက်ပါ** — placeholder token၊ token မရှိခြင်း၊ `LOG_LEVEL=debug` တို့ဖြင့် ယခင်အတိုင်း စတင်နိုင်သည်။

### လုံခြုံရေး

- Error message များတွင် variable နာမည်နှင့် အကြောင်းရင်းသာ ပါသည်။ Token / API Key ၏ တန်ဖိုး (သို့မဟုတ် တစ်စိတ်တစ်ပိုင်း) ကို မည်သည့်အခါမျှ မထုတ်ပါ။
- Startup failure ကို stderr သို့သာ ရေးသည်၊ Logger မသုံးသေး။ Guard မအောင်မြင်သော run တွင် token ကို log သို့ ရောက်စရာ လမ်းမရှိပါ။
- တည်ဆောက်ပြီးသော Logger သည် B3 အတိုင်း client token နှင့် Gemini key ၏ exact value များကို ဆက်လက် scrub လုပ်သည်။

### ဆက်ပြောင်းလဲမှု (Deploy မတိုင်မီ စစ်ပါ)

ယခင်က production တွင် `LOG_LEVEL=debug`၊ placeholder token သို့မဟုတ် ၁၆ လုံးအောက် token ဖြင့် run နေခဲ့လျှင် ဤ version ကို deploy လုပ်သည်နှင့် server မစတင်တော့ပါ။ Hosting dashboard တွင် `LOG_LEVEL` ကို `info` / `warn` / `error` သို့ ပြောင်းပြီး ရှည်လျားသော random token ကို အသစ်ထားပါ (client app တွင်လည်း တူညီစွာ ပြောင်းရမည်)။

## Test

```bash
npm test      # node --test test/*.test.js
```

Phase 05-B4 တွင် `test/productionGuardStartup.test.js` ကို ထည့်ထားသည် — Guard စည်းမျဉ်းများ (unit) နှင့် `src/index.js` ကို child process အဖြစ် run၍ startup `exit 1` / ပုံမှန်စတင်မှု (production၊ development၊ test) ကို စစ်သည်။ ယခင် `productionGuard.test.js` ကို မပြောင်းပါ။ ဤ Phase တွင်လည်း Local Test မ run ထားပါ၊ GitHub Actions ၏ ရလဒ်သာ အတည်ပြုချက်ဖြစ်သည်။ `B4-REPORT.md` ကို ကြည့်ပါ။

Phase 05-B3 တွင် Gemini test ဖိုင် ၃ ခု ထည့်ထားသည် (`geminiConfig.test.js`, `geminiProvider.test.js`, `geminiGateway.test.js`)။ Mock fetch သာ သုံးသည် — Real Gemini API / Real API Key မသုံးပါ။ ဤ Phase တွင် Local Test မ run ထားပါ၊ GitHub Actions ၏ ရလဒ်သာ အတည်ပြုချက်ဖြစ်သည်။ `B3-REPORT.md` ကို ကြည့်ပါ။

## Configuration

Variable စာရင်းနှင့် default များကို `.env.example` နှင့် `ARCHITECTURE.md` တွင် ကြည့်ပါ။ အရေးကြီးသည်များ:

- `NODE_ENV=production` တွင် `PORT` မရှိလျှင် server မစတင်ဘဲ `exit 1`။
- `NODE_ENV=production` တွင် `GATEWAY_CLIENT_TOKEN` မရှိလျှင် server မစတင်ဘဲ `exit 1`။
- `NODE_ENV=production` တွင် placeholder / ၁၆ လုံးအောက် / စာလုံးတစ်လုံးတည်း token နှင့် `LOG_LEVEL=debug` ကို Production Guard က ပယ်ချပြီး `exit 1` (Phase 05-B4)။
- Rate limit: `GATEWAY_RATE_LIMIT_MAX`, `GATEWAY_RATE_LIMIT_WINDOW_MS`, `GATEWAY_TRUSTED_PROXY_HOPS` (အထက်ပါ Rate Limiting အပိုင်း ကြည့်ပါ)။
- CORS: `GATEWAY_CORS_ALLOWED_ORIGINS` (ဗလာ = Browser Origin အားလုံး ပယ်ချ၊ Native client မထိခိုက်)။
- Provider: `TRANSLATION_PROVIDER` (`none` default / `gemini`)၊ `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_TIMEOUT_MS` (အထက်ပါ Translation Provider အပိုင်း ကြည့်ပါ)။
- Secret များကို Git ထဲ မထည့်ပါနှင့်။ `.env` ကို `.gitignore` လုပ်ထားသည်။ `GEMINI_API_KEY` နှင့် `GATEWAY_CLIENT_TOKEN` ကို hosting dashboard တွင်သာ သတ်မှတ်ပါ။
- `src/config/productionGuard.js` ကို Phase 05-B4 မှစ၍ `src/index.js` မှ ခေါ်သည် (အထက်ပါ Production Guard အပိုင်း)။ Guard သည် client token နှင့် `LOG_LEVEL` ကိုသာ စစ်သည် — `GEMINI_API_KEY` ၏ placeholder / အရှည်ကို မစစ်ပါ။ `SECURITY-NOTES.md` ကို ကြည့်ပါ။

## စာရွက်စာတမ်းများ

| ဖိုင် | အကြောင်းအရာ |
|---|---|
| `ARCHITECTURE.md` | အလွှာများ၊ API contract၊ configuration (B1 အချိန်က — B2.1 မပါသေး) |
| `HOSTING-DECISION.md` | Free-tier hosting ရွေးချယ်မှု၊ Verified / UNVERIFIED |
| `SECURITY-NOTES.md` | Secret handling၊ Error handling၊ Gemini provider လုံခြုံရေး၊ Production Guard၊ ကွာဟချက်များ (B4 အထိ) |
| `TEST-REPORT.md` | B1 QA report |
| `CHANGED_FILES.md` | B1 ဖိုင်စာရင်း |
| `B2.1-REPORT.md` | Phase 05-B2.1 report |
| `CHANGED_FILES-B2.1.md` | Phase 05-B2.1 ပြောင်းလဲသော ဖိုင်စာရင်း |
| `B2.2-REPORT.md` | Phase 05-B2.2 report |
| `CHANGED_FILES-B2.2.md` | Phase 05-B2.2 ပြောင်းလဲသော ဖိုင်စာရင်း |
| `B2.3-REPORT.md` | Phase 05-B2.3 report |
| `CHANGED_FILES-B2.3.md` | Phase 05-B2.3 ပြောင်းလဲသော ဖိုင်စာရင်း |
| `B3-REPORT.md` | Phase 05-B3 report (Gemini Provider Integration) |
| `CHANGED_FILES-B3.md` | Phase 05-B3 ပြောင်းလဲသော ဖိုင်စာရင်း |
| `B4-REPORT.md` | Phase 05-B4 report (Production Guard Activation) |
| `CHANGED_FILES-B4.md` | Phase 05-B4 ပြောင်းလဲသော ဖိုင်စာရင်း |
| `TERMUX-PUSH-GUIDE.md` | Phase 05-B4 ဖိုင်များကို Termux မှ branch / commit / push လုပ်ပုံ |

## Scope

ဤ Phase (B4) တွင် ပါဝင်သည်: `productionGuard.js` ကို `src/index.js` နှင့် ချိတ်ဆက်ခြင်း၊ Client token အနိမ့်ဆုံး အရှည် (၁၆) နှင့် စာလုံးတစ်လုံးတည်း စစ်ဆေးချက် ထည့်ခြင်း၊ Production Guard test၊ စာရွက်စာတမ်းများ ကိုက်ညီအောင် ပြင်ခြင်း။ မပါဝင်သည်: Gemini Provider ပြောင်းလဲမှု၊ Automatic Retry၊ Quota Management၊ Distributed Rate Limiting၊ `GEMINI_API_KEY` ကို Guard ဖြင့် စစ်ခြင်း၊ Android Integration၊ Deployment။ နောက် Phase အတွက် သီးခြား ညွှန်ကြားချက် လိုအပ်သည်။
