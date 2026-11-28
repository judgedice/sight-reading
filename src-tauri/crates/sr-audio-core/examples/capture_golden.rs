//! Writes the golden capture packet stream to `fixtures/native/capture-48k.bin` (repository root).
//!
//! The stream is what the packetizer writes for a fixed 1 s input at 48 kHz; see
//! `sr_audio_core::capture::golden_packet_stream` for the exact input and layout. The TypeScript packet parser
//! must reproduce the input samples from it bit for bit (`wire-golden.test.ts`), and the Rust test
//! `packet_roundtrip` reads the same file.
//!
//! Run: `cargo run -p sr-audio-core --example capture_golden` (writes), or with `--check` (exits 1 when the
//! file differs).

use std::path::PathBuf;
use std::process::ExitCode;

fn main() -> ExitCode {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../fixtures/native/capture-48k.bin");
    let (input, stream) = sr_audio_core::capture::golden_packet_stream();
    if std::env::args().any(|a| a == "--check") {
        return match std::fs::read(&path) {
            Ok(bytes) if bytes == stream => {
                println!("up to date: {} ({} bytes)", path.display(), stream.len());
                ExitCode::SUCCESS
            }
            _ => {
                eprintln!("stale or missing: {}", path.display());
                ExitCode::FAILURE
            }
        };
    }
    if let Some(dir) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(dir) {
            eprintln!("{}: {e}", dir.display());
            return ExitCode::FAILURE;
        }
    }
    match std::fs::write(&path, &stream) {
        Ok(()) => {
            println!("wrote {} input samples as {} bytes to {}", input.len(), stream.len(), path.display());
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("{}: {e}", path.display());
            ExitCode::FAILURE
        }
    }
}
