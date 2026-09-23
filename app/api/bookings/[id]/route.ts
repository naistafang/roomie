import { and, eq, gt, lt, ne } from "drizzle-orm";
import { getDb } from "../../../../db";
import { createAutomaticBackup } from "../../../../db/backups";
import { bookings, properties } from "../../../../db/schema";
import { requireAccount } from "../../../chatgpt-auth";

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validTime(value: unknown): value is string {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function canonicalRoom(label: string) {
  const normalized = label.trim().toLocaleLowerCase();
  if (["full", "全包", "entire property", "whole property"].includes(normalized)) return "full";
  if (["single", "single room", "單間", "单间"].includes(normalized)) return "single";
  if (["master", "master room", "studio", "studio room", "suite", "套房"].includes(normalized)) return "master";
  return normalized;
}

function parseFees(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const fee = item as Record<string, unknown>;
    return { name: String(fee.name ?? "").trim(), amountCents: Math.round(Number(fee.amount) * 100) };
  }).filter((fee) => fee.name && Number.isInteger(fee.amountCents) && fee.amountCents >= 0);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const owner = await requireAccount();
  if (owner instanceof Response) return owner;
  const { id } = await context.params;
  const bookingId = Number(id);
  const body = (await request.json()) as Record<string, unknown>;
  if (!Number.isInteger(bookingId)) return Response.json({ error: "Invalid booking" }, { status: 400 });
  const status = String(body.status ?? "");
  if (!("propertyId" in body)) {
    if ("cleaningStatus" in body) {
      const cleaningStatus = String(body.cleaningStatus);
      if (!["clean", "not_clean"].includes(cleaningStatus)) return Response.json({ error: "Invalid cleaning status" }, { status: 400 });
      await createAutomaticBackup(owner, "Before changing cleaning status");
      const [booking] = await getDb().update(bookings).set({ cleaningStatus: cleaningStatus as "clean" | "not_clean" }).where(and(eq(bookings.id, bookingId), eq(bookings.ownerEmail, owner))).returning();
      if (!booking) return Response.json({ error: "Booking not found" }, { status: 404 });
      return Response.json({ booking });
    }
    if (!["confirmed", "pending", "blocked", "cancelled", "checked_out"].includes(status)) return Response.json({ error: "Invalid update" }, { status: 400 });
    await createAutomaticBackup(owner, status === "cancelled" ? "Before cancelling a booking" : status === "checked_out" ? "Before confirming check-out" : "Before changing booking status");
    const [booking] = await getDb().update(bookings).set({ status: status as "confirmed" | "pending" | "blocked" | "cancelled" | "checked_out" }).where(and(eq(bookings.id, bookingId), eq(bookings.ownerEmail, owner))).returning();
    if (!booking) return Response.json({ error: "Booking not found" }, { status: 404 });
    return Response.json({ booking });
  }
  const propertyId = Number(body.propertyId);
  const guestName = String(body.guestName ?? "").trim();
  const guestPhone = String(body.guestPhone ?? "").trim();
  const guestEmail = String(body.guestEmail ?? "").trim();
  const guestCount = Number(body.guestCount ?? 1);
  const checkIn = body.checkIn;
  const checkOut = body.checkOut;
  const checkInTime = body.checkInTime;
  const checkOutTime = body.checkOutTime;
  const nightlyPrice = Number(body.nightlyPrice);
  const amountPaid = Number(body.amountPaid ?? 0);
  const paymentMethod = ["cash", "credit_card"].includes(String(body.paymentMethod)) ? String(body.paymentMethod) as "cash" | "credit_card" : "unspecified";
  const fees = parseFees(body.fees);
  const roomLabel = String(body.roomLabel ?? "Full").trim();
  const bookingColor = /^#[0-9a-f]{6}$/i.test(String(body.bookingColor ?? "")) ? String(body.bookingColor) : "#246bfd";
  const cleaningStatus = body.cleaningStatus === "clean" ? "clean" : "not_clean";
  if (!Number.isInteger(propertyId) || !validDate(checkIn) || !validDate(checkOut) || checkOut <= checkIn || !validTime(checkInTime) || !validTime(checkOutTime)) return Response.json({ error: "Choose valid dates and times" }, { status: 400 });
  if (!guestName || !roomLabel) return Response.json({ error: "Guest name and room are required" }, { status: 400 });
  if (!Number.isInteger(guestCount) || guestCount < 1) return Response.json({ error: "Enter a valid guest count" }, { status: 400 });
  if (!Number.isFinite(nightlyPrice) || nightlyPrice < 0 || !Number.isFinite(amountPaid) || amountPaid < 0) return Response.json({ error: "Enter valid payment amounts" }, { status: 400 });
  if (!["confirmed", "pending", "blocked", "cancelled", "checked_out"].includes(status)) return Response.json({ error: "Choose a valid status" }, { status: 400 });
  const db = getDb();
  const [ownedProperty] = await db.select({ id: properties.id }).from(properties).where(and(eq(properties.id, propertyId), eq(properties.ownerEmail, owner))).limit(1);
  if (!ownedProperty) return Response.json({ error: "Listing not found" }, { status: 404 });
  const overlap = await db.select({ roomLabel: bookings.roomLabel }).from(bookings).where(and(
    eq(bookings.ownerEmail, owner), eq(bookings.propertyId, propertyId), ne(bookings.id, bookingId), ne(bookings.status, "cancelled"), lt(bookings.checkIn, checkOut), gt(bookings.checkOut, checkIn)
  ));
  const normalizedRoom = canonicalRoom(roomLabel);
  if (overlap.some((existing) => normalizedRoom === "full" || canonicalRoom(existing.roomLabel) === "full" || canonicalRoom(existing.roomLabel) === normalizedRoom)) {
    return Response.json({ error: `${roomLabel} is already booked for one or more selected nights` }, { status: 409 });
  }
  const nights = Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86400000);
  const nightlyPriceCents = Math.round(nightlyPrice * 100);
  const totalPriceCents = nightlyPriceCents * nights + fees.reduce((sum, fee) => sum + fee.amountCents, 0);
  const amountPaidCents = Math.round(amountPaid * 100);
  if (amountPaidCents > totalPriceCents) return Response.json({ error: "Amount paid cannot exceed the total" }, { status: 400 });
  await createAutomaticBackup(owner, "Before editing a booking");
  const [booking] = await db.update(bookings).set({
    propertyId, guestName, guestPhone, guestEmail, guestCount, checkIn, checkOut, checkInTime, checkOutTime, nightlyPriceCents, totalPriceCents,
    amountPaidCents, paymentMethod, roomLabel, bookingColor, cleaningStatus, fees: JSON.stringify(fees), status: status as "confirmed" | "pending" | "blocked" | "cancelled" | "checked_out", notes: String(body.notes ?? "").trim(),
  }).where(and(eq(bookings.id, bookingId), eq(bookings.ownerEmail, owner))).returning();
  if (!booking) return Response.json({ error: "Booking not found" }, { status: 404 });
  return Response.json({ booking });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const owner = await requireAccount();
  if (owner instanceof Response) return owner;
  const { id } = await context.params;
  const bookingId = Number(id);
  if (!Number.isInteger(bookingId)) return Response.json({ error: "Invalid booking" }, { status: 400 });
  await createAutomaticBackup(owner, "Before permanently deleting a booking");
  const [deleted] = await getDb().delete(bookings).where(and(eq(bookings.id, bookingId), eq(bookings.ownerEmail, owner))).returning({ id: bookings.id });
  if (!deleted) return Response.json({ error: "Booking not found" }, { status: 404 });
  return Response.json({ ok: true });
}
