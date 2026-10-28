require "test_helper"

class ImprovementCommentTest < ActiveSupport::TestCase
  test "the database rejects duplicate message identities within an owner's prototype" do
    root = create_note
    duplicate = root.replies.first.dup
    duplicate.position = root.replies.maximum(:position) + 1

    assert_raises(ActiveRecord::StatementInvalid) { duplicate.save!(validate: false) }
    assert_equal 2, root.replies.count
  end

  test "the database keeps answer links unique and inside their conversation" do
    root = create_note
    other = create_note(prototype: root.prototype, user: root.user)
    response = root.replies.find_by!(role: "copilot")
    link = ImprovementCommentReply.find_by!(response_id: response.id)

    assert_raises(ActiveRecord::StatementInvalid) { link.dup.save!(validate: false) }
    assert_raises(ActiveRecord::StatementInvalid) { link.update_columns(request_id: other.id) }
    assert_equal root.id, link.reload.request_id
  end

  test "Copilot answers allow exactly 2000 UTF-16 units without partial writes on overflow" do
    root = create_note
    input = {
      local_id: root.local_id, revision: 2, previous_revision: 1, build_number: root.build.number,
      body: root.body, status: "open", deleted: false, anchor: root.anchor, thread: root.note_thread
    }
    input[:thread]["messages"] << {
      "id" => SecureRandom.uuid, "role" => "copilot", "body" => "😀" * 1000,
      "status" => "ready", "requestIds" => [ root.local_id ]
    }
    ImprovementComment.synchronize!(prototype: root.prototype, user: root.user, attributes: input)
    assert_equal "😀" * 1000, root.reload.note_thread.fetch("messages").last.fetch("body")
    input.merge!(revision: 3, previous_revision: 2)
    overflow = input[:thread]["messages"].last.merge \
      "id" => SecureRandom.uuid, "body" => "😀" * 1000 + "x"
    input[:thread]["messages"] << overflow

    assert_no_difference [ "ImprovementComment.count", "ImprovementCommentReply.count" ] do
      assert_raises(ActiveRecord::RecordInvalid) do
        ImprovementComment.synchronize!(prototype: root.prototype, user: root.user, attributes: input)
      end
    end
    assert_equal 2, root.reload.note_revision
  end

  private

  def create_note(prototype: prototypes.create, user: users.create)
    local_id = SecureRandom.uuid
    build = prototype.builds.first || builds.create_successful(prototype:)
    ImprovementComment.synchronize! \
      prototype:, user:,
      attributes: {
        local_id:, build_number: build.number, revision: 1, previous_revision: 0,
        body: "Original request", status: "open", deleted: false, anchor: valid_anchor,
        thread: {
          "originalStatus" => "open",
          "messages" => [
            { "id" => SecureRandom.uuid, "role" => "author", "body" => "Follow-up request", "status" => "open" },
            { "id" => SecureRandom.uuid, "role" => "copilot", "body" => "Saved answer", "status" => "ready", "requestIds" => [ local_id ] }
          ]
        }
      }
  end

  def valid_anchor
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
