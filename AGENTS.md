<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep HPO field UI under its authenticated HPO route/components and owner-scoped HPO server functions; reuse canonical route/visit/offline/controller actions so the four field views share one record system.
- Keep the four HPO areas inside one dark midnight-Emery, height-constrained field shell with one shared navigation above them; preserve the working Leaflet map, map sizing, and consistent switching without modifying the global app shell.
- For long professionalization work, continue from docs/EMERY-PROFESSIONALIZATION-STATE.md and docs/EMERY-PROFESSIONALIZATION-COVERAGE.md; use focused normal commits and never rewrite pushed history.
- Keep `/chat` as the voice-first Emery home and `/conversation` as the single persistent typed conversation; contextual handoffs target `/conversation` so no second chat or memory system is created.
