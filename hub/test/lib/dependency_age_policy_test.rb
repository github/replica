require "test_helper"
require "tmpdir"
require "dependency_age_policy"

class DependencyAgePolicyTest < ActiveSupport::TestCase
  FakeClient = Data.define(:publication_times) do
    # Returns deterministic metadata so policy behavior can be tested without registries.
    def published_at(dependency)
      value = publication_times.fetch([ dependency.ecosystem, dependency.name, dependency.version ])
      raise value if value.is_a?(Exception)

      value
    end
  end

  test "passes when locked npm, gem, and Action dependencies are seven days old" do
    now = Time.utc(2026, 9, 18, 12)

    Dir.mktmpdir do |root|
      write_repository \
        root,
        npm_version: "1.0.0",
        gem_version: "1.0.0",
        action_reference: "example/action@#{"a" * 40}"
      publication_times = {
        [ "npm", "example-package", "1.0.0" ] => now - 7.days,
        [ "bundler", "example-gem", "1.0.0" ] => now - 8.days,
        [ "bundler", "bundler", "4.0.13" ] => now - 30.days,
        [ "github-actions", "example/action", "a" * 40 ] => now - 9.days
      }
      client = FakeClient.new(publication_times)

      result = DependencyAgePolicy::Audit.new(root:, client:, now:).call

      assert_predicate result, :success?
      assert_equal 4, result.checked_count
    end
  end

  test "rejects a locked npm package published within seven days" do
    now = Time.utc(2026, 9, 18, 12)

    Dir.mktmpdir do |root|
      write_repository(root, npm_version: "2.0.0")
      publication_times = {
        [ "npm", "example-package", "2.0.0" ] => now - 1.day,
        [ "bundler", "example-gem", "1.0.0" ] => now - 30.days,
        [ "bundler", "bundler", "4.0.13" ] => now - 30.days
      }
      client = FakeClient.new(publication_times)

      result = DependencyAgePolicy::Audit.new(root:, client:, now:).call

      refute_predicate result, :success?
      assert_equal "example-package", result.violations.first.dependency.name
    end
  end

  test "checks an npm alias using the package name recorded in the lockfile" do
    now = Time.utc(2026, 9, 18, 12)

    Dir.mktmpdir do |root|
      write_repository \
        root,
        npm_package_path: "node_modules/@typescript/native",
        npm_package_name: "typescript",
        npm_version: "7.0.2"
      publication_times = {
        [ "npm", "typescript", "7.0.2" ] => now - 30.days,
        [ "bundler", "example-gem", "1.0.0" ] => now - 30.days,
        [ "bundler", "bundler", "4.0.13" ] => now - 30.days
      }
      client = FakeClient.new(publication_times)

      result = DependencyAgePolicy::Audit.new(root:, client:, now:).call

      assert_predicate result, :success?
      assert_equal 3, result.checked_count
    end
  end

  test "rejects a locked gem published within seven days" do
    now = Time.utc(2026, 9, 18, 12)

    Dir.mktmpdir do |root|
      write_repository(root, gem_version: "2.0.0")
      publication_times = {
        [ "npm", "example-package", "1.0.0" ] => now - 30.days,
        [ "bundler", "example-gem", "2.0.0" ] => now - 2.days,
        [ "bundler", "bundler", "4.0.13" ] => now - 30.days
      }
      client = FakeClient.new(publication_times)

      result = DependencyAgePolicy::Audit.new(root:, client:, now:).call

      refute_predicate result, :success?
      assert_equal "example-gem", result.violations.first.dependency.name
    end
  end

  test "rejects an Action commit created within seven days" do
    now = Time.utc(2026, 9, 18, 12)

    Dir.mktmpdir do |root|
      write_repository(root, action_reference: "example/action@#{"b" * 40}")
      publication_times = {
        [ "npm", "example-package", "1.0.0" ] => now - 30.days,
        [ "bundler", "example-gem", "1.0.0" ] => now - 30.days,
        [ "bundler", "bundler", "4.0.13" ] => now - 30.days,
        [ "github-actions", "example/action", "b" * 40 ] => now - 3.days
      }
      client = FakeClient.new(publication_times)

      result = DependencyAgePolicy::Audit.new(root:, client:, now:).call

      refute_predicate result, :success?
      assert_equal "example/action", result.violations.first.dependency.name
    end
  end

  test "rejects an external Action that is not pinned to a full commit SHA" do
    now = Time.utc(2026, 9, 18, 12)

    Dir.mktmpdir do |root|
      write_repository(root, action_reference: "example/action@v1")
      publication_times = {
        [ "npm", "example-package", "1.0.0" ] => now - 30.days,
        [ "bundler", "example-gem", "1.0.0" ] => now - 30.days,
        [ "bundler", "bundler", "4.0.13" ] => now - 30.days
      }
      client = FakeClient.new(publication_times)

      result = DependencyAgePolicy::Audit.new(root:, client:, now:).call

      refute_predicate result, :success?
      assert_includes result.failures.first.message, "full commit SHA"
    end
  end

  test "fails closed when publication metadata is unavailable" do
    now = Time.utc(2026, 9, 18, 12)

    Dir.mktmpdir do |root|
      write_repository(root)
      publication_times = {
        [ "npm", "example-package", "1.0.0" ] =>
          DependencyAgePolicy::VerificationError.new("registry unavailable"),
        [ "bundler", "example-gem", "1.0.0" ] => now - 30.days,
        [ "bundler", "bundler", "4.0.13" ] => now - 30.days
      }
      client = FakeClient.new(publication_times)

      result = DependencyAgePolicy::Audit.new(root:, client:, now:).call

      refute_predicate result, :success?
      assert_equal "registry unavailable", result.failures.first.message
    end
  end

  test "ignores Action examples inside installed npm packages" do
    now = Time.utc(2026, 9, 18, 12)

    Dir.mktmpdir do |root|
      write_repository(root)
      example_path = File.join(root, "actions/build/node_modules/example")
      FileUtils.mkdir_p(example_path)
      File.write(File.join(example_path, "action.yml"), "runs:\n  using: composite\n  steps:\n    - uses: example/action@v1\n")
      publication_times = {
        [ "npm", "example-package", "1.0.0" ] => now - 30.days,
        [ "bundler", "example-gem", "1.0.0" ] => now - 30.days,
        [ "bundler", "bundler", "4.0.13" ] => now - 30.days
      }
      client = FakeClient.new(publication_times)

      result = DependencyAgePolicy::Audit.new(root:, client:, now:).call

      assert_predicate result, :success?
    end
  end

  test "checks a quoted reusable workflow pinned to a commit SHA" do
    now = Time.utc(2026, 9, 18, 12)

    Dir.mktmpdir do |root|
      write_repository(root)
      action_sha = "c" * 40
      File.write \
        File.join(root, ".github/workflows/reusable.yml"),
        <<~YAML
          jobs:
            reuse:
              uses: "example/action@#{action_sha}"
        YAML
      publication_times = {
        [ "npm", "example-package", "1.0.0" ] => now - 30.days,
        [ "bundler", "example-gem", "1.0.0" ] => now - 30.days,
        [ "bundler", "bundler", "4.0.13" ] => now - 30.days,
        [ "github-actions", "example/action", action_sha ] => now - 30.days
      }
      client = FakeClient.new(publication_times)

      result = DependencyAgePolicy::Audit.new(root:, client:, now:).call

      assert_predicate result, :success?
      assert_equal 4, result.checked_count
    end
  end

  test "checks a nested Gemfile lock in a monorepo" do
    now = Time.utc(2026, 9, 18, 12)

    Dir.mktmpdir do |root|
      write_repository(root)
      FileUtils.mkdir_p(File.join(root, "hub"))
      FileUtils.mv(File.join(root, "Gemfile.lock"), File.join(root, "hub/Gemfile.lock"))
      publication_times = {
        [ "npm", "example-package", "1.0.0" ] => now - 30.days,
        [ "bundler", "example-gem", "1.0.0" ] => now - 30.days,
        [ "bundler", "bundler", "4.0.13" ] => now - 30.days
      }
      client = FakeClient.new(publication_times)

      result = DependencyAgePolicy::Audit.new(root:, client:, now:).call

      assert_predicate result, :success?
      assert_equal 3, result.checked_count
    end
  end

  test "excludes independently managed monorepo projects" do
    now = Time.utc(2026, 9, 18, 12)

    Dir.mktmpdir do |root|
      write_repository(root)
      FileUtils.mkdir_p(File.join(root, "starter"))
      File.write \
        File.join(root, "starter/package-lock.json"),
        JSON.generate(
          "packages" => {
            "" => {},
            "node_modules/starter-only-package" => { "version" => "1.0.0" }
          }
        )
      publication_times = {
        [ "npm", "example-package", "1.0.0" ] => now - 30.days,
        [ "bundler", "example-gem", "1.0.0" ] => now - 30.days,
        [ "bundler", "bundler", "4.0.13" ] => now - 30.days
      }
      client = FakeClient.new(publication_times)

      result = DependencyAgePolicy::Audit.new(root:, client:, now:, excluded_paths: [ "starter" ]).call

      assert_predicate result, :success?
      assert_equal 3, result.checked_count
    end
  end

  private

  # Creates the smallest representative repository while keeping each scenario explicit.
  def write_repository(
    root,
    npm_package_path: "node_modules/example-package",
    npm_package_name: nil,
    npm_version: "1.0.0",
    gem_version: "1.0.0",
    action_reference: nil
  )
    FileUtils.mkdir_p(File.join(root, ".github/workflows"))
    npm_package = {
      "version" => npm_version
    }
    npm_package["name"] = npm_package_name if npm_package_name
    package_lock = {
      "packages" => {
        "" => {},
        npm_package_path => npm_package
      }
    }
    File.write \
      File.join(root, "package-lock.json"),
      JSON.generate(package_lock)
    File.write \
      File.join(root, "Gemfile.lock"),
      <<~LOCKFILE
        GEM
          remote: https://rubygems.org/
          specs:
            example-gem (#{gem_version})

        PLATFORMS
          ruby

        DEPENDENCIES
          example-gem

        BUNDLED WITH
          4.0.13
      LOCKFILE

    return unless action_reference

    File.write \
      File.join(root, ".github/workflows/ci.yml"),
      <<~YAML
        jobs:
          test:
            steps:
              - uses: #{action_reference}
      YAML
  end
end
