# Offers bounded registration-author choices only within an authorized repository.
class PrototypeAuthorsController < ApplicationController
  include HasRepositoryWorkspace

  rescue_from GithubClient::Error, with: -> { head :service_unavailable }

  # @route GET /repositories/:repository_github_id/prototype_authors (repository_prototype_authors)
  def index
    load_repository_workspace
    return if performed?

    page = @repository.prototype_listing.authors \
      user: Current.user,
      query: params[:q],
      cursor: params[:cursor]
    response.headers["Cache-Control"] = "private, no-store"
    render \
      json: {
        authors: page.fetch(:authors).map do |author|
          { id: author.id.to_s, login: author.login, name: author.name, avatarUrl: author.avatar_url }
        end,
        nextCursor: page.fetch(:next_cursor)
      }
  rescue Repository::PrototypeListing::InvalidQuery
    head :bad_request
  end
end
