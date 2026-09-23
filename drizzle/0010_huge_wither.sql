ALTER TABLE `bookings` ADD `check_in_time` text DEFAULT '15:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `check_out_time` text DEFAULT '11:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `properties` ADD `default_check_in_time` text DEFAULT '15:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `properties` ADD `default_check_out_time` text DEFAULT '11:00' NOT NULL;