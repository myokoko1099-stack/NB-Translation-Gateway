# CHANGED_FILES-B3.md — Phase 05-B3 (base commit `b944e9c`)

## အသစ် (Added)

| ဖိုင် | ရည်ရွယ်ချက် |
|---|---|
| `src/config/translationProvider.js` | `TRANSLATION_PROVIDER` / `GEMINI_*` config (Gemini key ကို ဖတ်ခွင့်ရှိသော တစ်ခုတည်းသော module) |
| `src/infrastructure/providers/geminiProvider.js` | Gemini Interactions API adapter + error mapping |
| `src/infrastructure/providers/geminiPrompt.js` | `system_instruction` / `input` တည်ဆောက်ခြင်း |
| `src/infrastructure/providers/createProvider.js` | provider factory (`none` → null) |
| `test/geminiConfig.test.js` | Configuration / Provider Selection / Model Selection tests |
| `test/geminiProvider.test.js` | Provider unit tests (mock fetch) |
| `test/geminiGateway.test.js` | HTTP integration + regression tests (mock fetch) |
| `B3-REPORT.md` | Phase report |
| `CHANGED_FILES-B3.md` | ဤဖိုင် |

## ပြင်ဆင် (Modified)

| ဖိုင် | ပြောင်းလဲချက် |
|---|---|
| `src/index.js` | provider config load၊ Logger သို့ secrets ပေး၊ `createProvider` → `buildApp` |
| `src/infrastructure/http/server.js` | `errorResponse.js` (`toClientError`) နှင့် `describeError` ကို catch block တွင် သုံး |
| `src/infrastructure/http/compose.js` | default logger သို့ `auth.token` scrub (comment ပြင်) |
| `test/secret-exposure.test.js` | `*_API_KEY` regex ပြင်၊ B3 အတွက် Gemini key reader test ပြောင်း |
| `.env.example` | `TRANSLATION_PROVIDER`, `GEMINI_API_KEY` (ဗလာ), `GEMINI_MODEL`, `GEMINI_TIMEOUT_MS` |
| `README.md` | B3 အခြေအနေ၊ Translation Provider အပိုင်း၊ Configuration၊ docs table |
| `SECURITY-NOTES.md` | B3 အထိ update၊ `productionGuard.js` မချိတ်ကြောင်း မှန်ကန်စွာ ပြင် |

## မထိပါ

`src/application/translateService.js`, `src/ports/translationProvider.js`, `src/domain/*`, `src/config/productionGuard.js` (မချိတ်), `package.json` (dependency မထည့်), `.github/` workflow, Request schema။
