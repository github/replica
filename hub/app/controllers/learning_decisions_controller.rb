# Records a repository administrator's decision on a suggestion or a learning in its store.
#
# The store checks that the review digest is the one the person saw, so a suggestion that changed
# after the page loaded cannot be accepted or rejected by mistake.
class LearningDecisionsController < SuperglueController
  include HasLearningWorkspace

  DECISIONS = %w[accept reject retire].freeze
  DIGEST = /\Asha256:[0-9a-f]{64}\z/
  REASON_MAXIMUM = 500
  CONTENT_MAXIMUM = 2_000

  rescue_from GithubClient::Error, with: -> { head :service_unavailable }

  # @route POST /repositories/:repository_github_id/learnings/:memory_id/decision (decision_repository_learnings)
  def create
    load_learning_workspace
    return if performed?
    return refuse if !valid?

    record_decision(Learning::Store.new(@repository))
    back(notice: t("learnings.decisions.done.#{decision}"))
  rescue Learning::Error => error
    record_security_audit(outcome: "failed")
    back(alert: t("learnings.decisions.failed", reason: error.message))
  end

  private

  # The store commits outside Hub's database. Save the Hub audit and analytics events together
  # only after the store returns the new version.
  def record_decision(store)
    result = case decision
    when "accept" then accept(store)
    when "reject"
      store.call("reject", params[:memory_id], "--digest=#{params[:digest]}", "--by", person, "--reason=#{reason}")
    when "retire"
      store.call("retire", params[:memory_id], "--by", person, "--reason=#{reason}")
    end
    memory_key = Digest::SHA256.hexdigest(result.fetch("id"))
    Analytics::Event.transaction do
      record_security_audit(outcome: "succeeded")
      Analytics::Event.record! \
        repository: @repository,
        name: "learning_decision_recorded",
        source_key: "learning_decision/#{@repository.id}/#{memory_key}/#{result.fetch("version")}",
        actor_id: Analytics.actor_id(user: Current.user),
        properties: {}
    end
  rescue ActiveRecord::ActiveRecordError
    Rails.logger.error \
      "The learning store recorded #{security_audit_action} on #{params[:memory_id]} in " \
      "repository #{@repository.id}, but Hub could not save its audit and analytics events"
    raise
  end

  def security_audit_action
    DECISIONS.include?(decision) ? "learning.#{decision}" : "learning.decision"
  end

  def decision
    params[:decision].to_s
  end

  def valid?
    return false if DECISIONS.exclude?(decision)
    return false if decision != "retire" && !params[:digest].to_s.match?(DIGEST)
    return false if decision != "accept" && !reason.length.between?(1, REASON_MAXIMUM)

    content.nil? || content.length.between?(1, CONTENT_MAXIMUM)
  end

  # Accepts the suggestion as written, or with the wording the person edited.
  def accept(store)
    if content.nil?
      return store.call("accept", params[:memory_id], "--digest=#{params[:digest]}", "--by", person)
    end

    Tempfile.create([ "learning-", ".txt" ]) do |file|
      file.write(content)
      file.flush
      store.call \
        "accept", params[:memory_id],
        "--digest=#{params[:digest]}",
        "--by", person,
        "--content-file", file.path
    end
  end

  def person
    Learning.person_for(Current.user)
  end

  def reason
    params[:reason].to_s.strip
  end

  # Edited wording, or nil when the person accepts the suggestion as written.
  def content
    params[:content].to_s.strip if params.key?(:content)
  end

  def refuse
    record_security_audit(outcome: "denied")
    back(alert: t("learnings.decisions.invalid"))
  end

  def back(**flash)
    redirect_to repository_learnings_path(@repository.route_id), status: :see_other, **flash
  end
end
