require "test_helper"

class PrototypeRegistrationsTest < ActionDispatch::IntegrationTest
  setup do
    github_app_configurations.create_installed
  end

  test "renders the management shell without branches or other repository checks" do
    payloads = [ repository_payload(2001, "github/prototype"), repository_payload(2002, "github/other") ]
    stub_github_sign_in(repositories: payloads, permissions: { 2001 => "push", 2002 => "pull" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototypes.create(repository:, branch_name: "prototype/listed").register!(name: "Listed")
    prototypes.create(repository:, branch_name: "prototype/new")
    WebMock.reset_executed_requests!

    load_ids = [ {}, { "Accept" => "application/json" } ].map do |headers|
      get repository_prototype_management_path(repository.route_id), headers: headers
      assert_response :success
      assert_includes response.body, '"name":"Listed"'
      assert_includes response.body, '"unlisted":[]'
      assert_not_includes response.body, "github/other"
      response.body[/"sectionLoadId":"([^"]+)"/, 1]
    end
    assert load_ids.all?(&:present?)
    assert_equal 2, load_ids.uniq.size
    assert_not_requested :get, %r{/branches}
    assert_not_requested :get, %r{/compare/}
    assert_not_requested :get, "#{GITHUB_API_URL}/repos/github/other/collaborators/octocat/permission"
  end

  test "loads repository choices independently and excludes inaccessible repositories" do
    payloads = [ repository_payload(2001, "github/prototype"), repository_payload(2002, "github/other"),
      repository_payload(2003, "github/private") ]
    stub_github_sign_in(repositories: payloads, permissions: { 2001 => "push", 2002 => "pull", 2003 => nil })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototypes.create(repository:, branch_name: "prototype/new")
    WebMock.reset_executed_requests!

    get repository_prototype_management_path(repository.route_id),
      params: { props_at: "data.repositoryChoices" },
      headers: { "Accept" => "application/json" }

    assert_response :success
    assert_includes response.body, '"action":"graft"'
    assert_includes response.body, '"path":"data.repositoryChoices"'
    assert_includes response.body, "github/other"
    assert_not_includes response.body, "github/private"
    assert_not_includes response.body, "unlisted"
    assert_not_includes response.body, "sectionLoadId"
    assert_not_requested :get, %r{/branches}
    assert_not_requested :get, %r{/compare/}
    assert_requested :post, "#{GITHUB_API_URL}/app/installations/456/access_tokens", times: 1
  end

  test "rejects unsupported management sections without loading branch data" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    WebMock.reset_executed_requests!

    get repository_prototype_management_path(repository.route_id),
      params: { props_at: "data.unknown" },
      headers: { "Accept" => "application/json" }

    assert_response :not_found
    assert_not_requested :get, %r{/branches}
    assert_not_requested :get, %r{/compare/}
  end

  test "reports partial repository failures and permits a retry instead of caching them" do
    original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    payloads = [ repository_payload(2001, "github/prototype"), repository_payload(2002, "github/other") ]
    stub_github_sign_in(repositories: payloads, permissions: { 2001 => "push", 2002 => "pull" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    Rails.cache.clear
    stub_github_permissions(payloads, { 2001 => "push", 2002 => :failure })
    path = repository_prototype_management_path(repository.route_id)
    options = { params: { props_at: "data.repositoryChoices" }, headers: { "Accept" => "application/json" } }

    get path, **options
    assert_response :success
    assert_includes response.body, '"failed":true'
    assert_not_includes response.body, "github/other"

    stub_github_permissions(payloads, { 2001 => "push", 2002 => "pull" })
    get path, **options
    assert_response :success
    assert_includes response.body, '"failed":false'
    assert_includes response.body, "github/other"
  ensure
    Rails.cache = original_cache
  end

  test "rechecks write access for both async sections" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototypes.create(repository:, branch_name: "prototype/listed").register!(name: "Listed")
    get repository_prototype_management_path(repository.route_id)
    assert_response :success
    stub_github_permissions([ payload ], { 2001 => "pull" })

    %w[data.management data.repositoryChoices].each do |section|
      get repository_prototype_management_path(repository.route_id),
        params: { props_at: section }, headers: { "Accept" => "application/json" }
      assert_response :not_found
      assert_not_includes response.body, "Listed"
    end
  end

  test "reuses comparison caches but checks authorship freshly on registration" do
    original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    branch = prototypes.create(repository:, branch_name: "prototype/new")
    stub_branches(repository, "main" => "a" * 40, branch.branch_name => "b" * 40)
    stub_comparison(repository, "a" * 40, "b" * 40, author_ids: [ 1001 ])
    get_management(repository)
    assert_response :success
    assert_includes response.body, branch.branch_name
    WebMock.reset_executed_requests!

    get_management(repository)
    assert_response :success
    assert_includes response.body, branch.branch_name
    assert_not_requested :get, %r{/compare/}

    stub_comparison(repository, "a" * 40, "b" * 40, author_ids: [ 1002 ])
    patch repository_prototype_registration_path(repository.route_id, branch),
      params: { prototype: { name: "Not eligible now" } }
    assert_response :not_found
    assert_not branch.reload.registered?
    assert_requested :get, %r{/compare/}, times: 1

    stub_branches(repository, "main" => "c" * 40, branch.branch_name => "b" * 40)
    stub_comparison(repository, "c" * 40, "b" * 40, author_ids: [ 1002 ])
    get_management(repository)
    assert_response :success
    assert_not_includes response.body, branch.branch_name
    assert_requested :get, %r{/compare/#{"c" * 40}}, times: 1

    stub_branches(repository, "main" => "c" * 40, branch.branch_name => "d" * 40)
    stub_comparison(repository, "c" * 40, "d" * 40, author_ids: [ 1001 ])
    get_management(repository)
    assert_response :success
    assert_includes response.body, branch.branch_name
    assert_requested :get, %r{/compare/#{"c" * 40}\.\.\.#{"d" * 40}}, times: 1
  ensure
    Rails.cache = original_cache
  end

  test "retries branch comparisons after an upstream failure instead of caching an empty result" do
    original_cache = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:, branch_name: "prototype/retry")
    stub_branches(repository, "main" => "a" * 40, prototype.branch_name => "b" * 40)
    stub_request(:get, %r{/compare/}).to_timeout

    get_management(repository)
    assert_response :success
    assert_includes response.body, '"candidateCheckFailed":true'
    assert_not_includes response.body, '"branchName":"prototype/retry"'

    stub_comparison(repository, "a" * 40, "b" * 40, author_ids: [ 1001 ])
    get_management(repository)
    assert_response :success
    assert_includes response.body, '"candidateCheckFailed":false'
    assert_includes response.body, '"branchName":"prototype/retry"'
  ensure
    Rails.cache = original_cache
  end

  test "retired histories leave lists but keep their exact review and history links" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "admin" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    original = prototypes.create(repository:, branch_name: "prototype/welcome")
    original.register!(name: "Retained original")
    old_build = builds.create_successful(prototype: original, commit_sha: "a" * 40)
    original.update!(current_build: old_build)
    repository.branch_presence.record_missing!(
      branch_name: original.branch_name, observed: repository.branch_presence.observations.fetch(original.branch_name)
    )
    replacement = prototypes.create(repository:, branch_name: original.branch_name)
    replacement.register!(name: "Replacement")
    builds.create_successful(prototype: replacement, commit_sha: "b" * 40)
    stub_branches(repository, "main" => "c" * 40, original.branch_name => "b" * 40)

    get repository_path(repository.github_id)
    assert_response :success
    assert_includes response.body, "Replacement"
    assert_not_includes response.body, "Retained original"
    get repository_prototype_management_path(repository.github_id)
    assert_response :success
    assert_includes response.body, "Replacement"
    assert_not_includes response.body, "Retained original"
    get_management(repository)
    assert_response :success
    assert_includes response.body, "Replacement"
    assert_not_includes response.body, "Retained original"

    get repository_prototype_path(repository.github_id, original, build: old_build.number)
    assert_response :success
    assert_includes response.body, "Retained original"
    assert_not_includes response.body, "Replacement"
    get repository_prototype_builds_path(repository.github_id, original)
    assert_response :success
    assert_includes response.body, old_build.commit_sha
    assert_predicate original.reload, :registered?
  end

  test "lets a writer add a discovered branch to the gallery and edit its details" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:, branch_name: "prototype/welcome")
    path = repository_prototype_registration_path(repository.github_id, prototype)
    stub_branches(repository, "main" => "a" * 40, "prototype/welcome" => "b" * 40)
    stub_comparison(repository, "a" * 40, "b" * 40, author_ids: [ 1002, 1001 ])
    stub_activity(repository, [ push_activity("prototype/welcome") ])

    get repository_path(repository.github_id)

    assert_response :success
    assert_includes response.body, "You pushed prototype/welcome."
    assert_includes response.body, repository_prototype_management_path(repository.github_id)
    assert_includes response.body, '"prototypes":[]'

    get_management(repository)

    assert_response :success
    assert_includes response.body, path
    assert_includes response.body, "prototype/welcome"
    assert_includes response.body, '"unlistedHeading":"Available branches"'
    assert_includes response.body, '"unlistedDescription":"Add a branch to Hub to make your prototype available for others to explore."'
    assert_includes response.body, '"registeredHeading":"Prototypes in Hub"'
    assert_includes response.body, '"registeredEmptyLabel":"No prototypes in Hub yet. Once you add a branch, it will appear here so you can manage its details."'
    assert_includes response.body, '"emptyLabel":"No branches available to add. When you create a new branch, it will appear here so you can add it to Hub."'
    assert_not_includes response.body, "Add your branches to Hub or edit details for prototypes already listed here."

    patch path, params: {
      prototype: { name: "  Welcome  ", description: "  Explore the flow  ", start_page: "/welcome?step=1#intro" }
    }

    assert_response :see_other
    assert_redirected_to repository_prototype_management_path(repository.github_id)
    assert_equal "Welcome", prototype.reload.name
    assert_equal "Explore the flow", prototype.description
    assert_equal "/welcome?step=1#intro", prototype.start_page
    assert_equal User.find_by!(login: "octocat"), prototype.author
    registered_at = prototype.registered_at

    follow_redirect!

    assert_includes response.body, '"name":"Welcome"'
    assert_includes response.body, '"description":"Explore the flow"'
    assert_includes response.body, '"startPage":"/welcome?step=1#intro"'
    assert_includes response.body, '"registered":[{'

    get repository_prototype_path(repository.github_id, prototype)
    assert_includes response.body, '"detailsEditPath":'

    get repository_path(repository.github_id)
    assert_includes response.body, '"prototypes":[{'
    assert_includes response.body, '"recentBranches":[]'

    patch path, params: { prototype: { name: "Welcome back", description: "" } }

    assert_response :see_other
    assert_equal "Welcome back", prototype.reload.name
    assert_nil prototype.description
    assert_equal registered_at, prototype.registered_at

    patch path, params: { prototype: { description: "A new direction" } }
    assert_response :see_other
    assert_equal "Welcome back", prototype.reload.name
    assert_equal "A new direction", prototype.description
    assert_equal "/welcome?step=1#intro", prototype.start_page

    patch path, params: { prototype: { start_page: "https://example.com" } }
    assert_response :see_other
    follow_redirect!
    assert_includes response.body, "must be a route"
    assert_equal "/welcome?step=1#intro", prototype.reload.start_page

    patch path, params: { prototype: { start_page: "" } }
    assert_response :see_other
    assert_nil prototype.reload.start_page

    patch path, params: { prototype: { name: "Welcome again" } }
    assert_response :see_other
    assert_equal "Welcome again", prototype.reload.name
    assert_equal "A new direction", prototype.description
  end

  test "keeps review edits unpinned after saving or a validation failure in the default view" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:, branch_name: "prototype/welcome")
    prototype.register!(name: "Welcome", author: User.find_by!(login: "octocat"))
    builds.create_successful(prototype:)
    path = repository_prototype_registration_path(repository.github_id, prototype)
    review_path = repository_prototype_path(repository.github_id, prototype)

    patch path, params: {
      return_to: "review",
      prototype: { name: "Updated", start_page: "/settings?tab=profile#details" }
    }
    assert_redirected_to review_path
    assert_equal "Updated", prototype.reload.name
    assert_equal "/settings?tab=profile#details", prototype.start_page
    follow_redirect!
    assert_response :success
    assert_includes response.body, '"buildPinned":false'

    patch path, params: {
      return_to: "review",
      prototype: { start_page: "https://example.com/elsewhere" }
    }
    assert_redirected_to review_path
    follow_redirect!
    assert_response :success
    assert_includes response.body, "must be a route"
    assert_includes response.body, '"buildPinned":false'
    assert_equal "/settings?tab=profile#details", prototype.reload.start_page
  end

  test "returns an edit from the review dialog to its selected successful Build" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:, branch_name: "prototype/welcome")
    prototype.register!(name: "Welcome", start_page: "/welcome?step=1#intro", author: User.find_by!(login: "octocat"))
    build = builds.create \
      prototype:,
      number: 1,
      commit_sha: "a" * 40
    build.update! \
      state: "successful",
      started_at: Time.current,
      finished_at: Time.current,
      workflow_completed_at: Time.current,
      github_workflow_run_id: 100,
      github_workflow_run_attempt: 1,
      workflow_url: "https://github.com/github/prototype/actions/runs/100",
      github_artifact_id: 101,
      artifact_prefix: "builds/#{build.id}",
      artifact_bytes: 1
    path = repository_prototype_registration_path(repository.github_id, prototype)

    patch path, params: {
      return_to: "review",
      build: build.number,
      prototype: { name: "Updated", description: "New details" }
    }
    assert_redirected_to repository_prototype_path(repository.github_id, prototype, build: build.number)
    assert_equal "Updated", prototype.reload.name
    assert_equal "/welcome?step=1#intro", prototype.start_page

    follow_redirect!
    assert_response :success
    assert_includes response.body, '"startPage":"/welcome?step=1#intro"'
    assert_includes response.body, '"startPageLabel":"Start page (optional)"'
    assert_includes response.body, '"startPageHint":'

    patch path, params: {
      return_to: "review",
      build: build.number,
      prototype: { name: "Updated", description: "New details", start_page: "/#/activity?filter=mine" }
    }
    assert_redirected_to repository_prototype_path(repository.github_id, prototype, build: build.number)
    assert_equal "/#/activity?filter=mine", prototype.reload.start_page
    follow_redirect!
    assert_includes response.body, '"startPage":"/#/activity?filter=mine"'
    assert_includes response.body, "\"previewUrl\":\"#{PreviewOrigin.current.url(build.id)}#/activity?filter=mine\""

    patch path, params: {
      return_to: "review",
      build: build.number,
      prototype: { start_page: "https://example.com/elsewhere" }
    }
    assert_redirected_to repository_prototype_path(repository.github_id, prototype, build: build.number)
    follow_redirect!
    assert_includes response.body, "must be a route"
    assert_equal "/#/activity?filter=mine", prototype.reload.start_page

    patch path, params: {
      return_to: "review",
      build: build.number,
      prototype: { start_page: "" }
    }
    assert_redirected_to repository_prototype_path(repository.github_id, prototype, build: build.number)
    assert_nil prototype.reload.start_page
    follow_redirect!
    assert_includes response.body, '"startPage":null'
    assert_includes response.body, "\"previewUrl\":\"#{PreviewOrigin.current.url(build.id)}\""

    patch path, params: {
      return_to: "review",
      build: 999,
      prototype: { name: "Should not persist" }
    }
    assert_response :not_found
    assert_equal "Updated", prototype.reload.name
  end

  test "hides other writers' branches but lets a writer edit an existing prototype" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    unlisted = prototypes.create(repository:, branch_name: "prototype/someone-else")
    registered = prototypes.create(repository:, branch_name: "prototype/existing")
    registered.register!(name: "Existing")
    stub_branches(repository, "main" => "a" * 40, "prototype/someone-else" => "b" * 40)
    stub_comparison(repository, "a" * 40, "b" * 40, author_ids: [ 1002 ])

    get repository_path(repository.github_id)
    assert_response :success
    assert_includes response.body, '"recentBranches":[]'
    assert_includes response.body, "Manage prototypes"

    get_management(repository)
    assert_response :success
    assert_not_includes response.body, "prototype/someone-else"
    assert_includes response.body, "prototype/existing"

    patch repository_prototype_registration_path(repository.github_id, unlisted),
      params: { prototype: { name: "Not mine" } }
    assert_response :not_found
    assert_not unlisted.reload.registered?

    patch repository_prototype_registration_path(repository.github_id, registered),
      params: { prototype: { name: "Updated" } }
    assert_response :see_other
    assert_equal "Updated", registered.reload.name
  end

  test "gallery offers every eligible branch recently pushed by the current person" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototypes.create(repository:, branch_name: "prototype/first")
    prototypes.create(repository:, branch_name: "prototype/second")
    stub_branches(repository, "main" => "a" * 40,
      "prototype/first" => "b" * 40, "prototype/second" => "c" * 40)
    stub_comparison(repository, "a" * 40, "b" * 40, author_ids: [ 1001 ])
    stub_comparison(repository, "a" * 40, "c" * 40, author_ids: [ 1001 ])
    stub_activity(repository, [ push_activity("prototype/first"), push_activity("prototype/second"),
      push_activity("prototype/first", timestamp: 2.hours.ago) ])

    get repository_path(repository.github_id)

    assert_response :success
    assert_includes response.body, "You pushed prototype/first."
    assert_includes response.body, "You pushed prototype/second."
    assert_equal 1, response.body.scan("You pushed prototype/first.").size
    assert_not_includes response.body, "You have branches ready to add to Hub."
  end

  test "Hide message persistently dismisses only this person's branch banner without preventing registration" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    declined = prototypes.create(repository:, branch_name: "prototype/declined")
    prototypes.create(repository:, branch_name: "prototype/other")
    other_user = users.create(github_id: 1002, login: "someone-else")
    stub_branches(repository, "main" => "a" * 40,
      declined.branch_name => "b" * 40, "prototype/other" => "c" * 40)
    stub_comparison(repository, "a" * 40, "b" * 40, author_ids: [ 1001, 1002 ])
    stub_comparison(repository, "a" * 40, "c" * 40, author_ids: [ 1001 ])
    stub_activity(repository, [ push_activity(declined.branch_name), push_activity("prototype/other") ])
    path = repository_prototype_branch_banner_dismissal_path(repository.route_id, declined)

    get repository_path(repository.route_id)
    assert_includes response.body, path
    assert_includes response.body, '"declineBranchLabel":"Hide message"'

    assert_difference "BranchBannerDismissal.count", 1 do
      post path, params: { user_id: other_user.id }
    end
    assert_response :see_other
    assert_redirected_to repository_path(repository.route_id)
    assert_equal User.find_by!(login: "octocat"), BranchBannerDismissal.sole.user
    assert_not declined.reload.registered?

    assert_no_difference "BranchBannerDismissal.count" do
      post path
    end
    assert_response :see_other

    delete session_path
    sign_in
    stub_activity(repository, [ push_activity(declined.branch_name, timestamp: Time.current),
      push_activity("prototype/other") ])
    get repository_path(repository.route_id)
    assert_response :success
    assert_not_includes response.body, "You pushed prototype/declined."
    assert_includes response.body, "You pushed prototype/other."

    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/activity")
      .with(query: hash_including("actor" => other_user.login))
      .to_return(status: 200, body: JSON.generate([ push_activity(declined.branch_name, actor_id: 1002) ]),
        headers: { "Content-Type" => "application/json" })
    assert_includes repository.prototype_candidates.recently_active_by(other_user, permission: "write"), declined

    get_management(repository)
    assert_response :success
    assert_includes response.body, '"branchName":"prototype/declined"'

    patch repository_prototype_registration_path(repository.route_id, declined),
      params: { prototype: { name: "Declined but still available" } }
    assert_response :see_other
    assert declined.reload.registered?
  end

  test "banner dismissals require current write access and a branch in the authorized repository" do
    payloads = [ repository_payload(2001, "github/prototype"), repository_payload(2002, "github/other") ]
    stub_github_sign_in(repositories: payloads, permissions: { 2001 => "push", 2002 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    other = prototypes.create(repository: Repository.find_by!(github_id: 2002))
    default = prototypes.create(repository:, branch_name: "main")
    reserved = prototypes.create(repository:, branch_name: "replica/install-workflow")

    assert_no_difference "BranchBannerDismissal.count" do
      [ other, default, reserved ].each do |prototype|
        post repository_prototype_branch_banner_dismissal_path(repository.route_id, prototype)
        assert_response :not_found
      end

      prototype = prototypes.create(repository:)
      stub_request(:get, "#{GITHUB_API_URL}/repos/github/prototype/collaborators/octocat/permission")
        .to_return(status: 200, body: JSON.generate(permission: "read", user: { id: 1001 }),
          headers: { "Content-Type" => "application/json" })
      post repository_prototype_branch_banner_dismissal_path(repository.route_id, prototype)
      assert_response :not_found

      stub_request(:get, "#{GITHUB_API_URL}/repos/github/prototype/collaborators/octocat/permission")
        .to_timeout
      post repository_prototype_branch_banner_dismissal_path(repository.route_id, prototype)
      assert_response :service_unavailable
    end
  end

  test "old pushes and other pushers remain available only through management" do
    travel_to Time.utc(2026, 9, 30, 12) do
      payload = repository_payload(2001, "github/prototype")
      stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "admin" })
      sign_in
      repository = Repository.find_by!(github_id: 2001)
      names = %w[boundary old someone-else recent force created deleted reserved future anonymous]
      names.each { |name| prototypes.create(repository:, branch_name: "prototype/#{name}") }
      stub_branches(repository, names.excluding("deleted").to_h { |name| [ "prototype/#{name}", "b" * 40 ] })
      stub_activity(repository, [
        push_activity("prototype/boundary", timestamp: 12.hours.ago),
        push_activity("prototype/old", timestamp: 13.hours.ago),
        push_activity("prototype/someone-else", actor_id: 1002),
        push_activity("prototype/recent", timestamp: 12.hours.ago + 1.second),
        push_activity("prototype/force", activity_type: "force_push"),
        push_activity("prototype/created", activity_type: "branch_creation"),
        push_activity("prototype/deleted"),
        push_activity("prototype/reserved", activity_type: "branch_deletion"),
        push_activity("prototype/future", timestamp: 1.hour.from_now),
        push_activity("prototype/anonymous").merge(actor: nil),
        push_activity("main"),
        push_activity("replica/install-workflow"),
        push_activity("prototype/tag").merge(ref: "refs/tags/prototype/tag")
      ])

      get repository_path(repository.github_id)
      assert_response :success
      %w[recent force created].each { |name| assert_includes response.body, "You pushed prototype/#{name}." }
      %w[boundary old someone-else deleted reserved future anonymous].each do |name|
        assert_not_includes response.body, "You pushed prototype/#{name}."
      end
      assert_not_includes response.body, "You pushed main."
      assert_not_includes response.body, "You pushed replica/install-workflow."

      travel 2.seconds
      get repository_path(repository.github_id)
      assert_not_includes response.body, "You pushed prototype/recent."

      get_management(repository)
      assert_response :success
      %w[boundary old someone-else recent].each { |name| assert_includes response.body, "prototype/#{name}" }
    end
  end

  test "adds a recent branch directly and returns to the repository gallery" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:, branch_name: "prototype/new")
    stub_activity(repository, [ push_activity(prototype.branch_name) ])
    stub_branches(repository, "main" => "a" * 40, prototype.branch_name => "b" * 40)
    stub_comparison(repository, "a" * 40, "b" * 40, author_ids: [ 1001 ])

    get repository_path(repository.github_id)
    assert_includes response.body, '"registrationPath":'
    patch repository_prototype_registration_path(repository.github_id, prototype),
      params: { intent: "register_only", return_to: "repository", prototype: { name: prototype.branch_name } }
    assert_redirected_to repository_path(repository.github_id)
    assert_equal prototype.branch_name, prototype.reload.name
    assert_equal User.find_by!(login: "octocat"), prototype.author
    follow_redirect!
    assert_includes response.body, '"recentBranches":[]'
    assert_includes response.body, '"prototypes":[{'
  end

  test "a stale direct-add alert leaves a custom registration unchanged" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:, branch_name: "prototype/new")
    path = repository_prototype_registration_path(repository.github_id, prototype)
    stub_activity(repository, [ push_activity(prototype.branch_name) ])
    stub_branches(repository, "main" => "a" * 40, prototype.branch_name => "b" * 40)
    stub_comparison(repository, "a" * 40, "b" * 40, author_ids: [ 1001 ])

    get repository_path(repository.github_id)
    assert_includes response.body, '"registrationPath":'

    patch path, params: {
      prototype: { name: "Custom title", description: "Saved details", start_page: "/custom?step=2#intro" }
    }
    assert_redirected_to repository_prototype_management_path(repository.github_id)
    saved = prototype.reload.attributes

    patch path, params: {
      intent: "register_only", return_to: "repository",
      prototype: { name: prototype.branch_name, description: "Stale details", start_page: "/stale" }
    }

    assert_redirected_to repository_path(repository.github_id)
    assert_equal saved, prototype.reload.attributes
  end

  test "direct-add preserves a registration saved during its fresh GitHub eligibility check" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:, branch_name: "prototype/new")
    first_author = users.create(github_id: 1002, login: "first-writer")
    stub_branches(repository, "main" => "a" * 40, prototype.branch_name => "b" * 40)
    saved = nil
    transaction_depth = ActiveRecord::Base.connection.open_transactions
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/compare/#{"a" * 40}...#{"b" * 40}")
      .with(query: { "per_page" => "100", "page" => "1" })
      .to_return do
        assert_equal transaction_depth, ActiveRecord::Base.connection.open_transactions
        winner = Prototype.find(prototype.id)
        winner.register! \
          name: "First title",
          description: "First details",
          start_page: "/first?step=2#intro",
          author: first_author
        saved = winner.reload.attributes
        { status: 200, body: JSON.generate(total_commits: 1, commits: [ { author: { id: 1001 } } ]),
          headers: { "Content-Type" => "application/json" } }
      end

    patch repository_prototype_registration_path(repository.github_id, prototype), params: {
      intent: "register_only", return_to: "repository",
      prototype: { name: prototype.branch_name }
    }

    assert_redirected_to repository_path(repository.github_id)
    assert_not_nil saved
    assert_equal saved, prototype.reload.attributes
    assert_equal first_author, prototype.author
  end

  test "recent pushes do not bypass ownership and registration rechecks the current branch" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:, branch_name: "prototype/not-mine")
    stub_activity(repository, [ push_activity(prototype.branch_name) ])
    stub_branches(repository, "main" => "a" * 40, prototype.branch_name => "b" * 40)
    stub_comparison(repository, "a" * 40, "b" * 40, author_ids: [ 1002 ])

    get repository_path(repository.github_id)
    assert_includes response.body, '"recentBranches":[]'
    patch repository_prototype_registration_path(repository.github_id, prototype),
      params: { intent: "register_only", return_to: "repository", prototype: { name: prototype.branch_name } }
    assert_response :not_found
    assert_not prototype.reload.registered?

    stub_comparison(repository, "a" * 40, "b" * 40, author_ids: [ 1001 ])
    get repository_path(repository.github_id)
    stub_branches(repository, "main" => "a" * 40)
    patch repository_prototype_registration_path(repository.github_id, prototype),
      params: { intent: "register_only", return_to: "repository", prototype: { name: prototype.branch_name } }
    assert_response :not_found
    assert_not prototype.reload.registered?
  end

  test "follows cursor pagination for recent push activity" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "admin" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototypes.create(repository:, branch_name: "prototype/later-page")
    stub_branches(repository, "prototype/later-page" => "b" * 40)
    query = { "actor" => "octocat", "time_period" => "day", "direction" => "desc", "per_page" => "100" }
    next_url = "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/activity?#{URI.encode_www_form(query.merge("after" => "cursor"))}"
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/activity")
      .with(query:)
      .to_return(status: 200, body: JSON.generate(Array.new(100) { { activity_type: "pr_merge" } }),
        headers: { "Content-Type" => "application/json", "Link" => %(<#{next_url}>; rel="next") })
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/activity")
      .with(query: query.merge("after" => "cursor"))
      .to_return(status: 200, body: JSON.generate([ push_activity("prototype/later-page") ]),
        headers: { "Content-Type" => "application/json" })

    get repository_path(repository.github_id)
    assert_response :success
    assert_includes response.body, "You pushed prototype/later-page."
  end

  test "keeps the gallery and management link available when push activity fails" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototypes.create(repository:, branch_name: "prototype/new")
    prototypes.create(repository:, branch_name: "prototype/listed").register!(name: "Listed")
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/activity")
      .with(query: hash_including("actor" => "octocat")).to_timeout

    get repository_path(repository.github_id)
    assert_response :success
    assert_includes response.body, "Listed"
    assert_includes response.body, "Manage prototypes"
    assert_includes response.body, "could not check which branches"
    assert_includes response.body, '"recentBranches":[]'
  end

  test "does not use commit or discovery time instead of the recorded push time" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "admin" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    old = prototypes.create(repository:, branch_name: "prototype/old-commit", created_at: 1.year.ago)
    builds.create(prototype: old, commit_sha: "b" * 40, created_at: 1.year.ago)
    new_branch = prototypes.create(repository:, branch_name: "prototype/new-discovery")
    stub_branches(repository, old.branch_name => "b" * 40, new_branch.branch_name => "c" * 40)
    stub_activity(repository, [
      push_activity(old.branch_name),
      push_activity(new_branch.branch_name, timestamp: 1.day.ago)
    ])

    get repository_path(repository.github_id)
    assert_response :success
    assert_includes response.body, "You pushed prototype/old-commit."
    assert_not_includes response.body, "You pushed prototype/new-discovery."
  end

  test "fails closed when GitHub returns an invalid push timestamp" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "admin" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototypes.create(repository:, branch_name: "prototype/new")
    stub_activity(repository, [ push_activity("prototype/new").merge(timestamp: "not a time") ])

    get repository_path(repository.github_id)
    assert_response :success
    assert_includes response.body, "could not check which branches"
    assert_includes response.body, '"recentBranches":[]'
  end

  test "lets an admin add any live non-default branch without a commit comparison" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "admin" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    branch = prototypes.create(repository:, branch_name: "feature/navigation")
    stale = prototypes.create(repository:, branch_name: "prototype/deleted")
    default = prototypes.create(repository:, branch_name: "main")
    reserved = prototypes.create(repository:, branch_name: "replica/install-workflow")
    stub_branches(repository, "main" => "a" * 40, "feature/navigation" => "b" * 40,
      "replica/install-workflow" => "c" * 40)

    get_management(repository)
    assert_response :success
    assert_includes response.body, "feature/navigation"
    assert_not_includes response.body, "prototype/deleted"
    assert_not_includes response.body, '"branchName":"main"'
    assert_not_includes response.body, '"branchName":"replica/install-workflow"'

    [ stale, default, reserved ].each do |prototype|
      patch repository_prototype_registration_path(repository.github_id, prototype),
        params: { prototype: { name: "Not eligible" } }
      assert_response :not_found
    end

    patch repository_prototype_registration_path(repository.github_id, branch),
      params: { prototype: { name: "Navigation" } }
    assert_response :see_other
    assert branch.reload.registered?
  end

  test "finds a writer's attributed commit after the first comparison page" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:, branch_name: "prototype/long-history")
    stub_branches(repository, "main" => "a" * 40, "prototype/long-history" => "b" * 40)
    stub_comparison(repository, "a" * 40, "b" * 40,
      author_ids: Array.new(100, 1002), page: 1, total: 101)
    stub_comparison(repository, "a" * 40, "b" * 40,
      author_ids: [ 1001 ], page: 2, total: 101)

    get_management(repository)
    assert_response :success
    assert_includes response.body, "prototype/long-history"

    patch repository_prototype_registration_path(repository.github_id, prototype),
      params: { prototype: { name: "Long history" } }
    assert_response :see_other
    assert prototype.reload.registered?
  end

  test "paginates eligible branches even when earlier unlisted branches are ineligible" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    heads = { "main" => "a" * 40 }
    22.times do |index|
      name = format("prototype/branch-%02d", index + 1)
      sha = format("%040x", index + 1)
      heads[name] = sha
      prototypes.create(repository:, branch_name: name)
      stub_comparison(repository, "a" * 40, sha, author_ids: [ index < 11 ? 1002 : 1001 ])
    end
    stub_branches(repository, heads)
    path = repository_prototype_management_path(repository.github_id)
    WebMock.reset_executed_requests!

    get_management(repository)

    assert_response :success
    assert_equal 10, response.body.scan(/"branchName":"prototype\/branch-/).size
    assert_includes response.body, '"branchName":"prototype/branch-12"'
    assert_includes response.body, '"branchName":"prototype/branch-21"'
    assert_not_includes response.body, '"branchName":"prototype/branch-01"'
    assert_not_includes response.body, '"branchName":"prototype/branch-22"'
    assert_includes response.body, '"candidatePage":1'
    assert_includes response.body, '"candidatePageCount":2'
    assert_includes response.body, %("candidatePagePath":"#{path}")
    assert_requested :get, %r{/compare/}, times: 22
    assert_requested :post, "#{GITHUB_API_URL}/app/installations/456/access_tokens", times: 1

    get_management(repository, page: 2)

    assert_response :success
    assert_equal 1, response.body.scan(/"branchName":"prototype\/branch-/).size
    assert_includes response.body, '"branchName":"prototype/branch-22"'
    assert_includes response.body, '"candidatePage":2'
    assert_includes response.body, '"candidatePageCount":2'

    get_management(repository, page: 3)
    assert_response :not_found
  end

  test "does not show a page for branches the writer cannot add" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototypes.create(repository:, branch_name: "prototype/someone-else")
    stub_branches(repository, "main" => "a" * 40, "prototype/someone-else" => "b" * 40)
    stub_comparison(repository, "a" * 40, "b" * 40, author_ids: [ 1002 ])
    path = repository_prototype_management_path(repository.github_id)

    get_management(repository)
    assert_response :success
    assert_includes response.body, '"candidatePageCount":0'
    assert_includes response.body, '"unlisted":[]'

    get_management(repository, page: 2)
    assert_response :not_found

    get path, params: { page: "0" }
    assert_response :not_found

    get path, params: { page: "later" }
    assert_response :not_found
  end

  test "does not offer or register a branch when comparison history is incomplete" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:, branch_name: "prototype/incomplete")
    stub_branches(repository, "main" => "a" * 40, "prototype/incomplete" => "b" * 40)
    stub_comparison(repository, "a" * 40, "b" * 40,
      author_ids: [ 1001 ], total: 101)

    get_management(repository)
    assert_response :success
    assert_includes response.body, "could not check which branches"
    assert_not_includes response.body, '"branchName":"prototype/incomplete"'

    patch repository_prototype_registration_path(repository.github_id, prototype),
      params: { prototype: { name: "Incomplete" } }
    assert_response :service_unavailable
    assert_not prototype.reload.registered?
  end

  test "keeps registered cards available when GitHub cannot check branch eligibility" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototypes.create(repository:, branch_name: "prototype/ready")
    prototypes.create(repository:, branch_name: "prototype/listed").register!(name: "Listed")
    stub_activity(repository, [ push_activity("prototype/ready") ])
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/branches")
      .with(query: { "per_page" => "100", "page" => "1" })
      .to_timeout

    get repository_path(repository.github_id)
    assert_response :success
    assert_includes response.body, "Listed"
    assert_includes response.body, "could not check which branches"
    assert_includes response.body, '"recentBranches":[]'

    get_management(repository)
    assert_response :success
    assert_includes response.body, '"name":"Listed"'
    assert_includes response.body, "could not check which branches"
    assert_not_includes response.body, '"branchName":"prototype/ready"'
  end

  test "keeps unlisted branches out of the reader gallery without blocking direct links" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "pull" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:, branch_name: "prototype/unlisted")

    get repository_path(repository.github_id)

    assert_response :success
    assert_includes response.body, '"prototypes":[]'
    assert_not_includes response.body, "prototype/unlisted"
    assert_not_includes response.body, "Manage prototypes"

    get repository_prototype_management_path(repository.github_id)
    assert_response :not_found

    get repository_prototype_path(repository.github_id, prototype)

    assert_response :success
  end

  test "does not let a reader register a branch" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "pull" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:)

    patch repository_prototype_registration_path(repository.github_id, prototype),
      params: { prototype: { name: "Welcome", description: "Hello", start_page: "/welcome" } }

    assert_response :not_found
    assert_not prototype.reload.registered?
    assert_nil prototype.start_page
  end

  test "does not register a branch after a writer loses access" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:)
    stub_github_permissions([ payload ], { 2001 => "pull" })

    patch repository_prototype_registration_path(repository.github_id, prototype),
      params: { prototype: { name: "Welcome" } }

    assert_response :not_found
    assert_not prototype.reload.registered?
  end

  test "shows a validation error without registering an invalid name" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:)
    stub_branches(repository, "main" => "a" * 40, prototype.branch_name => "b" * 40)
    stub_comparison(repository, "a" * 40, "b" * 40, author_ids: [ 1001 ])

    patch repository_prototype_registration_path(repository.github_id, prototype),
      params: { prototype: { name: "  ", description: "Hello" } }

    assert_response :see_other
    assert_not prototype.reload.registered?
    follow_redirect!
    assert_includes response.body, "Name can't be blank"
  end

  test "rejects a registration without a name" do
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "push" })
    sign_in
    repository = Repository.find_by!(github_id: 2001)
    prototype = prototypes.create(repository:)
    stub_branches(repository, "main" => "a" * 40, prototype.branch_name => "b" * 40)
    stub_comparison(repository, "a" * 40, "b" * 40, author_ids: [ 1001 ])

    patch repository_prototype_registration_path(repository.github_id, prototype),
      params: { prototype: { description: "Hello" } }

    assert_response :see_other
    assert_not prototype.reload.registered?
    follow_redirect!
    assert_includes response.body, "Name can't be blank"
  end

  private

  def get_management(repository, page: 1)
    get repository_prototype_management_path(repository.route_id),
      params: { page:, props_at: "data.management" },
      headers: { "Accept" => "application/json" }
  end

  def push_activity(branch, timestamp: 1.hour.ago, actor_id: 1001, activity_type: "push")
    { activity_type:, timestamp: timestamp.iso8601, actor: { id: actor_id }, ref: "refs/heads/#{branch}" }
  end

  def stub_activity(repository, activities)
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/activity")
      .with(query: { "actor" => "octocat", "time_period" => "day", "direction" => "desc", "per_page" => "100" })
      .to_return(status: 200, body: JSON.generate(activities),
        headers: { "Content-Type" => "application/json" })
  end

  def stub_branches(repository, heads)
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/branches")
      .with(query: { "per_page" => "100", "page" => "1" })
      .to_return \
        status: 200,
        body: JSON.generate(heads.map { |name, sha| { name:, commit: { sha: } } }),
        headers: { "Content-Type" => "application/json" }
  end

  def stub_comparison(repository, base, head, author_ids:, page: 1, total: author_ids.length)
    stub_request(:get, "#{GITHUB_API_URL}/repos/#{repository.name_with_owner}/compare/#{base}...#{head}")
      .with(query: { "per_page" => "100", "page" => page.to_s })
      .to_return \
        status: 200,
        body: JSON.generate(total_commits: total,
          commits: author_ids.map { |id| { author: { id: } } }),
        headers: { "Content-Type" => "application/json" }
  end

  def sign_in
    sign_in_to_hub
  end
end
