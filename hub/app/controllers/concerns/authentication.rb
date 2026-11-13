module Authentication
  extend ActiveSupport::Concern

  included do
    before_action :require_authentication
    helper_method :authenticated?
  end

  class_methods do
    # Allows named public actions to render for signed-out visitors.
    def allow_unauthenticated_access(**options)
      skip_before_action :require_authentication, **options
    end
  end

  private

  # Restores the database session referenced by the encrypted cookie.
  def resume_session
    browser_session = Session.includes(:user).find_by(id: session[:authenticated_session_id])
    allowed = browser_session && browser_session.user.local? == LocalDevelopment.enabled?
    Current.session = allowed ? browser_session : nil
  end

  # Redirects anonymous browser requests before protected data is loaded.
  def require_authentication
    resume_session
    if Current.user.nil?
      session[:authentication_return_to] = request.fullpath if request.get?
      redirect_to root_path
    end
    response.headers["Cache-Control"] = "private, no-store" if Current.user
  end

  # Reports whether the current browser session identifies a user.
  def authenticated?
    Current.user.present?
  end

  # Consumes the destination before sign-in rotates the browser session.
  def authentication_return_to
    value = session.delete(:authentication_return_to)
    return if !value.is_a?(String) || !value.match?(%r{\A/(?!/)[^\x00-\x20\\]*\z})

    url_from(value)
  end

  # Rotates the encrypted cookie and records a revocable browser session.
  def start_new_session_for(user, fresh_authorized_at: nil,
    generation: SessionRevocation.current.generation, configuration_id: nil, credential_revision: nil)
    browser_session = SessionRevocation.with_generation!(generation) do
      if LocalDevelopment.enabled? && configuration_id.nil? && credential_revision.nil?
        create_browser_session_for(user, fresh_authorized_at:)
      else
        GithubAppConfiguration.with_credentials!(configuration_id:, credential_revision:) do
          create_browser_session_for(user, fresh_authorized_at:)
        end
      end
    end

    session[:authenticated_session_id] = browser_session.id
    Current.session = browser_session
  end

  # Issuance happens inside both independent primary-database barriers.
  def create_browser_session_for(user, fresh_authorized_at:)
    reset_session
    user.sessions.create! \
      ip_address: request.remote_ip,
      user_agent: request.user_agent,
      fresh_authorized_at:
  end

  # Revokes the current database session and clears its cookie.
  def terminate_session
    resume_session
    Current.session&.destroy!
    reset_session
  end
end
