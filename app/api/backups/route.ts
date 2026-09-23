import { desc, eq, notInArray } from "drizzle-orm";
import { getDb } from "../../../db";
import { createAutomaticBackup } from "../../../db/backups";
import { backupSnapshots, bookings, properties } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await getChatGPTUser())) return Response.json({ error: "Sign in required" }, { status: 401 });
  const backups = await getDb().select({ id: backupSnapshots.id, reason: backupSnapshots.reason, createdAt: backupSnapshots.createdAt })
    .from(backupSnapshots).orderBy(desc(backupSnapshots.id)).limit(25);
  return Response.json({ backups });
}

export async function POST(request: Request) {
  if (!(await getChatGPTUser())) return Response.json({ error: "Sign in required" }, { status: 401 });
  try {
    const backupId = Number(((await request.json()) as { backupId?: number }).backupId);
    if (!Number.isInteger(backupId)) return Response.json({ error: "Invalid backup" }, { status: 400 });
    const db = getDb();
    const [snapshot] = await db.select().from(backupSnapshots).where(eq(backupSnapshots.id, backupId)).limit(1);
    if (!snapshot) return Response.json({ error: "Backup not found" }, { status: 404 });
    const data = JSON.parse(snapshot.payload) as { properties?: Array<typeof properties.$inferInsert>; bookings?: Array<typeof bookings.$inferInsert> };
    if (!Array.isArray(data.properties) || !Array.isArray(data.bookings)) return Response.json({ error: "Backup is damaged" }, { status: 422 });

    await createAutomaticBackup("Before restoring a backup");
    for (const property of data.properties) {
      const { id, ...values } = property;
      await db.insert(properties).values(property).onConflictDoUpdate({ target: properties.id, set: values });
    }
    for (const booking of data.bookings) {
      const { id, ...values } = booking;
      await db.insert(bookings).values(booking).onConflictDoUpdate({ target: bookings.id, set: values });
    }
    if (data.bookings.length) await db.delete(bookings).where(notInArray(bookings.id, data.bookings.map((booking) => Number(booking.id))));
    else await db.delete(bookings);
    if (data.properties.length) await db.delete(properties).where(notInArray(properties.id, data.properties.map((property) => Number(property.id))));
    else await db.delete(properties);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Backup restore failed", error);
    return Response.json({ error: "Could not restore this backup. Your saved backup was not deleted." }, { status: 500 });
  }
}
