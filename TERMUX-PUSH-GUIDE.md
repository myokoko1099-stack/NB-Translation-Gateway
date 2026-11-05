# Termux Git Push Guide — Phase 05-B2.4

> Tests are intentionally run by GitHub Actions, not locally. Do not run `npm test` in Termux for this phase.

```bash
cd ~/NB-Translation-Gateway
git status --short
git switch main
git pull origin main
git switch -c phase-05-b2.4-security-hardening
```

Extract the ZIP into a temporary folder. Replace the path if Android saved it somewhere else:

```bash
mkdir -p ~/storage/downloads/B2.4
unzip -o ~/storage/downloads/B2.4-Security-Hardening.zip -d ~/storage/downloads/B2.4
cd ~/NB-Translation-Gateway
git apply --check ~/storage/downloads/B2.4/B2.4.patch
```

If the check succeeds, apply the complete patch (it adds the new source/test/docs files and updates the two existing source files plus README):

```bash
git apply ~/storage/downloads/B2.4/B2.4.patch
git status --short
git diff --stat
```

If `git apply --check` reports a conflict, STOP and send the error. Do not force-apply. Do not copy ZIP source/test files separately before applying the patch, because the patch already adds them.

Commit and push:

```bash
git add src test README.md SECURITY-NOTES.md B2.4-REPORT.md CHANGED_FILES-B2.4.md TERMUX-PUSH-GUIDE.md
git commit -m "feat: Phase 05-B2.4 security hardening"
git push -u origin phase-05-b2.4-security-hardening
```

Then open a Pull Request on GitHub from `phase-05-b2.4-security-hardening` into `main`. Wait for the `test` workflow's Node 20 and Node 22 jobs. Merge only when both pass.

Security note: do not put real API keys/client tokens into Git, the ZIP, terminal screenshots, or chat. If hosting currently uses `LOG_LEVEL=debug`, change it to `info`, `warn`, or `error` before deploying this phase.
