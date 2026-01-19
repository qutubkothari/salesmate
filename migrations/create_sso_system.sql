-- ========================================
-- SSO (Single Sign-On) SYSTEM
-- OAuth2 Integration for Google, Azure AD, Okta
-- Phase 1: Security Enhancement
-- ========================================

-- OAuth Providers Configuration
CREATE TABLE IF NOT EXISTS oauth_providers (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    
    -- Provider Info
    provider_name VARCHAR(50) NOT NULL, -- 'google', 'azure_ad', 'okta', 'github'
    provider_display_name VARCHAR(100),
    provider_type VARCHAR(50) DEFAULT 'oauth2', -- 'oauth2', 'saml', 'oidc'
    
    -- OAuth2 Configuration
    client_id TEXT NOT NULL,
    client_secret TEXT NOT NULL, -- Encrypted
    authorization_endpoint TEXT,
    token_endpoint TEXT,
    userinfo_endpoint TEXT,
    jwks_uri TEXT,
    issuer TEXT,
    
    -- Scopes
    default_scopes TEXT, -- JSON array: ["openid", "profile", "email"]
    
    -- Redirect URLs
    redirect_uri TEXT NOT NULL,
    post_logout_redirect_uri TEXT,
    
    -- Domain Restrictions
    allowed_domains TEXT, -- JSON array: ["@company.com", "@subsidiary.com"]
    
    -- Status
    is_enabled BOOLEAN DEFAULT 1,
    is_default BOOLEAN DEFAULT 0,
    
    -- Auto-provisioning
    auto_create_users BOOLEAN DEFAULT 1,
    default_role VARCHAR(50) DEFAULT 'salesman',
    
    -- Metadata
    logo_url TEXT,
    button_text VARCHAR(100) DEFAULT 'Sign in with',
    button_color VARCHAR(20),
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE INDEX idx_oauth_providers_tenant ON oauth_providers(tenant_id);
CREATE INDEX idx_oauth_providers_name ON oauth_providers(provider_name);

-- OAuth Sessions (for PKCE flow)
CREATE TABLE IF NOT EXISTS oauth_sessions (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    provider_id TEXT NOT NULL,
    
    -- PKCE Parameters
    state TEXT NOT NULL UNIQUE, -- Random state for CSRF protection
    code_verifier TEXT NOT NULL, -- PKCE code verifier
    code_challenge TEXT NOT NULL,
    code_challenge_method VARCHAR(10) DEFAULT 'S256',
    
    -- Session Info
    redirect_after_login TEXT,
    ip_address VARCHAR(45),
    user_agent TEXT,
    
    -- Status
    session_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'authorized', 'completed', 'failed', 'expired'
    authorization_code TEXT,
    error_message TEXT,
    
    -- Timestamps
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    authorized_at DATETIME,
    expires_at DATETIME, -- 10 minutes from creation
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (provider_id) REFERENCES oauth_providers(id) ON DELETE CASCADE
);

CREATE INDEX idx_oauth_sessions_state ON oauth_sessions(state);
CREATE INDEX idx_oauth_sessions_provider ON oauth_sessions(provider_id);
CREATE INDEX idx_oauth_sessions_status ON oauth_sessions(session_status);

-- User External Identities (linked SSO accounts)
CREATE TABLE IF NOT EXISTS user_external_identities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    
    -- External Identity Info
    provider_user_id TEXT NOT NULL, -- The ID from the OAuth provider (sub claim)
    provider_username TEXT,
    provider_email TEXT,
    provider_name TEXT,
    provider_picture TEXT,
    
    -- Token Storage (encrypted)
    access_token TEXT, -- OAuth access token
    refresh_token TEXT, -- OAuth refresh token
    id_token TEXT, -- OpenID Connect ID token
    token_type VARCHAR(50) DEFAULT 'Bearer',
    
    -- Token Expiry
    access_token_expires_at DATETIME,
    refresh_token_expires_at DATETIME,
    
    -- User Claims (from OIDC)
    user_claims TEXT, -- JSON: Full claims from userinfo endpoint
    
    -- Link Status
    link_status VARCHAR(20) DEFAULT 'active', -- 'active', 'suspended', 'revoked'
    link_method VARCHAR(50) DEFAULT 'sso_login', -- 'sso_login', 'manual_link', 'auto_provision'
    
    -- First and Last Login via SSO
    first_login_at DATETIME,
    last_login_at DATETIME,
    login_count INTEGER DEFAULT 0,
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (provider_id) REFERENCES oauth_providers(id) ON DELETE CASCADE,
    
    UNIQUE(provider_id, provider_user_id)
);

CREATE INDEX idx_user_external_identities_user ON user_external_identities(user_id);
CREATE INDEX idx_user_external_identities_provider ON user_external_identities(provider_id);
CREATE INDEX idx_user_external_identities_provider_user ON user_external_identities(provider_user_id);

-- SSO Audit Logs
CREATE TABLE IF NOT EXISTS sso_audit_logs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    
    -- Event Info
    event_type VARCHAR(50) NOT NULL, -- 'login_success', 'login_failed', 'token_refresh', 'logout', 'link_created', 'link_revoked'
    event_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    -- User Info
    user_id TEXT,
    provider_id TEXT,
    provider_user_id TEXT,
    
    -- Request Details
    ip_address VARCHAR(45),
    user_agent TEXT,
    session_id TEXT,
    
    -- Event Details
    event_data TEXT, -- JSON: Additional event-specific data
    error_message TEXT,
    
    -- Success/Failure
    is_success BOOLEAN DEFAULT 1,
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (provider_id) REFERENCES oauth_providers(id) ON DELETE SET NULL
);

CREATE INDEX idx_sso_audit_logs_tenant ON sso_audit_logs(tenant_id);
CREATE INDEX idx_sso_audit_logs_user ON sso_audit_logs(user_id);
CREATE INDEX idx_sso_audit_logs_event ON sso_audit_logs(event_type);
CREATE INDEX idx_sso_audit_logs_timestamp ON sso_audit_logs(event_timestamp);

-- Tenant SSO Settings
CREATE TABLE IF NOT EXISTS tenant_sso_settings (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL UNIQUE,
    
    -- Global SSO Settings
    sso_enabled BOOLEAN DEFAULT 0,
    sso_mandatory BOOLEAN DEFAULT 0, -- If true, regular login is disabled
    
    -- Default Provider
    default_provider_id TEXT,
    
    -- Auto-provisioning Rules
    auto_provision_users BOOLEAN DEFAULT 1,
    auto_provision_role VARCHAR(50) DEFAULT 'salesman',
    require_email_verification BOOLEAN DEFAULT 1,
    
    -- Domain Whitelist
    allowed_email_domains TEXT, -- JSON array
    
    -- Session Settings
    sso_session_timeout_minutes INTEGER DEFAULT 480, -- 8 hours
    require_mfa BOOLEAN DEFAULT 0,
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    FOREIGN KEY (default_provider_id) REFERENCES oauth_providers(id) ON DELETE SET NULL
);

CREATE INDEX idx_tenant_sso_settings_tenant ON tenant_sso_settings(tenant_id);
