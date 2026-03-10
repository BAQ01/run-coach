import Foundation
import AVFoundation
import Capacitor

/// Native Capacitor plugin — bron van waarheid tijdens een actieve run.
///
/// Verantwoordelijk voor:
///   - Wall-clock elapsed tracking (overleeft background/lock screen)
///   - Chain scheduling: één DispatchWorkItem tegelijk, na afspelen volgt de volgende
///   - AVAudioPlayer voor MP3 cues + AVSpeechSynthesizer als fallback
///   - Stille keepalive loop zodat AVAudioSession actief blijft in achtergrond
///   - Interruption handling (telefoon, Siri) → pause + interrupted event naar JS
///   - UserDefaults persistentie → recoverActiveWorkout() na WebView-herstart of crash
///   - Tick events (500ms) + cuePlayed / completed / interrupted events naar JS
@objc(WorkoutAudioPlugin)
public class WorkoutAudioPlugin: CAPPlugin, CAPBridgedPlugin, AVAudioPlayerDelegate, AVSpeechSynthesizerDelegate {

    // MARK: - CAPBridgedPlugin

    public let identifier = "WorkoutAudioPlugin"
    public let jsName = "WorkoutAudio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start",                returnType: "promise"),
        CAPPluginMethod(name: "stop",                 returnType: "promise"),
        CAPPluginMethod(name: "pause",                returnType: "promise"),
        CAPPluginMethod(name: "resume",               returnType: "promise"),
        CAPPluginMethod(name: "getStatus",            returnType: "promise"),
        CAPPluginMethod(name: "recoverActiveWorkout", returnType: "promise"),
        CAPPluginMethod(name: "playCoachCue",         returnType: "promise"),
    ]

    // MARK: - Properties

    private var silentPlayer: AVAudioPlayer?          // Houdt AVAudioSession actief (volume 0)
    private var activePlayers = [AVAudioPlayer]()     // Actief spelende cue-players
    private var speechPlayers = [AVAudioPlayer]()     // Subset van activePlayers: alleen spraakcues
    private let synth = AVSpeechSynthesizer()         // TTS fallback
    private var tickTimer: DispatchSourceTimer?       // 500ms tick naar JS

    // Chain scheduling
    private var currentCueIndex = 0
    private var nextCueItem: DispatchWorkItem?

    // Wall-clock elapsed tracking
    private var startDate: Date?
    private var pausedInterval: TimeInterval = 0
    private var pauseDate: Date?

    // Opgeslagen voor herplanning bij resume
    private var currentVoice = "rebecca"
    private var storedTimeline = [[String: Any]]()

    // A3: Rate limiter voor playCoachCue (min 1.0s tussen twee cue-starts)
    private var lastCoachCueAt: Date?

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
        let rawArray = call.getArray("cueTimeline") ?? []
        let timeline = rawArray.compactMap { $0 as? [String: Any] }
        let voice = call.getString("voice") ?? "rebecca"
        let fromElapsed = call.getDouble("fromElapsed") ?? 0.0

        print("[WorkoutAudio] start() ontvangen — stem: \(voice), fromElapsed: \(fromElapsed)s, \(timeline.count) cues")

        reset()
        currentVoice = voice
        storedTimeline = timeline
        startDate = Date(timeIntervalSinceNow: -fromElapsed)

        setupAudioSession()
        synth.delegate = self
        registerInterruptionObserver()
        startSilentLoop()
        currentCueIndex = 0
        scheduleNext()
        startTickTimer()
        saveState()

        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        reset()
        print("[WorkoutAudio] Gestopt")
        call.resolve()
    }

    @objc func pause(_ call: CAPPluginCall) {
        guard startDate != nil, pauseDate == nil else {
            call.resolve(); return
        }
        pauseDate = Date()
        cancelScheduled()
        stopTickTimer()
        saveState()
        print("[WorkoutAudio] Gepauzeerd op \(elapsedSeconds().rounded())s")
        call.resolve()
    }

    @objc func resume(_ call: CAPPluginCall) {
        guard let pd = pauseDate else {
            call.resolve(); return
        }
        pausedInterval += Date().timeIntervalSince(pd)
        pauseDate = nil
        scheduleNext()
        startTickTimer()
        saveState()
        print("[WorkoutAudio] Hervat op \(elapsedSeconds().rounded())s")
        call.resolve()
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        guard startDate != nil else {
            call.resolve(["state": "idle"]); return
        }
        call.resolve([
            "state":          pauseDate != nil ? "paused" : "running",
            "elapsedSeconds": elapsedSeconds(),
            "currentCueIndex": currentCueIndex,
            "totalCues":      storedTimeline.count,
            "voice":          currentVoice,
        ])
    }

    @objc func recoverActiveWorkout(_ call: CAPPluginCall) {
        guard let d = UserDefaults.standard.dictionary(forKey: "runCoach.session") else {
            call.resolve(["hasActiveSession": false]); return
        }
        let startTs  = d["startTimestamp"] as? Double ?? 0
        let paused   = d["pausedInterval"] as? Double ?? 0
        let isPaused = d["isPaused"]       as? Bool   ?? false
        let now      = Date().timeIntervalSince1970
        // pauseTimestamp is alleen aanwezig als de run gepauzeerd was; behandel als optioneel.
        let elapsed: Double
        if isPaused, let pauseTs = d["pauseTimestamp"] as? Double {
            elapsed = max(0, pauseTs - startTs - paused)
        } else {
            elapsed = max(0, now - startTs - paused)
        }
        call.resolve([
            "hasActiveSession": true,
            "elapsedSeconds":   elapsed,
            "isPaused":         isPaused,
            "voice":            d["voice"] as? String ?? "rebecca",
            "currentCueIndex":  d["currentCueIndex"] as? Int ?? 0,
        ])
    }

    // MARK: - Immediate coach cue (Phase B: Zone 2 / Cadence interventions)

    /// Speelt een coach-cue direct af zonder de bestaande cue-timeline te verstoren.
    /// Gebruikt ducking (zet muziek zachter) tijdens het afspelen, precies als reguliere cues.
    /// Heeft GEEN effect op elapsed time, scheduling of workout state.
    @objc func playCoachCue(_ call: CAPPluginCall) {
        let slug         = call.getString("slug")         ?? ""
        let voice        = call.getString("voice")        ?? currentVoice
        let fallbackText = call.getString("fallbackText") // optioneel, meegestuurd vanuit JS coachCues.js
        guard !slug.isEmpty else { call.reject("slug ontbreekt"); return }

        // A3: Rate limiter — negeer cues die te snel na elkaar komen (< 1.0s)
        let now = Date()
        if let last = lastCoachCueAt, now.timeIntervalSince(last) < 1.0 {
            print("[WorkoutAudio] Coach cue genegeerd (rate limit): \(slug)")
            call.resolve()
            return
        }
        lastCoachCueAt = now

        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let subdir = "public/audio/cues/\(voice)"
            self.enableDucking()
            if let url    = Bundle.main.url(forResource: slug, withExtension: "mp3", subdirectory: subdir),
               let player = try? AVAudioPlayer(contentsOf: url) {
                player.delegate = self
                player.prepareToPlay()
                player.play()
                self.activePlayers.append(player)
                self.speechPlayers.append(player)
                print("[WorkoutAudio] Coach cue gespeeld: \(slug)")
            } else {
                // TTS fallback: gebruik JS-meegegeven tekst (canoniek NL uit coachCues.js),
                // anders hardcoded fallback voor backwards-compatibiliteit.
                let ttsText: String
                if let text = fallbackText, !text.isEmpty {
                    ttsText = text
                } else {
                    switch slug {
                    case "coach_hr_too_high":          ttsText = "Hartslag te hoog. Vertraag twintig seconden."
                    case "coach_hr_soft_warning":      ttsText = "Je hartslag loopt op. Maak je pas iets kleiner."
                    case "coach_hr_recover_walk":      ttsText = "Herstel echt tijdens het wandelen: schouders los, adem rustig."
                    case "coach_cadence_low":          ttsText = "Maak je passen korter en lichter."
                    case "coach_cadence_low_hr_high":  ttsText = "Kortere passen, rustig tempo. Niet versnellen."
                    case "coach_hold_steady":          ttsText = "Perfect tempo. Hou dit vast."
                    case "coach_start_slow":           ttsText = "Rustig starten. Dit moet makkelijk voelen."
                    default:
                        ttsText = slug
                            .replacingOccurrences(of: "coach_", with: "")
                            .replacingOccurrences(of: "_", with: " ")
                    }
                }
                let utt = AVSpeechUtterance(string: ttsText)
                utt.voice = AVSpeechSynthesisVoice(language: "nl-NL")
                utt.rate = 0.48
                self.synth.speak(utt)
                print("[WorkoutAudio] Coach cue TTS fallback: \(ttsText)")
            }
        }
        call.resolve()
    }

    // MARK: - State management

    private func reset() {
        cancelScheduled()
        stopTickTimer()
        stopSilentLoop()
        NotificationCenter.default.removeObserver(self, name: AVAudioSession.interruptionNotification, object: nil)
        synth.stopSpeaking(at: .immediate)
        activePlayers.forEach { $0.stop() }
        activePlayers.removeAll()
        speechPlayers.removeAll()
        startDate = nil
        pausedInterval = 0
        pauseDate = nil
        currentCueIndex = 0
        lastCoachCueAt = nil
        clearSavedState()
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

    // MARK: - Audio ducking (alleen tijdelijk tijdens gesproken cues)

    /// Schakelt ducking in: andere audio-apps worden zachter gezet.
    /// Alleen aanroepen vlak vóór een gesproken coach-cue.
    private func enableDucking() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers, .duckOthers])
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("[WorkoutAudio] Ducking inschakelen mislukt: \(error)")
        }
    }

    /// Zet ducking terug uit: andere audio-apps keren terug naar normaal volume.
    /// Aanroepen zodra de gesproken cue klaar is.
    private func disableDucking() {
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("[WorkoutAudio] Ducking uitschakelen mislukt: \(error)")
        }
    }

    // MARK: - Interruption handling

    private func registerInterruptionObserver() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleInterruption(_:)),
            name: AVAudioSession.interruptionNotification,
            object: nil
        )
    }

    @objc private func handleInterruption(_ notification: Notification) {
        guard let info = notification.userInfo,
              let tv = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: tv) else { return }
        // De workout-klok blijft altijd lopen; alleen audio-herstel is hier relevant.
        if type == .ended {
            // Heractiveer de audio session zodat de volgende cue gewoon afspeelt.
            try? AVAudioSession.sharedInstance().setActive(true)
            print("[WorkoutAudio] Audio session hersteld na onderbreking")
        }
        // .began: niets doen — workout loopt door, volgende cue speelt als de session terugkomt.
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

    // MARK: - Chain scheduling

    private func scheduleNext() {
        nextCueItem?.cancel()
        nextCueItem = nil

        // Sla cues over die al verstreken zijn
        let elapsed = elapsedSeconds()
        while currentCueIndex < storedTimeline.count {
            let t = (storedTimeline[currentCueIndex]["triggerAt"] as? NSNumber)?.doubleValue ?? 0
            if t >= elapsed - 0.5 { break }
            currentCueIndex += 1
        }

        guard currentCueIndex < storedTimeline.count else {
            // Alle cues gespeeld — training voltooid
            notifyListeners("completed", data: ["elapsedSeconds": elapsed])
            stopTickTimer()
            clearSavedState()
            print("[WorkoutAudio] Training voltooid na \(elapsed.rounded())s")
            return
        }

        let cue = storedTimeline[currentCueIndex]
        let triggerAt = (cue["triggerAt"] as? NSNumber)?.doubleValue ?? 0
        let delay = max(0.05, triggerAt - elapsed)
        let idx = currentCueIndex
        let voiceSnap = currentVoice

        let item = DispatchWorkItem { [weak self] in
            guard let self, self.pauseDate == nil else { return }
            let type = cue["type"] as? String ?? ""
            if type == "beep" {
                self.playBeep()
            } else if type == "speech", let msg = cue["message"] as? String {
                self.playSpeech(msg, voice: voiceSnap)
            }
            self.notifyListeners("cuePlayed", data: ["cueIndex": idx])
            self.currentCueIndex = idx + 1
            self.saveState()
            self.scheduleNext()
        }
        nextCueItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
    }

    private func cancelScheduled() {
        nextCueItem?.cancel()
        nextCueItem = nil
    }

    // MARK: - Tick timer

    private func startTickTimer() {
        stopTickTimer()
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now(), repeating: .milliseconds(500))
        timer.setEventHandler { [weak self] in
            guard let self, self.startDate != nil else { return }
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
        enableDucking()   // duck andere audio vóór de gesproken cue
        if let url = Bundle.main.url(forResource: slug, withExtension: "mp3", subdirectory: subdir),
           let player = try? AVAudioPlayer(contentsOf: url) {
            player.delegate = self
            player.prepareToPlay()
            player.play()
            activePlayers.append(player)
            speechPlayers.append(player)   // bewaar voor ducking-herstel via delegate
        } else {
            print("[WorkoutAudio] MP3 niet gevonden: \(subdir)/\(slug).mp3 — fallback naar TTS")
            let utt = AVSpeechUtterance(string: message)
            utt.voice = AVSpeechSynthesisVoice(language: "nl-NL")
            utt.rate = 0.48
            synth.speak(utt)   // ducking-herstel via speechSynthesizer(_:didFinish:)
        }
    }

    // MARK: - AVAudioPlayerDelegate

    public func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        activePlayers.removeAll { $0 === player }
        let wasSpeech = speechPlayers.contains { $0 === player }
        speechPlayers.removeAll { $0 === player }
        // Herstel ducking zodra de laatste spraakplayer klaar is
        if wasSpeech && speechPlayers.isEmpty {
            disableDucking()
        }
    }

    // MARK: - AVSpeechSynthesizerDelegate

    public func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        disableDucking()
    }

    // MARK: - UserDefaults persistentie

    private func saveState() {
        guard let start = startDate else { return }
        // Bouw het dictionary op met alleen property-list-safe types (String, Double, Bool, Int, Array, Dictionary).
        // Geen optionals via `as Any` — die crashen UserDefaults als de waarde nil is.
        var d: [String: Any] = [
            "startTimestamp":  start.timeIntervalSince1970,
            "pausedInterval":  pausedInterval,
            "isPaused":        pauseDate != nil,
            "voice":           currentVoice,
            "timeline":        plistSafeTimeline(storedTimeline),
            "currentCueIndex": currentCueIndex,
        ]
        if let pd = pauseDate {
            d["pauseTimestamp"] = pd.timeIntervalSince1970
        }
        UserDefaults.standard.set(d, forKey: "runCoach.session")
    }

    /// Zet de cue-timeline om naar een plist-safe array.
    /// Filtert NSNull, optionals en onbekende types eruit; behoudt alleen String en Double waarden.
    private func plistSafeTimeline(_ timeline: [[String: Any]]) -> [[String: Any]] {
        return timeline.map { cue in
            var safe: [String: Any] = [:]
            if let t = (cue["triggerAt"] as? NSNumber)?.doubleValue { safe["triggerAt"] = t }
            if let type = cue["type"] as? String                    { safe["type"]      = type }
            if let msg  = cue["message"] as? String                 { safe["message"]   = msg }
            return safe
        }
    }

    private func clearSavedState() {
        UserDefaults.standard.removeObject(forKey: "runCoach.session")
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
                slug.append(ch); prevSpace = false
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
