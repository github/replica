# == Schema Information
#
# Table name: notification_mutes
# Database name: primary
#
#  id           :integer          not null, primary key
#  created_at   :datetime         not null
#  updated_at   :datetime         not null
#  prototype_id :integer          not null
#  recipient_id :integer          not null
#
# Indexes
#
#  index_notification_mutes_on_prototype_id                   (prototype_id)
#  index_notification_mutes_on_recipient_id                   (recipient_id)
#  index_notification_mutes_on_recipient_id_and_prototype_id  (recipient_id,prototype_id) UNIQUE
#
# Foreign Keys
#
#  prototype_id  (prototype_id => prototypes.id) ON DELETE => cascade
#  recipient_id  (recipient_id => github_identities.id) ON DELETE => cascade
#
# Mutes external messages about one Prototype for one immutable recipient.
class NotificationMute < ApplicationRecord
  belongs_to :recipient, class_name: "GithubIdentity"
  belongs_to :prototype

  # Changing a personal mute never changes Inbox activity or anyone else's delivery.
  def self.set!(recipient:, prototype:, muted:)
    raise ArgumentError, "A boolean mute preference is required" if ![ true, false ].include?(muted)

    transaction do
      if muted
        create_or_find_by!(recipient:, prototype:)
        notifications = Notification.where(recipient:)
          .joins(:review_comment).where(review_comments: { prototype_id: prototype.id })
        NotificationDelivery.cancel!(notifications)
      else
        where(recipient:, prototype:).delete_all
      end
    end
  end
end
