ALTER TABLE `provider_models` ADD `enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `provider_models` ADD `discovery_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `provider_models` ADD `enabled_order` integer;