require "test_helper"

class TaskConnectionTest < ActiveSupport::TestCase
  setup do
    seed "repositories/github_prototype"
    @repository = repositories.github_prototype
    @user = users.octocat
    @session = @user.sessions.create!
    stub_github_installation_token
    stub_github_permissions(
      [ repository_payload(@repository.github_id, @repository.name_with_owner) ],
      { @repository.github_id => "push" }
    )
  end

  test "consumes the private proof once and stores only credential digests" do
    connection, device_code = TaskConnection.start!(@repository, branch_name: "prototype/welcome")
    connection.approve!(@user, browser_session: @session)

    status, credentials = TaskConnection.consume(device_code)

    assert_equal "approved", status
    token = credentials.fetch(:accessToken)
    assert_match(/\Art_[A-Za-z0-9_-]{43}\z/, token)
    assert_equal Digest::SHA256.hexdigest(token), connection.reload.token_digest
    assert_nil connection.device_code_digest
    assert_not_includes connection.attributes.values.compact.join(" "), token
    event = SecurityAuditEvent.where(action: "task_connection.consume").last
    assert_nil event.user_id
    assert_equal connection.id, event.context.fetch("task_connection_id")
    assert_equal [ "expired", nil ], TaskConnection.consume(device_code)
    assert_equal connection, TaskConnection.authenticate(token)
    assert_nil TaskConnection.authenticate(device_code)
  end

  test "approval expiry is fixed from human approval and fails at its exact boundary" do
    connection, device_code = TaskConnection.start!(@repository, branch_name: "prototype/welcome")
    connection.approve!(@user, browser_session: @session)
    approved_at = connection.reload.approved_at
    assert_equal approved_at + 24.hours, connection.expires_at

    _, credentials = TaskConnection.consume(device_code)
    token = credentials.fetch(:accessToken)

    travel_to approved_at + 23.hours do
      assert_equal connection, TaskConnection.authenticate(token)
      assert_equal approved_at + 24.hours, connection.reload.expires_at
    end

    travel_to approved_at + 24.hours do
      stub_github_installation_token
      assert_nil TaskConnection.authenticate(token)
      assert_raises(TaskConnection::Unauthorized) do
        connection.with_publication_authorization! { flunk "expired credential was authorized" }
      end
    end
  end

  test "approval requires the approving human's persisted Session and cannot be reassigned" do
    connection, = TaskConnection.start!(@repository, branch_name: "prototype/welcome")
    another_session = users.mona.sessions.create!
    assert_raises(TaskConnection::Unauthorized) do
      connection.approve!(@user, browser_session: another_session)
    end

    connection.approve!(@user, browser_session: @session)
    assert_raises(ActiveRecord::RecordInvalid) do
      connection.update!(approving_user: users.mona)
    end
    assert_equal @user, connection.reload.approving_user
    deadline = connection.expires_at
    assert_raises(ActiveRecord::RecordInvalid) do
      connection.update!(expires_at: deadline + 1.hour)
    end
    assert_equal deadline, connection.reload.expires_at
  end

  test "publication authorization rejects a persisted revocation after the fresh writer lookup" do
    connection, token = approved_consumed_connection
    permission_url = "https://api.github.com/repos/#{@repository.github_path}/collaborators/octocat/permission"
    stub_request(:get, permission_url).to_return do
      TaskConnection.find(connection.id).update_columns(revoked_at: Time.current)
      {
        status: 200,
        body: JSON.generate(permission: "push", user: { id: @user.github_id }),
        headers: { "Content-Type" => "application/json" }
      }
    end

    assert_equal connection, TaskConnection.authenticate(token)
    assert_raises(TaskConnection::Unauthorized) do
      connection.with_publication_authorization! { flunk "revoked credential was authorized" }
    end
    assert_nil TaskConnection.authenticate(token)
  end

  test "denial cannot revoke a request that another browser already approved" do
    pending, = TaskConnection.start!(@repository, branch_name: "prototype/welcome")
    TaskConnection.find(pending.id).approve!(@user, browser_session: @session)

    assert_raises(TaskConnection::Unauthorized) do
      pending.revoke!(actor: users.mona, pending_only: true)
    end
    assert_nil pending.reload.revoked_at
    assert_equal @user, pending.approving_user
  end

  test "an approved connection cannot move to another branch or repository" do
    connection, = approved_consumed_connection
    another_repository = repositories.create(github_id: 2002, name_with_owner: "github/another")

    assert_raises(ActiveRecord::ReadonlyAttributeError) do
      connection.update!(branch_name: "prototype/another")
    end
    connection.reload
    assert_raises(ActiveRecord::ReadonlyAttributeError) do
      connection.update!(repository: another_repository)
    end
    assert_equal @repository, connection.reload.repository
    assert_equal "prototype/welcome", connection.branch_name
  end

  test "publication authorization distinguishes lost write access from a verification outage" do
    connection, = approved_consumed_connection
    repository_payload = repository_payload(@repository.github_id, @repository.name_with_owner)
    stub_github_permissions([ repository_payload ], { @repository.github_id => "pull" })
    assert_raises(TaskConnection::Forbidden) do
      connection.with_publication_authorization! { flunk "reader was authorized to publish" }
    end

    stub_github_permissions([ repository_payload ], { @repository.github_id => :failure })
    assert_raises(GithubClient::Error) do
      connection.with_publication_authorization! { flunk "unverified writer was authorized" }
    end
  end

  test "an approved proof cannot issue credentials at the exact request deadline" do
    connection, device_code = TaskConnection.start!(@repository, branch_name: "prototype/welcome")
    connection.approve!(@user, browser_session: @session)
    deadline = connection.reload.approval_expires_at
    consent_expires_at = connection.expires_at

    travel_to deadline, with_usec: true do
      assert_operator consent_expires_at, :>, Time.current
      assert_equal [ "expired", nil ], TaskConnection.consume(device_code)
      assert_nil connection.reload.consumed_at
      assert_nil connection.token_digest
      assert_equal consent_expires_at, connection.expires_at
    end
  end

  test "a global cutoff during the fresh writer lookup cannot authorize an old connection" do
    connection, token = approved_consumed_connection
    @user.update!(hub_admin: true)
    @session.update!(fresh_authorized_at: Time.current)
    permission_url = "https://api.github.com/repos/#{@repository.github_path}/collaborators/octocat/permission"
    stub_request(:get, permission_url).to_return do
      SessionRevocation.end_all!(actor: @user, browser_session: @session)
      {
        status: 200,
        body: JSON.generate(permission: "push", user: { id: @user.github_id }),
        headers: { "Content-Type" => "application/json" }
      }
    end

    assert_raises(SessionRevocation::Superseded) do
      connection.with_publication_authorization! { flunk "pre-cutoff connection was authorized" }
    end

    assert connection.reload.revoked_at
    assert_equal @user, connection.approving_user
    assert_equal @repository, connection.repository
    assert_equal "prototype/welcome", connection.branch_name
    assert_nil TaskConnection.authenticate(token)
    assert_not Session.exists?(@session.id)
  end

  test "cleanup removes expired requests and proofs but retains approved attribution" do
    expired_request, = TaskConnection.start!(@repository, branch_name: "prototype/welcome")
    unconsumed, device_code = TaskConnection.start!(@repository, branch_name: "prototype/welcome")
    unconsumed.approve!(@user, browser_session: @session)
    consumed, token = approved_consumed_connection
    original_digest = consumed.token_digest

    travel_to unconsumed.reload.expires_at + 1.second do
      current_request, = TaskConnection.start!(@repository, branch_name: "prototype/another")

      TaskConnection.clear_expired!

      assert_not TaskConnection.exists?(expired_request.id)
      assert TaskConnection.exists?(current_request.id)
      assert current_request.reload.device_code_digest
      assert_nil unconsumed.reload.device_code_digest
      assert_equal [ "expired", nil ], TaskConnection.consume(device_code)
      [ unconsumed, consumed ].each do |connection|
        assert_equal @user, connection.reload.approving_user
        assert_equal @repository, connection.repository
        assert_equal "prototype/welcome", connection.branch_name
        assert connection.approved_at
      end
      assert_equal original_digest, consumed.reload.token_digest
      assert_nil TaskConnection.authenticate(token)
    end
  end

  private

  def approved_consumed_connection
    connection, device_code = TaskConnection.start!(@repository, branch_name: "prototype/welcome")
    connection.approve!(@user, browser_session: @session)
    status, credentials = TaskConnection.consume(device_code)
    assert_equal "approved", status
    [ connection.reload, credentials.fetch(:accessToken) ]
  end
end
