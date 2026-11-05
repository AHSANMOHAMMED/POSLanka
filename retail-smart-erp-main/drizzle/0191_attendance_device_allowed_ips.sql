-- Optional network lock for fingerprint / face terminals (ADMS push sends only the serial number).
-- NULL or empty = accept the device from any address (existing devices keep working unchanged).
ALTER TABLE "attendance_devices" ADD COLUMN IF NOT EXISTS "allowed_ips" text[];

COMMENT ON COLUMN "attendance_devices"."allowed_ips" IS 'IPv4/IPv6 addresses or IPv4 CIDR ranges the device may push from; NULL/empty = any';
