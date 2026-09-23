import { asc, desc, notInArray } from "drizzle-orm";
import { getDb } from ".";
import { backupSnapshots, bookings, properties } from "./schema";

export async function createAutomaticBackup(reason: string) {
  const db = getDb();
  const [propertyRows, bookingRows] = await Promise.all([
    db.select().from(properties).orderBy(asc(properties.id)),
    db.select().from(bookings).orderBy(asc(bookings.id)),
  ]);
  await db.insert(backupSnapshots).values({
    reason,
    payload: JSON.stringify({ properties: propertyRows, bookings: bookingRows }),
  });

  const keep = await db.select({ id: backupSnapshots.id }).from(backupSnapshots).orderBy(desc(backupSnapshots.id)).limit(25);
  if (keep.length) await db.delete(backupSnapshots).where(notInArray(backupSnapshots.id, keep.map((item) => item.id)));
}
