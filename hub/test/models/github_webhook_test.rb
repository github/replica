require "test_helper"

class GithubWebhookTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

  GITHUB_TEST_SECRET = "It's a Secret to Everybody"
  GITHUB_TEST_PAYLOAD = "Hello, World!"
  GITHUB_TEST_SIGNATURE = "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17"

  test "preserves a new installation when repository synchronization fails" do
    configuration = github_app_configurations.create_installed
    configuration.update!(installation_state: "removed")
    payload = webhook_payload
    payload["installation"] = payload.fetch("installation").merge("id" => 789)
    body = JSON.generate(payload)
    stub_github_app(configuration:)
    stub_github_account_installation \
      account: { id: 321, login: "github", type: "Organization" }, installation_id: 789
    installation_repositories = configuration.repositories
    installation_repositories.define_singleton_method(:synchronize!) do
      raise GithubClient::Error, "GitHub is temporarily unavailable"
    end
    configuration.define_singleton_method(:repositories) { installation_repositories }

    assert_raises(GithubClient::Error) do
      process_webhook(configuration:, body:)
    end

    assert_equal 789, configuration.reload.installation_id
    assert_equal "active", configuration.installation_state
  end

  test "a repository selection notification makes selected repositories available" do
    configuration = github_app_configurations.create
    payload = webhook_payload.merge("action" => "added")
    stub_github_app(configuration:)
    stub_github_account_installation \
      account: { id: 321, login: "github", type: "Organization" }
    stub_github_installation_token
    stub_github_repositories([ repository_payload(2001, "github/prototype") ])

    process_webhook \
      configuration:,
      body: JSON.generate(payload),
      event: "installation_repositories"

    assert Repository.active.exists?(github_id: 2001)
    assert WebhookDelivery.sole.processed?
  end

  test "rejects an invalid signature" do
    configuration = github_app_configurations.create

    assert_raises(GithubWebhook::Rejected) do
      process_webhook \
        configuration:,
        body: JSON.generate(webhook_payload),
        signature: "sha256=wrong"
    end
  end

  test "matches GitHub's published signature test vector" do
    configuration = github_app_configurations.create webhook_secret: GITHUB_TEST_SECRET
    delivery = webhook \
      configuration:,
      body: GITHUB_TEST_PAYLOAD,
      event: "issues",
      signature: GITHUB_TEST_SIGNATURE

    assert_nil delivery.send(:verify_signature!)
  end

  test "rejects a changed body with GitHub's published signature" do
    configuration = github_app_configurations.create webhook_secret: GITHUB_TEST_SECRET
    delivery = webhook \
      configuration:,
      body: "#{GITHUB_TEST_PAYLOAD} changed",
      event: "issues",
      signature: GITHUB_TEST_SIGNATURE

    assert_raises(GithubWebhook::Rejected) { delivery.send(:verify_signature!) }
  end

  test "rejects a missing signature" do
    configuration = github_app_configurations.create
    body = JSON.generate(webhook_payload)

    assert_raises(GithubWebhook::Rejected) { process_webhook(configuration:, body:, signature: nil) }
  end

  test "rejects a malformed signature" do
    configuration = github_app_configurations.create
    body = JSON.generate(webhook_payload)

    assert_raises(GithubWebhook::Rejected) do
      process_webhook(configuration:, body:, signature: "sha1=not-a-sha256-signature")
    end
  end

  test "authenticates the exact bytes of a Unicode payload" do
    configuration = github_app_configurations.create
    body = JSON.generate("action" => "opened", "message" => "Olá, 世界")

    assert_nil process_webhook(configuration:, body:, event: "issues")
  end

  test "ignores unsupported events after checking the signature" do
    configuration = github_app_configurations.create
    body = JSON.generate("action" => "opened")

    assert_nil process_webhook(configuration:, body:, event: "issues")
  end

  test "accepts the previous secret during rotation" do
    configuration = github_app_configurations.create \
      previous_webhook_secret: "previous-secret", webhook_rotation_state: "pending"
    body = JSON.generate("action" => "opened")
    signature = "sha256=#{OpenSSL::HMAC.hexdigest("SHA256", "previous-secret", body)}"

    assert_nil process_webhook(configuration:, body:, event: "issues", signature:)
  end

  test "a stale configuration cannot accept a retired webhook secret or create a receipt" do
    configuration = github_app_configurations.create \
      previous_webhook_secret: "retired-secret", webhook_rotation_state: "confirmed"
    body = JSON.generate("action" => "opened")
    signature = "sha256=#{OpenSSL::HMAC.hexdigest("SHA256", "retired-secret", body)}"
    GithubAppConfiguration.find(configuration.id).update! \
      previous_webhook_secret: nil, webhook_rotation_state: "idle"
    assert_raises(GithubWebhook::Rejected) do
      process_webhook(configuration:, body:, event: "issues", signature:)
    end
    assert_empty WebhookDelivery.all
  end

  test "a superseded App cannot authenticate a receipt even with its old valid secret" do
    configuration = github_app_configurations.create
    GithubAppConfiguration.find(configuration.id).update!(credential_revision: 2)
    assert_raises(GithubAppConfiguration::Superseded) do
      process_webhook(configuration:, body: JSON.generate(webhook_payload))
    end
    assert_empty WebhookDelivery.all
  end

  test "creates one build for repeated eligible push discoveries" do
    configuration = installed_configuration
    repository = repositories.create
    body = JSON.generate(push_payload(repository:))

    build = process_webhook(configuration:, body:, event: "push")
    repeated = process_webhook \
      configuration:, body:, event: "push", delivery_id: "delivery-2"

    assert_equal build, repeated
    assert_equal "prototype/welcome", build.prototype.branch_name
    assert_equal "b" * 40, build.commit_sha
    assert_enqueued_with(job: Build::RecordCommitAuthorJob, args: [ build ])
    assert_equal 2, WebhookDelivery.count
    assert WebhookDelivery.all.all?(&:processed?)
  end

  test "a deletion push retires a confirmed absent branch but ignores a delayed deletion after recreation" do
    configuration = installed_configuration
    repository = repositories.create
    current = repository.build_discoveries.record!(
      branch_name: "prototype/welcome", commit_sha: "b" * 40, branch_head: true
    )
    current.prototype.register!(name: "Welcome")
    stub_installation_token
    stub_request(:get, "https://api.github.com/repos/#{repository.github_path}/branches?per_page=100&page=1")
      .to_return(status: 200, body: "[]")
    reference = stub_request(:get, "https://api.github.com/repos/#{repository.github_path}/git/ref/heads/prototype/welcome")
      .to_return(status: 404, body: "{}")
    stub_request(:get, "https://api.github.com/repos/#{repository.github_path}")
      .to_return(status: 200, body: JSON.generate(id: repository.github_id))
    deleted = JSON.generate(push_payload(repository:).merge("deleted" => true, "after" => "0" * 40))

    assert_nil process_webhook(configuration:, body: deleted, event: "push")
    assert current.prototype.reload.branch_deleted_at
    assert_predicate current.prototype, :registered?
    reference.to_return(status: 200, body: JSON.generate(
      ref: "refs/heads/prototype/welcome", object: { type: "commit", sha: current.commit_sha }
    ))
    recreated = process_webhook(
      configuration:, body: JSON.generate(push_payload(repository:)), event: "push", delivery_id: "recreated"
    )
    assert_equal current, recreated
    assert_nil current.prototype.reload.branch_deleted_at

    assert_nil process_webhook(configuration:, body: deleted, event: "push", delivery_id: "delayed-deletion")
    assert_nil current.prototype.reload.branch_deleted_at
    assert_equal 1, repository.prototypes.count
  end

  test "a historical push cannot advance a replacement generation" do
    configuration = installed_configuration
    repository = repositories.create
    old = repository.build_discoveries.record!(
      branch_name: "prototype/welcome", commit_sha: "b" * 40, branch_head: true
    )
    repository.branch_presence.record_missing!(
      branch_name: "prototype/welcome", observed: repository.branch_presence.observations.fetch("prototype/welcome")
    )
    replacement = prototypes.create(repository:, branch_name: "prototype/welcome")
    head = builds.create(prototype: replacement, commit_sha: "c" * 40)
    replacement.update!(current_build: head)
    stub_installation_token
    stub_request(:get, "https://api.github.com/repos/#{repository.github_path}/git/ref/heads/prototype/welcome")
      .to_return(status: 200, body: JSON.generate(
        ref: "refs/heads/prototype/welcome", object: { type: "commit", sha: head.commit_sha }
      ))

    delivered = process_webhook(configuration:, body: JSON.generate(push_payload(repository:)), event: "push")

    assert_equal old, delivered
    assert_equal head, replacement.reload.current_build
    assert_equal [ "c" * 40 ], replacement.builds.pluck(:commit_sha)
    assert old.prototype.reload.branch_deleted_at
    assert_equal old, old.prototype.current_build
    assert_equal "a" * 40, old.reload.previous_commit_sha
  end

  test "a delayed push for a reused SHA cannot change the new generation's predecessor" do
    configuration = installed_configuration
    repository = repositories.create
    old = repository.build_discoveries.record!(
      branch_name: "prototype/welcome", commit_sha: "b" * 40, branch_head: true
    )
    repository.branch_presence.record_missing!(
      branch_name: "prototype/welcome", observed: repository.branch_presence.observations.fetch("prototype/welcome")
    )
    replacement = prototypes.create(repository:, branch_name: "prototype/welcome")
    head = builds.create(prototype: replacement, commit_sha: "b" * 40)
    replacement.update!(current_build: head)
    stub_installation_token
    stub_request(:get, "https://api.github.com/repos/#{repository.github_path}/git/ref/heads/prototype/welcome")
      .to_return(status: 200, body: JSON.generate(
        ref: "refs/heads/prototype/welcome", object: { type: "commit", sha: head.commit_sha }
      ))

    assert_equal head, process_webhook(configuration:, body: JSON.generate(push_payload(repository:)), event: "push")
    assert_nil head.reload.previous_commit_sha
    assert old.prototype.reload.branch_deleted_at
  end

  test "an active force push to a retained commit supersedes its queued predecessor" do
    configuration = installed_configuration
    repository = repositories.create
    retired = repository.build_discoveries.record! \
      branch_name: "prototype/welcome",
      commit_sha: "a" * 40,
      branch_head: true
    repository.branch_presence.record_missing! \
      branch_name: "prototype/welcome",
      observed: repository.branch_presence.observations.fetch("prototype/welcome")
    replacement = prototypes.create(repository:, branch_name: "prototype/welcome")
    predecessor = repository.build_discoveries.record! \
      branch_name: "prototype/welcome",
      commit_sha: "b" * 40,
      branch_head: true
    stub_installation_token
    stub_request(:get, "https://api.github.com/repos/#{repository.github_path}/git/ref/heads/prototype/welcome")
      .to_return \
        status: 200,
        body: JSON.generate(ref: "refs/heads/prototype/welcome", object: { type: "commit", sha: retired.commit_sha })
    payload = push_payload(repository:).merge \
      "before" => predecessor.commit_sha,
      "after" => retired.commit_sha,
      "forced" => true
    body = JSON.generate(payload)

    pushed = process_webhook(configuration:, body:, event: "push")

    assert_equal replacement.id, pushed.prototype_id
    assert_equal pushed, replacement.reload.current_build
    assert_equal predecessor.commit_sha, pushed.previous_commit_sha
    assert_equal "superseded", predecessor.reload.state
    assert retired.prototype.reload.branch_deleted_at
  end

  test "an unseen historical push cannot change the replacement's commit ordering" do
    configuration = installed_configuration
    repository = repositories.create
    original = repository.build_discoveries.record! \
      branch_name: "prototype/welcome",
      commit_sha: "a" * 40,
      branch_head: true
    repository.branch_presence.record_missing! \
      branch_name: "prototype/welcome",
      observed: repository.branch_presence.observations.fetch("prototype/welcome")
    replacement = prototypes.create(repository:, branch_name: "prototype/welcome")
    head = repository.build_discoveries.record! \
      branch_name: "prototype/welcome",
      commit_sha: "b" * 40,
      branch_head: true
    stub_installation_token
    stub_request(:get, "https://api.github.com/repos/#{repository.github_path}/git/ref/heads/prototype/welcome")
      .to_return \
        status: 200,
        body: JSON.generate(ref: "refs/heads/prototype/welcome", object: { type: "commit", sha: head.commit_sha })

    delivered = process_webhook(configuration:, body: JSON.generate(push_payload(repository:)), event: "push")
    later = repository.build_discoveries.record! \
      branch_name: "prototype/welcome",
      commit_sha: original.commit_sha,
      branch_head: true

    assert_equal head, delivered
    assert_nil head.reload.previous_commit_sha
    assert_equal "queued", later.state
    assert_equal later, replacement.reload.current_build
    assert_equal [ "a" * 40 ], original.prototype.builds.pluck(:commit_sha)
  end

  test "a same-second workflow leaves both histories unchanged and its delivery retryable" do
    configuration = installed_configuration
    repository = repositories.create
    original = repository.build_discoveries.record! \
      branch_name: "prototype/welcome",
      commit_sha: "a" * 40,
      branch_head: true
    travel_to Time.iso8601("2026-10-12T19:00:00.200Z"), with_usec: true do
      repository.branch_presence.record_missing! \
        branch_name: "prototype/welcome",
        observed: repository.branch_presence.observations.fetch("prototype/welcome")
    end
    replacement = prototypes.create(repository:, branch_name: "prototype/welcome")
    head = repository.build_discoveries.record! \
      branch_name: "prototype/welcome",
      commit_sha: "b" * 40,
      branch_head: true
    payload = workflow_run_payload(repository:)
    payload.fetch("workflow_run")["created_at"] = "2026-10-12T19:00:00Z"
    saved_builds = Build.order(:id).map(&:attributes)

    error = assert_raises(GithubClient::Error) do
      process_webhook(configuration:, body: JSON.generate(payload), event: "workflow_run")
    end

    assert_match(/creation time overlaps branch retirement/, error.message)
    assert_equal saved_builds, Build.order(:id).map(&:attributes)
    assert_equal head, replacement.reload.current_build
    assert original.prototype.reload.branch_deleted_at
    assert_not WebhookDelivery.sole.processed?
    assert_nil WebhookDelivery.sole.processing_started_at
  end

  test "a stale reused-commit push cannot claim predecessor evidence from a newer head" do
    configuration = installed_configuration
    repository = repositories.create
    retired = repository.build_discoveries.record! \
      branch_name: "prototype/welcome",
      commit_sha: "a" * 40,
      branch_head: true
    repository.branch_presence.record_missing! \
      branch_name: "prototype/welcome",
      observed: repository.branch_presence.observations.fetch("prototype/welcome")
    replacement = prototypes.create(repository:, branch_name: "prototype/welcome")
    predecessor = repository.build_discoveries.record! \
      branch_name: "prototype/welcome",
      commit_sha: "b" * 40,
      branch_head: true
    newer = nil
    stub_installation_token
    stub_request(:get, "https://api.github.com/repos/#{repository.github_path}/git/ref/heads/prototype/welcome")
      .to_return do
        newer = repository.build_discoveries.record! \
          branch_name: "prototype/welcome",
          commit_sha: "c" * 40,
          branch_head: true
        {
          status: 200,
          body: JSON.generate(ref: "refs/heads/prototype/welcome", object: { type: "commit", sha: retired.commit_sha })
        }
      end
    payload = push_payload(repository:).merge \
      "before" => predecessor.commit_sha,
      "after" => retired.commit_sha

    pushed = process_webhook(configuration:, body: JSON.generate(payload), event: "push")

    assert_equal newer, replacement.reload.current_build
    assert_nil pushed.previous_commit_sha
    assert_equal "queued", predecessor.reload.state
  end

  test "an older recovered push stays in history without replacing a newer successful Build" do
    configuration = installed_configuration
    repository = repositories.create
    prototype = prototypes.create(repository:, branch_name: "prototype/welcome")
    current = builds.create_successful \
      prototype:, commit_sha: "c" * 40, previous_commit_sha: "b" * 40
    prototype.update!(current_build: current)
    track_recovery(configuration:)
    stub_installation_token
    depth = ApplicationRecord.connection.open_transactions
    request = stub_request(:get, "https://api.github.com/repos/#{repository.github_path}/git/ref/heads/prototype/welcome")
      .to_return do
        assert_equal depth, ApplicationRecord.connection.open_transactions
        { status: 200, body: JSON.generate(object: { sha: current.commit_sha }) }
      end

    recovered = process_webhook \
      configuration:, body: JSON.generate(push_payload(repository:)), event: "push"

    assert_equal "b" * 40, recovered.commit_sha
    assert_equal "superseded", recovered.state
    assert_equal current, prototype.reload.current_build
    assert_equal 0, prototype.head_observation_revision
    assert_equal "successful", current.reload.state
    assert WebhookDelivery.sole.processed?
    assert_equal "succeeded", WebhookRedelivery.sole.state
    assert_requested request, times: 1
  end

  test "a recovered push can become current when GitHub still reports that branch commit" do
    configuration = installed_configuration
    repository = repositories.create
    track_recovery(configuration:)
    stub_installation_token
    stub_request(:get, "https://api.github.com/repos/#{repository.github_path}/git/ref/heads/prototype/welcome")
      .to_return(status: 200, body: JSON.generate(object: { sha: "b" * 40 }))

    build = process_webhook \
      configuration:, body: JSON.generate(push_payload(repository:)), event: "push"

    assert_equal build, build.prototype.reload.current_build
    assert_equal 1, build.prototype.head_observation_revision
    assert_equal "succeeded", WebhookRedelivery.sole.state
  end

  test "recovered creation for a removed installation leaves its active replacement intact" do
    configuration = installed_configuration
    configuration.update!(installation_id: 789)
    track_recovery(configuration:, event: "installation", installation_id: 456)
    stub_github_app(configuration:)
    stub_request(:get, "https://api.github.com/app/installations/456")
      .to_return(status: 404, body: "{}")
    replacement = webhook_payload.fetch("installation").merge("id" => 789)
    stub_request(:get, "https://api.github.com/app/installations/789")
      .to_return(status: 200, body: JSON.generate(replacement))
    stub_github_installation_token(installation_id: 789)
    stub_github_repositories([])

    process_webhook(configuration:, body: JSON.generate(webhook_payload))
    assert_equal 789, configuration.reload.installation_id
    assert_equal "active", configuration.installation_state
    assert WebhookDelivery.sole.processed?
    assert_not_requested :post, "https://api.github.com/app/installations/456/access_tokens"

    installation_repositories = configuration.repositories
    installation_repositories.define_singleton_method(:synchronize!) do
      raise GithubClient::Error, "GitHub is temporarily unavailable"
    end
    configuration.define_singleton_method(:repositories) { installation_repositories }
    assert_raises(GithubClient::Error) { configuration.synchronize_repositories! }
    assert_equal 789, configuration.reload.installation_id
    assert_equal "active", configuration.installation_state
  end

  test "a deleted recovered branch stays in history without becoming current" do
    configuration = installed_configuration
    repository = repositories.create
    track_recovery(configuration:)
    stub_installation_token
    stub_request(:get, "https://api.github.com/repos/#{repository.github_path}/git/ref/heads/prototype/welcome")
      .to_return(status: 404, body: "{}")

    build = process_webhook \
      configuration:, body: JSON.generate(push_payload(repository:)), event: "push"

    assert_nil build.prototype.reload.current_build
    assert WebhookDelivery.sole.processed?
    assert_equal "succeeded", WebhookRedelivery.sole.state
  end

  test "a failed installation token is not mistaken for a deleted recovered branch" do
    configuration = installed_configuration
    repository = repositories.create
    track_recovery(configuration:)
    stub_request(:post, "https://api.github.com/app/installations/456/access_tokens")
      .to_return(status: 404, body: "{}")

    assert_raises(GithubClient::NotFound) do
      process_webhook \
        configuration:, body: JSON.generate(push_payload(repository:)), event: "push"
    end

    assert_empty Build.all
    assert_not WebhookDelivery.sole.processed?
    assert_equal "pending", WebhookRedelivery.sole.state
  end

  test "a legitimate recovered installation survives a later repository refresh failure" do
    configuration = installed_configuration
    configuration.update!(installation_state: "removed")
    payload = webhook_payload
    payload["installation"] = payload.fetch("installation").merge("id" => 789)
    track_recovery(configuration:, event: "installation", installation_id: 789)
    stub_github_app(configuration:)
    request = stub_github_account_installation \
      account: { id: 321, login: "github", type: "Organization" }, installation_id: 789
    installation_repositories = configuration.repositories
    installation_repositories.define_singleton_method(:synchronize!) do
      raise GithubClient::Error, "GitHub is temporarily unavailable"
    end
    configuration.define_singleton_method(:repositories) { installation_repositories }

    assert_raises(GithubClient::Error) do
      process_webhook(configuration:, body: JSON.generate(payload))
    end
    assert_requested request, times: 1
    assert_equal 789, configuration.reload.installation_id
    assert_equal "active", configuration.installation_state
    assert_not WebhookDelivery.sole.processed?
  end

  test "follows one workflow run across repeated signed deliveries" do
    configuration = installed_configuration
    repository = repositories.create
    requested_body = JSON.generate(workflow_run_payload(repository:, action: "requested"))
    completed_body = JSON.generate \
      workflow_run_payload(repository:, action: "completed", conclusion: "failure")

    build = process_webhook(configuration:, body: requested_body, event: "workflow_run")
    repeated = process_webhook \
      configuration:,
      body: completed_body,
      event: "workflow_run",
      delivery_id: "delivery-2"

    assert_equal build, repeated
    assert_equal "failed", build.reload.state
    assert_equal 2, WebhookDelivery.where(build:).count
  end

  test "ignores workflow runs for unknown repositories or workflows" do
    configuration = installed_configuration
    repository = repositories.create
    payloads = [
      workflow_run_payload(repository:).merge("repository" => { "id" => 9999, "default_branch" => "main" }),
      workflow_run_payload(repository:).tap do |payload|
        payload.fetch("workflow_run")["path"] = ".github/workflows/other.yml"
      end
    ]

    payloads.each_with_index do |payload, index|
      process_webhook \
        configuration:,
        body: JSON.generate(payload),
        event: "workflow_run",
        delivery_id: "workflow-ignored-#{index}"
    end

    assert_empty Build.all
  end

  test "replays one completed delivery without repeating its effect" do
    configuration = installed_configuration
    repository = repositories.create
    body = JSON.generate(push_payload(repository:))

    first = process_webhook(configuration:, body:, event: "push")
    replay = process_webhook(configuration:, body:, event: "push")

    assert_equal first, replay
    assert_equal 1, Build.count
    assert_equal 1, WebhookDelivery.count
  end

  test "releases a failed delivery for retry" do
    configuration = installed_configuration
    body = JSON.generate(push_payload(repository: repositories.create).except("after"))

    assert_raises(GithubWebhook::Rejected) do
      process_webhook(configuration:, body:, event: "push")
    end

    delivery = WebhookDelivery.find_by!(github_delivery_id: "delivery-1")
    assert_nil delivery.processing_started_at
    assert_not delivery.processed?
  end

  test "rejects a delivery ID reused with changed contents" do
    configuration = installed_configuration
    repository = repositories.create
    original = JSON.generate(push_payload(repository:))
    changed = JSON.generate(push_payload(repository:).merge("after" => "c" * 40))

    process_webhook(configuration:, body: original, event: "push")

    assert_raises(GithubWebhook::Rejected) do
      process_webhook(configuration:, body: changed, event: "push")
    end
  end

  test "ignores reserved branches tags deletions and unknown repositories" do
    configuration = installed_configuration
    repository = repositories.create
    payloads = [
      push_payload(repository:).merge("ref" => "refs/heads/replica/install-workflow"),
      push_payload(repository:).merge("ref" => "refs/tags/v1"),
      push_payload(repository:).merge("deleted" => true, "after" => "0" * 40),
      push_payload(repository:).merge("repository" => { "id" => 9999, "default_branch" => "main" })
    ]

    payloads.each_with_index do |payload, index|
      process_webhook \
        configuration:,
        body: JSON.generate(payload),
        event: "push",
        delivery_id: "ignored-#{index}"
    end

    assert_empty Build.all
    assert_equal 4, WebhookDelivery.where.not(processed_at: nil).count
  end

  test "records a default branch push using the immutable Build pipeline" do
    configuration = installed_configuration
    repository = repositories.create
    build = process_webhook \
      configuration:,
      body: JSON.generate(push_payload(repository:).merge("ref" => "refs/heads/main")),
      event: "push"

    assert_predicate build.prototype, :replica?
    assert_equal build, repository.replica_build_owner.current_build
    assert_equal "b" * 40, build.commit_sha
    assert_enqueued_jobs 0, only: Build::ImportStartPageJob
  end

  private

  def track_recovery(configuration:, event: "push", installation_id: 456)
    WebhookRedelivery.record_pending! \
      configuration:, guid: "delivery-1", event:, installation_id:,
      delivered_at: Time.current, attempt_id: 1234
  end

  def stub_installation_token
    stub_request(:post, "https://api.github.com/app/installations/456/access_tokens")
      .to_return \
        status: 201,
        body: JSON.generate(token: "installation-token", expires_at: 1.hour.from_now.iso8601)
  end

  def webhook(
    configuration:, body:, event: "installation", delivery_id: "delivery-1",
    signature: :generate
  )
    if signature == :generate
      signature = "sha256=#{OpenSSL::HMAC.hexdigest("SHA256", configuration.webhook_secret, body)}"
    end

    GithubWebhook.new(configuration:, body:, delivery_id:, event:, signature:)
  end

  def process_webhook(
    configuration:, body:, event: "installation", delivery_id: "delivery-1",
    signature: :generate
  )
    if signature == :generate
      signature = "sha256=#{OpenSSL::HMAC.hexdigest("SHA256", configuration.webhook_secret, body)}"
    end

    GithubWebhook.process!(configuration:, body:, delivery_id:, event:, signature:)
  end

  def installed_configuration
    github_app_configurations.create_installed
  end

  def push_payload(repository:)
    {
      "installation" => { "id" => 456 },
      "repository" => { "id" => repository.github_id, "default_branch" => "main" },
      "ref" => "refs/heads/prototype/welcome",
      "before" => "a" * 40,
      "after" => "b" * 40,
      "deleted" => false
    }
  end

  def workflow_run_payload(repository:, action: "in_progress", conclusion: nil)
    {
      "action" => action,
      "installation" => { "id" => 456 },
      "repository" => { "id" => repository.github_id, "default_branch" => "main" },
      "workflow_run" => {
        "id" => 9001,
        "run_attempt" => 1,
        "path" => ".github/workflows/replica.yml",
        "event" => "push",
        "head_branch" => "prototype/welcome",
        "head_sha" => "b" * 40,
        "status" => action == "requested" ? "queued" : action,
        "conclusion" => conclusion,
        "html_url" => "https://github.com/github/prototype/actions/runs/9001",
        "created_at" => "2026-09-17T18:00:00Z"
      }
    }
  end

  def webhook_payload
    {
      "action" => "created",
      "installation" => {
        "id" => 456,
        "app_id" => 123,
        "account" => {
          "id" => 321,
          "login" => "github",
          "type" => "Organization"
        }
      }
    }
  end
end
