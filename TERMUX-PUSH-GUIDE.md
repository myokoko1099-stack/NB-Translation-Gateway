# Termux Git Push Guide — Phase 05-B4 (Production Guard Activation)

> Test များကို GitHub Actions တွင်သာ run မည်။ ဤ Phase တွင် Termux ၌ `npm test` မ run ပါနှင့်။

Base: `main` (Phase 05-B3 merge commit `c538ef8` — PR #6)။

## ၁။ Branch အသစ် ဖွင့်ခြင်း

```bash
cd ~/NB-Translation-Gateway
git status --short
git switch main
git pull origin main
git log -1 --format=%h
git switch -c phase-05-b4-production-guard-activation
```

`git status --short` သည် ဗလာ ဖြစ်ရမည်။ `git log -1 --format=%h` သည် `c538ef8` (သို့မဟုတ် ၎င်းနောက်ပိုင်း commit) ပြရမည်။

## ၂။ ပြင်ဆင်ချက်များ ထည့်ခြင်း — နည်းလမ်း **တစ်ခုသာ** ရွေးပါ

ဖိုင်များကို Android ၏ Downloads (`~/storage/downloads`) သို့ ဒေါင်းလုဒ်လုပ်ထားပါ (`/tmp` ကို Termux တွင် ရေးမရသဖြင့် မသုံးပါ)။

### နည်းလမ်း A — Patch (အကြံပြု)

```bash
cd ~/NB-Translation-Gateway
git apply --check ~/storage/downloads/B4.patch
```

Check အောင်မြင်လျှင်သာ:

```bash
git apply ~/storage/downloads/B4.patch
git status --short
git diff --stat
```

`git apply --check` တွင် error ပြလျှင် **ရပ်ပါ**၊ error စာသားကို ပို့ပါ။ `--force` / `--reject` မသုံးပါနှင့်။

### နည်းလမ်း B — ZIP

`B4.zip` ထဲတွင် ပြင်ဆင်ထားသော ဖိုင်များသာ ပါပြီး repo ထဲမှ path အတိုင်း စီထားသည် (repo တစ်ခုလုံး မပါ)။

```bash
mkdir -p ~/storage/downloads/B4
unzip -o ~/storage/downloads/B4.zip -d ~/storage/downloads/B4
cp -r ~/storage/downloads/B4/. ~/NB-Translation-Gateway/
cd ~/NB-Translation-Gateway
git status --short
git diff --stat
```

`cp -r .../B4/. ...` ကို အဆုံးတွင် `/.` ပါအောင် ရေးပါ (`.env.example` ကဲ့သို့ dot-file များပါ ကူးရန်)။ နည်းလမ်း A ကို သုံးပြီးလျှင် B ကို ထပ်မလုပ်ပါနှင့်။

## ၃။ ဖိုင်စာရင်း မှန်/မမှန် စစ်ခြင်း

`git status --short` တွင် အောက်ပါ ၉ ဖိုင်သာ ပေါ်ရမည်။

```
 M .env.example
 M README.md
 M SECURITY-NOTES.md
 M TERMUX-PUSH-GUIDE.md
 M src/config/productionGuard.js
 M src/index.js
?? B4-REPORT.md
?? CHANGED_FILES-B4.md
?? test/productionGuardStartup.test.js
```

ဤစာရင်းအပြင် ဖိုင်တစ်ခုခု ပါလာလျှင် commit မလုပ်ဘဲ ပို့ပြပါ။ `B4.patch` / `B4.zip` ကို repo ထဲ မကူးပါနှင့်။

## ၄။ Commit နှင့် Push

```bash
git add .env.example README.md SECURITY-NOTES.md TERMUX-PUSH-GUIDE.md \
  src/config/productionGuard.js src/index.js \
  test/productionGuardStartup.test.js \
  B4-REPORT.md CHANGED_FILES-B4.md
git status --short
git commit -m "feat: Phase 05-B4 production guard activation"
git push -u origin phase-05-b4-production-guard-activation
```

## ၅။ Pull Request

GitHub တွင် `phase-05-b4-production-guard-activation` မှ `main` သို့ Pull Request ဖွင့်ပါ။ `test` workflow ၏ **Node 20 နှင့် Node 22 နှစ်ခုလုံး** အောင်မြင်မှသာ merge လုပ်ပါ။ မအောင်မြင်ပါက failed job ၏ log ကို ပို့ပါ (B4-REPORT.md ၏ "မစမ်းသပ်ရသေးသည်များ" အရ အသစ်ရေးထားသော test များတွင် CI မှသာ တွေ့နိုင်သော ပြဿနာ ရှိနိုင်သည်)။

## ၆။ Deploy မတိုင်မီ (အရေးကြီး)

ဤ version မှစ၍ `NODE_ENV=production` တွင် အောက်ပါအခြေအနေများတွင် server **မစတင်တော့ပါ** (`exit 1`)။ Hosting dashboard တွင် ကြိုတင်စစ်ပါ။

- `LOG_LEVEL=debug` ဖြစ်နေလျှင် → `info` / `warn` / `error` သို့ ပြောင်းပါ (သို့မဟုတ် variable ကို ဖျက်ပါ)။
- `GATEWAY_CLIENT_TOKEN` သည် placeholder (`changeme`, `<...>`, `${...}` စသည်)၊ ၁၆ လုံးအောက်၊ သို့မဟုတ် စာလုံးတစ်လုံးတည်း ဖြစ်နေလျှင် → ရှည်လျားသော random တန်ဖိုးသို့ ပြောင်းပါ။ Token ပြောင်းလျှင် Android client ဘက်တွင်လည်း တူညီစွာ ပြောင်းရမည်။

## လုံခြုံရေး သတိပေးချက်

အမှန်တကယ် API Key / Client Token များကို Git၊ ZIP၊ terminal screenshot၊ chat တို့တွင် မထည့်ပါနှင့်။ Startup error တွင် variable နာမည်နှင့် အကြောင်းရင်းသာ ပါပြီး တန်ဖိုး မပါပါ။
