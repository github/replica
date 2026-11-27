require "test_helper"

class ConversationNotificationsTest < ActiveSupport::TestCase
  setup do
    @build = builds.create_successful
    @author = users.create(github_id: 1001, login: "octocat")
    @participant = users.create(github_id: 1002, login: "mona")
    @actor = users.create(github_id: 1003, login: "hubot")
    @root = ReviewComment.create! \
      prototype: @build.prototype,
      build: @build,
      user: @author,
      body: "Review this iteration",
      anchor: anchor
    @root.replies.create!(prototype: @build.prototype, user: @participant, body: "My feedback")
    @root.with_lock { @root.mentions.sync!([ profile ]) }
  end

  test "new conversations notify the prototype owner without prior participation" do
    @build.prototype.update!(author: @participant)
    comment = ReviewComment.create_with_mentions! \
      prototype: @build.prototype, build: @build, user: @actor, body: "New feedback", anchor: anchor

    notification = Notification.for_user(@participant).sole
    assert_equal "comment_created", notification.kind
    assert_equal @actor, notification.actor
    assert_equal comment, notification.review_comment
    assert_nil notification.read_at
    assert_equal [ comment, @build.prototype ], notification.notification_resources.order(:id).map(&:resource)

    comment.thread.edit_body!("Edited feedback", actor: @actor)
    assert_equal notification.id, Notification.for_user(@participant).sole.id
    comment.thread.delete_body!(actor: @actor)
    assert_empty Notification.for_user(@participant)
    assert_not NotificationResource.exists?(notification_id: notification.id)
  end

  test "new conversations do not notify their author or a missing prototype owner" do
    @build.prototype.update!(author: @actor)
    assert_no_difference "Notification.count" do
      ReviewComment.create_with_mentions! \
        prototype: @build.prototype, build: @build, user: @actor, body: "My feedback", anchor: anchor
      @build.prototype.update!(author: nil)
      ReviewComment.create_with_mentions! \
        prototype: @build.prototype, build: @build, user: @actor, body: "Unowned feedback", anchor: anchor
    end
  end

  test "a direct mention takes precedence over a new conversation notification to the owner" do
    @build.prototype.update!(author: @participant)
    github_app_configurations.create_installed
    stub_github_installation_token
    eligible("mona", 1002)
    comment = ReviewComment.create_with_mentions! \
      prototype: @build.prototype, build: @build, user: @actor, body: "Feedback for @mona", anchor: anchor

    notification = Notification.for_user(@participant).sole
    assert_equal "comment_mention", notification.kind
    assert_equal comment, notification.review_comment
  end

  test "replies notify the prototype owner even without participation and only once after joining" do
    owner = users.create(github_id: 1005, login: "owner")
    @build.prototype.update!(author: owner)
    reply = @root.thread.create_reply!(user: @actor, body: "More feedback")
    assert_equal \
      [ 1001, 1002, 1004, 1005 ],
      Notification.where(source_key: "reply/#{reply.id}").includes(:recipient).map { _1.recipient.github_id }.sort

    own_reply = @root.thread.create_reply!(user: owner, body: "Thanks")
    assert_not Notification.for_user(owner).exists?(source_key: "reply/#{own_reply.id}")
    reply = @root.thread.create_reply!(user: @actor, body: "Another suggestion")
    assert_equal 1, Notification.for_user(owner).where(source_key: "reply/#{reply.id}").count
  end

  test "a direct mention takes precedence over a reply notification to a nonparticipating owner" do
    owner = users.create(github_id: 1005, login: "owner")
    @build.prototype.update!(author: owner)
    github_app_configurations.create_installed
    stub_github_installation_token
    eligible("owner", 1005)
    reply = @root.thread.create_reply!(user: @actor, body: "Please check @owner")

    notification = Notification.for_user(owner).sole
    assert_equal "comment_mention", notification.kind
    assert_equal reply, notification.review_comment
  end

  test "owner notification failures roll back a new conversation" do
    @build.prototype.update!(author: @participant)
    failure = -> { raise ActiveRecord::RecordInvalid, self }
    Notification.set_callback(:create, :after, failure)
    begin
      assert_no_difference [ "ReviewComment.count", "ReviewThreadRead.count", "Notification.count", "NotificationResource.count" ] do
        assert_raises(ActiveRecord::RecordInvalid) do
          ReviewComment.create_with_mentions! \
            prototype: @build.prototype, build: @build, user: @actor, body: "Must not partially save", anchor: anchor
        end
      end
    ensure
      Notification.skip_callback(:create, :after, failure)
    end
  end

  test "new replies notify authors and mentioned identities without creating Hub accounts" do
    assert_no_difference "User.count" do
      reply = @root.thread.create_reply!(user: @actor, body: "Another iteration")
      notifications = Notification.where(source_key: "reply/#{reply.id}")
      assert_equal [ 1001, 1002, 1004 ], notifications.includes(:recipient).map { _1.recipient.github_id }.sort
      assert_equal [ "comment_reply" ], notifications.distinct.pluck(:kind)
      assert notifications.all? { _1.review_comment == reply }
      assert notifications.all? { _1.notification_resources.count == 2 }
    end
  end

  test "own replies do not notify the author and plain edits do not create activity" do
    reply = @root.thread.create_reply!(user: @author, body: "Updated iteration")
    assert_equal [ 1002, 1004 ], Notification.where(source_key: "reply/#{reply.id}").includes(:recipient).map { _1.recipient.github_id }.sort
    assert_no_difference "Notification.count" do
      reply.thread.edit_body!("Corrected wording", actor: @author)
    end
  end

  test "a direct mention takes precedence over a reply notification to the same participant" do
    github_app_configurations.create_installed
    stub_github_installation_token
    eligible("mona", 1002)
    reply = @root.thread.create_reply!(user: @actor, body: "Please check this @mona")
    notifications = Notification.joins(:primary_resource)
      .where(notification_resources: { resource_id: reply.id, resource_type: "ReviewComment" })
    assert_equal 3, notifications.count
    assert_equal 1, notifications.joins(:recipient).where(github_identities: { github_id: 1002 }).count
    assert_equal "comment_mention", notifications.joins(:recipient).find_by!(github_identities: { github_id: 1002 }).kind
  end

  test "reactions notify only the message author and identical adds are idempotent" do
    reaction = @root.thread.add_reaction!(user: @participant, content: "+1", activity_version: @root.activity_version)
    notification = Notification.find_by!(source_key: "reaction/#{reaction.id}")
    assert_equal @author.github_id, notification.recipient.github_id
    assert_equal @participant, notification.actor
    assert_no_difference [ "Notification.count", "ReviewCommentReaction.count" ] do
      @root.thread.add_reaction!(user: @participant, content: "+1", activity_version: @root.activity_version)
    end
    assert_equal 1, @build.prototype.repository.analytics_events.where(name: "review_reaction_added").count
    assert_no_difference "Notification.count" do
      @root.thread.add_reaction!(user: @author, content: "heart", activity_version: @root.activity_version)
    end
  end

  test "removing a reaction withdraws its notification and readding creates new unread activity" do
    reply = @root.replies.sole
    repository = @build.prototype.repository
    events = repository.analytics_events.where(name: "review_reaction_added")
    reaction = reply.thread.add_reaction!(user: @actor, content: "+1", activity_version: @root.activity_version)
    notification = Notification.find_by!(source_key: "reaction/#{reaction.id}")
    event = events.sole
    assert_equal Analytics.actor_id(user: @actor), event.actor_id
    expected = { "repository_id" => repository.id, "prototype_id" => @build.prototype.id, "build_id" => @build.id,
      "thread_id" => @root.id, "comment_id" => reply.id }
    assert_equal expected, event.properties
    notification.update!(read_at: Time.current)
    reply.thread.remove_reaction!(user: @actor, content: "+1", activity_version: @root.activity_version)
    assert_not Notification.exists?(notification.id)
    assert_not NotificationResource.exists?(notification_id: notification.id)
    assert_equal event, events.sole
    added = reply.thread.add_reaction!(user: @actor, content: "+1", activity_version: @root.activity_version)
    assert_nil Notification.find_by!(source_key: "reaction/#{added.id}").read_at
    assert_equal 2, events.count
  end

  test "resolution transitions notify participants once per actual transition" do
    @root.thread.resolve_by!(@actor)
    assert_equal 3, Notification.where(kind: "thread_resolved").count
    assert_no_difference "Notification.count" do
      @root.thread.resolve_by!(@actor)
    end
    @root.thread.reopen_by!(@actor)
    assert_equal 3, Notification.where(kind: "thread_reopened").count
    assert_no_difference "Notification.count" do
      @root.thread.reopen_by!(@actor)
    end
    @root.thread.resolve_by!(@author)
    assert_equal 5, Notification.where(kind: "thread_resolved").count
  end

  test "removing one of several mentions retains participation until the last is removed" do
    second = @root.replies.create!(prototype: @build.prototype, user: @author, body: "Another mention")
    second.with_lock { second.mentions.sync!([ profile ]) }
    @root.thread.edit_body!("First mention removed", actor: @author)
    reply = @root.thread.create_reply!(user: @actor, body: "Still included")
    assert Notification.where(source_key: "reply/#{reply.id}").joins(:recipient).exists?(github_identities: { github_id: 1004 })

    second.thread.edit_body!("Last mention removed", actor: @author)
    reply = @root.thread.create_reply!(user: @actor, body: "No longer included")
    assert_not Notification.where(source_key: "reply/#{reply.id}").joins(:recipient).exists?(github_identities: { github_id: 1004 })
  end

  test "removing mentions does not remove an author's participation" do
    @root.with_lock do
      @root.mentions.sync!([ profile, { github_id: 1002, login: "mona", token_login: "mona", avatar_url: nil } ])
      @root.mentions.sync!([])
    end
    reply = @root.thread.create_reply!(user: @actor, body: "Authors stay included")
    assert_equal [ 1001, 1002 ], Notification.where(source_key: "reply/#{reply.id}").includes(:recipient).map { _1.recipient.github_id }.sort
  end

  test "deleting a message removes its reply and reaction notifications and resources" do
    reply = @root.thread.create_reply!(user: @actor, body: "Delete this")
    reaction = reply.thread.add_reaction!(user: @participant, content: "eyes", activity_version: @root.reload.activity_version)
    ids = Notification.where(source_key: [ "reply/#{reply.id}", "reaction/#{reaction.id}" ]).ids
    assert_equal 4, ids.length
    reply.thread.delete_body!(actor: @actor)
    assert_not Notification.where(id: ids).exists?
    assert_not NotificationResource.where(notification_id: ids).exists?
    assert_equal "comment_mention", Notification.sole.kind
  end

  test "notification failures roll back the reply and thread version" do
    version = @root.reload.activity_version
    failure = -> { raise ActiveRecord::RecordInvalid, self }
    Notification.set_callback(:create, :after, failure)
    begin
      assert_raises(ActiveRecord::RecordInvalid) do
        @root.thread.create_reply!(user: @actor, body: "Must not partially save")
      end

    ensure
      Notification.skip_callback(:create, :after, failure)
    end
    assert_equal version, @root.reload.activity_version
    assert_equal 1, @root.replies.count
    assert_equal 1, Notification.count
  end

  test "physically deleting a reply removes its activity and polymorphic resources" do
    reply = @root.thread.create_reply!(user: @actor, body: "Remove this source")
    reply.thread.add_reaction!(user: @participant, content: "heart", activity_version: @root.reload.activity_version)
    ids = Notification.joins(:primary_resource)
      .where(notification_resources: { resource_type: "ReviewComment", resource_id: reply.id }).ids
    assert_equal 4, ids.length
    reply.destroy!
    assert_not Notification.where(id: ids).exists?
    assert_not NotificationResource.where(notification_id: ids).exists?
    assert_equal "comment_mention", Notification.sole.kind
  end

  test "physically deleting a reaction withdraws its notification" do
    reaction = @root.thread.add_reaction!(user: @participant, content: "heart", activity_version: @root.activity_version)
    notification = Notification.find_by!(source_key: "reaction/#{reaction.id}")
    reaction.destroy!
    assert_not Notification.exists?(notification.id)
    assert_not NotificationResource.exists?(notification_id: notification.id)
  end

  test "a previously unregistered recipient receives retained activity on sign-in" do
    reply = @root.thread.create_reply!(user: @actor, body: "Before sign-in")
    user = users.create(github_id: 1004, login: "ghost")
    assert Notification.for_user(user).exists?(source_key: "reply/#{reply.id}")
  end

  private

  def profile
    { github_id: 1004, login: "ghost", token_login: "ghost", avatar_url: nil }
  end

  def eligible(login, id)
    body = JSON.generate(id:, login:, avatar_url: nil)
    stub_request(:get, "#{GITHUB_API_URL}/users/#{login}")
      .to_return(status: 200, body:, headers: { "Content-Type" => "application/json" })
    payload = repository_payload(@build.prototype.repository.github_id, @build.prototype.repository.name_with_owner)
    stub_github_permissions([ payload ], { payload.fetch("id") => "read" }, github_id: id, login:)
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
