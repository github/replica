# Changes only the signed-in person's external delivery preferences.
class NotificationSettingsController < SuperglueController
  include NotificationDeliveryAvailable
  include HasRepositoryWorkspace

  rescue_from GithubClient::Error, with: -> { head :service_unavailable }
  rescue_from ActiveRecord::RecordInvalid, with: :save_failed

  # @route GET /notification_settings (notification_settings)
  def show
    @identity = current_identity
    @preference = NotificationPreference.for_identity(@identity)
    mutes = NotificationMute.where(recipient: @identity).includes(prototype: :repository)
    @mutes = mutes.group_by { _1.prototype.repository }.flat_map do |repository, entries|
      next [] if !repository.authorization.authorized?(Current.user, fresh: true)

      allowed = repository.reviewable_prototypes.where(id: entries.map(&:prototype_id)).ids
      entries.select { allowed.include?(_1.prototype_id) }
    end
    @deployment_enabled = NotificationSetting.enabled?
    @administrator = User.where(id: Current.user.id, hub_admin: true).where.not(github_id: nil).exists?
    @failed_count = NotificationDelivery.where(state: %w[failed retryable]).count if @administrator
  end

  # @route PATCH /notification_settings (notification_settings)
  # @route PUT /notification_settings (notification_settings)
  def update
    raise ActionController::BadRequest if !params[:enabled].in?(%w[0 1])

    NotificationPreference.for_identity(current_identity).change!(enabled: params[:enabled] == "1")
    redirect_to notification_settings_path, status: :see_other
  end

  private

  # Binds preferences to the immutable identity verified at sign-in.
  def current_identity
    GithubIdentity.record! \
      github_id: Current.user.github_id, login: Current.user.login, avatar_url: Current.user.avatar_url
  end

  def save_failed
    redirect_to notification_settings_path, alert: t("notification_settings.save_failed"), status: :see_other
  end
end
