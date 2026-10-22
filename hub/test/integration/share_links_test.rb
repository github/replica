require "test_helper"
require_relative "../support/share_link_lifetime_helpers"

class ShareLinksTest < ActionDispatch::IntegrationTest
  include ShareLinkLifetimeHelpers
  test "preserves control URL context across creation and deletion without storing it on links" do
    control_query = URI.encode_www_form("rc.page.title" => '"Configured"')
    post @path, params: {
      control_query: control_query,
      share_link: { build_number: @build.number, label: "Configured", expiration: "seven_days" }
    }
    link = ShareLink.find_by!(label: "Configured")
    assert_redirected_to repository_prototype_share_links_path(
      @repository.github_id, @prototype, "rc.page.title" => '"Configured"'
    )
    delete repository_prototype_share_link_path(@repository.github_id, @prototype, link),
      params: { control_query: control_query }
    assert_redirected_to repository_prototype_share_links_path(
      @repository.github_id, @prototype, "rc.page.title" => '"Configured"'
    )
  end

  test "rejects invalid control context before creating a share link" do
    [ "return_path=https://evil.example", "rc.page.title=one&rc.page.title=two",
      "rc.__proto__.title=x", "rc.page.title=#{"x" * 8192}" ].each do |query|
      assert_no_difference "ShareLink.count" do
        post @path, params: {
          control_query: query,
          share_link: { build_number: @build.number, label: "Invalid", expiration: "never" }
        }
      end
      assert_response :bad_request
    end
  end

  setup do
    SharingSetting.create!(id: 1, public_sharing_enabled: true)
    host! "replica.localhost:19500"
    github_app_configurations.create_installed
    @repository_payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ @repository_payload ], permissions: { 2001 => "pull" })
    sign_in
    @user = User.find_by!(github_id: 1001)
    @repository = Repository.find_by!(github_id: 2001)
    @prototype = prototypes.create(repository: @repository)
    @build = builds.create_successful \
      prototype: @prototype,
      commit_author_name: "The Octocat",
      commit_author_github_id: @user.github_id,
      commit_author_login: "octocat",
      commit_author_checked_at: Time.current
    @path = repository_prototype_share_links_path(@repository.github_id, @prototype)
  end

  test "disabled sharing explains the policy and blocks even direct never expiring creation" do
    SharingSetting.first.update!(public_sharing_enabled: false)
    get @path, as: :json
    page = JSON.parse(response.body).fetch("data")
    assert_equal false, page.fetch("publicSharingEnabled")
    assert_empty page.fetch("shareLinks")
    assert_includes page.fetch("disabledLabel"), "disabled"
    assert_no_difference [ "ShareLink.count", "FreshAuthorization.count" ] do
      post @path, params: { share_link: { build_number: @build.number, label: "Blocked", expiration: "never" } }
    end
    assert_response :see_other
    assert_equal I18n.t("share_links.disabled"), flash[:alert]
    assert_equal "denied", SecurityAuditEvent.where(action: "share_link.create").last.outcome
  end

  test "creation page warns about public access to sensitive or customer information" do
    get @path, as: :json
    assert_response :success
    description = JSON.parse(response.body).fetch("data").fetch("description")
    assert_includes description, "Anyone with a link"
    assert_includes description, "without signing in"
    assert_includes description, "sensitive or customer information"
  end

  test "a policy change during GitHub authorization blocks creation even after re enabling" do
    original = Repository::Authorization.instance_method(:permission_for)
    Repository::Authorization.define_method(:permission_for) do |*args, **options|
      result = original.bind_call(self, *args, **options)
      setting = SharingSetting.first
      setting.update!(revision: setting.revision + 2)
      result
    end
    assert_no_difference("ShareLink.count") do
      post @path, params: { share_link: { build_number: @build.number, label: "In flight" } }
    end
    assert_equal I18n.t("share_links.policy_changed"), flash[:alert]
  ensure
    Repository::Authorization.define_method(:permission_for, original) if original
  end

  test "lets a successful Build author create and delete a public share link" do
    travel_to Time.current.change(usec: 0) do
      get @path, params: { build: @build.number }

      assert_response :success
      assert_includes response.body, "Share links"
      assert_includes response.body, "Build #{@build.number}"

      post @path,
        params: {
          management_build: @build.number,
          share_link: {
            build_number: @build.number,
            label: "Usability review",
            expiration: "seven_days"
          }
        }

      share_link = ShareLink.find_by!(label: "Usability review")
      assert_redirected_to repository_prototype_share_links_path \
        @repository.github_id,
        @prototype,
        build: @build.number
      assert_equal @build, share_link.build
      assert_equal @user, share_link.created_by
      assert_equal 7.days.from_now, share_link.expires_at

      follow_redirect!
      assert_includes response.body, shared_build_path(share_link.public_id)

      delete repository_prototype_share_link_path(@repository.github_id, @prototype, share_link),
        params: { management_build: @build.number }

      assert_redirected_to repository_prototype_share_links_path \
        @repository.github_id,
        @prototype,
        build: @build.number
      assert_not ShareLink.exists?(share_link.id)
    end
  end

  test "default sharing offers only permitted lifetimes and rejects longer choices before fresh proof" do
    assert_equal 7.days, Rails.configuration.x.share_link_maximum_lifetime
    legacy, old = with_share_link_maximum_lifetime(nil) do
      [
        create_share_link(label: "Legacy", expiration: "never"),
        create_share_link(label: "Too old", expiration: "thirty_days")
      ]
    end
    old.update_column(:created_at, 8.days.ago)
    with_share_link_maximum_lifetime(7.days) do
      get @path, as: :json
      assert_response :success
      data = JSON.parse(response.body).fetch("data")
      assert_equal %w[one_day seven_days],
        data.fetch("form").fetch("expirationOptions").map { |option| option.fetch("value") }
      assert_equal [ legacy.id ], data.fetch("shareLinks").map { |link| link.fetch("id") }
      assert_equal (legacy.created_at + 7.days).iso8601,
        data.fetch("shareLinks").first.fetch("expiresAt")
      %w[never thirty_days].each do |expiration|
        assert_no_difference [ "ShareLink.count", "FreshAuthorization.count" ] do
          post @path, params: {
            share_link: { build_number: @build.number, label: "Blocked", expiration: }
          }
        end
        assert_response :see_other
        assert_includes flash[:alert], "share-link policy"
      end
      %w[one_day seven_days].each do |expiration|
        post @path, params: {
          share_link: { build_number: @build.number, label: expiration, expiration: }
        }
        assert_response :see_other
        link = ShareLink.find_by!(label: expiration)
        assert_equal link.created_at + ShareLink.expiration_duration(expiration), link.expires_at
      end
    end
  end

  test "fresh authorization returns to Controls with the same default or explicit Build selection" do
    control_query = URI.encode_www_form("rc.page.title" => '"Configured"')
    session = Session.order(:id).last
    session.update!(fresh_authorized_at: FreshAuthorization::FRESHNESS.ago)
    assert_not FreshAuthorization.fresh?(session)

    with_share_link_maximum_lifetime(nil) do
      assert_no_difference "ShareLink.count" do
        post @path, params: {
          control_query:,
          share_link: { build_number: @build.number, label: "Default proof", expiration: "never" }
        }
      end
      default_challenge = FreshAuthorization.order(:id).last
      assert_redirected_to fresh_authorization_path(default_challenge.public_id)
      assert_equal \
        repository_prototype_share_links_path(
          @repository.github_id,
          @prototype,
          "rc.page.title" => '"Configured"'
        ),
        default_challenge.return_to

      assert_no_difference "ShareLink.count" do
        post @path, params: {
          control_query:,
          management_build: @build.number,
          share_link: { build_number: @build.number, label: "Pinned proof", expiration: "never" }
        }
      end
      pinned_challenge = FreshAuthorization.order(:id).last
      assert_redirected_to fresh_authorization_path(pinned_challenge.public_id)
      assert_equal \
        repository_prototype_share_links_path(
          @repository.github_id,
          @prototype,
          build: @build.number,
          "rc.page.title" => '"Configured"'
        ),
        pinned_challenge.return_to
    end
  end

  test "lets an author of an older successful Build share the selected Build" do
    newer = builds.create_successful \
      prototype: @prototype,
      commit_author_github_id: 1_002,
      number: 2,
      commit_sha: "b" * 40,
      commit_author_name: "The Octocat",
      commit_author_login: "mona",
      commit_author_checked_at: Time.current

    post @path,
      params: {
        share_link: {
          build_number: newer.number,
          label: "Newest review"
        }
      }

    assert_response :see_other
    assert_equal newer, ShareLink.find_by!(label: "Newest review").build
    assert_in_delta 7.days.from_now, ShareLink.find_by!(label: "Newest review").expires_at, 1.second
  end

  test "shows only active links" do
    active = create_share_link(label: "Active")
    expired = travel_to(2.days.ago) do
      create_share_link(label: "Expired", expiration: "one_day")
    end
    active.update_column(:expires_at, nil)

    get @path, params: { build: @build.number }

    assert_response :success
    assert_includes response.body, active.label
    assert_not_includes response.body, expired.label
  end

  test "checks current repository permission once with a cold workspace cache" do
    Rails.cache.clear
    WebMock.reset_executed_requests!

    get @path, params: { build: @build.number }

    assert_response :success
    assert_requested \
      :get,
      "#{GITHUB_API_URL}/repos/#{@repository.name_with_owner}/collaborators/#{@user.login}/permission",
      times: 1
  end

  test "keeps selected Build and workspace data on the management page" do
    older = @build
    newer = builds.create_successful \
      prototype: @prototype,
      number: 2,
      commit_sha: "b" * 40

    get @path, headers: { "Accept" => "application/json" }

    assert_response :success
    data = JSON.parse(response.body).fetch("data")
    assert_equal newer.number, data.fetch("selectedBuild").fetch("number")
    assert_equal repository_prototype_path(@repository.github_id, @prototype), data.fetch("branchPath")
    assert_equal data.fetch("branchPath"), data.fetch("closePath")
    assert_equal @path, data.fetch("shareLinksPath")
    assert_not data.key?("managementBuildNumber")

    get @path, params: { build: older.number }, headers: { "Accept" => "application/json" }

    assert_response :success
    data = JSON.parse(response.body).fetch("data")
    assert_equal @repository.route_id.to_s, data.fetch("selectedRepositoryId")
    assert_equal repository_new_prototype_path(@repository.github_id), data.fetch("newPrototypePath")
    assert_equal @repository.route_id.to_s, data.fetch("repositories").first.fetch("id")
    assert_equal older.number, data.fetch("selectedBuild").fetch("number")
    assert_equal I18n.t("share_links.index.build", number: older.number), data.fetch("form").fetch("buildLabel")
    assert_equal newer.number, data.fetch("latestBuild").fetch("number")
    assert_equal \
      repository_prototype_path(@repository.github_id, @prototype),
      data.fetch("branchPath")
    assert_equal \
      repository_prototype_path(@repository.github_id, @prototype, build: older.number),
      data.fetch("closePath")
    assert_equal @path + "?build=#{older.number}", data.fetch("shareLinksPath")
    assert_equal older.number, data.fetch("managementBuildNumber")
    assert_equal %w[detailsLabel detailsPath number], data.fetch("selectedBuild").keys.sort
    assert_not data.key?("reviewComments")
  end

  test "lets a repository administrator manage links without Build authorship" do
    stub_github_permissions([ @repository_payload ], { 2001 => "admin" })
    @build.update_columns \
      commit_author_name: "Mona Lisa",
      commit_author_github_id: 1_002,
      commit_author_login: "mona",
      commit_author_checked_at: Time.current

    get @path, params: { build: @build.number }

    assert_response :success
  end

  test "denies another repository reader" do
    @build.update_columns \
      commit_author_name: "Mona Lisa",
      commit_author_github_id: 1_002,
      commit_author_login: "mona",
      commit_author_checked_at: Time.current

    get @path, params: { build: @build.number }

    assert_response :not_found
  end

  test "denies a Build author who lost repository access" do
    stub_github_permissions([ @repository_payload ], { 2001 => nil })

    post @path,
      params: {
        share_link: {
          build_number: @build.number,
          label: "Unavailable",
          expiration: "seven_days"
        }
      }

    assert_response :not_found
    assert_not ShareLink.exists?(label: "Unavailable")
  end

  test "rejects an unfinished Build" do
    queued = builds.create \
      prototype: @prototype,
      number: 2,
      commit_sha: "b" * 40

    post @path,
      params: {
        share_link: {
          build_number: queued.number,
          label: "Queued",
          expiration: "seven_days"
        }
      }
    assert_response :not_found
  end

  test "rejects invalid management Builds before creating or deleting links" do
    queued = builds.create \
      prototype: @prototype,
      number: 2,
      commit_sha: "b" * 40
    link = create_share_link(label: "Retained")

    [ "0", "999", queued.number ].each do |management_build|
      assert_no_difference "ShareLink.count" do
        post @path, params: {
          management_build:,
          share_link: { build_number: @build.number, label: "Rejected #{management_build}" }
        }
      end
      assert_response :not_found

      assert_no_difference "ShareLink.count" do
        delete repository_prototype_share_link_path(@repository.github_id, @prototype, link),
          params: { management_build: }
      end
      assert_response :not_found
      assert ShareLink.exists?(link.id)
    end
  end

  test "keeps validation failures on the browser management page" do
    [ { expiration: "invalid" }, { label: "" } ].each do |attributes|
      assert_no_difference "ShareLink.count" do
        post @path,
          params: { share_link: { build_number: @build.number, label: "Review" }.merge(attributes) }
      end
      assert_redirected_to repository_prototype_share_links_path \
        @repository.github_id,
        @prototype
      assert flash[:alert].present?
    end
  end

  test "keeps default mutations unpinned and explicit management selections pinned" do
    newer = builds.create_successful \
      prototype: @prototype,
      number: 2,
      commit_sha: "b" * 40

    post @path, params: {
      share_link: { build_number: @build.number, label: "Default management" }
    }
    default_link = ShareLink.find_by!(label: "Default management")
    assert_redirected_to @path
    follow_redirect!(headers: { "Accept" => "application/json" })
    default_data = JSON.parse(response.body).fetch("data")
    assert_equal newer.number, default_data.fetch("selectedBuild").fetch("number")
    assert_equal repository_prototype_path(@repository.github_id, @prototype),
      default_data.fetch("closePath")

    delete repository_prototype_share_link_path(@repository.github_id, @prototype, default_link)
    assert_redirected_to @path
    follow_redirect!(headers: { "Accept" => "application/json" })
    assert_equal repository_prototype_path(@repository.github_id, @prototype),
      JSON.parse(response.body).fetch("data").fetch("closePath")

    post @path, params: {
      management_build: @build.number,
      share_link: { build_number: newer.number, label: "Pinned management" }
    }
    pinned_link = ShareLink.find_by!(label: "Pinned management")
    pinned_path = repository_prototype_share_links_path \
      @repository.github_id,
      @prototype,
      build: @build.number
    assert_redirected_to pinned_path
    follow_redirect!(headers: { "Accept" => "application/json" })
    pinned_data = JSON.parse(response.body).fetch("data")
    assert_equal @build.number, pinned_data.fetch("selectedBuild").fetch("number")
    assert_equal repository_prototype_path(@repository.github_id, @prototype, build: @build.number),
      pinned_data.fetch("closePath")

    delete repository_prototype_share_link_path(@repository.github_id, @prototype, pinned_link),
      params: { management_build: @build.number }
    assert_redirected_to pinned_path
    follow_redirect!(headers: { "Accept" => "application/json" })
    assert_equal repository_prototype_path(@repository.github_id, @prototype, build: @build.number),
      JSON.parse(response.body).fetch("data").fetch("closePath")
  end

  private

  def create_share_link(label:, expiration: "seven_days")
    ShareLink.create_public! \
      prototype: @prototype,
      build: @build,
      created_by: @user,
      label:,
      expiration:
  end

  def sign_in
    sign_in_to_hub
  end
end
