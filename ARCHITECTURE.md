# ARCHITECTURE.md — Phase 05-B1

## ရည်ရွယ်ချက်

Android app သည် Gemini API ကို တိုက်ရိုက်မခေါ်ဘဲ ဤ Gateway ကို ဖြတ်ခေါ်နိုင်ရန် Backend အခြေခံ။ Phase 05-B1 တွင် `GET /health` သာ အလုပ်လုပ်ပြီး `POST /v1/translate` သည် contract (request/response structure) သာ သတ်မှတ်ထားကာ valid request အတွက် **501 NOT_IMPLEMENTED** ပြန်သည်။ အတုအယောင် success မပြပါ။

## Clean Architecture အလွှာများ

```
src/
├── index.js                      Entry point (config load, listen, graceful shutdown)
├── meta.js                       Service name / version constants
│
├── domain/                       (အတွင်းဆုံး — အခြားအလွှာကို မမှီခို)
│   ├── errors.js                 AppError (HTTP-mappable), ConfigError
│   └── translation.js            Translate request/response contract + validation
│
├── ports/                        (Interface များ)
│   └── translationProvider.js    TranslationProvider port: { id, translate(req) }
│
├── application/                  (Use cases — domain + ports ကိုသာ မှီခို)
│   ├── healthService.js
│   └── translateService.js       Provider မရှိလျှင် 501 NOT_IMPLEMENTED
│
├── config/                       (Configuration + secret interface)
│   ├── profiles.js               development / test / production defaults
│   ├── config.js                 loadConfig(env) — pure, validated, frozen
│   └── secrets.js                Secret (redacting wrapper), EnvSecretProvider
│
└── infrastructure/               (အပြင်ဆုံး — framework/IO)
    ├── http/server.js            node:http router, body limits, error envelope
    ├── http/compose.js           Composition root (wiring)
    └── logging/logger.js         JSON-lines logger (body/secret မထည့်)
```

မှီခိုမှု ဦးတည်ချက်: `infrastructure → application → ports/domain`။ `domain` နှင့် `application` တွင် `node:http`, env, SDK ကို import မလုပ်ပါ။

## Provider-independent design

`application/translateService.js` သည် `TranslationProvider` port ကိုသာ သိသည်။ နောက်ပိုင်း Phase တွင်:

1. `src/infrastructure/providers/gemini.js` ထည့်ပြီး port ကို implement လုပ်သည်။
2. `compose.js` တစ်နေရာတည်းတွင် `provider` ကို inject လုပ်သည်။
3. `translateService`, router, validation မပြောင်းလဲရ။

Phase 05-B1 တွင် `compose.js` သည် provider **မထည့်ပါ**။ Port ကို Test double ဖြင့်သာ seam စမ်းထားသည် (production code path မဟုတ်)။

## API Contract

### `GET /health` → 200
```json
{ "status": "ok", "service": "mnb-translation-gateway", "version": "0.1.0" }
```

### `POST /v1/translate` (contract သတ်မှတ်ချက်)

Request (JSON, `Content-Type: application/json`, field အားလုံး လိုအပ်၊ အခြား field မရ):

| Field | စည်းမျဉ်း |
|---|---|
| `sourceLanguage` | language tag (`ja`, `zh-CN`) သို့မဟုတ် `"auto"` |
| `targetLanguage` | language tag (`"auto"` မရ) |
| `text` | string, trim ပြီး မလွတ်ရ, ≤ `MAX_TEXT_CHARS` (default 20000) |

ဤ Phase တွင် ပြန်နိုင်သော အခြေအနေများ:

| Status | `error.code` | အခါ |
|---|---|---|
| 400 | `INVALID_JSON` | Body မရှိ / JSON မမှန် |
| 400 | `INVALID_REQUEST` | Validation မအောင် (`details[]` ပါ) |
| 405 | `METHOD_NOT_ALLOWED` | POST မဟုတ် (`Allow` header ပါ) |
| 413 | `PAYLOAD_TOO_LARGE` | Body > `MAX_BODY_BYTES` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | JSON မဟုတ် |
| 501 | `NOT_IMPLEMENTED` | Valid request၊ provider မချိတ်ရသေး |
| 500 | `INTERNAL_ERROR` | မမျှော်လင့်သော အမှား (အသေးစိတ် မပြ) |

Error envelope: `{ "error": { "code", "message", "requestId", "details?" } }`။ Submitted text ကို error ထဲ ပြန်မထည့်ပါ။

**Reserved success response** (နောက် Phase အတွက်သာ — ယခု မပြန်):
`{ "requestId", "translatedText", "sourceLanguage", "targetLanguage", "provider" }`

## Cross-cutting

- **Request ID**: တောင်းဆိုမှုတိုင်းအတွက် UUID ထုတ်၍ `x-request-id` header နှင့် error body တွင် ပြန်ပေး။
- **Headers**: `cache-control: no-store`, `x-content-type-options: nosniff`။ CORS မဖွင့် (Android app သည် browser မဟုတ်)။
- **Timeouts**: `server.requestTimeout = REQUEST_TIMEOUT_MS`, `headersTimeout = min(60s, requestTimeout)`။
- **Logging**: method/path/status/duration/requestId သာ။ Body, header, secret မထည့်။
- **Shutdown**: SIGTERM/SIGINT တွင် `server.close()`၊ ၁၀ စက္ကန့်အတွင်း မပြီးပါက force exit။

## Configuration

`loadConfig(env)` သည် pure function ဖြစ်ပြီး ပြဿနာအားလုံးကို စုပေါင်း၍ `ConfigError` ပစ်သည် (variable **အမည်** နှင့် အကြောင်းရင်းသာ — တန်ဖိုးမပါ)။

| Variable | Default (dev / prod) | မှတ်ချက် |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `PORT` | `8080` / **မရှိ (REQUIRED)** | Production တွင် မသတ်မှတ်လျှင် startup fail |
| `HOST` | `127.0.0.1` / `0.0.0.0` | |
| `LOG_LEVEL` | `debug` / `info` | `silent`…`debug` |
| `MAX_BODY_BYTES` | 1048576 | 1 – 10485760 |
| `REQUEST_TIMEOUT_MS` | 30000 | 1000 – 600000 |
| `MAX_TEXT_CHARS` | 20000 | 1 – 1000000 |

Secrets သည် `config` object ထဲ မပါ။ `SecretProvider` interface (`get` / `require`) နှင့် `Secret` wrapper (string/JSON/inspect တွင် `[REDACTED]`) ကိုသာ ပေးထားပြီး 05-B1 တွင် မည်သည့် code မှ secret မဖတ်ပါ။

## ရည်ရွယ်ချက်ရှိရှိ မလုပ်ထားသည်များ (Out of scope)

Authentication, Gemini adapter, retry, quota/rate limiting, Android integration, persistence, deploy configuration file။
