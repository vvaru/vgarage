@AGENTS.md

## Machine & environment

Development happens on Vinit's UGREEN NAS (UGOS / Debian 12, x86_64, 6 threads, 8 GB RAM shared with
Immich/Jellyfin). Repo: /home/vvaru/dev/vgarage. The app is a static export (next.config `output: 'export'`);
PDFs are generated client-side with jsPDF; there is no server and no Netlify functions.
Deploys: push to GitHub (vvaru/vgarage, branch main) → Netlify builds and publishes `out/` to
vgarage.netlify.app. Never deploy any other way (no Netlify CLI).

- Node 22 LTS (see .nvmrc; Netlify's build image uses the same 22.x) is user-local in ~/.local/node/bin,
  first in PATH. Do NOT use /usr/bin/node (UGOS's own v18, no npm).
- git/gh: gh is logged in as vvaru and is git's credential helper (HTTPS). Never print tokens.
  Commit identity: vvaru <vinitvaru96@gmail.com>.
- No passwordless sudo; git and tmux are system packages. Don't install system packages; ask Vinit first.
- Install deps with `npm install` (commit lockfile changes deliberately, in their own commit).
- Dev server: tmux session `vgarage`, window `dev`: `npm run dev -- -p 3100 -H 0.0.0.0`.
  Open http://192.168.1.21:3100 (LAN) or http://100.73.1.57:3100 (Tailscale). Ports 3000 and 8888 are
  taken by other NAS services. Check it with `tmux capture-pane -p -t vgarage:dev`. tmux survives SSH
  disconnects but not NAS reboots: restart the session by hand after a reboot.
- Before pushing: `npx tsc --noEmit`, `npm run lint`, then stop the dev server and run
  `NODE_OPTIONS=--max-old-space-size=2048 npm run build` (never build and dev at the same time: RAM is tight;
  dev ~1 GB, build ~1 GB peak).
- Lint is KNOWN FAILING (49 errors / 21 warnings as of 2026-10-20, mostly react-hooks/static-components and
  react-hooks/set-state-in-effect in existing code). Fixing it is a separate task; until then, don't add new
  lint errors in files you touch (compare `npx eslint <file>` before/after). Netlify's build doesn't run lint.
- Preview the static export exactly as Netlify serves it: `python3 -m http.server 3101 -d out`.
- Secrets: .env.local (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY) is a symlink to
  /volume1/docker/.secrets/vgarage.env.local (mode 600), gitignored. Never print, commit, or copy its values.
  NEXT_PUBLIC_* values end up in the client bundle by design; data safety relies on Supabase RLS.
  Netlify's env vars are set in the Netlify UI.
- design-mockups/ is reference material (gitignored), not part of the build.
- Filesystem is case-sensitive (like Netlify, unlike the old Windows laptop): import paths must match file
  names exactly. Line endings: LF.
- Storage is HDD RAID 1 with no snapshots; GitHub is the source of truth, so commit and push often.
