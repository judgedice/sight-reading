import AVFoundation
import SwiftRs
import Tauri
import UIKit
import WebKit

// Microphone permission, the AVAudioSession and the route facts, for the app's Rust audio layer. Called only from
// Rust (`PluginHandle::run_mobile_plugin`), never from the webview. Nothing here estimates a latency: the figures
// are what AVAudioSession reports, and a zero (the OS has nothing to say) is sent as absent.

struct ConfigureArgs: Decodable {
  var preferredSampleRate: Double?
  var preferredIoBufferSec: Double?
}

struct WatchArgs: Decodable {
  let channel: Channel
}

struct KeepAwakeArgs: Decodable {
  let on: Bool
}

struct PermissionReply: Encodable {
  let state: String
}

struct PortInfo: Encodable {
  let uid: String
  let portType: String
  let name: String
  let transport: String
  let active: Bool
}

struct SessionInfo: Encodable {
  var sessionType: String?
  var sampleRate: Double?
  var ioBufferDuration: Double?
  var inputLatency: Double?
  var outputLatency: Double?
  var inputs: [PortInfo] = []
  var outputs: [PortInfo] = []
}

struct SessionEvent: Encodable {
  let kind: String
  var reason: String?
  var shouldResume: Bool?
}

class AudioSessionPlugin: Plugin {
  private var channel: Channel?
  private var lastConfig = ConfigureArgs()
  private let queue = DispatchQueue(label: "app.sightread.audiosession")

  override init() {
    super.init()
    let center = NotificationCenter.default
    let session = AVAudioSession.sharedInstance()
    center.addObserver(self, selector: #selector(onInterruption(_:)), name: AVAudioSession.interruptionNotification, object: session)
    center.addObserver(self, selector: #selector(onRouteChange(_:)), name: AVAudioSession.routeChangeNotification, object: session)
    center.addObserver(self, selector: #selector(onMediaServicesReset(_:)), name: AVAudioSession.mediaServicesWereResetNotification, object: session)
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  // MARK: permission

  private func permissionWord() -> String {
    if #available(iOS 17.0, *) {
      switch AVAudioApplication.shared.recordPermission {
      case .granted: return "granted"
      case .denied: return "denied"
      case .undetermined: return "prompt"
      default: return "unknown"
      }
    } else {
      switch AVAudioSession.sharedInstance().recordPermission {
      case .granted: return "granted"
      case .denied: return "denied"
      case .undetermined: return "prompt"
      default: return "unknown"
      }
    }
  }

  @objc public func permissionState(_ invoke: Invoke) {
    invoke.resolve(PermissionReply(state: permissionWord()))
  }

  @objc public func requestPermission(_ invoke: Invoke) {
    // The system calls back on an arbitrary queue once the user has answered. Nothing waits on the main thread.
    let answer: (Bool) -> Void = { _ in
      invoke.resolve(PermissionReply(state: self.permissionWord()))
    }
    if #available(iOS 17.0, *) {
      AVAudioApplication.requestRecordPermission(completionHandler: answer)
    } else {
      AVAudioSession.sharedInstance().requestRecordPermission(answer)
    }
  }

  // MARK: session

  private func apply(_ config: ConfigureArgs) throws {
    let session = AVAudioSession.sharedInstance()
    // measurement: no input processing (echo cancelling, gain control), which the timing analysis does not want.
    // allowBluetoothA2DP, not allowBluetooth: no hands-free profile unless the user picks it.
    try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetoothA2DP])
    try session.setPreferredSampleRate(config.preferredSampleRate ?? 48000)
    try session.setPreferredIOBufferDuration(config.preferredIoBufferSec ?? 0.005)
    try session.setActive(true)
  }

  @objc public func configureSession(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(ConfigureArgs.self)
    lastConfig = args
    do {
      try apply(args)
      invoke.resolve(sessionInfo())
    } catch {
      invoke.reject("audio session: \(error.localizedDescription)")
    }
  }

  @objc public func deactivateSession(_ invoke: Invoke) {
    do {
      try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
      invoke.resolve()
    } catch {
      // Still running IO refuses to deactivate; the app closes its streams first, so this is rare and harmless.
      invoke.reject("audio session: \(error.localizedDescription)")
    }
  }

