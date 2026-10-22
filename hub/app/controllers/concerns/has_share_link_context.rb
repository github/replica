# Shares link permissions and creation without combining browser and canvas authentication.
module HasShareLinkContext
  extend ActiveSupport::Concern
  include FreshAuthorizationRequired

  included do
    prepend_before_action :capture_sharing_revision
  end

  private

  def capture_sharing_revision
    @sharing_revision = SharingSetting.revision
  end

  def load_share_link_prototype
    return head :not_found if @repository.local?

    @prototype = @repository.reviewable_prototypes.find(params[:prototype_id])
    return if @prototype.share_links_manageable_by? \
      Current.user,
      repository_permission: @repository_permission

    head :not_found
  end

  def creator_access_changed
    record_security_audit(outcome: "denied")
    if Current.canvas_grant
      render json: {
        code: "creator_access_changed", errors: [ I18n.t("share_links.access_changed") ]
      }, status: :forbidden
    else
      redirect_to \
        repository_prototype_share_links_path(@repository.route_id, @prototype),
        alert: I18n.t("share_links.access_changed"),
        status: :see_other
    end
  end

  def public_sharing_disabled(error = nil)
    record_security_audit(outcome: "denied") if security_audit_action
    changed = error.is_a?(SharingSetting::Changed)
    code = changed ? "public_sharing_changed" : "public_sharing_disabled"
    message = I18n.t(changed ? "share_links.policy_changed" : "share_links.disabled")
    if Current.canvas_grant
      render json: { code:, errors: [ message ] }, status: :forbidden
    else
      redirect_to \
        repository_prototype_share_links_path(@repository.route_id, @prototype),
        alert: message,
        status: :see_other
    end
  end

  def create_share_link
    raise SharingSetting::Disabled if !SharingSetting.enabled?

    attributes = share_link_params
    ShareLink.expiration_duration(attributes[:expiration])
    build = @prototype.builds.where(state: "successful").find_by! \
      number: positive_build_number(attributes[:build_number])
    if attributes[:expiration] == "never"
      return_to = Current.canvas_grant ? root_path : management_path
      return if !require_fresh_authorization(
        purpose: "never_expiring_share",
        return_to:
      )
    end

    @prototype.share_links.create_public! \
      prototype: @prototype,
      build:,
      created_by: Current.user,
      label: attributes[:label],
      expiration: attributes[:expiration],
      authorization_proof: @repository.authorization.share_link_creation_proof,
      sharing_revision: @sharing_revision
  end

  def share_link_params
    params.require(:share_link).permit(:build_number, :label, :expiration)
  end

  def positive_build_number(value)
    string = value.to_s
    raise ActiveRecord::RecordNotFound if !string.match?(/\A[1-9]\d*\z/)

    string.to_i
  end

  def share_link_errors(error)
    error.respond_to?(:record) ? error.record.errors.full_messages : [ error.message ]
  end
end
