-- JARVIS turn idempotency. The client sends a turn id with every submitted turn
-- and the server stores it in agent_messages.metadata.turn_id on both the user
-- and the agent message. This partial unique index makes a duplicate or racing
-- replay of the same turn id impossible to persist twice. Additive only: existing
-- rows carry no turn_id and are unaffected; RLS and grants are unchanged.
create unique index if not exists agent_messages_turn_id_unique
  on public.agent_messages (thread_id, speaker, (metadata ->> 'turn_id'))
  where metadata ? 'turn_id';
