export type HpoMapOffice = {
  key: string;
  accountId?: string;
  prospectId?: string;
  officeName: string;
  address: string;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  detail: string;
  kind: "account" | "prospect";
  specialty?: string | null;
  priority?: number | null;
  relationshipStage?: string | null;
  relationshipHealth?: string | null;
  ownerName?: string | null;
  lastTouchAt?: string | null;
  nextAction?: string | null;
  nextActionDueAt?: string | null;
  fitStatus?: string | null;
  verificationStatus?: string | null;
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
