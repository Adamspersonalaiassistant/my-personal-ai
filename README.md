# My Personal AI

I am building a single-user personal AI assistant app.

I already have:

 an OpenAI API project and API key

 my own existing Supabase project called Personal AI Memory

 Supabase authentication set up with my user account

 existing database tables for profiles, people, projects, conversations, meetings, documents, memories, assistant_preferences, and tasks

Architecture:

 Lovable should be the mobile-first app/interface

 OpenAI will be the AI brain for reasoning, conversation, voice, research, and tool use

 Supabase will be the permanent long-term memory/database

 PLAUD will later provide meeting and call transcripts

 n8n will later handle automations and background jobs

 WhatsApp may be added later as another way to access the same assistant

For the first version, I only want:

 login screen using my existing Supabase Auth

 clean mobile-first chat interface

 text input

 microphone button placeholder for future voice

 file upload placeholder

 simple navigation for Memories, Tasks, Meetings, Projects, and Settings

Important:

 Do not create a new backend

 Do not create Lovable Cloud

 Do not create new database tables

 Do not modify my existing Supabase schema yet

 Do not connect OpenAI yet

 Do not add n8n, WhatsApp, PLAUD automation, or voice yet

First, create a clear implementation plan for this initial version and identify how you will connect to my existing Supabase project without altering the schema.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/9d966392-55bb-436a-bf8b-bf2dee556f11).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
