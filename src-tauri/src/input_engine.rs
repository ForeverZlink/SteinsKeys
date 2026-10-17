// ============================================================================
// STEINS;KEYS - CORE INPUT ENGINE (ZERO-ALLOCATION / LOCK-FREE HOT PATH)
// Suporta mouses de 1000Hz a 8000Hz sem GC pauses ou mutex locks no callback.
// ============================================================================

use arc_swap::ArcSwap;
use crossbeam_channel::{bounded, Sender};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::cell::Cell;
use std::collections::HashMap;
use std::f64::consts::PI;
use std::mem::size_of;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, Ordering};
use std::sync::Arc;
use std::thread;

use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, POINT, WPARAM};
use windows::Win32::System::Threading::{
    GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_TIME_CRITICAL,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
    MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP,
    MOUSEEVENTF_WHEEL, MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP, MOUSEINPUT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetCursorPos, GetMessageW, PostThreadMessageW,
    SetCursorPos, SetWindowsHookExW, TranslateMessage, UnhookWindowsHookEx, HHOOK, MSLLHOOKSTRUCT,
    MSG, WH_MOUSE_LL, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN, WM_MBUTTONUP, WM_MOUSEMOVE,
    WM_QUIT, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_XBUTTONDOWN, WM_XBUTTONUP,
};

