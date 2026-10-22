module AuthorizationContinuationHelpers
  private

  def verify_pending_action(challenge, path:, method:)
    post fresh_authorization_path(challenge.public_id)
    state = Rack::Utils.parse_query(URI(response.location).query).fetch("state")
    get github_authentication_callback_path, params: { code: "code", state: }
    assert_redirected_to fresh_authorization_path(challenge.public_id)
    follow_redirect!(as: :json)
    assert_response :success
    form = JSON.parse(response.body).fetch("data")
    assert_equal path, form.fetch("submitPath")
    assert_equal({ "id" => challenge.public_id, "method" => method }, form.fetch("continuation"))
    assert_equal "private, no-store", response.headers["Cache-Control"]
    form
  end

  def continue_pending_action(form, **extra)
    continuation = form.fetch("continuation")
    post \
      form.fetch("submitPath"),
      params: extra.merge(
        authorization_continuation_id: continuation.fetch("id"),
        _method: continuation.fetch("method")
      )
  end
end
