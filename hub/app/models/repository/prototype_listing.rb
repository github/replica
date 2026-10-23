# Selects bounded gallery pages and registration authors within one repository.
class Repository::PrototypeListing < ActiveRecord::AssociatedObject
  class InvalidQuery < StandardError; end

  PAGE_SIZE = 24
  AUTHORS_PAGE_SIZE = 20
  QUERY_MAXIMUM_LENGTH = 200
  Page = Data.define \
    :prototypes, :query, :author, :author_user, :matching_count,
    :page, :page_count

  # Filters before paging, leaving Build hydration to the selected records.
  def page(user:, query: nil, author: nil, page: nil)
    query = normalized_query(query)
    author = normalized_author(author)
    author_id = author == "me" ? user.id : author.presence&.to_i
    relation = base
    relation = relation.where(author_id:) if author_id
    if query.present?
      relation = relation.left_joins(:author).where \
        "prototypes.name LIKE :query ESCAPE '\\' OR prototypes.description LIKE :query ESCAPE '\\' " \
          "OR prototypes.branch_name LIKE :query ESCAPE '\\' OR users.login LIKE :query ESCAPE '\\' " \
          "OR users.name LIKE :query ESCAPE '\\'",
        query: "%#{Prototype.sanitize_sql_like(query)}%"
    end
    matching_count = relation.count
    raise InvalidQuery if page && (!page.is_a?(String) || !page.match?(/\A[1-9]\d{0,8}\z/))

    page_count = [ (matching_count.to_f / PAGE_SIZE).ceil, 1 ].max
    page = [ page ? page.to_i : 1, page_count ].min
    rows = relation.order(registered_at: :desc, id: :desc)
      .offset((page - 1) * PAGE_SIZE).limit(PAGE_SIZE).to_a

    Page.new \
      prototypes: rows,
      query:,
      author:,
      author_user: author_id && User.where(id: base.select(:author_id)).find_by(id: author_id),
      matching_count:,
      page:,
      page_count:
  end

  # Searches all eligible registration authors without enumerating the gallery.
  def authors(user:, query: nil, cursor: nil)
    query = normalized_query(query)
    relation = User.where(id: base.select(:author_id)).where.not(id: user.id)
    if query.present?
      relation = relation.where \
        "login LIKE :query ESCAPE '\\' OR name LIKE :query ESCAPE '\\'",
        query: "%#{User.sanitize_sql_like(query)}%"
    end
    scope = { "version" => 1, "repository" => record.id, "user" => user.id, "query" => query }
    boundary = read_cursor(cursor, scope)
    if boundary
      raise InvalidQuery unless boundary["login"].is_a?(String) && boundary["login"].length <= 255

      relation = relation.where \
        "login > :login OR (login = :login AND id > :id)",
        login: boundary.fetch("login"), id: boundary.fetch("id")
    end
    rows = relation.order(:login, :id).limit(AUTHORS_PAGE_SIZE + 1).to_a
    authors = rows.first(AUTHORS_PAGE_SIZE)
    next_cursor = if rows.size > AUTHORS_PAGE_SIZE
      write_cursor(scope, { "login" => authors.last.login, "id" => authors.last.id })
    end
    { authors:, next_cursor: }
  end

  private

  # Shares eligibility with the gallery, not all stored branch owners.
  def base
    record.reviewable_prototypes.active.registered
  end

  # Rejects malformed or oversized input rather than silently changing its meaning.
  def normalized_query(value)
    return "" if value.nil?
    raise InvalidQuery unless value.is_a?(String) && value.length <= QUERY_MAXIMUM_LENGTH

    value.strip
  end

  # Named authors use immutable saved IDs; Me always resolves on the server.
  def normalized_author(value)
    return "" if value.nil? || value == ""
    return value if value == "me"
    raise InvalidQuery unless value.is_a?(String) && value.match?(/\A[1-9]\d{0,17}\z/)

    value
  end

  # Validates only server-issued boundaries, never treating them as authorization.
  def read_cursor(value, scope)
    return if value.nil?
    raise InvalidQuery unless value.is_a?(String) && value.bytesize <= 2_048

    payload = verifier.verified(value)
    unless payload.is_a?(Hash) && payload.slice(*scope.keys) == scope &&
        payload["id"].is_a?(Integer) && payload["id"].positive?
      raise InvalidQuery
    end

    payload
  end

  # Adds the boundary to the exact source query.
  def write_cursor(scope, boundary)
    verifier.generate(scope.merge(boundary))
  end

  # Separates gallery tokens from other signed Hub values.
  def verifier
    Rails.application.message_verifier("prototype-listing")
  end
end
