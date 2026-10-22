# Applies the same content and author rules to incoming and saved messages.
class ImprovementComment::MessageContract < ActiveRecord::AssociatedObject
  WORK_STATUSES = %w[open sent ready blocked].freeze
  AGENT_STATUSES = %w[ready blocked].freeze
  LOGIN = /\A[a-z0-9][a-z0-9_-]{0,38}\z/i

  # Validates request and answer content, including cleared deletion tombstones.
  def validate(role:, body:, status:, author: nil, deleted: false)
    statuses = role == "copilot" ? AGENT_STATUSES : WORK_STATUSES
    return invalid("Message role must be author or copilot.") unless %w[author copilot].include?(role)
    return invalid("Message status does not match its role.") unless statuses.include?(status)
    return invalid("Agent responses cannot have author snapshots.") if role == "copilot" && author
    return invalid("Deleted messages cannot retain text or authors.") if deleted && (body || author)
    return true if deleted
    return invalid("Message body must be nonblank UTF-8 text.") unless body.is_a?(String) && body.valid_encoding? && body.present?
    return invalid("Message body must be 10000 UTF-8 bytes or fewer.") if body.bytesize > ReviewComment::BODY_MAXIMUM_BYTES
    if role == "copilot" && body.encode(Encoding::UTF_16LE).bytesize > 4_000
      return invalid("Copilot body must be 2000 UTF-16 code units or fewer.")
    end

    author.nil? || validate_author(author)
  rescue EncodingError
    invalid("Message body must contain valid UTF-8 text.")
  end

  # Restricts display snapshots to the owner without requiring their current login.
  def validate_author(author)
    unless author.is_a?(Hash) && author.keys.sort == %w[avatarUrl id login] &&
        author["id"].is_a?(Integer) && author["id"] == record.user_id &&
        author["login"].is_a?(String) && LOGIN.match?(author["login"])
      return invalid("Author snapshots must identify this note's owner.")
    end
    avatar = author["avatarUrl"]
    return true if avatar.nil?
    return invalid("Author avatar must be a supported GitHub URL.") unless avatar.is_a?(String) && avatar.length <= 2048

    url = URI.parse(avatar)
    return invalid("Author avatar must be a supported GitHub URL.") unless url.scheme == "https" && url.host == "avatars.githubusercontent.com" && url.userinfo.nil? && url.port == 443

    true
  rescue URI::InvalidURIError
    invalid("Author avatar must be a supported GitHub URL.")
  end

  private

  # Uses consistent errors for incoming JSON and stored message rows.
  def invalid(message)
    record.errors.add(:base, message)
    false
  end
end
