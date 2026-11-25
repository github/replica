# Changes one personal mute only after verifying current repository access.
class NotificationMutesController < ApplicationController
  include NotificationDeliveryAvailable

  rescue_from GithubClient::Error, with: -> { head :service_unavailable }
  rescue_from ActiveRecord::RecordInvalid, with: :save_failed

  # @route PATCH /repositories/:repository_github_id/prototypes/:prototype_id/notification_mute (repository_prototype_notification_mute)
  # @route PUT /repositories/:repository_github_id/prototypes/:prototype_id/notification_mute (repository_prototype_notification_mute)
  def update
    raise ActionController::BadRequest if !params[:muted].in?(%w[0 1])

    @repository = Repository.find_by_route_id!(params[:repository_github_id])
    return head :not_found if !@repository.authorization.authorized?(Current.user, fresh: true)

    @prototype = @repository.reviewable_prototypes.find(params[:prototype_id])
    recipient = GithubIdentity.record! \
      github_id: Current.user.github_id, login: Current.user.login, avatar_url: Current.user.avatar_url
    NotificationMute.set!(recipient:, prototype: @prototype, muted: params[:muted] == "1")
    redirect_to notification_settings_path, status: :see_other
  end

  private

  def save_failed
    redirect_to notification_settings_path, alert: t("notification_settings.save_failed"), status: :see_other
  end
end
