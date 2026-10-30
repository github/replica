require "test_helper"
require "stringio"

class GithubClientTest < ActiveSupport::TestCase
  test "sends standard headers and decodes a JSON response" do
    request = stub_request(:get, "#{GITHUB_API_URL}/app")
      .with(headers: {
        "Accept" => "application/vnd.github+json",
        "Authorization" => "Bearer app-token",
        "User-Agent" => "replica-hub",
        "X-GitHub-Api-Version" => Rails.configuration.x.github_api_version
      })
      .to_return(status: 200, body: JSON.generate(id: 123))

    response = GithubClient.new.apps.get(token: "app-token")

    assert_equal 123, response.fetch("id")
    assert_requested request
  end

  test "accepts one explicit successful status" do
    stub_request(:post, "#{GITHUB_API_URL}/app-manifests/code/conversions")
      .to_return(status: 201, body: JSON.generate(id: 123))

    response = GithubClient.new.apps.manifest("code")

    assert_equal 123, response.fetch("id")
  end

  test "can return response headers for cursor pagination without changing ordinary requests" do
    link = %(<#{GITHUB_API_URL}/app?after=cursor>; rel="next")
    stub_request(:get, "#{GITHUB_API_URL}/app")
      .to_return(status: 200, body: JSON.generate(id: 123), headers: { "Link" => link })
    transport = GithubClient::Transport.new \
      base_url: GITHUB_API_URL,
      api_version: Rails.configuration.x.github_api_version

    assert_equal({ "id" => 123 }, transport.request(:get, "/app"))
    response = transport.request(:get, "/app", with_headers: true)
    assert_equal({ "id" => 123 }, response.fetch(:body))
    assert_equal [ link ], response.fetch(:headers).fetch("link")
  end

  test "rejects invalid or repeated activity pagination without forwarding credentials elsewhere" do
    repository = repositories.create
    user = users.create
    query = { "actor" => user.login, "time_period" => "day", "direction" => "desc", "per_page" => "100" }
    path = "/repos/#{repository.github_path}/activity"
    [ "#{GITHUB_API_URL}/repos/other/repository/activity?after=cursor",
      "#{GITHUB_API_URL}#{path}?#{URI.encode_www_form(query)}" ].each do |next_url|
      stub_request(:get, "#{GITHUB_API_URL}#{path}")
        .with(query:)
        .to_return(status: 200, body: "[]", headers: { "Link" => %(<#{next_url}>; rel="next") })

      assert_raises(GithubClient::InvalidResponse) do
        GithubClient.new.repositories.recent_activity(repository, user, token: "installation-token")
      end
    end
  end

  test "allows OAuth endpoints to request JSON" do
    request = stub_request(:post, "#{GITHUB_URL}/login/oauth/access_token")
      .with(headers: { "Accept" => "application/json" })
      .to_return(status: 200, body: JSON.generate(access_token: "token"))

    GithubClient.new.oauth.exchange_code \
      client_id: "client-id",
      client_secret: "client-secret",
      code: "code",
      redirect_uri: "https://hub.example.test/auth/github/callback",
      verifier: "verifier"

    assert_requested request
  end

  test "wraps transport failures" do
    stub_request(:get, "#{GITHUB_API_URL}/app").to_timeout

    error = assert_raises(GithubClient::Error) do
      GithubClient.new.apps.get(token: "app-token")
    end
    assert_includes error.message, "execution expired"
  end

  test "retains a structured GitHub error response without exposing it in the message" do
    response = {
      message: "Validation Failed",
      errors: [ { resource: "InstallationToken", code: "custom", field: "permissions" } ]
    }
    stub_request(:get, "#{GITHUB_API_URL}/app")
      .to_return(status: 422, body: JSON.generate(response))

    error = assert_raises(GithubClient::Error) do
      GithubClient.new.apps.get(token: "app-token")
    end

    assert_equal 422, error.status
    assert_equal response.deep_stringify_keys, error.response
    assert_equal "GitHub returned HTTP 422", error.message
  end

    test "OAuth rejection types never expose the provider response or supplied credentials" do
      [ "bad_verification_code", "access_denied", "incorrect_client_credentials", "unknown_error" ].each do |code|
        stub_request(:post, "#{GITHUB_URL}/login/oauth/access_token")
          .to_return(status: 200, body: JSON.generate(error: code, error_description: "private-response-secret"))
        error_class = code.in?(%w[bad_verification_code access_denied]) ? GithubClient::Forbidden : GithubClient::InvalidResponse
        error = assert_raises(error_class) do
          GithubClient.new.oauth.exchange_code \
            client_id: "client-id",
            client_secret: "private-client-secret",
            code: "private-oauth-code",
            redirect_uri: "https://hub.example.test/auth/github/callback",
            verifier: "private-verifier"
        end
        %w[private-response-secret private-client-secret private-oauth-code private-verifier].each do |secret|
          assert_not_includes error.message, secret
        end
      end
    end

  test "rejects invalid JSON" do
    stub_request(:get, "#{GITHUB_API_URL}/app").to_return(status: 200, body: "not json")

    assert_raises(GithubClient::InvalidResponse) do
      GithubClient.new.apps.get(token: "app-token")
    end
  end

  test "downloads without forwarding the token to the redirect" do
    repository = repositories.create
    redirect_url = "https://results.example.test/private/artifact.zip?signature=secret"
    stub_request(:get, "#{GITHUB_API_URL}/repos/github/prototype/actions/artifacts/8001/zip")
      .with(headers: { "Authorization" => "Bearer installation-token" })
      .to_return(status: 302, headers: { "Location" => redirect_url })
    redirected = stub_request(:get, redirect_url)
      .with { |request| request.headers["Authorization"].nil? }
      .to_return(status: 200, body: "package-bytes")
    destination = StringIO.new("".b)

    result = GithubClient.new.actions.download_artifact \
      repository,
      8001,
      token: "installation-token",
      destination: destination

    assert_equal "package-bytes", destination.string
    assert_equal 13, result.fetch(:bytes)
    assert_equal Digest::SHA256.hexdigest("package-bytes"), result.fetch(:sha256)
    assert_requested redirected
  end

  test "rejects a redirect without a host" do
    repository = repositories.create
    stub_request(:get, "#{GITHUB_API_URL}/repos/github/prototype/actions/artifacts/8001/zip")
      .to_return(status: 302, headers: { "Location" => "https:/artifact.zip" })

    assert_raises(GithubClient::InvalidResponse) do
      GithubClient.new.actions.download_artifact \
        repository,
        8001,
        token: "installation-token",
        destination: StringIO.new("".b)
    end
  end

  test "distinguishes rate limits, permission failures, and expired downloads" do
    repository = repositories.create
    responses = [
      [ 403, { body: JSON.generate(message: "secondary rate limit") }, GithubClient::RateLimited ],
      [ 403, { body: JSON.generate(message: "forbidden") }, GithubClient::Forbidden ],
      [ 410, {}, GithubClient::Gone ]
    ]
    responses.each do |status, options, error_class|
      stub_request(:get, "#{GITHUB_API_URL}/repos/github/prototype/actions/artifacts/8001/zip")
        .to_return({ status: }.merge(options))

      assert_raises(error_class) do
        GithubClient.new.actions.download_artifact \
          repository,
          8001,
          token: "installation-token",
          destination: StringIO.new("".b)
      end
    end
  end

  test "can limit a streamed download when the caller requires it" do
    repository = repositories.create
    stub_request(:get, "#{GITHUB_API_URL}/repos/github/prototype/actions/artifacts/8001/zip")
      .to_return(status: 200, body: "too-large")

    assert_raises(GithubClient::DownloadTooLarge) do
      GithubClient.new.actions.download_artifact \
        repository,
        8001,
        token: "installation-token",
        destination: StringIO.new("".b),
        maximum_bytes: 4
    end
  end

  test "uses the documented installation routes" do
    stub_request(:get, "#{GITHUB_API_URL}/app/installations/456")
      .to_return(status: 200, body: JSON.generate(id: 456))
    stub_request(:post, "#{GITHUB_API_URL}/app/installations/456/access_tokens")
      .to_return(status: 201, body: JSON.generate(token: "installation-token"))
    stub_request(:get, "#{GITHUB_API_URL}/installation/repositories")
      .with(query: { "page" => "1", "per_page" => "100" })
      .to_return(status: 200, body: JSON.generate(repositories: []))
    client = GithubClient.new.installations

    assert_equal 456, client.get(456, token: "app-token").fetch("id")
    assert_equal "installation-token", client.create_token(456, token: "app-token").fetch("token")
    assert_empty client.repositories(token: "installation-token")
  end

  test "uses the documented repository routes" do
    repository = repositories.create
    user = users.create
    stub_request(:get, "#{GITHUB_API_URL}/repos/github/prototype/collaborators/octocat/permission")
      .to_return(status: 200, body: JSON.generate(permission: "pull"))
    stub_request(:get, "#{GITHUB_API_URL}/repos/github/prototype/branches")
      .with(query: { "page" => "1", "per_page" => "100" })
      .to_return(status: 200, body: JSON.generate([]))
    commit_sha = "a" * 40
    stub_request(:get, "#{GITHUB_API_URL}/repos/github/prototype/commits/#{commit_sha}")
      .to_return(status: 200, body: JSON.generate(sha: commit_sha))
    stub_request(:get, "#{GITHUB_API_URL}/repos/github/prototype/contents/.github/workflows/replica.yml")
      .with(query: { "ref" => "main" })
      .to_return(status: 200, body: JSON.generate(content: "workflow"))
    stub_request(:get, "#{GITHUB_API_URL}/repos/github/prototype/git/ref/heads/replica/install-workflow")
      .to_return(status: 200, body: JSON.generate(object: { sha: commit_sha }))
    stub_request(
      :get,
      "#{GITHUB_API_URL}/repos/github/prototype/compare/main...replica%2Finstall-workflow"
    ).to_return(status: 200, body: JSON.generate(status: "ahead"))
    create_reference = stub_request(:post, "#{GITHUB_API_URL}/repos/github/prototype/git/refs")
      .with do |request|
        JSON.parse(request.body) == {
          "ref" => "refs/heads/replica/install-workflow",
          "sha" => commit_sha
        }
      end
      .to_return(status: 201, body: JSON.generate(ref: "refs/heads/replica/install-workflow"))
    create_file = stub_request \
      :put,
      "#{GITHUB_API_URL}/repos/github/prototype/contents/.github/workflows/replica.yml"
    create_file.with do |request|
      payload = JSON.parse(request.body)
      payload["message"] == "feat: add Replica workflow" &&
        payload["branch"] == "replica/install-workflow" &&
        Base64.strict_decode64(payload["content"]) == "workflow"
    end.to_return(status: 201, body: JSON.generate(content: { path: ".github/workflows/replica.yml" }))
    update_file = stub_request \
      :put,
      "#{GITHUB_API_URL}/repos/github/prototype/contents/.github/workflows/replica.yml"
    update_file.with do |request|
      payload = JSON.parse(request.body)
      payload["message"] == "chore: update Replica workflow" &&
        payload["branch"] == "replica/install-workflow" &&
        payload["sha"] == commit_sha &&
        Base64.strict_decode64(payload["content"]) == "updated workflow"
    end.to_return(status: 200, body: JSON.generate(content: { path: ".github/workflows/replica.yml" }))
    client = GithubClient.new.repositories

    assert_equal "pull", client.permission(repository, user, token: "installation-token").fetch("permission")
    assert_empty client.branches(repository, token: "installation-token")
    assert_equal commit_sha, client.commit(repository, commit_sha, token: "installation-token").fetch("sha")
    assert_equal \
      "workflow",
      client.content(
        repository,
        ".github/workflows/replica.yml",
        ref: "main",
        token: "installation-token"
      ).fetch("content")
    assert_equal \
      commit_sha,
      client.reference(
        repository,
        "replica/install-workflow",
        token: "installation-token"
      ).dig("object", "sha")
    assert_equal \
      "ahead",
      client.compare(
        repository,
        "main",
        "replica/install-workflow",
        token: "installation-token"
      ).fetch("status")
    client.create_reference \
      repository,
      "replica/install-workflow",
      commit_sha,
      token: "installation-token"
    client.create_file \
      repository,
      ".github/workflows/replica.yml",
      "workflow",
      branch: "replica/install-workflow",
      message: "feat: add Replica workflow",
      token: "installation-token"
    client.update_file \
      repository,
      ".github/workflows/replica.yml",
      "updated workflow",
      sha: commit_sha,
      branch: "replica/install-workflow",
      message: "chore: update Replica workflow",
      token: "installation-token"
    assert_requested create_reference
    assert_requested create_file
    assert_requested update_file
  end

  test "uses the documented pull request routes" do
    repository = repositories.create
    list = stub_request(:get, "#{GITHUB_API_URL}/repos/github/prototype/pulls")
      .with(query: {
        "base" => "main",
        "head" => "github:replica/install-workflow",
        "state" => "open"
      })
      .to_return(status: 200, body: JSON.generate([]))
    create = stub_request(:post, "#{GITHUB_API_URL}/repos/github/prototype/pulls")
      .with do |request|
        JSON.parse(request.body) == {
          "head" => "replica/install-workflow",
          "base" => "main",
          "title" => "Add Replica workflow",
          "body" => "Adds the workflow."
        }
      end
      .to_return(status: 201, body: JSON.generate(number: 25))
    client = GithubClient.new.pull_requests

    assert_empty client.list_open \
      repository,
      head: "replica/install-workflow",
      base: "main",
      token: "installation-token"
    response = client.create \
      repository,
      head: "replica/install-workflow",
      base: "main",
      title: "Add Replica workflow",
      body: "Adds the workflow.",
      token: "installation-token"

    assert_equal 25, response.fetch("number")
    assert_requested list
    assert_requested create
  end

  test "uses the documented Actions routes and filters" do
    repository = repositories.create
    stub_request(:get, "#{GITHUB_API_URL}/repos/github/prototype/actions/workflows/replica.yml/runs")
      .with(query: { "event" => "push", "page" => "1", "per_page" => "100" })
      .to_return(status: 200, body: JSON.generate(workflow_runs: []))
    stub_request(:get, "#{GITHUB_API_URL}/repos/github/prototype/actions/runs/9001")
      .to_return(status: 200, body: JSON.generate(id: 9001))
    stub_request(:get, "#{GITHUB_API_URL}/repos/github/prototype/actions/runs/9001/artifacts")
      .with(query: { "name" => "replica-build-v1", "page" => "1", "per_page" => "100" })
      .to_return(status: 200, body: JSON.generate(artifacts: []))
    client = GithubClient.new.actions

    assert_empty client.workflow_runs(repository, token: "installation-token")
    assert_equal 9001, client.workflow_run(repository, 9001, token: "installation-token").fetch("id")
    artifacts = client.artifacts \
      repository, 9001, name: "replica-build-v1", token: "installation-token"
    assert_empty artifacts
  end

  test "uses the documented App webhook route" do
    request = stub_request(:patch, "#{GITHUB_API_URL}/app/hook/config")
      .with do |http_request|
        JSON.parse(http_request.body).slice("url", "secret") == {
          "url" => "https://hub.example.test/github/webhooks",
          "secret" => "replacement"
        }
      end
      .to_return(status: 200, body: JSON.generate(url: "https://hub.example.test/github/webhooks"))

    GithubClient.new.apps.update_webhook \
      url: "https://hub.example.test/github/webhooks",
      secret: "replacement",
      token: "app-token"

    assert_requested request
  end

  test "rejects a blank OAuth token" do
    stub_request(:post, "#{GITHUB_URL}/login/oauth/access_token")
      .to_return(status: 200, body: JSON.generate(access_token: ""))

    assert_raises(GithubClient::InvalidResponse) do
      GithubClient.new.oauth.exchange_code \
        client_id: "client-id",
        client_secret: "client-secret",
        code: "code",
        redirect_uri: "https://hub.example.test/auth/github/callback",
        verifier: "verifier"
    end
  end

  test "returns object profiles and rejects other response shapes as service failures" do
    profile = { "id" => 1002, "login" => "operator" }
    stub_request(:get, "#{GITHUB_API_URL}/user")
      .to_return(status: 200, body: JSON.generate(profile))
    assert_equal profile, GithubClient.new.oauth.user(token: "temporary-token")

    [ nil, [ "private-service-detail" ], 77, "private-service-detail" ].each do |payload|
      stub_request(:get, "#{GITHUB_API_URL}/user")
        .to_return(status: 200, body: JSON.generate(payload))
      error = assert_raises(GithubClient::InvalidResponse) do
        GithubClient.new.oauth.user(token: "temporary-token")
      end
      assert_equal "GitHub returned an invalid user profile", error.message
    end
  end
end
