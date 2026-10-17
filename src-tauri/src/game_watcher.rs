// ============================================================================
// STEINS;KEYS - GAME WATCHER (WIN32 EVENT_SYSTEM_FOREGROUND AUTO-PROFILER)
// Troca automaticamente o perfil do mouse quando jogos FPS entram em foco.
// ============================================================================

use crate::input_engine::{update_engine_config, EngineMode, ENGINE_STATE};
use once_cell::sync::Lazy;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::thread;
use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, HWND};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetMessageW, GetWindowThreadProcessId, TranslateMessage,
    EVENT_SYSTEM_FOREGROUND, MSG, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameProfileRule {
    pub executable: String,
    pub invert_x: bool,
    pub invert_y: bool,
    pub mode: EngineMode,
}

pub static GAME_RULES: Lazy<RwLock<HashMap<String, GameProfileRule>>> = Lazy::new(|| {
    let mut map = HashMap::new();
    for exe in ["cs2.exe", "valorant.exe", "r5apex.exe", "overwatch.exe", "quake.exe"] {
        map.insert(
            exe.to_string(),
            GameProfileRule {
                executable: exe.to_string(),
                invert_x: false,
                invert_y: true,
                mode: EngineMode::FpsKernelDriver,
            },
        );
    }
    RwLock::new(map)
});

unsafe extern "system" fn win_event_proc(
    _h_win_event_hook: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    _id_object: i32,
    _id_child: i32,
    _id_event_thread: u32,
    _dwms_event_time: u32,
) {
    if event != EVENT_SYSTEM_FOREGROUND || hwnd.0.is_null() {
        return;
    }

    if let Some(exe_name) = get_process_executable_name(hwnd) {
        let exe_lower = exe_name.to_lowercase();
        let rules = GAME_RULES.read();

        let mut cfg = ENGINE_STATE.profile.load().cfg.clone();
        if let Some(rule) = rules.get(&exe_lower) {
            cfg.active = true;
            cfg.invert_x = rule.invert_x;
            cfg.invert_y = rule.invert_y;
            cfg.mode = rule.mode;
            update_engine_config(cfg);
        } else if exe_lower == "explorer.exe" {
            // Restaura comportamento normal ao voltar para o Explorer
            cfg.mode = EngineMode::DesktopSafe;
            update_engine_config(cfg);
        }
    }
}

unsafe fn get_process_executable_name(hwnd: HWND) -> Option<String> {
    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid == 0 {
        return None;
    }

    let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
    let mut buf = [0u16; 512];
    let mut size = buf.len() as u32;

    let ok = QueryFullProcessImageNameW(
        handle,
        PROCESS_NAME_WIN32,
        PWSTR(buf.as_mut_ptr()),
        &mut size,
    )
    .is_ok();
    let _ = CloseHandle(handle);

    if !ok {
        return None;
    }

    let full_path = String::from_utf16_lossy(&buf[..size as usize]);
    Path::new(&full_path)
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_string())
}

pub fn spawn_game_watcher_thread() {
    thread::Builder::new()
        .name("steins-game-watcher".into())
        .spawn(|| unsafe {
            let _hook = SetWinEventHook(
                EVENT_SYSTEM_FOREGROUND,
                EVENT_SYSTEM_FOREGROUND,
                None,
                Some(win_event_proc),
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            );

            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).into() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
        })
        .expect("Falha ao iniciar thread Game Watcher");
}
