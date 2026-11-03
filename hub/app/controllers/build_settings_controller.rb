# Changes the package limit without changing any already retained Build.
class BuildSettingsController < SuperglueController
  include FreshAuthorizationRequired

  before_action :authorize_admin
  before_action :confirm_change, only: :update
  before_action :authorize_change, only: :update

  rescue_from BuildSetting::ChangeDenied, with: :change_denied
  rescue_from FreshAuthorization::Invalid, with: :authorization_expired
  rescue_from ActiveRecord::RecordInvalid, with: :invalid_setting

  # @route GET /build_settings (build_settings)
  def show
    @setting = BuildSetting.current
    record_security_audit(outcome: "succeeded")
  end

  # @route PATCH /build_settings (build_settings)
  # @route PUT /build_settings (build_settings)
  def update
    BuildSetting.change! \
      actor: Current.user,
      browser_session: Current.session,
      maximum_package_mib: params[:maximum_package_mib]
    @security_audit_recorded = true
    redirect_to build_settings_path, status: :see_other
  end

  private

  def authorize_admin
    return if User.where(id: Current.user.id, hub_admin: true).where.not(github_id: nil).exists?

    record_security_audit(outcome: "denied")
    @access_denied = true
    flash.now[:alert] = t("build_settings.errors.not_authorized")
    render :show, status: :forbidden
  end

  def confirm_change
    return if params[:confirmed] == "1"

    change_denied(BuildSetting::ChangeDenied.new(:confirmation_required))
  end

  def authorize_change
    require_fresh_authorization purpose: :build_settings, return_to: build_settings_path
  end

  def security_audit_action
    action_name == "update" ? "build_settings.update" : "build_settings.view"
  end

  def change_denied(error)
    record_security_audit(outcome: "denied", actor: User.find_by(id: Current.user.id))
    if error.reason == :not_authorized
      @access_denied = true
      flash.now[:alert] = t("build_settings.errors.not_authorized")
      render :show, status: :forbidden
    else
      redirect_to build_settings_path, alert: t("build_settings.errors.#{error.reason}"), status: :see_other
    end
  end

  def authorization_expired
    record_security_audit(outcome: "denied")
    redirect_to build_settings_path, alert: t("fresh_authorization.required"), status: :see_other
  end

  def invalid_setting(error)
    raise error if error.record.is_a?(SecurityAuditEvent)

    record_security_audit(outcome: "failed")
    redirect_to build_settings_path, alert: t("build_settings.errors.invalid_limit"), status: :see_other
  end
end
