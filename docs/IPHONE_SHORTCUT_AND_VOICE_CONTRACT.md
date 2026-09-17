# Emery iPhone access + future Voice contract

## Apple Shortcut setup

Create one Shortcut named **Emery**:
1. Add **Dictate Text**. Stop listening: After Pause.
2. Add **URL Encode** for Dictated Text.
3. Add **Current Date**, format it as ISO 8601 (used only as a one-shot token).
4. Add **URL** with: `https://emery-personal-ai.lovable.app/capture?text=[URL Encoded Text]&autosend=1&source=shortcut&input=dictated&token=[Current Date]`
5. Add **Open URLs**.
6. Add the Shortcut to the Home Screen and optionally assign it to the iPhone Action Button or invoke it through Siri by saying the Shortcut name.

The user should already be signed into the Emery PWA/site. If iOS opens Safari instead of the installed PWA, the same authenticated web route is still the intended bridge. Do not build a second Shortcut bot.

For typed capture, replace Dictate Text with Ask for Input and use `input=typed`.

## One-Emery invariant

Every entry point (main chat, PWA/Home Screen, `/capture`, Apple Shortcut, future Voice) must call the same authenticated `sendEmeryMessage` backend and the same `channel=main` conversation. Entry source is metadata only. It must never select a different persona.

Routing occurs after natural input enters Emery: HPO/work, Personal, General/Unfiled, or Mixed. Mixed input may safely inform both domains. Agents are behind Emery; an entry point must never speak directly as an agent.

## Future Voice integration

The future Voice layer must:
- authenticate the same user and call the same Emery identity/backend;
- preserve the main lifelong conversation, memory selection, action context, and domain router;
- pass source `{entryPoint:'voice', inputMode:'voice'}` rather than create a voice-specific conversation;
- read `voice_profiles` and supported provider capabilities before rendering speech;
- write requested Voice Profile changes through Emery's normal conversation/control layer and version history;
- keep stable base voice identity separate from delivery controls;
- require Adam's approval to replace the recognizable base voice;
- never claim unsupported provider/model controls changed audibly;
- never bypass Emery to let HPO or another specialist speak as the primary assistant.

## Voice Studio

Voice Studio belongs in normal chat. Emery may help describe a desired voice, present/test provider-supported candidates, capture explicit approval, and refine supported delivery controls conversationally. Changing voice delivery never changes Emery's personality, memory, role, or identity.
