import { lazy, Suspense, useState, type ReactNode } from "react";
import type { HpoMapOffice, HpoMapRoute } from "@/components/hpo-map/types";

const HpoMapV2MapLibre = lazy(() =>
  import("@/components/hpo-map/HpoMapV2MapLibre").then((module) => ({
    default: module.HpoMapV2MapLibre,
  })),
);

type Props = {
  enabled: boolean;
  v1: ReactNode;
  offices: HpoMapOffice[];
  selectedKeys: string[];
  selectedOfficeKey: string | null;
  route?: HpoMapRoute | null;
  onSelectOffice: (key: string) => void;
  onSelectMany?: (keys: string[]) => void;
  onOpenAccount?: (accountId: string) => void;
  onToggleRouteStop: (office: HpoMapOffice) => void;
  onBuildRoute: () => void;
  preparing: boolean;
  onRefreshPins: () => void;
};

export function HpoMapAdapter({ enabled, v1, ...props }: Props) {
  const [failed, setFailed] = useState(false);

  if (!enabled || failed) return <>{v1}</>;

  return (
    <Suspense fallback={<>{v1}</>}>
      <HpoMapV2MapLibre
        {...props}
        onFatalError={(message) => {
          console.error("HPO Map V2 renderer failed; falling back to V1.", message);
          setFailed(true);
        }}
      />
    </Suspense>
  );
}
