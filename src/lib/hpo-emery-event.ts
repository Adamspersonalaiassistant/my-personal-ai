export const HPO_EMERY_EVENT_NAME = "emery:hpo-chat";

export type HpoEmeryOpenOptions = {
  autoSend?: boolean;
  routeDate?: string | null;
  plannerBuild?: boolean;
};

export function openHpoEmery(
  prompt = "",
  title = "HPO",
  options: HpoEmeryOpenOptions = {},
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(HPO_EMERY_EVENT_NAME, {
      detail: {
        prompt,
        title,
        autoSend: options.autoSend === true,
        routeDate: options.routeDate ?? null,
        plannerBuild: options.plannerBuild === true,
      },
    }),
  );
}
