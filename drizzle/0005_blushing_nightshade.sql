ALTER TABLE `bookings` ADD `guest_phone` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `guest_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `guest_count` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `amount_paid_cents` integer DEFAULT 0 NOT NULL;