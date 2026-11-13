# Lets a repository administrator choose the base model Hub's Learnings page suggests post-training
# as the repository's decision model, and where its training runs.
class LearningDecisionModelsController < SuperglueController
  include HasLearningWorkspace

  rescue_from GithubClient::Error, with: -> { head :service_unavailable }

  # @route PATCH /repositories/:repository_github_id/learnings/decision_model (repository_learnings_decision_model)
  # @route PUT /repositories/:repository_github_id/learnings/decision_model (repository_learnings_decision_model)
  def update
    load_learning_workspace
    return if performed?

    Learning::DecisionModel.transaction do
      Learning::DecisionModel.choose! \
        repository: @repository,
        base_model: params[:base_model].to_s,
        training_environment: params[:training_environment].to_s,
        user: Current.user
      record_security_audit(outcome: "succeeded")
    end
    back(notice: t("learnings.decision_model.saved"))
  rescue ActiveRecord::RecordInvalid
    record_security_audit(outcome: "denied")
    back(alert: t("learnings.decision_model.invalid"))
  rescue Learning::Error => error
    record_security_audit(outcome: "failed")
    back(alert: t("learnings.decision_model.failed", reason: error.message))
  end

  private

  def security_audit_action
    "learning.decision_model"
  end

  def back(**flash)
    redirect_to repository_learnings_path(@repository.route_id), status: :see_other, **flash
  end
end
