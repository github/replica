# Returns the paired repository's current Hub template catalog without a prototype.
class CanvasApi::TemplatesController < CanvasApi::BaseController
  rescue_from ArtifactStore::Error, Build::Templates::InvalidManifest, with: :templates_unavailable

  # @route GET /api/canvas/templates (canvas_api_templates)
  def index
    build = @repository.replica_build_owner&.builds&.where(state: "successful")&.chronological&.first
    entries = build ? build.templates.entries : []
    templates = [ { id: "default", name: I18n.t("templates.default.name"), route: "/" } ]
    templates.concat(entries.map { { id: _1.fetch("id"), name: _1.fetch("name"), route: _1.fetch("path") } })
    copy = %w[
      heading description_placeholder template_label preview_unavailable
      add_details edit_details details_heading details_description
      change_label change_placeholder audience_label audience_placeholder
      outcome_label outcome_placeholder close_details save_details submit_label
    ].index_with { I18n.t("new_prototypes.show.#{_1}") }.transform_keys { _1.camelize(:lower) }
    render json: {
      templates: templates,
      promptInstructions: I18n.t("replica_browses.show.branch_instructions"),
      templatePageInstructions: I18n.t("prototype_prompts.viewed_page", route: "%{route}"),
      templateLandingPageInstructions: I18n.t("templates.detail.landing_page_instructions", route: "%{route}"),
      copy: copy
    }
  end

  private

  def templates_unavailable
    render json: { error: "Hub could not load this repository's templates. Try again." }, status: :service_unavailable
  end
end
