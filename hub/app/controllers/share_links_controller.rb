# Lists, creates, and deletes public links for one Prototype.
class ShareLinksController < SuperglueController
  include HasRepositoryWorkspace
  include HasShareLinkContext

  before_action :load_share_link_context
  before_action :require_public_sharing, only: %i[create destroy]
  before_action :validate_control_parameters, only: [ :create, :destroy ]
  before_action :validate_management_build, only: %i[create destroy]

  rescue_from GithubClient::Error, with: :repository_unavailable
  rescue_from SharingSetting::Disabled, SharingSetting::Changed, with: :public_sharing_disabled
  rescue_from ShareLinkCreatorRevocation::Changed, with: :creator_access_changed

  # Lists active share links for one Prototype.
  # @route GET /repositories/:repository_github_id/prototypes/:prototype_id/share_links (repository_prototype_share_links)
  def index
    prepare_index
  end

  # Creates one public link for a successful Build.
  # @route POST /repositories/:repository_github_id/prototypes/:prototype_id/share_links (repository_prototype_share_links)
  def create
    share_link = create_share_link
    return if performed?

    redirect_to management_path, status: :see_other
  rescue ShareLink::InvalidExpiration, ActiveRecord::RecordInvalid => error
    invalid_share_link(error)
  end

  # Deletes one link so its public route stops working.
  # @route DELETE /repositories/:repository_github_id/prototypes/:prototype_id/share_links/:id (repository_prototype_share_link)
  def destroy
    share_link = @prototype.share_links.find(params[:id])
    share_link.destroy!
    redirect_to management_path, status: :see_other
  end

  private

  def security_audit_action
    { "create" => "share_link.create", "destroy" => "share_link.delete" }[action_name]
  end

  # Loads one Prototype after checking current GitHub permission.
  def load_share_link_context
    @repository = Repository.find_by_route_id!(params[:repository_github_id])
    return head :not_found if @repository.local?

    load_repository_workspace(fresh: true)
    return if performed?

    load_share_link_prototype
  end

  # Loads the current successful Build and active links for the page.
  def prepare_index
    @public_sharing_enabled = SharingSetting.enabled?
    @selected_build = selected_build
    @latest_build = @prototype.current_build || @prototype.builds.chronological.first
    @build_options = @prototype.builds.chronological.to_a
    @can_manage_share_links = true
    @share_links = (@public_sharing_enabled ? @prototype.share_links.active : @prototype.share_links.none)
      .includes(:build, :created_by)
      .order(created_at: :desc, id: :desc)
  end

  def require_public_sharing
    public_sharing_disabled if !SharingSetting.enabled?
  end

  # Returns the requested successful Build or the latest successful Build.
  def selected_build
    builds = @prototype.builds.where(state: "successful")
    return builds.chronological.first if !params.key?(:build)

    builds.find_by!(number: positive_build_number(params[:build]))
  end

  # Returns to the same default or explicitly selected management view.
  def management_path
    repository_prototype_share_links_path \
      @repository.route_id,
      @prototype,
      **@control_parameters,
      **(@management_build_number ? { build: @management_build_number } : {})
  end

  def validate_management_build
    value = params[:management_build]
    return if value.nil?

    number = positive_build_number(value)
    @management_build_number = @prototype.builds.where(state: "successful").find_by!(number:).number
  end

  def validate_control_parameters
    @control_parameters = control_parameters
  end

  def control_parameters
    query = params[:control_query]
    return {} if query.nil? || query == ""

    unless query.is_a?(String) && query.bytesize <= 8192
      raise ActionController::BadRequest, "Invalid control settings query."
    end

    entries = URI.decode_www_form(query)
    keys = entries.map(&:first)
    unless URI.encode_www_form(entries).bytesize <= 8192 && keys.uniq.length == keys.length &&
        keys.all? { |key| key.match?(/\Arc\.[a-zA-Z][a-zA-Z0-9_-]{0,63}\.[a-zA-Z][a-zA-Z0-9_-]{0,63}\z/) }
      raise ActionController::BadRequest, "Invalid control settings parameters."
    end
    entries.to_h
  rescue ArgumentError
    raise ActionController::BadRequest, "Invalid control settings encoding."
  end

  # Returns a clear validation error without saving a partial link.
  def invalid_share_link(error)
    record_security_audit(outcome: "failed")
    redirect_to \
      management_path,
      alert: share_link_errors(error).to_sentence,
      status: :see_other
  end

  # Returns unavailable when GitHub cannot confirm repository access.
  def repository_unavailable
    head :service_unavailable
  end
end
