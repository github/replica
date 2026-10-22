require "test_helper"

class CanvasFeedbackReviewsTest < ActionDispatch::IntegrationTest
  PATH = "/api/canvas/feedback_review".freeze

  setup do
    host! "replica.localhost:19500"
    github_app_configurations.create_installed
    stub_github_sign_in \
      repositories: [ repository_payload(2001, "github/prototype") ],
      permissions: { 2001 => "pull" }
    sign_in_to_hub
    @repository = Repository.find_by!(github_id: 2001)
    @viewer = User.find_by!(github_id: 1001)
    token = "rp_#{SecureRandom.urlsafe_base64(32)}"
    @grant = CanvasGrant.create! \
      repository: @repository, user: @viewer,
      token_digest: Digest::SHA256.hexdigest(token), expires_at: 7.days.from_now
    @headers = { "Authorization" => "Bearer #{token}" }
  end

  test "confirms a GitHub maintainer or admin with a fresh check for every request" do
    [ %w[write maintain], %w[admin admin] ].each do |permission, role_name|
      WebMock::RequestRegistry.instance.reset!
      stub = stub_role(permission, role_name)

      post PATH, headers: @headers, as: :json
      post PATH, headers: @headers, as: :json

      assert_response :success
      assert_equal "private, no-store", response.headers["Cache-Control"]
      assert_equal(
        { "repository" => "github/prototype", "canReviewFeedback" => true, "viewerLogin" => @viewer.login },
        JSON.parse(response.body)
      )
      assert_requested stub, times: 2
    end
  end

  test "Hub admin status does not raise lower repository access to maintainer" do
    @viewer.update!(hub_admin: true)
    [ %w[write write], %w[read triage], %w[read read] ].each do |permission, role_name|
      stub_role(permission, role_name)

      post PATH, headers: @headers, as: :json

      assert_response :forbidden, "#{permission}/#{role_name}"
    end
  end

  test "a maintainer demoted after an earlier confirmation is refused" do
    stub_role("write", "maintain")
    post PATH, headers: @headers, as: :json
    assert_response :success

    stub_role("write", "write")
    post PATH, headers: @headers, as: :json

    assert_response :forbidden
  end

  test "refuses a maintain role GitHub reports for another stable user" do
    stub_role("write", "maintain", github_id: 9999)

    post PATH, headers: @headers, as: :json

    assert_response :forbidden
  end

  test "refuses a missing, revoked or lapsed connection and reports GitHub failures" do
    stub_role("write", "maintain")
    post PATH, as: :json
    assert_response :unauthorized

    stub_github_permissions([ repository_payload(2001, "github/prototype") ], { 2001 => nil })
    post PATH, headers: @headers, as: :json
    assert_response :forbidden

    stub_github_permissions([ repository_payload(2001, "github/prototype") ], { 2001 => :failure })
    post PATH, headers: @headers, as: :json
    assert_response :service_unavailable

    stub_role("write", "maintain")
    @grant.revoke!
    post PATH, headers: @headers, as: :json
    assert_response :unauthorized
  end

  test "advertises the capability only to maintainers when the canvas reads its connection" do
    stub_role("write", "maintain")
    get canvas_api_connection_path, headers: @headers
    assert_equal true, JSON.parse(response.body).fetch("canReviewFeedback")

    stub_role("write", "write")
    get canvas_api_connection_path, headers: @headers
    payload = JSON.parse(response.body)
    assert_equal true, payload.fetch("canPublish")
    assert_equal false, payload.fetch("canReviewFeedback")
  end

  private

  # GitHub reports a maintainer's legacy permission as write and names the role separately.
  def stub_role(permission, role_name, github_id: @viewer.github_id)
    stub_request(:get, "#{GithubRequestStubs::GITHUB_API_URL}/repos/github/prototype/collaborators/#{@viewer.login}/permission")
      .to_return \
        status: 200,
        body: JSON.generate(permission:, role_name:, user: { id: github_id }),
        headers: { "Content-Type" => "application/json" }
  end
end
