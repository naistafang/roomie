import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { createAutomaticBackup } from "../../../db/backups";
import { properties } from "../../../db/schema";
import { requireAccount } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

function validTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export async function GET() {
  const owner = await requireAccount();
  if (owner instanceof Response) return owner;
  const rows = await getDb().select().from(properties).where(eq(properties.ownerEmail, owner)).orderBy(asc(properties.sortOrder), asc(properties.id));
  return Response.json({ properties: rows });
}

export async function POST(request: Request) {
  const owner = await requireAccount();
  if (owner instanceof Response) return owner;
  const body = (await request.json()) as { name?: string; address?: string; nightlyRate?: number; roomOptions?: unknown; highlightColor?: string; defaultCheckInTime?: string; defaultCheckOutTime?: string };
  const name = body.name?.trim();
  const address = body.address?.trim() ?? "";
  const nightlyRate = Number(body.nightlyRate ?? 0);
  const roomOptions = Array.isArray(body.roomOptions)
    ? [...new Set(body.roomOptions.map((option) => String(option).trim()).filter(Boolean))]
    : ["Single room", "Master room", "Full"];
  const highlightColor = /^#[0-9a-f]{6}$/i.test(body.highlightColor ?? "") ? body.highlightColor! : "#246bfd";
  const defaultCheckInTime = validTime(body.defaultCheckInTime) ? body.defaultCheckInTime : "15:00";
  const defaultCheckOutTime = validTime(body.defaultCheckOutTime) ? body.defaultCheckOutTime : "11:00";
  if (!name) return Response.json({ error: "Property name is required" }, { status: 400 });
  if (!Number.isFinite(nightlyRate) || nightlyRate < 0) return Response.json({ error: "Enter a valid nightly price" }, { status: 400 });
  if (!roomOptions.length) return Response.json({ error: "Add at least one room option" }, { status: 400 });
  try {
    await createAutomaticBackup(owner, "Before adding a property");
    const [lastProperty] = await getDb().select({ sortOrder: properties.sortOrder }).from(properties).where(eq(properties.ownerEmail, owner)).orderBy(desc(properties.sortOrder)).limit(1);
    const [property] = await getDb().insert(properties).values({ ownerEmail: owner, name, address, roomOptions: JSON.stringify(roomOptions), highlightColor, nightlyRateCents: Math.round(nightlyRate * 100), defaultCheckInTime, defaultCheckOutTime, sortOrder: (lastProperty?.sortOrder ?? -1) + 1 }).returning();
    return Response.json({ property }, { status: 201 });
  } catch {
    return Response.json({ error: "A property with that name already exists" }, { status: 409 });
  }
}
