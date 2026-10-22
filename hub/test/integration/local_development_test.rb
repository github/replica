require "test_helper"
require "fileutils"
require "open3"

class LocalDevelopmentTest < ActionDispatch::IntegrationTest
  setup do
    @root = Rails.root.join("storage", "local-prototypes-test-#{SecureRandom.hex(5)}")
    @artifact_root = Rails.root.join("storage", "local-artifacts-test-#{SecureRandom.hex(5)}")
    FileUtils.mkdir_p(@root)
  end

  teardown do
    FileUtils.rm_rf(@root)
    FileUtils.rm_rf(@artifact_root)
  end

  test "local sign-in is unavailable by default" do
    post local_authentication_path

    assert_response :not_found
    assert_equal 0, User.where(github_id: nil).count
    assert_raises(LocalDevelopment::Error) { Repository::LocalDiscovery.refresh_all! }
  end

  test "a GitHub browser cookie cannot resume a local session" do
    github_app_configurations.create_installed
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "pull" })
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    get github_authentication_callback_path, params: { code: "code", state: }
    assert_redirected_to welcome_path

    in_local_mode do
      get repositories_path
      assert_redirected_to root_path
      get root_path
      assert_response :success
      assert_includes response.body, I18n.t("home.index.local_sign_in")
    end
  end

  test "a local browser cookie cannot resume a GitHub session" do
    create_repository("one")

    in_local_mode do
      post local_authentication_path
      assert_redirected_to welcome_path
    end

    get repositories_path
    assert_redirected_to root_path
    get root_path
    assert_response :success
    assert_includes response.body, I18n.t("home.index.sign_in")
  end

  test "local mode uses a different browser cookie name" do
    assert_equal "replica_hub_session", LocalDevelopment.session_cookie_key

    in_local_mode do
      assert_equal "replica_hub_local_session", LocalDevelopment.session_cookie_key
    end
  end

  test "Create offers local prompt copying and is available throughout repository navigation" do
    path = create_repository("new-prototype")
    github_repository = repositories.create

    in_local_mode do
      get repositories_path
      assert_redirected_to root_path
      post local_authentication_path
      repository = Repository.find_by!(local_path: path.to_s)
      new_path = repository_new_prototype_path(repository.route_id)

      [
        repository_path(repository.route_id),
        repository_new_prototype_path(repository.route_id),
        repository_prototype_management_path(repository.route_id),
        repository_analytics_path(repository.route_id),
        notifications_path
      ].each do |navigation_path|
        get navigation_path, as: :json
        assert_response :success
        data = JSON.parse(response.body).fetch("data")
        navigation = navigation_path == notifications_path ? data.fetch("repository") : data
        assert_equal new_path, navigation.fetch("newPrototypePath")
      end

      get new_path, as: :json
      assert_response :success
      data = JSON.parse(response.body).fetch("data")
      assert_equal new_path, data.fetch("newPrototypePath")
      assert_equal "copy", data.fetch("submissionMode")
      assert_equal "Templates", data.fetch("catalog").fetch("heading")
      assert_equal I18n.t("new_prototypes.show.template_label"), data.fetch("copy").fetch("templateLabel")
      assert_equal I18n.t("prototype_prompts.viewed_page", route: "%{route}"),
        data.fetch("templatePageInstructions")
      assert_equal I18n.t("templates.detail.landing_page_instructions", route: "%{route}"),
        data.fetch("templateLandingPageInstructions")
      assert_equal I18n.t("new_prototypes.show.copy_prompt_label"), data.fetch("copy").fetch("submitLabel")
      assert_equal I18n.t("replica_browses.show.branch_instructions"), data.fetch("promptInstructions")
      assert_equal [ "default" ], data.fetch("templates").map { _1.fetch("id") }
      assert_empty repository.reviewable_prototypes

      get repository_templates_path(repository.route_id), as: :json
      assert_redirected_to new_path

      get repository_new_prototype_path(github_repository.route_id), as: :json
      assert_response :not_found
    end
  end

  test "the local identity can configure analytics only for configured local repositories" do
    path = create_repository("analytics")
    github_repository = repositories.create

    in_local_mode do
      post local_authentication_path
      repository = Repository.find_by!(local_path: path.to_s)
      get repository_analytics_path(repository.route_id)
      assert_response :success
      assert_includes response.body, '"selectedSection":"analytics"'

      post repository_analytics_destinations_path(repository.route_id),
        params: {
          destination: {
            provider: "segment", region: "us", history: "new",
            credentials: { write_key: "local-secret" },
            event_types: Analytics::Event::TYPES
          }
        }
      assert_response :see_other
      assert_equal 1, repository.analytics_destinations.count
      assert_match(/\A[0-9a-f]{64}\z/, Analytics.actor_id(user: User.local_developer!))

      get repository_analytics_path(github_repository.github_id)
      assert_response :not_found
    end
  end

  test "local demo analytics editing preserves behavior without creating fresh authorization" do
    path = create_repository("analytics-editing")
    in_local_mode do
      post local_authentication_path
      repository = Repository.find_by!(local_path: path.to_s)
      destination = repository.analytics_destinations.create! \
        provider: "segment", region: "us", credentials: { write_key: "initial-local-secret" },
        event_types: Analytics::Event::TYPES
      destination_path = repository_analytics_destination_path(repository.route_id, destination)
      assert_no_difference("FreshAuthorization.count") do
        patch destination_path, params: {
          destination: { provider: "segment", region: "us", credentials: { write_key: "rotated-local-secret" },
            event_types: Analytics::Event::TYPES }
        }
        assert_response :see_other
        assert_equal "rotated-local-secret", destination.reload.credentials.fetch("write_key")
        patch destination_path, params: { operation: "pause" }
        assert_not destination.reload.enabled?
        patch destination_path, params: { operation: "resume" }
        assert destination.reload.enabled?
        delete destination_path
        assert_not Analytics::Destination.exists?(destination.id)
      end
      browser_session = User.local_developer!.sessions.sole
      assert_nil browser_session.fresh_authorized_at
      assert_not FreshAuthorization.fresh?(browser_session)
      assert_raises(FreshAuthorization::Invalid) do
        FreshAuthorization.start!(credential: browser_session, purpose: "sharing_settings")
      end
    end
  end

  test "empty local setup explains how to add a committed repository" do
    in_local_mode do
      post local_authentication_path

      assert_redirected_to root_path
      assert_response :see_other
      follow_redirect!
      assert_includes response.body, "Add a Git repository with at least one commit"
      assert_nil User.find_by(github_id: nil)
    end
  end

  test "first local setup creates a committed example without discovering builds" do
    in_local_mode do
      original = LocalDevelopment.method(:warm_dependencies!)
      LocalDevelopment.define_singleton_method(:warm_dependencies!) { |_checkout| }
      LocalDevelopment.seed_example!

      example = @root.join("example")
      assert File.file?(example.join("package-lock.json"))
      assert File.file?(example.join(".agents/skills/setup-skills/SKILL.md"))
      assert File.file?(example.join(".agents/context-templates/SKILL.md"))
      assert_equal "prototype/welcome", git!(example, "branch", "--show-current")
      assert_equal %w[main prototype/field-notes prototype/signal-room prototype/welcome],
        git!(example, "branch", "--format=%(refname:short)").lines.map(&:strip)
      assert_equal "4", git!(example, "rev-list", "--count", "--all")
      assert_equal "/#/activity",
        JSON.parse(git!(example, "show", "main:.prototype")).fetch("startPage")
      manifest = JSON.parse(git!(example, "show", "main:.github/replica.json"))
      assert_equal %w[welcome field-notes signal-room], manifest.fetch("templates").pluck("id")
      manifest.fetch("templates").each do |template|
        page = template.fetch("id")
        assert_equal "/#/#{page}", template.fetch("path")
        assert_equal File.read(Rails.root.join("db/seeds/local/example/#{page}.tsx")).strip,
          git!(example, "show", "main:src/routes/templates/#{page}/index.tsx")
      end
      LocalDevelopment::EXAMPLE_BRANCHES.each do |branch, page|
        assert_equal "/",
          JSON.parse(git!(example, "show", "#{branch}:.prototype")).fetch("startPage")
        assert_equal File.read(Rails.root.join("db/seeds/local/example/#{page}.tsx")).strip,
          git!(example, "show", "#{branch}:src/routes/home/home-page/index.tsx")
        assert_equal File.read(Rails.root.join("db/seeds/local/example/#{page}.css")).strip,
          git!(example, "show", "#{branch}:src/routes/home/home-page/styles.css")
        assert_equal File.read(Rails.root.join("db/seeds/local/example/route-page.tsx.template")).strip,
          git!(example, "show", "#{branch}:src/routes/home/home-route-page/index.tsx")
        assert_equal git!(example, "rev-parse", "main"),
          git!(example, "merge-base", "main", branch)
      end

      post local_authentication_path

      assert_redirected_to welcome_path
      assert_equal "local/example", Repository.find_by!(local_path: example.to_s).name_with_owner
      assert_equal 0, Build.count

      Repository::LocalDiscovery.refresh_all!
      repository = Repository.find_by!(local_path: example.to_s)
      get repository_path(repository.route_id), headers: { "Accept" => "application/json" }
      assert_response :success
      data = JSON.parse(response.body).fetch("data")
      assert_empty data.fetch("prototypes")
      assert_equal LocalDevelopment::EXAMPLE_BRANCHES.keys.sort,
        data.fetch("recentBranches").map { _1.fetch("branchName") }
      data.fetch("recentBranches").each do |branch|
        assert_equal "Hub detected #{branch.fetch('branchName')} locally. Add it to Hub?",
          branch.fetch("title")
        assert_includes branch.fetch("registrationPath"), "/registration"
      end
    ensure
      LocalDevelopment.define_singleton_method(:warm_dependencies!, original) if original
    end
  end

  test "local setup leaves an existing repository alone" do
    path = create_repository("one")
    sha = git!(path, "rev-parse", "HEAD")

    in_local_mode do
      original = LocalDevelopment.method(:warm_build_dependencies!)
      warmed = false
      LocalDevelopment.define_singleton_method(:warm_build_dependencies!) { warmed = true }
      LocalDevelopment.seed_example!

      assert warmed
      assert_equal [ "one" ], @root.children.map { _1.basename.to_s }
      assert_equal sha, git!(path, "rev-parse", "HEAD")
    ensure
      LocalDevelopment.define_singleton_method(:warm_build_dependencies!, original) if original
    end
  end

  test "failed example setup leaves the directory empty for another start" do
    in_local_mode do
      original = LocalDevelopment.method(:warm_dependencies!)
      LocalDevelopment.define_singleton_method(:warm_dependencies!) do |_checkout|
        raise LocalDevelopment::Error, "Could not prepare dependencies"
      end

      error = assert_raises(LocalDevelopment::Error) { LocalDevelopment.seed_example! }

      assert_equal "Could not prepare dependencies", error.message
      assert_empty @root.children
    ensure
      LocalDevelopment.define_singleton_method(:warm_dependencies!, original) if original
    end
  end

  test "an uncommitted repository needs an initial commit before sign-in" do
    path = @root.join("uncommitted")
    FileUtils.mkdir_p(path)
    git!(path, "init", "-b", "main")

    in_local_mode do
      post local_authentication_path

      assert_redirected_to root_path
      assert_includes flash[:alert], "Commit at least one change"
      assert_equal 0, Repository.where(github_id: nil).count
    end
  end

  test "local sign-in requires the configured loopback origin" do
    create_repository("one")

    in_local_mode do
      host! "other.localhost:19500"
      post local_authentication_path

      assert_response :not_found
      assert_nil User.find_by(github_id: nil)
    end
  end

  test "local sign-in does not grant access to GitHub repositories" do
    create_repository("one")

    in_local_mode do
      github_repository = repositories.create
      post local_authentication_path

      get repository_path(github_repository.github_id)

      assert_response :not_found
      assert_equal "local", User.find_by!(github_id: nil).login
    end
  end

  test "a symbolic link cannot register an external repository" do
    outside = Rails.root.join("storage", "external-prototype-test-#{SecureRandom.hex(5)}")
    FileUtils.mkdir_p(outside)
    git!(outside, "init", "-b", "main")
    File.symlink(outside, @root.join("outside"))
    metadata_link = @root.join("linked-metadata")
    FileUtils.mkdir_p(metadata_link)
    File.symlink(outside.join(".git"), metadata_link.join(".git"))
    metadata_file = @root.join("external-metadata")
    FileUtils.mkdir_p(metadata_file)
    File.write(metadata_file.join(".git"), "gitdir: #{outside.join(".git")}\n")

    in_local_mode do
      invalid = Repository.new \
        local_path: outside.to_s,
        name_with_owner: "local/outside",
        default_branch: "main",
        synchronized_at: Time.current
      assert_not invalid.valid?
      assert_includes invalid.errors[:local_path], "must name a repository within the configured directory"

      post local_authentication_path

      assert_redirected_to root_path
      assert_includes flash[:alert], "Add a Git repository"
      assert_equal 0, Repository.where(github_id: nil).count
    end
  ensure
    FileUtils.rm_rf(outside) if outside
  end

  test "sign-in registers multiple repositories without discovering builds" do
    create_repository("one")
    create_repository("two")

    in_local_mode do
      post local_authentication_path

      assert_redirected_to welcome_path
      assert_equal %w[local/one local/two], Repository.where(github_id: nil).order(:name_with_owner).pluck(:name_with_owner)
      assert_equal 0, Build.count
      assert_equal "local", User.find_by!(github_id: nil).login
      assert_equal User::LOCAL_AVATAR_URL, User.find_by!(github_id: nil).avatar_url

      get repository_path(Repository.find_by!(name_with_owner: "local/one").route_id)
      assert_response :success
    end
  end

  test "refresh records only branch heads and reuses the same build" do
    path = create_repository("one")
    git!(path, "checkout", "-b", "prototype/welcome")
    File.write(path.join("index.txt"), "another commit")
    git!(path, "add", ".")
    git!(path, "commit", "-m", "prototype")
    sha = git!(path, "rev-parse", "HEAD")

    in_local_mode do
      post local_authentication_path
      repository = Repository.find_by!(name_with_owner: "local/one")
      post poll_repository_path(repository.route_id)
      assert_redirected_to repository_path(repository.route_id)
      assert_response :see_other
      build = repository.prototypes.find_by!(branch_name: "prototype/welcome").builds.sole
      assert_equal sha, build.commit_sha
      assert_nil build.github_workflow_run_id
      assert_equal "Local Test", build.commit_author_name
      assert_equal build, build.prototype.reload.current_build

      post poll_repository_path(repository.route_id)
      assert_redirected_to repository_path(repository.route_id)
      assert_equal 2, Build.count

      get repository_new_prototype_path(repository.route_id), as: :json
      assert_response :success
      assert_equal "copy", JSON.parse(response.body).fetch("data").fetch("submissionMode")
      post repository_workflow_installation_path(repository.route_id)
      assert_response :not_found
      post github_authentication_path
      assert_response :not_found
      get setup_path
      assert_response :not_found
    end
  end

  test "background scans only queue changed commits and register new repositories" do
    path = create_repository("one")
    git!(path, "checkout", "-b", "prototype/welcome")
    git!(path, "commit", "--allow-empty", "-m", "prototype")

    in_local_mode do
      post local_authentication_path
      repository = Repository.find_by!(name_with_owner: "local/one")

      assert_enqueued_jobs 2, only: Build::BuildLocalPackageJob do
        Repository::LocalDiscovery.refresh_all!
      end

      build = repository.prototypes.find_by!(branch_name: "prototype/welcome").builds.sole
      assert_equal git!(path, "rev-parse", "HEAD"), build.commit_sha
      assert_equal "queued", build.state

      assert_no_enqueued_jobs only: Build::BuildLocalPackageJob do
        Repository::LocalDiscovery.refresh_all!
      end
      assert_equal [ build.id ], repository.prototypes.find_by!(branch_name: "prototype/welcome").builds.pluck(:id)

      git!(path, "commit", "--allow-empty", "-m", "another prototype")
      assert_enqueued_jobs 1, only: Build::BuildLocalPackageJob do
        Repository::LocalDiscovery.refresh_all!
      end
      assert_equal 2, repository.prototypes.find_by!(branch_name: "prototype/welcome").builds.count

      second_path = create_repository("two")
      Repository::LocalDiscovery.refresh_all!
      assert_equal "local/two", Repository.find_by!(local_path: second_path.to_s).name_with_owner

      get repository_path(repository.route_id)
      assert_response :success
      assert_not_includes response.body, "Refresh branches"
      assert_includes response.body, repository_prototype_management_path(repository.route_id)
    end
  end

  test "local alerts persist observations and expire without using commit dates" do
    path = create_repository("one")
    git!(path, "checkout", "-b", "prototype/welcome")
    git!(path, "commit", "--allow-empty", "--date=2000-01-01T00:00:00Z", "-m", "old commit")
    first_sha = git!(path, "rev-parse", "HEAD")

    in_local_mode do
      post local_authentication_path
      repository = Repository.find_by!(name_with_owner: "local/one")
      user = User.local_developer!
      observed_at = Time.current.change(usec: 0)
      travel_to observed_at do
        Repository::LocalDiscovery.refresh_all!
        prototype = repository.reviewable_prototypes.sole
        assert_equal observed_at, prototype.local_head_observed_at
        assert_equal [ prototype ], repository.prototype_candidates.recently_active_by(user, permission: "admin")
        assert_empty repository.prototype_candidates.recently_active_by(user, permission: "read")
        assert_empty repository.prototype_candidates.recently_active_by(users.create, permission: "admin")
      end

      travel_to observed_at + 11.hours do
        Repository::LocalDiscovery.register_repositories!
        repository.reload.local_discovery.refresh!(requeue_pending: true)
        assert_equal observed_at, repository.reviewable_prototypes.sole.local_head_observed_at
        assert_equal 1, repository.reload.prototype_candidates.recently_active_by(user, permission: "admin").size
      end

      travel_to observed_at + 12.hours do
        Repository::LocalDiscovery.refresh_all!
        assert_empty repository.reload.prototype_candidates.recently_active_by(user, permission: "admin")
        assert_equal 1, repository.prototype_candidates.available_page(user, permission: "admin").first.size
        assert_equal observed_at, repository.reviewable_prototypes.sole.local_head_observed_at
      end

      travel_to observed_at + 13.hours do
        git!(path, "commit", "--allow-empty", "--date=2000-01-01T00:00:00Z", "-m", "changed head")
        Repository::LocalDiscovery.refresh_all!
        assert_equal Time.current, repository.reviewable_prototypes.sole.local_head_observed_at
        assert_equal 1, repository.prototype_candidates.recently_active_by(user, permission: "admin").size
        assert_equal 2, repository.reviewable_prototypes.sole.builds.count
      end

      travel_to observed_at + 14.hours do
        git!(path, "reset", "--hard", first_sha)
        Repository::LocalDiscovery.refresh_all!
        assert_equal Time.current, repository.reviewable_prototypes.sole.local_head_observed_at
        assert_equal first_sha, repository.reviewable_prototypes.sole.current_build.commit_sha
        assert_equal 2, repository.reviewable_prototypes.sole.builds.count
        git!(path, "checkout", "main")
        git!(path, "branch", "-D", "prototype/welcome")
        assert_empty repository.prototype_candidates.recently_active_by(user, permission: "admin")
      end
    end
  end

  test "existing local Builds receive one first observation without changing history or registration" do
    path = create_repository("one")
    git!(path, "checkout", "-b", "prototype/welcome")

    in_local_mode do
      post local_authentication_path
      repository = Repository.find_by!(name_with_owner: "local/one")
      Repository::LocalDiscovery.refresh_all!
      prototype = repository.reviewable_prototypes.sole
      build = prototype.current_build
      prototype.update!(local_head_observed_at: nil)

      Repository::LocalDiscovery.refresh_all!
      observed_at = prototype.reload.local_head_observed_at
      assert_not_nil observed_at
      assert_equal [ build.id ], prototype.builds.pluck(:id)

      post repository_prototype_registration_path(repository.route_id, prototype),
        params: { _method: "patch", intent: "register_only", return_to: "repository",
          prototype: { name: prototype.branch_name } }
      assert_response :see_other
      assert_redirected_to repository_path(repository.route_id)
      assert_equal User.local_developer!, prototype.reload.author
      registered_at = prototype.registered_at

      git!(path, "commit", "--allow-empty", "-m", "registered change")
      Repository::LocalDiscovery.refresh_all!
      assert_empty repository.prototype_candidates.recently_active_by(User.local_developer!, permission: "admin")
      assert_equal registered_at, prototype.reload.registered_at
      assert_equal 2, prototype.builds.count
    end
  end

  test "a stale local direct-add alert preserves custom metadata and its first author" do
    path = create_repository("one")
    git!(path, "checkout", "-b", "prototype/welcome")

    in_local_mode do
      post local_authentication_path
      repository = Repository.find_by!(name_with_owner: "local/one")
      Repository::LocalDiscovery.refresh_all!
      prototype = repository.reviewable_prototypes.sole
      registration_path = repository_prototype_registration_path(repository.route_id, prototype)
      get repository_path(repository.route_id)
      assert_includes response.body, "Hub detected prototype/welcome locally."

      patch registration_path, params: {
        prototype: { name: "Custom local title", description: "Local details", start_page: "/local" }
      }
      assert_redirected_to repository_prototype_management_path(repository.route_id)
      saved = prototype.reload.attributes
      assert_equal User.local_developer!, prototype.author

      post registration_path, params: {
        _method: "patch", intent: "register_only", return_to: "repository",
        prototype: { name: prototype.branch_name }
      }

      assert_redirected_to repository_path(repository.route_id)
      assert_equal saved, prototype.reload.attributes
    end
  end

  test "local discovery imports committed metadata and never replaces a Hub setting" do
    path = create_repository("one")
    git!(path, "checkout", "-b", "prototype/welcome")
    File.write(path.join(".prototype"), { startPage: "/committed" }.to_json)
    git!(path, "add", ".prototype")
    git!(path, "commit", "-m", "Set start page")
    File.write(path.join(".prototype"), { startPage: "/uncommitted" }.to_json)

    in_local_mode do
      post local_authentication_path
      Repository::LocalDiscovery.refresh_all!
      prototype = Repository.find_by!(name_with_owner: "local/one").reviewable_prototypes.sole
      prototype.current_build.import_start_page!
      assert_equal "/committed", prototype.reload.start_page

      prototype.register!(name: "Welcome", start_page: "")
      git!(path, "add", ".prototype")
      git!(path, "commit", "-m", "Change file after Hub takes ownership")
      Repository::LocalDiscovery.refresh_all!
      prototype.reload.current_build.import_start_page!
      assert_nil prototype.reload.start_page
      assert_not_nil prototype.start_page_set_at
    end
  end

  test "a branch takes its start page from its own first commit, not the default branch's" do
    path = create_repository("alerts")
    File.write(path.join(".prototype"), { startPage: "/#/default-page" }.to_json)
    git!(path, "add", ".prototype")
    git!(path, "commit", "-m", "Set the default start page")
    git!(path, "branch", "prototype/alerts")

    in_local_mode do
      post local_authentication_path
      Repository::LocalDiscovery.refresh_all!
      prototype = Repository.find_by!(name_with_owner: "local/alerts").reviewable_prototypes.sole
      prototype.current_build.import_start_page!
      assert_nil prototype.reload.start_page
      assert_nil prototype.start_page_set_at

      git!(path, "checkout", "prototype/alerts")
      File.write(path.join(".prototype"), { startPage: "/#/alerts" }.to_json)
      git!(path, "commit", "-am", "Open at the alerts page")
      Repository::LocalDiscovery.refresh_all!
      prototype.reload.current_build.import_start_page!
      assert_equal "/#/alerts", prototype.reload.start_page
    end
  end

  test "a Git error while comparing with the default branch leaves the start page for a retry" do
    path = create_repository("renamed")
    File.write(path.join(".prototype"), { startPage: "/#/default-page" }.to_json)
    git!(path, "add", ".prototype")
    git!(path, "commit", "-m", "Set the default start page")
    git!(path, "branch", "prototype/renamed")

    in_local_mode do
      post local_authentication_path
      Repository::LocalDiscovery.refresh_all!
      prototype = Repository.find_by!(name_with_owner: "local/renamed").reviewable_prototypes.sole
      git!(path, "branch", "-m", "main", "trunk")

      assert_raises(LocalDevelopment::Error) { prototype.current_build.import_start_page! }
      assert_nil prototype.reload.start_page
      assert_nil prototype.start_page_set_at
      assert_nil prototype.current_build.reload.start_page_checked_at
    end
  end

  test "Browse uses a local default Build at root with prompt copying instead of Copilot creation" do
    path = create_repository("browse", buildable: true)
    File.write(path.join(".prototype"), { startPage: "/ignored" }.to_json)
    git!(path, "add", ".")
    git!(path, "commit", "-m", "default metadata")

    in_local_mode do
      post local_authentication_path
      repository = Repository.find_by!(local_path: path.to_s)
      get repository_replica_browse_path(repository.route_id), as: :json
      assert_response :success
      data = JSON.parse(response.body).fetch("data")
      assert_equal repository_new_prototype_path(repository.route_id), data.fetch("newPrototypePath")
      assert_equal "copy", data.fetch("branchSubmissionMode")
      assert_equal I18n.t("new_prototypes.show.copy_prompt_label"), data.fetch("branchSubmitLabel")
      assert_equal I18n.t("new_prototypes.show.copied_label"), data.fetch("branchContinuation").fetch("copiedLabel")
      assert_equal I18n.t("new_prototypes.show.copy_error_label"), data.fetch("branchContinuation").fetch("copyErrorLabel")
      assert_includes data.fetch("branchInstructions"),
        "Create a new prototype branch from the repository's default branch."
      assert_includes data.fetch("branchInstructions"), "Do not change the default branch."
      assert_equal I18n.t("prototype_prompts.viewed_page", route: "%{route}"),
        data.fetch("branchPageInstructions")
      assert_equal "Create", data.fetch("newPrototypeLabel")
      assert_equal "new", data.fetch("selectedSection")
      assert_not data.key?("browseReplicaPath")
      assert_not data.key?("selectedBuild")
      assert_not data.key?("controlsIdentity")
      assert_equal false, data.fetch("minimizedPreview")
      assert_not data.key?("openInNewTabLabel")

      assert_no_enqueued_jobs only: Build::ImportStartPageJob do
        repository.local_discovery.refresh!
      end
      build = repository.replica_build_owner.builds.sole
      assert_predicate build.prototype, :replica?
      build.import_start_page!
      assert_nil build.prototype.reload.start_page
      assert_nil build.reload.start_page_checked_at
      build.build_local_package!
      assert_equal "successful", build.reload.state, build.failure_summary
      get repository_new_prototype_path(repository.route_id), as: :json
      assert_response :success
      creation = JSON.parse(response.body).fetch("data")
      assert_equal [ "default" ], creation.fetch("templates").pluck("id")
      assert_equal repository_template_path(repository.route_id, "default"),
        creation.fetch("templates").first.fetch("path")
      assert_equal "copy", creation.fetch("submissionMode")
      get repository_replica_browse_path(repository.route_id), as: :json
      assert_response :success
      data = JSON.parse(response.body).fetch("data")
      assert_equal "copy", data.fetch("branchSubmissionMode")
      assert_equal I18n.t("new_prototypes.show.copy_prompt_label"), data.fetch("branchSubmitLabel")
      assert_equal PreviewOrigin.current.url(build.id),
        data.fetch("selectedBuild").fetch("previewUrl")
      controls_identity = data.fetch("controlsIdentity")
      assert_match(/\A[0-9a-f]{64}\z/, controls_identity)
      assert_empty repository.reviewable_prototypes
      assert_empty repository.analytics_events

      destination = "/settings?tab=profile#details"
      get repository_replica_browse_path(repository.route_id),
        params: { return_path: destination, build: "ignored", before: "ignored", view: "minimized" }, as: :json
      assert_response :success
      data = JSON.parse(response.body).fetch("data")
      assert_equal "#{PreviewOrigin.current.url(build.id)}#{destination.delete_prefix('/')}",
        data.fetch("selectedBuild").fetch("previewUrl")
      assert_equal "copy", data.fetch("branchSubmissionMode")
      assert_not data.key?("reviewComments")
      assert_not data.key?("reviewCommentsPath")
      assert_not data.key?("openInNewTabLabel")
      assert_equal true, data.fetch("minimizedPreview")
      assert_equal I18n.t("prototypes.show.minimize_hub"), data.fetch("minimizeHubLabel")
      assert_equal I18n.t("prototypes.show.maximize_hub"), data.fetch("maximizeHubLabel")
      assert_equal I18n.t("prototypes.show.drag_controls"), data.fetch("dragControlsLabel")

      get repository_template_path(repository.route_id, "default"),
        params: { return_path: destination, build: "ignored", before: "ignored", view: "minimized" }, as: :json
      assert_response :success
      data = JSON.parse(response.body).fetch("data")
      assert_equal "default", data.fetch("templateId")
      assert_equal controls_identity, data.fetch("controlsIdentity")
      assert_equal "#{PreviewOrigin.current.url(build.id)}#{destination.delete_prefix('/')}",
        data.fetch("selectedBuild").fetch("previewUrl")
      assert_equal "copy", data.fetch("branchSubmissionMode")
      assert_equal true, data.fetch("minimizedPreview")
      assert_not data.key?("templateLandingPageInstructions")
      assert_not data.key?("reviewComments")

      get preview_build_authorization_path(build.id), params: { return_path: destination }
      assert_response :redirect
      grant = Rack::Utils.parse_query(URI(response.location).query).fetch("grant")
      host! "b#{build.id}.preview.replica.localhost:19500"
      get "/__replica/authorize", params: { grant: }
      assert_redirected_to destination
      get "/settings", params: { tab: "profile" }
      assert_response :success
      assert_includes response.body, "Local preview"
      assert_includes response.body, PreviewPathRouting::PUBLIC_CONTROLS_PATH
      get PreviewPathRouting::PUBLIC_CONTROLS_PATH
      assert_response :success
    end
  end

  test "local discovery follows a renamed default without exposing its previous owner" do
    path = create_repository("renamed")
    in_local_mode do
      post local_authentication_path
      repository = Repository.find_by!(local_path: path.to_s)
      repository.local_discovery.refresh!
      previous = repository.replica_build_owner
      git!(path, "branch", "-m", "trunk")
      repository.local_discovery.refresh!

      assert_equal "trunk", repository.reload.default_branch
      assert_predicate repository.replica_build_owner, :replica?
      assert_predicate previous.reload, :replica?
      assert_empty repository.reviewable_prototypes
      get repository_replica_browse_path(repository.route_id), as: :json
      assert_equal "trunk", JSON.parse(response.body).fetch("data").fetch("branchName")
    end
  end

  test "a missing default does not turn a discovered prototype into the replica" do
    path = create_repository("missing-default")
    git!(path, "branch", "-m", "trunk")

    in_local_mode do
      post local_authentication_path
      repository = Repository.find_by!(local_path: path.to_s)
      repository.local_discovery.refresh!
      git!(path, "checkout", "-b", "prototype/welcome")
      git!(path, "commit", "--allow-empty", "-m", "welcome")
      repository.local_discovery.refresh!
      prototype = repository.reviewable_prototypes.sole
      prototype.register!(name: "Welcome")
      git!(path, "branch", "-D", "trunk")

      repository.local_discovery.refresh!

      assert_equal "trunk", repository.reload.default_branch
      assert_predicate prototype.reload, :registered?
      assert_predicate prototype, :reviewable?
      assert_not_predicate prototype, :replica?
      assert_equal prototype, repository.reviewable_prototypes.sole

      git!(path, "branch", "trunk", "#{prototype.branch_name}~1")
      repository.local_discovery.refresh!
      assert_predicate prototype.reload, :registered?
      assert_predicate prototype, :reviewable?
      assert_not_predicate prototype, :replica?
    end
  end

  test "a missing default does not block discovery while HEAD is detached" do
    path = create_repository("detached")
    git!(path, "branch", "-m", "trunk")

    in_local_mode do
      post local_authentication_path
      repository = Repository.find_by!(local_path: path.to_s)
      repository.local_discovery.refresh!
      git!(path, "checkout", "-b", "prototype/welcome")
      git!(path, "commit", "--allow-empty", "-m", "welcome")
      repository.local_discovery.refresh!
      prototype = repository.reviewable_prototypes.sole
      prototype.register!(name: "Welcome")
      git!(path, "checkout", "--detach")
      git!(path, "branch", "-D", "trunk")
      git!(path, "branch", "prototype/another")

      assert_enqueued_jobs 1, only: Build::BuildLocalPackageJob do
        repository.local_discovery.refresh!
      end

      assert_equal "trunk", repository.reload.default_branch
      assert_predicate prototype.reload, :registered?
      assert_predicate prototype, :reviewable?
      assert_not_predicate prototype, :replica?
      assert_equal %w[prototype/another prototype/welcome],
        repository.reviewable_prototypes.order(:branch_name).pluck(:branch_name)
    end
  end

  test "a conventional branch already discovered as a prototype is not adopted as default" do
    path = create_repository("conventional-prototype")
    git!(path, "branch", "-m", "trunk")

    in_local_mode do
      post local_authentication_path
      repository = Repository.find_by!(local_path: path.to_s)
      repository.local_discovery.refresh!
      git!(path, "checkout", "-b", "main")
      git!(path, "commit", "--allow-empty", "-m", "prototype")
      repository.local_discovery.refresh!
      prototype = repository.reviewable_prototypes.sole
      git!(path, "branch", "-D", "trunk")

      repository.local_discovery.refresh!

      assert_equal "trunk", repository.reload.default_branch
      assert_predicate prototype.reload, :reviewable?
      assert_not_predicate prototype, :replica?
      assert_not_predicate prototype, :registered?
    end
  end

  test "an unregistered detached checkout needs an explicit default branch" do
    path = create_repository("unregistered-detached")
    git!(path, "branch", "-m", "trunk")
    git!(path, "checkout", "--detach")

    in_local_mode do
      post local_authentication_path

      assert_redirected_to root_path
      assert_includes flash[:alert], "Check out a default branch"
      assert_not Repository.exists?(local_path: path.to_s)
    end
  end

  test "a broken checkout does not block discovery for another repository" do
    broken = create_repository("broken")

    in_local_mode do
      post local_authentication_path
      File.open(broken.join(".git/config"), "a") { |file| file.write("\n[broken\n") }
      uncommitted = @root.join("uncommitted")
      FileUtils.mkdir_p(uncommitted)
      git!(uncommitted, "init", "-b", "main")
      healthy = create_repository("healthy")
      git!(healthy, "checkout", "-b", "prototype/welcome")
      git!(healthy, "commit", "--allow-empty", "-m", "welcome")

      Repository::LocalDiscovery.refresh_all!

      repository = Repository.find_by!(name_with_owner: "local/healthy")
      assert_equal 1, repository.prototypes.find_by!(branch_name: "prototype/welcome").builds.count
      assert_nil Repository.find_by(local_path: uncommitted.to_s)
    end
  end

  test "background scan discovers a replacement checkout at the same path" do
    path = create_repository("one")
    git!(path, "checkout", "-b", "prototype/old")

    in_local_mode do
      post local_authentication_path
      old = Repository.find_by!(name_with_owner: "local/one")
      Repository::LocalDiscovery.refresh_all!
      assert old.prototypes.find_by!(branch_name: "prototype/old").builds.exists?

      FileUtils.rm_rf(path)
      replacement_path = create_repository("one")
      git!(replacement_path, "checkout", "-b", "prototype/new")

      Repository::LocalDiscovery.refresh_all!

      replacement = Repository.active.find_by!(name_with_owner: "local/one")
      assert_not_equal old.id, replacement.id
      assert_equal "removed", old.reload.installation_state
      assert_nil replacement.prototypes.find_by(branch_name: "prototype/old")
      assert replacement.prototypes.find_by!(branch_name: "prototype/new").builds.exists?
    end
  end

  test "a failed build explains the problem and removes its worktree" do
    path = create_repository("one")
    git!(path, "checkout", "-b", "prototype/broken")

    in_local_mode do
      post local_authentication_path
      repository = Repository.find_by!(name_with_owner: "local/one")
      post poll_repository_path(repository.route_id)
      build = repository.prototypes.find_by!(branch_name: "prototype/broken").builds.sole

      build.build_local_package!

      assert_equal "failed", build.reload.state
      assert_includes build.failure_summary, "package.json"
      assert_equal 1, git!(path, "worktree", "list", "--porcelain").scan(/^worktree /).size
      assert_not ArtifactStore.current.exist?("builds/#{build.id}/dist/index.html")
    end
  end

  test "missing cached dependencies fail without querying the registry" do
    path = create_repository("one", buildable: true)
    dependency = "replica-missing-#{SecureRandom.hex(8)}"
    package = JSON.parse(File.read(path.join("package.json")))
    package["dependencies"] = { dependency => "1.0.0" }
    lock = JSON.parse(File.read(path.join("package-lock.json")))
    lock["packages"][""]["dependencies"] = package["dependencies"]
    lock["packages"]["node_modules/#{dependency}"] = {
      "version" => "1.0.0",
      "resolved" => "https://registry.npmjs.org/#{dependency}/-/#{dependency}-1.0.0.tgz",
      "integrity" => "sha512-#{Base64.strict_encode64("missing" * 10)}"
    }
    File.write(path.join("package.json"), JSON.generate(package))
    File.write(path.join("package-lock.json"), JSON.generate(lock))
    git!(path, "checkout", "-b", "prototype/missing-dependency")
    git!(path, "add", ".")
    git!(path, "commit", "-m", "add uncached dependency")

    in_local_mode do
      post local_authentication_path
      repository = Repository.find_by!(name_with_owner: "local/one")
      post poll_repository_path(repository.route_id)
      build = repository.prototypes.find_by!(branch_name: "prototype/missing-dependency").builds.sole

      build.build_local_package!

      assert_equal "failed", build.reload.state
      assert_includes build.failure_summary, "missing from the local cache"
      assert_equal 1, git!(path, "worktree", "list", "--porcelain").scan(/^worktree /).size
    end
  end

  test "a cleanup error cannot publish a local build" do
    path = create_repository("one", buildable: true)
    git!(path, "checkout", "-b", "prototype/cleanup")

    in_local_mode do
      post local_authentication_path
      repository = Repository.find_by!(name_with_owner: "local/one")
      post poll_repository_path(repository.route_id)
      build = repository.prototypes.find_by!(branch_name: "prototype/cleanup").builds.sole
      package = build.local_package
      original_run = package.method(:run!)
      package.define_singleton_method(:run!) do |*arguments, **options|
        original_run.call(*arguments, **options)
        if arguments.first == "git" && arguments.include?("remove")
          raise LocalDevelopment::Error, "Could not finish worktree cleanup"
        end
      end

      package.create!

      assert_equal "failed", build.reload.state
      assert_includes build.failure_summary, "Could not finish worktree cleanup"
      assert_not ArtifactStore.current.exist?("builds/#{build.id}/dist/index.html")
      assert_equal 1, git!(path, "worktree", "list", "--porcelain").scan(/^worktree /).size
    end
  end

  test "artifact cleanup errors do not leave a failed build running" do
    path = create_repository("one")
    git!(path, "checkout", "-b", "prototype/broken")

    in_local_mode do
      post local_authentication_path
      repository = Repository.find_by!(name_with_owner: "local/one")
      post poll_repository_path(repository.route_id)
      build = repository.prototypes.find_by!(branch_name: "prototype/broken").builds.sole
      artifact_store = ArtifactStore.current
      artifact_store.define_singleton_method(:delete_prefix) do |_prefix|
        raise "artifact cleanup failed"
      end

      build.local_package.create!(artifact_store:)

      assert_equal "failed", build.reload.state
      assert_includes build.failure_summary, "package.json"
      assert build.finished_at
    end
  end

  test "refresh redirects back with a visible error when Git fails" do
    create_repository("one")

    in_local_mode do
      post local_authentication_path
      repository = Repository.find_by!(name_with_owner: "local/one")
      original = Repository::LocalDiscovery.instance_method(:refresh!)
      Repository::LocalDiscovery.define_method(:refresh!) do |**_options|
        raise LocalDevelopment::Error, "Cannot read local branches."
      end

      post poll_repository_path(repository.route_id)

      assert_redirected_to repository_path(repository.route_id)
      assert_response :see_other
      assert_equal "Cannot read local branches.", flash[:alert]
    ensure
      Repository::LocalDiscovery.define_method(:refresh!, original) if original
    end
  end

  test "removing a configured checkout revokes repository access" do
    path = create_repository("one")

    in_local_mode do
      post local_authentication_path
      repository = Repository.find_by!(name_with_owner: "local/one")
      FileUtils.rm_rf(path)

      post poll_repository_path(repository.route_id)
      assert_response :unprocessable_entity
      assert_includes response.body, "no longer configured"

      get repository_path(repository.route_id)
      assert_response :not_found
      get repositories_path
      assert_response :not_found
      assert_equal "removed", repository.reload.installation_state
    end
  end

  test "replacing a checkout at the same path cannot reuse old reviews or Builds" do
    path = create_repository("one")
    git!(path, "checkout", "-b", "prototype/old")

    in_local_mode do
      post local_authentication_path
      old = Repository.find_by!(name_with_owner: "local/one")
      old_identity = old.local_identity
      assert_equal old_identity, git!(path, "config", "--local", "--get", LocalDevelopment::REPOSITORY_ID_KEY)
      assert_not_includes git!(path, "ls-files"), ".git/config"
      post poll_repository_path(old.route_id)
      prototype = old.prototypes.find_by!(branch_name: "prototype/old")
      build = prototype.builds.sole

      FileUtils.rm_rf(path)
      create_repository("one")

      get repository_path(old.route_id)
      assert_response :not_found
      post poll_repository_path(old.route_id)
      assert_response :unprocessable_entity
      build.local_package.create!
      assert_equal "failed", build.reload.state
      assert_includes build.failure_summary, "no longer configured"

      post local_authentication_path
      replacement = Repository.active.find_by!(name_with_owner: "local/one")
      assert_not_equal old.id, replacement.id
      assert_not_equal old_identity, replacement.local_identity
      assert_equal "removed", old.reload.installation_state
      assert_empty replacement.prototypes
      get repository_path(old.route_id)
      assert_response :not_found
      get repository_path(replacement.route_id)
      assert_response :success
    end
  end

  test "an existing local repository keeps its Builds when first assigned an identity" do
    path = create_repository("one")
    git!(path, "checkout", "-b", "prototype/old")

    in_local_mode do
      post local_authentication_path
      repository = Repository.find_by!(name_with_owner: "local/one")
      post poll_repository_path(repository.route_id)
      build = repository.prototypes.find_by!(branch_name: "prototype/old").builds.sole

      repository.update_columns(local_identity: nil)
      git!(path, "config", "--local", "--unset", LocalDevelopment::REPOSITORY_ID_KEY)
      get repository_path(repository.route_id)
      assert_response :not_found

      post local_authentication_path

      assert_equal repository.id, Repository.active.find_by!(name_with_owner: "local/one").id
      assert_equal build, repository.prototypes.find_by!(branch_name: "prototype/old").builds.sole
      assert_equal repository.reload.local_identity,
        git!(path, "config", "--local", "--get", LocalDevelopment::REPOSITORY_ID_KEY)
    end
  end

  test "loads local management sections independently and rechecks branch existence before registration" do
    path = create_repository("management")
    git!(path, "branch", "prototype/local")

    in_local_mode do
      post local_authentication_path
      repository = Repository.find_by!(name_with_owner: "local/management")
      prototype = prototypes.create(repository:, branch_name: "prototype/local")
      management_path = repository_prototype_management_path(repository.route_id)

      get management_path
      assert_response :success
      assert_includes response.body, '"unlisted":[]'

      get management_path, params: { props_at: "data.repositoryChoices" }, as: :json
      assert_response :success
      assert_includes response.body, '"path":"data.repositoryChoices"'
      assert_includes response.body, "local/management"
      assert_not_includes response.body, "prototype/local"

      get management_path, params: { props_at: "data.management" }, as: :json
      assert_response :success
      assert_includes response.body, '"branchName":"prototype/local"'
      git!(path, "branch", "-D", "prototype/local")

      patch repository_prototype_registration_path(repository.route_id, prototype),
        params: { prototype: { name: "Deleted locally" } }
      assert_response :not_found
      assert_not prototype.reload.registered?
    end
  end

  test "builds an exact commit and lists it after registration without changing the checkout" do
    SharingSetting.create!(id: 1, public_sharing_enabled: true)
    path = create_repository("one", buildable: true)
    git!(path, "checkout", "-b", "prototype/welcome")
    git!(path, "commit", "--allow-empty", "-m", "prototype")
    sha = git!(path, "rev-parse", "HEAD")

    in_local_mode do
      post local_authentication_path
      repository = Repository.find_by!(name_with_owner: "local/one")
      post poll_repository_path(repository.route_id)
      build = repository.prototypes.find_by!(branch_name: "prototype/welcome").builds.sole
      File.write(path.join("index.txt"), "uncommitted edit")
      build.build_local_package!

      assert_equal "successful", build.reload.state, build.failure_summary
      assert_nil build.github_artifact_id
      assert build.local_package_completed_at
      assert ArtifactStore.current.exist?("builds/#{build.id}/dist/index.html")
      assert ArtifactStore.current.exist?("builds/#{build.id}/screenshots/desktop.png")
      get repository_path(repository.route_id)
      assert_response :success
      assert_includes response.body, '"prototypes":[]'
      assert_includes response.body, '"recentBranches":[{'
      assert_includes response.body, "Hub detected prototype/welcome locally. Add it to Hub?"
      assert_includes response.body, "Manage prototypes"

      post repository_prototype_branch_banner_dismissal_path(repository.route_id, build.prototype)
      assert_response :see_other
      follow_redirect!
      assert_includes response.body, '"recentBranches":[]'
      assert_not build.prototype.reload.registered?

      build.prototype.update!(local_head_observed_at: Time.current)
      get repository_path(repository.route_id)
      assert_includes response.body, '"recentBranches":[]'

      get repository_prototype_management_path(repository.route_id)
      assert_response :success
      assert_includes response.body, '"unlisted":[]'
      get repository_prototype_management_path(repository.route_id),
        params: { props_at: "data.management" },
        headers: { "Accept" => "application/json" }
      assert_response :success
      assert_includes response.body, "prototype/welcome"

      patch repository_prototype_registration_path(repository.route_id, build.prototype),
        params: { prototype: { name: "Welcome", description: "A local preview" } }
      assert_response :see_other
      assert_redirected_to repository_prototype_management_path(repository.route_id)
      follow_redirect!
      assert_includes response.body, '"name":"Welcome"'
      assert_includes response.body, '"description":"A local preview"'

      get repository_path(repository.route_id)
      assert_includes response.body, '"prototypes":[{'
      assert_includes response.body, '"avatarUrl":"/local-developer-avatar.svg"'
      assert_includes response.body, '"ownerLabel":"@local"'
      assert_equal build, build.prototype.reload.current_build

      get repository_prototype_build_screenshot_path(repository.route_id, build.prototype, build.number, "desktop")
      assert_response :success
      get repository_prototype_path(repository.route_id, build.prototype), as: :json
      assert_response :success
      assert_includes response.body, PreviewOrigin.current.url(build.id)
      assert_includes response.body, '"detailsEditPath":'
      review = JSON.parse(response.body).fetch("data")
      assert_equal repository_new_prototype_path(repository.route_id), review.fetch("newPrototypePath")
      assert_equal "disabled", review.fetch("branchSubmissionMode")
      get repository_prototype_builds_path(repository.route_id, build.prototype),
        headers: { "Accept" => "application/json" }
      assert_response :success
      history = JSON.parse(response.body).fetch("data")
      assert_equal repository.route_id.to_s, history.fetch("selectedRepositoryId")
      assert_equal repository_new_prototype_path(repository.route_id), history.fetch("newPrototypePath")
      assert_equal repository.route_id.to_s, history.fetch("repositories").first.fetch("id")
      assert_not history.key?("shareLinksPath")

      get repository_prototype_build_path(repository.route_id, build.prototype, build.number),
        headers: { "Accept" => "application/json" }
      assert_response :success
      details = JSON.parse(response.body).fetch("data")
      assert_equal repository.route_id.to_s, details.fetch("selectedRepositoryId")
      assert_equal build.number, details.fetch("selectedBuild").fetch("number")
      assert_not build.prototype.share_links_manageable_by?(
        User.find_by!(github_id: nil), repository_permission: "admin"
      )

      share_path = repository_prototype_share_links_path(repository.route_id, build.prototype)
      get share_path
      assert_response :not_found
      post share_path, params: {
        share_link: { build_number: build.number, label: "Local share" }
      }
      assert_response :not_found
      link = ShareLink.new \
        prototype: build.prototype,
        build: build,
        created_by: User.find_by!(github_id: nil),
        label: "Previously saved local link",
        public_id: SecureRandom.uuid
      assert_not link.valid?
      assert_includes link.errors[:prototype], "must use a GitHub repository"
      link.save!(validate: false)
      get shared_build_path(link.public_id)
      assert_response :not_found

      assert_equal "uncommitted edit", File.read(path.join("index.txt"))
      assert_equal sha, git!(path, "rev-parse", "HEAD")
      assert_equal 1, git!(path, "worktree", "list", "--porcelain").scan(/^worktree /).size
    ensure
      ArtifactStore.current.delete_prefix("builds/#{build.id}") if build
    end
  end

  test "a local repository's Learnings page says what a suggestion needs in local development" do
    learning_root = Rails.configuration.x.learning_root
    temporary_learning_root = Dir.mktmpdir("replica-learning-")
    Rails.configuration.x.learning_root = Pathname(temporary_learning_root)
    path = create_repository("learnings")

    in_local_mode do
      post local_authentication_path
      repository = Repository.find_by!(local_path: path.to_s)
      get repository_learnings_path(repository.route_id), as: :json

      assert_response :success
      data = JSON.parse(response.body).fetch("data")
      assert_equal repository_new_prototype_path(repository.route_id), data.fetch("newPrototypePath")
      assert_equal I18n.t("repository_workspace.repositories"), data.fetch("repositoryMenuLabel")
      copy = data.fetch("copy")
      assert_equal I18n.t("learnings.suggestions.empty_local"), copy.fetch("suggestionsEmpty")
    end
  ensure
    begin
      FileUtils.rm_rf(temporary_learning_root) if temporary_learning_root
    ensure
      Rails.configuration.x.learning_root = learning_root if temporary_learning_root
    end
  end

  test "a failed local Learnings repository setup preserves the configured learning store" do
    original_root = Rails.configuration.x.learning_root
    Dir.mktmpdir("preserved-learning-root-") do |directory|
      root = Pathname(directory)
      root.join("keep.txt").write("preserved test data")
      Rails.configuration.x.learning_root = root
      name = self.class.runnable_methods.find { _1.include?("a_local_repository's_Learnings_page") }
      assert name
      probe = self.class.new(name)
      probe.define_singleton_method(:create_repository) { |*| flunk("simulated Git failure") }

      result = probe.run

      assert_equal 1, result.failures.size
      assert_includes result.failures.sole.message, "simulated Git failure"
      assert root.join("keep.txt").file?
      assert_equal root, Rails.configuration.x.learning_root
    ensure
      Rails.configuration.x.learning_root = original_root
    end
  end

  private

  def in_local_mode(&block)
    original_enabled = LocalDevelopment.method(:enabled?)
    original_root = LocalDevelopment.method(:repositories_root)
    original_artifact_root = Rails.configuration.x.artifact_root
    root = @root
    LocalDevelopment.define_singleton_method(:enabled?) { true }
    LocalDevelopment.define_singleton_method(:repositories_root) { root }
    Rails.configuration.x.artifact_root = @artifact_root
    host! "replica.localhost:19500"
    block.call
  ensure
    LocalDevelopment.define_singleton_method(:enabled?, original_enabled)
    LocalDevelopment.define_singleton_method(:repositories_root, original_root)
    Rails.configuration.x.artifact_root = original_artifact_root
  end

  def create_repository(name, buildable: false)
    path = @root.join(name)
    FileUtils.mkdir_p(path)
    git!(path, "init", "-b", "main")
    git!(path, "config", "user.name", "Local Test")
    git!(path, "config", "user.email", "local@example.invalid")
    File.write(path.join("index.txt"), "original")
    if buildable
      package = {
        name: "local-prototype", version: "1.0.0",
        scripts: {
          build: "node -e \"const fs = require('node:fs'); fs.mkdirSync('dist'); fs.writeFileSync('dist/index.html', '<html><body>Local preview</body></html>')\""
        }
      }
      File.write(path.join("package.json"), JSON.generate(package))
      File.write(path.join("package-lock.json"), JSON.generate(
        name: "local-prototype", version: "1.0.0", lockfileVersion: 3, requires: true,
        packages: { "" => { name: "local-prototype", version: "1.0.0" } }
      ))
    end
    git!(path, "add", ".")
    git!(path, "commit", "-m", "initial")
    path
  end

  def git!(path, *arguments)
    output, error, status = Open3.capture3("git", "-C", path.to_s, *arguments)
    assert status.success?, error
    output.strip
  end
end
