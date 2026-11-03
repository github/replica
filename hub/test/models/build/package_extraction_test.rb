require "test_helper"
require "zip"

class Build::PackageExtractionTest < ActiveSupport::TestCase
  setup do
    @original_maximum = Rails.configuration.x.maximum_package_bytes
    Rails.configuration.x.maximum_package_bytes = 150.megabytes
    @root = Rails.root.join("storage/template-package-test-#{SecureRandom.hex(5)}")
    FileUtils.mkdir_p(@root)
    @store = ArtifactStore.new(adapter: ArtifactStore::Local.new(root: @root.join("artifacts")))
    @files = {
      "dist/index.html" => "<title>Templates</title>",
      "screenshots/desktop.png" => "desktop",
      "screenshots/narrow.png" => "narrow"
    }
    @template = { id: "welcome", name: "Welcome", category: "Editorial",
      description: "A journal.", path: "/settings?q=1#details" }
  end

  teardown do
    Rails.configuration.x.maximum_package_bytes = @original_maximum
    FileUtils.rm_rf(@root)
  end

  test "retains manifest and exact screenshots alongside legacy package files" do
    files = template_files
    extract(files)
    assert_equal files.keys.map { "builds/1/#{_1}" }.sort, @store.list("builds/1")
  end

  test "counts screenshots and template metadata against the configured total before storing files" do
    files = template_files
    maximum = files.values.sum(&:bytesize)

    assert_equal maximum, extract(files, maximum_bytes: maximum)
    @store.delete_prefix("builds/1")
    error = assert_raises(Build::PackageExtraction::InvalidPackage) do
      extract(files, maximum_bytes: maximum - 1)
    end
    assert_match(/limit/i, error.message)
    assert_includes error.message, "MiB"
    assert_includes error.message, "REPLICA_MAXIMUM_PACKAGE_MIB"
    assert_empty @store.list("builds/1")
  end

  test "uses the deployment configuration when no extraction override is supplied" do
    Rails.configuration.x.maximum_package_bytes = 1.megabyte
    files = @files.merge("screenshots/desktop.png" => "x" * 1.megabyte)

    error = assert_raises(Build::PackageExtraction::InvalidPackage) { extract(files) }

    assert_includes error.message, "1 MiB"
    assert_includes error.message, "REPLICA_MAXIMUM_PACKAGE_MIB"
    assert_empty @store.list("builds/1")
  end

  test "streaming stops before returning bytes above the remaining package budget" do
    source = Build::PackageExtraction::BoundedSource.new \
      StringIO.new("screenshot"),
      maximum_bytes: 25.megabytes,
      remaining_bytes: 5,
      total_limit: 1.megabyte
    assert_equal "scree", source.read(5)

    error = assert_raises(Build::PackageExtraction::InvalidPackage) { source.read(1) }

    assert_includes error.message, "1 MiB"
    assert_includes error.message, "REPLICA_MAXIMUM_PACKAGE_MIB"
  end

  test "validates retained Controls before storing any package files" do
    invalid = @files.merge("dist/controls.replica.json" => '{"version":99}')
    error = assert_raises(Build::PackageExtraction::InvalidPackage) { extract(invalid) }
    assert_match "controls.replica.json", error.message
    assert_empty @store.list("builds/1")

    controls = { version: 1, scope: "page", controls: [
      { id: "title", label: "Title", type: "text", default: "Default",
        binding: { type: "field", selector: "#title" } }
    ] }
    files = @files.merge("dist/controls.replica.json" => JSON.generate(controls))
    extract(files)
    assert_equal files.keys.map { "builds/1/#{_1}" }.sort, @store.list("builds/1")
  end

  test "accepts legacy packages and explicit empty manifests" do
    extract(@files)
    assert_equal 3, @store.list("builds/1").length
    @store.delete_prefix("builds/1")
    extract(@files.merge("templates.json" => JSON.generate(version: 1, templates: [])))
    assert_equal 4, @store.list("builds/1").length
  end

  test "retains complete light and dark screenshot sets including templates" do
    files = template_files
    dark = files.filter_map do |name, bytes|
      [ name.delete_suffix(".png") + "-dark.png", "dark #{bytes}" ] if name.start_with?("screenshots/")
    end.to_h
    files.merge!(dark)
    extract(files)
    assert_equal files.keys.map { "builds/1/#{_1}" }.sort, @store.list("builds/1")
  end

  test "rejects partial dark sets and undeclared dark captures before storing files" do
    [
      @files.merge("screenshots/desktop-dark.png" => "dark"),
      template_files.merge("screenshots/desktop-dark.png" => "dark", "screenshots/narrow-dark.png" => "dark"),
      @files.merge("screenshots/templates/unknown/desktop-dark.png" => "dark")
    ].each do |files|
      assert_raises(Build::PackageExtraction::InvalidPackage) { extract(files) }
      assert_empty @store.list("builds/1")
    end
  end

  test "rejects missing or undeclared screenshots before storing any files" do
    [
      template_files.except("screenshots/templates/welcome/narrow.png"),
      template_files.merge("screenshots/templates/other/desktop.png" => "other"),
      template_files.merge("screenshots/templates/welcome/extra.png" => "extra"),
      @files.merge("screenshots/templates/welcome/desktop.png" => "undeclared")
    ].each do |files|
      assert_raises(Build::PackageExtraction::InvalidPackage) { extract(files) }
      assert_empty @store.list("builds/1")
    end
  end

  test "rejects invalid manifests oversized metadata and unsupported root files" do
    [ template_files.merge("templates.json" => "{invalid"),
      template_files.merge("templates.json" => " " * (16.kilobytes + 1)),
      @files.merge(".github/replica.json" => "{}"),
      @files.merge("screenshots" => "not a directory"),
      @files.merge("dist" => "not a directory"),
      @files.merge("extra.json" => "{}") ].each do |files|
      assert_raises(Build::PackageExtraction::InvalidPackage) { extract(files) }
      assert_empty @store.list("builds/1")
    end
  end

  private

  def template_files
    @files.merge \
      "templates.json" => JSON.generate(version: 1, templates: [ @template ]),
      "screenshots/templates/welcome/desktop.png" => "template desktop",
      "screenshots/templates/welcome/narrow.png" => "template narrow"
  end

  def extract(files, **options)
    path = @root.join("package.zip")
    File.binwrite(path, Zip::OutputStream.write_buffer do |archive|
      files.each do |name, bytes|
        archive.put_next_entry(name)
        archive.write(bytes)
      end
    end.string)
    File.open(path, "rb") { Build::PackageExtraction.new(artifact_store: @store, **options).extract!(_1, prefix: "builds/1") }
  end
end
