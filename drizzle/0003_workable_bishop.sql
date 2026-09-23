ALTER TABLE `bookings` ADD `room_label` text DEFAULT 'Full' NOT NULL;--> statement-breakpoint
ALTER TABLE `properties` ADD `room_options` text DEFAULT '["Single room","Master room","Full"]' NOT NULL;