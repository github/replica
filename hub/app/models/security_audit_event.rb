# == Schema Information
#
# Table name: security_audit_events
# Database name: primary
#
#  id                :integer          not null, primary key
#  action            :string           not null
#  context           :json             not null
#  ip_address        :string
#  occurred_at       :datetime         not null
#  outcome           :string           not null
#  repository_scoped :boolean          default(FALSE), not null
#  repository_id     :integer
#  user_id           :integer
#
# Indexes
#
#  idx_on_repository_id_occurred_at_id_f6955b3393  (repository_id,occurred_at,id)
#  index_security_audit_events_on_occurred_at      (occurred_at)
#  index_security_audit_events_on_repository_id    (repository_id)
#  index_security_audit_events_on_user_id          (user_id)
#
# Foreign Keys
#
#  repository_id  (repository_id => repositories.id) ON DELETE => nullify
#  user_id        (user_id => users.id) ON DELETE => nullify
#
# Check Constraints
#
#  security_audit_events_context           (json_valid(context) AND json_type(context) = 'object')
#  security_audit_events_outcome           (outcome IN ('succeeded', 'denied', 'failed'))
#  security_audit_events_repository_scope  (repository_scoped = 1 OR repository_id IS NULL)
#
# Retains security decisions separately from exportable repository analytics.
class SecurityAuditEvent < ApplicationRecord
  RETENTION = 90.days
  OUTCOMES = %w[succeeded denied failed].freeze
  CONTEXT_IDS = %w[
    session_id canvas_grant_id canvas_pairing_id share_link_id
    analytics_destination_id github_app_configuration_id target_user_id
  ].freeze
  SOURCES = %w[browser canvas command bootstrap].freeze
  DEVICE_FAMILIES = %w[desktop mobile unknown].freeze
  BROWSER_FAMILIES = %w[edge firefox chrome safari unknown].freeze

  belongs_to :repository, optional: true
  belongs_to :user, optional: true

  validates :action, format: { with: /\A[a-z][a-z0-9_.]{0,79}\z/ }
  validates :outcome, inclusion: { in: OUTCOMES }
  validates :occurred_at, presence: true
  validate :safe_context
  validate :valid_ip_address

  scope :retained, -> { where(occurred_at: RETENTION.ago..) }
  scope :global, -> { where(repository_scoped: false) }

  # Accepts only server-owned identifiers, never request parameters or secret values.
  def self.record!(action:, outcome:, repository: nil, actor: Current.user,
    context: Current.security_audit_context || {}, occurred_at: Time.current)
    attributes = context.stringify_keys
    ip_address = attributes.delete("ip_address")
    attributes["source"] ||= "command"
    attributes["session_id"] ||= Current.session.id if Current.session
    attributes["canvas_grant_id"] ||= Current.canvas_grant.id if Current.canvas_grant
    create! \
      action:, outcome:, repository:, repository_scoped: repository.present?,
      user: actor, occurred_at:, ip_address:, context: attributes
  end

  # Stores fixed device categories, not a raw user-agent header that could contain secrets.
  def self.device_context(user_agent)
    value = user_agent.to_s.first(512)
    browser = if value.include?("Edg/")
      "edge"
    elsif value.include?("Firefox/")
      "firefox"
    elsif value.include?("Chrome/")
      "chrome"
    elsif value.include?("Safari/")
      "safari"
    else
      "unknown"
    end
    device = if value.match?(/Mobile|Android|iPhone|iPad/)
      "mobile"
    elsif value.match?(/Windows|Macintosh|X11|Linux/)
      "desktop"
    else
      "unknown"
    end
    { device_family: device, browser_family: browser }
  end

  # Removes expired records without involving analytics or external destinations.
  def self.clear_expired!
    where(occurred_at: ...RETENTION.ago).in_batches.delete_all
  end

  # Recorded decisions cannot be rewritten through normal model operations.
  def readonly?
    persisted?
  end

  private

  # Rejects arbitrary device strings, request bodies, headers, and credential context.
  def safe_context
    categories = %w[source device_family browser_family]
    valid = context.is_a?(Hash) && (context.keys - CONTEXT_IDS - categories).empty? &&
      SOURCES.include?(context["source"]) &&
      (context["device_family"].nil? || DEVICE_FAMILIES.include?(context["device_family"])) &&
      (context["browser_family"].nil? || BROWSER_FAMILIES.include?(context["browser_family"])) &&
      context.except(*categories).values.all? { _1.is_a?(Integer) && _1.positive? }
    errors.add(:context, "must contain only a source and server identifiers") if !valid
  end

  # Only the socket or trusted-proxy address belongs in the audit log.
  def valid_ip_address
    return if ip_address.nil?

    IPAddr.new(ip_address)
  rescue IPAddr::InvalidAddressError
    errors.add(:ip_address, "must be an IP address")
  end
end
