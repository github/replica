# Keeps deployment-only delivery controls out of unconfigured or local installations.
module NotificationDeliveryAvailable
  extend ActiveSupport::Concern

  included do
    before_action do
      response.headers["Cache-Control"] = "private, no-store"
      head :not_found if !NotificationDelivery.configured? || Current.user.github_id.nil?
    end
  end
end
