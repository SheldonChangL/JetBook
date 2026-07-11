CREATE TABLE "space_member_groups" (
	"space_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"role" "space_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "space_member_groups_space_id_group_id_pk" PRIMARY KEY("space_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "space_member_groups" ADD CONSTRAINT "space_member_groups_space_id_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "public"."spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_member_groups" ADD CONSTRAINT "space_member_groups_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_smg_group" ON "space_member_groups" USING btree ("group_id");