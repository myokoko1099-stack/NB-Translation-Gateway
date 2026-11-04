# HOSTING-DECISION.md — Phase 05-B1

စစ်ဆေးသည့်ရက်: 2026-11-04

## ရွေးချယ်မှု

| | ရွေးချယ်ချက် |
|---|---|
| Hosting | **Render — Free web service** (candidate; final confirmation သည် user ၏ signup အပေါ် မူတည်) |
| Runtime | **Node.js ≥ 20** (စမ်းသပ်ထားသည်: v22.23.4), dependency 0 ခု (`node:http` သာ) |

Runtime ကို plain Node HTTP server ရွေးရခြင်းမှာ Free-tier host အများစုက long-running web process ကို ပံ့ပိုးပြီး Provider/SDK ချိတ်ဆက်မှုကို နောက်ပိုင်း ထည့်ရလွယ်ကူလို့ ဖြစ်သည်။ Host ပြောင်းလိုပါက `PORT` env ဖတ်ပြီး `0.0.0.0` ကို bind လုပ်နိုင်သော host မည်သည့်အရာမဆို သုံးနိုင်သည်။

## စစ်ဆေးချက် (Official docs: render.com/docs/free, /docs/web-services, /docs/configure-environment-variables)

| လိုအပ်ချက် | အခြေအနေ | အထောက်အထား |
|---|---|---|
| Free web service ရှိခြင်း | **VERIFIED** | `/docs/free` — web service ကို free instance အဖြစ် deploy နိုင်ကြောင်း ဖော်ပြထား |
| HTTPS | **VERIFIED** | `/docs/web-services` — load balancer က TLS ကို ရပ်ပေးပြီး HTTP→HTTPS redirect လုပ်သည်။ `/docs/free` — free web service တွင် managed TLS certificate ပံ့ပိုး |
| HTTP API (Node server) | **VERIFIED** | `0.0.0.0` ပေါ်တွင် bind လုပ်ရမည်၊ `PORT` env (default 10000) အသုံးပြုရန် အကြံပြု |
| Environment variables | **VERIFIED** | Dashboard → Environment page တွင် သတ်မှတ်နိုင် |
| Secret ကို source code ပြင်ပတွင် ထားနိုင်ခြင်း | **VERIFIED** | Dashboard ထည့်သွင်းခြင်း၊ Blueprint `sync: false` (value ကို file ထဲ မထည့်ရ) |
| Secret value များကို Dashboard တွင် ဝှက်ထား/ at-rest encrypted ဖြစ်ခြင်း | **UNVERIFIED** | Docs စာမျက်နှာက မဖော်ပြ |
| Request timeout | **UNVERIFIED** | "HTTP request 100 မိနစ်" ဟူသော အချက်ကို Render ၏ article နှင့် community post များတွင်သာ တွေ့ရ။ `/docs/web-services` တွင် မပါ။ Gateway ၏ ကိုယ်ပိုင် `REQUEST_TIMEOUT_MS` (default 30s) ကို သုံးထားသည် |
| Billing info မထည့်ဘဲ စတင်နိုင်ခြင်း | **UNVERIFIED** | Official docs က payment method မထည့်ထားလျှင် အသုံးပြုမှုကျော်ပါက Free service ကို suspend လုပ်မည်ဟု ဖော်ပြထား (billing မဖြစ်စေ) — ဤအချက် **VERIFIED**။ သို့သော် signup တွင် card မတောင်းကြောင်း တိတိကျကျ ဖော်ပြချက်ကို third-party ဆိုက်များတွင်သာ တွေ့ရပြီး တစ်ခုမှာ web service အတွက် card လိုသည်ဟု ဆိုထား (ပဋိပက္ခရှိ) → **user က signup တွင် ကိုယ်တိုင် အတည်ပြုရမည်။ Card တောင်းပါက ရပ်ပြီး Render ကို မရွေးပါနှင့်** |
| Node.js version support | **UNVERIFIED** | Docs က version မဖော်ပြ။ `engines: node >=20` ကို ကျွန်ုပ်တို့ကသာ ကြေညာထားသည် |

## Free tier ကန့်သတ်ချက်များ (official docs အရ — Verified)

- **Spin-down**: ၁၅ မိနစ် traffic မရှိလျှင် ရပ်သွားပြီး နောက် request တွင် ပြန်ထမ်းရန် **ခန့်မှန်း ၁ မိနစ်** ကြာသည် (Android app ၏ ပထမ request တွင် timeout/UX သက်ရောက်မည်)။
- **750 free instance hours / လ / workspace**; ကုန်လျှင် Free service များ suspend။
- Outbound bandwidth ကုန်လျှင် payment method မရှိပါက suspend (billing မဖြစ်)။
- **Service-initiated traffic threshold**: ပြင်ပ API (နောက်ပိုင်း Gemini) ကို ခေါ်သည့် traffic အလွန်များပါက Render က suspend လုပ်နိုင်သည်။ ထို့ကြောင့် Phase ၀၅-B2+ တွင် အရေးကြီးသော အန္တရာယ် — threshold ကိန်းဂဏန်း **UNVERIFIED**။
- Filesystem ephemeral (restart/redeploy/spin-down တွင် ပျက်)။ Gateway သည် disk ကို မသုံးပါ။
- Render က Free service ကို မည်သည့်အချိန်မဆို restart လုပ်နိုင်သည်။
- Single instance သာ (scale မရ)။ Shell/SSH access မရ။
- SMTP ports (25/465/587) outbound ပိတ်။

## Deploy အဆင့်များ (မလုပ်ရသေး — Phase 05-B1 တွင် deploy မလုပ်ပါ)

1. Render account ဖန်တီးပြီး **card မတောင်းကြောင်း** အတည်ပြုပါ။
2. New → Web Service → Git repo ချိတ်ပါ၊ Compute plan = **Free** ကို ရွေးပါ။
3. Build command: `npm install` (dependency မရှိသဖြင့် ချက်ချင်းပြီးမည်)၊ Start command: `npm start`။
4. Environment: `NODE_ENV=production` (`PORT` ကို Render က ထည့်ပေးသည်)။
5. Health check path: `/health` (ရွေးချယ်နိုင်)။

## သတိပြုရန်

- ဤစာရွက်သည် **Hosting ရွေးချယ်မှုတစ်ခုကို အကြံပြုချက်** ဖြစ်ပြီး Deploy မလုပ်ရသေးသဖြင့် အစစ်အမှန် Render ပေါ်တွင် အလုပ်လုပ်ကြောင်း **မစစ်ဆေးရသေး**။
- Render ၏ Free-tier စည်းမျဉ်းများသည် ပြောင်းလဲနိုင်သည်။ Deploy မတိုင်မီ `render.com/docs/free` ကို ပြန်စစ်ပါ။
- ရွေးကြည့်ပြီး ပယ်ချခဲ့သည်များ: **Koyeb** (2026 ခုနှစ်တွင် card + $29 pre-authorization လိုသည်ဟု ဆိုင်ရာ FAQ/ဆောင်းပါးများတွင် တွေ့ရ → ပယ်)၊ **Cloudflare Workers** (Free plan CPU time 10 ms / request အတွက် official limits docs တွင် ဖော်ပြထားပြီး `node:http` server ကို တိုက်ရိုက်မလည်ပတ်နိုင်သဖြင့် Fetch-handler အဖြစ် ပြန်ရေးရမည် — နောက်ပိုင်း Phase တွင် ပြန်စဉ်းစားနိုင်)။
