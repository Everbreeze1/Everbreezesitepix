import AsyncStorage from "@react-native-async-storage/async-storage";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { supabase } from "@/lib/supabase";
import { clampPhotosPerPage, type PhotosPerPage } from "./report-builder-view";
import { companyPatch, logoPath, readStorageSum, type CompanyFields } from "./company-view";

/**
 * Company details and branding: the web Settings page's Company section.
 *
 * The same calls the web makes. The details, the logo URL, the watermark
 * switch and the report layout are columns on the signed-in person's own
 * `profiles` row (RLS lets a person write only their own), and the logo goes to
 * the public `company-logos` bucket under `<uid>/logo-<ts>`, the web's path.
 * Reports read these columns, so a change here shows in the next report from
 * either surface.
 */

export type CompanyProfile = {
  company: string | null;
  company_phone: string | null;
  company_address: string | null;
  company_logo_url: string | null;
  watermark_enabled: boolean | null;
  report_photos_per_page: PhotosPerPage;
};

export async function getCompanyProfile(userId: string): Promise<CompanyProfile> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "company, company_phone, company_address, company_logo_url, watermark_enabled, report_photos_per_page",
    )
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = (data ?? {}) as Partial<Record<keyof CompanyProfile, unknown>>;
  const str = (value: unknown) => (typeof value === "string" && value ? value : null);
  return {
    company: str(row.company),
    company_phone: str(row.company_phone),
    company_address: str(row.company_address),
    company_logo_url: str(row.company_logo_url),
    watermark_enabled: typeof row.watermark_enabled === "boolean" ? row.watermark_enabled : null,
    report_photos_per_page: clampPhotosPerPage(row.report_photos_per_page),
  };
}

/** Name, phone and address: an upsert on the id, exactly as the web saves them. */
export async function saveCompanyDetails(args: {
  userId: string;
  email: string | null;
  fields: CompanyFields;
}): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .upsert(
      { id: args.userId, email: args.email, ...companyPatch(args.fields) },
      { onConflict: "id" },
    );
  if (error) throw new Error(error.message);
  await saveWebsite(args.userId, args.fields.website);
}

/** Longest edge of an uploaded logo. Reports draw it far smaller than this. */
const LOGO_DIM = 1024;

/**
 * Upload a logo and point the profile at it.
 *
 * Re-encoded as PNG so a transparent background stays transparent on a report
 * header, and scaled down so a 12 megapixel photo of a van door is not what
 * every PDF embeds.
 */
export async function uploadCompanyLogo(
  userId: string,
  uri: string,
  width?: number,
): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  if (!width || width > LOGO_DIM) context.resize({ width: LOGO_DIM });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.PNG });
  const bytes = await new File(saved.uri).arrayBuffer();

  const path = logoPath(userId);
  const { error: uploadError } = await supabase.storage
    .from("company-logos")
    .upload(path, bytes, { contentType: "image/png", upsert: true });
  if (uploadError) throw new Error(uploadError.message);

  const { data } = supabase.storage.from("company-logos").getPublicUrl(path);
  const url = data.publicUrl;
  const { error } = await supabase
    .from("profiles")
    .update({ company_logo_url: url })
    .eq("id", userId);
  if (error) throw new Error(error.message);
  return url;
}

export async function setWatermarkEnabled(userId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ watermark_enabled: enabled })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

/** The default for every new report, including the one built when a walkthrough ends. */
export async function setReportPhotosPerPage(userId: string, n: PhotosPerPage): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ report_photos_per_page: n })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

/** Bytes of photos this person uploaded: the web's `useStorageUsage` query. */
export async function getStorageUsed(userId: string): Promise<number> {
  const { data, error } = await supabase
    .from("photos")
    .select("size_bytes.sum()")
    .eq("uploaded_by", userId)
    .single();
  if (error) throw new Error(error.message);
  return readStorageSum(data);
}

/*
 * The website is not a database column. The web keeps it in the browser's
 * localStorage under this key, so it never leaves that browser; the phone keeps
 * it the same way, on the device, under the same key. Storing it on the server
 * would need a column the web does not have.
 */
const websiteKey = (userId: string) => `everlumen:company-extras:${userId}`;

export async function getWebsite(userId: string): Promise<string> {
  try {
    const raw = await AsyncStorage.getItem(websiteKey(userId));
    const parsed = raw ? (JSON.parse(raw) as { website?: unknown }) : null;
    return typeof parsed?.website === "string" ? parsed.website : "";
  } catch {
    return "";
  }
}

async function saveWebsite(userId: string, website: string): Promise<void> {
  try {
    await AsyncStorage.setItem(websiteKey(userId), JSON.stringify({ website: website.trim() }));
  } catch {
    // A device that cannot store it loses only this one convenience field.
  }
}
