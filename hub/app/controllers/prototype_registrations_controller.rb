# Registers a discovered branch or updates its Hub metadata for repository writers.
class PrototypeRegistrationsController < ApplicationController
  rescue_from GithubClient::Error, with: :repository_unavailable

  # @route PATCH /repositories/:repository_github_id/prototypes/:prototype_id/registration (repository_prototype_registration)
  # @route PUT /repositories/:repository_github_id/prototypes/:prototype_id/registration (repository_prototype_registration)
  def update
    repository = Repository.find_by_route_id!(params[:repository_github_id])
    permission = repository.authorization.permission_for(Current.user, fresh: true)
    if !repository.authorization.sufficient?(permission, minimum: :write)
      return head :not_found
    end

    prototype = repository.reviewable_prototypes.find(params[:prototype_id])
    if !prototype.registered? &&
        !repository.prototype_candidates.eligible?(prototype, permission:)
      return head :not_found
    end

    destination = destination_for(repository, prototype)
    prototype.register! \
      **metadata_params,
      author: Current.user,
      registration_only: params[:intent] == "register_only"
    redirect_to destination, status: :see_other
  rescue ActiveRecord::RecordInvalid => error
    redirect_to \
      destination,
      alert: error.record.errors.full_messages.to_sentence,
      status: :see_other
  rescue LocalDevelopment::Error => error
    response.status = 422
    response.content_type = "text/plain; charset=utf-8"
    self.response_body = error.message
  end

  private

  # Accepts only the review-facing fields that a writer may change.
  def metadata_params
    params.require(:prototype).permit(:name, :description, :start_page).to_h.symbolize_keys
  end

  # Returns to the gallery, management page, or the same selected review Build.
  def destination_for(repository, prototype)
    return repository_path(repository.route_id) if params[:return_to] == "repository"

    return repository_prototype_management_path(repository.route_id) if params[:return_to] != "review"

    number = params[:build]
    if number.present?
      if !number.is_a?(String) || !number.match?(/\A[1-9]\d*\z/) ||
          !prototype.builds.where(state: "successful", number: number.to_i).exists?
        raise ActiveRecord::RecordNotFound
      end
    end

    options = number.present? ? { build: number } : {}
    repository_prototype_path(repository.route_id, prototype, **options)
  end

  # Returns unavailable when GitHub cannot confirm access.
  def repository_unavailable
    head :service_unavailable
  end
end
