export const CREATE_BITBUCKET_WORKSPACE_LINKS = `
CREATE TABLE IF NOT EXISTS bitbucket_workspace_links (
    workspace_uuid VARCHAR(255) NOT NULL,
    tenant_id VARCHAR(128) NOT NULL,
    encrypted_secret TEXT NOT NULL,
    encryption_iv VARCHAR(64) NOT NULL,
    encryption_tag VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (workspace_uuid)
)
`;

export const CREATE_BITBUCKET_BRIDGE_EVENTS = `
CREATE TABLE IF NOT EXISTS bitbucket_bridge_events (
    workspace_uuid VARCHAR(255) NOT NULL,
    event_id VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL,
    received_at BIGINT NOT NULL,
    completed_at BIGINT NULL,
    last_error TEXT NULL,
    PRIMARY KEY (workspace_uuid, event_id)
)
`;

export const CREATE_BITBUCKET_BRIDGE_EVENT_STATUS_INDEX = `
CREATE INDEX IF NOT EXISTS idx_bitbucket_bridge_event_status
ON bitbucket_bridge_events (status, received_at)
`;

// This is intentionally a separate migration so tenants that already ran the
// original bridge-table migration receive the same bounded retry behavior.
export const ADD_BITBUCKET_BRIDGE_EVENT_LEASE_EXPIRY = `
ALTER TABLE bitbucket_bridge_events
ADD COLUMN lease_expires_at BIGINT NULL
`;
