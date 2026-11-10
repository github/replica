# Shows a branch's selected successful Build after GitHub confirms access.
class PrototypesController < SuperglueController
  include HasRepositoryWorkspace

  rescue_from GithubClient::Error, with: :repository_unavailable

  # @route GET /repositories/:repository_github_id/prototypes/:id (repository_prototype)
  def show
    load_repository_workspace
    return if performed?

    @prototype = @repository.reviewable_prototypes.find(params[:id])
    @document_title = @prototype.name.presence || @prototype.branch_name
    @can_manage_share_links = @prototype.share_links_manageable_by? \
      Current.user,
      repository_permission: @repository_permission
    return redirect_legacy_history if params.key?(:before)

    @latest_build = @prototype.current_build ||
      @prototype.builds.chronological.first
    @selected_build = selected_build
    @build_options = @prototype.builds.chronological.to_a
    @preview_path = PreviewGrant.validate_return_path(
      params[:return_path].presence || @prototype.start_page || "/"
    )
    @can_edit_details = @prototype.registered? &&
      @repository.authorization.sufficient?(@repository_permission, minimum: :write) &&
      (@repository.local? || @prototype.author_id == Current.user.id ||
        @prototype.builds.where(commit_author_github_id: Current.user.github_id).exists?)
    @show_prototype_info = false
    return if params[:view] == "minimized" ||
      PrototypeIntroduction.exists?(user: Current.user, prototype: @prototype)

    PrototypeIntroduction.transaction do
      introduction = PrototypeIntroduction.record!(user: Current.user, prototype: @prototype)
      @show_prototype_info = introduction.previously_new_record?
      render :show
      raise ActiveRecord::Rollback unless response.successful?
    end
  rescue ArgumentError
    head :not_found
  end

  private

  # Returns the requested successful Build or the latest successful Build.
  def selected_build
    builds = @prototype.builds.where(state: "successful")
    return builds.chronological.first if !params.key?(:build)

    number = params[:build]
    if !number.is_a?(String) || !number.match?(/\A[1-9]\d*\z/)
      raise ActiveRecord::RecordNotFound
    end

    builds.find_by!(number: number.to_i)
  end

  # Moves a previously generated history URL to the dedicated history route.
  def redirect_legacy_history
    before = params[:before]
    if !before.is_a?(String) || !before.match?(/\A[1-9]\d*\z/)
      raise ActiveRecord::RecordNotFound
    end

    redirect_to repository_prototype_builds_path(@repository.route_id, @prototype, before:)
  end

  # Returns unavailable when GitHub cannot confirm repository access.
  def repository_unavailable
    head :service_unavailable
  end
end
