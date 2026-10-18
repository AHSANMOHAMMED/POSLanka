-- Staff-to-staff real-time chat system
-- Supports direct messages (1-on-1) and group chats within a tenant

-- Conversations (DM or group)
CREATE TABLE staff_chat_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  type VARCHAR(20) NOT NULL DEFAULT 'direct',  -- 'direct' or 'group'
  name VARCHAR(255),                            -- Group name (null for DM)
  description TEXT,
  avatar_color VARCHAR(20),                     -- Predefined color for group icon
  last_message_at TIMESTAMP DEFAULT NOW(),
  last_message_preview TEXT,
  last_message_sender_name VARCHAR(255),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Participants (many-to-many users <-> conversations)
CREATE TABLE staff_chat_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES staff_chat_conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  unread_count INTEGER NOT NULL DEFAULT 0,
  last_read_at TIMESTAMP,
  is_muted BOOLEAN NOT NULL DEFAULT false,
  role VARCHAR(20) NOT NULL DEFAULT 'member',   -- 'admin' or 'member'
  joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
  left_at TIMESTAMP,                            -- null = active participant
  UNIQUE(conversation_id, user_id)
);

-- Messages
CREATE TABLE staff_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES staff_chat_conversations(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  sender_id UUID NOT NULL REFERENCES users(id),
  sender_name VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  message_type VARCHAR(20) NOT NULL DEFAULT 'text',  -- 'text' or 'system'
  metadata JSONB DEFAULT '{}',
  edited_at TIMESTAMP,
  deleted_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_staff_chat_conv_tenant ON staff_chat_conversations(tenant_id);
CREATE INDEX idx_staff_chat_conv_last_msg ON staff_chat_conversations(last_message_at DESC);
CREATE INDEX idx_staff_chat_conv_type ON staff_chat_conversations(type);

CREATE INDEX idx_staff_chat_part_conv ON staff_chat_participants(conversation_id);
CREATE INDEX idx_staff_chat_part_user ON staff_chat_participants(user_id);
CREATE INDEX idx_staff_chat_part_tenant ON staff_chat_participants(tenant_id);

CREATE INDEX idx_staff_chat_msg_conv ON staff_chat_messages(conversation_id);
CREATE INDEX idx_staff_chat_msg_tenant ON staff_chat_messages(tenant_id);
CREATE INDEX idx_staff_chat_msg_created ON staff_chat_messages(created_at DESC);
CREATE INDEX idx_staff_chat_msg_sender ON staff_chat_messages(sender_id);

-- Enable RLS
ALTER TABLE staff_chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_chat_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies (tenant isolation)
CREATE POLICY tenant_isolation_staff_chat_conversations ON staff_chat_conversations
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_staff_chat_participants ON staff_chat_participants
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY tenant_isolation_staff_chat_messages ON staff_chat_messages
  FOR ALL USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
