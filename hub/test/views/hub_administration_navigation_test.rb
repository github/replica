require "test_helper"

class HubAdministrationNavigationTest < ActionView::TestCase
  test "a saved GitHub administrator gets the administration links" do
    user = users.create(hub_admin: true)
    data = navigation_for(user)

    assert_equal %w[github copilot admins sharing sessions], data.fetch("administrationLinks").pluck("section")
    assert_not data.key?("hubAdministrationPath")
    assert_not data.key?("hubAdministrationLabel")
  end

  test "a repository administrator does not get Hub administration" do
    @repository_permission = "admin"
    data = navigation_for(users.create)
    assert_empty data.fetch("administrationLinks")
    assert_equal "Feedback", data.fetch("feedbackLabel")
  end

  test "a local identity does not get Hub administration even with a saved role" do
    original_enabled = LocalDevelopment.method(:enabled?)
    LocalDevelopment.define_singleton_method(:enabled?) { true }
    begin
      user = users.create(github_id: nil, hub_admin: true)
      assert_no_administration(user)
    ensure
      LocalDevelopment.define_singleton_method(:enabled?, original_enabled)
    end
  end

  test "revocation removes the links even when the request has a cached administrator" do
    user = users.create(hub_admin: true)
    assert_not_empty navigation_for(user).fetch("administrationLinks")
    User.where(id: user.id).update_all(hub_admin: false)
    assert user.hub_admin?
    assert_no_administration(user)
  end

  test "granting the saved role is visible without trusting the cached role" do
    user = users.create
    User.where(id: user.id).update_all(hub_admin: true)
    assert_not user.hub_admin?
    assert_not_empty navigation_for(user).fetch("administrationLinks")
  end

  test "the Hub workspace uses the saved role rather than a cached administrator" do
    user = users.create(hub_admin: true)
    User.where(id: user.id).update_all(hub_admin: false)
    assert user.hub_admin?
    Current.set(session: Session.new(user:)) do
      rendered = ApplicationController.renderer.render \
        partial: "shared/hub_administration_workspace",
        formats: [ :json ],
        locals: { selected_section: "sharing" }
      data = JSON.parse(rendered)
      assert_nil data.fetch("administrationWorkspace")
      assert_equal user.login, data.fetch("authenticatedWorkspace").fetch("currentUser").fetch("login")
      assert_not data.fetch("authenticatedWorkspace").key?("links")
    end
  end

  test "signed-out and deleted accounts do not get Hub administration" do
    assert_no_administration(nil)
    user = users.create(hub_admin: true)
    user.destroy!
    assert_no_administration(user)
  end

  private

  # Reads the real projection without a network client or persistent browser Session.
  def navigation_for(user)
    Current.set(session: user ? Session.new(user:) : nil) do
      rendered = ApplicationController.renderer.render \
        partial: "shared/hub_administration_navigation",
        formats: [ :json ]
      JSON.parse(rendered)
    end
  end

  # Ineligible responses have no administration links.
  def assert_no_administration(user)
    data = navigation_for(user)
    assert_empty data.fetch("administrationLinks")
  end
end
