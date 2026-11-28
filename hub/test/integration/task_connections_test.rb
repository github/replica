require "test_helper"

class TaskConnectionsTest < ActionDispatch::IntegrationTest
  setup do
    host! "replica.localhost:19500"
    github_app_configurations.create_installed
    stub_github_sign_in \
      repositories: [ repository_payload(2001, "github/prototype") ],
      permissions: { 2001 => "admin" }
    sign_in_to_hub
    @repository = Repository.find_by!(github_id: 2001)
    stub_github_permissions(
      [ repository_payload(@repository.github_id, @repository.name_with_owner) ],
      { @repository.github_id => "admin" }
    )
  end

  test "approves one branch-scoped task credential with a fixed 24-hour lifetime" do
    post "/api/tasks/connections", params: {
      repository: "github/prototype", branch: "prototype/welcome"
    }, as: :json

    assert_response :created
    request_data = response.parsed_body
    assert_match(/\A[A-Za-z0-9_-]{43}\z/, request_data.fetch("deviceCode"))
    assert_equal "/tasks/approve/#{request_data.fetch("userCode")}", URI(request_data.fetch("verificationUrl")).path
    assert_equal 3, request_data.fetch("intervalSeconds")
    connection = TaskConnection.find_by!(user_code: request_data.fetch("userCode"))
    assert_equal "prototype/welcome", connection.branch_name
    assert_equal Digest::SHA256.hexdigest(request_data.fetch("deviceCode")), connection.device_code_digest
    assert_not_includes connection.attributes.values.compact.join(" "), request_data.fetch("deviceCode")

    post "/api/tasks/connections/token", params: {
      device_code: request_data.fetch("deviceCode")
    }, as: :json
    assert_response :success
    assert_equal "pending", response.parsed_body.fetch("status")

    get "/tasks/approve/#{connection.user_code}", as: :json
    assert_response :success
    assert_nil connection.reload.approved_at
    assert_nil connection.token_digest

    post "/tasks/approve/#{connection.user_code}"
    assert_response :see_other
    assert_equal User.find_by!(github_id: 1001), connection.reload.approving_user
    assert_nil connection.consumed_at
    approval_time = connection.approved_at
    assert_equal approval_time + 24.hours, connection.expires_at

    post "/api/tasks/connections/token", params: {
      device_code: request_data.fetch("deviceCode")
    }, as: :json
    assert_response :success
    credential = response.parsed_body
    assert_equal "approved", credential.fetch("status")
    assert_match(/\Art_[A-Za-z0-9_-]{43}\z/, credential.fetch("accessToken"))
    assert_equal connection.id, credential.fetch("connectionId")
    assert_equal "github/prototype", credential.fetch("repository")
    assert_equal "prototype/welcome", credential.fetch("branch")
    assert_equal approval_time.iso8601, credential.fetch("approvedAt")
    assert_equal (approval_time + 24.hours).iso8601, credential.fetch("expiresAt")
    assert_equal Digest::SHA256.hexdigest(credential.fetch("accessToken")), connection.reload.token_digest
    assert_not_includes connection.attributes.values.compact.join(" "), credential.fetch("accessToken")

    task_headers = task_authorization(credential.fetch("accessToken"))
    get "/api/tasks/connection", headers: task_headers
    assert_response :success
    assert_equal connection.id, response.parsed_body.fetch("id")
    assert_equal @repository.route_id, response.parsed_body.fetch("repositoryId")
    assert_equal "prototype/welcome", response.parsed_body.fetch("branch")

    travel_to approval_time + 23.hours do
      stub_github_installation_token
      get "/api/tasks/connection", headers: task_headers
      assert_response :success
      assert_equal approval_time + 24.hours, connection.reload.expires_at
    end

    travel_to approval_time + 24.hours do
      get "/api/tasks/connection", headers: task_headers
      assert_response :unauthorized
    end

    post "/api/tasks/connections/token", params: {
      device_code: request_data.fetch("deviceCode")
    }, as: :json
    assert_equal "expired", response.parsed_body.fetch("status")
  end

  test "a reader cannot approve a pending task connection" do
    connection, = start_task_connection
    stub_github_permissions(
      [ repository_payload(2001, "github/prototype") ],
      { 2001 => "pull" }
    )

    post "/tasks/approve/#{connection.user_code}"

    assert_response :forbidden
    assert_nil connection.reload.approved_at
    assert_nil connection.approving_user
  end

  test "a GitHub permission outage does not approve the pending request" do
    connection, = start_task_connection
    stub_github_permissions(
      [ repository_payload(2001, "github/prototype") ],
      { 2001 => :failure }
    )

    post "/tasks/approve/#{connection.user_code}"

    assert_response :service_unavailable
    assert_nil connection.reload.approved_at
    assert_nil connection.approving_user
  end

  test "sign-in returns a signed-out browser to the specific task approval" do
    connection, = start_task_connection
    delete session_path

    get "/tasks/approve/#{connection.user_code}"
    assert_redirected_to root_path

    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    get github_authentication_callback_path, params: { code: "code", state: state }
    assert_redirected_to "/tasks/approve/#{connection.user_code}"
  end

  test "another signed-in user cannot revoke the approving user's task connection" do
    connection, = approved_task_connection
    get "/tasks/connections", as: :json
    assert_response :success
    assert_equal connection.id, response.parsed_body.fetch("data").fetch("grants").sole.fetch("id")

    other_browser = open_session
    stub_github_oauth_user(github_id: 1002, login: "mona")
    stub_github_installation_token
    payload = repository_payload(2001, "github/prototype")
    stub_github_repositories([ payload ])
    stub_github_permissions([ payload ], { 2001 => "admin" }, github_id: 1002, login: "mona")
    stub_github_workflows([ payload ])
    other_browser.post github_authentication_path
    state = Rack::Utils.parse_query(URI(other_browser.response.location).query).fetch("state")
    other_browser.get github_authentication_callback_path, params: { code: "code", state: state }
    other_browser.get "/tasks/connections", as: :json
    assert_equal 200, other_browser.response.status
    assert_empty other_browser.response.parsed_body.fetch("data").fetch("grants")

    other_browser.delete "/tasks/connections/#{connection.id}"

    assert_equal 404, other_browser.response.status
    assert_nil connection.reload.revoked_at

    delete "/tasks/connections/#{connection.id}"
    assert_response :see_other
    assert connection.reload.revoked_at
  end

  test "connection list follows the approval redemption deadline" do
    with_task_connection_deadlines do |expected_ids|
      get "/tasks/connections", as: :json
      assert_response :success
      ids = response.parsed_body.fetch("data").fetch("grants").map { _1.fetch("id") }
      assert_equal expected_ids.sort, ids.sort
    end
  end

  test "session revocation count follows the approval redemption deadline" do
    User.find_by!(github_id: 1001).update!(hub_admin: true)
    with_task_connection_deadlines do |expected_ids|
      get session_revocation_path, as: :json
      assert_response :success
      assert_equal I18n.t("session_revocation.counts",
        browsers: 1, canvases: 0, tasks: expected_ids.size, pairings: 0),
        response.parsed_body.fetch("data").fetch("counts")
    end
  end

  test "a browser can deny a pending task without issuing a credential" do
    connection, device_code = start_task_connection

    delete "/tasks/approve/#{connection.user_code}"

    assert_response :see_other
    assert connection.reload.revoked_at
    assert_nil connection.approved_at
    assert_nil connection.token_digest
    post "/api/tasks/connections/token", params: { device_code: device_code }, as: :json
    assert_equal "expired", response.parsed_body.fetch("status")
    assert_not response.parsed_body.key?("accessToken")
  end

  test "task API authorization does not assign the human approver as its current user" do
    connection, token = approved_task_connection
    observed_user = :unset
    permission_url = "https://api.github.com/repos/#{@repository.github_path}/collaborators/octocat/permission"
    stub_request(:get, permission_url).to_return do
      observed_user = Current.user
      {
        status: 200,
        body: JSON.generate(permission: "admin", user: { id: 1001 }),
        headers: { "Content-Type" => "application/json" }
      }
    end

    get "/api/tasks/connection", headers: task_authorization(token)

    assert_response :success
    assert_nil observed_user
    assert_equal User.find_by!(github_id: 1001), connection.reload.approving_user
  end

  test "explicit revocation and expiry both deny a consumed task credential" do
    connection, token = approved_task_connection
    headers = task_authorization(token)

    delete "/api/tasks/connection", headers: headers
    assert_response :no_content
    assert connection.reload.revoked_at
    assert_equal User.find_by!(github_id: 1001), connection.approving_user
    assert_equal @repository, connection.repository
    assert_equal "prototype/welcome", connection.branch_name
    get "/api/tasks/connection", headers: headers
    assert_response :unauthorized

    _, expired_token = approved_task_connection
    expired_connection = TaskConnection.order(:id).last
    travel_to expired_connection.expires_at do
      get "/api/tasks/connection", headers: task_authorization(expired_token)
      assert_response :unauthorized
    end
  end

  test "ending all Hub sessions cancels pending and approved task connections" do
    pending, device_code = start_task_connection
    approved, token = approved_task_connection
    actor = User.find_by!(github_id: 1001)
    session = actor.sessions.sole
    actor.update!(hub_admin: true)
    session.update!(fresh_authorized_at: Time.current)

    SessionRevocation.end_all!(actor: actor, browser_session: session)

    assert_not TaskConnection.exists?(pending.id)
    post "/api/tasks/connections/token", params: { device_code: device_code }, as: :json
    assert_equal "expired", response.parsed_body.fetch("status")
    assert approved.reload.revoked_at
    get "/api/tasks/connection", headers: task_authorization(token)
    assert_response :unauthorized
  end

  private

  def with_task_connection_deadlines
    now = Time.current.change(usec: 0)
    travel_to now - 25.hours
    approved_task_connection
    travel_to now
    unconsumed, = start_task_connection
    post "/tasks/approve/#{unconsumed.user_code}"
    assert_response :see_other
    consumed, = approved_task_connection
    revoked, = approved_task_connection
    delete "/tasks/connections/#{revoked.id}"
    assert_response :see_other

    [ [ unconsumed.approval_expires_at - 1.second, [ unconsumed.id, consumed.id ] ],
      [ unconsumed.approval_expires_at, [ consumed.id ] ] ].each do |time, expected_ids|
      travel_to time
      yield expected_ids
    end
  end

  def start_task_connection
    post "/api/tasks/connections", params: {
      repository: "github/prototype", branch: "prototype/welcome"
    }, as: :json
    assert_response :created
    data = response.parsed_body
    [ TaskConnection.find_by!(user_code: data.fetch("userCode")), data.fetch("deviceCode") ]
  end

  def approved_task_connection
    connection, device_code = start_task_connection
    post "/tasks/approve/#{connection.user_code}"
    assert_response :see_other
    post "/api/tasks/connections/token", params: { device_code: device_code }, as: :json
    assert_response :success
    assert_equal "approved", response.parsed_body.fetch("status")
    [ connection.reload, response.parsed_body.fetch("accessToken") ]
  end

  def task_authorization(token)
    { "Authorization" => [ "Bearer", token ].join(" ") }
  end
end
