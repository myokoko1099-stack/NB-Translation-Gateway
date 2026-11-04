# SECURITY-NOTES.md — Phase 05-B1

## Secret handling

- Source code, tests, docs, `.env.example` တွင် API key အစစ် **မပါ**။ API key အစစ်ကို တောင်းလည်း မတောင်းထား။
- `GEMINI_API_KEY` ကို 05-B1 source code တစ်ခုမှ မဖတ်ပါ (test ဖြင့် စစ်ထား)။ `.env.example` တွင် comment အဖြစ်သာ၊ တန်ဖိုးမပါ။
- နောက် Phase တွင် Key ကို hosting dashboard ၏ environment variable အဖြစ်သာ ထည့်ရမည်။ Android app ထဲ မထည့်ရ။
- `.gitignore`: `.env`, `.env.*` (`.env.example` မှလွဲ), `*.pem`, `*.key`, `*.p12`, `*.pfx`, `secrets/`, `*.secret(s)`, `service-account*.json`။
- `Secret` wrapper: `String()`, `JSON.stringify`, `util.inspect` တွင် `[REDACTED]` ပြသည်။ `reveal()` ကိုသာ တန်ဖိုးယူနိုင်။
- `ConfigError` မက်ဆေ့ချ်တွင် variable အမည်သာ ပါပြီး တန်ဖိုး မပါ (test ဖြင့် စစ်ထား)။

## Request / data handling

- Novel text သည် သုံးစွဲသူ၏ content ဖြစ်နိုင်သဖြင့် **log မထည့်** နှင့် **error response ထဲ ပြန်မထည့်** (test ဖြင့် စစ်ထား)။
- Body size limit (413)၊ Content-Type စစ်ဆေးခြင်း (415)၊ unknown field ပယ်ခြင်း (strict schema)၊ text length limit။
- Stack trace / internal message ကို client သို့ မပို့ (500 တွင် generic message)။
- `x-content-type-options: nosniff`, `cache-control: no-store`။

## Known security gaps (ရည်ရွယ်ချက်ရှိရှိ — နောက် Phase)

| Gap | အကျိုးသက်ရောက်မှု | ဖြေရှင်းမည့် Phase |
|---|---|---|
| **Authentication မရှိ** | `/v1/translate` ကို မည်သူမဆို ခေါ်နိုင် | Auth phase |
| **Rate limit / quota မရှိ** | Provider ချိတ်ပြီးနောက် ကုန်ကျစရိတ်/quota abuse ဖြစ်နိုင် | Quota phase |
| Anti-abuse (IP throttling) မရှိ | Free-tier hours/bandwidth ကုန်စေနိုင် | Quota phase |
| Provider မချိတ်ရသေးသဖြင့် 05-B1 ကို **public ဖွင့် deploy** မလုပ်သင့် (Health သာ အသုံးဝင်) | — | — |
| TLS | Host (Render) က ရပ်ပေး — application မှာ plain HTTP (Verified, `/docs/web-services`) | — |
| Secret at-rest encryption (Render dashboard) | **UNVERIFIED** | Deploy မတိုင်မီ |

## Secret exposure check (automated — `test/secret-exposure.test.js`)

Project ဖိုင်အားလုံးကို scan: Google API key (`AIza…`), private key block, GitHub token, `sk-…` style key, AWS key id, `*_API_KEY=<value>` assignment။ `.env.example` တွင် key/secret/token/password တန်ဖိုးမရှိကြောင်း၊ `.gitignore` လိုအပ်သည့် rule များ ရှိကြောင်း၊ `.env`/key ဖိုင်များ tree ထဲ မရှိကြောင်း၊ HTTP response နှင့် log တွင် sentinel secret မပေါ်ကြောင်း စစ်သည်။

**ကန့်သတ်ချက်**: pattern-based scan သာ ဖြစ်သည်။ Format မကိုက်သော secret ကို မဖမ်းနိုင်။ Git history ကို ဤ project တွင် မစစ်ရ (repo မရှိ)။ Commit မတိုင်မီ `git secrets` / GitHub secret scanning ကို သီးခြား run ရန် အကြံပြု။
