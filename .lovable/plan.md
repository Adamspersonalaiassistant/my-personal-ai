# Personal AI Assistant — Version 1 (shell only)

A mobile-first app with your own sign-in, a chat screen, and five sections to move between. No AI, no automations, no new backend, and no changes to your existing data.

## Connecting to your existing Supabase project

Nothing new gets created. You link your own "Personal AI Memory" project yourself in Lovable under Project Settings → Connectors → Supabase (a browser sign-in flow — it cannot be done from chat). Once linked:

- The app uses your existing sign-in and your existing account.
- The app only reads what already exists. No tables, columns, policies, or migrations are added or altered.
- Version 1 reads at most one thing: your profile row, to show your name in Settings. Everything else is display-only.

Until you link it, I can build the screens with the sign-in wired but non-functional, or wait. Your call — say the word once the connector is linked.

## What gets built

1. **Login screen** — email + password against your existing account, error messages, sign-out. Unsigned visitors always land here.
2. **Chat screen (home)** — mobile-first message list, text box, send button. Messages are held in the screen only for now; nothing is saved and no AI replies. A short note makes clear the brain isn't connected yet.
3. **Microphone button** — visible, disabled, labelled "Voice coming soon".
4. **File upload button** — visible, disabled, labelled "Uploads coming soon".
5. **Bottom navigation** — Chat, Memories, Tasks, Meetings, Projects, plus Settings. Each section is a real page with a clean empty state describing what will live there.
6. **Settings** — your account email, sign-out, and a short list of what's connected vs. planned.

## Design

Dark, calm, single-column, thumb-friendly. Large tap targets, safe-area padding, no desktop-first layouts. Not the generic purple-gradient look.

## Technical notes

- Auth is the browser Supabase client from the connector; protected screens live under an authenticated layout that redirects to the login page.
- No server-side data functions, no service-role usage, no migrations, no edge functions in this version.
- Chat messages live in component state so that swapping in real storage later is a contained change.
- Each page gets its own title and description for sharing/SEO.

## Explicitly out of scope now

OpenAI, voice, real file uploads, message persistence, PLAUD, n8n, WhatsApp, any schema change.
