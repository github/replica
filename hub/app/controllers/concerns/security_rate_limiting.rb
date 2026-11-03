# Shares each feature's Rails counter across controllers and credentials.
module SecurityRateLimiting
  extend ActiveSupport::Concern
  include TrustedRequestSource

  BUDGETS = {
    github_app_setup: [ 5, 1.minute ],
    oauth_initiation: [ 60, 5.minutes ],
    oauth_callback: [ 60, 5.minutes ],
    comments: [ 60, 1.minute ],
    analytics_destinations: [ 5, 1.minute ],
    workflow_installation: [ 5, 10.minutes ],
    hub_admin: [ 10, 1.minute ],
    webhooks: [ 600, 1.minute ],
    learning_recalls: [ 30, 1.minute ]
  }.freeze

  # Server-owned action names keep independently developed admin pages compatible.
  # Their ordinary permission and fresh-authorization checks still run afterward.
  ADMIN_MUTATIONS = {
    "hub_admins" => %w[create update],
    "sharing_settings" => %w[update],
    "session_revocations" => %w[create],
    "github_apps" => %w[destroy],
    "github_app_credentials" => %w[update],
    "github_app_webhook_rotations" => %w[create destroy],
    "copilot_connections" => %w[create destroy]
  }.freeze

  private

  # Called after authentication; ineligible actors still reach the normal denial.
  def limit_hub_admin_mutation
    return if !ADMIN_MUTATIONS.fetch(controller_path, []).include?(action_name)
    return if Current.user.nil? ||
      !User.where(id: Current.user.id, hub_admin: true).where.not(github_id: nil).exists?

    enforce_security_rate_limit(:hub_admin)
  end

  # Rails owns atomic counting and expiry; a rejection never continues the action.
  def enforce_security_rate_limit(feature, identity: Current.user&.id)
    maximum, window = BUDGETS.fetch(feature)
    raise ArgumentError, "A rate-limit identity is required" if identity.blank?

    rate_limiting \
      to: maximum,
      within: window,
      by: -> { identity },
      with: -> { render_security_rate_limit(window) },
      store: Rails.cache,
      name: feature,
      scope: "security"
    !performed?
  end

  # A full window is conservative retry guidance even near a counter's expiry.
  def render_security_rate_limit(window)
    seconds = window.to_i
    response.headers["Retry-After"] = seconds.to_s
    response.headers["Cache-Control"] = "private, no-store"
    message = I18n.t("security_rate_limits.exceeded", seconds:)
    if request.format.json? || self.class.module_parent == CanvasApi ||
        is_a?(ActionController::API)
      render json: { code: "rate_limited", errors: [ message ], retryAfter: seconds },
        status: :too_many_requests
    else
      render plain: message, status: :too_many_requests
    end
  end
end
