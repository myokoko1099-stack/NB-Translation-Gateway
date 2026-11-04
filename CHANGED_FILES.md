# CHANGED_FILES.md — Phase 05-B1

Base commit: `ed46035f628cec6380ed04aa42d3529910e4ab3c` (Phase 04-I10-D merge)

**Backend project အသစ် တစ်ခုလုံး ဖြစ်ပြီး ဖိုင် ၂၇ ခု (အားလုံး NEW)။ ရှိပြီးသား ဖိုင်တစ်ခုမှ မပြင်ထား/မဖျက်ထား။**
Android App source နှင့် MNB translation pipeline ကို မထိခိုက်ပါ။ Git commit / push / PR မလုပ်ထားပါ။

## Project root
| ဖိုင် | အခြေအနေ |
|---|---|
| `package.json` | NEW (dependency 0) |
| `.gitignore` | NEW |
| `.env.example` | NEW (secret တန်ဖိုးမပါ) |
| `README.md` | NEW |
| `ARCHITECTURE.md` | NEW |
| `HOSTING-DECISION.md` | NEW |
| `SECURITY-NOTES.md` | NEW |
| `TEST-REPORT.md` | NEW |
| `CHANGED_FILES.md` | NEW |

## Source (`src/`)
| ဖိုင် | အခြေအနေ |
|---|---|
| `src/index.js` | NEW |
| `src/meta.js` | NEW |
| `src/domain/errors.js` | NEW |
| `src/domain/translation.js` | NEW |
| `src/ports/translationProvider.js` | NEW |
| `src/application/healthService.js` | NEW |
| `src/application/translateService.js` | NEW |
| `src/config/profiles.js` | NEW |
| `src/config/config.js` | NEW |
| `src/config/secrets.js` | NEW |
| `src/infrastructure/http/server.js` | NEW |
| `src/infrastructure/http/compose.js` | NEW |
| `src/infrastructure/logging/logger.js` | NEW |

## Tests (`test/`)
| ဖိုင် | အခြေအနေ |
|---|---|
| `test/helpers.js` | NEW |
| `test/health.test.js` | NEW |
| `test/config.test.js` | NEW |
| `test/translate.test.js` | NEW |
| `test/secret-exposure.test.js` | NEW |
