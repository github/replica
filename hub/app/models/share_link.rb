# == Schema Information
#
# Table name: share_links
# Database name: primary
#
#  id            :integer          not null, primary key
#  expires_at    :datetime
#  label         :string(100)      not null
#  revoked_at    :datetime
#  created_at    :datetime         not null
#  updated_at    :datetime         not null
#  build_id      :integer          not null
#  created_by_id :integer          not null
#  prototype_id  :integer          not null
#  public_id     :string(36)       not null
#
# Indexes
#
#  index_share_links_on_build_id                  (build_id)
#  index_share_links_on_created_by_id             (created_by_id)
#  index_share_links_on_prototype_and_expiration  (prototype_id,expires_at,id)
#  index_share_links_on_public_id                 (public_id) UNIQUE
#
# Foreign Keys
#
#  [build_id, prototype_id]  ([build_id, prototype_id] => builds[id, prototype_id]) ON DELETE => restrict
#  created_by_id             (created_by_id => users.id) ON DELETE => restrict
#  prototype_id              (prototype_id => prototypes.id) ON DELETE => restrict
#
# Check Constraints
#
#  share_links_expiration  (expires_at IS NULL OR expires_at > created_at)
#  share_links_label       (length(trim(label)) > 0 AND length(CAST(label AS BLOB)) <= 100)
#  share_links_public_id   (length(public_id) = 36 AND substr(public_id, 9, 1) = '-' AND substr(public_id, 14, 1) = '-' AND substr(public_id, 19, 1) = '-' AND substr(public_id, 24, 1) = '-' AND length(replace(public_id, '-', '')) = 32 AND replace(public_id, '-', '') NOT GLOB '*[^0-9a-f]*')
#
# Gives anyone with its public URL access to one successful Build.
class ShareLink < ApplicationRecord
  class InvalidExpiration < StandardError; end
  class InvalidPagination < StandardError; end

  PAGE_SIZE = 25
  Page = Data.define(:records, :next_cursor, :has_more)

  DEFAULT_EXPIRATION = 7.days
  EXPIRATION_OPTIONS = {
    "one_day" => 1.day,
    "seven_days" => DEFAULT_EXPIRATION,
    "thirty_days" => 30.days,
    "never" => nil
  }.freeze
  LABEL_MAXIMUM_BYTES = 100
  PUBLIC_ID_FORMAT = /\A[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\z/

  belongs_to :prototype
  belongs_to :build
  belongs_to :created_by, class_name: "User"
  has_many :share_preview_grants, dependent: :delete_all

  scope :active, ->(time = Time.current) do
    unexpired = where(expires_at: time..).where.not(expires_at: time)
    relation = where(expires_at: nil).or(unexpired).where(revoked_at: nil)
    maximum = Rails.configuration.x.share_link_maximum_lifetime
    if maximum
      cutoff = time - maximum
      relation.where(created_at: cutoff..).where.not(created_at: cutoff)
    else
      relation
    end
  end

  before_validation :assign_public_id, on: :create
  before_validation :normalize_label
  before_create :require_public_sharing
  after_create :audit_creation
  after_destroy :audit_deletion

  validates :public_id, format: { with: PUBLIC_ID_FORMAT }, uniqueness: true
  validates :label, presence: true
  validate :label_fits
  validate :build_belongs_to_prototype
  validate :build_is_successful, on: :create
  validate :github_repository_is_required, on: :create
  validate :prototype_is_reviewable, on: :create
  validate :expiration_is_future, on: :create
  validate :expiration_within_maximum
  validate :identity_is_unchanged, on: :update

  class << self
    # Offers only lifetimes allowed by this deployment.
    def expiration_options
      maximum = Rails.configuration.x.share_link_maximum_lifetime
      return EXPIRATION_OPTIONS if maximum.nil?

      EXPIRATION_OPTIONS.select { |_value, duration| duration && duration <= maximum }
    end

    # Keeps seven days as the default unless the deployment requires one day.
    def default_expiration
      expiration_options.key(DEFAULT_EXPIRATION) || expiration_options.keys.first
    end

    # Rejects disallowed choices before either transport requests fresh proof.
    def expiration_duration(expiration)
      expiration_options.fetch(expiration.presence || default_expiration) do
        raise InvalidExpiration, "Choose an expiration allowed by this Hub's share-link policy."
      end
    end

    # Permanently shortens stored deadlines before Hub starts serving requests.
    def enforce_maximum_lifetime!(maximum: Rails.configuration.x.share_link_maximum_lifetime)
      if maximum.nil?
        raise ArgumentError, "A maximum share-link lifetime is required."
      end

      transaction do
        find_each do |link|
          deadline = link.created_at + maximum
          next if link.expires_at && link.expires_at <= deadline

          link.update!(expires_at: deadline)
        end
      end
    end

    # Lists active links across Builds with a Prototype-scoped signed cursor.
    def page_for(prototype, cursor: nil)
      raise InvalidPagination if !cursor.nil? && !cursor.is_a?(String)

      relation = where(prototype:).active.includes(:build, :created_by)
      relation = before_cursor(relation, prototype, cursor) if cursor.present?
      records = relation.order(created_at: :desc, id: :desc).limit(PAGE_SIZE + 1).to_a
      has_more = records.length > PAGE_SIZE
      records = records.first(PAGE_SIZE)
      next_cursor = encode_cursor(prototype, records.last) if has_more
      Page.new(records:, next_cursor:, has_more:)
    end

    # Creates one public share link and yields it before committing.
    def create_public!(prototype:, build:, created_by:, label:, expiration: nil,
      authorization_proof: nil, sharing_revision: SharingSetting.revision)
      duration = expiration_duration(expiration)
      transaction do
        uncached do
          SharingSetting.verify!(sharing_revision)
          if authorization_proof
            ShareLinkCreatorRevocation.verify! \
              authorization_proof,
              repository: prototype.repository,
              user: created_by
          end
          created_at = Time.current
          link = create! \
            prototype:,
            build:,
            created_by:,
            label:,
            created_at:,
            expires_at: duration ? created_at + duration : nil
          yield link if block_given?
          link
        end
      end
    end

    # Returns one public link only while its Build remains available.
    def find_available(public_id)
      return if !public_id.is_a?(String) || !PUBLIC_ID_FORMAT.match?(public_id)

      link = includes(build: { prototype: :repository }).find_by(public_id:)
      link if link&.available?
    end

    # Reads current public access under the same transaction as revocation.
    def with_available_access(id)
      transaction do
        uncached do
          link = includes(build: { prototype: :repository }).find_by(id:)
          yield(link&.available? || false)
        end
      end
    end

    # Retains tombstones so enabling never restores an old public URL.
    def revoke_all!(relation, actor: Current.user)
      transaction do
        relation.where(revoked_at: nil).find_each do |link|
          link.update!(revoked_at: Time.current)
          link.share_preview_grants.delete_all
          SecurityAuditEvent.record! \
            action: "share_link.revoke",
            outcome: "succeeded",
            repository: link.prototype.repository,
            actor:,
            context: (Current.security_audit_context || {}).merge(share_link_id: link.id)
        end
      end
    end

    # Removes links after their public URLs stop working.
    def clear_expired!
      time = Time.current
      relation = where(expires_at: ..time)
      maximum = Rails.configuration.x.share_link_maximum_lifetime
      relation = relation.or(where(created_at: ..(time - maximum))) if maximum
      relation.delete_all
    end

    private

    # Limits the query to links before the signed page position.
    def before_cursor(relation, prototype, cursor)
      raise InvalidPagination if !cursor.is_a?(String) || cursor.bytesize > 4096

      payload = Rails.application.message_verifier("share-link-cursor").verified \
        cursor,
        purpose: "prototype/#{prototype.id}"
      raise InvalidPagination if !payload.is_a?(Hash)

      created_at = Time.iso8601(payload.fetch("created_at"))
      id = payload.fetch("id")
      raise InvalidPagination if !id.is_a?(Integer) || !id.positive?

      relation.where(created_at: ...created_at).or(relation.where(created_at:, id: ...id))
    rescue KeyError, ArgumentError, TypeError
      raise InvalidPagination
    end

    # Signs the last link's time and ID without exposing another Prototype.
    def encode_cursor(prototype, link)
      payload = { "created_at" => link.created_at.iso8601(6), "id" => link.id }
      Rails.application.message_verifier("share-link-cursor").generate \
        payload,
        purpose: "prototype/#{prototype.id}"
    end
  end

  # Reports whether this link and its retained Build can still be opened.
  def available?(time: Time.current)
    expiration = effective_expires_at
    SharingSetting.enabled? && revoked_at.nil? && (expiration.nil? || expiration > time) &&
      build.state == "successful" &&
      prototype.reviewable? &&
      prototype.repository.installation_state == "active" &&
      !prototype.repository.local? &&
      GithubAppConfiguration.current&.installation_state == "active"
  end

  # Applies the creation-time cap even before a stored deadline is shortened.
  def effective_expires_at
    maximum = Rails.configuration.x.share_link_maximum_lifetime
    return expires_at if maximum.nil?

    [ expires_at, created_at + maximum ].compact.min
  end

  private

  # Checks live policy when a caller bypasses create_public!.
  def require_public_sharing
    raise SharingSetting::Disabled if !SharingSetting.uncached { SharingSetting.enabled? }
  end

  # Commits the security fact with the link, not with exportable activity events.
  def audit_creation
    SecurityAuditEvent.record! \
      action: "share_link.create", outcome: "succeeded", repository: prototype.repository,
      actor: Current.user || created_by,
      context: (Current.security_audit_context || {}).merge(share_link_id: id)
  end

  # Keeps evidence after deletion without retaining the public URL or its label.
  def audit_deletion
    SecurityAuditEvent.record! \
      action: "share_link.delete", outcome: "succeeded", repository: prototype.repository,
      context: (Current.security_audit_context || {}).merge(share_link_id: id)
  end

  # Default-branch Builds must never acquire a public share link.
  def prototype_is_reviewable
    errors.add(:prototype, "must be a reviewable branch") unless prototype&.reviewable?
  end

  # Local Builds are private to the developer session, not public shares.
  def github_repository_is_required
    errors.add(:prototype, "must use a GitHub repository") if prototype&.repository&.local?
  end

  # Gives each public URL an unguessable identifier.
  def assign_public_id
    self.public_id ||= SecureRandom.uuid
  end

  # Removes accidental surrounding spaces from the displayed label.
  def normalize_label
    self.label = label.strip if label
  end

  # Applies the same byte limit enforced by the database.
  def label_fits
    return if label.nil? || label.bytesize <= LABEL_MAXIMUM_BYTES

    errors.add(:label, "must contain at most #{LABEL_MAXIMUM_BYTES} bytes")
  end

  # Prevents a link from crossing Prototype boundaries.
  def build_belongs_to_prototype
    return if build.nil? || prototype.nil? || build.prototype_id == prototype_id

    errors.add(:build, "must belong to this prototype")
  end

  # Shares only Builds whose retained preview is ready.
  def build_is_successful
    errors.add(:build, "must be successful") if build&.state != "successful"
  end

  # Prevents a new link from expiring before it can be used.
  def expiration_is_future
    errors.add(:expires_at, "must be in the future") if expires_at && expires_at <= Time.current
  end

  # Prevents direct model callers from creating or extending an uncapped link.
  def expiration_within_maximum
    maximum = Rails.configuration.x.share_link_maximum_lifetime
    return if maximum.nil?
    return if !new_record? && !will_save_change_to_expires_at?
    return if expires_at && expires_at <= (created_at || Time.current) + maximum

    errors.add(:expires_at, "must be within #{maximum.in_days.to_i} days of creation")
  end

  # Keeps the public URL, target, creator and creation time unchanged.
  def identity_is_unchanged
    %i[public_id prototype_id build_id created_by_id created_at].each do |attribute|
      errors.add(attribute, "cannot change") if public_send("will_save_change_to_#{attribute}?")
    end
    if revoked_at_in_database && will_save_change_to_revoked_at?
      errors.add(:revoked_at, "cannot change after revocation")
    end
  end
end
