import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const properties = sqliteTable("properties", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  address: text("address").notNull().default(""),
  roomOptions: text("room_options").notNull().default('["Single room","Master room","Full"]'),
  highlightColor: text("highlight_color").notNull().default("#246bfd"),
  nightlyRateCents: integer("nightly_rate_cents").notNull().default(0),
  defaultCheckInTime: text("default_check_in_time").notNull().default("15:00"),
  defaultCheckOutTime: text("default_check_out_time").notNull().default("11:00"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const bookings = sqliteTable(
  "bookings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    propertyId: integer("property_id").notNull().references(() => properties.id, { onDelete: "cascade" }),
    guestName: text("guest_name").notNull(),
    guestPhone: text("guest_phone").notNull().default(""),
    guestEmail: text("guest_email").notNull().default(""),
    guestCount: integer("guest_count").notNull().default(1),
    checkIn: text("check_in").notNull(),
    checkOut: text("check_out").notNull(),
    checkInTime: text("check_in_time").notNull().default("15:00"),
    checkOutTime: text("check_out_time").notNull().default("11:00"),
    nightlyPriceCents: integer("nightly_price_cents").notNull(),
    totalPriceCents: integer("total_price_cents").notNull(),
    amountPaidCents: integer("amount_paid_cents").notNull().default(0),
    paymentMethod: text("payment_method", { enum: ["cash", "credit_card", "unspecified"] }).notNull().default("unspecified"),
    status: text("status", { enum: ["confirmed", "pending", "blocked", "cancelled", "checked_out"] }).notNull().default("confirmed"),
    notes: text("notes").notNull().default(""),
    roomLabel: text("room_label").notNull().default("Full"),
    bookingColor: text("booking_color").notNull().default("#246bfd"),
    cleaningStatus: text("cleaning_status", { enum: ["clean", "not_clean"] }).notNull().default("not_clean"),
    fees: text("fees").notNull().default("[]"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_bookings_property_check_in").on(table.propertyId, table.checkIn)],
);

export const backupSnapshots = sqliteTable("backup_snapshots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  reason: text("reason").notNull(),
  payload: text("payload").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
