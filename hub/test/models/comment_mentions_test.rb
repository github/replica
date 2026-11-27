require "test_helper"

class CommentMentionsTest < ActiveSupport::TestCase
  setup do
    github_app_configurations.create_installed
    stub_github_installation_token
    @build = builds.create_successful
    @author = users.create
    @root = ReviewComment.create! \
      prototype: @build.prototype,
      build: @build,
      user: @author,
      body: "Initial message",
      anchor: anchor
  end

  test "retains an immutable recipient without creating a Hub account" do
    eligible("mona", 1002)
    assert_no_difference "User.count" do
      @root.thread.edit_body!("Hello @mona and @MONA", actor: @author)
    end
    assert_equal 1, @root.comment_mentions.count
    notification = Notification.sole
    assert_equal 1002, notification.recipient.github_id
    assert_nil notification.recipient.user
    assert_equal @author, notification.actor
    assert_equal [ [ "ReviewComment", "primary" ], [ "Prototype", "context" ] ],
      notification.notification_resources.order(:id).pluck(:resource_type, :role)

    recipient = users.create(github_id: 1002, login: "mona")
    assert_equal notification, Notification.for_user(recipient).sole
    assert_equal recipient, notification.recipient.reload.user
    assert_empty Notification.for_user(@author)
  end

  test "ordinary edits do not notify twice and removal followed by readdition does" do
    eligible("mona", 1002)
    @root.thread.edit_body!("Hello @mona", actor: @author)
    notification = Notification.sole
    events = @build.prototype.repository.analytics_events.where(name: "review_mention_added")
    first_event = events.sole
    notification.update!(read_at: Time.current)
    @root.thread.edit_body!("Updated message for @mona", actor: @author)
    assert_equal notification.id, Notification.sole.id
    assert_not_nil Notification.sole.read_at
    assert_equal first_event, events.sole

    @root.thread.edit_body!("No longer mentioning anyone", actor: @author)
    assert_empty CommentMention.all
    assert_empty Notification.all
    assert_empty NotificationResource.all

    @root.thread.edit_body!("Hello again @mona", actor: @author)
    assert_not_equal notification.id, Notification.sole.id
    assert_nil Notification.sole.read_at
    assert_equal 2, events.count
  end

  test "self mentions and emails do not notify" do
    eligible("octocat", 1001)
    @root.thread.edit_body!("@octocat email@mona.test", actor: @author)
    assert_empty CommentMention.all
    assert_empty Notification.all
  end

  test "reply and root deletion remove only their own mention notifications" do
    eligible("mona", 1002)
    @root.thread.edit_body!("Hello @mona", actor: @author)
    reply = @root.thread.create_reply!(user: @author, body: "Reply to @mona")
    assert_equal 2, Notification.count
    reply.thread.delete_body!(actor: @author)
    assert_equal @root.id, Notification.sole.comment_mention.review_comment_id
    @root.thread.delete_body!(actor: @author)
    assert_empty Notification.all
    assert_empty NotificationResource.all
  end

  test "permission denial leaves the token plain and an outage rolls back the edit" do
    eligible("mona", 1002, permission: "none")
    @root.thread.edit_body!("Hello @mona", actor: @author)
    assert_empty Notification.all

    eligible("mona", 1002, permission: :failure)
    assert_raises(GithubClient::Error) do
      @root.thread.edit_body!("Changed @mona", actor: @author)
    end
    assert_equal "Hello @mona", @root.reload.body
    assert_empty CommentMention.all
  end

  test "a renamed GitHub user retains their existing mention and notification" do
    eligible("mona", 1002)
    @root.thread.edit_body!("Hello @mona", actor: @author)
    notification = Notification.sole
    eligible("renamed", 1002)
    @root.thread.edit_body!("Still referring to @mona", actor: @author)
    assert_equal notification.id, Notification.sole.id
    assert_equal "renamed", Notification.sole.recipient.login
    assert_equal "mona", @root.comment_mentions.sole.login
  end

  test "access revocation hides content and does not grant an orphan account access" do
    eligible("mona", 1002)
    @root.thread.edit_body!("Hello @mona", actor: @author)
    recipient = users.create(github_id: 1002, login: "mona")
    assert_equal 1, Notification.visible_to(recipient).count
    eligible("mona", 1002, permission: "none")
    assert_empty Notification.visible_to(recipient)
    @build.prototype.repository.update!(installation_state: "removed", removed_at: Time.current)
    assert_empty Notification.visible_to(recipient)
  end

  test "each root and reply allows ten distinct logins but rejects eleven before calling GitHub" do
    10.times { |index| eligible("person#{index}", 2000 + index) }
    body = 10.times.map { "@person#{_1}" }.join(" ")
    comment = ReviewComment.create_with_mentions! \
      prototype: @build.prototype, build: @build, user: @author, body:, anchor: anchor
    assert_equal 10, comment.comment_mentions.count
    reply = comment.thread.create_reply!(user: @author, body:)
    assert_equal 10, reply.comment_mentions.count
    assert_equal 20, Notification.count
    repository = @build.prototype.repository
    events = repository.analytics_events.where(name: "review_mention_added")
    assert_equal [ Analytics.actor_id(user: @author) ], events.distinct.pluck(:actor_id)
    ids = { "repository_id" => repository.id, "prototype_id" => @build.prototype.id,
      "build_id" => @build.id, "thread_id" => comment.id }
    expected = { ids.merge("comment_id" => comment.id) => 10, ids.merge("comment_id" => reply.id) => 10 }
    assert_equal expected, events.pluck(:properties).tally

    assert_raises(ReviewComment::TooManyMentions) do
      reply.thread.edit_body!("#{body} @eleventh", actor: @author)
    end

    assert_equal body, reply.reload.body
    assert_equal 20, Notification.count
  end

  test "a branch that becomes the repository default no longer appears in the inbox" do
    eligible("mona", 1002)
    @root.thread.edit_body!("Hello @mona", actor: @author)
    recipient = users.create(github_id: 1002, login: "mona")
    assert_equal 1, Notification.visible_to(recipient).count
    @build.prototype.repository.update!(default_branch: @build.prototype.branch_name)
    assert_empty Notification.visible_to(recipient)
  end

  private

  def eligible(login, id, permission: "read")
    profile = JSON.generate(id:, login:, avatar_url: nil)
    [ "/users/#{login}", "/user/#{id}" ].each do |path|
      stub_request(:get, "#{GITHUB_API_URL}#{path}")
        .to_return(status: 200, body: profile, headers: { "Content-Type" => "application/json" })
    end
    payload = repository_payload(@build.prototype.repository.github_id, @build.prototype.repository.name_with_owner)
    stub_github_permissions([ payload ], { payload.fetch("id") => permission }, github_id: id, login:)
  end

  def anchor
    {
      "schemaVersion" => 1, "kind" => "element",
      "route" => { "pathname" => "/", "search" => "", "hash" => "" },
      "selector" => "#save", "accessibleName" => "Save", "tagName" => "button", "selectedText" => "",
      "rect" => { "x" => 20, "y" => 30, "width" => 100, "height" => 32 },
      "viewport" => { "width" => 1280, "height" => 720, "scrollX" => 0, "scrollY" => 0 },
      "elementOffset" => { "x" => 0.5, "y" => 0.5 }
    }
  end
end
