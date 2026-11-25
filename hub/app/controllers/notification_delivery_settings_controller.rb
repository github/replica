# Restricts the deployment kill switch to freshly authorized Hub administrators.
class NotificationDeliverySettingsController < ApplicationController
  include NotificationDeliveryAvailable
  include FreshAuthorizationRequired

  rescue_from NotificationSetting::ChangeDenied, with: -> { head :forbidden }
  rescue_from FreshAuthorization::Invalid, with: -> { head :forbidden }
  rescue_from ActiveRecord::RecordInvalid, with: :save_failed

  # @route PATCH /notification_delivery_setting (notification_delivery_setting)
  # @route PUT /notification_delivery_setting (notification_delivery_setting)
  def update
    return head :forbidden if !User.where(id: Current.user.id, hub_admin: true).where.not(github_id: nil).exists?
    raise ActionController::BadRequest if params[:confirmed] != "1" || !params[:operation].in?(%w[enable disable])
    return if !require_fresh_authorization(purpose: :notification_delivery, return_to: notification_settings_path)

    NotificationSetting.change! \
      actor: Current.user, browser_session: Current.session, enabled: params[:operation] == "enable"
    redirect_to notification_settings_path, status: :see_other
  end

  private

  def security_audit_action
    "notification_delivery.change"
  end

  def save_failed(error)
    raise error if error.record.is_a?(SecurityAuditEvent)

    record_security_audit(outcome: "failed")
    redirect_to notification_settings_path, alert: t("notification_settings.save_failed"), status: :see_other
  end
end
