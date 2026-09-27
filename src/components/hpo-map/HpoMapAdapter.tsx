import { useState, type ReactNode } from "react";
import { HpoMapV2MapLibre } from "@/components/hpo-map/HpoMapV2MapLibre";
import type { HpoMapOffice, HpoMapRoute } from "@/components/hpo-map/types";

type Props = {
  enabled: boolean;
  v1: ReactNode;
  offices: HpoMapOffice[];
  selectedKeys: string[];
  selectedOfficeKey: string | null;
  route?: HpoMapRoute | null;
  onSelectOffice: (key: string) => void;
  onToggleRouteStop: (office: HpoMapOffice) => void;
  onBuildRoute: () => void;
  preparing: boolean;
  onRefreshPins: () => void;
};

export function HpoMapAdapter({ enabled, v1, ...props }: Props) {
  const [failed, setFailed] = useState(false);

  if (!enabled || failed) return <>{v1}</>;

  return (
    <HpoMapV2MapLibre
      {...props}
      onFatalError={(message) => {
        console.error("HPO Map V2 renderer failed; falling back to V1.", message);
        setFailed(true);
      }}
    />
  );
}
