require "test_helper"

class NotificationsTest < ActionDispatch::IntegrationTest
  setup do
    host! "replica.localhost:19500"
    github_app_configurations.create_installed
    @repository_payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ @repository_payload ], permissions: { 2001 => "pull" })
    sign_in_to_hub
    @recipient = User.find_by!(github_id: 1001)
    @actor = users.create(github_id: 1002, login: "mona")
    @repository = Repository.find_by!(github_id: 2001)
    @build = builds.create_successful(prototype: prototypes.create(repository: @repository))
    @comment = ReviewComment.create! \
      prototype: @build.prototype, build: @build, user: @actor, body: "Hello @octocat",
      anchor: {
        "schemaVersion" => 1, "kind" => "element",
        "route" => { "pathname" => "/", "search" => "", "hash" => "" },
        "selector" => "#save", "accessibleName" => "Save", "tagName" => "button", "selectedText" => "",
        "rect" => { "x" => 20, "y" => 30, "width" => 100, "height" => 32 },
        "viewport" => { "width" => 1280, "height" => 720, "scrollX" => 0, "scrollY" => 0 },
        "elementOffset" => { "x" => 0.5, "y" => 0.5 }
      }
    @comment.with_lock do
      @comment.mentions.sync!([ { github_id: 1001, login: "octocat", token_login: "octocat", avatar_url: nil } ])
    end
    @notification = Notification.sole
  end

  test "prototype owner comments appear in the inbox and open the exact conversation" do
    @build.prototype.update!(author: @recipient)
    comment = ReviewComment.create_with_mentions! \
      prototype: @build.prototype, build: @build, user: @actor, body: "New prototype feedback", anchor: @comment.anchor

    get inbox_notifications_path
    assert_response :success
    item = response.parsed_body.fetch("notifications").find { _1.fetch("kind") == "comment" }
    assert_not_nil item
    assert_equal "New prototype feedback", item.fetch("excerpt")
    assert_equal({ "prototypeId" => @build.prototype.id, "threadId" => comment.id, "commentId" => comment.id }, item.fetch("target"))
    assert_equal 2, response.parsed_body.fetch("unreadCount")

    get notification_path(item.fetch("id"))
    assert_response :success
    assert_equal comment.id, response.parsed_body.fetch("commentId")
  end

  test "lists recipient notifications with exact message links without marking anything read" do
    get notification_path(@notification)
    assert_response :success
    assert_equal @comment.id, response.parsed_body.fetch("commentId")

    get inbox_notifications_path
    assert_response :success
    item = response.parsed_body.fetch("notifications").sole
    assert_equal @notification.id, item.fetch("id")
    assert_equal "Hello @octocat", item.fetch("excerpt")
    assert_equal "mention", item.fetch("kind")
    assert_equal({ "prototypeId" => @build.prototype.id, "threadId" => @comment.id, "commentId" => @comment.id }, item.fetch("target"))
    assert_equal 1, response.parsed_body.fetch("unreadCount")
    assert_equal repository_prototype_path(@repository.route_id, @build.prototype, comment: @comment.id, notification: @notification.id),
      item.fetch("path")
    assert_nil @notification.reload.read_at

    get notification_path(@notification)
    assert_response :success
    assert_equal @comment.id, response.parsed_body.fetch("commentId")
    assert_nil @notification.reload.read_at
  end

  test "read updates are recipient scoped and reject stale versions" do
    patch notification_path(@notification), params: { notification: { read: true, version: 0 } }, as: :json
    assert_response :success
    assert_equal 1, response.parsed_body.fetch("version")
    assert_not_nil @notification.reload.read_at

    patch notification_path(@notification), params: { notification: { read: false, version: 0 } }, as: :json
    assert_response :conflict
    assert_not_nil @notification.reload.read_at

    patch notification_path(@notification), params: { notification: { read: false, version: 1 } }, as: :json
    assert_response :success
    assert_nil @notification.reload.read_at
  end

  test "another recipient's notification cannot be read or updated" do
    identity = GithubIdentity.record!(github_id: 1003, login: "hubot", avatar_url: nil)
    @notification.update!(recipient: identity)
    get inbox_notifications_path
    assert_response :success
    assert_empty response.parsed_body.fetch("notifications")

    get notification_path(@notification)
    assert_response :not_found
    patch notification_path(@notification), params: { notification: { read: true, version: 0 } }, as: :json
    assert_response :not_found
  end

  test "current repository denial hides notifications while verification failures are explicit" do
    stub_github_permissions([ @repository_payload ], { 2001 => "none" })
    get inbox_notifications_path
    assert_response :success
    assert_empty response.parsed_body.fetch("notifications")

    stub_github_permissions([ @repository_payload ], { 2001 => :failure })
    get inbox_notifications_path
    assert_response :service_unavailable
  end

  test "filters unread notifications and rejects invalid read state" do
    @notification.update!(read_at: Time.current)
    get inbox_notifications_path, params: { unread: "true" }
    assert_response :success
    assert_empty response.parsed_body.fetch("notifications")
    patch notification_path(@notification), params: { notification: { read: "false", version: 1 } }, as: :json
    assert_response :bad_request
  end

  test "paginates fifty notifications without duplicates or changing their read state" do
    50.times do
      reply = @comment.replies.create!(prototype: @build.prototype, user: @actor, body: "Hello @octocat")
      reply.with_lock do
        reply.mentions.sync!([ { github_id: 1001, login: "octocat", token_login: "octocat", avatar_url: nil } ])
      end
    end
    expected_ids = Notification.order(id: :desc).ids
    get inbox_notifications_path
    assert_response :success
    first_page = response.parsed_body
    assert_equal expected_ids.first(50), first_page.fetch("notifications").map { _1.fetch("id") }
    assert_equal expected_ids[49], first_page.fetch("nextBefore")

    get inbox_notifications_path, params: { before: first_page.fetch("nextBefore").to_s }
    assert_response :success
    assert_equal [ expected_ids.last ], response.parsed_body.fetch("notifications").map { _1.fetch("id") }
    assert_nil response.parsed_body.fetch("nextBefore")
    assert_equal 51, Notification.where(read_at: nil).count
    assert_equal 51, response.parsed_body.fetch("unreadCount")

    get inbox_notifications_path, params: { before: "-1" }
    assert_response :bad_request
  end

  test "hover limits do not limit the total unread count" do
    12.times { @comment.thread.create_reply!(user: @actor, body: "A new reply") }
    get inbox_notifications_path, params: { limit: "10" }
    assert_response :success
    assert_equal 10, response.parsed_body.fetch("notifications").length
    assert_equal 13, response.parsed_body.fetch("unreadCount")
    assert_not_nil response.parsed_body.fetch("nextBefore")
    [ "0", "51", "01", "invalid" ].each do |limit|
      get inbox_notifications_path, params: { limit: }
      assert_response :bad_request
    end
  end

  test "all activity kinds are scoped to the recipient and target the correct real message" do
    @comment.thread.create_reply!(user: @actor, body: "Reply for participants")
    own_reply = @comment.thread.create_reply!(user: @recipient, body: "My reply")
    own_reply.thread.add_reaction!(user: @actor, content: "+1", activity_version: @comment.reload.activity_version)
    @comment.thread.resolve_by!(@actor)
    @comment.thread.reopen_by!(@actor)
    get inbox_notifications_path
    assert_response :success
    notifications = response.parsed_body.fetch("notifications")
    assert_equal %w[mention reaction reopened reply resolved], notifications.map { _1.fetch("kind") }.sort
    assert_equal 5, response.parsed_body.fetch("unreadCount")
    reaction = notifications.find { _1.fetch("kind") == "reaction" }
    assert_equal "+1", reaction.fetch("reactionContent")
    assert notifications.reject { _1.fetch("kind") == "reaction" }.all? { _1.fetch("reactionContent").nil? }
    assert_equal own_reply.id, reaction.fetch("target").fetch("commentId")
    get notification_path(reaction.fetch("id"))
    assert_response :success
    assert_equal own_reply.id, response.parsed_body.fetch("commentId")

    stub_github_permissions([ @repository_payload ], { 2001 => "none" })
    get inbox_notifications_path
    assert_response :success
    assert_empty response.parsed_body.fetch("notifications")
    assert_equal 0, response.parsed_body.fetch("unreadCount")
    get notification_path(reaction.fetch("id"))
    assert_response :not_found
  end

  test "reaction notifications retain the exact reaction when an actor adds several" do
    reply = @comment.thread.create_reply!(user: @recipient, body: "My reply")
    %w[heart rocket].each do |content|
      reply.thread.add_reaction!(user: @actor, content:, activity_version: @comment.reload.activity_version)
    end

    get inbox_notifications_path
    assert_response :success
    reactions = response.parsed_body.fetch("notifications").select { _1.fetch("kind") == "reaction" }
    assert_equal %w[heart rocket], reactions.map { _1.fetch("reactionContent") }.sort
  end

  test "the full inbox and repository sidebar render real counts and presentation copy" do
    get notifications_path
    assert_response :success
    assert_includes response.body, '"notificationsUnreadCount":1'
    assert_includes response.body, '"selectedSection":"notifications"'
    assert_includes response.body, '"notificationInbox":'
    assert_includes response.body, '"reply":"replied to a conversation"'
    get repository_path(@repository.route_id)
    assert_response :success
    assert_includes response.body, '"notificationsUnreadCount":1'
  end

  test "the full inbox reuses its freshly authorized unread count during rendering" do
    WebMock.reset_executed_requests!
    get notifications_path
    assert_response :success
    assert_includes response.body, '"notificationsUnreadCount":1'
    # One fresh inbox check and the separate cold repository-navigation lookup.
    assert_requested :get, "#{GITHUB_API_URL}/repos/github/prototype/collaborators/octocat/permission", times: 2
  end

  test "the full inbox reuses a zero unread count without skipping fresh authorization" do
    @notification.update!(read_at: Time.current)
    WebMock.reset_executed_requests!
    get notifications_path
    assert_response :success
    assert_includes response.body, '"notificationsUnreadCount":0'
    assert_requested :get, "#{GITHUB_API_URL}/repos/github/prototype/collaborators/octocat/permission", times: 2
  end

  test "the inbox retains repository administrator navigation without granting Hub administration" do
    stub_github_permissions([ @repository_payload ], { 2001 => "admin" })
    get notifications_path, as: :json
    assert_response :success
    data = response.parsed_body.fetch("data")
    navigation = data.fetch("repository")
    assert_equal repository_analytics_path(@repository.route_id), navigation.fetch("analyticsPath")
    assert_equal repository_security_audit_path(@repository.route_id), data.fetch("securityAuditPath")
    assert_empty data.fetch("administrationLinks")
    assert_equal "notifications", data.fetch("selectedSection")
    assert_equal I18n.t("repository_workspace.repositories"), navigation.fetch("repositoryMenuLabel")
    assert_equal I18n.t("repository_workspace.theme_system"), data.fetch("systemThemeLabel")
    assert_equal I18n.t("repository_workspace.theme_light"), data.fetch("lightThemeLabel")
    assert_equal I18n.t("repository_workspace.theme_dark"), data.fetch("darkThemeLabel")
  end

  test "the inbox retains Hub administration links independently of repository permission" do
    @recipient.update!(hub_admin: true)
    get notifications_path, as: :json
    assert_response :success
    data = response.parsed_body.fetch("data")
    assert_nil data.fetch("repository").fetch("analyticsPath")
    assert_equal security_audit_path, data.fetch("securityAuditPath")
    assert_equal [
      github_app_path(repository_github_id: @repository.route_id),
      copilot_connection_path(repository_github_id: @repository.route_id),
      hub_admins_path(repository_github_id: @repository.route_id),
      sharing_settings_path(repository_github_id: @repository.route_id),
      session_revocation_path(repository_github_id: @repository.route_id)
    ], data.fetch("administrationLinks").map { _1.fetch("path") }
  end

  test "the inbox keeps Hub administration without any accessible repository" do
    @recipient.update!(hub_admin: true)
    stub_github_permissions([ @repository_payload ], { 2001 => "none" })
    get notifications_path, as: :json
    assert_response :success
    data = response.parsed_body.fetch("data")
    assert_nil data.fetch("repository")
    assert_equal repositories_path, data.fetch("repositoriesPath")
    assert_equal I18n.t("hub_admins.repositories"), data.fetch("repositoriesLabel")
    assert_not data.key?("selectedRepositoryId")
    assert_equal security_audit_path, data.fetch("securityAuditPath")
    assert_equal %w[github copilot admins sharing sessions], data.fetch("administrationLinks").map { _1.fetch("section") }
    assert_equal github_app_path, data.fetch("administrationLinks").first.fetch("path")
  end

  test "the inbox hides restricted links from ordinary repository readers" do
    get notifications_path, as: :json
    assert_response :success
    data = response.parsed_body.fetch("data")
    assert_nil data.fetch("repository").fetch("analyticsPath")
    assert_nil data.fetch("securityAuditPath")
    assert_empty data.fetch("administrationLinks")
  end

  test "the inbox preserves repository context without filtering global activity" do
    payload = repository_payload(2002, "github/second")
    repository = repositories.create(github_id: 2002, name_with_owner: payload.fetch("full_name"))
    stub_github_permissions([ @repository_payload, payload ], { 2001 => "pull", 2002 => "admin" })
    stub_github_workflows([ payload ])
    stub_request(:get, "#{GITHUB_API_URL}/repos/github/second/activity")
      .with(query: { "actor" => "octocat", "time_period" => "day", "direction" => "desc", "per_page" => "100" })
      .to_return(status: 200, body: "[]", headers: { "Content-Type" => "application/json" })

    get repository_path(repository.route_id), as: :json
    assert_response :success
    inbox_path = response.parsed_body.fetch("data").fetch("notificationsPath")
    assert_equal notifications_path(repository_github_id: repository.route_id), inbox_path

    get inbox_path, as: :json
    assert_response :success
    data = response.parsed_body.fetch("data")
    assert_equal repository.route_id.to_s, data.fetch("repository").fetch("selectedRepositoryId")
    assert_equal repository_analytics_path(repository.route_id), data.fetch("repository").fetch("analyticsPath")
    assert_equal 1, data.fetch("notificationsUnreadCount")
    assert_equal inbox_notifications_path, data.fetch("notificationInbox").fetch("path")
  end

  test "an inaccessible inbox repository hint uses the safe Hub fallback" do
    get notifications_path(repository_github_id: 9999), as: :json
    assert_response :success
    data = response.parsed_body.fetch("data")
    assert_nil data.fetch("repository")
    assert_equal I18n.t("hub_administration_workspace.repository_unavailable"),
      data.fetch("repositoryUnavailableMessage")
    assert_equal repositories_path, data.fetch("repositoriesPath")
    assert_equal 1, data.fetch("notificationsUnreadCount")
  end

  test "suggestions include collaborators who have not signed in and remain prototype scoped" do
    stub_request(:get, "#{GITHUB_API_URL}/repos/github/prototype/collaborators")
      .with(query: { "affiliation" => "all", "per_page" => "100", "page" => "1" })
      .to_return(status: 200, body: JSON.generate([ { id: 1003, login: "hubot", avatar_url: nil } ]), headers: { "Content-Type" => "application/json" })
    get repository_prototype_mention_candidates_path(@repository.route_id, @build.prototype)
    assert_response :success
    assert_equal [ { "githubId" => 1003, "login" => "hubot", "avatarUrl" => nil } ], response.parsed_body.fetch("candidates")
    assert_nil User.find_by(github_id: 1003)

    get repository_prototype_mention_candidates_path(@repository.route_id, @build.prototype.id + 1)
    assert_response :not_found
  end

  test "canvas suggestions require a repository-scoped grant rather than browser cookies" do
    path = canvas_api_mention_candidates_path(@repository.route_id, @build.prototype)
    get path
    assert_response :unauthorized

    token = "rp_#{SecureRandom.urlsafe_base64(32)}"
    grant = CanvasGrant.create! \
      repository: @repository,
      user: @recipient,
      token_digest: Digest::SHA256.hexdigest(token),
      expires_at: 7.days.from_now
    headers = { "Authorization" => "Bearer #{token}" }
    stub_request(:get, "#{GITHUB_API_URL}/repos/github/prototype/collaborators")
      .with(query: { "affiliation" => "all", "per_page" => "100", "page" => "1" })
      .to_return(status: 200, body: "[]", headers: { "Content-Type" => "application/json" })
    get path, headers: headers
    assert_response :success
    assert_equal "private, no-store", response.headers["Cache-Control"]

    get canvas_api_mention_candidates_path(9999, @build.prototype), headers: headers
    assert_response :not_found
    grant.revoke!
    get path, headers: headers
    assert_response :unauthorized
  end

  test "an eleventh login rejects both a root and a reply without partial writes" do
    body = 11.times.map { "@person#{_1}" }.join(" ")
    path = repository_prototype_review_comments_path(@repository.route_id, @build.prototype)
    assert_no_difference [ "ReviewComment.count", "CommentMention.count", "Notification.count" ] do
      post path, params: { review_comment: { build_number: @build.number, body:, anchor: @comment.anchor } }, as: :json
      assert_response :unprocessable_entity
      assert_includes response.parsed_body.fetch("errors").join, "at most 10"

      post "#{path}/#{@comment.id}/replies", params: { review_comment: { body: } }, as: :json
      assert_response :unprocessable_entity
    end
  end
end
