# == Schema Information
#
# Table name: notification_preferences
# Database name: primary
#
#  id           :integer          not null, primary key
#  enabled      :boolean          default(TRUE), not null
#  created_at   :datetime         not null
#  updated_at   :datetime         not null
#  recipient_id :integer          not null
#
# Indexes
#
#  index_notification_preferences_on_recipient_id  (recipient_id) UNIQUE
#
# Foreign Keys
#
#  recipient_id  (recipient_id => github_identities.id) ON DELETE => cascade
#
# Keeps a person's external delivery preference separate from Inbox read state.
class NotificationPreference < ApplicationRecord
  belongs_to :recipient, class_name: "GithubIdentity"

  # A person without saved preferences receives new activity when delivery is configured.
  def self.for_identity(identity)
    create_or_find_by!(recipient: identity)
  end

  # Cancels pending activity rather than replaying it when delivery is enabled again.
  def change!(enabled:)
    raise ArgumentError, "A boolean delivery preference is required" if ![ true, false ].include?(enabled)

    with_lock do
      update!(enabled:)
      NotificationDelivery.cancel!(Notification.where(recipient_id:)) if !enabled
    end
  end
end
