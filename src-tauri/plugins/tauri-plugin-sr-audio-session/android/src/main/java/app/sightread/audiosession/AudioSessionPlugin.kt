package app.sightread.audiosession

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class WatchArgs {
    lateinit var channel: Channel
}

@InvokeArg
class KeepAwakeArgs {
    var on: Boolean = false
}

private const val ALIAS_MICROPHONE = "microphone"

/**
 * Microphone permission, audio focus, the route as AudioManager describes it, and the device-level audio
 * properties. Called only by the app's Rust audio layer (see `src/mobile.rs`), never by the webview.
 *
 * Nothing here estimates a latency. AudioManager has no latency property for the route; the figures it does give
 * (frames per buffer, sample rate, the two feature flags) are passed on as they are.
 */
@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = ALIAS_MICROPHONE)
    ]
)
class AudioSessionPlugin(private val activity: Activity) : Plugin(activity) {
    private val audioManager: AudioManager =
        activity.applicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val main = Handler(Looper.getMainLooper())
    private var channel: Channel? = null
    private var focusRequest: AudioFocusRequest? = null
    private var deviceCallback: AudioDeviceCallback? = null

    // ---- permission ---------------------------------------------------------------------------------

    private fun permissionWord(): String =
        when (getPermissionState(ALIAS_MICROPHONE)) {
            PermissionState.GRANTED -> "granted"
            PermissionState.DENIED -> "denied"
            // `prompt-with-rationale` is still a prompt as far as the app is concerned.
            PermissionState.PROMPT, PermissionState.PROMPT_WITH_RATIONALE -> "prompt"
            else -> "unknown"
        }

    private fun resolvePermission(invoke: Invoke) {
        val reply = JSObject()
        reply.put("state", permissionWord())
        invoke.resolve(reply)
    }

    @Command
    fun permissionState(invoke: Invoke) {
        resolvePermission(invoke)
    }

    @Command
    fun requestPermission(invoke: Invoke) {
        if (getPermissionState(ALIAS_MICROPHONE) == PermissionState.GRANTED) {
            resolvePermission(invoke)
        } else {
            requestPermissionForAlias(ALIAS_MICROPHONE, invoke, "microphonePermissionResult")
        }
    }

    @PermissionCallback
    fun microphonePermissionResult(invoke: Invoke) {
        resolvePermission(invoke)
    }

    // ---- session ------------------------------------------------------------------------------------

