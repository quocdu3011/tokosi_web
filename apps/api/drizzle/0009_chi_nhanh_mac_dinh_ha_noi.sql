-- Chủ dự án chốt (04/11/2026): chi nhánh mặc định là Hà Nội (trước đó tạm đặt Sài Gòn).
-- Chỉ ảnh hưởng CSDL đã seed; CSDL mới do seed tạo sẵn đúng. Bỏ cờ cũ trước vì chỉ mục duy nhất một chi nhánh mặc định.
UPDATE "branches" SET "is_default" = false WHERE "code" = 'SG' AND "is_default" = true;--> statement-breakpoint
UPDATE "branches" SET "is_default" = true WHERE "code" = 'HN' AND NOT EXISTS (SELECT 1 FROM "branches" WHERE "is_default" = true);
