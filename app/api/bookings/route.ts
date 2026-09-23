import { and, asc, eq, gt, lt, ne } from "drizzle-orm";
import { getDb } from "../../../db";
import { createAutomaticBackup } from "../../../db/backups";
import { bookings } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

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

export async function GET(request: Request) {
  if (!(await getChatGPTUser())) return Response.json({ error: "Sign in required" }, { status: 401 });
  const propertyParam = new URL(request.url).searchParams.get("propertyId");
  const propertyId = Number(propertyParam);
  const rows = propertyParam && Number.isInteger(propertyId)
    ? await getDb().select().from(bookings).where(eq(bookings.propertyId, propertyId)).orderBy(asc(bookings.checkIn))
    : await getDb().select().from(bookings).orderBy(asc(bookings.checkIn));
  return Response.json({ bookings: rows });
}

export async function POST(request: Request) {
  if (!(await getChatGPTUser())) return Response.json({ error: "Sign in required" }, { status: 401 });
  const body = (await request.json()) as Record<string, unknown>;
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
  const status = ["confirmed", "pending", "blocked"].includes(String(body.status)) ? String(body.status) as "confirmed" | "pending" | "blocked" : "confirmed";
  if (!Number.isInteger(propertyId) || !validDate(checkIn) || !validDate(checkOut) || checkOut <= checkIn || !validTime(checkInTime) || !validTime(checkOutTime)) {
    return Response.json({ error: "Choose valid check-in and check-out dates" }, { status: 400 });
  }
  if (!guestName && status !== "blocked") return Response.json({ error: "Guest name is required" }, { status: 400 });
  if (!Number.isInteger(guestCount) || guestCount < 1) return Response.json({ error: "Enter a valid guest count" }, { status: 400 });
  if (!roomLabel) return Response.json({ error: "Choose a room" }, { status: 400 });
  if (!Number.isFinite(nightlyPrice) || nightlyPrice < 0) return Response.json({ error: "Enter a valid nightly price" }, { status: 400 });
  if (!Number.isFinite(amountPaid) || amountPaid < 0) return Response.json({ error: "Enter a valid amount paid" }, { status: 400 });
  const db = getDb();
  const overlap = await db.select({ id: bookings.id, roomLabel: bookings.roomLabel }).from(bookings).where(and(
    eq(bookings.propertyId, propertyId), ne(bookings.status, "cancelled"), lt(bookings.checkIn, checkOut), gt(bookings.checkOut, checkIn)
  ));
  const normalizedRoom = canonicalRoom(roomLabel);
  const conflicts = overlap.some((existing) => {
    const existingRoom = canonicalRoom(existing.roomLabel);
    return normalizedRoom === "full" || existingRoom === "full" || normalizedRoom === existingRoom;
  });
  if (conflicts) return Response.json({ error: `${roomLabel} is already booked for one or more selected nights` }, { status: 409 });
  const nights = Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86400000);
  const cents = Math.round(nightlyPrice * 100);
  const amountPaidCents = Math.round(amountPaid * 100);
  const totalPriceCents = cents * nights + fees.reduce((sum, fee) => sum + fee.amountCents, 0);
  if (amountPaidCents > totalPriceCents) return Response.json({ error: "Amount paid cannot exceed the total" }, { status: 400 });
  await createAutomaticBackup("Before adding a booking");
  const [booking] = await db.insert(bookings).values({
    propertyId, guestName: guestName || "Blocked", guestPhone, guestEmail, guestCount, checkIn, checkOut, checkInTime, checkOutTime, nightlyPriceCents: cents,
    totalPriceCents, amountPaidCents, paymentMethod, status, notes: String(body.notes ?? "").trim(), roomLabel, bookingColor, cleaningStatus, fees: JSON.stringify(fees),
  }).returning();
  return Response.json({ booking }, { status: 201 });
}
