# Try the native app on your Mac

Nothing in the native app has run on real speakers and a real microphone yet. Everything was tested on a simulated audio device. These steps are the first real test. They take about 15 minutes.

## 1. Get the app

Easiest: download the build that GitHub made.

1. Open the repository on GitHub, then **Actions**, then the workflow **native**.
2. Open the newest run with a green tick on branch `claude/native-tauri`.
3. Under **Artifacts**, download **sightread-macos** and unzip it.
4. Open the `.dmg` and drag **Sightread** into **Applications**.

The app is not signed, so macOS blocks it the first time. Run this once in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Sightread.app
```

Then open Sightread from Applications. If macOS still refuses, right-click the app and choose **Open**.

If you would rather build it yourself, you need Rust and pnpm installed. In the repository folder:

```bash
git switch claude/native-tauri
```

```bash
pnpm install
```

```bash
pnpm tauri build
```

The app is then in `src-tauri/target/release/bundle/macos/`.

## 2. First run

Use the built-in speakers and microphone, in a quiet room, volume at about half.

1. Go through setup. When macOS asks for the microphone, the message should say the app listens while you play or sing and that nothing is recorded or uploaded. Choose **Allow**.
2. At **Hear you**, sing any note. A note name should appear.
3. At **Timing**, run the measurement. Write down the number it shows ("Measured: N ms"). In Chrome on your Mac this was 95 to 101 ms. The estimate for the native app is 15 to 30 ms, but that is only an estimate until you run this.
4. Choose **Calibrate again** four more times and write down each number. They should agree within 1 ms.
5. Quit the app (Cmd-Q), open it again, and check that it does not ask you to calibrate again and that Ranked is available.

## 3. One try

1. Sing the five-note scale in C, as you did in Chrome.
2. Check that the click sounds steady, the beat line moves with it, and the marks land on the notes you sang.
3. On results, press **Listen**. The instrument sound should play.

## 4. Other things to check

1. **Settings › Data › Export all data (JSON).** A save panel should open. Save the file and check it exists.
2. **Settings › Data › Delete all data**, then **Import backup** with that file. Your profile should come back.
3. Open **Credits** and click a licence link (a small window should open) and a web link (your browser should open).
4. Plug in headphones during a try. The try should stop with a message, and the app should ask for a new timing measurement for headphones.

## 5. What to send back

- The five timing numbers from step 2.
- Whether the microphone prompt appeared and what it said.
- Anything that looked or sounded wrong, with what you were doing at the time.
- **Settings › Data › Export diagnostics for recent tries**, after a try, with the microphone audio setting left off. Send the file in the chat. Do not put it in the repository.

## For a second, deeper pass

`docs/native/AUDIO-DESIGN.md` section 11 lists the measurements an engineer would take on the Mac (callback timing, clock drift, repeatability across restarts and sleep). They need Terminal and environment variables, so they are best done with help.

## Signing and the App Store (not done)

To give the app to other people without the Terminal step, or to put it on an iPhone through TestFlight, you need an Apple Developer Program membership (99 USD a year). With it the build can be signed and notarised. `docs/native/MOBILE.md` has the checklist for iPhone and Android.
