# == Schema Information
#
# Table name: notification_settings
# Database name: primary
#
#  id         :integer          not null, primary key
#  enabled    :boolean          default(TRUE), not null
#  created_at :datetime         not null
#  updated_at :datetime         not null
#
# Check Constraints
#
#  notification_settings_singleton  (id = 1)
#
# Owns the deployment kill switch without granting access to review content.
class NotificationSetting < ApplicationRecord
  class ChangeDenied < StandardError; end

  # An installed adapter starts with new activity enabled, never a history scan.
  def self.enabled?
    NotificationDelivery.configured? && !where(id: 1, enabled: false).exists?
  end

  # Requires a current administrator and fresh browser credential for deployment changes.
  def self.change!(actor:, browser_session:, enabled:)
    raise ArgumentError, "A boolean delivery setting is required" if ![ true, false ].include?(enabled)

    transaction do
      live_actor = User.where.not(github_id: nil).find_by(id: actor.id, hub_admin: true)
      raise ChangeDenied if live_actor.nil?

      session = Session.find_by(id: browser_session&.id, user_id: live_actor.id)
      raise ChangeDenied if session.nil?
      raise FreshAuthorization::Invalid if !FreshAuthorization.fresh?(session)

      setting = find_or_create_by!(id: 1)
      setting.update!(enabled:)
      NotificationDelivery.cancel!(Notification.all) if !enabled
      SecurityAuditEvent.record! \
        action: "notification_delivery.#{enabled ? 'enable' : 'disable'}",
        outcome: "succeeded", actor: live_actor
    end
  end
end
