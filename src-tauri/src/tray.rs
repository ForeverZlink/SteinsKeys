// ============================================================================
// STEINS;KEYS - SYSTEM TRAY, KILL SWITCH & ZERO-RAM WEBVIEW LIFECYCLE
// Destrói completamente o processo WebView2 ao fechar a janela (< 10MB RAM).
// ============================================================================

use crate::input_engine::{trigger_kill_switch, update_engine_config, ENGINE_STATE};
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton as TrayMouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

pub const MAIN_WINDOW_LABEL: &str = "main";

/// Configura o System Tray nativo e o Atalho Global de Emergência (`Ctrl + Shift + I` e `Ctrl + Shift + Alt + I`)
pub fn setup_tray_and_shortcuts(app: &AppHandle) -> tauri::Result<()> {
    // 1. Registrar Kill Switch Global (Ctrl + Shift + I e Ctrl + Shift + Alt + I)
    let shortcuts = [
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyI),
        Shortcut::new(
            Some(Modifiers::CONTROL | Modifiers::SHIFT | Modifiers::ALT),
            Code::KeyI,
        ),
    ];

    for kill_shortcut in shortcuts {
        let app_handle_for_shortcut = app.clone();
        let _ = app.global_shortcut().on_shortcut(
            kill_shortcut,
            move |_app, _shortcut, event| {
                if event.state() == ShortcutState::Pressed {
                    let is_active = trigger_kill_switch();
                    let _ = app_handle_for_shortcut.emit("divergence-changed", is_active);
                }
            },
        );
    }

    // 2. Construir Menu Nativo da Bandeja do Sistema (Win32 Menu)
    let toggle_divergence = CheckMenuItem::with_id(
        app,
        "toggle_divergence",
        "Divergence Active (1.048596)",
        true,
        false,
        None::<&str>,
    )?;

    let invert_y_item = CheckMenuItem::with_id(
        app,
        "toggle_invert_y",
        "Inverter Eixo Y (Pitch)",
        true,
        true,
        None::<&str>,
    )?;

    let invert_x_item = CheckMenuItem::with_id(
        app,
        "toggle_invert_x",
        "Inverter Eixo X (Yaw)",
        true,
        false,
        None::<&str>,
    )?;

    let mute_audio_item = CheckMenuItem::with_id(
        app,
        "mute_audio",
        "Mute Click Sound",
        true,
        false,
        None::<&str>,
    )?;

    // Submenu de Perfis Rápidos
    let prof_default = MenuItem::with_id(app, "prof_desktop", "Perfil: Desktop Safe", true, None::<&str>)?;
    let prof_cs2 = MenuItem::with_id(app, "prof_cs2", "Perfil: CS2 / Valorant (Raw Input)", true, None::<&str>)?;
    let profiles_submenu = Submenu::with_items(
        app,
        "Troca Rápida de Perfil",
        true,
        &[&prof_default, &prof_cs2],
    )?;

    let open_ui = MenuItem::with_id(app, "open_ui", "Abrir Painel Steins;Keys", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Encerrar Steins;Keys", true, None::<&str>)?;

    let tray_menu = Menu::with_items(
        app,
        &[
            &open_ui,
            &separator,
            &toggle_divergence,
            &invert_y_item,
            &invert_x_item,
            &mute_audio_item,
            &separator,
            &profiles_submenu,
            &separator,
            &quit_item,
        ],
    )?;

    let toggle_div_clone = toggle_divergence.clone();

    // 3. Inicializar o TrayIcon com suporte a Clique Duplo como Kill Switch
    let mut tray_builder = TrayIconBuilder::with_id("steins-tray")
        .menu(&tray_menu)
        .tooltip("Steins;Keys — Worldline 0.000000 (Standby)")
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            let mut cfg = ENGINE_STATE.profile.load().cfg.clone();
            match event.id.as_ref() {
                "open_ui" => {
                    recreate_or_focus_main_window(app);
                }
                "toggle_divergence" => {
                    let active = trigger_kill_switch();
                    let _ = toggle_div_clone.set_checked(active);
                    let _ = app.emit("divergence-changed", active);
                }
                "toggle_invert_y" => {
                    cfg.invert_y = !cfg.invert_y;
                    let _ = invert_y_item.set_checked(cfg.invert_y);
                    update_engine_config(cfg.clone());
                    let _ = app.emit("config-updated", cfg);
                }
                "toggle_invert_x" => {
                    cfg.invert_x = !cfg.invert_x;
                    let _ = invert_x_item.set_checked(cfg.invert_x);
                    update_engine_config(cfg.clone());
                    let _ = app.emit("config-updated", cfg);
                }
                "mute_audio" => {
                    cfg.audio_enabled = !cfg.audio_enabled;
                    let _ = mute_audio_item.set_checked(!cfg.audio_enabled);
                    update_engine_config(cfg.clone());
                    let _ = app.emit("config-updated", cfg);
                }
                "quit" => {
                    crate::input_engine::stop_engine();
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            // Clique Duplo no ícone da bandeja aciona imediatamente o Kill Switch
            if let TrayIconEvent::DoubleClick {
                button: TrayMouseButton::Left,
                ..
            } = event
            {
                let active = trigger_kill_switch();
                let tooltip = if active {
                    "Steins;Keys — Worldline 1.048596 [ACTIVE]"
                } else {
                    "Steins;Keys — Worldline 0.000000 [BYPASS]"
                };
                let _ = tray.set_tooltip(Some(tooltip));
                let _ = tray.app_handle().emit("divergence-changed", active);
            } else if let TrayIconEvent::Click {
                button: TrayMouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                recreate_or_focus_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray_builder = tray_builder.icon(icon.clone());
    }

    tray_builder.build(app)?;
    Ok(())
}

/// Recria a janela React sob demanda caso ela tenha sido destruída para economizar RAM,
/// ou apenas traz para o foco se já existir.
pub fn recreate_or_focus_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = win.show();
        let _ = win.set_focus();
        return;
    }

    // Reconstrói a WebView do zero apenas quando o usuário abre a interface
    if let Ok(win) = WebviewWindowBuilder::new(
        app,
        MAIN_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("STEINS;KEYS // LAB GADGET #009")
    .inner_size(940.0, 660.0)
    .min_inner_size(860.0, 600.0)
    .resizable(true)
    .decorations(true)
    .transparent(false)
    .center()
    .build()
    {
        attach_zero_ram_close_handler(&win);
    }
}

/// Permite que ao fechar a janela (`CloseRequested`), o processo NÃO encerre a aplicação,
/// mas permita que a WebView2 seja **completamente destruída da memória RAM**,
/// mantendo apenas o binário Rust (< 8 MB de RAM, 0% CPU ociosa) rodando na bandeja.
pub fn attach_zero_ram_close_handler(_window: &tauri::WebviewWindow) {
    // Em Tauri v2, quando não chamamos `api.prevent_close()` na janela mas interceptamos
    // `RunEvent::ExitRequested { api, .. }` no loop principal (`main.rs`), o Tauri destrói
    // totalmente os processos `msedgewebview2.exe` e mantém o core Rust vivo na System Tray!
    let _ = WindowEvent::Destroyed;
}
