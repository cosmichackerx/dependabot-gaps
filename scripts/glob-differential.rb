#!/usr/bin/env ruby
# Differential oracle for src/glob.ts: runs the exact call dependabot-core uses to expand `directories` globs
# (updater/lib/dependabot/file_fetcher_command.rb, files_from_multidirectories):
#   Dir.glob(dir.delete_prefix("/"), File::FNM_DOTMATCH).select { |d| File.directory?(d) }
# against a fixed directory tree and prints JSON: { ruby, tree, cases: [{ pattern, matches }] }
require "json"
require "tmpdir"
require "fileutils"

TREE = %w[
  apps apps/web apps/web/src apps/api apps/api/src/deep apps/.hidden
  packages packages/a packages/b packages/b/nested packages/.cache
  services services/api services/api/v1 services/worker
  .github .github/actions .github/actions/setup .github/actions/build .github/workflows
  tools tools/lint tools/lint/rules docs docs/en docs/de
  a a/b a/b/c a/b/c/d
  app-1 app-2 app-10 appX
  x.y x.y/z
].freeze

PATTERNS = %w[
  /
  /apps /apps/web /apps/nope
  /* /*/* /*/*/* /**
  /apps/* /apps/** /apps/**/* /**/* /**/
  /packages/* /packages/**/*
  /.github/* /.github/actions/* /.github/**/*
  /.* /**/.*
  /services/*/ /services/api/*
  /app-? /app-?? /app-[12] /app-[!1] /app-[0-9]* /app*
  /{apps,packages}/* /{apps,docs}/**/*
  /**/src /**/b /a/**/d /a/**/c/d /a/**/*/d
  /*/src /*/*/src
  /x.y /x.y/* /x.?
  /? /apps/? /apps/.* /apps/.? /.?
  apps/* apps/web
].freeze

patterns = ARGV[0] ? File.read(ARGV[0]).split("\n").reject(&:empty?) : PATTERNS

Dir.mktmpdir do |root|
  TREE.each { |d| FileUtils.mkdir_p(File.join(root, d)) }
  cases = Dir.chdir(root) do
    patterns.map do |pattern|
      glob = pattern.include?("*") || pattern.include?("?") || (pattern.include?("[") && pattern.include?("]"))
      matches =
        if glob
          Dir.glob(pattern.delete_prefix("/"), File::FNM_DOTMATCH).select { |d| File.directory?(d) }.sort
        else
          dir = pattern.delete_prefix("/").chomp("/")
          dir.empty? || File.directory?(dir) ? [dir] : []
        end
      { "pattern" => pattern, "glob" => glob, "matches" => matches }
    end
  end
  all_dirs = []
  Dir.chdir(root) { all_dirs = Dir.glob("**/*", File::FNM_DOTMATCH).select { |d| File.directory?(d) }.sort }
  puts JSON.pretty_generate({ "ruby" => RUBY_VERSION, "tree" => all_dirs, "cases" => cases })
end
