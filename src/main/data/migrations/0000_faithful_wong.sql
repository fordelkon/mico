CREATE TABLE `provider_library_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`selected_model_id` text
);
--> statement-breakpoint
CREATE TABLE `provider_models` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`display_name` text NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `providers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_models_provider_model` ON `provider_models` (`provider_id`,`model_id`);--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`api_format` text,
	`api_key` text,
	`base_url` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`headers` text DEFAULT '{}' NOT NULL,
	`icon` text,
	`max_tokens` integer,
	`name` text,
	`use_max_completion_tokens` integer
);