/// Tag mágica na assinatura `dwExtraInfo` para evitar que eventos sintetizados
/// pelo próprio Steins;Keys entrem em loop infinito no `WH_MOUSE_LL`.
const STEINS_SYNTHETIC_TAG: usize = 0x5354_4549; // "STEI"

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EngineMode {
    /// WH_MOUSE_LL + SetCursorPos/SendInput (100% seguro com anti-cheats, ideal para Desktop)
    DesktopSafe,
    /// Bridge com driver de filtro de kernel (Interception) para jogos FPS com Raw Input
    FpsKernelDriver,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum MouseButton {
    Left,
    Right,
    Middle,
    XButton1,
    XButton2,
    ScrollUp,
    ScrollDown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum SoundEvent {
    ButtonDown(MouseButton),
    ButtonUp(MouseButton),
    DivergenceShift(bool),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineConfig {
    pub active: bool,
    pub mode: EngineMode,
    pub invert_x: bool,
    pub invert_y: bool,
    pub swap_axes: bool,
    pub rotation_deg: f64,
    pub audio_enabled: bool,
    pub sound_pack: String,
    pub button_remap: HashMap<MouseButton, MouseButton>,
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self {
            active: false,
            mode: EngineMode::DesktopSafe,
            invert_x: false,
            invert_y: true, // Padrão clássico para jogadores de eixo Y invertido
            swap_axes: false,
            rotation_deg: 0.0,
            audio_enabled: true,
            sound_pack: "ibm_selectric".to_string(),
            button_remap: HashMap::new(),
        }
    }
}

/// Snapshot pré-calculado e imutável lido pela thread de input sem bloqueio (Wait-Free Read).
#[derive(Debug, Clone)]
pub struct CompiledProfile {
    pub cfg: EngineConfig,
    pub cos_theta: f64,
    pub sin_theta: f64,
    pub has_rotation: bool,
}

impl CompiledProfile {
    pub fn from_config(cfg: EngineConfig) -> Self {
        let rad = cfg.rotation_deg * (PI / 180.0);
        Self {
            has_rotation: cfg.rotation_deg.abs() > f64::EPSILON,
            cos_theta: rad.cos(),
            sin_theta: rad.sin(),
            cfg,
        }
    }
}

/// Estado global compartilhado em memória estática para acesso direto pelo callback `extern "system"` da Win32 API.
pub struct GlobalEngineState {
    pub profile: ArcSwap<CompiledProfile>,
    pub emergency_bypass: AtomicBool,
    pub last_dx: AtomicI32,
    pub last_dy: AtomicI32,
    pub hook_thread_id: AtomicU32,
    pub audio_tx: Sender<SoundEvent>,
}

pub static ENGINE_STATE: Lazy<GlobalEngineState> = Lazy::new(|| {
    let (tx, rx) = bounded(256);
    crate::audio_engine::spawn_audio_thread(rx);
    GlobalEngineState {
        profile: ArcSwap::from_pointee(CompiledProfile::from_config(EngineConfig::default())),
        emergency_bypass: AtomicBool::new(false),
        last_dx: AtomicI32::new(0),
        last_dy: AtomicI32::new(0),
        hook_thread_id: AtomicU32::new(0),
        audio_tx: tx,
    }
});

// Acumuladores fracionários Thread-Local para preservar precisão sub-pixel em rotações de ângulo
thread_local! {
    static SUBPIXEL_ERR_X: Cell<f64> = const { Cell::new(0.0) };
    static SUBPIXEL_ERR_Y: Cell<f64> = const { Cell::new(0.0) };
}

/// Aplica transformação matricial 2D completa com aritmética saturada (nunca entra em panic por overflow)
#[inline(always)]
pub fn transform_delta(mut dx: i32, mut dy: i32, prof: &CompiledProfile) -> (i32, i32) {
    if prof.cfg.swap_axes {
        std::mem::swap(&mut dx, &mut dy);
    }
    if prof.cfg.invert_x {
        dx = dx.saturating_neg();
    }
    if prof.cfg.invert_y {
        dy = dy.saturating_neg();
    }

    if prof.has_rotation {
        let fx = dx as f64;
        let fy = dy as f64;

        let rx = fx * prof.cos_theta - fy * prof.sin_theta;
        let ry = fx * prof.sin_theta + fy * prof.cos_theta;

        let total_x = rx + SUBPIXEL_ERR_X.with(|e| e.get());
        let total_y = ry + SUBPIXEL_ERR_Y.with(|e| e.get());

        let out_x = total_x.round() as i32;
        let out_y = total_y.round() as i32;

        SUBPIXEL_ERR_X.with(|e| e.set(total_x - out_x as f64));
        SUBPIXEL_ERR_Y.with(|e| e.set(total_y - out_y as f64));

        (out_x, out_y)
    } else {
        (dx, dy)
    }
}

/// Callback de Baixo Nível do Windows (`WH_MOUSE_LL`).
/// Executa em tempo constante O(1), zero alocações no heap, zero locks e zero risco de overflow.
unsafe extern "system" fn low_level_mouse_proc(
    n_code: i32,
    w_param: WPARAM,
    l_param: LPARAM,
) -> LRESULT {
    if n_code < 0 {
        return CallNextHookEx(HHOOK::default(), n_code, w_param, l_param);
    }

    let mouse_struct = &*(l_param.0 as *const MSLLHOOKSTRUCT);

    // 1. Ignorar eventos já processados e sintetizados pelo Steins;Keys
    if mouse_struct.dwExtraInfo == STEINS_SYNTHETIC_TAG {
        return CallNextHookEx(HHOOK::default(), n_code, w_param, l_param);
    }

    // 2. Verificar Kill Switch atômico (Relaxed é suficiente e não invalida cache L1)
    if ENGINE_STATE.emergency_bypass.load(Ordering::Relaxed) {
        return CallNextHookEx(HHOOK::default(), n_code, w_param, l_param);
    }

    // 3. Leitura Wait-Free da configuração ativa via ArcSwap
    let prof = ENGINE_STATE.profile.load();

    let msg = w_param.0 as u32;

    // 4. Disparo assíncrono não-bloqueante para a Thread de Áudio (`try_send` nunca trava o mouse)
    if prof.cfg.audio_enabled {
        if let Some((btn, is_down)) = decode_mouse_button(msg, mouse_struct.mouseData) {
            let ev = if is_down {
                SoundEvent::ButtonDown(btn)
            } else {
                SoundEvent::ButtonUp(btn)
            };
            let _ = ENGINE_STATE.audio_tx.try_send(ev);
        }
    }

    if !prof.cfg.active || prof.cfg.mode != EngineMode::DesktopSafe {
        return CallNextHookEx(HHOOK::default(), n_code, w_param, l_param);
    }

    // 5. Interceptação de Movimento (Inversão X/Y, Swap e Rotação)
    // Lê a posição real atual do cursor no Windows antes do pacote ser aplicado,
    // evitando acúmulo exponencial (drift) e garantindo precisão absoluta.
    if msg == WM_MOUSEMOVE {
        let mut cur_pt = POINT::default();
        if GetCursorPos(&mut cur_pt).is_ok() {
            let raw_dx = mouse_struct.pt.x.saturating_sub(cur_pt.x).clamp(-1000, 1000);
            let raw_dy = mouse_struct.pt.y.saturating_sub(cur_pt.y).clamp(-1000, 1000);

            if raw_dx == 0 && raw_dy == 0 {
                return CallNextHookEx(HHOOK::default(), n_code, w_param, l_param);
            }

            let (tx_dx, tx_dy) = transform_delta(raw_dx, raw_dy, &prof);

            // Atualiza telemetria atômica para o Playground na UI
            ENGINE_STATE.last_dx.store(tx_dx, Ordering::Relaxed);
            ENGINE_STATE.last_dy.store(tx_dy, Ordering::Relaxed);

            // Se a transformação alterou o vetor original, reposicionamos o cursor diretamente
            // e suprimimos o movimento não-invertido retornando LRESULT(1).
            if tx_dx != raw_dx || tx_dy != raw_dy {
                let target_x = cur_pt.x.saturating_add(tx_dx);
                let target_y = cur_pt.y.saturating_add(tx_dy);
                let _ = SetCursorPos(target_x, target_y);
                return LRESULT(1);
            }
        }
    }

    // 6. Interceptação e Remapeamento de Botões
    if !prof.cfg.button_remap.is_empty() {
        if let Some((original_btn, is_down)) = decode_mouse_button(msg, mouse_struct.mouseData) {
            if let Some(&target_btn) = prof.cfg.button_remap.get(&original_btn) {
                if target_btn != original_btn {
                    inject_remapped_button(target_btn, is_down);
                    return LRESULT(1); // Suprime o clique original
                }
            }
        }
    }

    CallNextHookEx(HHOOK::default(), n_code, w_param, l_param)
}

#[inline(always)]
fn decode_mouse_button(msg: u32, mouse_data: u32) -> Option<(MouseButton, bool)> {
    match msg {
        WM_LBUTTONDOWN => Some((MouseButton::Left, true)),
        WM_LBUTTONUP => Some((MouseButton::Left, false)),
        WM_RBUTTONDOWN => Some((MouseButton::Right, true)),
        WM_RBUTTONUP => Some((MouseButton::Right, false)),
        WM_MBUTTONDOWN => Some((MouseButton::Middle, true)),
        WM_MBUTTONUP => Some((MouseButton::Middle, false)),
        WM_XBUTTONDOWN | WM_XBUTTONUP => {
            let is_down = msg == WM_XBUTTONDOWN;
            let xbtn = (mouse_data >> 16) & 0xFFFF;
            if xbtn == 1 {
                Some((MouseButton::XButton1, is_down))
            } else {
                Some((MouseButton::XButton2, is_down))
            }
        }
        _ => None,
    }
}

#[inline(always)]
unsafe fn inject_remapped_button(target: MouseButton, is_down: bool) {
    let (flags, mouse_data) = match (target, is_down) {
        (MouseButton::Left, true) => (MOUSEEVENTF_LEFTDOWN, 0),
        (MouseButton::Left, false) => (MOUSEEVENTF_LEFTUP, 0),
        (MouseButton::Right, true) => (MOUSEEVENTF_RIGHTDOWN, 0),
        (MouseButton::Right, false) => (MOUSEEVENTF_RIGHTUP, 0),
        (MouseButton::Middle, true) => (MOUSEEVENTF_MIDDLEDOWN, 0),
        (MouseButton::Middle, false) => (MOUSEEVENTF_MIDDLEUP, 0),
        (MouseButton::XButton1, true) => (MOUSEEVENTF_XDOWN, 1),
        (MouseButton::XButton1, false) => (MOUSEEVENTF_XUP, 1),
        (MouseButton::XButton2, true) => (MOUSEEVENTF_XDOWN, 2),
        (MouseButton::XButton2, false) => (MOUSEEVENTF_XUP, 2),
        (MouseButton::ScrollUp, true) => (MOUSEEVENTF_WHEEL, 120),
        (MouseButton::ScrollDown, true) => (MOUSEEVENTF_WHEEL, (-120i32) as u32),
        _ => return,
    };

    let input = INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx: 0,
                dy: 0,
                mouseData: mouse_data,
                dwFlags: flags,
                time: 0,
                dwExtraInfo: STEINS_SYNTHETIC_TAG,
            },
        },
    };
    let _ = SendInput(&[input], size_of::<INPUT>() as i32);
}

