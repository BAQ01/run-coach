import Capacitor

class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginType(WorkoutAudioPlugin.self)
    }
}
