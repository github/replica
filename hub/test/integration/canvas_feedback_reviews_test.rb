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

  test "confirms every repository reader with a fresh check for every request" do
    [ %w[read read], %w[read triage], %w[write write], %w[write maintain], %w[admin admin] ].each do |permission, role_name|
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

  test "Hub admin status does not grant access to another repository" do
    @viewer.update!(hub_admin: true)
    stub_github_permissions([ repository_payload(2001, "github/prototype") ], { 2001 => nil })

    post PATH, headers: @headers, as: :json

    assert_response :forbidden
  end

  test "a role demotion to read preserves review access but losing all access refuses it" do
    stub_role("write", "maintain")
    post PATH, headers: @headers, as: :json
    assert_response :success

    stub_role("read", "read")
    post PATH, headers: @headers, as: :json
    assert_response :success

    stub_github_permissions([ repository_payload(2001, "github/prototype") ], { 2001 => nil })
    post PATH, headers: @headers, as: :json

    assert_response :forbidden
  end

  test "refuses repository access GitHub reports for another stable user" do
    stub_role("read", "read", github_id: 9999)

    post PATH, headers: @headers, as: :json

    assert_response :forbidden
  end

  test "refuses a missing, revoked or lapsed connection and reports GitHub failures" do
    stub_role("read", "read")
    post PATH, as: :json
    assert_response :unauthorized

    stub_github_permissions([ repository_payload(2001, "github/prototype") ], { 2001 => nil })
    post PATH, headers: @headers, as: :json
    assert_response :forbidden

    stub_github_permissions([ repository_payload(2001, "github/prototype") ], { 2001 => :failure })
    post PATH, headers: @headers, as: :json
    assert_response :service_unavailable

    stub_role("read", "read")
    @grant.revoke!
    post PATH, headers: @headers, as: :json
    assert_response :unauthorized
  end

  test "advertises the capability to readers including triage without publishing access" do
    [ %w[read read], %w[read triage] ].each do |permission, role_name|
      Rails.cache.clear
      stub_role(permission, role_name)
      get canvas_api_connection_path, headers: @headers

      assert_response :success
      payload = JSON.parse(response.body)
      assert_equal false, payload.fetch("canPublish")
      assert_equal true, payload.fetch("canReviewFeedback")
    end
  end

  private

  def stub_role(permission, role_name, github_id: @viewer.github_id)
    stub_request(:get, "#{GithubRequestStubs::GITHUB_API_URL}/repos/github/prototype/collaborators/#{@viewer.login}/permission")
      .to_return \
        status: 200,
        body: JSON.generate(permission:, role_name:, user: { id: github_id }),
        headers: { "Content-Type" => "application/json" }
  end
end
