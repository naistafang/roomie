import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { createAutomaticBackup } from "../../../../db/backups";
import { properties } from "../../../../db/schema";
import { getChatGPTUser } from "../../../chatgpt-auth";

export const dynamic = "force-dynamic";

function validTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await getChatGPTUser())) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id: rawId } = await context.params;
  const id = Number(rawId);
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
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Invalid property" }, { status: 400 });
  if (!name) return Response.json({ error: "Property name is required" }, { status: 400 });
  if (!Number.isFinite(nightlyRate) || nightlyRate < 0) return Response.json({ error: "Enter a valid nightly price" }, { status: 400 });
  if (!roomOptions.length) return Response.json({ error: "Add at least one room option" }, { status: 400 });
  try {
    await createAutomaticBackup("Before editing a property");
    const [property] = await getDb().update(properties).set({
      name,
      address,
      roomOptions: JSON.stringify(roomOptions),
      highlightColor,
      nightlyRateCents: Math.round(nightlyRate * 100),
      defaultCheckInTime,
      defaultCheckOutTime,
    }).where(eq(properties.id, id)).returning();
    if (!property) return Response.json({ error: "Property not found" }, { status: 404 });
    return Response.json({ property });
  } catch {
    return Response.json({ error: "A property with that name already exists" }, { status: 409 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await getChatGPTUser())) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) return Response.json({ error: "Invalid property" }, { status: 400 });
  await createAutomaticBackup("Before deleting a property");
  const [property] = await getDb().delete(properties).where(eq(properties.id, id)).returning();
  if (!property) return Response.json({ error: "Property not found" }, { status: 404 });
  return Response.json({ property });
}
