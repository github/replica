# Starts the single local developer session without contacting GitHub.
class LocalAuthenticationsController < ApplicationController
  allow_unauthenticated_access

  # Signs in only after repositories have been configured on disk.
  # @route POST /auth/local (local_authentication)
  def create
    return head :not_found if !LocalDevelopment.enabled?
    return head :not_found if request.base_url != Rails.configuration.x.hub_origin.delete_suffix("/")

    Repository::LocalDiscovery.register_repositories!
    if Repository.active.where(github_id: nil).none?
      return redirect_to \
        root_path,
        alert: I18n.t("local_development.empty_repositories", directory: LocalDevelopment.repositories_root),
        status: :see_other
    end

    return_to = authentication_return_to
    user = User.local_developer!
    start_new_session_for(user)
    show_welcome = user.consume_welcome_sign_in!
    redirect_to return_to || (show_welcome ? welcome_path : repositories_path), status: :see_other
  rescue LocalDevelopment::Error => error
    redirect_to root_path, alert: error.message, status: :see_other
  end
end
