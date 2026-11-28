//! Converts raw mono f32le audio with the capture path's resampler, for the gates on the resampled path
//! (`tools/native/gates-resampled.ts`, design section 8, test 4).
//!
//! The resampler is built exactly as `CaptureAligner::new` builds it, `SincResampler::for_rates(input_rate,
//! engine_rate)`, and read as `CaptureAligner::process` reads it: output frame `n` is the band-limited input at
//! position `n * step` (input frames), `step = input_rate / engine_rate * (1 + ppm * 1e-6)`. The ratio is fixed, so
//! `DriftController` plays no part. Output frame 0 is input frame 0: no delay is added and none needs subtracting.
//!
//! ```text
//! resample_file --in-rate 44100 --out-rate 48000 [--ppm 200] [--stream]        stdin -> stdout, one signal
//! resample_file --in-rate 48000 --out-rate 48000 --ppm 200 --dir IN --out-dir OUT      every *.f32 in IN
//! ```
//!
//! `--stream` reads records until EOF, each a little-endian u32 sample count followed by that many f32le samples,
//! and writes one record per input record in the same layout, so one process serves any number of signals.
//! Without `--stream` stdin is one raw signal and stdout one raw signal. `--dir` converts every `*.f32` file of a
//! directory into the same name in `--out-dir`.
//!
//! A negative `--ppm` or a different rate pair is allowed; `--ppm` is the device clock being fast (input frames
//! per engine frame above nominal, as when an input at 48 kHz really runs at 48009.6 Hz).

use std::fs;
use std::io::{self, BufReader, BufWriter, Read, Write};
use std::process::ExitCode;

use sr_audio_core::resample::{SincResampler, MAX_PUSH};

/// Input samples pushed per call; also the grain of the output loop.
const CHUNK: usize = 2048;

struct Config {
    in_rate: u32,
    out_rate: u32,
    /// Input frames per output frame.
    step: f64,
}

/// Converts one signal. The input is followed by silence long enough for the last kernel to be readable, as the
/// capture path would read it from the next callback.
fn convert(cfg: &Config, input: &[f32]) -> Vec<f32> {
    let mut r = SincResampler::for_rates(cfg.in_rate, cfg.out_rate);
    r.reset(0);
    let n_out = (input.len() as f64 / cfg.step).floor() as usize;
    let mut out = Vec::with_capacity(n_out);
    let mut pos = 0.0_f64;
    let tail = [0f32; 64];
    let feeds = input.chunks(CHUNK.min(MAX_PUSH)).chain(std::iter::once(&tail[..]));
    for block in feeds {
        r.push(block);
        while out.len() < n_out && r.can_read(pos) {
            out.push(r.at(pos));
            // Position from the index, not by accumulation: no rounding drift over minutes.
            pos = (out.len() as f64) * cfg.step;
        }
    }
    out
}

fn read_samples(bytes: &[u8]) -> Vec<f32> {
    bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect()
}

fn write_samples(w: &mut impl Write, x: &[f32]) -> io::Result<()> {
    let mut buf = Vec::with_capacity(x.len() * 4);
    for v in x {
        buf.extend_from_slice(&v.to_le_bytes());
    }
    w.write_all(&buf)
}

fn run(cfg: &Config, args: &[String]) -> io::Result<()> {
    let value = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    if let Some(dir) = value("--dir") {
        let out_dir = value("--out-dir").ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "--dir needs --out-dir"))?;
        fs::create_dir_all(&out_dir)?;
        let mut count = 0usize;
        for entry in fs::read_dir(&dir)? {
            let path = entry?.path();
            if path.extension().and_then(|e| e.to_str()) != Some("f32") {
                continue;
            }
            let y = convert(cfg, &read_samples(&fs::read(&path)?));
            let mut w = BufWriter::new(fs::File::create(std::path::Path::new(&out_dir).join(path.file_name().unwrap_or_default()))?);
            write_samples(&mut w, &y)?;
            w.flush()?;
            count += 1;
        }
        eprintln!("resample_file: {count} files converted");
        return Ok(());
    }
    let mut stdin = BufReader::new(io::stdin().lock());
    let mut stdout = BufWriter::new(io::stdout().lock());
    if args.iter().any(|a| a == "--stream") {
        loop {
            let mut head = [0u8; 4];
            match stdin.read_exact(&mut head) {
                Ok(()) => {}
                Err(e) if e.kind() == io::ErrorKind::UnexpectedEof => break,
                Err(e) => return Err(e),
            }
            let n = u32::from_le_bytes(head) as usize;
            let mut bytes = vec![0u8; n * 4];
            stdin.read_exact(&mut bytes)?;
            let y = convert(cfg, &read_samples(&bytes));
            stdout.write_all(&(y.len() as u32).to_le_bytes())?;
            write_samples(&mut stdout, &y)?;
        }
    } else {
        let mut bytes = Vec::new();
        stdin.read_to_end(&mut bytes)?;
        write_samples(&mut stdout, &convert(cfg, &read_samples(&bytes)))?;
    }
    stdout.flush()
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let value = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1));
    let parse = |name: &str| -> Option<f64> { value(name).and_then(|v| v.parse().ok()) };
    let (Some(in_rate), Some(out_rate)) = (parse("--in-rate"), parse("--out-rate")) else {
        eprintln!("usage: resample_file --in-rate HZ --out-rate HZ [--ppm P] [--stream | --dir IN --out-dir OUT]");
        return ExitCode::from(2);
    };
    let ppm = parse("--ppm").unwrap_or(0.0);
    if !(in_rate >= 1.0 && out_rate >= 1.0) || in_rate.fract() != 0.0 || out_rate.fract() != 0.0 {
        eprintln!("resample_file: rates must be whole Hz");
        return ExitCode::from(2);
    }
    let cfg = Config { in_rate: in_rate as u32, out_rate: out_rate as u32, step: in_rate / out_rate * (1.0 + ppm * 1e-6) };
    match run(&cfg, &args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("resample_file: {e}");
            ExitCode::FAILURE
        }
    }
}
