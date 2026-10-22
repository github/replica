# Returns authoritative Build metadata and updates registration for the paired repository.
class CanvasApi::PrototypesController < CanvasApi::BaseController
  before_action :require_registration_writer, only: :update
  rescue_from ActiveRecord::RecordInvalid, with: :invalid_metadata
  rescue_from LocalDevelopment::Error, with: :repository_unavailable

  # @route GET /api/canvas/prototype (canvas_api_prototype)
  def show
    prototype = current_prototype
    return branch_not_found if prototype.nil?

    render json: prototype_json(prototype)
  end

  # @route PATCH /api/canvas/prototype (canvas_api_prototype)
  # @route PUT /api/canvas/prototype (canvas_api_prototype)
  def update
    prototype = current_prototype
    return branch_not_found if prototype.nil?
    if !prototype.registered?
      reason = @repository.prototype_candidates.registration_ineligibility_reason \
        prototype, Current.user, permission: @repository_permission, fresh: true
      if reason
        return render json: { error: "This branch is not eligible for registration in Hub.", registrationReason: reason },
          status: :not_found
      end
    end

    if params[:automatic] == true
      unless prototype.register_automatically!(commit_sha: params[:commit_sha], author: Current.user)
        return render json: { error: "Hub has not imported this checkout's successful Build yet.",
          registrationReason: "successful_build_required" },
          status: :conflict
      end
    else
      metadata = params.permit(:name, :description, :start_page)
      prototype.register!(**metadata.to_h.symbolize_keys, author: Current.user)
    end
    render json: prototype_json(prototype)
  end

  private

  # Distinguishes registration permission from a loss of repository read access.
  def require_registration_writer
    return if @repository.authorization.sufficient?(@repository_permission, minimum: :write)

    render json: { error: "Registration in Hub requires repository write access.",
      registrationReason: "write_access_required" }, status: :forbidden
  end

  # Excluded branches are not evidence that a remote branch was deleted.
  def branch_not_found
    branch = params[:branch]
    excluded = !@repository.prototype_branch?(branch) ||
      @repository.prototypes.active.where(branch_name: branch, replica: true).exists?
    payload = { error: "Hub has not discovered this branch." }
    payload[:registrationReason] = "branch_not_reviewable" if excluded
    render json: payload, status: :not_found
  end

  def current_prototype
    branch = params.require(:branch)
    raise ActionController::BadRequest if !branch.is_a?(String) || branch.blank? ||
      branch.length > 255

    @repository.reviewable_prototypes.active.find_by(branch_name: branch)
  end

  def prototype_json(prototype)
    reason = registration_reason(prototype)
    successful = prototype.builds.where(state: "successful")
    published = successful.chronological.first
    current = prototype.current_build
    can_manage_share_links = prototype.share_links_manageable_by? \
      Current.user,
      repository_permission: @repository_permission
    {
      id: prototype.id,
      repositoryId: @repository.route_id,
      repository: @repository.name_with_owner,
      branch: prototype.branch_name,
      name: prototype.name,
      description: prototype.description,
      startPage: prototype.start_page,
      startPageSet: prototype.start_page_set_at.present?,
      startPageImportError: prototype.start_page_import_error,
      viewerLogin: Current.user.login,
      registered: prototype.registered?,
      canEdit: @repository.authorization.sufficient?(@repository_permission, minimum: :write),
      canManageShareLinks: can_manage_share_links,
      publicSharingEnabled: SharingSetting.enabled?,
      shareLinkExpirationOptions: ShareLink.expiration_options.keys,
      canRegister: reason.nil?,
      registrationReason: reason,
      published: prototype.registered? && published.present?,
      buildState: current&.state,
      currentBuild: current && { commitSha: current.commit_sha, state: current.state },
      versionCount: successful.count,
      build: published && {
        number: published.number,
        commitSha: published.commit_sha,
        url: "#{Rails.configuration.x.hub_origin.delete_suffix('/')}#{repository_prototype_path(@repository.route_id, prototype, build: published.number)}",
        publishedAt: published.finished_at.iso8601,
        author: {
          login: published.commit_author_login,
          name: published.commit_author_name,
          avatarUrl: published.commit_author_avatar_url
        }
      }
    }
  end

  # Avoids a branch-list request on every display-only status poll.
  def registration_reason(prototype)
    return if prototype.registered?

    Rails.cache.fetch(
      [ "canvas-registration-reason", @repository.id, prototype.id, Current.user.id, @repository_permission ],
      expires_in: 1.minute
    ) do
      @repository.prototype_candidates.registration_ineligibility_reason \
        prototype, Current.user, permission: @repository_permission
    end
  end

  def invalid_metadata(error)
    render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
  end
end
