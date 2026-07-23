import { z } from "zod";
import type { ServiceContext } from "../../lib/user-context";

export const geocodeAddressInputSchema = z.object({
  address: z.string().trim().min(3).max(500),
});

export type GeocodeAddressInput = z.infer<typeof geocodeAddressInputSchema>;

export async function geocodeAddressService(
  _ctx: ServiceContext,
  data: GeocodeAddressInput,
): Promise<{ latitude: number | null; longitude: number | null }> {
  const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
  if (!GOOGLE_MAPS_API_KEY) {
    throw new Error("Missing GOOGLE_MAPS_API_KEY");
  }
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(data.address)}&key=${encodeURIComponent(GOOGLE_MAPS_API_KEY)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Geocode failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const json: { results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }> } =
    await res.json();
  const loc = json?.results?.[0]?.geometry?.location;
  if (!loc) return { latitude: null, longitude: null };
  return { latitude: Number(loc.lat), longitude: Number(loc.lng) };
}
