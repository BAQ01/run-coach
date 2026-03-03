import Foundation
import AVFoundation
import Capacitor

/// Native Capacitor plugin die de volledige workout audio afhandelt:
/// - Cue scheduling via DispatchWorkItem (werkt in iOS achtergrond)
/// - Stem cues via AVAudioPlayer (MP3 uit app bundle)
/// - Fallback naar AVSpeechSynthesizer als een MP3 ontbreekt
/// - Stille AVAudioPlayer loop houdt AVAudioSession actief in achtergrond
/// - Tick events naar JS via notifyListeners("tick", ...)
@objc(WorkoutAudioPlugin)
public class WorkoutAudioPlugin: CAPPlugin, CAPBridgedPlugin, AVAudioPlayerDelegate {

    // MARK: - CAPBridgedPlugin
    public let identifier = "WorkoutAudioPlugin"
    public let jsName = "WorkoutAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start",  returnType: "promise"),
        CAPPluginMethod(name: "stop",   returnType: "promise"),
        CAPPluginMethod(name: "pause",  returnType: "promise"),
        CAPPluginMethod(name: "resume", returnType: "promise"),
    ]

    // MARK: - Properties

    private var silentPlayer: AVAudioPlayer?          // Houdt AVAudioSession actief (volume 0)
    private var activePlayers = [AVAudioPlayer]()     // Actief spelende cue-players
    private let synth = AVSpeechSynthesizer()         // TTS fallback
    private var scheduledItems = [DispatchWorkItem]() // Gepland, annuleerbaar
    private var tickTimer: DispatchSourceTimer?       // 500ms tick naar JS

    // Wall-clock elapsed tracking (bevriest niet bij process-achtergrond)
    private var startDate: Date?
    private var pausedInterval: TimeInterval = 0  // Totale gepauzeerde seconden
    private var pauseDate: Date?

    // Opgeslagen voor herplanning bij resume
    private var currentVoice = "rebecca"
    private var storedTimeline = [[String: Any]]()

    // MARK: - Elapsed time

    private func elapsedSeconds() -> Double {
        guard let start = startDate else { return 0 }
        var elapsed = Date().timeIntervalSince(start) - pausedInterval
        if let pd = pauseDate {
            elapsed -= Date().timeIntervalSince(pd)
        }
        return max(0, elapsed)
    }

    // MARK: - Plugin API

    @objc func start(_ call: CAPPluginCall) {
        // Capacitor deserialiseert de array als [Any]; cast elk element defensief naar [String: Any]
        let rawArray = call.getArray("cueTimeline") ?? []
        let timeline = rawArray.compactMap { $0 as? [String: Any] }

        let voice = call.getString("voice") ?? "rebecca"
        let fromElapsed = call.getDouble("fromElapsed") ?? 0.0

        print("[WorkoutAudio] start() ontvangen — stem: \(voice), fromElapsed: \(fromElapsed)s, \(timeline.count)/\(rawArray.count) cues")

        reset()
        currentVoice = voice
        storedTimeline = timeline
        startDate = Date(timeIntervalSinceNow: -fromElapsed)

        setupAudioSession()
        startSilentLoop()
        scheduleFromTimeline(fromElapsed: fromElapsed)
        startTickTimer()

        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        reset()
        print("[WorkoutAudio] Gestopt")
        call.resolve()
    }

    @objc func pause(_ call: CAPPluginCall) {
        guard startDate != nil, pauseDate == nil else {
            call.resolve()
            return
        }
        pauseDate = Date()
        cancelScheduled()
        stopTickTimer()
        // silentLoop blijft draaien zodat iOS de app niet suspendeert tijdens pauze
        print("[WorkoutAudio] Gepauzeerd op \(elapsedSeconds().rounded())s")
        call.resolve()
    }

    @objc func resume(_ call: CAPPluginCall) {
        guard let pd = pauseDate else {
            call.resolve()
            return
        }
        pausedInterval += Date().timeIntervalSince(pd)
        pauseDate = nil

        let elapsed = elapsedSeconds()
        let remaining = storedTimeline.filter {
            (($0["triggerAt"] as? NSNumber)?.doubleValue ?? 0) > elapsed + 0.5
        }
        scheduleItems(cues: remaining)
        startTickTimer()

        print("[WorkoutAudio] Hervat op \(elapsed.rounded())s, \(remaining.count) resterende cues")
        call.resolve()
    }

    // MARK: - State management

    private func reset() {
        cancelScheduled()
        stopTickTimer()
        stopSilentLoop()
        synth.stopSpeaking(at: .immediate)
        activePlayers.forEach { $0.stop() }
        activePlayers.removeAll()
        startDate = nil
        pausedInterval = 0
        pauseDate = nil
    }

    // MARK: - AVAudioSession

    private func setupAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("[WorkoutAudio] AVAudioSession fout: \(error)")
        }
    }

    // MARK: - Silent keepalive loop

    private func startSilentLoop() {
        guard silentPlayer == nil else { return }
        let data = makeSilentWavData()
        guard let player = try? AVAudioPlayer(data: data, fileTypeHint: AVFileType.wav.rawValue) else { return }
        player.numberOfLoops = -1
        player.volume = 0
        player.prepareToPlay()
        player.play()
        silentPlayer = player
    }

    private func stopSilentLoop() {
        silentPlayer?.stop()
        silentPlayer = nil
    }

    // 1s stille WAV: 8kHz, mono, 8-bit unsigned PCM (0x80 = stilte)
    private func makeSilentWavData() -> Data {
        let sr: UInt32 = 8000
        let n = Int(sr)
        var d = Data()
        func u32(_ v: UInt32) { var le = v.littleEndian; withUnsafeBytes(of: &le) { d.append(contentsOf: $0) } }
        func u16(_ v: UInt16) { var le = v.littleEndian; withUnsafeBytes(of: &le) { d.append(contentsOf: $0) } }
        d.append(contentsOf: "RIFF".utf8); u32(UInt32(36 + n))
        d.append(contentsOf: "WAVE".utf8)
        d.append(contentsOf: "fmt ".utf8); u32(16); u16(1); u16(1); u32(sr); u32(sr); u16(1); u16(8)
        d.append(contentsOf: "data".utf8); u32(UInt32(n))
        d.append(contentsOf: [UInt8](repeating: 0x80, count: n))
        return d
    }

    // MARK: - Cue scheduling

    private func scheduleFromTimeline(fromElapsed: Double) {
        let cutoff = max(0, fromElapsed - 2)
        let cues = storedTimeline.filter { (($0["triggerAt"] as? NSNumber)?.doubleValue ?? 0) >= cutoff }
        scheduleItems(cues: cues)
    }

    private func scheduleItems(cues: [[String: Any]]) {
        let elapsed = elapsedSeconds()
        let voiceSnap = currentVoice

        for cue in cues {
            // triggerAt kan Int of Double zijn afhankelijk van JSON serialisatie
            let triggerAt = (cue["triggerAt"] as? NSNumber)?.doubleValue ?? 0
            let delay = max(0.05, triggerAt - elapsed)
            let type = cue["type"] as? String ?? ""
            let message = cue["message"] as? String

            let item = DispatchWorkItem { [weak self] in
                guard let self = self, self.pauseDate == nil else { return }
                switch type {
                case "beep":
                    self.playBeep()
                case "speech":
                    if let msg = message { self.playSpeech(msg, voice: voiceSnap) }
                default:
                    break
                }
            }
            scheduledItems.append(item)
            DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
        }
    }

    private func cancelScheduled() {
        scheduledItems.forEach { $0.cancel() }
        scheduledItems.removeAll()
    }

    // MARK: - Tick timer

    private func startTickTimer() {
        stopTickTimer()
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now(), repeating: .milliseconds(500))
        timer.setEventHandler { [weak self] in
            guard let self = self, self.startDate != nil else { return }
            self.notifyListeners("tick", data: ["elapsedSeconds": self.elapsedSeconds()])
        }
        timer.resume()
        tickTimer = timer
    }

    private func stopTickTimer() {
        tickTimer?.cancel()
        tickTimer = nil
    }

    // MARK: - Audio playback

    private func playBeep() {
        let data = makeToneData(frequency: 660, duration: 0.15)
        guard let player = try? AVAudioPlayer(data: data, fileTypeHint: AVFileType.wav.rawValue) else { return }
        player.delegate = self
        player.prepareToPlay()
        player.play()
        activePlayers.append(player)
    }

    private func playSpeech(_ message: String, voice: String) {
        let slug = slugify(message)
        let subdir = "public/audio/cues/\(voice)"

        if let url = Bundle.main.url(forResource: slug, withExtension: "mp3", subdirectory: subdir),
           let player = try? AVAudioPlayer(contentsOf: url) {
            player.delegate = self
            player.prepareToPlay()
            player.play()
            activePlayers.append(player)
        } else {
            print("[WorkoutAudio] MP3 niet gevonden: \(subdir)/\(slug).mp3 — fallback naar TTS")
            let utt = AVSpeechUtterance(string: message)
            utt.voice = AVSpeechSynthesisVoice(language: "nl-NL")
            utt.rate = 0.48
            synth.speak(utt)
        }
    }

    // MARK: - AVAudioPlayerDelegate

    public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        activePlayers.removeAll { $0 === player }
    }

    // MARK: - Helpers

    /// Spiegelt de JS slug-logica exact:
    /// lowercase → strip non-ascii-alnum/spatie → trim → spaties→koppelteken → max 60
    private func slugify(_ message: String) -> String {
        var result = ""
        for ch in message.lowercased() {
            guard let scalar = ch.unicodeScalars.first else { continue }
            let v = scalar.value
            if (v >= 97 && v <= 122) || (v >= 48 && v <= 57) || v == 32 {
                result.append(ch)
            }
        }
        result = result.trimmingCharacters(in: .whitespaces)
        var slug = ""
        var prevSpace = false
        for ch in result {
            if ch == " " {
                if !prevSpace { slug.append("-"); prevSpace = true }
            } else {
                slug.append(ch)
                prevSpace = false
            }
        }
        return String(slug.prefix(60))
    }

    /// Genereert een sinusvormige toon als WAV-data (44.1kHz, mono, 16-bit PCM)
    private func makeToneData(frequency: Double, duration: Double) -> Data {
        let sr = 44100
        let count = Int(Double(sr) * duration)
        let attack = max(1, Int(Double(sr) * 0.01))
        let release = max(1, Int(Double(sr) * 0.05))
        var samples = [Int16](repeating: 0, count: count)

        for i in 0..<count {
            let t = Double(i) / Double(sr)
            let env: Double
            if i < attack {
                env = Double(i) / Double(attack)
            } else if i > count - release {
                env = Double(count - i) / Double(release)
            } else {
                env = 1.0
            }
            samples[i] = Int16(sin(2 * .pi * frequency * t) * 0.5 * env * 32767)
        }

        var d = Data()
        let dataSize = UInt32(count * 2)
        let sampleRate = UInt32(sr)
        func u32(_ v: UInt32) { var le = v.littleEndian; withUnsafeBytes(of: &le) { d.append(contentsOf: $0) } }
        func u16(_ v: UInt16) { var le = v.littleEndian; withUnsafeBytes(of: &le) { d.append(contentsOf: $0) } }

        d.append(contentsOf: "RIFF".utf8); u32(36 + dataSize)
        d.append(contentsOf: "WAVE".utf8)
        d.append(contentsOf: "fmt ".utf8); u32(16); u16(1); u16(1)
        u32(sampleRate); u32(sampleRate * 2); u16(2); u16(16)
        d.append(contentsOf: "data".utf8); u32(dataSize)
        samples.withUnsafeBytes { d.append(contentsOf: $0) }

        return d
    }
}
