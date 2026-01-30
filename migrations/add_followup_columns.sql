-- Add follow-up tracking columns to conversations_new table
-- This fixes the "column conversations_new.follow_up_at does not exist" error

ALTER TABLE conversations_new 
ADD COLUMN IF NOT EXISTS follow_up_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS follow_up_note TEXT,
ADD COLUMN IF NOT EXISTS follow_up_type TEXT, -- call, visit, message, email
ADD COLUMN IF NOT EXISTS follow_up_priority TEXT DEFAULT 'medium', -- low, medium, high, urgent
ADD COLUMN IF NOT EXISTS follow_up_completed_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS follow_up_created_by TEXT;

-- Add indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_conversations_followup_at ON conversations_new(follow_up_at) WHERE follow_up_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_followup_salesman ON conversations_new(salesman_id, follow_up_at) WHERE follow_up_at IS NOT NULL;

-- Comments for clarity
COMMENT ON COLUMN conversations_new.follow_up_at IS 'Scheduled follow-up date/time for this conversation';
COMMENT ON COLUMN conversations_new.follow_up_note IS 'Note/reminder for the follow-up';
COMMENT ON COLUMN conversations_new.follow_up_type IS 'Type of follow-up: call, visit, message, email';
COMMENT ON COLUMN conversations_new.follow_up_priority IS 'Priority: low, medium, high, urgent';
COMMENT ON COLUMN conversations_new.follow_up_completed_at IS 'When the follow-up was completed';
COMMENT ON COLUMN conversations_new.follow_up_created_by IS 'User ID who created the follow-up';
