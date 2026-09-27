export type HpoMapOffice = {
  key: string;
  accountId?: string | undefined;
  prospectId?: string | undefined;
  officeName: string;
  address: string;
  city?: string | null | undefined;
  latitude?: number | null | undefined;
  longitude?: number | null | undefined;
  detail: string;
  kind: "account" | "prospect";
  specialty?: string | null | undefined;
  priority?: number | null | undefined;
  relationshipStage?: string | null | undefined;
  relationshipHealth?: string | null | undefined;
  ownerName?: string | null | undefined;
  lastTouchAt?: string | null | undefined;
  nextAction?: string | null | undefined;
  nextActionDueAt?: string | null | undefined;
  fitStatus?: string | null | undefined;
  verificationStatus?: string | null | undefined;
  mapped: boolean;
};

export type HpoMapRouteStop = {
  id: string;
  stop_order: number;
  status: string;
  office_name: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type HpoMapRoute = {
  id: string;
  optimized_at: string | null;
  metadata: Record<string, unknown> | null;
  start_latitude: number | null;
  start_longitude: number | null;
  end_latitude: number | null;
  end_longitude: number | null;
  stops: HpoMapRouteStop[];
};
