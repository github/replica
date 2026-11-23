require "test_helper"

class TaskPrototypeRegistrationTest < ActiveSupport::TestCase
  setup do
    @user = users.create
    @session = @user.sessions.create!
    @repository = repositories.create
    @prototype = prototypes.create(repository: @repository, branch_name: "prototype/welcome")
    @build = builds.create_successful(prototype: @prototype, commit_sha: "a" * 40)
    @prototype.update!(current_build: @build)

    github_app_configurations.create_installed
    stub_github_installation_token
    stub_permissions(@repository)
  end

  test "registers the successful pinned Build once and preserves the task registrant on exact retries" do
    connection = approved_connection
    head = @build.commit_sha
    @prototype.update!(description: "Saved details", start_page: "/settings")
    start_page_set_at = @prototype.start_page_set_at
    WebMock.reset_executed_requests!

    result = with_remote_head(head) do
      Current.set(session: @session) do
        @prototype.register_from_task_connection!(connection:, commit_sha: head)
      end
    end

    assert_equal "ready", result.fetch(:status)
    assert_equal @repository.github_id, result.fetch(:repositoryGitHubId)
    assert_equal @prototype.id, result.fetch(:prototypeId)
    assert_equal @prototype.branch_name, result.fetch(:branch)
    assert_equal head, result.fetch(:commitSha)
    assert_equal @build.id, result.fetch(:buildId)
    assert_equal @build.number, result.fetch(:buildNumber)
    assert_equal @build.github_workflow_run_id, result.fetch(:runId)
    assert_equal @build.github_workflow_run_attempt, result.fetch(:runAttempt)
    assert_equal @build.github_artifact_id, result.fetch(:artifactId)
    assert_equal true, result.fetch(:registered)
    assert_equal "created", result.fetch(:registration)
    expected_url = "#{Rails.configuration.x.hub_origin.delete_suffix('/')}#{Rails.application.routes.url_helpers.repository_prototype_path(@repository.route_id, @prototype, build: @build.number)}"
    assert_equal expected_url, result.fetch(:url)

    registered_at = @prototype.reload.registered_at
    event_count = Analytics::Event.where(name: "prototype_registered").count
    assert_nil @prototype.author
    assert_equal connection.id, @prototype.registration_task_connection_id
    assert_equal @prototype.branch_name, @prototype.name
    assert_equal "Saved details", @prototype.description
    assert_equal "/settings", @prototype.start_page
    assert_equal start_page_set_at, @prototype.start_page_set_at
    event = Analytics::Event.find_by!(name: "prototype_registered")
    assert_equal Analytics.actor_id(task_connection: connection), event.actor_id
    assert_not_equal Analytics.actor_id(user: @user), event.actor_id
    audit = SecurityAuditEvent.find_by!(action: "task_connection.register")
    assert_nil audit.user_id
    assert_equal connection.id, audit.context.fetch("task_connection_id")
    assert_requested :get, permission_request_url, times: 1
    WebMock.reset_executed_requests!

    retry_result = with_remote_head(head) do
      @prototype.register_from_task_connection!(connection:, commit_sha: head)
    end

    assert_equal "ready", retry_result.fetch(:status)
    assert_equal "existing", retry_result.fetch(:registration)
    assert_equal registered_at, @prototype.reload.registered_at
    assert_equal connection.id, @prototype.registration_task_connection_id
    assert_nil @prototype.author
    assert_equal event_count, Analytics::Event.where(name: "prototype_registered").count
    assert_requested :get, permission_request_url, times: 1
  end

  test "a registered task waits for a followup Build and reuses its fixed consent when it succeeds" do
    connection = approved_connection
    approved_at = connection.approved_at
    expires_at = connection.expires_at
    with_remote_head(@build.commit_sha) do
      @prototype.register_from_task_connection!(connection:, commit_sha: @build.commit_sha)
    end
    registered_at = @prototype.reload.registered_at
    event = Analytics::Event.find_by!(name: "prototype_registered").attributes
    queued = builds.create(prototype: @prototype, number: 2, commit_sha: "b" * 40)
    @prototype.update!(current_build: queued)

    pending = with_remote_head(queued.commit_sha) do
      @prototype.register_from_task_connection!(connection:, commit_sha: queued.commit_sha)
    end

    assert_equal "pending", pending.fetch(:status)
    assert_equal "workflow", pending.fetch(:phase)
    assert_equal true, pending.fetch(:registered)

    travel_to approved_at + 23.hours do
      stub_github_installation_token
      queued.update! \
        state: "successful",
        started_at: Time.current,
        finished_at: Time.current,
        workflow_completed_at: Time.current,
        github_workflow_run_id: 50_002,
        github_workflow_run_attempt: 1,
        workflow_url: "https://github.com/#{@repository.name_with_owner}/actions/runs/50002",
        github_artifact_id: 60_002,
        artifact_prefix: "builds/#{queued.id}",
        artifact_bytes: 100

      ready = with_remote_head(queued.commit_sha) do
        @prototype.register_from_task_connection!(connection:, commit_sha: queued.commit_sha)
      end

      assert_equal "ready", ready.fetch(:status)
      assert_equal "existing", ready.fetch(:registration)
      assert_equal queued.id, ready.fetch(:buildId)
      assert_equal queued.commit_sha, ready.fetch(:commitSha)
      assert_equal registered_at, @prototype.reload.registered_at
      assert_equal connection.id, @prototype.registration_task_connection_id
      assert_nil @prototype.author
      assert_equal event, Analytics::Event.find_by!(name: "prototype_registered").attributes
      assert_equal 1, Analytics::Event.where(name: "prototype_registered").count
      assert_equal approved_at, connection.reload.approved_at
      assert_equal expires_at, connection.expires_at
    end
  end

  test "does not transfer a human registration to the task connection" do
    connection = approved_connection
    @prototype.register!(name: "Human title", description: "Saved by a reviewer", author: @user)
    saved = @prototype.reload.attributes
    event_count = Analytics::Event.where(name: "prototype_registered").count

    result = with_remote_head(@build.commit_sha) do
      @prototype.register_from_task_connection!(connection:, commit_sha: @build.commit_sha)
    end

    assert_equal "ready", result.fetch(:status)
    assert_equal "existing", result.fetch(:registration)
    assert_equal saved, @prototype.reload.attributes
    assert_nil @prototype.registration_task_connection_id
    assert_equal event_count, Analytics::Event.where(name: "prototype_registered").count
  end

  test "waits for the requested Build workflow and package import without registering" do
    connection = approved_connection
    queued = builds.create(prototype: @prototype, number: 2, commit_sha: "b" * 40)
    @prototype.update!(current_build: queued)

    workflow = with_remote_head(queued.commit_sha) do
      @prototype.register_from_task_connection!(connection:, commit_sha: queued.commit_sha)
    end

    assert_equal "pending", workflow.fetch(:status)
    assert_equal "workflow", workflow.fetch(:phase)
    assert_not @prototype.reload.registered?
    assert_nil @prototype.registration_task_connection_id

    queued.update! \
      state: "running",
      started_at: Time.current,
      github_workflow_run_id: 50_002,
      github_workflow_run_attempt: 1,
      workflow_created_at: Time.current,
      workflow_url: "https://github.com/#{@repository.name_with_owner}/actions/runs/50002",
      workflow_completed_at: Time.current

    importing = with_remote_head(queued.commit_sha) do
      @prototype.register_from_task_connection!(connection:, commit_sha: queued.commit_sha)
    end

    assert_equal "pending", importing.fetch(:status)
    assert_equal "import", importing.fetch(:phase)
    assert_not @prototype.reload.registered?
    assert_nil @prototype.registration_task_connection_id
  end

  test "reports a failed requested Build without registering it" do
    connection = approved_connection
    failed = builds.create(prototype: @prototype, number: 2, commit_sha: "b" * 40)
    failed.update!(state: "failed", started_at: Time.current, finished_at: Time.current, failure_summary: "Build failed")
    @prototype.update!(current_build: failed)

    result = with_remote_head(failed.commit_sha) do
      @prototype.register_from_task_connection!(connection:, commit_sha: failed.commit_sha)
    end

    assert_equal "failed", result.fetch(:status)
    assert_not @prototype.reload.registered?
    assert_nil @prototype.registration_task_connection_id
  end

  test "does not register an older Build after the remote branch moves to a newer Build" do
    connection = approved_connection
    newer = builds.create_successful(prototype: @prototype, number: 2, commit_sha: "b" * 40)
    @prototype.update!(current_build: newer)

    result = with_remote_head(newer.commit_sha) do
      @prototype.register_from_task_connection!(connection:, commit_sha: @build.commit_sha)
    end

    assert_equal "superseded", result.fetch(:status)
    assert_not @prototype.reload.registered?
    assert_nil @prototype.registration_task_connection_id
  end

  test "waits for head discovery when GitHub has advanced beyond the stable local head" do
    connection = approved_connection
    imported = builds.create_successful(prototype: @prototype, number: 2, commit_sha: "b" * 40)
    saved = @prototype.reload.attributes

    result = with_remote_head(imported.commit_sha) do
      @prototype.register_from_task_connection!(connection:, commit_sha: imported.commit_sha)
    end

    assert_equal "pending", result.fetch(:status)
    assert_equal "discovery", result.fetch(:phase)
    assert_equal "head_not_discovered", result.fetch(:reason)
    assert_equal saved, @prototype.reload.attributes
    assert_equal @build, @prototype.current_build
    assert_not @prototype.registered?
    assert_nil @prototype.registration_task_connection_id
    assert_not Analytics::Event.exists?(name: "prototype_registered")
    assert_not SecurityAuditEvent.exists?(action: "task_connection.register")
  end

  test "does not use branch-head evidence after the GitHub App credential identity changes during lookup" do
    connection = approved_connection
    configuration = GithubAppConfiguration.current
    build = @build

    with_current_head(lambda { |*_args, **_kwargs|
      configuration.update!(credential_revision: configuration.credential_revision + 1)
      build.commit_sha
    }) do
      assert_raises(GithubAppConfiguration::Superseded) do
        @prototype.register_from_task_connection!(connection:, commit_sha: @build.commit_sha)
      end
    end

    assert_not @prototype.reload.registered?
    assert_nil @prototype.registration_task_connection_id
    assert_not Analytics::Event.exists?(name: "prototype_registered")
  end

  test "does not use branch-head evidence after the GitHub App installation changes during lookup" do
    connection = approved_connection
    configuration = GithubAppConfiguration.current
    stub_github_installation_token(installation_id: configuration.installation_id + 1)
    build = @build

    with_current_head(lambda { |*_args, **_kwargs|
      configuration.update!(installation_id: configuration.installation_id + 1)
      build.commit_sha
    }) do
      assert_raises(GithubAppConfiguration::Superseded) do
        @prototype.register_from_task_connection!(connection:, commit_sha: @build.commit_sha)
      end
    end

    assert_not @prototype.reload.registered?
    assert_nil @prototype.registration_task_connection_id
    assert_not Analytics::Event.exists?(name: "prototype_registered")
  end

  test "rejects a head observation whose owner revision changes during remote lookup" do
    connection = approved_connection
    revision = @prototype.head_observation_revision
    prototype = @prototype

    with_current_head(lambda { |*_args, **_kwargs|
      prototype.update!(head_observation_revision: revision + 1)
      prototype.current_build.commit_sha
    }) do
      result = @prototype.register_from_task_connection!(connection:, commit_sha: @build.commit_sha)
      assert_equal "superseded", result.fetch(:status)
    end

    assert_equal revision + 1, @prototype.reload.head_observation_revision
    assert_not @prototype.registered?
  end

  test "does not retarget a replacement created while the remote reference is being checked" do
    connection = approved_connection
    original = @prototype
    repository = @repository
    build = @build
    prototype_records = prototypes
    replacement = nil

    with_current_head(lambda { |*_args, **_kwargs|
      original.update! \
        branch_deleted_at: Time.current,
        retired_head_sha: build.commit_sha,
        head_observation_revision: original.head_observation_revision + 1
      replacement = prototype_records.create(repository:, branch_name: original.branch_name)
      build.commit_sha
    }) do
      result = original.register_from_task_connection!(connection:, commit_sha: build.commit_sha)
      assert_equal "superseded", result.fetch(:status)
      assert_equal original.id, result.fetch(:prototypeId)
    end

    assert_not original.reload.registered?
    assert_not replacement.reload.registered?
    assert_nil replacement.registration_task_connection_id
  end

  test "database constraints reject mixed actors and task connections for another repository branch" do
    connection = approved_connection
    wrong_branch = approved_connection(branch_name: "prototype/other")
    other_repository = repositories.create(github_id: 2_002, name_with_owner: "github/other")
    stub_permissions(other_repository)
    wrong_repository = approved_connection(repository: other_repository)

    [ wrong_branch, wrong_repository ].each do |other|
      assert_raises(ActiveRecord::InvalidForeignKey) do
        @prototype.update_columns(registration_task_connection_id: other.id)
      end
      assert_nil @prototype.reload.registration_task_connection_id
    end

    assert_raises(ActiveRecord::StatementInvalid) do
      @prototype.update_columns(registration_task_connection_id: connection.id, author_id: @user.id)
    end
    assert_nil @prototype.reload.registration_task_connection_id
    assert_nil @prototype.author
  end

  test "the first task registrant cannot be replaced by a human or another task" do
    connection = approved_connection
    other_connection = approved_connection
    with_remote_head(@build.commit_sha) do
      @prototype.register_from_task_connection!(connection:, commit_sha: @build.commit_sha)
    end

    assert_raises(ActiveRecord::RecordInvalid) do
      @prototype.update!(registration_task_connection: other_connection)
    end
    @prototype.reload
    assert_raises(ActiveRecord::RecordInvalid) do
      @prototype.update!(registration_task_connection: nil, author: @user)
    end

    assert_equal connection.id, @prototype.reload.registration_task_connection_id
    assert_nil @prototype.author
  end

  test "registration and analytics roll back when the task registration audit cannot be saved" do
    connection = approved_connection
    original_audit = connection.method(:audit!)
    connection.define_singleton_method(:audit!) do |operation, **options|
      raise "audit unavailable" if operation == "register"

      original_audit.call(operation, **options)
    end

    assert_no_difference -> { Analytics::Event.where(name: "prototype_registered").count } do
      error = assert_raises(RuntimeError) do
        with_remote_head(@build.commit_sha) do
          @prototype.register_from_task_connection!(connection:, commit_sha: @build.commit_sha)
        end
      end
      assert_equal "audit unavailable", error.message
    end

    assert_not @prototype.reload.registered?
    assert_nil @prototype.registration_task_connection_id
    assert_nil @prototype.author
    assert_not SecurityAuditEvent.exists?(action: "task_connection.register")
  ensure
    connection.define_singleton_method(:audit!, original_audit) if original_audit
  end

  test "rejects a connection scoped to another repository or branch" do
    connection = approved_connection(branch_name: "prototype/other")

    assert_raises(TaskConnection::Forbidden) do
      with_remote_head(@build.commit_sha) do
        @prototype.register_from_task_connection!(connection:, commit_sha: @build.commit_sha)
      end
    end

    other_repository = repositories.create(github_id: 2_002, name_with_owner: "github/other")
    other_prototype = prototypes.create(repository: other_repository, branch_name: @prototype.branch_name)
    other_build = builds.create_successful(prototype: other_prototype, commit_sha: "c" * 40)
    other_prototype.update!(current_build: other_build)

    assert_raises(TaskConnection::Forbidden) do
      with_remote_head(other_build.commit_sha) do
        other_prototype.register_from_task_connection!(connection: approved_connection, commit_sha: other_build.commit_sha)
      end
    end

    assert_not @prototype.reload.registered?
    assert_not other_prototype.reload.registered?
  end

  test "rejects an excluded internal Prototype and an invalid commit SHA" do
    connection = approved_connection

    assert_raises(ActionController::BadRequest) do
      @prototype.register_from_task_connection!(connection:, commit_sha: "not-a-commit")
    end

    @prototype.update!(replica: true)
    result = @prototype.register_from_task_connection!(connection:, commit_sha: @build.commit_sha)

    assert_equal "blocked", result.fetch(:status)
    assert_equal "branch_not_reviewable", result.fetch(:reason)
    assert_not @prototype.reload.registered?
  end

  test "rejects a connection after its branch becomes the repository default" do
    connection = approved_connection
    @repository.update!(default_branch: @prototype.branch_name)

    assert_raises(TaskConnection::Forbidden) do
      with_remote_head(@build.commit_sha) do
        @prototype.register_from_task_connection!(connection:, commit_sha: @build.commit_sha)
      end
    end

    assert_not @prototype.reload.registered?
  end

  test "propagates expired, revoked, and lost-writer authorization" do
    expired = approved_connection
    travel_to expired.expires_at do
      stub_github_installation_token
      assert_raises(TaskConnection::Unauthorized) do
        with_remote_head(@build.commit_sha) do
          @prototype.register_from_task_connection!(connection: expired, commit_sha: @build.commit_sha)
        end
      end
    end

    revoked = approved_connection
    revoked.revoke!(actor: @user)
    assert_raises(TaskConnection::Unauthorized) do
      with_remote_head(@build.commit_sha) do
        @prototype.register_from_task_connection!(connection: revoked, commit_sha: @build.commit_sha)
      end
    end

    active = approved_connection
    stub_permissions(@repository, permission: "pull")
    assert_raises(TaskConnection::Forbidden) do
      with_remote_head(@build.commit_sha) do
        @prototype.register_from_task_connection!(connection: active, commit_sha: @build.commit_sha)
      end
    end

    assert_not @prototype.reload.registered?
  end

  test "propagates GitHub reference verification errors" do
    connection = approved_connection
    error = GithubClient::Error.new("GitHub unavailable")

    with_current_head(->(*) { raise error }) do
      raised = assert_raises(GithubClient::Error) do
        @prototype.register_from_task_connection!(connection:, commit_sha: @build.commit_sha)
      end
      assert_same error, raised
    end

    assert_not @prototype.reload.registered?
  end

  private

  def approved_connection(repository: @repository, branch_name: @prototype.branch_name)
    connection, device_code = TaskConnection.start!(repository, branch_name:)
    connection.approve!(@user, browser_session: @session)
    status, credentials = TaskConnection.consume(device_code)
    assert_equal "approved", status
    assert credentials.fetch(:accessToken)
    connection.reload
  end

  def stub_permissions(repository, permission: "push")
    payload = repository_payload(repository.github_id, repository.name_with_owner)
    stub_github_permissions(
      [ payload ],
      { repository.github_id => permission },
      github_id: @user.github_id,
      login: @user.login
    )
  end

  def permission_request_url
    "https://api.github.com/repos/#{@repository.github_path}/collaborators/#{@user.login}/permission"
  end

  def with_remote_head(sha, &block)
    with_current_head(->(*) { sha }, &block)
  end

  def with_current_head(resolver, &block)
    klass = Repository::BranchPresence
    original = klass.instance_method(:current_head)
    klass.define_method(:current_head, &resolver)
    block.call
  ensure
    klass.define_method(:current_head, original)
  end
end
