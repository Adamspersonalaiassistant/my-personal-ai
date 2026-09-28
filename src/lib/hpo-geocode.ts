const HPO_METRO_BOUNDS = { minLat: 38.5, maxLat: 42.3, minLon: -75.9, maxLon: -72.4 };

function validPoint(lat: number, lon: number) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= HPO_METRO_BOUNDS.minLat &&
    lat <= HPO_METRO_BOUNDS.maxLat &&
    lon >= HPO_METRO_BOUNDS.minLon &&
    lon <= HPO_METRO_BOUNDS.maxLon
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
    .replace(/,?\s*\d+(?:st|nd|rd|th)\s+floor/gi, "")
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

async function fetchJsonWithTimeout(url: string, timeoutMs = 3500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "EmeryPersonalAI/1.0 HPO-office-map",
        Accept: "application/json",
      },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function photon(query: string) {
  const payload = (await fetchJsonWithTimeout(
    `https://photon.komoot.io/api/?limit=1&lang=en&q=${encodeURIComponent(query)}`,
    3000,
  )) as { features?: Array<{ geometry?: { coordinates?: unknown[] } }> } | null;
  const coordinates = payload?.features?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const lon = Number(coordinates[0]);
  const lat = Number(coordinates[1]);
  return validPoint(lat, lon) ? { lat, lon, provider: "photon" as const } : null;
}

async function census(query: string) {
  const payload = (await fetchJsonWithTimeout(
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=" +
      encodeURIComponent(query),
    3500,
  )) as {
    result?: { addressMatches?: Array<{ coordinates?: { x?: number; y?: number } }> };
  } | null;
  const coordinates = payload?.result?.addressMatches?.[0]?.coordinates;
  const lon = Number(coordinates?.x);
  const lat = Number(coordinates?.y);
  return validPoint(lat, lon) ? { lat, lon, provider: "census" as const } : null;
}

async function nominatim(query: string) {
  const rows = (await fetchJsonWithTimeout(
    "https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=us&limit=1&q=" +
      encodeURIComponent(query),
    3500,
  )) as Array<{ lat?: string; lon?: string }> | null;
  const lat = Number(rows?.[0]?.lat);
  const lon = Number(rows?.[0]?.lon);
  return validPoint(lat, lon) ? { lat, lon, provider: "nominatim" as const } : null;
}

export async function geocodeHpoOfficeAddress(address: string, city?: string | null) {
  const candidates = queries(address, city);
  for (const query of candidates.slice(0, 2)) {
    const point = await photon(query);
    if (point) return point;
  }

  for (const query of candidates.slice().reverse().slice(0, 2)) {
    const point = await census(query);
    if (point) return point;
  }

  const finalQuery = candidates[candidates.length - 1];
  if (finalQuery) {
    const point = await nominatim(finalQuery);
    if (point) return point;
  }
  return null;
}
