import { createAutomaticBackup } from "../../../db/backups";
import { getD1 } from "../../../db";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

function text(value: unknown, fallback = "") { return typeof value === "string" ? value : fallback; }
function integer(value: unknown, fallback = 0) { const number = Number(value); return Number.isInteger(number) ? number : fallback; }
function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value); }
function validTime(value: string) { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
function validColor(value: string) { return /^#[0-9a-f]{6}$/i.test(value); }

export async function POST(request: Request) {
  if (!(await getChatGPTUser())) return Response.json({ error: "Sign in required" }, { status: 401 });
  if (Number(request.headers.get("content-length") || 0) > 2_000_000) return Response.json({ error: "This backup file is too large" }, { status: 413 });
  try {
    const body = await request.json() as Row;
    if (body.format !== "stay-calendar-backup" || !Array.isArray(body.properties) || !Array.isArray(body.bookings)) {
      return Response.json({ error: "Choose a Roomie backup JSON file" }, { status: 422 });
    }
    if (body.properties.length > 100 || body.bookings.length > 500) return Response.json({ error: "This backup contains too many records" }, { status: 422 });

    const propertyRows = (body.properties as Row[]).map((row, index) => ({
      id: integer(row.id), name: text(row.name).trim(), address: text(row.address), roomOptions: text(row.roomOptions, '["Single room","Master room","Full"]'),
      highlightColor: validColor(text(row.highlightColor)) ? text(row.highlightColor) : "#246bfd", nightlyRateCents: Math.max(0, integer(row.nightlyRateCents)),
      defaultCheckInTime: validTime(text(row.defaultCheckInTime)) ? text(row.defaultCheckInTime) : "15:00", defaultCheckOutTime: validTime(text(row.defaultCheckOutTime)) ? text(row.defaultCheckOutTime) : "11:00",
      sortOrder: integer(row.sortOrder, index), createdAt: text(row.createdAt, new Date().toISOString()),
    }));
    const propertyIds = new Set(propertyRows.map((row) => row.id));
    if (propertyRows.some((row) => row.id < 1 || !row.name) || propertyIds.size !== propertyRows.length) return Response.json({ error: "This backup has invalid properties" }, { status: 422 });

    const bookingRows = (body.bookings as Row[]).map((row) => {
      const status = text(row.status, "confirmed");
      const cleaningStatus = text(row.cleaningStatus, "not_clean");
      const paymentMethod = text(row.paymentMethod, "unspecified");
      return {
        id: integer(row.id), propertyId: integer(row.propertyId), guestName: text(row.guestName).trim(), guestPhone: text(row.guestPhone), guestEmail: text(row.guestEmail), guestCount: Math.max(1, integer(row.guestCount, 1)),
        checkIn: text(row.checkIn), checkOut: text(row.checkOut), checkInTime: validTime(text(row.checkInTime)) ? text(row.checkInTime) : "15:00", checkOutTime: validTime(text(row.checkOutTime)) ? text(row.checkOutTime) : "11:00",
        nightlyPriceCents: Math.max(0, integer(row.nightlyPriceCents)), totalPriceCents: Math.max(0, integer(row.totalPriceCents)), amountPaidCents: Math.max(0, integer(row.amountPaidCents)),
        paymentMethod: ["cash", "credit_card"].includes(paymentMethod) ? paymentMethod : "unspecified",
        status: ["confirmed", "pending", "blocked", "cancelled", "checked_out"].includes(status) ? status : "confirmed", notes: text(row.notes), roomLabel: text(row.roomLabel, "Full"),
        bookingColor: validColor(text(row.bookingColor)) ? text(row.bookingColor) : "#246bfd", cleaningStatus: ["clean", "not_clean"].includes(cleaningStatus) ? cleaningStatus : "not_clean",
        fees: text(row.fees, "[]"), createdAt: text(row.createdAt, new Date().toISOString()),
      };
    });
    const bookingIds = new Set(bookingRows.map((row) => row.id));
    if (bookingRows.some((row) => row.id < 1 || !propertyIds.has(row.propertyId) || !row.guestName || !validDate(row.checkIn) || !validDate(row.checkOut) || row.checkOut <= row.checkIn) || bookingIds.size !== bookingRows.length) {
      return Response.json({ error: "This backup has invalid bookings" }, { status: 422 });
    }

    await createAutomaticBackup("Before restoring an exported backup");
    const d1 = getD1();
    const statements = [d1.prepare("DELETE FROM bookings"), d1.prepare("DELETE FROM properties")];
    for (const row of propertyRows) statements.push(d1.prepare("INSERT INTO properties (id,name,address,room_options,highlight_color,nightly_rate_cents,default_check_in_time,default_check_out_time,sort_order,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(row.id,row.name,row.address,row.roomOptions,row.highlightColor,row.nightlyRateCents,row.defaultCheckInTime,row.defaultCheckOutTime,row.sortOrder,row.createdAt));
    for (const row of bookingRows) statements.push(d1.prepare("INSERT INTO bookings (id,property_id,guest_name,guest_phone,guest_email,guest_count,check_in,check_out,check_in_time,check_out_time,nightly_price_cents,total_price_cents,amount_paid_cents,payment_method,status,notes,room_label,booking_color,cleaning_status,fees,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(row.id,row.propertyId,row.guestName,row.guestPhone,row.guestEmail,row.guestCount,row.checkIn,row.checkOut,row.checkInTime,row.checkOutTime,row.nightlyPriceCents,row.totalPriceCents,row.amountPaidCents,row.paymentMethod,row.status,row.notes,row.roomLabel,row.bookingColor,row.cleaningStatus,row.fees,row.createdAt));
    await d1.batch(statements);
    return Response.json({ ok: true, properties: propertyRows.length, bookings: bookingRows.length });
  } catch (error) {
    console.error("Exported backup restore failed", error);
    return Response.json({ error: "Could not restore this file. Your current data was preserved in an automatic backup." }, { status: 500 });
  }
}
