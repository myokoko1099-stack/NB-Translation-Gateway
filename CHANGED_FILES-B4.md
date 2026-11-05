# CHANGED_FILES-B4.md — Phase 05-B4 (base: `main` @ `c538ef8`)

## အသစ် (Added)

| ဖိုင် | ရည်ရွယ်ချက် |
|---|---|
| `test/productionGuardStartup.test.js` | Production Guard စည်းမျဉ်း unit test + `src/index.js` startup (child process) test — 24 case |
| `B4-REPORT.md` | Phase report |
| `CHANGED_FILES-B4.md` | ဤဖိုင် |

## ပြင်ဆင် (Modified)

| ဖိုင် | ပြောင်းလဲချက် |
|---|---|
| `src/index.js` | `assertProductionConfig(config, auth)` ကို `loadAuthConfig()` နောက်၊ ရှိပြီးသား `try/catch (ConfigError)` ထဲတွင် ခေါ် (import ၁ ကြောင်း + ခေါ်ချက် ၁ ကြောင်း + comment) |
| `src/config/productionGuard.js` | `MIN_CLIENT_TOKEN_LENGTH = 16`၊ token အလျားနှင့် စာလုံးတစ်လုံးတည်း စစ်ဆေးချက်၊ doc comment (B4 active) |
| `.env.example` | `LOG_LEVEL` နှင့် `GATEWAY_CLIENT_TOKEN` အတွက် production guard ဆိုင်ရာ **comment** သာ (variable / တန်ဖိုး မထည့်) |
| `README.md` | B4 အခြေအနေ၊ Production Guard အပိုင်းသစ်၊ Run / Authentication / Test / Configuration / docs table / Scope ကို အမှန်နှင့် ကိုက်အောင် ပြင် |
| `SECURITY-NOTES.md` | B4 အထိ update၊ Guard ကို "မချိတ်" မှ "active" သို့ ပြင်၊ limitation၊ verification |
| `TERMUX-PUSH-GUIDE.md` | B2.4 အတွက်ဖြစ်သော guide ကို B4 (မြန်မာ) ဖြင့် အစားထိုး |

## မထိပါ

`src/infrastructure/providers/*` (Gemini Provider)၊ `src/config/{auth,config,secrets,profiles,translationProvider}.js`၊ `src/infrastructure/http/*`၊ `src/domain/*`၊ `test/productionGuard.test.js` (ရှိပြီးသား၊ မပြောင်း)၊ အခြား test ဖိုင်အားလုံး၊ `package.json` (dependency မထည့်)၊ `.github/` workflow၊ ယခင် phase စာရွက်များ (`B2.4-REPORT.md`, `ARCHITECTURE.md` စသည်)။

## Deliverable များ (repo ၏ ပြင်ပ)

`B4.patch` (Unified Diff — အထက်ပါ ၉ ဖိုင်စလုံး)၊ `B4.zip` (အထက်ပါ ၉ ဖိုင်သာ၊ repo path အတိုင်း)။ ၎င်းတို့ကို repo ထဲ commit မလုပ်ရ။
