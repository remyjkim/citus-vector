CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "chunks" (
	"id" bigserial NOT NULL,
	"channel_id" bigint NOT NULL,
	"user_id" bigint NOT NULL,
	"writer_channel_id" bigint,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	PRIMARY KEY (id, channel_id)
);
