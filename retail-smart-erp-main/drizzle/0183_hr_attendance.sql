-- 0183 (2026-10): HR attendance for every business type — fingerprint devices, shifts, punches,
-- daily attendance, leave, holidays, and the attendance summary stored on salary slips.
--  * employee_profiles: biometric_user_id (the enrolment no. / PIN on the fingerprint machine),
--    default_shift_id, warehouse_id (branch), ot_eligible, ot_rate_multiplier, hourly_rate override.
--  * work_shifts / employee_shift_assignments: shift rules (grace, half/full day hours, OT start,
--    weekly off days 0=Sun..6=Sat); an assignment (from..to) wins over the employee's default shift.
--  * attendance_devices: ZKTeco/eSSL-compatible push (ADMS "iclock") devices, identified by their
--    serial number (globally unique: the serial is what maps an unauthenticated device to a tenant).
--  * attendance_pending_devices: platform table (no tenant, no RLS) of serials that contacted
--    /iclock but are not registered yet, so the register form can confirm "device seen".
--  * attendance_punches: raw check-ins (device / manual / import / mobile); employee is resolved
--    from biometric_user_id and may be NULL until the user id is mapped. Soft-deleted on correction.
--  * attendance_days: one computed row per employee per date (src/lib/attendance/compute.ts);
--    is_manual rows are never overwritten by a recalculation.
--  * holidays, leave_types, leave_requests.
--  * salary_slips.attendance_summary: working/paid/absent days, late minutes, OT hours of the slip.
-- Idempotent.
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS biometric_user_id varchar(50);
--> statement-breakpoint
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS default_shift_id uuid;
--> statement-breakpoint
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS ot_eligible boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS ot_rate_multiplier numeric(4,2) NOT NULL DEFAULT 1.5;
--> statement-breakpoint
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS hourly_rate numeric(12,2);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_profiles_biometric ON employee_profiles (tenant_id, biometric_user_id)
  WHERE biometric_user_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_employee_profiles_tenant_warehouse ON employee_profiles (tenant_id, warehouse_id);