    @Command
    fun configureSession(invoke: Invoke) {
        // Focus is requested once per session. A failed request is not an error: other apps may be playing,
        // and the streams still open. The loss listener below tells the app when it matters.
        if (focusRequest == null) {
            val listener = AudioManager.OnAudioFocusChangeListener { change ->
                when (change) {
                    AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> sendFocus("lost")
                    AudioManager.AUDIOFOCUS_GAIN -> sendFocus("gained")
                    // Ducking only lowers the volume of our output; nothing is timed from it.
                    else -> {}
                }
            }
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                )
                .setOnAudioFocusChangeListener(listener, main)
                .build()
            audioManager.requestAudioFocus(request)
            focusRequest = request
        }
        invoke.resolve(buildSessionInfo())
    }

    @Command
    fun deactivateSession(invoke: Invoke) {
        focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
        focusRequest = null
        invoke.resolve()
    }

    @Command
    fun sessionInfo(invoke: Invoke) {
        invoke.resolve(buildSessionInfo())
    }

    // The screen stays on while the player practises (window flags are main-thread only).
    @Command
    fun setKeepAwake(invoke: Invoke) {
        val args = invoke.parseArgs(KeepAwakeArgs::class.java)
        activity.runOnUiThread {
            if (args.on) {
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
            invoke.resolve()
        }
    }

    private fun buildSessionInfo(): JSObject {
        val info = JSObject()
        audioManager.getProperty(AudioManager.PROPERTY_OUTPUT_FRAMES_PER_BUFFER)?.toIntOrNull()
            ?.takeIf { it > 0 }?.let { info.put("outputFramesPerBuffer", it) }
        audioManager.getProperty(AudioManager.PROPERTY_OUTPUT_SAMPLE_RATE)?.toIntOrNull()
            ?.takeIf { it > 0 }?.let { info.put("outputSampleRate", it) }
        val pm = activity.packageManager
        info.put("lowLatency", pm.hasSystemFeature(PackageManager.FEATURE_AUDIO_LOW_LATENCY))
        info.put("proAudio", pm.hasSystemFeature(PackageManager.FEATURE_AUDIO_PRO))
        info.put("inputs", ports(audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS), input = true))
        info.put("outputs", ports(audioManager.getDevices(AudioManager.GET_DEVICES_OUTPUTS), input = false))
        return info
    }

    // ---- route --------------------------------------------------------------------------------------

    /**
     * Android does not say which device a stream will use before it is open, so "active" is the best
     * candidate by the platform's usual routing order: an attached external device wins over the built-in one.
     * Bluetooth SCO and BLE headsets are never chosen as the input (they carry the microphone only when the app
     * has started a communication route, which this app does not). From API 33 the output asks the system
     * which device a media stream would use instead of guessing.
     */
    private fun ports(devices: Array<AudioDeviceInfo>, input: Boolean): JSArray {
        val chosen = chooseActive(devices, input)
        val array = JSArray()
        for (d in devices) {
            val port = JSObject()
            port.put("uid", d.id.toString())
            port.put("portType", typeName(d.type))
            port.put("name", d.productName?.toString())
            port.put("transport", transportOf(d.type))
            port.put("active", chosen != null && d.id == chosen.id)
            array.put(port)
        }
        return array
    }

    private fun chooseActive(devices: Array<AudioDeviceInfo>, input: Boolean): AudioDeviceInfo? {
        if (!input && Build.VERSION.SDK_INT >= 33) {
            val attributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                .build()
            val routed = audioManager.getAudioDevicesForAttributes(attributes)
            val match = routed.firstOrNull { r -> devices.any { it.id == r.id } }
            if (match != null) return match
        }
        return devices.filter { !input || !isBluetoothVoice(it.type) }
            .minByOrNull { priority(it.type) }
    }

    private fun isBluetoothVoice(type: Int): Boolean =
        type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || (Build.VERSION.SDK_INT >= 31 && type == AudioDeviceInfo.TYPE_BLE_HEADSET)

    /** Lower is preferred. */
    private fun priority(type: Int): Int =
        when (transportOf(type)) {
            "bluetooth" -> 0
            "usb" -> 1
            "wired" -> 2
            "hdmi" -> 3
            "network" -> 4
            "built-in" -> 5
            else -> 6
        }

    private fun transportOf(type: Int): String {
        if (Build.VERSION.SDK_INT >= 31) {
            when (type) {
                AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_BLE_SPEAKER, AudioDeviceInfo.TYPE_BLE_BROADCAST -> return "bluetooth"
                AudioDeviceInfo.TYPE_BUILTIN_SPEAKER_SAFE -> return "built-in"
            }
        }
        if (Build.VERSION.SDK_INT >= 33 && type == AudioDeviceInfo.TYPE_HDMI_EARC) return "hdmi"
        return when (type) {
            AudioDeviceInfo.TYPE_BUILTIN_MIC, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "built-in"
            AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES, AudioDeviceInfo.TYPE_LINE_ANALOG,
            AudioDeviceInfo.TYPE_LINE_DIGITAL, AudioDeviceInfo.TYPE_AUX_LINE -> "wired"
            AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_ACCESSORY, AudioDeviceInfo.TYPE_USB_HEADSET,
            AudioDeviceInfo.TYPE_DOCK -> "usb"
            AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_BLUETOOTH_SCO, AudioDeviceInfo.TYPE_HEARING_AID -> "bluetooth"
            AudioDeviceInfo.TYPE_HDMI, AudioDeviceInfo.TYPE_HDMI_ARC -> "hdmi"
            AudioDeviceInfo.TYPE_IP -> "network"
            else -> "unknown"
        }
    }

    private fun typeName(type: Int): String = "android-type-$type"

    // ---- events -------------------------------------------------------------------------------------

    @Command
    fun watchEvents(invoke: Invoke) {
        val args = invoke.parseArgs(WatchArgs::class.java)
        channel = args.channel
        if (deviceCallback == null) {
            val callback = object : AudioDeviceCallback() {
                override fun onAudioDevicesAdded(addedDevices: Array<AudioDeviceInfo>) = sendRoute()
                override fun onAudioDevicesRemoved(removedDevices: Array<AudioDeviceInfo>) = sendRoute()
            }
            audioManager.registerAudioDeviceCallback(callback, main)
            deviceCallback = callback
        }
        invoke.resolve()
    }

    @Command
    fun unwatchEvents(invoke: Invoke) {
        channel = null
        deviceCallback?.let { audioManager.unregisterAudioDeviceCallback(it) }
        deviceCallback = null
        invoke.resolve()
    }

    private fun sendRoute() {
        val event = JSObject()
        event.put("kind", "routeChange")
        event.put("reason", "devices-changed")
        channel?.send(event)
    }

    private fun sendFocus(state: String) {
        val event = JSObject()
        event.put("kind", "audioFocus")
        event.put("state", state)
        channel?.send(event)
    }

    override fun onDestroy() {
        deviceCallback?.let { audioManager.unregisterAudioDeviceCallback(it) }
        deviceCallback = null
        focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
        focusRequest = null
        channel = null
        super.onDestroy()
    }
}
