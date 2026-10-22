# Renders only installed repositories the current GitHub user may read.
class RepositoriesController < SuperglueController
  include HasRepositoryWorkspace

  rescue_from GithubClient::Error, with: :repository_unavailable

  # @route GET /repositories (repositories)
  def index
    Repository::LocalDiscovery.register_repositories! if LocalDevelopment.enabled?

    configuration = GithubAppConfiguration.current
    repository = authorized_repositories(configuration).first
    return head :not_found if repository.nil?

    flash.keep(:notice)
    redirect_to repository_path(repository.route_id)
  rescue LocalDevelopment::Error => error
    local_error(error.message)
  end

  # @route GET /repositories/:github_id (repository)
  def show
    load_repository_workspace
    return if performed?

    @listing = @repository.prototype_listing.page \
      user: Current.user,
      query: params[:q],
      author: params[:author],
      page: params[:page]
    @prototypes = @listing.prototypes
    ActiveRecord::Associations::Preloader.new(records: @prototypes, associations: [ :author, :current_build ]).call
    prototype_ids = @prototypes.map(&:id)
    @latest_builds = @prototypes.filter_map(&:current_build).index_by(&:prototype_id)
    missing_prototype_ids = prototype_ids - @latest_builds.keys
    fallback_builds = Build.where(prototype_id: missing_prototype_ids).latest_by_prototype
    @latest_builds.merge!(fallback_builds.index_by(&:prototype_id))
    @review_builds = Build.where \
      prototype_id: prototype_ids,
      state: "successful"
    @review_builds = @review_builds.latest_by_prototype.index_by(&:prototype_id)
    @workflow_status = @repository.local? ? :installed : workflow_status(GithubAppConfiguration.current)
    @repository_writable = @repository.authorization.sufficient? \
      @repository_permission,
      minimum: :write
    if @repository_writable
      begin
        @recent_branches = @repository.prototype_candidates.recently_active_by \
          Current.user,
          permission: @repository_permission
      rescue GithubClient::Error, LocalDevelopment::Error
        @candidate_check_failed = true
      end
    end
  rescue Repository::PrototypeListing::InvalidQuery
    head :bad_request
  end

  # @route POST /repositories/:github_id/poll (poll_repository)
  def poll
    if LocalDevelopment.enabled?
      return head :not_found if Current.user.github_id.present?

      repository = Repository.where(github_id: nil).find_by(id: params[:github_id])
      if repository.nil? || repository.installation_state != "active" ||
          !LocalDevelopment.repository_available?(repository.local_path, identity: repository.local_identity)
        return local_error(I18n.t("local_development.repository_unavailable",
          directory: LocalDevelopment.repositories_root))
      end
    else
      repository = Repository.find_by_route_id!(params[:github_id])
    end
    configuration = GithubAppConfiguration.current
    authorized = repository.authorization.authorized? \
      Current.user,
      minimum: :write,
      fresh: true,
      configuration: configuration
    return head :not_found if !authorized

    if LocalDevelopment.enabled?
      repository.local_discovery.refresh!(requeue_pending: true)
      redirect_to repository_path(repository.route_id), status: :see_other
    else
      configuration.discover_builds_later!(repository)
      head :accepted
    end
  rescue LocalDevelopment::Error => error
    if LocalDevelopment.enabled? && repository&.local? &&
        LocalDevelopment.repository_available?(repository.local_path, identity: repository.local_identity)
      redirect_to repository_path(repository.route_id), alert: error.message, status: :see_other
    else
      local_error(error.message)
    end
  end

  private

  # Reports a missing local checkout without requiring a repository page to exist.
  def local_error(message)
    response.status = 422
    response.content_type = "text/plain; charset=utf-8"
    self.response_body = message
  end

  # Fails closed for one repository when GitHub cannot confirm access.
  def repository_unavailable
    head :service_unavailable
  end

  # Keeps stored repository data available when the optional workflow check fails.
  def workflow_status(configuration)
    @repository.workflow_installation.status(configuration:)
  rescue GithubClient::Error
    :unavailable
  end
end
