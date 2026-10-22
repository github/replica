# Validates the conversation JSON received from the client before saving its messages and response links.
class ImprovementComment::ThreadContract < ActiveRecord::AssociatedObject
  # Rejects malformed conversations or changes to saved history before any rows are written.
  def validate!(thread, previous: record.note_thread)
    validate_payload(thread)
    validate_history(previous, thread) if previous && thread.is_a?(Hash)
    raise ActiveRecord::RecordInvalid, record if record.errors.any?
  end

  private

  # Requires one current shape and consistent request statuses.
  def validate_payload(thread)
    return invalid("must be a JSON object") unless thread.is_a?(Hash)
    fields = %w[messages originalStatus]
    fields << "originalAuthor" if thread.key?("originalAuthor")
    return invalid("thread fields must match the conversation shape") unless thread.keys.sort == fields.sort
    return unless !thread.key?("originalAuthor") || record.message_contract.validate_author(thread["originalAuthor"])
    return invalid("originalStatus must be a work status") unless ImprovementComment::MessageContract::WORK_STATUSES.include?(thread["originalStatus"])

    messages = thread["messages"]
    return invalid("messages must be an array") unless messages.is_a?(Array)

    ids = [ record.local_id ]
    requests = [ record.local_id ]
    messages.each do |message|
      return unless validate_message(message, ids, requests)

      ids << message["id"]
      requests << message["id"] if message["role"] == "author"
    end
    statuses = [ thread["originalStatus"] ] + messages.filter_map { _1["status"] if _1["role"] == "author" }
    aggregate = %w[open sent blocked ready].find { statuses.include?(_1) }
    expected = record.note_status == "resolved" && statuses.all?("ready") ? "resolved" : aggregate
    invalid("status must match its requests") unless record.note_status == expected
  end

  # Preserves saved order, text and established author snapshots.
  def validate_history(previous, thread)
    if previous.key?("originalAuthor") && previous["originalAuthor"] != thread["originalAuthor"]
      return invalid("the original author snapshot cannot change")
    end

    old_messages = previous["messages"]
    messages = thread["messages"]
    return invalid("saved messages cannot be removed or changed") unless messages.is_a?(Array) && messages.size >= old_messages.size

    old_messages.each_with_index do |old, index|
      current = messages[index]
      same = if old["role"] == "author" && current.is_a?(Hash)
        ignored = [ "status" ]
        ignored << "author" unless old.key?("author")
        old.except(*ignored) == current.except(*ignored)
      else
        old == current
      end
      invalid("saved messages cannot be removed, changed or reordered") unless same
    end
  end

  # Limits agent answers to requests that already exist in this conversation.
  def validate_message(message, ids, requests)
    return invalid("messages must be JSON objects") unless message.is_a?(Hash)

    role = message["role"]
    return invalid("message role must be author or copilot") unless %w[author copilot].include?(role)

    keys = %w[id role body status]
    keys << "requestIds" if role == "copilot"
    keys << "author" if role == "author" && message.key?("author")
    return invalid("message fields do not match its role") unless message.keys.sort == keys.sort
    return invalid("author must be a snapshot") if message.key?("author") && message["author"].nil?
    return invalid("message IDs must be unique UUIDs") unless message["id"].is_a?(String) && ImprovementComment::UUID.match?(message["id"]) && !ids.include?(message["id"])
    return unless record.message_contract.validate(role:, body: message["body"], status: message["status"], author: message["author"])

    if role == "copilot"
      references = message["requestIds"]
      unless references.is_a?(Array) && references.any? && references.uniq == references && references.all? { requests.include?(_1) }
        return invalid("requestIds must uniquely reference the original or preceding author messages")
      end
    end
    true
  end

  # Reports malformed conversation data on its input field.
  def invalid(message)
    record.errors.add(:note_thread, message)
    false
  end
end
