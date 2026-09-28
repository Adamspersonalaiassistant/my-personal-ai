const NJ_BOUNDS = { minLat: 38.7, maxLat: 41.5, minLon: -75.7, maxLon: -73.7 };

function validPoint(lat: number, lon: number) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= NJ_BOUNDS.minLat &&
    lat <= NJ_BOUNDS.maxLat &&
    lon >= NJ_BOUNDS.minLon &&
    lon <= NJ_BOUNDS.maxLon
  );
}

function normalizedAddress(value: string) {
  return value
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function withoutUnit(value: string) {
  return normalizedAddress(value)
    .replace(/,?\s*(?:suite|ste\.?|unit|floor|fl\.?|room|rm\.?|#)\s*[A-Za-z0-9-]+(?:\s*(?:floor|fl\.?)?)?/gi, "")
    .replace(/,\s*,/g, ",")
    .replace(/\s+,/g, ",")
    .trim();
}

function queries(address: string, city?: string | null) {
  const original = normalizedAddress(address);
  const cleaned = withoutUnit(original);
  const cityText = String(city ?? "").trim();
  const values = [
    original,
    cleaned,
    cityText ? `${cleaned}, ${cityText}, NJ` : `${cleaned}, NJ`,
  ];
  return [...new Set(values.filter(Boolean))];
}

async function photon(query: string) {
  const response = await fetch(
    `https://photon.komoot.io/api/?limit=1&lang=en&q=${encodeURIComponent(query)}`,
    {
      headers: {
        "User-Agent": "EmeryPersonalAI/1.0 HPO-office-map",
        Accept: "application/json",
      },
    },
  );
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    features?: Array<{ geometry?: { coordinates?: unknown[] } }>;
  };
  const coordinates = payload.features?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const lon = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  return validPoint(lat, lon) ? { lat, lon, provider: "photon" as const } : null;
}

async function nominatim(query: string) {
  const response = await fetch(
    "https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=us&limit=1&q=" +
      encodeURIComponent(query),
    {
      headers: {
        "User-Agent": "EmeryPersonalAI/1.0 HPO-office-map",
        Accept: "application/json",
      },
    },
  );
  if (!response.ok) return null;
  const rows = (await response.json()) as Array<{ lat?: string; lon?: string }>;
  const lat = Number(rows[0]?.lat);
  const lon = Number(rows[0]?.lon);
  return validPoint(lat, lon) ? { lat, lon, provider: "nominatim" as const } : null;
}

export async function geocodeHpoOfficeAddress(address: string, city?: string | null) {
  const candidates = queries(address, city);
  for (const query of candidates) {
    try {
      const point = await photon(query);
      if (point) return point;
    } catch {
      // Try the next normalized address before using the fallback provider.
    }
  }

  for (const query of candidates.slice().reverse()) {
    try {
      const point = await nominatim(query);
      if (point) return point;
    } catch {
      // A map refresh can safely retry unresolved records later.
    }
  }
  return null;
}
