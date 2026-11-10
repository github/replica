require "test_helper"

class PrototypeDocumentTitlesTest < ActionDispatch::IntegrationTest
  setup do
    host! "replica.localhost:19500"
    github_app_configurations.create_installed
    payload = repository_payload(2001, "github/prototype")
    stub_github_sign_in(repositories: [ payload ], permissions: { 2001 => "pull" })
    sign_in_to_hub
    @repository = Repository.find_by!(github_id: 2001)
  end

  test "uses only the prototype name on a direct viewer load and in navigation data" do
    prototype = prototypes.create(repository: @repository, name: "Welcome redesign")
    path = repository_prototype_path(@repository.route_id, prototype)

    get path

    assert_response :success
    assert_select "head > title", text: "Welcome redesign", count: 1

    get path, as: :json

    assert_response :success
    data = JSON.parse(response.body).fetch("data")
    assert_equal "Welcome redesign", data.fetch("prototypeName")
    assert_equal "Replica Hub", data.fetch("defaultDocumentTitle")
  end

  test "escapes special characters in the HTML title without changing the prototype name" do
    name = %q(Design & "research" </title><script>alert('test')</script>)
    prototype = prototypes.create(repository: @repository, name:)
    path = repository_prototype_path(@repository.route_id, prototype)

    get path

    assert_response :success
    assert_select "head > title", text: name, count: 1
    assert_select "script", text: "alert('test')", count: 0

    get path, as: :json

    assert_response :success
    assert_equal name, JSON.parse(response.body).fetch("data").fetch("prototypeName")
  end

  test "uses the branch name when the prototype has no saved name" do
    prototype = prototypes.create(repository: @repository, branch_name: "prototype/unnamed")
    path = repository_prototype_path(@repository.route_id, prototype)

    get path

    assert_response :success
    assert_select "head > title", text: "prototype/unnamed", count: 1

    get path, as: :json

    assert_response :success
    assert_equal "prototype/unnamed", JSON.parse(response.body).fetch("data").fetch("prototypeName")
  end

  test "keeps the generic Hub title on the gallery and prototype history" do
    prototype = prototypes.create(repository: @repository, name: "Welcome redesign")
    paths = [
      repository_path(@repository.route_id),
      repository_prototype_builds_path(@repository.route_id, prototype)
    ]

    paths.each do |path|
      get path

      assert_response :success
      assert_select "head > title", text: "Replica Hub", count: 1
    end
  end
end
