-- Chat PDF annotations: shared rectangle + comment per page on a team-shared
-- PDF attachment. Storage is normalised so the same annotation rendered at
-- any scale lands on the same spot on the page.
--
-- `attachment_key` is the R2 object key. Including `team_id` separately is
-- redundant (the key embeds it) but lets us cascade on team deletion and
-- index without parsing the key. The (team_id, attachment_key, page) index
-- is what the reader hits when it opens a PDF.
CREATE TABLE `chat_pdf_annotation` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`attachment_key` text NOT NULL,
	`page` integer NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`w` real NOT NULL,
	`h` real NOT NULL,
	`body` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `team`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CHECK (`page` >= 1),
	CHECK (`x` >= 0 AND `x` <= 1 AND `y` >= 0 AND `y` <= 1),
	CHECK (`w` > 0 AND `w` <= 1 AND `h` > 0 AND `h` <= 1)
);
--> statement-breakpoint
CREATE INDEX `chat_pdf_annotation_lookup` ON `chat_pdf_annotation` (`team_id`, `attachment_key`, `page`);
