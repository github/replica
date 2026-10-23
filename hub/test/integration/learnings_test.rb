require "test_helper"
require "sqlite3"

class LearningsIntegrationTest < ActionDispatch::IntegrationTest
  include LearningTestHelpers

  setup do
    @configuration = github_app_configurations.create_installed
    @payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ @payload ], permissions: { 2001 => "admin" })
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    get github_authentication_callback_path, params: { code: "code", state: }
    @repository = Repository.find_by!(github_id: 2001)
    @path = repository_learnings_path(@repository.route_id)
    admin = users.create(github_id: 1_009, login: "learnings-admin", hub_admin: true)
    @connection = connect_copilot(admin)
    use_test_labeler(@repository)
    learning_comment \
      @repository,
      users.create(github_id: 1_002, login: "mona"),
      "prototype/signup",
      "The email field has no label."
    learning_comment \
      @repository,
      users.create(github_id: 1_003, login: "hubot"),
      "prototype/checkout",
      "The card number needs a visible label."
  end

  test "Learnings stays out of sight until a Hub administrator connects Copilot" do
    get repository_path(@repository.route_id), as: :json
    assert_equal @path, data.fetch("learningsPath")

    @connection.destroy!
    get repository_path(@repository.route_id), as: :json
    assert_nil data.fetch("learningsPath")
    get @path, as: :json
    assert_response :not_found
    post repository_learnings_runs_path(@repository.route_id)
    assert_response :not_found
    assert_empty Learning::Run.all
  end

  test "a repository administrator finds learnings, accepts one in their own words, and retires it" do
    post repository_learnings_runs_path(@repository.route_id)
    assert_redirected_to @path
    assert_equal I18n.t("learnings.runs.requested"), flash[:notice]
    run = Learning::Run.sole
    assert_equal [ "octocat", false ], [ run.requested_by.login, run.scheduled ]
    run.find_learnings!

    get @path, as: :json
    assert_response :success
    assert_equal "learnings", data.fetch("selectedSection")
    assert_equal repository_new_prototype_path(@repository.route_id), data.fetch("newPrototypePath")
    assert_equal I18n.t("repository_workspace.repositories"), data.fetch("repositoryMenuLabel")
    %w[system light dark].each do |theme|
      assert_equal I18n.t("repository_workspace.theme_#{theme}"), data.fetch("#{theme}ThemeLabel")
    end
    assert_match "@learnings-admin made", data.dig("status", "message")
    suggestion = data.fetch("suggestions").sole
    assert_equal "Raised by 2 reviewers on 2 prototypes", suggestion.fetch("support")
    assert_equal \
      [ "The card number needs a visible label.", "The email field has no label." ],
      suggestion.fetch("evidence").map { _1.fetch("body") }.sort
    assert_equal "Finished", data.fetch("runs").sole.fetch("stateLabel")
    assert_equal "2 new comments, 2 labeled, 1 new suggestion", data.fetch("runs").sole.fetch("result")
    assert_equal "0.005 AI credits in 1 request", data.fetch("runs").sole.fetch("usage")

    post \
      suggestion.fetch("decisionPath"),
      params: { decision: "accept", digest: suggestion.fetch("digest"), content: "Label every form field visibly." }
    assert_redirected_to @path
    assert_equal I18n.t("learnings.decisions.done.accept"), flash[:notice]
    get @path, as: :json
    assert_empty data.fetch("suggestions")
    learning = data.fetch("learnings").sole
    assert_equal "Label every form field visibly.", learning.fetch("content")
    assert_match(/\AAccepted by @octocat on .+, with edits\z/, learning.fetch("accepted"))
    assert_includes data.dig("recall", "text"), "Label every form field visibly."

    post learning.fetch("decisionPath"), params: { decision: "retire", reason: "Our design system labels fields." }
    assert_equal I18n.t("learnings.decisions.done.retire"), flash[:notice]
    get @path, as: :json
    assert_empty data.fetch("learnings")
    assert_equal 0, data.dig("recall", "count")
    assert_equal \
      %w[learning.run learning.accept learning.retire],
      SecurityAuditEvent.where(repository: @repository).order(:id).pluck(:action)
  end

  test "a repository administrator can ask for the daily run that still waits, which moves it ahead" do
    Learning::Run.schedule_all!
    daily = Learning::Run.sole

    get @path, as: :json
    assert_equal I18n.t("learnings.status.queued"), data.dig("status", "activity")
    assert_equal true, data.dig("run", "available")

    post repository_learnings_runs_path(@repository.route_id)
    assert_equal I18n.t("learnings.runs.requested"), flash[:notice]
    assert_equal [ false, "octocat" ], [ daily.reload.scheduled, daily.requested_by.login ]
    get @path, as: :json
    assert_equal false, data.dig("run", "available")
  end

  test "a decision needs a reason to reject and the wording the person saw" do
    run = Learning::Run.request!(repository: @repository, user: users.create(github_id: 1_004, login: "run-requester"))
    run.find_learnings!
    assert_equal "succeeded", run.reload.state, run.failure_summary
    get @path, as: :json
    assert_nil data.fetch("loadError")
    suggestion = data.fetch("suggestions").sole
    path = suggestion.fetch("decisionPath")

    post path, params: { decision: "reject", digest: suggestion.fetch("digest"), reason: " " }
    assert_equal I18n.t("learnings.decisions.invalid"), flash[:alert]
    post path, params: { decision: "accept", digest: "sha256:#{"0" * 64}" }
    assert_match(/\AHub could not record that decision: /, flash[:alert])
    get @path, as: :json
    assert_nil data.fetch("loadError")
    assert_equal suggestion.fetch("id"), data.fetch("suggestions").sole.fetch("id")

    post path, params: { decision: "reject", digest: suggestion.fetch("digest"), reason: "We label fields already." }
    assert_equal I18n.t("learnings.decisions.done.reject"), flash[:notice]
    get @path, as: :json
    assert_empty data.fetch("suggestions")
    assert_empty data.fetch("learnings")
    assert_equal \
      [ %w[learning.reject denied], %w[learning.accept failed], %w[learning.reject succeeded] ],
      SecurityAuditEvent.where(repository: @repository).order(:id).pluck(:action, :outcome)
  end

  test "a run request that Hub cannot audit starts no run" do
    failing_to_audit("learning.run") do
      assert_raises(ActiveRecord::StatementInvalid) { post repository_learnings_runs_path(@repository.route_id) }
    end

    assert_empty Learning::Run.all
    assert_no_enqueued_jobs only: Learning::Run::FindLearningsJob
  end

  test "an explicitly blank edit is refused without accepting the original suggestion" do
    Learning::Run.request!(repository: @repository, user: User.find_by!(github_id: 1001)).find_learnings!
    get @path, as: :json
    suggestion = data.fetch("suggestions").sole

    [ "", " \n\t " ].each do |content|
      post suggestion.fetch("decisionPath"), params: { decision: "accept", digest: suggestion.fetch("digest"), content: }

      assert_equal I18n.t("learnings.decisions.invalid"), flash[:alert]
      record = Learning::Store.new(@repository).call("memories").sole.fetch("record")
      assert_equal "proposed", record.fetch("state")
      assert_equal suggestion.fetch("content"), record.fetch("content")
    end
  end

  test "a decision Hub cannot audit stays in the learning store under the person's name" do
    Learning::Run.request!(repository: @repository, user: User.find_by!(github_id: 1001)).find_learnings!
    get @path, as: :json
    suggestion = data.fetch("suggestions").sole

    failing_to_audit("learning.accept") do
      assert_raises(ActiveRecord::StatementInvalid) do
        post suggestion.fetch("decisionPath"), params: { decision: "accept", digest: suggestion.fetch("digest") }
      end
    end

    record = Learning::Store.new(@repository).call("memories").sole.fetch("record")
    assert_equal "accepted", record.fetch("state")
    assert_equal Learning.person_for(User.find_by!(github_id: 1001)), record.dig("accepted", "by", "id")
  end

  test "says when a run left comments for the next run" do
    Learning::Run.create! \
      repository: @repository, scheduled: true, state: "succeeded", started_at: 1.hour.ago, finished_at: 1.hour.ago,
      comments_considered: 400, comments_labeled: 120, comments_remaining: 35, suggestions: 2

    get @path, as: :json
    assert_equal \
      "400 new comments, 120 labeled, 2 new suggestions, 35 comments left for the next run",
      data.fetch("runs").sole.fetch("result")
  end

  test "usage includes recently executed runs even when they waited longer than 30 days" do
    Learning::Run.create! \
      repository: @repository, state: "succeeded", created_at: 31.days.ago,
      started_at: 29.days.ago, finished_at: 29.days.ago, nano_aiu: 147_000_000, copilot_requests: 2

    get @path, as: :json

    assert_equal I18n.t("learnings.status.usage", credits: "0.147"), data.dig("status", "usage")
  end

  test "a suggestion without support counts keeps its evidence and decision controls" do
    use_test_consolidator_without_support(@repository)
    Learning::Run.request!(repository: @repository, user: User.find_by!(github_id: 1001)).find_learnings!

    get @path, as: :json

    assert_nil data.fetch("loadError")
    suggestion = data.fetch("suggestions").sole
    assert_nil suggestion.fetch("support")
    assert_equal 2, suggestion.fetch("evidence").size
    post suggestion.fetch("decisionPath"), params: { decision: "accept", digest: suggestion.fetch("digest") }
    assert_equal I18n.t("learnings.decisions.done.accept"), flash[:notice]
  end

  test "a damaged accepted learning omits unavailable attribution and explains integrity damage" do
    Learning::Run.request!(repository: @repository, user: User.find_by!(github_id: 1001)).find_learnings!
    store = Learning::Store.new(@repository)
    proposal = store.call("memories").sole.fetch("record")
    store.call("accept", proposal.fetch("id"), "--digest=#{proposal.fetch("reviewDigest")}", "--by", "github:octocat")
    database = SQLite3::Database.new(store.directory.join("learning.sqlite").to_s)
    database.execute \
      "UPDATE memory_versions SET body = json_set(body, '$.content', 'Damaged wording') WHERE id = ? AND version = 2",
      [ proposal.fetch("id") ]
    database.close

    get @path, as: :json

    assert_nil data.fetch("loadError")
    learning = data.fetch("learnings").sole
    assert_equal I18n.t("learnings.accepted.damaged_content"), learning.fetch("content")
    assert_nil learning.fetch("accepted")
    assert_equal I18n.t("learnings.accepted.damaged"), learning.fetch("status")
    assert_equal false, learning.fetch("recalled")
    assert_equal 0, data.dig("recall", "count")
  end

  test "identity revalidation explains withheld approval and lists the learning a fresh review replaces" do
    proposal = import_legacy_learning_comments(@repository, by: "github:octocat").fetch("proposals").sole
    store = Learning::Store.new(@repository)
    approved = store.call("accept", proposal.fetch("id"), "--digest=#{proposal.fetch("reviewDigest")}", "--by", "github:octocat")
    run = Learning::Run.request!(repository: @repository, user: User.find_by!(github_id: 1001)).tap(&:find_learnings!)
    assert_equal "succeeded", run.state, run.failure_summary

    get @path, as: :json

    assert_equal I18n.t("learnings.identity_notice"), data.fetch("identityNotice")
    old = data.fetch("learnings").sole
    assert_equal I18n.t("learnings.accepted.identity_content"), old.fetch("content")
    assert_equal I18n.t("learnings.accepted.identity_review"), old.fetch("status")
    assert_match "Accepted by @octocat", old.fetch("accepted")
    assert_equal false, old.fetch("recalled")
    assert_equal 0, data.dig("recall", "count")
    replacement = data.fetch("suggestions").sole
    target = replacement.fetch("replaces").sole
    assert_equal approved.fetch("id"), target.fetch("id")
    assert_equal I18n.t("learnings.suggestions.replacement_unavailable"), target.fetch("content")
    post replacement.fetch("decisionPath"), params: { decision: "accept", digest: replacement.fetch("digest") }
    assert_equal I18n.t("learnings.decisions.done.accept"), flash[:notice]
    get @path, as: :json
    assert_nil data.fetch("identityNotice")
    assert_equal 1, data.dig("recall", "count")
    assert_includes data.dig("recall", "text"), replacement.fetch("content")
  end

  test "someone who cannot administer the repository cannot see, run, or decide on learnings" do
    stub_github_permissions([ @payload ], { 2001 => "write" })

    get repository_path(@repository.route_id), as: :json
    assert_nil data.fetch("learningsPath")
    get @path, as: :json
    assert_response :not_found
    post repository_learnings_runs_path(@repository.route_id)
    assert_response :not_found
    post \
      decision_repository_learnings_path(@repository.route_id, "mem_#{"0" * 24}"),
      params: { decision: "retire", reason: "No longer true." }
    assert_response :not_found
    assert_empty Learning::Run.all
  end

  test "after Copilot refuses the connection, people still decide but cannot start a run" do
    Learning::Run.request!(repository: @repository, user: User.find_by!(github_id: 1001)).find_learnings!
    @connection.refuse!

    get @path, as: :json
    assert_response :success
    assert data.dig("status", "refused")
    assert_equal false, data.dig("run", "available")
    suggestion = data.fetch("suggestions").sole
    post suggestion.fetch("decisionPath"), params: { decision: "accept", digest: suggestion.fetch("digest") }
    assert_equal I18n.t("learnings.decisions.done.accept"), flash[:notice]
    get @path, as: :json
    assert_equal suggestion.fetch("content"), data.fetch("learnings").sole.fetch("content")

    assert_no_difference("Learning::Run.count") { post repository_learnings_runs_path(@repository.route_id) }
    assert_equal I18n.t("learnings.runs.copilot_refused"), flash[:alert]
    assert SecurityAuditEvent.exists?(repository: @repository, action: "learning.run", outcome: "denied")
  end

  test "a replaced token lifts the refusal of the old one, and a removed token stops runs" do
    @connection.refuse!
    Rails.configuration.x.copilot_token = "renewed-user-token"

    get @path, as: :json
    assert_equal false, data.dig("status", "refused")
    assert_equal true, data.dig("run", "available")

    Rails.configuration.x.copilot_token = nil
    get @path, as: :json
    assert_equal true, data.dig("status", "refused")
    assert_equal I18n.t("learnings.status.no_token"), data.dig("status", "message")
    assert_no_difference("Learning::Run.count") { post repository_learnings_runs_path(@repository.route_id) }
  end

  test "with organization billing, the status says what Hub needs before it looks for learnings again" do
    Rails.configuration.x.copilot_billing = "organization"
    get @path, as: :json
    assert_equal I18n.t("learnings.organization.status.unconfirmed"), data.dig("status", "message")

    connect_copilot_for_organization(@connection.user).refuse!
    get @path, as: :json
    assert_equal \
      I18n.t("learnings.organization.status.refused", date: Date.current.to_fs(:long)),
      data.dig("status", "message")

    @configuration.update!(owner_type: "User")
    get @path, as: :json
    assert_equal I18n.t("learnings.organization.status.no_token"), data.dig("status", "message")
  end

  private

  def data
    JSON.parse(response.body).fetch("data")
  end

  # Makes saving the given security audit action fail, the way a full or locked database does.
  def failing_to_audit(action)
    original = SecurityAuditEvent.method(:record!)
    SecurityAuditEvent.define_singleton_method(:record!) do |**attributes|
      raise ActiveRecord::StatementInvalid, "database is locked" if attributes[:action] == action

      original.call(**attributes)
    end
    yield
  ensure
    SecurityAuditEvent.define_singleton_method(:record!, original)
  end
end
