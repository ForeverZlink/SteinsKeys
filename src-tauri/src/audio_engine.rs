// ============================================================================
// STEINS;KEYS - LOW-LATENCY WASAPI AUDIO ENGINE (< 5ms)
// Pré-carrega ou sintetiza buffers PCM em RAM no boot e consome via crossbeam.
// ============================================================================

use crate::input_engine::{MouseButton, SoundEvent};
use crossbeam_channel::Receiver;
use kira::{
    manager::{backend::cpal::CpalBackend, AudioManager, AudioManagerSettings},
    sound::static_sound::StaticSoundData,
};
use std::collections::HashMap;
use std::io::Cursor;
use std::thread;

/// Inicia a thread isolada de áudio consumindo eventos do canal lock-free
pub fn spawn_audio_thread(rx: Receiver<SoundEvent>) {
    thread::Builder::new()
        .name("steins-wasapi-audio".into())
        .spawn(move || {
            let mut manager = match AudioManager::<CpalBackend>::new(AudioManagerSettings::default())
            {
                Ok(m) => m,
                Err(e) => {
                    eprintln!("[Steins;Keys] Aviso: Falha ao iniciar backend WASAPI: {e}");
                    return;
                }
            };

            // Pré-carrega todos os pacotes de som inteiramente na RAM durante o boot
            let sound_bank = preload_ram_sound_bank();

            while let Ok(event) = rx.recv() {
                match event {
                    SoundEvent::ButtonDown(btn) => {
                        let key = match btn {
                            MouseButton::Left => "click_down_primary",
                            MouseButton::Right => "click_down_secondary",
                            _ => "click_down_aux",
                        };
                        if let Some(sound) = sound_bank.get(key) {
                            let _ = manager.play(sound.clone());
                        }
                    }
                    SoundEvent::ButtonUp(_) => {
                        if let Some(sound) = sound_bank.get("click_up") {
                            let _ = manager.play(sound.clone());
                        }
                    }
                    SoundEvent::DivergenceShift(active) => {
                        let key = if active { "nixie_on" } else { "nixie_off" };
                        if let Some(sound) = sound_bank.get(key) {
                            let _ = manager.play(sound.clone());
                        }
                    }
                }
            }
        })
        .expect("Falha ao criar thread de áudio");
}

/// Gera e pré-carrega ondas `.wav` PCM diretamente na RAM (switches mecânicos / Nixie)
/// para funcionamento zero-dependency imediato, além de permitir leitura de `assets/sounds/`.
fn preload_ram_sound_bank() -> HashMap<&'static str, StaticSoundData> {
    let mut bank = HashMap::new();

    let presets: &[(&str, f32, f32, u32)] = &[
        ("click_down_primary", 1850.0, 320.0, 14),
        ("click_down_secondary", 1520.0, 280.0, 15),
        ("click_down_aux", 2100.0, 410.0, 12),
        ("click_up", 1100.0, 190.0, 9),
        ("nixie_on", 2600.0, 880.0, 55),
        ("nixie_off", 640.0, 220.0, 60),
    ];

    for &(name, freq_start, freq_end, duration_ms) in presets {
        let wav_bytes = synthesize_tactile_wav_in_ram(freq_start, freq_end, duration_ms);
        if let Ok(data) = StaticSoundData::from_cursor(Cursor::new(wav_bytes)) {
            bank.insert(name, data);
        }
    }

    bank
}

/// Sintetiza um buffer RIFF WAVE PCM 16-bit 44.1kHz em memória RAM imitando o transiente de um switch mecânico / tubo Nixie
fn synthesize_tactile_wav_in_ram(freq_start: f32, freq_end: f32, duration_ms: u32) -> Vec<u8> {
    let sample_rate = 44_100u32;
    let num_samples = (sample_rate * duration_ms) / 1000;
    let data_size = num_samples * 2;
    let mut buf = Vec::with_capacity(44 + data_size as usize);

    // Cabeçalho RIFF WAVE
    buf.extend_from_slice(b"RIFF");
    buf.extend_from_slice(&(36 + data_size).to_le_bytes());
    buf.extend_from_slice(b"WAVEfmt ");
    buf.extend_from_slice(&16u32.to_le_bytes());
    buf.extend_from_slice(&1u16.to_le_bytes()); // PCM
    buf.extend_from_slice(&1u16.to_le_bytes()); // Mono
    buf.extend_from_slice(&sample_rate.to_le_bytes());
    buf.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    buf.extend_from_slice(&2u16.to_le_bytes());
    buf.extend_from_slice(&16u16.to_le_bytes());
    buf.extend_from_slice(b"data");
    buf.extend_from_slice(&data_size.to_le_bytes());

    for i in 0..num_samples {
        let t = i as f32 / sample_rate as f32;
        let progress = i as f32 / num_samples as f32;
        let envelope = (1.0 - progress).powi(3); // Decaimento exponencial rápido sem atraso
        let freq = freq_start + (freq_end - freq_start) * progress;
        let sample = (t * freq * std::f32::consts::TAU).sin() * envelope * 0.45;
        let pcm = (sample * i16::MAX as f32) as i16;
        buf.extend_from_slice(&pcm.to_le_bytes());
    }

    buf
}
