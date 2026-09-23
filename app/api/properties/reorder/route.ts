import { and, asc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { createAutomaticBackup } from "../../../../db/backups";
import { properties } from "../../../../db/schema";
import { requireAccount } from "../../../chatgpt-auth";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const owner = await requireAccount();
  if (owner instanceof Response) return owner;
  const body = (await request.json()) as { propertyIds?: unknown };
  const propertyIds = Array.isArray(body.propertyIds) ? body.propertyIds.map(Number) : [];
  if (!propertyIds.length || propertyIds.some((id) => !Number.isInteger(id) || id < 1) || new Set(propertyIds).size !== propertyIds.length) {
    return Response.json({ error: "Invalid property order" }, { status: 400 });
  }

  const db = getDb();
  const current = await db.select({ id: properties.id }).from(properties).where(eq(properties.ownerEmail, owner)).orderBy(asc(properties.sortOrder), asc(properties.id));
  if (current.length !== propertyIds.length || current.some((property) => !propertyIds.includes(property.id))) {
    return Response.json({ error: "Property list changed  reload and try again" }, { status: 409 });
  }

  await createAutomaticBackup(owner, "Before reordering properties");
  for (const [sortOrder, id] of propertyIds.entries()) {
    await db.update(properties).set({ sortOrder }).where(and(eq(properties.id, id), eq(properties.ownerEmail, owner)));
  }
  const reordered = await db.select().from(properties).where(eq(properties.ownerEmail, owner)).orderBy(asc(properties.sortOrder), asc(properties.id));
  return Response.json({ properties: reordered });
}
