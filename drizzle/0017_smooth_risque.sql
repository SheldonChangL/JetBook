ALTER TABLE "org_settings" ALTER COLUMN "name" SET DEFAULT 'Jet Opto 凱銳光電';--> statement-breakpoint
-- 公司名稱更正：僅更新仍停留在舊預設值的列，不覆寫已自訂的組織名稱。
UPDATE "org_settings" SET "name" = 'Jet Opto 凱銳光電' WHERE "name" = 'Jet Opto 捷揚光電';