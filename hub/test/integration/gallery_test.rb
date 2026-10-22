require "test_helper"

class GalleryTest < ActionDispatch::IntegrationTest
  setup do
    github_app_configurations.create_installed
  end

  test "opens the introduction only once per person and prototype across Builds and sign-ins" do
    repository, prototype = sign_in_and_create_prototype
    first = build_with_state(prototype, 1, "successful", "a", Time.current)
    second = build_with_state(prototype, 2, "successful", "b", Time.current)
    path = repository_prototype_path(repository.github_id, prototype, build: first.number)
    headers = { "Accept" => "application/json" }

    assert_difference "PrototypeIntroduction.count", 1 do
      get path, headers: headers
    end
    assert_response :success
    assert JSON.parse(response.body).fetch("data").fetch("showPrototypeInfo")

    assert_no_difference "PrototypeIntroduction.count" do
      get repository_prototype_path(repository.github_id, prototype, build: second.number), headers: headers
    end
    assert_response :success
    assert_not JSON.parse(response.body).fetch("data").fetch("showPrototypeInfo")

    delete session_path
    sign_in
    get path, headers: headers
    assert_response :success
    assert_not JSON.parse(response.body).fetch("data").fetch("showPrototypeInfo")

    other = prototypes.create(repository:, branch_name: "prototype/other")
    get repository_prototype_path(repository.github_id, other), headers: headers
    assert_response :success
    assert JSON.parse(response.body).fetch("data").fetch("showPrototypeInfo")
  end

  test "does not consume the introduction on minimized or invalid review requests" do
    repository, prototype = sign_in_and_create_prototype
    build_with_state(prototype, 1, "successful", "a", Time.current)
    path = repository_prototype_path(repository.github_id, prototype)
    headers = { "Accept" => "application/json" }

    assert_no_difference "PrototypeIntroduction.count" do
      get path, params: { view: "minimized" }, headers: headers
      assert_response :success
      assert_not JSON.parse(response.body).fetch("data").fetch("showPrototypeInfo")

      get path, params: { return_path: "//example.com" }, headers: headers
      assert_response :not_found

      get path, params: { build: 999 }, headers: headers
      assert_response :not_found
    end

    get path, headers: headers
    assert_response :success
    assert JSON.parse(response.body).fetch("data").fetch("showPrototypeInfo")
  end

  test "does not consume the introduction when rendering fails" do
    repository, prototype = sign_in_and_create_prototype
    build_with_state(prototype, 1, "successful", "a", Time.current)
    path = repository_prototype_path(repository.github_id, prototype)
    headers = { "Accept" => "application/json" }
    original = PreviewControlsHelper.instance_method(:preview_controls_identity)

    begin
      PreviewControlsHelper.define_method(:preview_controls_identity) do |*_args, **_kwargs|
        raise "Prototype information render failed"
      end

      assert_no_difference "PrototypeIntroduction.count" do
        error = assert_raises(ActionView::Template::Error) { get path, headers: headers }
        assert_includes error.message, "Prototype information render failed"
      end
    ensure
      PreviewControlsHelper.define_method(:preview_controls_identity, original)
    end

    get path, headers: headers
    assert_response :success
    assert JSON.parse(response.body).fetch("data").fetch("showPrototypeInfo")

    get path, headers: headers
    assert_response :success
    assert_not JSON.parse(response.body).fetch("data").fetch("showPrototypeInfo")
  end

  test "shows the same prototype introduction independently for another signed-in person" do
    repository, prototype = sign_in_and_create_prototype
    path = repository_prototype_path(repository.github_id, prototype)
    headers = { "Accept" => "application/json" }
    get path, headers: headers
    assert JSON.parse(response.body).fetch("data").fetch("showPrototypeInfo")

    delete session_path
    stub_github_oauth_user(github_id: 1002, login: "mona")
    stub_github_permissions \
      [ repository_payload(repository.github_id, repository.name_with_owner) ],
      { repository.github_id => "pull" },
      github_id: 1002,
      login: "mona"
    sign_in(github_id: 1002)

    get path, headers: headers
    assert_response :success
    assert JSON.parse(response.body).fetch("data").fetch("showPrototypeInfo")
    assert_equal 2, prototype.prototype_introductions.count

    get path, headers: headers
    assert_not JSON.parse(response.body).fetch("data").fetch("showPrototypeInfo")
  end

  test "includes the empty gallery heading and new prototype action" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "pull" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)

    get repository_path(repository.github_id), headers: { "Accept" => "application/json" }

    assert_response :success
    data = JSON.parse(response.body).fetch("data")
    assert_empty data.fetch("prototypes")
    assert_equal 0, data.fetch("listing").fetch("matchingCount")
    assert_equal 1, data.fetch("listing").fetch("page")
    assert_equal 1, data.fetch("listing").fetch("pageCount")
    assert_equal repository_path(repository.route_id), data.fetch("listing").fetch("pagePath")
    %w[previousPath nextPath newestPath].each do |key|
      assert_not data.fetch("listing").key?(key)
    end
    assert_equal "No prototypes yet", data.fetch("emptyHeading")
    assert_equal "Build prototype", data.fetch("buildPrototypeLabel")
    assert_equal repository_new_prototype_path(repository.github_id), data.fetch("newPrototypePath")
  end

  test "shows prototype cards with latest state and successful preview" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "pull" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:, branch_name: "prototype/welcome")
    prototype.register! \
      name: "Welcome",
      description: "Try the new welcome flow.",
      author: User.find_by!(github_id: 1001)
    build_with_state(prototype, 1, "successful", "a", Time.current)
    latest = build_with_state(prototype, 2, "running", "b", Time.current)
    latest.commit_author.record!(commit_payload(latest.commit_sha))
    other_prototype = prototypes.create(repository:, branch_name: "prototype/other")
    builds.create(prototype: other_prototype, number: 1, commit_sha: "c" * 40)

    get repository_path(repository.github_id)

    assert_response :success
    assert_includes response.body, "Welcome"
    assert_includes response.body, "Try the new welcome flow."
    assert_includes response.body, "prototype/welcome"
    assert_not_includes response.body, "prototype/other"
    assert_not_includes response.body, "buildCountLabel"
    assert_includes response.body, "Running"
    assert_includes response.body, "by @octocat"
    assert_includes response.body, '"ownerLabel":"@octocat"'
    assert_includes response.body, "https://github.com/octocat"
    assert_includes response.body, "screenshots/desktop"
    assert_not_includes response.body, "No successful preview is available."
  end

  test "shows newly registered prototypes first regardless of discovery order or later activity" do
    repository, newest = sign_in_and_create_prototype
    oldest = prototypes.create(repository:, branch_name: "prototype/a-oldest")
    middle = prototypes.create(repository:, branch_name: "prototype/z-middle")
    time = Time.current

    travel_to(time - 2.days) { oldest.register!(name: "Oldest") }
    travel_to(time - 1.day) { middle.register!(name: "Middle") }
    travel_to(time) { newest.register!(name: "Newest") }
    travel_to(time + 1.hour) do
      oldest.register!(name: "Oldest edited")
      build_with_state(oldest, 1, "successful", "a", Time.current)
    end

    get repository_path(repository.github_id), headers: { "Accept" => "application/json" }

    assert_response :success
    listed_ids = JSON.parse(response.body).fetch("data").fetch("prototypes").pluck("id")
    assert_equal [ newest, middle, oldest ].map { |prototype| prototype.id.to_s }, listed_ids
  end

  test "keeps prototype ordering deterministic when registration times match" do
    repository, first = sign_in_and_create_prototype
    second = prototypes.create(repository:, branch_name: "prototype/z-second")

    travel_to(Time.current) do
      first.register!(name: "First")
      second.register!(name: "Second")
    end

    get repository_path(repository.github_id), headers: { "Accept" => "application/json" }

    assert_response :success
    listed_ids = JSON.parse(response.body).fetch("data").fetch("prototypes").pluck("id")
    assert_equal [ second.id.to_s, first.id.to_s ], listed_ids
  end

  test "uses GitHub chronology when an older workflow is discovered later" do
    repository, prototype = sign_in_and_create_prototype
    prototype.register!(name: "Chronology", description: nil)
    newer_time = Time.iso8601("2026-09-17T18:00:00Z")
    older_time = Time.iso8601("2026-09-17T17:00:00Z")
    current = build_with_state(prototype, 1, "successful", "a", newer_time)
    current.update!(workflow_created_at: newer_time)
    prototype.update!(current_build: current)
    older = build_with_state(prototype, 2, "failed", "b", older_time)
    older.update! \
      github_workflow_run_id: older.id + 10_000,
      github_workflow_run_attempt: 1,
      workflow_url: "https://github.com/github/prototype/actions/runs/#{older.id + 10_000}",
      workflow_created_at: older_time

    get repository_path(repository.github_id)

    assert_response :success
    assert_includes response.body, "Successful"
    assert_includes \
      response.body,
      repository_prototype_build_screenshot_path(repository.github_id, prototype, current.number, "desktop")

    get repository_prototype_path(repository.github_id, prototype), as: :json

    assert_response :success
    assert_includes response.body, PreviewOrigin.current.url(current.id)
    assert_not JSON.parse(response.body).fetch("data").key?("newerBuildLabel")

    get repository_prototype_builds_path(repository.github_id, prototype)

    assert_response :success
    assert_operator response.body.index("build 1"), :<, response.body.index("build 2")
    assert_includes response.body, "Workflow created"
    assert_not_includes response.body, "Added to Hub"
  end

  test "shows prototype cards before any builds are discovered" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "pull" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototypes.create(repository:, branch_name: "prototype/empty")
      .register!(name: "Empty", description: nil)

    get repository_path(repository.github_id)

    assert_response :success
    assert_includes response.body, "prototype/empty"
    assert_not_includes response.body, "buildCountLabel"
    assert_includes response.body, "No successful preview is available."
  end

  test "shows newest Builds first with every persisted state in history" do
    repository, prototype = sign_in_and_create_prototype
    time = Time.current
    build_with_state(prototype, 1, "queued", "a", time)
    build_with_state(prototype, 2, "running", "b", time)
    build_with_state(prototype, 3, "failed", "c", time)
    build_with_state(prototype, 4, "superseded", "d", time)
    build_with_state(prototype, 5, "successful", "e", time)

    get repository_prototype_builds_path(repository.github_id, prototype)

    assert_response :success
    %w[Queued Running Failed Superseded Successful].each do |state|
      assert_includes response.body, state
    end
    assert_operator response.body.index("build 5"), :<, response.body.index("build 1")
  end

  test "includes repository navigation and review header data on Build history and details" do
    repository, prototype = sign_in_and_create_prototype
    successful = build_with_state(prototype, 1, "successful", "a", Time.current)
    failed = build_with_state(prototype, 2, "failed", "b", Time.current)

    get repository_prototype_builds_path(repository.github_id, prototype),
      headers: { "Accept" => "application/json" }

    assert_response :success
    history = JSON.parse(response.body).fetch("data")
    assert_equal repository.route_id.to_s, history.fetch("selectedRepositoryId")
    assert_equal repository_new_prototype_path(repository.github_id), history.fetch("newPrototypePath")
    assert_equal repository_path(repository.github_id), history.fetch("prototypesPath")
    assert_equal repository.route_id.to_s, history.fetch("repositories").first.fetch("id")
    assert_equal successful.number, history.fetch("selectedBuild").fetch("number")
    assert_equal \
      repository_prototype_path(repository.github_id, prototype),
      history.fetch("branchPath")
    assert_equal \
      repository_prototype_path(repository.github_id, prototype),
      history.fetch("closePath")
    assert_equal failed.number, history.fetch("latestBuild").fetch("number")
    assert_equal 2, history.fetch("buildOptions").size
    assert_not history.key?("shareLinksPath")
    assert_not history.key?("reviewComments")
    assert_not history.key?("reviewCommentsPath")
    assert_equal %w[detailsLabel detailsPath number], history.fetch("selectedBuild").keys.sort

    get repository_prototype_path(repository.github_id, prototype, build: successful.number),
      headers: { "Accept" => "application/json" }
    pinned_review = JSON.parse(response.body).fetch("data")
    pinned_history_path = repository_prototype_builds_path \
      repository.github_id,
      prototype,
      build: successful.number
    assert_equal pinned_history_path, pinned_review.fetch("historyPath")

    get pinned_history_path, headers: { "Accept" => "application/json" }
    pinned_history = JSON.parse(response.body).fetch("data")
    assert_equal successful.number, pinned_history.fetch("selectedBuild").fetch("number")
    assert_equal \
      repository_prototype_path(repository.github_id, prototype, build: successful.number),
      pinned_history.fetch("closePath")

    get repository_prototype_build_path(repository.github_id, prototype, successful.number),
      headers: { "Accept" => "application/json" }

    assert_response :success
    details = JSON.parse(response.body).fetch("data")
    assert_equal repository_new_prototype_path(repository.github_id), details.fetch("newPrototypePath")
    assert_equal successful.number, details.fetch("selectedBuild").fetch("number")
    assert_equal \
      repository_prototype_path(repository.github_id, prototype),
      details.fetch("branchPath")
    assert_equal \
      repository_prototype_path(repository.github_id, prototype, build: successful.number),
      details.fetch("closePath")
    assert_equal details.fetch("closePath"), details.fetch("previewPath")
    assert_equal %w[detailsLabel detailsPath number], details.fetch("selectedBuild").keys.sort

    get repository_prototype_build_path(repository.github_id, prototype, failed.number),
      headers: { "Accept" => "application/json" }

    assert_response :success
    failed_details = JSON.parse(response.body).fetch("data")
    assert_not failed_details.key?("selectedBuild")
    assert_equal failed.number, failed_details.fetch("latestBuild").fetch("number")
    assert_equal repository_prototype_path(repository.github_id, prototype),
      failed_details.fetch("closePath")
    assert_not failed_details.key?("reviewComments")
  end

  test "reviews the latest successful Build while showing a newer state" do
    repository, prototype = sign_in_and_create_prototype
    first = build_with_state(prototype, 1, "successful", "a", Time.current)
    selected = build_with_state(prototype, 2, "successful", "b", Time.current)
    selected.commit_author.record!(commit_payload(selected.commit_sha))
    build_with_state(prototype, 3, "failed", "c", Time.current)

    get repository_prototype_path(repository.github_id, prototype), as: :json

    assert_response :success
    assert_includes response.body, PreviewOrigin.current.url(selected.id)
    data = JSON.parse(response.body).fetch("data")
    assert_equal false, data.fetch("buildPinned")
    assert_equal repository_prototype_path(repository.github_id, prototype), data.fetch("branchPath")
    assert_equal "The latest update failed. You're viewing an earlier version.",
      JSON.parse(response.body).fetch("data").fetch("newerBuildLabel")
    assert_includes response.body, "Failed to build"
    assert_includes \
      response.body,
      repository_prototype_build_path(repository.github_id, prototype, 3)
    assert_includes response.body, "by @octocat"
    assert_includes response.body, "Collapse sidebar"
    assert_includes response.body, "Use dark theme"
    assert_includes response.body, "Close"
    assert_not_includes response.body, PreviewOrigin.current.url(first.id)

    get repository_prototype_builds_path(repository.github_id, prototype), as: :json
    assert_response :success
    assert_equal "The latest update failed. You're viewing an earlier version.",
      JSON.parse(response.body).fetch("data").fetch("newerBuildLabel")

    get repository_prototype_build_path(repository.github_id, prototype, selected.number), as: :json
    assert_response :success
    assert_equal "The latest update failed. You're viewing an earlier version.",
      JSON.parse(response.body).fetch("data").fetch("newerBuildLabel")
  end

  test "reloads the default view on the latest successful Build while explicit links stay pinned" do
    repository, prototype = sign_in_and_create_prototype
    selected = build_with_state(prototype, 1, "successful", "a", Time.current)
    default_path = repository_prototype_path(repository.github_id, prototype)
    pinned_path = repository_prototype_path(repository.github_id, prototype, build: selected.number)

    get default_path, as: :json
    assert_response :success
    data = JSON.parse(response.body).fetch("data")
    assert_equal selected.number, data.fetch("selectedBuild").fetch("number")
    assert_equal false, data.fetch("buildPinned")

    get pinned_path, as: :json
    assert_response :success
    assert_equal true, JSON.parse(response.body).fetch("data").fetch("buildPinned")

    latest = build_with_state(prototype, 2, "successful", "b", 1.minute.from_now)

    get default_path, as: :json
    assert_response :success
    data = JSON.parse(response.body).fetch("data")
    assert_equal latest.number, data.fetch("selectedBuild").fetch("number")
    assert_equal false, data.fetch("buildPinned")
    assert_includes data.fetch("selectedBuild").fetch("previewUrl"), PreviewOrigin.current.url(latest.id)

    get pinned_path, as: :json
    assert_response :success
    assert_includes response.body, PreviewOrigin.current.url(selected.id)
    assert_not_includes response.body, PreviewOrigin.current.url(latest.id)
    data = JSON.parse(response.body).fetch("data")
    assert_equal selected.number, data.fetch("selectedBuild").fetch("number")
    assert_equal true, data.fetch("buildPinned")
    assert_equal default_path, data.fetch("branchPath")
    assert_not data.key?("newerBuildLabel")
  end

  test "includes localized submit shortcuts for comments and replies" do
    repository, prototype = sign_in_and_create_prototype
    build_with_state(prototype, 1, "successful", "a", Time.current)

    get repository_prototype_path(repository.github_id, prototype),
      headers: { "Accept" => "application/json" }

    assert_response :success
    copy = JSON.parse(response.body).fetch("data").fetch("reviewComments").fetch("copy")
    assert_equal "Comment (Cmd+Return)", copy.fetch("submitTooltipMacLabel")
    assert_equal "Comment (Ctrl+Enter)", copy.fetch("submitTooltipOtherLabel")
    assert_equal "Reply (Cmd+Return)", copy.fetch("replySubmitTooltipMacLabel")
    assert_equal "Reply (Ctrl+Enter)", copy.fetch("replySubmitTooltipOtherLabel")
  end

  test "includes localized viewed-page prompt instructions and the actual initial preview destination" do
    repository, prototype = sign_in_and_create_prototype
    prototype.update!(start_page: "/settings?tab=profile#details")
    build = build_with_state(prototype, 1, "successful", "a", Time.current)

    get repository_prototype_path(repository.github_id, prototype), as: :json

    assert_response :success
    data = JSON.parse(response.body).fetch("data")
    assert_equal "Branch from here", data.fetch("forkLabel")
    assert_equal data.fetch("branchFromHereLabel"), data.fetch("forkLabel")
    assert_equal I18n.t("prototype_prompts.viewed_page", route: "%{route}"),
      data.fetch("branchPageInstructions")
    assert_equal "#{PreviewOrigin.current.url(build.id)}settings?tab=profile#details",
      data.fetch("selectedBuild").fetch("previewUrl")
    assert_equal prototype.branch_name, data.fetch("branchName")
    assert_equal I18n.t("prototypes.show.branch_instructions", branch: prototype.branch_name),
      data.fetch("branchInstructions")
  end

  test "shows share links to a successful Build author" do
    repository, prototype = sign_in_and_create_prototype
    build = build_with_state(prototype, 1, "successful", "a", Time.current)
    build.commit_author.record!(commit_payload(build.commit_sha))

    get repository_prototype_path(repository.github_id, prototype), as: :json

    assert_response :success
    data = JSON.parse(response.body).fetch("data")
    assert_equal \
      repository_prototype_share_links_path(repository.github_id, prototype),
      data.fetch("shareLinksPath")

    get repository_prototype_path(repository.github_id, prototype, build: build.number), as: :json
    assert_response :success
    assert_equal \
      repository_prototype_share_links_path(repository.github_id, prototype, build: build.number),
      JSON.parse(response.body).fetch("data").fetch("shareLinksPath")
  end

  test "offers detail editing only to a prototype author with write access" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:, branch_name: "prototype/owned")
    prototype.register!(name: "Owned", description: "Original description")
    build = build_with_state(prototype, 1, "successful", "a", Time.current)

    get repository_prototype_path(repository.github_id, prototype),
      headers: { "Accept" => "application/json" }
    assert_not JSON.parse(response.body).fetch("data").key?("detailsEditPath")

    build.commit_author.record!(commit_payload(build.commit_sha))
    get repository_prototype_path(repository.github_id, prototype),
      headers: { "Accept" => "application/json" }
    data = JSON.parse(response.body).fetch("data")
    assert_equal \
      repository_prototype_registration_path(repository.github_id, prototype),
      data.fetch("detailsEditPath")
    assert_equal "Edit details", data.fetch("editDetailsLabel")
    assert_equal 500, data.fetch("descriptionMaximumLength")
  end

  test "hides share links from another repository reader" do
    repository, prototype = sign_in_and_create_prototype
    build = build_with_state(prototype, 1, "successful", "a", Time.current)
    build.commit_author.record! \
      commit_payload(build.commit_sha).merge(
        "author" => {
          "id" => 1_002,
          "login" => "mona",
          "avatar_url" => nil
        }
      )

    get repository_prototype_path(repository.github_id, prototype)

    assert_response :success
    assert_not_includes response.body, I18n.t("prototypes.show.share_links")
  end

  test "rejects an explicitly selected Build that is not successful" do
    repository, prototype = sign_in_and_create_prototype
    build = builds.create(prototype:)

    get repository_prototype_path(repository.github_id, prototype, build: build.number)

    assert_response :not_found
  end

  test "shows history when no successful Build can be reviewed" do
    repository, prototype = sign_in_and_create_prototype
    queued = builds.create(prototype:)

    get repository_prototype_path(repository.github_id, prototype)

    assert_response :success
    assert_includes response.body, "No successful build yet"
    assert_includes response.body, repository_prototype_builds_path(repository.github_id, prototype)
    assert_includes response.body, "Queued"
    assert_includes \
      response.body,
      repository_prototype_build_path(repository.github_id, prototype, queued.number)
  end

  test "redirects a legacy history cursor to the Build history route" do
    repository, prototype = sign_in_and_create_prototype

    get repository_prototype_path(repository.github_id, prototype, before: 2)

    assert_redirected_to repository_prototype_builds_path(repository.github_id, prototype, before: 2)
  end

  test "rejects a malformed legacy history cursor" do
    repository, prototype = sign_in_and_create_prototype

    get "#{repository_prototype_path(repository.github_id, prototype)}?before[]=2"

    assert_response :not_found
  end

  test "lists every Build in the version selector" do
    repository, prototype = sign_in_and_create_prototype
    27.times do |index|
      sha = (index + 1).to_s(16).rjust(40, "0")
      build_with_state(prototype, index + 1, "successful", sha, Time.current)
    end
    selected = prototype.builds.find_by!(number: 1)

    get repository_prototype_path(repository.github_id, prototype, build: selected.number), as: :json

    assert_response :success
    data = JSON.parse(response.body).fetch("data")
    data.fetch("buildOptions").each do |option|
      assert_equal \
        repository_prototype_path(repository.github_id, prototype, build: option.fetch("number")),
        option.fetch("path")
    end
    assert_includes response.body, PreviewOrigin.current.url(selected.id)
    assert_includes response.body, '"number":1'
    assert_includes response.body, '"number":2,'
    assert_includes response.body, '"number":27'
  end

  test "shows exact build identity and timestamps" do
    repository, prototype = sign_in_and_create_prototype
    time = Time.current
    build = build_with_state(prototype, 1, "successful", "f", time)

    get repository_prototype_build_path(repository.github_id, prototype, build.number)

    assert_response :success
    assert_includes response.body, "build 1"
    assert_includes response.body, "f" * 40
    assert_includes response.body, "Successful"
    assert_includes response.body, "Started"
    assert_includes response.body, "Finished"
    assert_includes response.body, "View workflow run"
    assert_includes response.body, build.workflow_url
    assert_includes response.body, "Storage used"
  end

  test "shows the saved failure explanation" do
    repository, prototype = sign_in_and_create_prototype
    build = build_with_state(prototype, 1, "failed", "f", Time.current)

    get repository_prototype_build_path(repository.github_id, prototype, build.number)

    assert_response :success
    assert_includes response.body, "Failed build"
    assert_includes response.body, "GitHub Actions did not complete this build."
  end

  test "does not link a persisted workflow URL outside the GitHub origin" do
    repository, prototype = sign_in_and_create_prototype
    build = builds.create(prototype:)
    build.update_columns \
      github_workflow_run_id: 9001,
      github_workflow_run_attempt: 1,
      workflow_url: "https://example.com/github/prototype/actions/runs/9001"

    get repository_prototype_build_path(repository.github_id, prototype, build.number)

    assert_response :success
    assert_not_includes response.body, "View workflow run"
    assert_not_includes response.body, "https://example.com"
  end

  test "requires a browser session before revealing gallery records" do
    repository = repositories.create(github_id: 2001, name_with_owner: "github/private")
    prototype = prototypes.create(repository:)

    get repository_prototype_builds_path(repository.github_id, prototype)

    assert_redirected_to root_path
    assert_not_includes response.body, repository.name_with_owner
  end

  test "returns not found when GitHub denies the repository" do
    visible = repository_payload(2001, "github/visible")
    hidden = repository_payload(2002, "github/hidden")
    stub_github_sign_in \
      repositories: [ visible, hidden ],
      permissions: { 2001 => "pull", 2002 => nil }
    sign_in
    repository = Repository.find_by!(github_id: 2002)
    prototype = prototypes.create(repository:)

    get repository_prototype_builds_path(repository.github_id, prototype)

    assert_response :not_found
  end

  test "returns unavailable when GitHub cannot confirm repository access" do
    visible = repository_payload(2001, "github/visible")
    failing = repository_payload(2002, "github/failing")
    stub_github_sign_in \
      repositories: [ visible, failing ],
      permissions: { 2001 => "pull", 2002 => :failure }
    sign_in
    repository = Repository.find_by!(github_id: 2002)
    prototype = prototypes.create(repository:)

    get repository_prototype_path(repository.github_id, prototype)

    assert_response :service_unavailable
    assert_empty prototype.prototype_introductions
  end

  test "does not resolve a prototype through a different repository" do
    first = repository_payload(2001, "github/first")
    second = repository_payload(2002, "github/second")
    stub_github_sign_in \
      repositories: [ first, second ],
      permissions: { 2001 => "pull", 2002 => "pull" }
    sign_in
    first_repository = Repository.find_by!(github_id: 2001)
    second_repository = Repository.find_by!(github_id: 2002)
    prototype = prototypes.create(repository: second_repository)

    get repository_prototype_path(first_repository.github_id, prototype)

    assert_response :not_found
    assert_empty prototype.prototype_introductions
  end

  test "resolves a build number only within its prototype" do
    repository, first_prototype = sign_in_and_create_prototype
    second_prototype = prototypes.create(repository:, branch_name: "prototype/second")
    builds.create(prototype: first_prototype, commit_sha: "a" * 40)
    other_build = builds.create(prototype: second_prototype, number: 2, commit_sha: "b" * 40)

    get repository_prototype_build_path \
      repository.github_id,
      first_prototype,
      other_build.number

    assert_response :not_found
  end

  test "does not resolve a Build through a different repository" do
    first = repository_payload(2001, "github/first")
    second = repository_payload(2002, "github/second")
    stub_github_sign_in \
      repositories: [ first, second ],
      permissions: { 2001 => "pull", 2002 => "pull" }
    sign_in
    first_repository = Repository.find_by!(github_id: 2001)
    second_repository = Repository.find_by!(github_id: 2002)
    prototype = prototypes.create(repository: second_repository)
    build = builds.create(prototype:)

    get repository_prototype_build_path \
      first_repository.github_id,
      prototype,
      build.number

    assert_response :not_found
  end

  test "denies a Build when GitHub denies its repository" do
    visible = repository_payload(2001, "github/visible")
    hidden = repository_payload(2002, "github/hidden")
    stub_github_sign_in \
      repositories: [ visible, hidden ],
      permissions: { 2001 => "pull", 2002 => nil }
    sign_in
    repository = Repository.find_by!(github_id: 2002)
    prototype = prototypes.create(repository:)
    build = builds.create(prototype:)

    get repository_prototype_build_path(repository.github_id, prototype, build.number)

    assert_response :not_found
  end

  test "returns unavailable when GitHub cannot confirm Build access" do
    visible = repository_payload(2001, "github/visible")
    failing = repository_payload(2002, "github/failing")
    stub_github_sign_in \
      repositories: [ visible, failing ],
      permissions: { 2001 => "pull", 2002 => :failure }
    sign_in
    repository = Repository.find_by!(github_id: 2002)
    prototype = prototypes.create(repository:)
    build = builds.create(prototype:)

    get repository_prototype_build_path(repository.github_id, prototype, build.number)

    assert_response :service_unavailable
  end

  test "rejects malformed prototype IDs and build numbers" do
    repository, prototype = sign_in_and_create_prototype
    build = builds.create(prototype:)

    get "/repositories/#{repository.github_id}/prototypes/#{prototype.id}abc"
    assert_response :not_found

    get "/repositories/#{repository.github_id}/prototypes/#{prototype.id}/builds/#{build.number}abc"
    assert_response :not_found
  end

  test "rejects malformed repository IDs in nested gallery paths" do
    repository, prototype = sign_in_and_create_prototype

    get "/repositories/#{repository.github_id}abc/prototypes/#{prototype.id}"

    assert_response :not_found
  end

  test "paginates build history without shifting when a build is discovered" do
    repository, prototype = sign_in_and_create_prototype
    selected = build_with_state(prototype, 1, "successful", "a", Time.current)
    25.times do |index|
      builds.create \
        prototype:,
        number: index + 2,
        commit_sha: (index + 1).to_s(16).rjust(40, "0")
    end

    get repository_prototype_builds_path(repository.github_id, prototype, build: selected.number),
      headers: { "Accept" => "application/json" }

    assert_response :success
    assert_includes response.body, "build 26"
    first_page = JSON.parse(response.body).fetch("data")
    assert_not_includes first_page.fetch("builds").pluck("number"), 1
    assert_includes response.body, "Older builds"
    next_page_path = first_page.fetch("nextPagePath")
    assert_includes next_page_path, "build=#{selected.number}"

    builds.create(prototype:, number: 27, commit_sha: "f" * 40)
    get next_page_path, headers: { "Accept" => "application/json" }

    assert_response :success
    next_page = JSON.parse(response.body).fetch("data")
    assert_includes next_page.fetch("builds").pluck("number"), 1
    assert_includes response.body, "Newest builds"
    assert_includes next_page.fetch("newestPagePath"), "build=#{selected.number}"
    assert_not_includes next_page.fetch("builds").pluck("number"), 27
  end

  test "rejects malformed build-history cursors" do
    repository, prototype = sign_in_and_create_prototype

    get "#{repository_prototype_builds_path(repository.github_id, prototype)}?before[]=1"

    assert_response :not_found
  end

  test "redirects a legacy Build history cursor with its chronological time" do
    repository, prototype = sign_in_and_create_prototype
    build = builds.create(prototype:)

    get repository_prototype_builds_path(repository.github_id, prototype, before: build.number)

    assert_redirected_to repository_prototype_builds_path(
      repository.github_id,
      prototype,
      before: build.number,
      before_at: build.chronological_at.iso8601(6)
    )
  end

  test "keeps a history cursor stable when GitHub chronology is backfilled" do
    repository, prototype = sign_in_and_create_prototype
    older = builds.create(prototype:, number: 1, commit_sha: "a" * 40)
    cursor = builds.create(prototype:, number: 2, commit_sha: "b" * 40)
    cursor_time = cursor.created_at
    cursor.update! \
      github_workflow_run_id: 9002,
      github_workflow_run_attempt: 1,
      workflow_url: "https://github.com/github/prototype/actions/runs/9002",
      workflow_created_at: older.created_at - 1.hour

    get repository_prototype_builds_path(
      repository.github_id,
      prototype,
      before: cursor.number,
      before_at: cursor_time.iso8601(6)
    )

    assert_response :success
    assert_includes response.body, '"number":1,'
  end

  private

  def sign_in_and_create_prototype
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "pull" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    [ repository, prototypes.create(repository:) ]
  end

  def sign_in(github_id: 1001)
    sign_in_to_hub(github_id:)
  end

  def build_with_state(prototype, number, state, sha_character, time)
    timestamps = case state
    when "queued" then {}
    when "running" then { started_at: time }
    when "superseded" then { finished_at: time }
    else { started_at: time, finished_at: time }
    end
    build = builds.create \
      prototype:,
      number:,
      commit_sha: sha_character.length == 40 ? sha_character : sha_character * 40
    attributes = { state:, **timestamps }
    if state == "failed"
      attributes[:failure_summary] = "GitHub Actions did not complete this build."
    elsif state == "successful"
      attributes.merge! \
        workflow_completed_at: time,
        github_workflow_run_id: build.id + 10_000,
        github_workflow_run_attempt: 1,
        workflow_url: "https://github.com/github/prototype/actions/runs/#{build.id + 10_000}",
        github_artifact_id: build.id + 20_000,
        artifact_prefix: "builds/#{build.id}",
        artifact_bytes: 25_690_112
    end
    build.update!(attributes)
    build
  end

  def commit_payload(sha)
    {
      "sha" => sha,
      "commit" => { "author" => { "name" => "The Octocat" } },
      "author" => {
        "id" => 1_001,
        "login" => "octocat",
        "avatar_url" => "https://avatars.example.test/octocat"
      }
    }
  end
end
