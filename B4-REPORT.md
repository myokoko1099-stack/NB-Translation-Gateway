# Phase 05-B4 — Production Guard Activation (Report)

- Project: NB-Translation-Gateway
- Base: `main` @ `c538ef8` (Phase 05-B3 merge, PR #6)
- Git commit / push / pull request: မလုပ်ပါ
- **Test: Local တွင် မ run ပါ။ GitHub Actions (Node 20 / 22) ၏ ရလဒ်ကို စောင့်ရမည်။** ဤ report သည် test အောင်မြင်ကြောင်း မဆိုပါ။

## 1. အခြေအနေ — ပြီးစီး / မပြီးသေး

| အချက် | အခြေအနေ |
|---|---|
| `productionGuard.js` ကို `src/index.js` startup flow နှင့် ချိတ်ဆက်ခြင်း | ပြီး |
| Placeholder client token ပယ်ချခြင်း (production) | ပြီး (B2.4 စာရင်းကို အမှန်တကယ် active ဖြစ်စေ) |
| မလုံခြုံသော client token ပယ်ချခြင်း (၁၆ လုံးအောက်၊ စာလုံးတစ်လုံးတည်း) | ပြီး (B4 တွင် ထည့်) |
| `LOG_LEVEL=debug` ပယ်ချခြင်း (production) | ပြီး |
| Development / Test အလုပ်လုပ်ပုံ မပြောင်းခြင်း | code အရ မပြောင်း၊ test ရေးထား၊ **မ run ရသေး** |
| Startup failure တွင် secret မထွက်ခြင်း | code အရ အာမခံ၊ test ရေးထား၊ **မ run ရသေး** |
| Test အသစ် `test/productionGuardStartup.test.js` (24 case) | ရေးပြီး၊ **မ run ရသေး** |
| README / SECURITY-NOTES / `.env.example` / ဤ report / CHANGED_FILES-B4 / TERMUX-PUSH-GUIDE | ပြင်ပြီး |
| Gemini Provider၊ dependency၊ API key၊ scope ပြင်ပ refactor | မထိပါ |

## 2. Implemented

### `src/index.js`
`assertProductionConfig(config, auth)` ကို `loadAuthConfig()` ၏ နောက်၊ `loadTranslationProviderConfig()` ၏ အရင်တွင် ရှိပြီးသား `try { … } catch (ConfigError)` block ထဲ ထည့်သည်။ ထို့ကြောင့် Guard ပျက်ကွက်လျှင် ရှိပြီးသား လမ်းကြောင်းအတိုင်း `err.message` ကို stderr သို့ ရေးပြီး `exit 1` ဖြစ်သည်။ Logger၊ Provider၊ HTTP server မဖန်တီးရသေးသဖြင့် port မဖွင့်ပါ။ Architecture (config → auth → provider → logger → server) မပြောင်းပါ။

### `src/config/productionGuard.js`
- B2.4 ၏ စစ်ဆေးချက်များ (token မရှိ၊ placeholder၊ `LOG_LEVEL=debug`) ကို မပြောင်းပါ။
- ထပ်ထည့်သည်: `MIN_CLIENT_TOKEN_LENGTH = 16` (export)၊ token ၁၆ လုံးအောက်ကို ပယ်ချ၊ `new Set(token).size === 1` ဖြစ်သော token ကို ပယ်ချ။
- Placeholder ဖြစ်လျှင် problem တစ်ခုတည်း ပြသည် (အလျား/ထပ်ခါထပ်ခါ စစ်ချက်ကို ထပ်မပြ)။
- Problem စာသား အားလုံးတွင် variable နာမည်နှင့် အကြောင်းရင်းသာ ပါသည်။ Environment variable အသစ် မရှိ။

### Docs
README (Production Guard အပိုင်းအသစ်၊ Run / Authentication / Test / Configuration / Scope / docs table)၊ SECURITY-NOTES (Production configuration အပိုင်းကို "မချိတ်" မှ "active" သို့ ပြင်၊ limitation နှင့် verification)၊ `.env.example` (comment သာ)။ ယခင် B3 တွင် "မချိတ်" ဟု ရေးထားသော စာများကို ယခု အမှန်တကယ်နှင့် ကိုက်အောင် ပြင်ထားသည်။

## 3. ဆုံးဖြတ်ချက်များ (သင်ကိုယ်တိုင် စစ်ပါ)

1. **Token အနိမ့်ဆုံး ၁၆ လုံး + စာလုံးတစ်လုံးတည်း** — ညွှန်ကြားချက်၏ "မလုံခြုံသော client token" ကို ဖော်ပြရန် ကျွန်ုပ်ထည့်သော စည်းမျဉ်းသစ်ဖြစ်ပြီး B2.4 module တွင် မပါခဲ့ပါ။ ရှိပြီးသား `productionGuard.test.js` ၏ token များ (၁၈ လုံး၊ ၃၀ လုံး) သည် ဆက်အောင်မြင်သင့်သည်။ **လက်ရှိ production token ၁၆ လုံးအောက် ဖြစ်နေလျှင် deploy လုပ်သည်နှင့် server မစတင်တော့ပါ** — Deploy မတိုင်မီ စစ်ပါ။ ၁၆ ကို မလိုလျှင် `MIN_CLIENT_TOKEN_LENGTH` တစ်နေရာတည်းတွင် ပြင်နိုင်သည်။
2. **Guard နေရာ** — `loadAuthConfig` ၏ နောက်၊ provider config ၏ အရင်။ Guard ပြဿနာနှင့် `GEMINI_API_KEY` ပြဿနာ နှစ်ခုလုံး ရှိလျှင် Guard ၏ ပြဿနာကို အရင်ပြမည် (တစ်ခုပြင်ပြီးမှ နောက်တစ်ခု ပေါ်မည်)။
3. **`GEMINI_API_KEY`** ကို Guard က မစစ်ပါ (placeholder key ကို မတားနိုင်)။ ညွှန်ကြားချက်တွင် client token သာ ပါသဖြင့် scope မချဲ့ပါ။
4. **Test အသစ်ကို ဖိုင်သစ်တစ်ခုတွင်** ထည့်ပြီး `test/productionGuard.test.js` ကို မပြင်ပါ (ရှိပြီးသား test မပျက်စေရန်)။

## 4. Tests

### အသစ် — `test/productionGuardStartup.test.js` (24 case)

| အုပ်စု | Case | အကျုံးဝင်သည်များ |
|---|---|---|
| Guard rules — client token | 8 | အနိမ့်ဆုံးအရှည် (အတိအကျ ၁၆ လုံးအောင်၊ ၁၅ လုံးကျ)၊ စာလုံးတစ်လုံးတည်း၊ placeholder (အကြီးအသေးမခွဲ၊ `<…>`၊ `${…}`)၊ placeholder ကို တစ်ကြိမ်သာ ပြ၊ token မရှိသော ပုံစံ ၄ မျိုး၊ message ထဲ token မပါ |
| Guard rules — LOG_LEVEL | 2 | `debug` ပယ်ချ၊ `silent/error/warn/info` လက်ခံ |
| Aggregation / environments | 4 | problem အားလုံး တစ်ခါတည်း၊ `ConfigError.problems`၊ မှန်သော config မ throw၊ development/test ကို မစစ်ဘူး (token အမျိုးမျိုး + debug) |
| Startup — production (child process) | 8 | placeholder / တိုလွန်း / စာလုံးတစ်လုံးတည်း / `LOG_LEVEL=debug` / problem အားလုံး / token မရှိ → `exit 1`၊ stderr စာသား၊ stdout/stderr တွင် token မပါ၊ `server started` မထွက်၊ မှန်သော config နှင့် `LOG_LEVEL` မသတ်မှတ်ခြင်းတို့ ပုံမှန်စတင် |
| Startup — development / test (child process) | 2 | `NODE_ENV=test` + placeholder token + `LOG_LEVEL=debug` စတင်နိုင်၊ development token မရှိ စတင်နိုင် (warning log) |

Child-process test များသည် `test/geminiConfig.test.js` ၏ ပုံစံ (`spawnSync`) ကို လိုက်ပြီး စတင်သည့် case များတွင် `PORT=0` ဖြင့် `server started` log ကို စောင့်ကာ SIGTERM ဖြင့် ရပ်သည်။ Network မခေါ် (provider `none`)၊ Real secret မသုံး။

### Tests Passed
**မရှိ / အတည်မပြုနိုင်သေး** — Local တွင် test မ run ပါ။

### Tests Failed
**မသိရသေး** — မ run ရသေးသဖြင့် "မကျ" ဟုလည်း မဆိုနိုင်ပါ။ CI ရလဒ် ပြန်ပို့ပါ။

### မစမ်းသပ်ရသေးသည်များ
- Test အားလုံး (အသစ် ၂၄ ခု၊ ရှိပြီးသား test အားလုံး) — Node 20 နှင့် 22 အပေါ်။ အထူးသဖြင့် child process၊ SIGTERM၊ `PORT=0` + `0.0.0.0` bind လုပ်သော case များသည် CI environment ပေါ် မူတည်နိုင်သည်။
- အမှန်တကယ် hosting (Render စသည်) ပေါ်တွင် Guard ၏ error ကို dashboard log ၌ မြင်ရခြင်း။
- `.github/` workflow ကို မဖတ်ခဲ့ပါ (`npm test` ကို Node 20/22 တွင် run သည်ဟု ယခင် report များအရ ယူဆထား)။

## 5. Security

- Guard ၏ error message များသည် variable နာမည် + အကြောင်းရင်း သာ။ Token တန်ဖိုး / တစ်စိတ်တစ်ပိုင်း မပါ (test ဖြင့် ပြဋ္ဌာန်းထား)။
- Guard သည် Logger မဖန်တီးမီ ပျက်ကွက်ပြီး stderr သို့ ConfigError message သာ ရေးသဖြင့် failure path တွင် secret သည် log သို့ ရောက်မည့် လမ်းကြောင်း မရှိ။ Logger ဖန်တီးပြီးနောက် B3 ၏ exact-value scrubbing ဆက်ရှိ။
- API key / token ကို source ထဲ မထည့်ပါ။ Test ထဲရှိ token များသည် ပုံဆောင်စာသားများသာ ဖြစ်ပြီး `test/secret-exposure.test.js` ၏ pattern များနှင့် static scan ဖြင့် ကိုက်ညီမှု မရှိကြောင်း စစ်ပြီး။
- Dependency အသစ် မရှိ။ `package.json` မထိ။

### Security Risks / Known Limitations
- Guard သည် startup စစ်ဆေးမှုသာ — ရှည်လျားပြီး ကွဲပြားသော်လည်း ခန့်မှန်းလွယ်သော token (ဥပမာ `abcdefghijklmnop`) ကို မတားနိုင်။ Entropy မတိုင်းပါ။
- `GEMINI_API_KEY` ကို မစစ်ပါ။ HTTPS origin ကို မတောင်းဆိုပါ။
- Placeholder စာရင်းသည် ပုံသေ စာရင်းသာ (B2.4 မှ မပြောင်း)။
- Hosting platform တစ်ခုသည် failure stderr ကို မမြင်ရသော log သို့ ပို့လျှင် ပြဿနာ ရှာရခက်နိုင်သည် (Render ၏ Logs တွင် စစ်ပါ)။

## 6. Behaviour ပြောင်းလဲမှု (မှတ်တမ်း)

1. Production တွင် `LOG_LEVEL=debug` / placeholder token / ၁၆ လုံးအောက် token / စာလုံးတစ်လုံးတည်း token ဖြင့် **မစတင်တော့ပါ** (ယခင်က စတင်ခဲ့)။
2. Development / Test — မပြောင်းပါ။
3. HTTP behaviour၊ request pipeline၊ Gemini provider — မပြောင်းပါ။

## 7. ပြင်ဆင်ထားသော ဖိုင်များကို ဖတ်ရာတွင်

ဖတ်ထားသောဖိုင်: `src/index.js`၊ `src/config/{productionGuard,auth,config,secrets,profiles}.js`၊ `src/domain/errors.js`၊ `src/infrastructure/logging/logger.js`၊ `test/{productionGuard,secret-exposure,helpers,geminiConfig,auth,httpSecurity.integration}.test.js` (နှင့် helpers)၊ `README.md`၊ `SECURITY-NOTES.md`၊ `.env.example`၊ `TERMUX-PUSH-GUIDE.md`၊ `B3-REPORT.md`၊ `CHANGED_FILES-B3.md`၊ `package.json`။

**မဖတ်/မပြင်ခဲ့ပါ**: `ARCHITECTURE.md`၊ `B2.4-REPORT.md`၊ `B2.4.patch` စသည့် ယခင် phase စာရွက်များ — ၎င်းတို့တွင် Guard "မချိတ်ရသေး" သို့မဟုတ် "active" ဟု ဖော်ပြချက်များ ကျန်နေနိုင်သည် (ယခင် phase အချိန်က မှတ်တမ်းများ)။ `config.test.js`၊ `rateLimit.test.js` စသည့် အခြား test ဖိုင်များကိုလည်း အပြည့်မဖတ်ပါ — သို့သော် Guard ကို `src/index.js` တွင်သာ ခေါ်သဖြင့် in-process test များ (`startTestServer` / `buildApp`) ကို မသက်ရောက်ပါ။

## 8. အတည်ပြုပြီးသည်များ (Local၊ test မဟုတ်)

- `node --check` (syntax သာ): `productionGuard.js`၊ `index.js`၊ `productionGuardStartup.test.js`။
- `test/secret-exposure.test.js` ၏ pattern များနှင့် တူသော static scan: ပြင်ထား/ထည့်ထားသော source၊ test၊ `.env.example` တို့တွင် ကိုက်ညီမှု မရှိ။
- Patch ၏ base ဖိုင် ၆ ခုကို GitHub မှ ဖတ်ပြီး ပြန်တည်ဆောက်ရာ `git hash-object` သည် GitHub ၏ blob SHA နှင့် **အတိအကျတူ** ကြောင်း စစ်ပြီး။
- `B4.patch` ကို base ဖိုင်များပါသော ယာယီ git repo တွင် `git apply --check` လုပ်ပြီး (သင့် repo တွင်လည်း `git apply --check` ကို ထပ်လုပ်ပါ)။

## 9. ဖိုင်စာရင်း

`CHANGED_FILES-B4.md` ကို ကြည့်ပါ။