/// Inicia a Thread Dedicada de Captura de Mouse com prioridade `THREAD_PRIORITY_TIME_CRITICAL`
pub fn spawn_input_engine_thread() {
    // 1. Thread do User-Mode Hook (WH_MOUSE_LL)
    thread::Builder::new()
        .name("steins-input-ll".into())
        .spawn(|| unsafe {
            // Eleva a prioridade da thread ao nível máximo permitido pelo scheduler do Windows NT
            let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL);

            let hook = SetWindowsHookExW(
                WH_MOUSE_LL,
                Some(low_level_mouse_proc),
                HINSTANCE::default(),
                0,
            )
            .expect("Falha crítica ao registrar WH_MOUSE_LL");

            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).into() {
                if msg.message == WM_QUIT {
                    break;
                }
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }

            let _ = UnhookWindowsHookEx(hook);
        })
        .expect("Não foi possível criar a thread steins-input-ll");

    // 2. Thread do Kernel Driver Bridge (Interception) para jogos FPS com Raw Input
    spawn_kernel_driver_thread();
}

/// Bridge para o driver de filtro de kernel Interception (`mouse.sys`), operando abaixo do Raw Input.
fn spawn_kernel_driver_thread() {
    thread::Builder::new()
        .name("steins-kernel-raw".into())
        .spawn(|| unsafe {
            let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL);

            #[cfg(feature = "kernel-interception")]
            {
                use interception::{Filter, Interception, MouseFlags, MouseState, Stroke};
                if let Some(ctx) = Interception::new() {
                    ctx.set_filter(Interception::is_mouse, Filter::MouseFilter(MouseFilter::All));
                    let mut strokes = [Stroke::Mouse {
                        state: MouseState::empty(),
                        flags: MouseFlags::MOVE_RELATIVE,
                        rolling: 0,
                        x: 0,
                        y: 0,
                        information: 0,
                    }; 1];

                    loop {
                        let dev = ctx.wait();
                        if Interception::is_mouse(dev) {
                            if ctx.receive(dev, &mut strokes) > 0 {
                                let prof = ENGINE_STATE.profile.load();
                                let bypass = ENGINE_STATE.emergency_bypass.load(Ordering::Relaxed);

                                if !bypass
                                    && prof.cfg.active
                                    && prof.cfg.mode == EngineMode::FpsKernelDriver
                                {
                                    if let Stroke::Mouse { ref mut x, ref mut y, .. } = strokes[0]
                                    {
                                        let (nx, ny) = transform_delta(*x, *y, &prof);
                                        *x = nx;
                                        *y = ny;
                                        ENGINE_STATE.last_dx.store(nx, Ordering::Relaxed);
                                        ENGINE_STATE.last_dy.store(ny, Ordering::Relaxed);
                                    }
                                }
                                ctx.send(dev, &strokes);
                            }
                        }
                    }
                }
            }
        })
        .ok();
}

/// Atualiza a configuração do motor instantaneamente de forma Lock-Free (Wait-Free para o leitor)
pub fn update_engine_config(new_cfg: EngineConfig) {
    let compiled = CompiledProfile::from_config(new_cfg);
    ENGINE_STATE.profile.store(Arc::new(compiled));
}

/// Aciona ou desativa o Kill Switch de Emergência
pub fn trigger_kill_switch() -> bool {
    let mut current = ENGINE_STATE.profile.load().cfg.clone();
    let new_active = !current.active;
    current.active = new_active;
    ENGINE_STATE
        .emergency_bypass
        .store(!new_active, Ordering::SeqCst);
    update_engine_config(current);
    let _ = ENGINE_STATE
        .audio_tx
        .try_send(SoundEvent::DivergenceShift(new_active));
    new_active
}

pub fn stop_engine() {
    let tid = ENGINE_STATE.hook_thread_id.load(Ordering::SeqCst);
    if tid != 0 {
        unsafe {
            let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0));
        }
    }
}
