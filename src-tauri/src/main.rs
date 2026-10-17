// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod audio_engine;
mod game_watcher;
mod input_engine;
mod tray;

use input_engine::{
    spawn_input_engine_thread, trigger_kill_switch, update_engine_config, EngineConfig,
    ENGINE_STATE,
};
use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::{Manager, RunEvent};

#[derive(Serialize)]
pub struct TelemetryPayload {
    pub dx: i32,
    pub dy: i32,
    pub active: bool,
    pub bypass: bool,
}

#[tauri::command]
fn get_engine_config() -> EngineConfig {
    ENGINE_STATE.profile.load().cfg.clone()
}

#[tauri::command]
fn set_engine_config(config: EngineConfig) -> EngineConfig {
    update_engine_config(config.clone());
    config
}

#[tauri::command]
fn toggle_divergence() -> bool {
    trigger_kill_switch()
}

#[tauri::command]
fn poll_axis_telemetry() -> TelemetryPayload {
    let dx = ENGINE_STATE.last_dx.swap(0, Ordering::Relaxed);
    let dy = ENGINE_STATE.last_dy.swap(0, Ordering::Relaxed);
    let active = ENGINE_STATE.profile.load().cfg.active;
    let bypass = ENGINE_STATE.emergency_bypass.load(Ordering::Relaxed);
    TelemetryPayload {
        dx,
        dy,
        active,
        bypass,
    }
}

fn main() {
    // 1. Inicializa threads nativas de tempo crítico (Mouse Hook + Kernel Bridge + Game Watcher)
    spawn_input_engine_thread();
    game_watcher::spawn_game_watcher_thread();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            tray::setup_tray_and_shortcuts(app.handle())?;
            if let Some(win) = app.get_webview_window(tray::MAIN_WINDOW_LABEL) {
                tray::attach_zero_ram_close_handler(&win);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_engine_config,
            set_engine_config,
            toggle_divergence,
            poll_axis_telemetry,
        ])
        .build(tauri::generate_context!())
        .expect("Erro ao construir aplicação Tauri Steins;Keys");

    // 2. Ciclo de Vida Zero-RAM: quando a janela principal é fechada, a WebView2 é totalmente
    // destruída da memória RAM, mas `api.prevent_exit()` mantém o processo Rust vivo na bandeja!
    app.run(|_app_handle, event| {
        if let RunEvent::ExitRequested { api, code, .. } = event {
            if code.is_none() {
                api.prevent_exit();
            }
        }
    });
}
