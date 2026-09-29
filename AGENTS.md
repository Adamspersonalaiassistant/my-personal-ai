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
- Keep the four HPO areas inside one light, height-constrained field shell with one shared navigation above them; this preserves map sizing and consistent switching without modifying the global app shell.
