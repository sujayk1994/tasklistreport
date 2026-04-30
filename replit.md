# Daily Tasks — Task Manager App

## Overview

A personal daily task manager with login, daily checklists, email reporting, and task history.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Auth**: Clerk (`@clerk/express` on the API, `@clerk/react` on the SPA). In production, the API hosts a Clerk Frontend API proxy at `/api/__clerk` so auth works on custom domains without DNS changes.
- **Email**: Nodemailer (Gmail SMTP)
- **Frontend**: React + Vite, TailwindCSS, TanStack Query

## Features

- Login/signup via Clerk authentication
- Paste tasks (newline-separated) → auto-creates interactive checklist
- Check off completed tasks
- Submit at end of day → sends email report to configured recipients
- History view: browse past days' tasks date-by-date
- Settings: manage recipient email addresses
- **Carry-over**: incomplete tasks automatically appear in the next day's list until completed or deleted (created on first GET /tasks/today of the day, copied from the most recent prior list). The original `created_at` is preserved across carry-overs so the UI can show "Pending from <original date>".
- **Search**: today's list (`app.tsx`) and the history page (`history.tsx`) both have a search bar with a By name / By date toggle, and `/` focuses it from anywhere on the page. Today is filtered client-side in memory and matched substrings are highlighted via `lib/highlight.tsx`. History search hits a dedicated server endpoint `GET /api/tasks/history/search?q=…&mode=name|date` (Postgres ILIKE on `tasks.text`/`tasks.note` for name mode, on `task_lists.date` for date mode); the response includes up to 8 matched task snippets per day for the UI to render under each card.
- **Stale highlighting**: Stale carry-overs (≥7 days pending) get amber row chrome plus a bold `Nd` pill so they don't blend in.
- **Today view modes (Board + List)**: today's page (`app.tsx`) is a single full-viewport "workspace" with a warm paper aesthetic shared between views. A sticky top toolbar holds the date/title, completion progress chip, view toggle, Add task drawer, Submit day, and Reset. Below it sits the search + filter strip. The body fills the remaining viewport. The Board view (`board-view.tsx`) is the default and lays tasks out as sticky notes auto-grouped by tag (default tags: Client Change / Bug Fix / Internal / Review; users can add their own keyword-based tags). The board surface is sized to its container via ResizeObserver — its shape never changes with note positions, and notes are clamped inside the board both during drag and on resize. Every note is individually draggable: starting a drag inside a stacked group auto-unstacks the group so all cards become movable while preserving their relative offsets. A "Tidy board" button re-flows notes into clean lanes inside the current board size. Each tag group can be Stacked (compact pile) or Unstacked (fanned). Sticky-note positions, tag definitions, and stack states are all persisted to `localStorage` (`task-board-positions-v1`, `task-board-tags-v1`, `task-board-stacked-v1`) — no backend schema changes. The List view shares the same warm canvas and renders tasks as paper-strip cards with priority/age pills and inline notes. Tasks marked completed sink to the bottom of their group/list and fade out in both views. The view choice persists to `localStorage` under `today-view-mode`. To allow the today page to fill the viewport, `Layout` accepts a `bleed` prop (passed only by the `/app` route) that strips its main padding. History pages remain list-only by design.
- **Filter pills**: today's page has filter pills below the search bar that apply to both List and Board views — age filter (All / Newer ≤1d / Older ≥2d / Priority by `urgent`/`priority` keyword) plus completion filter (All / Pending / Completed), with a Clear filters shortcut.
- **IMAP today-only ingestion**: the poller in `inbox.ts` only ingests emails that were received TODAY. Two layers enforce this so yesterday's deleted/completed tasks can never re-enter today's list: (1) the IMAP `since` filter is the start of today (`getStartOfToday`), and (2) every fetched message is re-checked with `isReceivedToday(msg)` against its `internalDate`. The `processed_emails` Message-ID dedup table sits on top of that for idempotency across the day's polls. Trade-off: if the service is down for a full day, that day's emails are lost rather than getting added to the next day's list — by design.
- **Email-driven task ingestion**: an IMAP poller reads `GMAIL_USER`'s inbox once a minute. Subjects matching `Twitter Marketing Reminder` or `Reprint Reminder` are parsed; every project line between `sent today:` and `Best Regards,` becomes a task on every existing user's today list, suffixed with ` - twitter marketing` or ` - Reprints`. Sub-bulleted lines (`  - X`) inherit the previous brand. Duplicate texts are skipped. See `artifacts/api-server/src/lib/inbox.ts`.
- Admin-only `POST /api/admin/inbox/simulate` endpoint accepts `{ subject, body }` and runs the same parser without IMAP — useful for testing.
- **Board polish (frontend-only)**: the Board view supports five UX add-ons wired through `app.tsx` props, all persisted in `localStorage` and backend-free.
  - **Restore from bin**: each entry in the recycle-bin panel has a hover "Restore" button that re-creates the task via `useAddTask` and re-attaches its saved note via `useUpdateTaskNote`. Local trash snapshot is removed on success.
  - **Keyboard shortcuts**: `/` focuses the search bar (existing), `N` opens the Add task drawer and focuses the textarea, `T` runs Tidy on the board, `Esc` clears search / closes the Add panel and any open board panels (folder, bin, tag editor, note editor). All shortcuts ignore typing in inputs except `Esc`.
  - **Snap-to-grid toggle**: a Magnet button next to "Tidy board" snaps dragged notes onto a 20px grid in real time. Persisted under `task-board-snap-v1`.
  - **Dark mode**: a Moon/Sun toggle in the toolbar switches the board surface, tag bar, drop targets, completed/bin panels, and footer to a warm dark palette. Persisted under `today-dark-mode` and toggles a `dark` class on `<html>` for any tailwind dark: variants.
  - **Celebrations on completion**: a PartyPopper toggle in the toolbar enables/disables a confetti burst (CSS keyframes in `index.css`) plus a four-note Web Audio chord when a non-completed note is dropped onto the Completed folder. Persisted under `today-celebrations`.

## Environment Variables / Secrets Required

- `SESSION_SECRET` — Auto-provisioned for Replit Auth sessions
- `REPL_ID` / `REPLIT_DOMAINS` — Auto-provisioned by Replit Auth
- `GMAIL_USER` — Gmail address used to send task reports
- `GMAIL_APP_PASSWORD` — Gmail App Password (requires 2FA enabled)
- `DATABASE_URL` — Auto-provisioned by Replit PostgreSQL
- `SUPER_ADMIN_EMAIL` — Email of the user that gets the Admin panel

## Artifacts

- `artifacts/task-manager` — React + Vite frontend (preview at `/`)
- `artifacts/api-server` — Express API server (at `/api`)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Default Recipient Emails

Set via user Settings page, or pre-configured:
- vishnu@vellichormedia.com
- sujay@vellichormedia.com
