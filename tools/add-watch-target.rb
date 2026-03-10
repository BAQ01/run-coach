#!/usr/bin/env ruby
# add-watch-target.rb
# Voegt watchOS target RunCoachWatch toe aan het Xcode project.
# Idempotent: veilig meerdere keren uitvoeren.
#
# Gebruik: ruby tools/add-watch-target.rb

require 'xcodeproj'
require 'fileutils'

PROJECT_PATH    = File.expand_path('../ios/App/App.xcodeproj', __dir__)
WATCH_DIR       = File.expand_path('../ios/App/RunCoachWatch', __dir__)
WATCH_TARGET    = 'RunCoachWatch'
WATCH_BUNDLE_ID = 'nl.runcoach.app.watchkitapp'
IOS_TARGET      = 'App'

WATCH_SOURCES = %w[
  RunCoachWatchApp.swift
  WatchSessionManager.swift
  LiveRunView.swift
  Extensions.swift
].freeze

proj = Xcodeproj::Project.open(PROJECT_PATH)
puts "📂 Project geladen: #{PROJECT_PATH}"

ios_target = proj.targets.find { |t| t.name == IOS_TARGET }
abort("❌ iOS target '#{IOS_TARGET}' niet gevonden") unless ios_target

swift_version = ios_target.build_settings('Debug')['SWIFT_VERSION'] || '5.0'
team          = ios_target.build_settings('Debug')['DEVELOPMENT_TEAM']

# ── 1. WatchSyncPlugin.swift toevoegen aan iOS compile sources ─────────────
plugin_path = File.join(File.dirname(WATCH_DIR), 'App', 'WatchSyncPlugin.swift')
already_compiling = ios_target.source_build_phase.files.any? do |f|
  f.file_ref&.path == 'WatchSyncPlugin.swift'
end

unless already_compiling
  app_group = proj.main_group.children.find { |g| g.display_name == 'App' }
  unless app_group.children.any? { |f| f.respond_to?(:path) && f.path == 'WatchSyncPlugin.swift' }
    ref = app_group.new_file('WatchSyncPlugin.swift')
    puts "  + WatchSyncPlugin.swift toegevoegd aan App groep"
  else
    ref = app_group.children.find { |f| f.respond_to?(:path) && f.path == 'WatchSyncPlugin.swift' }
  end
  ios_target.source_build_phase.add_file_reference(ref)
  puts "✅ WatchSyncPlugin.swift toegevoegd aan iOS compile sources"
else
  puts "⏭  WatchSyncPlugin.swift al in compile sources"
end

# ── 2. WatchConnectivity aan iOS App target ────────────────────────────────
def add_system_framework(proj, target, framework_name)
  already = target.frameworks_build_phase.files.any? do |f|
    f.display_name == "#{framework_name}.framework"
  end
  if already
    puts "⏭  #{framework_name}.framework al gelinkt aan #{target.name}"
    return
  end

  frameworks_group = proj.frameworks_group
  existing_ref = frameworks_group.children.find do |f|
    f.respond_to?(:path) && f.path&.include?("#{framework_name}.framework")
  end

  unless existing_ref
    existing_ref = frameworks_group.new_reference(
      "System/Library/Frameworks/#{framework_name}.framework"
    )
    existing_ref.source_tree  = 'SDKROOT'
    existing_ref.last_known_file_type = 'wrapper.framework'
    existing_ref.name = "#{framework_name}.framework"
    existing_ref.path = "System/Library/Frameworks/#{framework_name}.framework"
  end

  target.frameworks_build_phase.add_file_reference(existing_ref, true)
  puts "✅ #{framework_name}.framework gelinkt aan #{target.name}"
end

add_system_framework(proj, ios_target, 'WatchConnectivity')

# ── 3. Watch target aanmaken (als nog niet bestaat) ────────────────────────
existing_watch = proj.targets.find { |t| t.name == WATCH_TARGET }
if existing_watch
  puts "⏭  Watch target '#{WATCH_TARGET}' bestaat al"
  watch_target = existing_watch
else
  watch_target = proj.new_target(
    :application,
    WATCH_TARGET,
    :watchos,
    '7.0'
  )
  puts "✅ Watch target '#{WATCH_TARGET}' aangemaakt"
end

