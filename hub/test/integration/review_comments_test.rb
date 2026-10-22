require "test_helper"

class ReviewCommentsTest < ActionDispatch::IntegrationTest
  include ActionCable::TestHelper

  setup do
    host! "replica.localhost:19500"
    github_app_configurations.create_installed
    @repository_payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ @repository_payload ], permissions: { 2001 => "pull" })
    sign_in
    @user = User.find_by!(github_id: 1001)
    @repository = Repository.find_by!(github_id: 2001)
    @prototype = prototypes.create(repository: @repository)
    @first_build = build_with_state(@prototype, 1, "successful", "a")
    @second_build = build_with_state(@prototype, 2, "successful", "b")
    @path = repository_prototype_review_comments_path(@repository.github_id, @prototype)
  end

  test "lists Prototype comments across Builds and excludes another Prototype" do
    older = create_comment(@first_build, "Older comment", created_at: 2.minutes.ago)
    newer = create_comment(@second_build, "Newer comment", created_at: 1.minute.ago)
    other_prototype = prototypes.create(repository: @repository, branch_name: "prototype/other")
    other_build = build_with_state(other_prototype, 1, "successful", "c")
    create_comment(other_build, "Other branch", created_at: Time.current)

    get @path

    assert_response :success
    payload = JSON.parse(response.body)
    assert_equal [ newer.id, older.id ], payload.fetch("comments").pluck("id")
    assert_equal [ 2, 1 ], payload.fetch("comments").pluck("buildNumber")
    assert_equal false, payload.fetch("hasMore")
    assert_nil payload.fetch("nextCursor")
  end

  test "returns the complete collection in newest first order" do
    time = Time.current.change(usec: 0)
    rows = 203.times.map do |index|
      {
        prototype_id: @prototype.id,
        build_id: @first_build.id,
        user_id: @user.id,
        body: "Comment #{index}",
        anchor: valid_anchor,
        activity_version: 1,
        created_at: time,
        updated_at: time
      }
    end
    ReviewComment.insert_all!(rows)
    expected_ids = ReviewComment.where(prototype: @prototype).order(created_at: :desc, id: :desc).ids
    get @path
    assert_response :success
    payload = JSON.parse(response.body)
    assert_equal expected_ids, payload.fetch("comments").pluck("id")
    assert_equal false, payload.fetch("hasMore")
    assert_nil payload.fetch("nextCursor")
  end

  test "returns the same canonical comment from creation and listing" do
    post @path,
      params: {
        review_comment: {
          build_number: @second_build.number,
          body: "Please keep this aligned.",
          anchor: valid_anchor
        }
      },
      as: :json

    assert_response :created
    created = changed_comment
    assert_equal "root", created.fetch("kind")
    assert_equal @user.login, created.dig("author", "login")
    assert_equal @second_build.number, created.fetch("buildNumber")
    assert_equal true, created.fetch("viewerCanEdit")
    assert_equal true, created.fetch("viewerCanDelete")
    assert_equal [], created.fetch("reactions")
    assert_equal 1, created.fetch("activityVersion")
    assert_equal 1, created.fetch("viewerLastSeenActivityVersion")
    assert_equal \
      repository_prototype_path(@repository.github_id, @prototype, build: @second_build.number),
      created.fetch("buildPath")

    get @path

    assert_response :success
    assert_equal created, JSON.parse(response.body).fetch("comments").first
  end

  test "creates one flat reply without copying the root anchor or Build" do
    root = create_comment(@first_build, "Root comment", created_at: 1.minute.ago)

    post "#{@path}/#{root.id}/replies",
      params: { review_comment: { body: "Reply body" } },
      as: :json

    assert_response :created
    changed = changed_comments
    reply = changed.first
    changed_root = changed.second
    assert_equal "reply", reply.fetch("kind")
    assert_equal root.id, reply.fetch("rootId")
    assert_equal "Reply body", reply.fetch("body")
    assert_not reply.key?("anchor")
    assert_not reply.key?("buildNumber")
    assert_equal true, reply.fetch("viewerCanEdit")
    assert_equal 2, changed_root.fetch("activityVersion")
    assert_equal 2, changed_root.fetch("viewerLastSeenActivityVersion")

    get @path

    assert_response :success
    comments = JSON.parse(response.body).fetch("comments")
    assert_equal [ reply.fetch("id"), root.id ], comments.pluck("id")
    assert_equal reply, comments.first
  end

  test "rejects nested replies and replies to closed threads" do
    root = create_comment(@first_build, "Root comment", created_at: 1.minute.ago)
    reply = root.thread.create_reply!(user: @user, body: "First reply")

    post "#{@path}/#{reply.id}/replies",
      params: { review_comment: { body: "Nested reply" } },
      as: :json
    assert_response :not_found

    post "#{@path}/#{root.id}/resolution"
    assert_response :success
    post "#{@path}/#{root.id}/replies",
      params: { review_comment: { body: "Resolved reply" } },
      as: :json
    assert_response :unprocessable_entity
    assert_includes \
      JSON.parse(response.body).fetch("errors"),
      "Resolved threads must be reopened before replying"

    delete "#{@path}/#{root.id}/resolution"
    assert_response :success
    delete "#{@path}/#{root.id}"
    assert_response :success
    post "#{@path}/#{root.id}/replies",
      params: { review_comment: { body: "Deleted reply" } },
      as: :json
    assert_response :unprocessable_entity
    assert_includes \
      JSON.parse(response.body).fetch("errors"),
      "Deleted threads cannot receive replies"
  end

  test "lets authors edit their comments without changing thread identity" do
    root = create_comment(@first_build, "Original body", created_at: 1.minute.ago)
    original_anchor = root.anchor.deep_dup

    patch "#{@path}/#{root.id}",
      params: { review_comment: { body: "Edited body" } },
      as: :json

    assert_response :success
    edited = changed_comment
    assert_equal "Edited body", edited.fetch("body")
    assert_not_nil edited.fetch("editedAt")
    assert_equal original_anchor, edited.fetch("anchor")
    assert_equal @first_build.number, edited.fetch("buildNumber")
    assert_equal 2, edited.fetch("activityVersion")
    assert_equal 2, edited.fetch("viewerLastSeenActivityVersion")

    other_author = users.create(github_id: 1_002, login: "mona")
    other_comment = ReviewComment.create! \
      prototype: @prototype,
      build: @first_build,
      user: other_author,
      body: "Other author",
      anchor: valid_anchor
    patch "#{@path}/#{other_comment.id}",
      params: { review_comment: { body: "Unauthorized edit" } },
      as: :json

    assert_response :forbidden
    assert_equal "Other author", other_comment.reload.body
  end

  test "removes bodies while retaining root threads and replies" do
    root = create_comment(@first_build, "Root body", created_at: 1.minute.ago)
    reply = root.thread.create_reply!(user: @user, body: "Reply body")

    delete "#{@path}/#{root.id}"

    assert_response :success
    deleted_root = changed_comment
    assert_nil deleted_root.fetch("body")
    assert_not_nil deleted_root.fetch("deletedAt")
    assert_equal false, deleted_root.fetch("viewerCanDelete")
    assert ReviewComment.exists?(reply.id)

    delete "#{@path}/#{reply.id}"

    assert_response :success
    deleted_reply = changed_comment
    assert_nil deleted_reply.fetch("body")
    assert_not_nil deleted_reply.fetch("deletedAt")
    assert_nil reply.reload.body
  end

  test "lets any authorized reviewer resolve and reopen a root thread" do
    author = users.create(github_id: 1_002, login: "mona")
    root = ReviewComment.create! \
      prototype: @prototype,
      build: @first_build,
      user: author,
      body: "Other reviewer's thread",
      anchor: valid_anchor

    post "#{@path}/#{root.id}/resolution"

    assert_response :success
    resolved = changed_comment
    assert_not_nil resolved.fetch("resolvedAt")
    assert_equal @user.login, resolved.dig("resolvedBy", "login")
    assert_equal false, resolved.fetch("viewerCanEdit")

    delete "#{@path}/#{root.id}/resolution"

    assert_response :success
    reopened = changed_comment
    assert_nil reopened.fetch("resolvedAt")
    assert_nil reopened.fetch("resolvedBy")
  end

  test "rejects edits and deletions from another authorized reviewer" do
    author = users.create(github_id: 1_002, login: "mona")
    root = ReviewComment.create! \
      prototype: @prototype,
      build: @first_build,
      user: author,
      body: "Owned by Mona",
      anchor: valid_anchor

    patch "#{@path}/#{root.id}",
      params: { review_comment: { body: "Changed" } },
      as: :json
    assert_response :forbidden

    delete "#{@path}/#{root.id}"
    assert_response :forbidden
    assert_equal "Owned by Mona", root.reload.body
  end

  test "creates an area comment with the shared anchor schema version" do
    post @path,
      params: {
        review_comment: {
          build_number: @second_build.number,
          body: "Review this highlighted region.",
          anchor: valid_area_anchor
        }
      },
      as: :json

    assert_response :created
    created = changed_comment
    assert_equal "area", created.dig("anchor", "kind")
    assert_equal 1, created.dig("anchor", "schemaVersion")
    assert_equal "button", created.dig("anchor", "elements", 0, "tagName")
  end

  test "rejects unfinished, missing, and cross-Prototype Builds" do
    %w[queued running failed superseded].each_with_index do |state, index|
      build = build_with_state(@prototype, index + 3, state, (index + 3).to_s)
      post_comment(build.number)
      assert_response :not_found
    end

    post_comment(999)
    assert_response :not_found

    other_prototype = prototypes.create(repository: @repository, branch_name: "prototype/other")
    other_build = build_with_state(other_prototype, 9, "successful", "f")
    post_comment(other_build.number)
    assert_response :not_found
  end

  test "rejects invalid bodies, anchors, and oversized requests" do
    post @path,
      params: {
        review_comment: {
          build_number: @first_build.number,
          body: " ",
          anchor: valid_anchor.merge("unknown" => true)
        }
      },
      as: :json

    assert_response :unprocessable_entity
    errors = JSON.parse(response.body).fetch("errors")
    assert_includes errors, "Body can't be blank"
    assert_includes errors, "Anchor contains unsupported fields: unknown"

    post @path,
      params: "x" * (ReviewComment::REQUEST_MAXIMUM_BYTES + 1),
      headers: { "CONTENT_TYPE" => "application/json" }

    assert_response :content_too_large

    root = create_comment(@first_build, "Root comment", created_at: Time.current)
    post "#{@path}/#{root.id}/replies",
      params: "x" * (ReviewComment::REQUEST_MAXIMUM_BYTES + 1),
      headers: { "CONTENT_TYPE" => "application/json" }

    assert_response :content_too_large
  end

  test "requires a browser session before revealing comment data" do
    create_comment(@first_build, "Private comment", created_at: Time.current)
    reset!
    host! "replica.localhost:19500"

    get @path

    assert_redirected_to root_path
    assert_not_includes response.body, "Private comment"
  end

  test "returns not found when GitHub denies the repository" do
    Rails.cache.clear
    stub_github_permissions([ @repository_payload ], { 2001 => nil })

    get @path

    assert_response :not_found
  end

  test "returns unavailable when GitHub cannot confirm repository access" do
    Rails.cache.clear
    stub_github_permissions([ @repository_payload ], { 2001 => :failure })

    get @path

    assert_response :service_unavailable
  end

  test "adds and removes fixed reactions without changing thread activity" do
    author = users.create(github_id: 1_002, login: "mona")
    root = ReviewComment.create! \
      prototype: @prototype,
      build: @first_build,
      user: author,
      body: "Root comment",
      anchor: valid_anchor
    root.thread.create_reply!(user: author, body: "New activity")
    other_reviewer = users.create(github_id: 1_003, login: "hubot")
    root.thread.add_reaction! \
      user: other_reviewer,
      content: "+1",
      activity_version: 2

    post "#{@path}/#{root.id}/reactions",
      params: {
        review_comment_reaction: {
          content: "+1",
          activity_version: 1
        }
      },
      as: :json

    assert_response :created
    reacted = changed_comment
    assert_equal \
      [
        { "content" => "+1", "count" => 2, "viewerHasReacted" => true }
      ],
      reacted.fetch("reactions")
    assert_equal 2, reacted.fetch("activityVersion")
    assert_equal 1, reacted.fetch("viewerLastSeenActivityVersion")

    post "#{@path}/#{root.id}/reactions",
      params: {
        review_comment_reaction: {
          content: "wave",
          activity_version: 2
        }
      },
      as: :json
    assert_response :unprocessable_entity

    post "#{@path}/#{root.id}/reactions",
      params: {
        review_comment_reaction: {
          content: "heart",
          activity_version: 3
        }
      },
      as: :json
    assert_response :unprocessable_entity
    assert_not root.reactions.exists?(user: @user, content: "heart")

    post "#{@path}/#{root.id}/reactions",
      params: { review_comment_reaction: { content: "eyes" } },
      as: :json
    assert_response :bad_request

    delete "#{@path}/#{root.id}/reactions/+1",
      params: { review_comment_reaction: { activity_version: 2 } },
      as: :json

    assert_response :success
    unreacted = changed_comment
    assert_equal \
      [
        { "content" => "+1", "count" => 1, "viewerHasReacted" => false }
      ],
      unreacted.fetch("reactions")
    assert_equal 2, unreacted.fetch("viewerLastSeenActivityVersion")
    assert_equal 2, root.reload.activity_version
  end

  test "broadcasts public review changes without broadcasting read state" do
    root = create_comment(@first_build, "Root comment", created_at: Time.current)
    stream = ReviewCommentsChannel.broadcasting_for(@prototype)

    assert_broadcast_on stream, { type: "review_comments_changed" } do
      patch "#{@path}/#{root.id}",
        params: { review_comment: { body: "Edited root" } },
        as: :json
    end
    assert_response :success

    assert_no_broadcasts stream do
      post "#{@path}/#{root.id}/read",
        params: { review_thread_read: { activity_version: 2 } },
        as: :json
    end
    assert_response :success
  end

  test "marks only the thread activity version the reviewer has seen" do
    author = users.create(github_id: 1_002, login: "mona")
    root = ReviewComment.create! \
      prototype: @prototype,
      build: @first_build,
      user: author,
      body: "Other reviewer's thread",
      anchor: valid_anchor
    root.thread.create_reply!(user: author, body: "New activity")

    get @path
    listed_root = JSON.parse(response.body).fetch("comments").find { _1.fetch("id") == root.id }
    assert_nil listed_root.fetch("viewerLastSeenActivityVersion")
    assert_equal 2, listed_root.fetch("activityVersion")

    post "#{@path}/#{root.id}/read",
      params: { review_thread_read: { activity_version: 1 } },
      as: :json

    assert_response :success
    stale_read = changed_comment
    assert_equal 2, stale_read.fetch("activityVersion")
    assert_equal 1, stale_read.fetch("viewerLastSeenActivityVersion")

    post "#{@path}/#{root.id}/read",
      params: { review_thread_read: { activity_version: 2 } },
      as: :json

    assert_response :success
    assert_equal 2, changed_comment.fetch("viewerLastSeenActivityVersion")

    post "#{@path}/#{root.id}/read",
      params: { review_thread_read: { activity_version: 3 } },
      as: :json

    assert_response :unprocessable_entity
  end

  test "marks another author's conversation unread only for the current viewer without changing inbox state" do
    author = users.create(github_id: 1_002, login: "mona")
    @prototype.update!(author: @user)
    root = ReviewComment.create! \
      prototype: @prototype,
      build: @first_build,
      user: author,
      body: "Other reviewer's thread",
      anchor: valid_anchor
    Notification.record_comment!(root)
    Notification.for_user(@user).sole.update!(read_at: Time.current)
    root.thread.create_reply!(user: author, body: "Follow-up")
    notifications = Notification.for_user(@user).order(:id).map(&:attributes)
    assert_equal [ false, true ], notifications.map { _1.fetch("read_at").nil? }
    root.thread.record_read_by!(@user, activity_version: 2)
    author_read = root.thread.record_read_by!(author, activity_version: 2)
    other_root = create_comment(@second_build, "Another conversation", created_at: Time.current)
    other_read = other_root.thread.record_read_by!(@user, activity_version: 1)
    activity_at = root.reload.updated_at
    stream = ReviewCommentsChannel.broadcasting_for(@prototype)

    assert_no_broadcasts stream do
      delete "#{@path}/#{root.id}/read"
    end

    assert_response :success
    assert_equal root.id, changed_comment.fetch("id")
    assert_nil changed_comment.fetch("viewerLastSeenActivityVersion")
    assert_equal false, changed_comment.fetch("viewerCanEdit")
    assert_not ReviewThreadRead.exists?(root:, user: @user)
    assert_equal 2, author_read.reload.last_seen_activity_version
    assert_equal 1, other_read.reload.last_seen_activity_version
    assert_equal notifications, Notification.for_user(@user).order(:id).map(&:attributes)
    assert_equal 2, root.reload.activity_version
    assert_equal activity_at, root.updated_at

    get @path
    assert_response :success
    listed = changed_comments.find { _1.fetch("id") == root.id }
    assert_nil listed.fetch("viewerLastSeenActivityVersion")

    delete "#{@path}/#{root.id}/read"
    assert_response :success
    assert_nil changed_comment.fetch("viewerLastSeenActivityVersion")

    post "#{@path}/#{root.id}/read",
      params: { review_thread_read: { activity_version: 2 } },
      as: :json
    assert_response :success
    assert_equal 2, changed_comment.fetch("viewerLastSeenActivityVersion")
  end

  test "rejects unread changes outside the authorized root scope" do
    root = create_comment(@first_build, "Root", created_at: Time.current)
    reply = root.thread.create_reply!(user: @user, body: "Reply")
    other_prototype = prototypes.create(repository: @repository, branch_name: "prototype/other")
    other_path = repository_prototype_review_comments_path(@repository.github_id, other_prototype)
    read = root.thread.record_read_by!(@user, activity_version: 2)

    delete "#{@path}/#{reply.id}/read"
    assert_response :not_found
    delete "#{other_path}/#{root.id}/read"
    assert_response :not_found
    stub_github_permissions([ @repository_payload ], { 2001 => nil })
    delete "#{@path}/#{root.id}/read"
    assert_response :not_found
    assert_equal 2, read.reload.last_seen_activity_version
  end

  test "rejects a preview-origin form without a Hub authenticity token" do
    previous = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = true

    post @path,
      params: {
        review_comment: {
          build_number: @first_build.number,
          body: "Cross-origin form",
          anchor: valid_anchor
        }
      },
      headers: { "HTTP_ORIGIN" => PreviewOrigin.current.url(@first_build.id) }

    assert_response :unprocessable_entity
    assert_not ReviewComment.exists?(body: "Cross-origin form")
  ensure
    ActionController::Base.allow_forgery_protection = previous
  end

  private

  def changed_comments
    JSON.parse(response.body).fetch("comments")
  end

  def changed_comment
    changed_comments.first
  end

  def post_comment(build_number)
    post @path,
      params: {
        review_comment: {
          build_number:,
          body: "Review this element.",
          anchor: valid_anchor
        }
      },
      as: :json
  end

  def create_comment(build, body, created_at:)
    ReviewComment.create! \
      prototype: build.prototype,
      build:,
      user: @user,
      body:,
      anchor: valid_anchor,
      created_at:,
      updated_at: created_at
  end

  def build_with_state(prototype, number, state, sha_character)
    time = Time.current
    build = builds.create \
      prototype:,
      number:,
      commit_sha: sha_character.length == 40 ? sha_character : sha_character * 40
    attributes = case state
    when "queued"
      {}
    when "running"
      { started_at: time }
    when "superseded"
      { finished_at: time }
    else
      { started_at: time, finished_at: time }
    end
    attributes[:state] = state
    attributes[:failure_summary] = "Build failed." if state == "failed"
    if state == "successful"
      attributes.merge! \
        workflow_completed_at: time,
        github_workflow_run_id: build.id + 10_000,
        github_workflow_run_attempt: 1,
        workflow_url: "https://github.com/github/prototype/actions/runs/#{build.id + 10_000}",
        github_artifact_id: build.id + 20_000,
        artifact_prefix: "builds/#{build.id}",
        artifact_bytes: 100
    end
    build.update!(attributes)
    build
  end

  def sign_in
    sign_in_to_hub
  end

  def valid_anchor
    {
      "schemaVersion" => 1,
      "kind" => "element",
      "route" => { "pathname" => "/", "search" => "", "hash" => "" },
      "selector" => "#save",
      "accessibleName" => "Save",
      "tagName" => "button",
      "selectedText" => "",
      "rect" => { "x" => 20, "y" => 30, "width" => 100, "height" => 32 },
      "viewport" => { "width" => 1_280, "height" => 720, "scrollX" => 0, "scrollY" => 0 },
      "elementOffset" => { "x" => 0.5, "y" => 0.5 }
    }
  end

  def valid_area_anchor
    {
      "schemaVersion" => 1,
      "kind" => "area",
      "route" => { "pathname" => "/", "search" => "", "hash" => "" },
      "path" => [ { "x" => 0, "y" => 0 }, { "x" => 1, "y" => 1 } ],
      "rect" => { "x" => 20, "y" => 30, "width" => 160, "height" => 80 },
      "viewport" => { "width" => 1_280, "height" => 720, "scrollX" => 0, "scrollY" => 0 },
      "elements" => [
        {
          "selector" => "#save",
          "accessibleName" => "Save",
          "tagName" => "button",
          "role" => "",
          "textExcerpt" => "Save changes",
          "rect" => { "x" => 40, "y" => 50, "width" => 100, "height" => 32 }
        }
      ]
    }
  end
end
