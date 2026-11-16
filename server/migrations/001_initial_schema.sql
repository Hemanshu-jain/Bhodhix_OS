CREATE TABLE organizations (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  email_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE TABLE memberships (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  work_mode text NOT NULL DEFAULT 'office',
  project_ids jsonb NOT NULL DEFAULT 'null'::jsonb,
);
CREATE INDEX memberships_user_idx ON memberships (user_id, active);
CREATE UNIQUE INDEX memberships_active_unique ON memberships (organization_id, user_id) WHERE active;

CREATE TABLE invites (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
  token_hash text NOT NULL UNIQUE,
  invited_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE email_tokens (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  UNIQUE (user_id, purpose)
);

CREATE TABLE workspace_profiles (
  organization_id text PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  name text NOT NULL,
  overview text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  finances jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, project_id)
);

CREATE TABLE features (
  organization_id text NOT NULL,
  project_id text NOT NULL,
  feature_id text NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'planned',
  readiness text NOT NULL DEFAULT '',
  owner text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (organization_id, project_id, feature_id),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, project_id) ON DELETE CASCADE
);

CREATE TABLE tasks (
  organization_id text NOT NULL,
  project_id text NOT NULL,
  task_id text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'review', 'done', 'hold', 'upcoming')),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
  assignee_id uuid REFERENCES users(id) ON DELETE SET NULL,
  assignee_label text NOT NULL DEFAULT '',
  start_at timestamptz,
  due_at timestamptz,
  reminder_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtasks jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (organization_id, project_id, task_id),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, project_id) ON DELETE CASCADE
);
CREATE INDEX tasks_due_idx ON tasks (organization_id, due_at) WHERE status <> 'done';
CREATE INDEX tasks_assignee_idx ON tasks (organization_id, assignee_id, status);

CREATE TABLE task_activity (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  project_id text NOT NULL,
  task_id text NOT NULL,
  type text NOT NULL,
  author text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  value text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (organization_id, project_id, task_id) REFERENCES tasks(organization_id, project_id, task_id) ON DELETE CASCADE
);
CREATE INDEX task_activity_order_idx ON task_activity (organization_id, project_id, task_id, created_at);

CREATE TABLE task_trash (
  organization_id text NOT NULL,
  project_id text NOT NULL,
  task_id text NOT NULL,
  title text NOT NULL,
  reason text NOT NULL,
  deleted_by text NOT NULL DEFAULT '',
  deleted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  task_snapshot jsonb NOT NULL,
  activity_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (organization_id, project_id, task_id),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, project_id) ON DELETE CASCADE
);
CREATE INDEX task_trash_expiry_idx ON task_trash (expires_at);

CREATE TABLE workspace_documents (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text,
  path text NOT NULL,
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, path),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, project_id) ON DELETE CASCADE
);

CREATE TABLE billing_clients (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE billing_documents (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id uuid REFERENCES billing_clients(id) ON DELETE SET NULL,
  document_type text NOT NULL CHECK (document_type IN ('quotation', 'invoice')),
  document_number text NOT NULL,
  project_id text,
  status text NOT NULL DEFAULT 'draft',
  issue_date date,
  due_date date,
  valid_until date,
  currency char(3) NOT NULL DEFAULT 'INR',
  subtotal numeric(14,2) NOT NULL DEFAULT 0,
  tax_total numeric(14,2) NOT NULL DEFAULT 0,
  total numeric(14,2) NOT NULL DEFAULT 0,
  terms text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, document_type, document_number),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, project_id)
);
CREATE INDEX billing_documents_client_idx ON billing_documents (organization_id, client_id, issue_date DESC);

CREATE TABLE billing_document_items (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES billing_documents(id) ON DELETE CASCADE,
  position integer NOT NULL,
  description text NOT NULL,
  details text NOT NULL DEFAULT '',
  quantity numeric(12,3) NOT NULL DEFAULT 1,
  unit text NOT NULL DEFAULT '',
  unit_price numeric(14,2) NOT NULL DEFAULT 0,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (document_id, position)
);

CREATE TABLE finance_entries (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text,
  entry_type text NOT NULL CHECK (entry_type IN ('revenue', 'expense', 'overhead')),
  label text NOT NULL,
  amount numeric(14,2) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'INR',
  effective_date date,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, project_id) ON DELETE CASCADE
);

CREATE TABLE monitoring_endpoints (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text,
  name text NOT NULL,
  url text NOT NULL,
  method text NOT NULL DEFAULT 'GET',
  expected_status integer NOT NULL DEFAULT 200,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, project_id) ON DELETE CASCADE
);

CREATE TABLE monitoring_incidents (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text,
  title text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  description text NOT NULL DEFAULT '',
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, project_id) ON DELETE CASCADE
);

CREATE TABLE database_monitors (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text,
  name text NOT NULL,
  engine text NOT NULL,
  encrypted_connection bytea NOT NULL,
  encryption_metadata jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name),
  FOREIGN KEY (organization_id, project_id) REFERENCES projects(organization_id, project_id) ON DELETE CASCADE
);

CREATE TABLE field_routes (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  route_date date NOT NULL,
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  planned_distance_km numeric(10,2) NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE field_route_stops (
  id uuid PRIMARY KEY,
  route_id uuid NOT NULL REFERENCES field_routes(id) ON DELETE CASCADE,
  position integer NOT NULL,
  name text NOT NULL,
  address text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (route_id, position)
);

CREATE TABLE field_shifts (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  check_in_at timestamptz,
  check_out_at timestamptz,
  activity_status text NOT NULL DEFAULT 'working',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE field_trips (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  route_id uuid REFERENCES field_routes(id) ON DELETE SET NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  departure_at timestamptz,
  return_at timestamptz,
  start_odometer numeric(12,1),
  end_odometer numeric(12,1),
  planned_distance_km numeric(10,2),
  actual_distance_km numeric(10,2),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE field_expense_claims (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_id uuid REFERENCES field_trips(id) ON DELETE SET NULL,
  amount numeric(14,2) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'INR',
  claim_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  description text NOT NULL DEFAULT '',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE field_photos (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  mime_type text NOT NULL,
  ciphertext bytea NOT NULL,
  iv bytea NOT NULL,
  auth_tag bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE encrypted_workspace_data (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  data_type text NOT NULL,
  data_key text NOT NULL,
  revision bigint NOT NULL DEFAULT 1,
  ciphertext bytea NOT NULL,
  encryption_metadata jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX encrypted_workspace_data_unique ON encrypted_workspace_data
  (organization_id, data_type, data_key, COALESCE(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE workspace_settings (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  setting_key text NOT NULL,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, setting_key)
);

CREATE TABLE secret_vault_audit (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entry_id text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE notification_deliveries (
  id text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  sent_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE mcp_oauth_records (
  id text PRIMARY KEY,
  owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  organization_id text REFERENCES organizations(id) ON DELETE CASCADE,
  record_type text NOT NULL,
  expires_at timestamptz,
  record jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE legacy_files (
  id uuid PRIMARY KEY,
  organization_id text,
  source_key text NOT NULL,
  relative_path text NOT NULL,
  content bytea NOT NULL,
  sha256 char(64) NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_key, relative_path)
);

CREATE TABLE migration_runs (
  id uuid PRIMARY KEY,
  organization_id text REFERENCES organizations(id) ON DELETE SET NULL,
  source_fingerprint char(64) NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  error text
);
