CREATE TABLE `chat_message` (
	`id` text PRIMARY KEY NOT NULL,
	`client_key` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `chat_message_client_created_idx` ON `chat_message` (`client_key`,`created_at`);