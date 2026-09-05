<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Kolme theme boundary

Before visual work, read `../../docs/THEME_MODES_2026-09-05.md` and ADR-112. The existing near-black/deep-indigo dark mode is preserved; the white/blue/lime GPT «طاولة المونتاج» target applies to light only and is not implemented yet. Treat the current light values and old palette wording in `app/styles/tokens.css` as transitional, not as the accepted light target. Both modes use one route/component/state tree: do not fork screens or rebuild shared interaction. Claim exact files in `.claude/SESSIONS.md`; only one owner may change the light-token/manifest/boot bundle at a time, and screen owners consume those tokens without editing that bundle in parallel.
