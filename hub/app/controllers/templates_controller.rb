# Redirects the old catalog and previews the default branch's templates.
class TemplatesController < SuperglueController
  include HasRepositoryTemplates

  rescue_from GithubClient::Error, ArtifactStore::Error, Build::Templates::InvalidManifest,
    with: :templates_unavailable

  # @route GET /repositories/:repository_github_id/templates (repository_templates)
  def index
    load_repository_workspace
    return if performed?

    redirect_to repository_new_prototype_path(@repository.route_id)
  end

  # @route GET /repositories/:repository_github_id/templates/:id (repository_template)
  def show
    load_repository_templates
    return if performed?

    @template = if params[:id] == "default"
      { "id" => "default", "name" => t("templates.default.name"), "path" => "/" }
    else
      @templates.find { _1.fetch("id") == params[:id] } || raise(ActiveRecord::RecordNotFound)
    end
    @preview_path = PreviewGrant.validate_return_path \
      params.key?(:return_path) ? params[:return_path] : @template.fetch("path")
    render "replica_browses/show"
    record_template_preview if @selected_build
  rescue ArgumentError
    head :not_found
  end

  private

  # Counts the template, not a particular route or Build, once per viewer and UTC day.
  def record_template_preview
    Analytics::Event.record_page_view do
      actor_id = Analytics.actor_id(user: Current.user)
      template_id = Digest::SHA256.hexdigest(@template.fetch("id"))
      now = Time.current
      Analytics::Event.record! \
        repository: @repository,
        name: "template_previewed",
        source_key: "template_preview/#{@repository.id}/#{actor_id}/#{template_id}/#{now.utc.to_date.iso8601}",
        actor_id:,
        occurred_at: now,
        properties: { prototype_id: @selected_build.prototype_id, build_id: @selected_build.id }
    end
  end

  # Missing or corrupt retained metadata is a failure, not an empty template list.
  def templates_unavailable
    head :service_unavailable
  end
end
