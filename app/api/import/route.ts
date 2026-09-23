import { createAutomaticBackup, parseBackupData, replaceAccountData } from "../../../db/backups";
import { requireAccount } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const owner = await requireAccount();
  if (owner instanceof Response) return owner;
  if (Number(request.headers.get("content-length") || 0) > 2_000_000) return Response.json({ error: "This backup file is too large" }, { status: 413 });
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.format !== "stay-calendar-backup" || !Array.isArray(body.properties) || !Array.isArray(body.bookings)) {
      return Response.json({ error: "Choose a Roomie backup JSON file" }, { status: 422 });
    }
    if (body.properties.length > 100 || body.bookings.length > 500) return Response.json({ error: "This backup contains too many records" }, { status: 422 });
    const data = parseBackupData(body.properties, body.bookings);
    if ("error" in data) return Response.json({ error: data.error }, { status: 422 });

    await createAutomaticBackup(owner, "Before restoring an exported backup");
    await replaceAccountData(owner, data);
    return Response.json({ ok: true, properties: data.properties.length, bookings: data.bookings.length });
  } catch (error) {
    console.error("Exported backup restore failed", error);
    return Response.json({ error: "Could not restore this file. Your current data was preserved in an automatic backup." }, { status: 500 });
  }
}