# ── 4. Build settings Watch target ────────────────────────────────────────
['Debug', 'Release'].each do |config|
  s = watch_target.build_settings(config)
  s['PRODUCT_BUNDLE_IDENTIFIER']    = WATCH_BUNDLE_ID
  s['PRODUCT_NAME']                  = WATCH_TARGET
  s['SWIFT_VERSION']                 = swift_version
  s['TARGETED_DEVICE_FAMILY']        = '4'
  s['SDKROOT']                       = 'watchos'
  s['WATCHOS_DEPLOYMENT_TARGET']     = '7.0'
  s['ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES'] = 'YES'
  s['ASSETCATALOG_COMPILER_APPICON_NAME'] = 'AppIcon'
  s['CODE_SIGN_STYLE']               = 'Automatic'
  s['LD_RUNPATH_SEARCH_PATHS']       = ['$(inherited)', '@executable_path/Frameworks']
  s['INFOPLIST_FILE']                = 'RunCoachWatch/Info.plist'
  s['DEVELOPMENT_TEAM']              = team if team && !team.empty?
  s.delete('ENABLE_BITCODE')         # deprecated in watchOS 8+
end
puts "✅ Build settings geconfigureerd"

# ── 5. Bronbestanden toevoegen aan Watch target ────────────────────────────
watch_group = proj.main_group.children.find { |g| g.display_name == WATCH_TARGET }
unless watch_group
  watch_group = proj.main_group.new_group(WATCH_TARGET, 'RunCoachWatch')
  puts "✅ Groep '#{WATCH_TARGET}' aangemaakt"
else
  puts "⏭  Groep '#{WATCH_TARGET}' bestaat al"
end

WATCH_SOURCES.each do |filename|
  # Voeg file reference toe aan groep (als nog niet aanwezig)
  unless watch_group.children.any? { |f| f.respond_to?(:path) && f.path == filename }
    watch_group.new_file(filename)
    puts "  + #{filename} toegevoegd aan groep"
  end

  ref = watch_group.children.find { |f| f.respond_to?(:path) && f.path == filename }
  next unless ref

  # Voeg toe aan compile sources (als nog niet aanwezig)
  already = watch_target.source_build_phase.files.any? { |f| f.file_ref == ref }
  unless already
    watch_target.source_build_phase.add_file_reference(ref)
    puts "  ✓ #{filename} toegevoegd aan Watch compile sources"
  end
end

# Info.plist toevoegen als resource
info_ref = watch_group.children.find { |f| f.respond_to?(:path) && f.path == 'Info.plist' }
unless info_ref
  info_ref = watch_group.new_file('Info.plist')
  puts "  + Info.plist toegevoegd aan Watch groep"
end

# ── 6. WatchConnectivity aan Watch target ─────────────────────────────────
add_system_framework(proj, watch_target, 'WatchConnectivity')

# ── 7. Target dependency: iOS App moet Watch target eerst builden ──────────
already_dep = ios_target.dependencies.any? { |d| d.target == watch_target }
unless already_dep
  ios_target.add_dependency(watch_target)
  puts "✅ Target dependency toegevoegd (App → RunCoachWatch)"
else
  puts "⏭  Target dependency bestaat al"
end

# ── 8. Watch app embedden in iOS App target ────────────────────────────────
embed_phase = ios_target.copy_files_build_phases.find { |p| p.name == 'Embed Watch Content' }
unless embed_phase
  embed_phase = ios_target.new_copy_files_build_phase('Embed Watch Content')
  # dstSubfolderSpec 1 = Wrapper, subpath binnen de .app bundle
  embed_phase.dst_subfolder_spec = '1'
  embed_phase.dst_path           = 'Watch'
  puts "✅ 'Embed Watch Content' build phase aangemaakt"
else
  # Corrigeer subfolder spec als die verkeerd was gezet
  if embed_phase.dst_subfolder_spec != '1'
    embed_phase.dst_subfolder_spec = '1'
    embed_phase.dst_path           = 'Watch'
    puts "🔧 Embed phase subfolder spec gecorrigeerd"
  else
    puts "⏭  'Embed Watch Content' build phase bestaat al"
  end
end

watch_product_ref = watch_target.product_reference
already_embedded = embed_phase.files.any? { |f| f.file_ref == watch_product_ref }
unless already_embedded
  build_file = embed_phase.add_file_reference(watch_product_ref)
  build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
  puts "✅ Watch app ingebed in iOS embed phase"
else
  puts "⏭  Watch app al ingebed"
end

# ── 8. Opslaan ─────────────────────────────────────────────────────────────
proj.save
puts "\n🎉 Klaar! Project opgeslagen: #{PROJECT_PATH}"
puts "   Open Xcode en druk Cmd+B om te builden."
