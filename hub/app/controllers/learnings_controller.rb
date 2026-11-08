# Shows a repository's administrators what Hub learned from its review comments: suggestions to
# decide on, accepted learnings, what an agent gets, the decision model to post-train, and recent
# runs with their Copilot usage.
class LearningsController < SuperglueController
  include HasLearningWorkspace

  RECENT_RUNS = 10

  rescue_from GithubClient::Error, with: -> { head :service_unavailable }

  # @route GET /repositories/:repository_github_id/learnings (repository_learnings)
  def show
    load_learning_workspace
    return if performed?

    @runs = Learning::Run.where(repository: @repository).recent.includes(:requested_by).limit(RECENT_RUNS).to_a
    @connection = CopilotConnection.current
    @decision_model = Learning::DecisionModel.includes(:chosen_by).find_by(repository: @repository)
    @decision_models = Learning::DecisionModel.catalog
    @overview = Learning::Overview.new(Learning::Store.new(@repository), viewer: Learning.person_for(Current.user)).load
  rescue Learning::Error => error
    @decision_models ||= []
    @overview = Learning::Overview::EMPTY
    @load_error = error.message
  end
end
