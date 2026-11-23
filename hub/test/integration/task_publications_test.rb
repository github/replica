require "test_helper"

class TaskPublicationsTest < ActionDispatch::IntegrationTest
  setup do
    host! "replica.localhost:19500"
    github_app_configurations.create_installed
    stub_github_sign_in \
      repositories: [ repository_payload(2001, "github/prototype") ],
      permissions: { 2001 => "push" }
    sign_in_to_hub
    @repository = Repository.find_by!(github_id: 2001)
  end

  test "one branch approval registers exact imported Builds including later commits without extending consent" do
    connection, headers = connect_task
    deadline = connection.expires_at

    get "/api/tasks/prototype", headers: headers
    assert_response :success
    assert_equal({
      "repositoryGitHubId" => @repository.github_id,
      "branch" => "prototype/welcome",
      "prototypeId" => nil
    }, response.parsed_body)

    prototype = prototypes.create(repository: @repository, branch_name: connection.branch_name)
    build = builds.create_successful(prototype: prototype, commit_sha: "b" * 40)
    prototype.update!(current_build: build)
    stub_branch_head(prototype, build.commit_sha)

    get "/api/tasks/prototype", headers: headers
    assert_response :success
    assert_equal prototype.id, response.parsed_body.fetch("prototypeId")
    assert_not prototype.reload.registered?

    register_task(prototype, build.commit_sha, headers)

    assert_response :success
    assert_ready_build(prototype, build, registration: "created")
    assert prototype.reload.registered?
    registered_at = prototype.registered_at
    followup = builds.create_successful(prototype: prototype, number: 2, commit_sha: "c" * 40)
    prototype.update!(current_build: followup)
    stub_branch_head(prototype, followup.commit_sha)

    register_task(prototype, followup.commit_sha, headers)

    assert_response :success
    assert_ready_build(prototype, followup, registration: "existing")
    assert_equal registered_at, prototype.reload.registered_at
    assert_equal deadline, connection.reload.expires_at
    assert_equal 1, TaskConnection.count

    travel_to deadline do
      register_task(prototype, followup.commit_sha, headers)
      assert_response :unauthorized
    end

    delete "/api/tasks/connection", headers: headers
    assert_response :no_content
    register_task(prototype, followup.commit_sha, headers)
    assert_response :unauthorized
    assert_equal registered_at, prototype.reload.registered_at
  end

  test "browser sign-in and invalid credentials cannot authorize task lookup or registration" do
    prototype = prototypes.create(repository: @repository, branch_name: "prototype/welcome")

    [ {}, { "Authorization" => "Bearer invalid-task-credential" } ].each do |headers|
      get "/api/tasks/prototype", headers: headers
      assert_response :unauthorized
      register_task(prototype, "b" * 40, headers)
      assert_response :unauthorized
    end

    assert_not prototype.reload.registered?
  end

  test "a task cannot register another branch or another repository by supplying its prototype ID" do
    _, headers = connect_task
    approved_target = prototypes.create(repository: @repository, branch_name: "prototype/welcome")
    other_branch = prototypes.create(repository: @repository, branch_name: "prototype/another")
    other_repository = repositories.create(github_id: 2002, name_with_owner: "github/another")
    other_target = prototypes.create(repository: other_repository, branch_name: "prototype/welcome")

    [ other_branch, other_target ].each do |prototype|
      register_task(prototype, "b" * 40, headers)
      assert_response :not_found
      assert_not prototype.reload.registered?
    end

    put "/api/tasks/prototype/registration",
      params: { prototype_id: "#{approved_target.id}junk", commit_sha: "b" * 40 },
      headers: headers, as: :json
    assert_response :bad_request
    assert_not approved_target.reload.registered?
  end

  test "a completed workflow without an imported Build returns pending without registering" do
    _, headers = connect_task
    prototype = prototypes.create(repository: @repository, branch_name: "prototype/welcome")
    build = builds.create \
      prototype: prototype,
      commit_sha: "b" * 40,
      state: "running",
      started_at: Time.current,
      github_workflow_run_id: 9001,
      github_workflow_run_attempt: 1,
      workflow_url: "https://github.com/github/prototype/actions/runs/9001",
      workflow_completed_at: Time.current,
      github_artifact_id: 8001
    prototype.update!(current_build: build)
    stub_branch_head(prototype, build.commit_sha)

    register_task(prototype, build.commit_sha, headers)

    assert_response :success
    result = response.parsed_body
    assert_equal "pending", result.fetch("status")
    assert_equal "import", result.fetch("phase")
    assert result.fetch("reason").present?
    assert_equal false, result.fetch("registered")
    assert_equal @repository.github_id, result.fetch("repositoryGitHubId")
    assert_equal prototype.id, result.fetch("prototypeId")
    assert_equal prototype.branch_name, result.fetch("branch")
    assert_equal build.commit_sha, result.fetch("commitSha")
    assert_nil result["url"]
    assert_not prototype.reload.registered?
  end

  private

  def connect_task
    post "/api/tasks/connections", params: {
      repository: @repository.name_with_owner, branch: "prototype/welcome"
    }, as: :json
    assert_response :created
    request_data = response.parsed_body
    post URI(request_data.fetch("verificationUrl")).path
    assert_response :see_other
    post "/api/tasks/connections/token", params: {
      device_code: request_data.fetch("deviceCode")
    }, as: :json
    assert_response :success
    assert_equal "approved", response.parsed_body.fetch("status")
    connection = TaskConnection.find(response.parsed_body.fetch("connectionId"))
    headers = { "Authorization" => [ "Bearer", response.parsed_body.fetch("accessToken") ].join(" ") }
    [ connection, headers ]
  end

  def register_task(prototype, commit_sha, headers)
    put "/api/tasks/prototype/registration",
      params: { prototype_id: prototype.id, commit_sha: commit_sha },
      headers: headers, as: :json
  end

  def stub_branch_head(prototype, sha)
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{@repository.github_path}/git/ref/heads/#{prototype.branch_name}")
      .to_return \
        status: 200,
        body: JSON.generate(ref: "refs/heads/#{prototype.branch_name}", object: { type: "commit", sha: sha }),
        headers: { "Content-Type" => "application/json" }
  end

  def assert_ready_build(prototype, build, registration:)
    result = response.parsed_body
    assert_equal "ready", result.fetch("status")
    assert_equal registration, result.fetch("registration")
    assert_equal true, result.fetch("registered")
    assert_equal @repository.github_id, result.fetch("repositoryGitHubId")
    assert_equal prototype.id, result.fetch("prototypeId")
    assert_equal prototype.branch_name, result.fetch("branch")
    assert_equal build.commit_sha, result.fetch("commitSha")
    assert_equal build.id, result.fetch("buildId")
    assert_equal build.number, result.fetch("buildNumber")
    assert_equal build.github_workflow_run_id, result.fetch("runId")
    assert_equal build.github_workflow_run_attempt, result.fetch("runAttempt")
    assert_equal build.github_artifact_id, result.fetch("artifactId")
    assert_equal \
      "#{Rails.configuration.x.hub_origin.delete_suffix('/')}#{repository_prototype_path(@repository.github_id, prototype)}?build=#{build.number}",
      result.fetch("url")
    assert_not result.key?("accessToken")
  end
end