  @objc public func sessionInfo(_ invoke: Invoke) {
    invoke.resolve(sessionInfo())
  }

  // The screen stays on while the player practises (UIKit is main-thread only).
  @objc public func setKeepAwake(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(KeepAwakeArgs.self)
    DispatchQueue.main.async {
      UIApplication.shared.isIdleTimerDisabled = args.on
      invoke.resolve()
    }
  }

  // MARK: route

  private func transport(_ type: AVAudioSession.Port) -> String {
    switch type {
    case .builtInMic, .builtInSpeaker, .builtInReceiver: return "built-in"
    case .headphones, .headsetMic, .lineIn, .lineOut: return "wired"
    case .usbAudio: return "usb"
    case .bluetoothA2DP, .bluetoothHFP, .bluetoothLE: return "bluetooth"
    case .HDMI: return "hdmi"
    case .airPlay: return "network"
    default: return "unknown"
    }
  }

  private func ports(_ descriptions: [AVAudioSessionPortDescription]) -> [PortInfo] {
    return descriptions.map {
      PortInfo(uid: $0.uid, portType: $0.portType.rawValue, name: $0.portName, transport: transport($0.portType), active: true)
    }
  }

  private func positive(_ value: Double) -> Double? {
    return value > 0 ? value : nil
  }

  private func sessionInfo() -> SessionInfo {
    let session = AVAudioSession.sharedInstance()
    var info = SessionInfo()
    info.sessionType = "play-and-record"
    info.sampleRate = positive(session.sampleRate)
    info.ioBufferDuration = positive(session.ioBufferDuration)
    info.inputLatency = positive(session.inputLatency)
    info.outputLatency = positive(session.outputLatency)
    info.inputs = ports(session.currentRoute.inputs)
    info.outputs = ports(session.currentRoute.outputs)
    return info
  }

  // MARK: events

  @objc public func watchEvents(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(WatchArgs.self)
    queue.sync { channel = args.channel }
    invoke.resolve()
  }

  @objc public func unwatchEvents(_ invoke: Invoke) {
    queue.sync { channel = nil }
    invoke.resolve()
  }

  private func emit(_ event: SessionEvent) {
    let target = queue.sync { channel }
    guard let target = target else { return }
    do {
      try target.send(event)
    } catch {
      Logger.error("audio session: could not send \(event.kind): \(error)")
    }
  }

  @objc private func onInterruption(_ note: Notification) {
    guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
      let type = AVAudioSession.InterruptionType(rawValue: raw)
    else { return }
    switch type {
    case .began:
      emit(SessionEvent(kind: "interruptionBegan"))
    case .ended:
      var resume = false
      if let options = note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt {
        resume = AVAudioSession.InterruptionOptions(rawValue: options).contains(.shouldResume)
      }
      // The audio layer (cpal) reactivates the session and restarts its streams itself when shouldResume is set.
      // When it is not, nothing runs until the app opens the audio again, which configures the session.
      emit(SessionEvent(kind: "interruptionEnded", shouldResume: resume))
    @unknown default:
      break
    }
  }

  @objc private func onRouteChange(_ note: Notification) {
    var word = "unknown"
    if let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
      let reason = AVAudioSession.RouteChangeReason(rawValue: raw)
    {
      switch reason {
      case .newDeviceAvailable: word = "new-device-available"
      case .oldDeviceUnavailable: word = "old-device-unavailable"
      case .categoryChange: word = "category-change"
      case .override: word = "override"
      case .wakeFromSleep: word = "wake-from-sleep"
      case .noSuitableRouteForCategory: word = "no-suitable-route"
      case .routeConfigurationChange: word = "route-configuration-change"
      default: word = "unknown"
      }
    }
    emit(SessionEvent(kind: "routeChange", reason: word))
  }

  @objc private func onMediaServicesReset(_ note: Notification) {
    // Every audio object the app made is dead. The session must be set up again before anything reopens.
    try? apply(lastConfig)
    emit(SessionEvent(kind: "mediaServicesReset"))
  }
}

@_cdecl("init_plugin_sr_audio_session")
public func initPlugin() -> Plugin {
  return AudioSessionPlugin()
}
