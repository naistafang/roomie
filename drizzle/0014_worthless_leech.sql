DROP INDEX `properties_name_unique`;--> statement-breakpoint
ALTER TABLE `properties` ADD `owner_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `properties_owner_name_unique` ON `properties` (`owner_email`,`name`);--> statement-breakpoint
ALTER TABLE `backup_snapshots` ADD `owner_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_backup_snapshots_owner` ON `backup_snapshots` (`owner_email`,`id`);--> statement-breakpoint
ALTER TABLE `bookings` ADD `owner_email` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_bookings_owner_check_in` ON `bookings` (`owner_email`,`check_in`);--> statement-breakpoint
-- Data created before per-account storage belongs to the original owner.
UPDATE `properties` SET `owner_email` = 'fangyan0308@gmail.com' WHERE `owner_email` = '';--> statement-breakpoint
UPDATE `bookings` SET `owner_email` = 'fangyan0308@gmail.com' WHERE `owner_email` = '';--> statement-breakpoint
UPDATE `backup_snapshots` SET `owner_email` = 'fangyan0308@gmail.com' WHERE `owner_email` = '';
