require "test_helper"

class CanvasRepositoryCommentsTest < ActionDispatch::IntegrationTest
  setup do
    host! "replica.localhost:19500"
    github_app_configurations.create_installed
    stub_github_sign_in \
      repositories: [ repository_payload(2001, "github/prototype") ],
      permissions: { 2001 => "pull" }
    post github_authentication_path
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    get github_authentication_callback_path, params: { code: "code", state: }
    @repository = Repository.find_by!(github_id: 2001)
    @viewer = User.find_by!(github_id: 1001)
    @author = users.create(github_id: 1002, login: "mona")
    @grant, token = issue_grant(@viewer)
    @headers = { "Authorization" => "Bearer #{token}" }
    @path = canvas_api_repository_review_comments_path(@repository.route_id)
    @summary_path = canvas_api_repository_review_comment_summaries_path(@repository.route_id)
  end

  test "summaries return only live roots with reply counts and compact original Build context" do
    first = prototypes.create(repository: @repository, branch_name: "prototype/first", name: "First")
    second = prototypes.create(repository: @repository, branch_name: "prototype/second")
    root = create_comment(first, 1)
    root.thread.create_reply!(user: @author, body: "Private follow-up text")
    removed_reply = root.thread.create_reply!(user: @author, body: "Removed reply")
    removed_reply.thread.delete_body!(actor: @author)
    resolved = create_comment(second, 2)
    resolved.thread.resolve_by!(@author)
    removed = create_comment(second, 3)
    removed.thread.delete_body!(actor: @author)

    assert_no_difference "ReviewThreadRead.count" do
      get @summary_path, headers: @headers
    end
    assert_response :success
    payload = JSON.parse(response.body)
    assert_equal [ resolved.id, root.id ], payload.fetch("comments").pluck("id")
    record = payload.fetch("comments").last
    assert_equal 1, record.fetch("replyCount")
    assert_equal root.body, record.fetch("body")
    assert_equal @author.login, record.fetch("authorLogin")
    assert_equal 1, record.fetch("buildNumber")
    assert_equal first.id, record.fetch("prototype").fetch("id")
    assert_equal "Save", record.fetch("targetContext").fetch("accessibleName")
    assert_equal "/", record.fetch("targetContext").fetch("route").fetch("pathname")
    assert_nil record.fetch("screenshotReference")
    assert_empty record.keys & %w[replies anchor reactions viewerLastSeenActivityVersion]
    assert_not_includes response.body, "Private follow-up text"
    assert_equal "private, no-store", response.headers["Cache-Control"]
    assert_nil @grant.reload.last_active_at
  end

  test "summaries default to 200 roots and paginate without omissions under the byte budget" do
    prototype = prototypes.create(repository: @repository)
    original = create_comment(prototype, 1)
    roots = [ original ] + 200.times.map do
      ReviewComment.create!(prototype:, build: original.build, user: @author,
        body: "Short feedback", anchor: original.anchor)
    end
    timestamp = Time.current.change(usec: 0)
    ReviewComment.where(id: roots.map(&:id)).update_all(created_at: timestamp)
    get @summary_path, headers: @headers
    assert_response :success
    default_ids = JSON.parse(response.body).fetch("comments").pluck("id")
    assert_operator default_ids.length, :>, 50
    assert_operator default_ids.length, :<=, 200
    assert_operator response.body.bytesize, :<=, 60 * 1024
    get @summary_path, params: { pageSize: 200 }, headers: @headers
    assert_equal default_ids, JSON.parse(response.body).fetch("comments").pluck("id")

    ReviewComment.where(id: roots.map(&:id)).update_all(body: "é" * 5000)
    ids = []
    cursor = nil
    loop do
      get @summary_path, params: { cursor: }.compact, headers: @headers
      assert_response :success
      assert_operator response.body.bytesize, :<=, 60 * 1024
      page = JSON.parse(response.body)
      assert page.fetch("comments").all? { _1.fetch("body") == "é" * 5000 }
      assert_operator page.fetch("comments").length, :>, 0
      ids.concat(page.fetch("comments").pluck("id"))
      break if !page.fetch("hasMore")

      next_cursor = page.fetch("nextCursor")
      assert_not_equal cursor, next_cursor
      cursor = next_cursor
    end
    assert_equal roots.map(&:id).reverse, ids
  end

  test "summaries preserve area label context without saved geometry" do
    prototype = prototypes.create(repository: @repository)
    original = create_comment(prototype, 1)
    anchor = original.anchor.slice("schemaVersion", "route", "rect", "viewport").merge(
      "kind" => "area",
      "path" => [ { "x" => 0, "y" => 0 }, { "x" => 1, "y" => 1 } ],
      "elements" => [ {
        "selector" => "#save", "accessibleName" => "Save", "tagName" => "button",
        "role" => "button", "textExcerpt" => "Save changes", "rect" => original.anchor.fetch("rect")
      } ]
    )
    area = ReviewComment.create!(prototype:, build: original.build, user: @author,
      body: "This region needs clearer labels", anchor:)
    get @summary_path, headers: @headers
    assert_response :success
    context = JSON.parse(response.body).fetch("comments").find { _1.fetch("id") == area.id }.fetch("targetContext")
    assert_equal "area", context.fetch("kind")
    assert_equal "Save changes", context.fetch("elements").first.fetch("textExcerpt")
    assert_empty context.keys & %w[path rect viewport]
    assert_empty context.fetch("elements").first.keys & %w[rect selector]
  end

  test "oversized serialized starting comments and thread roots fail without truncation" do
    prototype = prototypes.create(repository: @repository)
    original = create_comment(prototype, 1)
    root = ReviewComment.create!(prototype:, build: original.build, user: @author,
      body: "\u0001" * 10_000, anchor: original.anchor.merge("selectedText" => "\u0001" * 2000))
    [ @summary_path, canvas_api_review_comment_thread_path(@repository.route_id, prototype, root) ].each do |path|
      get path, headers: @headers
      assert_response :content_too_large
    end
  end

  test "summary filters match root creation only and bind cursors to filters and viewer" do
    prototype = prototypes.create(repository: @repository)
    roots = 3.times.map { |index| create_comment(prototype, index + 1) }
    roots.first.update_columns(created_at: Time.iso8601("2026-09-01T00:00:00Z"))
    roots.first.thread.create_reply!(user: @author, body: "Recent reply")
    roots.last.thread.resolve_by!(@author)
    get @summary_path, params: { from: "2026-10-01T00:00:00Z", resolution: "unresolved", pageSize: 1 },
      headers: @headers
    assert_response :success
    assert_equal [ roots.second.id ], JSON.parse(response.body).fetch("comments").pluck("id")

    get @summary_path, params: { pageSize: 1 }, headers: @headers
    summary_cursor = JSON.parse(response.body).fetch("nextCursor")
    get @summary_path, params: { cursor: summary_cursor, resolution: "resolved" }, headers: @headers
    assert_response :bad_request
    get @path, params: { cursor: summary_cursor }, headers: @headers
    assert_response :bad_request
    get @summary_path, params: { pageSize: 1, from: "2026-10-01T00:00:00.000001Z" }, headers: @headers
    precision_cursor = JSON.parse(response.body).fetch("nextCursor")
    assert_not_nil precision_cursor
    get @summary_path, params: { cursor: precision_cursor, from: "2026-10-01T00:00:00.000002Z" }, headers: @headers
    assert_response :bad_request
    _grant, token = issue_grant(@author)
    stub_github_permissions([ repository_payload(2001, "github/prototype") ], { 2001 => "pull" },
      github_id: @author.github_id, login: @author.login)
    get @summary_path, params: { cursor: summary_cursor }, headers: { "Authorization" => "Bearer #{token}" }
    assert_response :bad_request
    [
      { pageSize: 201 }, { pageSize: 0 }, { cursor: "invalid" }, { resolution: "invalid" },
      { from: [ "2026-10-01T00:00:00Z" ] }, { from: "not-a-date" }, { from: "2026-02-30T00:00:00Z" },
      { from: "2026-10-02T00:00:00Z", to: "2026-10-01T00:00:00Z" }
    ].each do |params|
      get @summary_path, params:, headers: @headers
      assert_response :bad_request
    end
  end

  test "direct thread reads only the selected thread with oldest-first live replies and conflict detection" do
    prototype = prototypes.create(repository: @repository)
    root = create_comment(prototype, 1)
    another = create_comment(prototype, 2)
    another.thread.create_reply!(user: @author, body: "Unrelated reply")
    replies = 4.times.map { root.thread.create_reply!(user: @author, body: "Selected reply") }
    replies.second.thread.delete_body!(actor: @author)
    timestamp = Time.current.change(usec: 0)
    ReviewComment.where(id: replies.map(&:id)).update_all(created_at: timestamp)
    path = canvas_api_review_comment_thread_path(@repository.route_id, prototype, root)
    assert_no_difference "ReviewThreadRead.count" do
      get path, params: { pageSize: 1 }, headers: @headers
    end
    assert_response :success
    page = JSON.parse(response.body)
    assert_equal root.id, page.fetch("root").fetch("id")
    assert_equal prototype.id, page.fetch("root").fetch("prototype").fetch("id")
    assert_equal 3, page.fetch("replyCount")
    assert_equal [ replies.first.id ], page.fetch("replies").pluck("id")
    assert_not_includes response.body, "Unrelated reply"
    cursor = page.fetch("nextCursor")
    get path, params: { cursor:, pageSize: 1 }, headers: @headers
    assert_response :success
    page = JSON.parse(response.body)
    assert_equal [ replies.third.id ], page.fetch("replies").pluck("id")
    next_cursor = page.fetch("nextCursor")
    get path, params: { cursor: next_cursor }, headers: @headers
    assert_response :success
    assert_equal [ replies.last.id ], JSON.parse(response.body).fetch("replies").pluck("id")
    assert_equal false, JSON.parse(response.body).fetch("hasMore")
    root.thread.create_reply!(user: @author, body: "New activity")
    get path, params: { cursor: }, headers: @headers
    assert_response :conflict
    get canvas_api_review_comment_thread_path(@repository.route_id, prototype, another),
      params: { cursor: }, headers: @headers
    assert_response :bad_request
    assert_nil @grant.reload.last_active_at
  end

  test "direct thread reads handle empty threads, deleted roots and byte-bounded reply continuations" do
    prototype = prototypes.create(repository: @repository)
    root = create_comment(prototype, 1)
    path = canvas_api_review_comment_thread_path(@repository.route_id, prototype, root)
    get path, headers: @headers
    assert_response :success
    assert_equal [], JSON.parse(response.body).fetch("replies")
    assert_equal 0, JSON.parse(response.body).fetch("replyCount")
    root.thread.edit_body!("é" * 5000, actor: @author)
    replies = 15.times.map { root.thread.create_reply!(user: @author, body: "é" * 5000) }
    ids = []
    cursor = nil
    loop do
      get path, params: { cursor: }.compact, headers: @headers
      assert_response :success
      assert_operator response.body.bytesize, :<=, 60 * 1024
      page = JSON.parse(response.body)
      assert_equal "é" * 5000, page.fetch("root").fetch("body")
      assert page.fetch("replies").all? { _1.fetch("body") == "é" * 5000 }
      ids.concat(page.fetch("replies").pluck("id"))
      break if !page.fetch("hasMore")

      cursor = page.fetch("nextCursor")
    end
    assert_equal replies.map(&:id), ids
    root.thread.delete_body!(actor: @author)
    get path, headers: @headers
    assert_response :success
    assert_nil JSON.parse(response.body).fetch("root").fetch("body")
    assert_equal 15, JSON.parse(response.body).fetch("replyCount")
  end

  test "new read endpoints preserve repository authorization and reviewability" do
    prototype = prototypes.create(repository: @repository)
    root = create_comment(prototype, 1)
    path = canvas_api_review_comment_thread_path(@repository.route_id, prototype, root)
    [ @summary_path, path ].each do |endpoint|
      get endpoint
      assert_response :unauthorized
    end
    get canvas_api_review_comment_thread_path(@repository.route_id + 1, prototype, root), headers: @headers
    assert_response :not_found
    another = prototypes.create(repository: @repository, branch_name: "prototype/another")
    get canvas_api_review_comment_thread_path(@repository.route_id, another, root), headers: @headers
    assert_response :not_found
    prototype.update!(replica: true)
    get path, headers: @headers
    assert_response :not_found
    get @summary_path, headers: @headers
    assert_equal [], JSON.parse(response.body).fetch("comments")
    default_root = create_comment(another, 1)
    @repository.update!(default_branch: another.branch_name)
    get canvas_api_review_comment_thread_path(@repository.route_id, another, default_root), headers: @headers
    assert_response :not_found
    get @summary_path, headers: @headers
    assert_equal [], JSON.parse(response.body).fetch("comments")
    stub_github_permissions([ repository_payload(2001, "github/prototype") ], { 2001 => nil })
    [ @summary_path, path ].each do |endpoint|
      get endpoint, headers: @headers
      assert_response :forbidden
    end
    @grant.revoke!
    [ @summary_path, path ].each do |endpoint|
      get endpoint, headers: @headers
      assert_response :unauthorized
    end
  end

  test "lists all Builds and replies across reviewable prototypes without marking them read" do
    first = prototypes.create(repository: @repository, branch_name: "prototype/first", name: "First")
    second = prototypes.create(repository: @repository, branch_name: "prototype/second")
    older = create_comment(first, 1)
    newer = create_comment(first, 2)
    resolved = create_comment(second, 1)
    reply = resolved.thread.create_reply!(user: @author, body: "Reply from another prototype")
    resolved.thread.resolve_by!(@author)
    deleted = create_comment(second, 2)
    deleted.thread.delete_body!(actor: @author)
    other_repository = repositories.create(github_id: 2002, name_with_owner: "github/other")
    other = prototypes.create(repository: other_repository, branch_name: "prototype/unrelated")
    create_comment(other, 1)

    assert_no_difference "ReviewThreadRead.count" do
      get @path, headers: @headers
    end
    assert_response :success
    payload = JSON.parse(response.body)
    assert_equal [ deleted.id, reply.id, resolved.id, newer.id, older.id ],
      payload.fetch("comments").pluck("id")
    assert_equal false, payload.fetch("hasMore")
    assert_nil payload.fetch("nextCursor")
    assert_equal "private, no-store", response.headers["Cache-Control"]
    records = payload.fetch("comments").index_by { _1.fetch("id") }
    assert_equal [ 2, 1 ], [ records.fetch(newer.id), records.fetch(older.id) ].pluck("buildNumber")
    assert_equal({ "id" => first.id, "name" => "First", "branch" => first.branch_name },
      records.fetch(older.id).fetch("prototype"))
    assert_equal second.id, records.fetch(reply.id).fetch("prototype").fetch("id")
    assert_equal resolved.id, records.fetch(reply.id).fetch("rootId")
    assert_not_nil records.fetch(resolved.id).fetch("resolvedAt")
    assert_nil records.fetch(deleted.id).fetch("body")
    assert_not_nil records.fetch(deleted.id).fetch("deletedAt")
    assert_nil records.fetch(older.id).fetch("viewerLastSeenActivityVersion")
    assert_nil @grant.reload.last_active_at
  end

  test "bootstraps repository identity without any prototype and returns a complete empty page" do
    get canvas_api_connection_path, headers: @headers
    assert_response :success
    assert_equal({
      "repository" => @repository.name_with_owner,
      "repositoryId" => @repository.route_id,
      "canPublish" => false,
      "viewerLogin" => @viewer.login
    }, JSON.parse(response.body))

    get @path, headers: @headers
    assert_response :success
    assert_equal({ "comments" => [], "nextCursor" => nil, "hasMore" => false }, JSON.parse(response.body))
  end

  test "paginates across prototypes with tied timestamps and excludes internal and default branches" do
    prototypes = 5.times.map do |index|
      self.prototypes.create(repository: @repository, branch_name: "prototype/#{index}")
    end
    comments = prototypes.map { create_comment(_1, 1) }
    timestamp = Time.current.change(usec: 0)
    ReviewComment.where(id: comments.map(&:id)).update_all(created_at: timestamp)
    internal = prototypes.last
    internal.update!(replica: true)
    @repository.update!(default_branch: prototypes[-2].branch_name)
    expected_ids = comments.first(3).map(&:id).reverse
    actual_ids = []
    cursor = nil
    loop do
      get @path, params: { pageSize: 1, cursor: }.compact, headers: @headers
      assert_response :success
      payload = JSON.parse(response.body)
      actual_ids.concat(payload.fetch("comments").pluck("id"))
      break if !payload.fetch("hasMore")

      cursor = payload.fetch("nextCursor")
    end
    assert_equal expected_ids, actual_ids
  end

  test "requires a repository grant and rejects another repository, revoked access and writes" do
    get @path
    assert_response :unauthorized
    get canvas_api_repository_review_comments_path(@repository.route_id + 1), headers: @headers
    assert_response :not_found
    post @path, headers: @headers, as: :json
    assert_response :not_found
    stub_github_permissions([ repository_payload(2001, "github/prototype") ], { 2001 => nil })
    get @path, headers: @headers
    assert_response :forbidden
    @grant.revoke!
    get @path, headers: @headers
    assert_response :unauthorized
  end

  test "rejects invalid pagination and prototype or other-viewer cursors" do
    prototype = prototypes.create(repository: @repository)
    2.times { |index| create_comment(prototype, index + 1) }
    get @path, params: { pageSize: 1 }, headers: @headers
    assert_response :success
    cursor = JSON.parse(response.body).fetch("nextCursor")
    _other_grant, token = issue_grant(@author)
    stub_github_permissions([ repository_payload(2001, "github/prototype") ], { 2001 => "pull" },
      github_id: @author.github_id, login: @author.login)
    get @path, params: { cursor: }, headers: { "Authorization" => "Bearer #{token}" }
    assert_response :bad_request

    get canvas_api_review_comments_path(@repository.route_id, prototype),
      params: { cursor: }, headers: @headers
    assert_response :bad_request
    get canvas_api_review_comments_path(@repository.route_id, prototype),
      params: { pageSize: 1 }, headers: @headers
    prototype_cursor = JSON.parse(response.body).fetch("nextCursor")
    get @path, params: { cursor: prototype_cursor }, headers: @headers
    assert_response :bad_request
    [ { cursor: "invalid" }, { pageSize: 201 }, { pageSize: [ 1 ] } ].each do |params|
      get @path, params:, headers: @headers
      assert_response :bad_request
    end
  end

  test "improvement notes need no Build and stay out of ordinary reviews and summaries" do
    prototype = prototypes.create(repository: @repository)
    ordinary = create_comment(prototype, 1)
    note = ReviewComment.create! \
      prototype:,
      user: @author,
      kind: "improvement_note",
      local_id: SecureRandom.uuid,
      note_revision: 1,
      note_status: "open",
      body: "Polish the Save button",
      anchor: ordinary.anchor

    assert_nil note.build_id
    assert_empty note.thread_reads
    assert_not_includes prototype.review_comments, note
    collection = Learning::Collection.new(Learning::Store.new(@repository)).log
    assert_equal [ ordinary.id ], collection[:calls].sole[:result][:threads].pluck(:id)
    [ @path, canvas_api_review_comments_path(@repository.route_id, prototype), @summary_path ].each do |path|
      get path, headers: @headers
      assert_response :success
      assert_equal [ ordinary.id ], JSON.parse(response.body).fetch("comments").pluck("id")
    end
    [ @path, canvas_api_review_comments_path(@repository.route_id, prototype) ].each do |path|
      get path, params: { improvement_notes: "only" }, headers: @headers
      assert_response :success
      comments = JSON.parse(response.body).fetch("comments")
      assert_equal [ note.id ], comments.pluck("id")
      assert_equal "improvement_note", comments.first.fetch("kind")
      assert_equal false, comments.first.fetch("viewerCanEdit")
      get path, params: { improvement_notes: "include" }, headers: @headers
      assert_equal [ note.id, ordinary.id ], JSON.parse(response.body).fetch("comments").pluck("id")
      get path, params: { improvement_notes: "invalid" }, headers: @headers
      assert_response :bad_request
    end
  end

  test "creator note synchronization is idempotent, revision guarded and requires write access" do
    prototype = prototypes.create(repository: @repository)
    ordinary = create_comment(prototype, 1)
    path = canvas_api_improvement_notes_path(@repository.route_id, prototype)
    input = {
      local_id: SecureRandom.uuid, revision: 1, previous_revision: 0, body: "Polish this", status: "open",
      deleted: false, anchor: ordinary.anchor, capture: ""
    }
    post path, params: input, headers: @headers, as: :json
    assert_response :forbidden
    stub_github_permissions([ repository_payload(2001, "github/prototype") ], { 2001 => "push" })
    assert_no_difference "Notification.count" do
      assert_difference "ReviewComment.count", 1 do
        post path, params: input, headers: @headers, as: :json
        assert_response :success
      end
    end
    assert_no_difference "ReviewComment.count" do
      post path, params: input, headers: @headers, as: :json
      assert_response :success
    end
    post path, params: input.merge(body: "Different same revision"), headers: @headers, as: :json
    assert_response :conflict
    post path, params: input.merge(revision: 2, previous_revision: 1, body: "Edited"), headers: @headers, as: :json
    assert_response :success
    post path, params: input.merge(revision: 4, previous_revision: 1, body: "Stale clone with more edits"), headers: @headers, as: :json
    assert_response :conflict
    post path, params: input.merge(revision: 3, anchor: input[:anchor].merge("selector" => "#other")), headers: @headers, as: :json
    assert_response :conflict
    post path, params: input, headers: @headers, as: :json
    assert_response :conflict
    get path, headers: @headers
    assert_equal [ @viewer.login ], JSON.parse(response.body).fetch("notes").map { _1.fetch("author").fetch("login") }
    note = prototype.improvement_notes.first!
    assert_equal @viewer, note.user
    assert_equal "Edited", note.body
    prototype.improvement_notes.create! \
      user: @author,
      local_id: SecureRandom.uuid,
      body: "Another author's note",
      note_revision: 1,
      note_status: "open",
      anchor: ordinary.anchor,
      capture: ""
    get path, headers: @headers
    assert_equal [ @viewer.login ], JSON.parse(response.body).fetch("notes").map { _1.fetch("author").fetch("login") }
    post path, params: input.merge(revision: 3, previous_revision: 2, deleted: true), headers: @headers, as: :json
    assert_response :success
    assert_nil note.reload.body
    post path, params: input.merge(revision: 4), headers: @headers, as: :json
    assert_response :conflict
  end

  test "note writes reject oversized bodies before JSON parsing or repository authorization" do
    prototype = prototypes.create(repository: @repository)
    path = canvas_api_improvement_notes_path(@repository.route_id, prototype)
    assert_no_difference "ReviewComment.count" do
      post path, params: "{" * 1_550_001,
        headers: @headers.merge("CONTENT_TYPE" => "application/json")
      assert_response :content_too_large
    end
  end

  test "note writes share the ordinary comment budget and leave rejected changes unapplied" do
    prototype = prototypes.create(repository: @repository)
    ordinary = create_comment(prototype, 1)
    path = canvas_api_improvement_notes_path(@repository.route_id, prototype)
    input = {
      local_id: SecureRandom.uuid, revision: 1, previous_revision: 0, body: "Polish this",
      status: "open", deleted: false, anchor: ordinary.anchor, capture: ""
    }
    stub_github_permissions([ repository_payload(2001, "github/prototype") ], { 2001 => "push" })
    store = ActiveSupport::Cache::MemoryStore.new
    Rails.cache.define_singleton_method(:increment) { |*args, **kwargs| store.increment(*args, **kwargs) }
    begin
      60.times do
        post path, params: input, headers: @headers, as: :json
        assert_response :success
      end
      assert_no_difference "ReviewComment.count" do
        post path, params: input.merge(local_id: SecureRandom.uuid), headers: @headers, as: :json
        assert_response :too_many_requests
        assert_equal "60", response.headers["Retry-After"]
      end
      get path, headers: @headers
      assert_response :success
      assert_equal 1, JSON.parse(response.body).fetch("notes").length
    ensure
      Rails.cache.singleton_class.remove_method(:increment)
    end
  end

  private

  def issue_grant(user)
    token = "rp_#{SecureRandom.urlsafe_base64(32)}"
    grant = CanvasGrant.create! \
      repository: @repository,
      user:,
      token_digest: Digest::SHA256.hexdigest(token),
      expires_at: 7.days.from_now
    [ grant, token ]
  end

  def create_comment(prototype, number)
    build = builds.create_successful(prototype:, number:, commit_sha: number.to_s(16).rjust(40, "0"))
    ReviewComment.create! \
      prototype:,
      build:,
      user: @author,
      body: "Review Build #{number}",
      anchor: {
        "schemaVersion" => 1,
        "kind" => "element",
        "route" => { "pathname" => "/", "search" => "", "hash" => "" },
        "selector" => "#save",
        "accessibleName" => "Save",
        "tagName" => "button",
        "selectedText" => "",
        "rect" => { "x" => 20, "y" => 30, "width" => 100, "height" => 32 },
        "viewport" => { "width" => 1280, "height" => 720, "scrollX" => 0, "scrollY" => 0 },
        "elementOffset" => { "x" => 0.5, "y" => 0.5 }
      }
  end
end
