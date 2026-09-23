import { and, asc, desc, eq, notInArray } from "drizzle-orm";
import { getD1, getDb } from ".";
import { backupSnapshots, bookings, properties } from "./schema";

type Row = Record<string, unknown>;

export async function createAutomaticBackup(ownerEmail: string, reason: string) {
  const db = getDb();
  const [propertyRows, bookingRows] = await Promise.all([
    db.select().from(properties).where(eq(properties.ownerEmail, ownerEmail)).orderBy(asc(properties.id)),
    db.select().from(bookings).where(eq(bookings.ownerEmail, ownerEmail)).orderBy(asc(bookings.id)),
  ]);
  await db.insert(backupSnapshots).values({
    ownerEmail,
    reason,
    payload: JSON.stringify({ properties: propertyRows, bookings: bookingRows }),
  });

  const keep = await db.select({ id: backupSnapshots.id }).from(backupSnapshots)
    .where(eq(backupSnapshots.ownerEmail, ownerEmail)).orderBy(desc(backupSnapshots.id)).limit(25);
  if (keep.length) {
    await db.delete(backupSnapshots).where(and(eq(backupSnapshots.ownerEmail, ownerEmail), notInArray(backupSnapshots.id, keep.map((item) => item.id))));
  }
}

function text(value: unknown, fallback = "") { return typeof value === "string" ? value : fallback; }
function integer(value: unknown, fallback = 0) { const number = Number(value); return Number.isInteger(number) ? number : fallback; }
function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value); }
function validTime(value: string) { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
function validColor(value: string) { return /^#[0-9a-f]{6}$/i.test(value); }

export type BackupData = ReturnType<typeof toRows>;

function toRows(propertyInput: Row[], bookingInput: Row[]) {
  const propertyRows = propertyInput.map((row, index) => ({
    id: integer(row.id), name: text(row.name).trim(), address: text(row.address), roomOptions: text(row.roomOptions, '["Single room","Master room","Full"]'),
    highlightColor: validColor(text(row.highlightColor)) ? text(row.highlightColor) : "#246bfd", nightlyRateCents: Math.max(0, integer(row.nightlyRateCents)),
    defaultCheckInTime: validTime(text(row.defaultCheckInTime)) ? text(row.defaultCheckInTime) : "15:00", defaultCheckOutTime: validTime(text(row.defaultCheckOutTime)) ? text(row.defaultCheckOutTime) : "11:00",
    sortOrder: integer(row.sortOrder, index), createdAt: text(row.createdAt, new Date().toISOString()),
  }));
  const bookingRows = bookingInput.map((row) => {
    const status = text(row.status, "confirmed");
    const cleaningStatus = text(row.cleaningStatus, "not_clean");
    const paymentMethod = text(row.paymentMethod, "unspecified");
    return {
      propertyId: integer(row.propertyId), guestName: text(row.guestName).trim(), guestPhone: text(row.guestPhone), guestEmail: text(row.guestEmail), guestCount: Math.max(1, integer(row.guestCount, 1)),
      checkIn: text(row.checkIn), checkOut: text(row.checkOut), checkInTime: validTime(text(row.checkInTime)) ? text(row.checkInTime) : "15:00", checkOutTime: validTime(text(row.checkOutTime)) ? text(row.checkOutTime) : "11:00",
      nightlyPriceCents: Math.max(0, integer(row.nightlyPriceCents)), totalPriceCents: Math.max(0, integer(row.totalPriceCents)), amountPaidCents: Math.max(0, integer(row.amountPaidCents)),
      paymentMethod: ["cash", "credit_card"].includes(paymentMethod) ? paymentMethod : "unspecified",
      status: ["confirmed", "pending", "blocked", "cancelled", "checked_out"].includes(status) ? status : "confirmed", notes: text(row.notes), roomLabel: text(row.roomLabel, "Full"),
      bookingColor: validColor(text(row.bookingColor)) ? text(row.bookingColor) : "#246bfd", cleaningStatus: ["clean", "not_clean"].includes(cleaningStatus) ? cleaningStatus : "not_clean",
      fees: text(row.fees, "[]"), createdAt: text(row.createdAt, new Date().toISOString()),
    };
  });
  return { properties: propertyRows, bookings: bookingRows };
}

/**
 * Validates listings and bookings from an exported file or an automatic backup.
 * Row ids are only used to link bookings to listings inside the data; they are never written.
 */
export function parseBackupData(propertyInput: unknown, bookingInput: unknown): BackupData | { error: string } {
  if (!Array.isArray(propertyInput) || !Array.isArray(bookingInput)) return { error: "Choose a Roomie backup JSON file" };
  const data = toRows(propertyInput as Row[], bookingInput as Row[]);
  const propertyIds = new Set(data.properties.map((row) => row.id));
  const names = new Set(data.properties.map((row) => row.name));
  if (data.properties.some((row) => row.id < 1 || !row.name) || propertyIds.size !== data.properties.length) return { error: "This backup has invalid properties" };
  if (names.size !== data.properties.length) return { error: "This backup has two listings with the same name" };
  if (data.bookings.some((row) => !propertyIds.has(row.propertyId) || !row.guestName || !validDate(row.checkIn) || !validDate(row.checkOut) || row.checkOut <= row.checkIn)) {
    return { error: "This backup has invalid bookings" };
  }
  return data;
}

/** Atomically replaces one account's listings and bookings. Other accounts' rows are never touched. */
export async function replaceAccountData(ownerEmail: string, data: BackupData) {
  const d1 = getD1();
  const nameById = new Map(data.properties.map((row) => [row.id, row.name]));
  const statements = [
    d1.prepare("DELETE FROM bookings WHERE owner_email = ?").bind(ownerEmail),
    d1.prepare("DELETE FROM properties WHERE owner_email = ?").bind(ownerEmail),
  ];
  for (const row of data.properties) {
    statements.push(d1.prepare("INSERT INTO properties (owner_email,name,address,room_options,highlight_color,nightly_rate_cents,default_check_in_time,default_check_out_time,sort_order,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(ownerEmail, row.name, row.address, row.roomOptions, row.highlightColor, row.nightlyRateCents, row.defaultCheckInTime, row.defaultCheckOutTime, row.sortOrder, row.createdAt));
  }
  // New listing ids aren't known until insert, so each booking finds its listing by (owner, name) within the same batch.
  for (const row of data.bookings) {
    statements.push(d1.prepare("INSERT INTO bookings (owner_email,property_id,guest_name,guest_phone,guest_email,guest_count,check_in,check_out,check_in_time,check_out_time,nightly_price_cents,total_price_cents,amount_paid_cents,payment_method,status,notes,room_label,booking_color,cleaning_status,fees,created_at) VALUES (?,(SELECT id FROM properties WHERE owner_email = ? AND name = ?),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(ownerEmail, ownerEmail, nameById.get(row.propertyId), row.guestName, row.guestPhone, row.guestEmail, row.guestCount, row.checkIn, row.checkOut, row.checkInTime, row.checkOutTime, row.nightlyPriceCents, row.totalPriceCents, row.amountPaidCents, row.paymentMethod, row.status, row.notes, row.roomLabel, row.bookingColor, row.cleaningStatus, row.fees, row.createdAt));
  }
  await d1.batch(statements);
}
