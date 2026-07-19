CREATE TABLE `user_activity` (
	`day` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`day`, `user_id`)
);
--> statement-breakpoint
ALTER TABLE `session` ADD `country` text;--> statement-breakpoint
ALTER TABLE `user` ADD `is_anonymous` integer;