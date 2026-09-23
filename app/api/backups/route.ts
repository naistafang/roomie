import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { createAutomaticBackup, parseBackupData, replaceAccountData } from "../../../db/backups";
import { backupSnapshots } from "../../../db/schema";
import { requireAccount } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const owner = await requireAccount();
  if (owner instanceof Response) return owner;
  const backups = await getDb().select({ id: backupSnapshots.id, reason: backupSnapshots.reason, createdAt: backupSnapshots.createdAt })
    .from(backupSnapshots).where(eq(backupSnapshots.ownerEmail, owner)).orderBy(desc(backupSnapshots.id)).limit(25);
  return Response.json({ backups });
}

export async function POST(request: Request) {
  const owner = await requireAccount();
  if (owner instanceof Response) return owner;
  try {
    const backupId = Number(((await request.json()) as { backupId?: number }).backupId);
    if (!Number.isInteger(backupId)) return Response.json({ error: "Invalid backup" }, { status: 400 });
    const [snapshot] = await getDb().select().from(backupSnapshots)
      .where(and(eq(backupSnapshots.id, backupId), eq(backupSnapshots.ownerEmail, owner))).limit(1);
    if (!snapshot) return Response.json({ error: "Backup not found" }, { status: 404 });
    const payload = JSON.parse(snapshot.payload) as { properties?: unknown; bookings?: unknown };
    const data = parseBackupData(payload.properties, payload.bookings);
    if ("error" in data) return Response.json({ error: "Backup is damaged" }, { status: 422 });

    await createAutomaticBackup(owner, "Before restoring a backup");
    await replaceAccountData(owner, data);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Backup restore failed", error);
    return Response.json({ error: "Could not restore this backup. Your saved backup was not deleted." }, { status: 500 });
  }
}
