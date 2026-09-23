import { asc } from "drizzle-orm";
import { getDb } from "../../../db";
import { bookings, properties } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in required" }, { status: 401 });

  const db = getDb();
  const [propertyRows, bookingRows] = await Promise.all([
    db.select().from(properties).orderBy(asc(properties.name)),
    db.select().from(bookings).orderBy(asc(bookings.checkIn)),
  ]);
  const exportedAt = new Date().toISOString();
  const fileDate = exportedAt.slice(0, 10);
  const backup = {
    format: "stay-calendar-backup",
    version: 1,
    exportedAt,
    exportedBy: user.email,
    properties: propertyRows,
    bookings: bookingRows,
  };

  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="stay-calendar-backup-${fileDate}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
