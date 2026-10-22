# Shows one Build after GitHub confirms access to its repository.
class BuildsController < SuperglueController
  include HasRepositoryWorkspace

  BUILDS_PER_PAGE = 25

  rescue_from GithubClient::Error, with: :repository_unavailable

  # @route GET /repositories/:repository_github_id/prototypes/:prototype_id/builds (repository_prototype_builds)
  def index
    load_prototype
    return if performed?

    @history_build = history_build
    before = params[:before]
    before_at = params[:before_at]
    return head :not_found if before_at && !before
    if before && !before_at
      return redirect_legacy_cursor(before)
    end
    return head :not_found if before && (!valid_build_number?(before) || !valid_time?(before_at))

    builds = @prototype.builds.chronological
    if before
      builds = builds.chronologically_before(time: Time.iso8601(before_at), number: before.to_i)
    end
    page_builds = builds.limit(BUILDS_PER_PAGE + 1).to_a
    return head :not_found if before && page_builds.empty?

    @builds = page_builds.first(BUILDS_PER_PAGE)
    if before
      @newest_page_path = repository_prototype_builds_path \
        @repository.route_id,
        @prototype,
        **history_parameters
    end
    if page_builds.size > BUILDS_PER_PAGE
      @next_page_path = repository_prototype_builds_path \
        @repository.route_id,
        @prototype,
        **history_parameters,
        before: @builds.last.number,
        before_at: @builds.last.chronological_at.iso8601(6)
    end
    prepare_review_header
  end

  # @route GET /repositories/:repository_github_id/prototypes/:prototype_id/builds/:number (repository_prototype_build)
  def show
    load_prototype
    return if performed?

    @build = @prototype.builds.find_by!(number: params[:number])
    prepare_review_header
    if @build.state == "successful"
      @selected_build = @build
    else
      @selected_build = nil
      @latest_build = @build
    end
  end

  private

  # Loads one Prototype through a currently authorized repository.
  def load_prototype
    load_repository_workspace
    return if performed?

    @prototype = @repository.reviewable_prototypes.find(params[:prototype_id])
  end

  def prepare_review_header
    @latest_build = @prototype.current_build || @prototype.builds.chronological.first
    @selected_build = @history_build ||
      @prototype.builds.where(state: "successful").chronological.first
    @build_options = @prototype.builds.chronological.to_a
    @can_manage_share_links = @prototype.share_links_manageable_by? \
      Current.user,
      repository_permission: @repository_permission
  end

  # Returns unavailable when GitHub cannot confirm repository access.
  def repository_unavailable
    head :service_unavailable
  end

  def valid_build_number?(value)
    value.is_a?(String) && value.match?(/\A[1-9]\d*\z/)
  end

  def valid_time?(value)
    return false if !value.is_a?(String)

    Time.iso8601(value)
    true
  rescue ArgumentError
    false
  end

  def history_build
    number = params[:build]
    return if number.nil? || (number.is_a?(ActionController::Parameters) && number.empty?)

    raise ActiveRecord::RecordNotFound if !valid_build_number?(number)

    @prototype.builds.where(state: "successful").find_by!(number: number.to_i)
  end

  def history_parameters
    @history_build ? { build: @history_build.number } : {}
  end

  # Adds the captured timestamp required by chronological pagination.
  def redirect_legacy_cursor(number)
    return head :not_found if !valid_build_number?(number)

    build = @prototype.builds.find_by!(number: number.to_i)
    redirect_to repository_prototype_builds_path \
      @repository.route_id,
      @prototype,
      **history_parameters,
      before: build.number,
      before_at: build.chronological_at.iso8601(6)
  end
end
