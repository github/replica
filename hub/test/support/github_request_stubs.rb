module GithubRequestStubs
  GITHUB_API_URL = "https://api.github.com"
  GITHUB_URL = "https://github.com"

  private

  # Checks the account-specific landing page while completing an already stubbed sign-in.
  def sign_in_to_hub(github_id: 1001)
    user = User.find_by(github_id:)
    expected_path = if user.nil? || (user.welcome_sign_in_pending? && !user.welcome_hidden?)
      welcome_path
    else
      repositories_path
    end
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    get github_authentication_callback_path, params: { code: "code", state: }
    assert_redirected_to expected_path
  end

  # Stubs the short-lived token shared by installation-authenticated requests.
  def stub_github_installation_token(installation_id: 456)
    stub_request(:post, "#{GITHUB_API_URL}/app/installations/#{installation_id}/access_tokens")
      .to_return \
        status: 201,
        body: JSON.generate(token: "installation-token", expires_at: 1.hour.from_now.iso8601),
        headers: { "Content-Type" => "application/json" }
  end

  # Stubs the new token Hub's GitHub App creates for each Copilot request, which may ask only for
  # the Copilot Requests organization permission. GitHub answers with each token in turn and repeats
  # the last, reporting the given permissions, or fails every request with error_status.
  def stub_github_copilot_token(*tokens, installation_id: 456, error_status: nil, error_body: nil,
    permissions: { organization_copilot_requests: "read" })
    request = stub_request(:post, "#{GITHUB_API_URL}/app/installations/#{installation_id}/access_tokens")
      .with(body: { permissions: { organization_copilot_requests: "read" } })
    if error_status
      body = error_body || { message: "Validation Failed" }
      return request.to_return(status: error_status, body: JSON.generate(body))
    end

    responses = tokens.map do |token|
      {
        status: 201,
        body: JSON.generate(token:, expires_at: 1.hour.from_now.iso8601, permissions:),
        headers: { "Content-Type" => "application/json" }
      }
    end
    request.to_return(*responses)
  end

  # The observed installation-token refusal when requested permissions were not granted.
  def github_copilot_permission_missing_error
    { message: "The permissions requested are not granted to this installation." }
  end

  # Stubs GitHub's OAuth exchange and stable user profile response.
  def stub_github_oauth_user(github_id: 1001, login: "octocat")
    stub_request(:post, "#{GITHUB_URL}/login/oauth/access_token")
      .with do |request|
        payload = JSON.parse(request.body)
        request.headers["Accept"] == "application/json" &&
          payload["code"] == "code" && payload["code_verifier"].present?
      end
      .to_return \
        status: 200,
        body: JSON.generate(access_token: "temporary-user-token"),
        headers: { "Content-Type" => "application/json" }
    stub_request(:get, "#{GITHUB_API_URL}/user")
      .with(headers: { "Authorization" => "Bearer temporary-user-token" })
      .to_return \
        status: 200,
        body: JSON.generate(id: github_id, login:, name: "Octocat", avatar_url: nil),
        headers: { "Content-Type" => "application/json" }
  end

  # Builds the repository shape returned by GitHub's installation APIs.
  def repository_payload(id, name)
    { "id" => id, "full_name" => name, "default_branch" => "main" }
  end

  # Stubs one page of the authoritative installation repository list.
  def stub_github_repositories(repositories)
    stub_request(:get, "#{GITHUB_API_URL}/installation/repositories")
      .with(query: { "page" => "1", "per_page" => "100" })
      .to_return \
        status: 200,
        body: JSON.generate(repositories:),
        headers: { "Content-Type" => "application/json" }
  end

  # Stubs effective collaborator permissions keyed by immutable repository ID.
  def stub_github_permissions(repositories, permissions, github_id: 1001, login: "octocat")
    repositories.each do |repository|
      permission = permissions.fetch(repository.fetch("id"))
      request = stub_request \
        :get,
        "#{GITHUB_API_URL}/repos/#{repository.fetch("full_name")}/collaborators/#{login}/permission"
      if permission == :failure
        request.to_timeout
      elsif permission.nil?
        request.to_return(status: 404, body: JSON.generate(message: "Not Found"))
      else
        request.to_return \
          status: 200,
          body: JSON.generate(permission:, user: { id: github_id }),
          headers: { "Content-Type" => "application/json" }
      end
    end

    # Defaults installed repositories to the onboarding state without a workflow.
    def stub_github_workflows(repositories)
      repositories.each do |repository|
        stub_request(
          :get,
          "#{GITHUB_API_URL}/repos/#{repository.fetch("full_name")}/contents/.github/workflows/replica.yml"
        )
          .with(query: { "ref" => repository.fetch("default_branch") })
          .to_return(status: 404, body: JSON.generate(message: "Not Found"))
      end
    end
  end

  # Stubs one exact commit and its associated GitHub author account.
  def stub_github_commit(repository, sha:, login: "octocat", github_id: 1001, avatar_url: nil)
    name_with_owner = if repository.respond_to?(:name_with_owner)
      repository.name_with_owner
    else
      repository.fetch("full_name")
    end
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{name_with_owner}/commits/#{sha}")
      .to_return \
        status: 200,
        body: JSON.generate(
          sha:,
          commit: { author: { name: "The Octocat" } },
          author: { id: github_id, login:, avatar_url: }
        ),
        headers: { "Content-Type" => "application/json" }
  end

  # Stubs a complete browser sign-in against GitHub's HTTP API.
  def stub_github_sign_in(repositories:, permissions:)
    stub_github_oauth_user
    stub_github_installation_token
    stub_github_repositories(repositories)
    stub_github_permissions(repositories, permissions)
    stub_github_workflows(repositories)
    repositories.each do |repository|
      stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.fetch("full_name")}/activity")
        .with(query: { "actor" => "octocat", "time_period" => "day", "direction" => "desc", "per_page" => "100" })
        .to_return(status: 200, body: "[]", headers: { "Content-Type" => "application/json" })
    end
  end
end
