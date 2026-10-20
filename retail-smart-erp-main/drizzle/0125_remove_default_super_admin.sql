-- Deactivate the legacy default super admin seeded by 0029 on existing databases,
-- but only while it still carries the original (publicly known) password hash.
UPDATE "super_admins"
SET "is_active" = false, "updated_at" = now()
WHERE "email" = 'ravindu2012@hotmail.com'
  AND "password_hash" = '$2b$10$LAXF8IdzNXN9ajSG9WzTseDlY..h.BE/yD8v/ZjdoVXK0TMK6S6Ji';