--> statement-breakpoint
ALTER TABLE salary_slips ADD COLUMN IF NOT EXISTS attendance_summary jsonb;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS work_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  crosses_midnight boolean NOT NULL DEFAULT false,
  break_minutes integer NOT NULL DEFAULT 60,
  grace_late_minutes integer NOT NULL DEFAULT 10,
  grace_early_minutes integer NOT NULL DEFAULT 10,
  half_day_hours numeric(4,2) NOT NULL DEFAULT 4,
  full_day_hours numeric(4,2) NOT NULL DEFAULT 8,
  ot_starts_after_minutes integer NOT NULL DEFAULT 30,
  weekly_off_days integer[] NOT NULL DEFAULT '{0}',
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_shifts_tenant_name ON work_shifts (tenant_id, lower(name));
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_work_shifts_one_default ON work_shifts (tenant_id) WHERE is_default = true;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_employee_profiles_default_shift') THEN
    ALTER TABLE employee_profiles ADD CONSTRAINT fk_employee_profiles_default_shift
      FOREIGN KEY (default_shift_id) REFERENCES work_shifts(id) ON DELETE SET NULL;
  END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS employee_shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_profile_id uuid NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  shift_id uuid NOT NULL REFERENCES work_shifts(id) ON DELETE CASCADE,
  from_date date NOT NULL,
  to_date date,
  notes text,
  created_by uuid,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_shift_assignments_employee ON employee_shift_assignments (tenant_id, employee_profile_id, from_date);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS attendance_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  serial_number varchar(64) NOT NULL,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  model varchar(100),
  comm_key varchar(100),
  timezone varchar(50) NOT NULL DEFAULT 'Asia/Colombo',
  attlog_stamp varchar(50),
  last_seen_at timestamptz,
  last_ip varchar(64),
  device_info jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_devices_serial ON attendance_devices (upper(serial_number));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_attendance_devices_tenant ON attendance_devices (tenant_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS attendance_pending_devices (
  serial_number varchar(64) PRIMARY KEY,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_ip varchar(64),
  hits integer NOT NULL DEFAULT 1,
  info jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS attendance_punches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_profile_id uuid REFERENCES employee_profiles(id) ON DELETE CASCADE,
  biometric_user_id varchar(50),
  device_id uuid REFERENCES attendance_devices(id) ON DELETE SET NULL,
  punch_time timestamptz NOT NULL,
  punch_type varchar(10) NOT NULL DEFAULT 'unknown',
  verify_mode varchar(20),
  source varchar(10) NOT NULL DEFAULT 'device',
  raw jsonb,
  note text,
  is_deleted boolean NOT NULL DEFAULT false,
  deleted_by uuid,
  deleted_at timestamptz,
  created_by uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT chk_attendance_punches_type CHECK (punch_type IN ('in', 'out', 'unknown')),
  CONSTRAINT chk_attendance_punches_source CHECK (source IN ('device', 'manual', 'import', 'mobile'))
);
--> statement-breakpoint
-- One row per device + device user + instant (device re-uploads are ignored with ON CONFLICT DO NOTHING).
-- Manual / imported punches have no device: their key is the employee (or user id) + instant.
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_punches_device ON attendance_punches
  (tenant_id, COALESCE(device_id, '00000000-0000-0000-0000-000000000000'::uuid), COALESCE(biometric_user_id, ''),
   COALESCE(employee_profile_id, '00000000-0000-0000-0000-000000000000'::uuid), punch_time)
  WHERE device_id IS NOT NULL OR source <> 'device';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_attendance_punches_employee_time ON attendance_punches (tenant_id, employee_profile_id, punch_time);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_attendance_punches_unmapped ON attendance_punches (tenant_id, biometric_user_id)
  WHERE employee_profile_id IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS attendance_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_profile_id uuid NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  attendance_date date NOT NULL,
  shift_id uuid REFERENCES work_shifts(id) ON DELETE SET NULL,
  day_type varchar(12) NOT NULL DEFAULT 'working',
  first_in timestamptz,
  last_out timestamptz,
  punch_count integer NOT NULL DEFAULT 0,
  worked_minutes integer NOT NULL DEFAULT 0,
  late_minutes integer NOT NULL DEFAULT 0,
  early_leave_minutes integer NOT NULL DEFAULT 0,
  ot_minutes integer NOT NULL DEFAULT 0,
  missed_punch boolean NOT NULL DEFAULT false,
  status varchar(12) NOT NULL DEFAULT 'absent',
  leave_type_id uuid,
  leave_fraction numeric(3,1) NOT NULL DEFAULT 0,
  leave_paid boolean NOT NULL DEFAULT false,
  is_manual boolean NOT NULL DEFAULT false,
  notes text,
  approved_by uuid,
  approved_at timestamptz,
  computed_at timestamptz,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT chk_attendance_days_status CHECK (status IN ('present', 'absent', 'half_day', 'leave', 'holiday', 'weekly_off')),
  CONSTRAINT chk_attendance_days_day_type CHECK (day_type IN ('working', 'weekly_off', 'holiday'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_days_employee_date ON attendance_days (tenant_id, employee_profile_id, attendance_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_attendance_days_tenant_date ON attendance_days (tenant_id, attendance_date);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  name varchar(150) NOT NULL,
  is_paid boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_holidays_tenant_date ON holidays (tenant_id, holiday_date);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS leave_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name varchar(100) NOT NULL,
  code varchar(20),
  days_per_year numeric(5,1) NOT NULL DEFAULT 0,
  is_paid boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_types_tenant_name ON leave_types (tenant_id, lower(name));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  employee_profile_id uuid NOT NULL REFERENCES employee_profiles(id) ON DELETE CASCADE,
  leave_type_id uuid NOT NULL REFERENCES leave_types(id),
  from_date date NOT NULL,
  to_date date NOT NULL,
  half_day boolean NOT NULL DEFAULT false,
  days numeric(5,1) NOT NULL DEFAULT 1,
  reason text,
  status varchar(12) NOT NULL DEFAULT 'pending',
  approved_by uuid,
  approved_at timestamptz,
  rejection_reason text,
  created_by uuid,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT chk_leave_requests_status CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  CONSTRAINT chk_leave_requests_dates CHECK (to_date >= from_date)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests (tenant_id, employee_profile_id, from_date);
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['work_shifts', 'employee_shift_assignments', 'attendance_devices', 'attendance_punches',
                           'attendance_days', 'holidays', 'leave_types', 'leave_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_policy ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_isolation_policy ON %I FOR ALL TO public
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
    EXECUTE format('DROP POLICY IF EXISTS platform_login_access ON %I', t);
    EXECUTE format($p$CREATE POLICY platform_login_access ON %I FOR ALL TO public
      USING (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')
      WITH CHECK (current_user <> 'app_user' AND COALESCE(current_setting('app.rls_strict', true), '') <> 'on')$p$, t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
    END IF;
  END LOOP;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    GRANT SELECT, DELETE ON attendance_pending_devices TO app_user;
  END IF;
END $$;
