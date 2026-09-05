# Personal AI Assistant — Version 1 (shell only)

A private, mobile-first app with your own sign-in, a chat screen, and five sections to move between. No AI, no automations, no new backend, no changes to your existing data.

## Connecting to your existing Supabase project

Nothing new gets created. Link your own "Personal AI Memory" project in Lovable under Project Settings → Connectors → Supabase, choosing "Connect existing Supabase project" and signing in to the account that owns "Adam's Personal AI Assistant Org". This browser step cannot be done from chat.

Once linked, the app uses your existing email/password sign-in and your manually created account. No tables, columns, policies, or migrations are added or altered, and no service-role key is used anywhere in the app.

## What gets built

1. **Login screen** — email + password against your existing account, with clear error messages. No signup or create-account option. Unsigned visitors always land here.
2. **Chat screen (home)** — mobile-first message list, text box, send button. Messages are held in the screen only; nothing is saved and no AI replies yet. A short note makes clear the brain isn't connected.
3. **Microphone button** — visible, disabled, labelled "Voice coming soon".
4. **File upload button** — visible, disabled, labelled "Uploads coming soon".
5. **Bottom navigation — five items only**: Chat, Memories, Tasks, Meetings, Projects. Each is a real page with a clean empty state describing what will live there.
6. **Settings** — reached from an icon in the upper-right, not the bottom bar. Shows your signed-in email taken directly from your login session, a sign-out button, and a short list of what's connected vs. planned. It does not read the profiles table.

## Design

Dark, calm, single-column, thumb-friendly. Large tap targets, safe-area padding, no desktop-first layouts. Not the generic purple-gradient look.

## Technical notes

- Auth uses the browser Supabase client from the connector; protected screens sit under an authenticated layout that redirects to the login page.
- No server-side data functions, no service-role usage, no migrations, no edge functions.
- Chat messages live in component state so swapping in real storage later is a contained change.
- No SEO, social sharing, or public metadata work — this is a private app.

## Explicitly out of scope now

OpenAI, voice, real file uploads, message persistence, profiles/table reads, signup flow, PLAUD, n8n, WhatsApp, any schema change.
