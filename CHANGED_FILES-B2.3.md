# CHANGED_FILES — Phase 05-B2.3 (HTTP Security)

Base: `main` @ `8e3d63382f9559ee2187abd6da48754bbe88001a`

## ဖိုင်အသစ် (New)

| ဖိုင် | ရည်ရွယ်ချက် |
|---|---|
| `src/infrastructure/http/cors.js` | CORS allowlist policy (origin စစ်ခြင်း၊ preflight) |
| `src/infrastructure/http/securityHeaders.js` | Security headers (response အားလုံး) |
| `src/infrastructure/http/httpProtection.js` | Content-Type 415၊ Body size 413၊ Body timeout 408၊ JSON parse |
| `B2.3-REPORT.md` | Phase 05-B2.3 report |
| `CHANGED_FILES-B2.3.md` | ဤဖိုင် |

## ပြင်ဆင်သောဖိုင် (Modified)

| ဖိုင် | ပြောင်းလဲမှု |
|---|---|
| `src/infrastructure/http/server.js` | CORS အဆင့်နှင့် preflight ထည့်၊ Security headers + `Vary: Origin` အားလုံးတွင်၊ `readJsonBody` ကို `httpProtection.js` သို့ ရွှေ့၊ `204` sender |
| `src/config/config.js` | `GATEWAY_CORS_ALLOWED_ORIGINS` parse / validate၊ `config.cors.allowedOrigins` |
| `src/index.js` | Startup log တွင် `corsAllowedOrigins` (အရေအတွက်) တစ်ကြောင်းထည့် |
| `.env.example` | CORS section ထည့် (B2.3 header) |
| `README.md` | B2.3 အပိုင်းများ၊ pipeline၊ docs table၊ base commit ပြင် |

## မပြောင်းသောဖိုင်များ

`src/infrastructure/http/{compose,auth,clientIp,rateLimiter}.js`, `src/config/{auth,profiles,secrets}.js`, `src/domain/*`, `src/application/*`, `src/ports/*`, `src/meta.js`, `test/*`, `package.json`, `ARCHITECTURE.md`, `SECURITY-NOTES.md`, `HOSTING-DECISION.md`, B1 / B2.1 / B2.2 report များ။

## မပြီးသေးသော Test Files

`test/cors.test.js`, `test/securityHeaders.test.js`, `test/httpProtection.test.js` နှင့် `test/config.test.js` ထပ်ထည့်ရန် — **အားလုံး မရေးရသေး / မလည်ရသေး**။ ဤ Phase ၏ ဖိုင်စာရင်းတွင် မပါပါ။ အသေးစိတ်ကို `B2.3-REPORT.md` တွင် ကြည့်ပါ။

## မှတ်ချက်

- Project Folder (`/home/claude`) သည် အစပိုင်းတွင် ဗလာဖြစ်၍ Repository ကို session ထဲ ချိတ်မရသဖြင့် (GitHub account မချိတ်ရသေး) အထက်ပါ ဖိုင်များကိုသာ repo နှင့် တူညီသော လမ်းကြောင်းအတိုင်း ရေးထားသည်။ ကျန်ဖိုင်များ မပါပါ။
- Commit / Push / PR မလုပ်ရသေး။ ZIP မထုတ်။
