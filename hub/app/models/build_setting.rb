# == Schema Information
#
# Table name: build_settings
# Database name: primary
#
#  id                  :integer          not null, primary key
#  maximum_package_mib :integer          default(150), not null
#  created_at          :datetime         not null
#  updated_at          :datetime         not null
#
# Check Constraints
#
#  build_settings_positive_limit  (maximum_package_mib > 0 AND typeof(maximum_package_mib) = 'integer')
#  build_settings_singleton       (id = 1)
#
# Owns the total unpacked package limit for future Build imports.
class BuildSetting < ApplicationRecord
  class ChangeDenied < StandardError
    attr_reader :reason

    # Exposes a fixed policy reason instead of submitted configuration.
    def initialize(reason)
      @reason = reason
      super(reason.to_s)
    end
  end

  validates :maximum_package_mib, numericality: {
    only_integer: true, greater_than: 0, less_than_or_equal_to: 9_223_372_036_854_775_807
  }

  # Uses the default on fresh schemas without writing during a read.
  def self.current
    find_by(id: 1) || new(id: 1)
  end

  # Rechecks the administrator and browser proof while saving and auditing atomically.
  def self.change!(actor:, browser_session:, maximum_package_mib:)
    transaction do
      live_actor = User.where.not(github_id: nil).find_by(id: actor.id, hub_admin: true)
      raise ChangeDenied, :not_authorized if live_actor.nil?

      live_session = Session.find_by(id: browser_session&.id, user_id: live_actor.id)
      raise ChangeDenied, :not_authorized if live_session.nil?
      raise FreshAuthorization::Invalid if !FreshAuthorization.fresh?(live_session)

      setting = current
      setting.update!(maximum_package_mib:)
      SecurityAuditEvent.record! \
        action: "build_settings.update",
        outcome: "succeeded",
        actor: live_actor,
        context: (Current.security_audit_context || {}).merge(session_id: live_session.id)
      setting
    end
  end

  # Converts the one editable limit to unpacked bytes.
  def maximum_bytes
    maximum_package_mib.megabytes
  end

  # Allows bounded ZIP headers, filenames and deflate overhead, not another editable limit.
  def maximum_download_bytes
    maximum_bytes + (maximum_bytes + 999) / 1_000 +
      Build::PackageExtraction::MAXIMUM_ENTRIES * (2 * ArtifactStore::MAXIMUM_NAME_BYTES + 128) + 64.kilobytes
  end

  # Tells users how to recover without changing or deleting successful Builds.
  def self.limit_message(maximum_bytes)
    whole, remainder = maximum_bytes.divmod(1.megabyte)
    label = remainder.zero? ? whole : maximum_bytes.fdiv(1.megabyte)
    "Build package exceeds Hub's configured #{label} MiB unpacked limit. " \
      "Reduce the build output or ask a Hub administrator to change Hub settings > Build packages."
  end
end
