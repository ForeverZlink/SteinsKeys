import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowLeftRight,
  ArrowUpDown,
  Check,
  Compass,
  Cpu,
  Crosshair,
  FolderGit2,
  Gamepad2,
  Keyboard,
  Layers,
  type LucideIcon,
  MousePointer,
  Plus,
  RotateCcw,
  Settings2,
  Shield,
  Sliders,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";

// ============================================================================
// TIPOS E CONTRATOS IPC COM O CORE EM RUST
// ============================================================================

export type EngineMode = "desktop_safe" | "fps_kernel_driver";
export type MouseButton =
  | "left"
  | "right"
  | "middle"
  | "x_button1"
  | "x_button2"
  | "scroll_up"
  | "scroll_down";

export type TabId = "axes" | "buttons" | "acoustics" | "profiles" | "system";

export interface EngineConfig {
  active: boolean;
  mode: EngineMode;
  invert_x: boolean;
  invert_y: boolean;
  swap_axes: boolean;
  rotation_deg: number;
  audio_enabled: boolean;
  sound_pack: string;
  button_remap: Record<string, MouseButton>;
}

interface TelemetryPayload {
  dx: number;
  dy: number;
  active: boolean;
  bypass: boolean;
}

interface GameProfileItem {
  id: string;
  name: string;
  executable: string;
  invertY: boolean;
  invertX: boolean;
  mode: EngineMode;
  enabled: boolean;
}

// ============================================================================
// COMPONENTES REUTILIZÁVEIS DO DESIGN SYSTEM "MONOCHROME EDITORIAL NOIR"
// ============================================================================

interface NoirSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  labelOn?: string;
  labelOff?: string;
  size?: "sm" | "md";
}

export const NoirSwitch: React.FC<NoirSwitchProps> = ({
  checked,
  onChange,
  size = "md",
}) => {
  const isSmall = size === "sm";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={`relative inline-flex shrink-0 items-center rounded-sm border transition-colors duration-150 focus:outline-none ${
        isSmall ? "h-5 w-9" : "h-6 w-11"
      } ${
        checked
          ? "bg-[#FFFFFF] border-[#FFFFFF]"
          : "bg-[#09090B] border-[#27272A] hover:border-[#52525B]"
      }`}
    >
      <span
        className={`inline-block rounded-[1px] transition-transform duration-150 ${
          isSmall ? "h-3 w-3" : "h-3.5 w-3.5"
        } ${
          checked
            ? isSmall
              ? "translate-x-4 bg-[#09090B]"
              : "translate-x-5 bg-[#09090B]"
            : "translate-x-1 bg-[#A1A1AA]"
        }`}
      />
    </button>
  );
};

interface SectionHeaderProps {
  title: string;
  subtitle: string;
  badge?: string;
  rightSlot?: React.ReactNode;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  subtitle,
  badge,
  rightSlot,
}) => (
  <div className="flex items-end justify-between pb-5 mb-5 border-b border-[#1F1F23]">
    <div>
      <div className="flex items-center gap-3">
        <h1 className="font-serif text-3xl tracking-tight text-[#FAFAFA] leading-none">
          {title}
        </h1>
        {badge && (
          <span className="font-mono text-[11px] px-2 py-0.5 bg-[#121215] border border-[#27272A] text-[#A1A1AA] rounded-sm">
            {badge}
          </span>
        )}
      </div>
      <p className="font-sans text-xs text-[#A1A1AA] mt-2">{subtitle}</p>
    </div>
    {rightSlot && <div>{rightSlot}</div>}
  </div>
);

interface SettingCardProps {
  title: string;
  description?: string;
  active?: boolean;
  badge?: string;
  className?: string;
  headerRight?: React.ReactNode;
  onClick?: () => void;
  children: React.ReactNode;
}

export const SettingCard: React.FC<SettingCardProps> = ({
  title,
  description,
  active = false,
  badge,
  className = "",
  headerRight,
  onClick,
  children,
}) => (
  <div
    onClick={onClick}
    className={`bg-[#121215] hover:bg-[#18181C]/70 transition-colors duration-150 rounded-md p-5 border flex flex-col justify-between ${
      active ? "border-[#FAFAFA]" : "border-[#27272A]"
    } ${onClick ? "cursor-pointer" : ""} ${className}`}
  >
    <div>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-sans text-xs font-semibold uppercase tracking-wider text-[#FAFAFA]">
              {title}
            </h3>
            {badge && (
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-sm border border-[#27272A] bg-[#09090B] text-[#A1A1AA]">
                {badge}
              </span>
            )}
          </div>
          {description && (
            <p className="font-sans text-xs text-[#A1A1AA] mt-1 leading-relaxed">
              {description}
            </p>
          )}
        </div>
        {headerRight}
      </div>
    </div>
    <div className="mt-2">{children}</div>
  </div>
);

// ============================================================================
// CONSTANTES DE NAVEGAÇÃO E DADOS
// ============================================================================

const NAV_TABS: {
  id: TabId;
  label: string;
  meta: string;
  icon: LucideIcon;
}[] = [
  {
    id: "axes",
    label: "Axes & Movement",
    meta: "X/Y",
    icon: Compass,
  },
  {
    id: "buttons",
    label: "Buttons & Shortcuts",
    meta: "5 BTN",
    icon: MousePointer,
  },
  {
    id: "acoustics",
    label: "Click Sounds",
    meta: "WAV",
    icon: Volume2,
  },
  {
    id: "profiles",
    label: "Game Profiles",
    meta: ".EXE",
    icon: Gamepad2,
  },
  {
    id: "system",
    label: "System & Tray",
    meta: "SYS",
    icon: Settings2,
  },
];

const ACOUSTIC_PRESETS = [
  {
    id: "ibm_selectric",
    title: "Noir Typewriter",
    subtitle: "Crisp mechanical click inspired by the IBM Selectric II",
    spec: "1.4kHz Square Decay // 18ms",
  },
  {
    id: "nixie_mechanical",
    title: "Heavy Mechanical",
    subtitle: "Deep tactile switch with a metallic spring snap",
    spec: "1.9kHz Triangle // 15ms",
  },
  {
    id: "soft_tactile",
    title: "Soft Tactile",
    subtitle: "Short, quiet sound pulse for long sessions",
    spec: "820Hz Sine Low-Pass // 11ms",
  },
  {
    id: "lab_divergence",
    title: "Retro Beep",
    subtitle: "Classic 80s analog lab micro-beep",
    spec: "2.4kHz Sawtooth // 14ms",
  },
];

const MOUSE_BUTTON_ROWS: {
  id: MouseButton;
  title: string;
  code: string;
  desc: string;
}[] = [
  {
    id: "left",
    title: "Left Click",
    code: "M1",
    desc: "Primary fire / Standard system click",
  },
  {
    id: "right",
    title: "Right Click",
    code: "M2",
    desc: "Aim (ADS) / Context menu",
  },
  {
    id: "middle",
    title: "Middle Click (Scroll)",
    code: "M3",
    desc: "Scroll wheel click (Ping / Tactical wheel)",
  },
  {
    id: "x_button1",
    title: "Side Button 1 (Back)",
    code: "M4",
    desc: "Rear thumb button (XButton1)",
  },
  {
    id: "x_button2",
    title: "Side Button 2 (Forward)",
    code: "M5",
    desc: "Front thumb button (XButton2)",
  },
];

const REMAP_OPTIONS: { value: MouseButton; label: string }[] = [
  { value: "left", label: "M1 — Left Click" },
  { value: "right", label: "M2 — Right Click" },
  { value: "middle", label: "M3 — Middle Click" },
  { value: "x_button1", label: "M4 — Side 1 (Back)" },
  { value: "x_button2", label: "M5 — Side 2 (Forward)" },
  { value: "scroll_up", label: "Scroll Up" },
  { value: "scroll_down", label: "Scroll Down" },
];

// ============================================================================
// COMPONENTE PRINCIPAL: STEINS;KEYS (MONOCHROME EDITORIAL NOIR)
// ============================================================================

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>("axes");

  const [config, setConfig] = useState<EngineConfig>({
    active: false,
    mode: "desktop_safe",
    invert_x: false,
    invert_y: true,
    swap_axes: false,
    rotation_deg: 0,
    audio_enabled: true,
    sound_pack: "ibm_selectric",
    button_remap: {},
  });

  const [volume, setVolume] = useState<number>(75);
  const [killSwitchHotkey, setKillSwitchHotkey] =
    useState<string>("Ctrl+Shift+I");
  const [startWithWindows, setStartWithWindows] = useState<boolean>(false);
  const [destroyWebviewOnClose, setDestroyWebviewOnClose] =
    useState<boolean>(true);
  const [activeProfileLabel, setActiveProfileLabel] = useState<string>(
    "Profile: Desktop Default"
  );
  const [isNativeTauri, setIsNativeTauri] = useState<boolean>(false);

  // Perfis de Jogos (.exe)
  const [gameProfiles, setGameProfiles] = useState<GameProfileItem[]>([
    {
      id: "cs2",
      name: "Counter-Strike 2",
      executable: "cs2.exe",
      invertY: true,
      invertX: false,
      mode: "fps_kernel_driver",
      enabled: true,
    },
    {
      id: "valorant",
      name: "VALORANT",
      executable: "valorant.exe",
      invertY: true,
      invertX: false,
      mode: "fps_kernel_driver",
      enabled: true,
    },
    {
      id: "apex",
      name: "Apex Legends",
      executable: "r5apex.exe",
      invertY: true,
      invertX: false,
      mode: "fps_kernel_driver",
      enabled: false,
    },
  ]);
  const [newExeInput, setNewExeInput] = useState<string>("");

  // Estado do Playground de Teste (Live Canvas)
  const [telemetry, setTelemetry] = useState<{ dx: number; dy: number }>({
    dx: 0,
    dy: 0,
  });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const crosshairPosRef = useRef<{ x: number; y: number }>({ x: 240, y: 85 });
  const trailRef = useRef<{ x: number; y: number }[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // ==========================================================================
  // SINTETIZADOR ACÚSTICO (WEB AUDIO FALLBACK + PREVIEW DE TIMBRES)
  // ==========================================================================
  const triggerAcousticPreview = (
    pack: string,
    isDown: boolean,
    customVol = volume
  ) => {
    if (!config.audio_enabled || customVol <= 0) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext({ latencyHint: "interactive" });
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      const gainScalar = (customVol / 100) * (isDown ? 0.35 : 0.16);

      if (pack === "ibm_selectric") {
        osc.type = "square";
        osc.frequency.setValueAtTime(isDown ? 1380 : 920, now);
        osc.frequency.exponentialRampToValueAtTime(170, now + 0.018);
      } else if (pack === "nixie_mechanical") {
        osc.type = "triangle";
        osc.frequency.setValueAtTime(isDown ? 1920 : 1180, now);
        osc.frequency.exponentialRampToValueAtTime(280, now + 0.015);
      } else if (pack === "soft_tactile") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(isDown ? 820 : 540, now);
        osc.frequency.exponentialRampToValueAtTime(190, now + 0.012);
      } else {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(isDown ? 2350 : 1550, now);
        osc.frequency.exponentialRampToValueAtTime(420, now + 0.014);
      }

      gain.gain.setValueAtTime(Math.max(0.001, gainScalar), now);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.018);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.02);
    } catch {
      // Ignora bloqueio de autoplay antes de interação
    }
  };

  // Som global no modo Preview de navegador
  useEffect(() => {
    if (isNativeTauri) return;
    const onDown = () => triggerAcousticPreview(config.sound_pack, true);
    const onUp = () => triggerAcousticPreview(config.sound_pack, false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isNativeTauri, config.audio_enabled, config.sound_pack, volume]);

  // Atalho de teclado local no navegador (Ctrl+Shift+I) para testar o Master Switch
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "i") {
        e.preventDefault();
        handleMasterToggle();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // ==========================================================================
  // SINCRONIZAÇÃO IPC COM O BACKEND RUST (TAURI V2)
  // ==========================================================================
  useEffect(() => {
    invoke<EngineConfig>("get_engine_config")
      .then((initial) => {
        setConfig(initial);
        setIsNativeTauri(true);
      })
      .catch(() => {
        setIsNativeTauri(false);
      });

    const unlistenDivergence = listen<boolean>("divergence-changed", (ev) => {
      setConfig((prev) => ({ ...prev, active: ev.payload }));
    });

    const unlistenConfig = listen<EngineConfig>("config-updated", (ev) => {
      setConfig(ev.payload);
    });

    return () => {
      unlistenDivergence.then((f) => f());
      unlistenConfig.then((f) => f());
    };
  }, []);

  const applyConfig = async (next: EngineConfig) => {
    setConfig(next);
    try {
      await invoke("set_engine_config", { config: next });
    } catch {
      // Fallback para modo Browser Preview
    }
  };

  const handleMasterToggle = async () => {
    try {
      const nextActive = await invoke<boolean>("toggle_divergence");
      setConfig((prev) => ({ ...prev, active: nextActive }));
    } catch {
      applyConfig({ ...config, active: !config.active });
    }
  };

  // ==========================================================================
  // RENDERIZAÇÃO DO PLAYGROUND DE TESTE (LIVE CANVAS 60FPS)
  // ==========================================================================
  useEffect(() => {
    if (activeTab !== "axes") return;
    let animId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const renderLoop = async () => {
      try {
        const tel = await invoke<TelemetryPayload>("poll_axis_telemetry");
        if (tel.dx !== 0 || tel.dy !== 0) {
          pushCanvasSample(tel.dx, tel.dy);
        }
      } catch {
        // Alimentado via onMouseMove no Canvas quando em modo Browser
      }

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      // Linhas centrais de referência sutis
      ctx.strokeStyle = "#1F1F23";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, h);
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      // Rastro suave monocromático
      const pts = trailRef.current;
      if (pts.length > 1) {
        for (let i = 1; i < pts.length; i++) {
          const alpha = (i / pts.length) * 0.65;
          ctx.strokeStyle = `rgba(250, 250, 250, ${alpha})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
          ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
        }
      }

      // Crosshair Minimalista Branco Puro
      const pos = crosshairPosRef.current;
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 1.25;
      const size = 8;
      ctx.beginPath();
      ctx.moveTo(pos.x - size, pos.y);
      ctx.lineTo(pos.x + size, pos.y);
      ctx.moveTo(pos.x, pos.y - size);
      ctx.lineTo(pos.x, pos.y + size);
      ctx.stroke();

      // Círculo central de precisão
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();

      animId = requestAnimationFrame(renderLoop);
    };

    animId = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(animId);
  }, [activeTab]);

  const pushCanvasSample = (dx: number, dy: number) => {
    const canvas = canvasRef.current;
    const w = canvas ? canvas.width : 580;
    const h = canvas ? canvas.height : 170;
    const cur = crosshairPosRef.current;
    const nx = Math.max(12, Math.min(w - 12, cur.x + dx * 0.8));
    const ny = Math.max(12, Math.min(h - 12, cur.y + dy * 0.8));
    crosshairPosRef.current = { x: nx, y: ny };
    setTelemetry({ dx, dy });

    trailRef.current.push({ x: nx, y: ny });
    if (trailRef.current.length > 32) {
      trailRef.current.shift();
    }
  };

  const handlePlaygroundMouseMove = (
    e: React.MouseEvent<HTMLCanvasElement>
  ) => {
    let dx = e.movementX;
    let dy = e.movementY;

    if (config.swap_axes) {
      const tmp = dx;
      dx = dy;
      dy = tmp;
    }
    if (config.invert_x) dx = -dx;
    if (config.invert_y) dy = -dy;

    if (config.rotation_deg !== 0) {
      const rad = (config.rotation_deg * Math.PI) / 180;
      const rx = Math.round(dx * Math.cos(rad) - dy * Math.sin(rad));
      const ry = Math.round(dx * Math.sin(rad) + dy * Math.cos(rad));
      dx = rx;
      dy = ry;
    }

    pushCanvasSample(dx, dy);
  };

  // ==========================================================================
  // RENDERIZAÇÃO DA INTERFACE (JANELA FIXA 960x640 SEM ROLAGEM BAGUNÇADA)
  // ==========================================================================
  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#09090B] text-[#FAFAFA] select-none">
      {/* ====================================================================
          3.1. TOP STATUS BAR (h-14)
      ==================================================================== */}
      <header className="h-14 shrink-0 bg-[#0C0C0E] border-b border-[#1F1F23] px-6 flex items-center justify-between">
        {/* Esquerda: Logo Tipográfico Serifado + Versão */}
        <div className="flex items-center gap-3">
          <span className="font-serif text-2xl tracking-tight text-[#FAFAFA] leading-none">
            Steins;Keys
          </span>
          <span className="font-mono text-[11px] px-1.5 py-0.5 rounded-sm bg-[#121215] border border-[#27272A] text-[#A1A1AA]">
            v1.1.0
          </span>
          <span className="font-mono text-[10px] text-[#52525B] hidden sm:inline">
            {isNativeTauri ? "NATIVE ENGINE" : "UI PREVIEW"}
          </span>
        </div>

        {/* Centro: Indicador do Perfil Ativo */}
        <div className="flex items-center gap-2.5 px-3 py-1 rounded-sm bg-[#121215] border border-[#27272A]">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              config.active ? "bg-[#FFFFFF]" : "bg-[#52525B]"
            }`}
          />
          <span className="font-sans text-xs text-[#A1A1AA]">
            {activeProfileLabel}
          </span>
          <span className="font-mono text-[10px] text-[#52525B] border-l border-[#27272A] pl-2">
            {config.mode === "desktop_safe" ? "USER HOOK" : "RAW KERNEL"}
          </span>
        </div>

        {/* Direita: Master Switch em Preto & Branco + Atalho de Emergência */}
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs text-[#A1A1AA] bg-[#121215] border border-[#27272A] px-2 py-1 rounded-sm">
            [{killSwitchHotkey}]
          </span>

          <button
            type="button"
            onClick={handleMasterToggle}
            className={`h-8 px-3.5 rounded-sm border font-sans text-xs font-medium transition-all duration-150 flex items-center gap-2 ${
              config.active
                ? "bg-[#FFFFFF] text-[#09090B] border-[#FFFFFF]"
                : "bg-[#121215] text-[#FAFAFA] border-[#27272A] hover:border-[#FAFAFA]"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                config.active ? "bg-[#09090B]" : "bg-[#52525B]"
              }`}
            />
            {config.active ? "System Active" : "Paused"}
          </button>
        </div>
      </header>

      {/* ====================================================================
          CORPO PRINCIPAL: SIDEBAR VERTICAL (w-56) + ÁREA DE CONTEÚDO
      ==================================================================== */}
      <div className="flex-1 flex overflow-hidden">
        {/* 3.2. SIDEBAR DE NAVEGAÇÃO VERTICAL */}
        <aside className="w-56 shrink-0 bg-[#0C0C0E] border-r border-[#1F1F23] p-3 flex flex-col justify-between">
          <nav className="space-y-1">
            <div className="px-3 py-2 font-mono text-[10px] uppercase tracking-widest text-[#52525B]">
              Control Modules
            </div>
            {NAV_TABS.map((tab) => {
              const Icon = tab.icon;
              const isSelected = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-sm text-left transition-colors duration-150 border ${
                    isSelected
                      ? "bg-[#FFFFFF] text-[#09090B] border-[#FFFFFF] font-medium"
                      : "bg-transparent text-[#A1A1AA] border-transparent hover:bg-[#121215] hover:text-[#FAFAFA]"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Icon
                      className={`w-4 h-4 ${
                        isSelected ? "text-[#09090B]" : "text-[#A1A1AA]"
                      }`}
                      strokeWidth={1.5}
                    />
                    <span className="font-sans text-xs">{tab.label}</span>
                  </div>
                  <span
                    className={`font-mono text-[10px] ${
                      isSelected ? "text-[#09090B]/70" : "text-[#52525B]"
                    }`}
                  >
                    {tab.meta}
                  </span>
                </button>
              );
            })}
          </nav>

          {/* Resumo Técnico no Rodapé da Sidebar */}
          <div className="p-3 rounded-sm bg-[#121215] border border-[#27272A] space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] text-[#A1A1AA]">
                ACTIVE VECTOR
              </span>
              <span className="font-mono text-[10px] text-[#FAFAFA]">
                {config.invert_y ? "-Y" : "+Y"} /{" "}
                {config.invert_x ? "-X" : "+X"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] text-[#A1A1AA]">
                ANGLE θ
              </span>
              <span className="font-mono text-[10px] text-[#FAFAFA]">
                {config.rotation_deg}°
              </span>
            </div>
            <div className="pt-1.5 border-t border-[#1F1F23] flex items-center justify-between">
              <span className="font-mono text-[10px] text-[#52525B]">
                LATENCY
              </span>
              <span className="font-mono text-[10px] text-[#A1A1AA]">
                &lt; 0.12ms (8KHz)
              </span>
            </div>
          </div>
        </aside>

        {/* 3.3. ÁREA DE CONTEÚDO PRINCIPAL (BENTO GRID) */}
        <main className="flex-1 bg-[#09090B] p-6 overflow-y-auto">
          {/* ================================================================
              ABA 1: EIXOS & MOVIMENTO
          ================================================================ */}
          {activeTab === "axes" && (
            <div className="max-w-4xl mx-auto flex flex-col h-full">
              <SectionHeader
                title="Axes & Movement"
                subtitle="Instant mouse movement adjustments for inverted-axis players and custom sensor angles."
                badge="2D MATRIX"
              />

              <div className="grid grid-cols-2 gap-4">
                {/* Card 1: Inversão de Eixos */}
                <SettingCard
                  title="Invert Axes"
                  description="Flip vertical (up/down) or horizontal (left/right) mouse movement independently."
                  active={config.invert_y || config.invert_x}
                  badge="DIRECTION"
                >
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    {/* Botão Grande: Inverter Eixo Y */}
                    <button
                      type="button"
                      onClick={() =>
                        applyConfig({ ...config, invert_y: !config.invert_y })
                      }
                      className={`p-3.5 rounded-sm border text-left transition-all duration-150 flex flex-col justify-between h-24 ${
                        config.invert_y
                          ? "bg-[#FFFFFF] text-[#09090B] border-[#FFFFFF]"
                          : "bg-[#09090B] text-[#FAFAFA] border-[#27272A] hover:border-[#52525B]"
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <ArrowUpDown
                          className="w-4 h-4"
                          strokeWidth={1.5}
                        />
                        <span className="font-mono text-[10px] uppercase">
                          {config.invert_y ? "ACTIVE" : "DEFAULT"}
                        </span>
                      </div>
                      <div>
                        <div className="font-sans text-xs font-semibold">
                          Invert Y-Axis
                        </div>
                        <div
                          className={`font-mono text-[10px] mt-0.5 ${
                            config.invert_y
                              ? "text-[#09090B]/70"
                              : "text-[#A1A1AA]"
                          }`}
                        >
                          Vertical (dy = -dy)
                        </div>
                      </div>
                    </button>

                    {/* Botão Grande: Inverter Eixo X */}
                    <button
                      type="button"
                      onClick={() =>
                        applyConfig({ ...config, invert_x: !config.invert_x })
                      }
                      className={`p-3.5 rounded-sm border text-left transition-all duration-150 flex flex-col justify-between h-24 ${
                        config.invert_x
                          ? "bg-[#FFFFFF] text-[#09090B] border-[#FFFFFF]"
                          : "bg-[#09090B] text-[#FAFAFA] border-[#27272A] hover:border-[#52525B]"
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <ArrowLeftRight
                          className="w-4 h-4"
                          strokeWidth={1.5}
                        />
                        <span className="font-mono text-[10px] uppercase">
                          {config.invert_x ? "ACTIVE" : "DEFAULT"}
                        </span>
                      </div>
                      <div>
                        <div className="font-sans text-xs font-semibold">
                          Invert X-Axis
                        </div>
                        <div
                          className={`font-mono text-[10px] mt-0.5 ${
                            config.invert_x
                              ? "text-[#09090B]/70"
                              : "text-[#A1A1AA]"
                          }`}
                        >
                          Horizontal (dx = -dx)
                        </div>
                      </div>
                    </button>
                  </div>
                </SettingCard>

                {/* Card 2: Troca & Orientação */}
                <SettingCard
                  title="Swap & Angle"
                  description="Swap horizontal and vertical axes or rotate your mouse sensor angle smoothly."
                  active={config.swap_axes || config.rotation_deg !== 0}
                  badge="GEOMETRY"
                >
                  <div className="space-y-4 pt-1">
                    {/* Toggle Swap X/Y */}
                    <div className="flex items-center justify-between p-2.5 rounded-sm bg-[#09090B] border border-[#27272A]">
                      <div>
                        <div className="font-sans text-xs font-medium text-[#FAFAFA]">
                          Swap X and Y Axes
                        </div>
                        <div className="font-mono text-[10px] text-[#A1A1AA]">
                          Switches horizontal and vertical movement
                        </div>
                      </div>
                      <NoirSwitch
                        checked={config.swap_axes}
                        onChange={(val) =>
                          applyConfig({ ...config, swap_axes: val })
                        }
                      />
                    </div>

                    {/* Slider de Ângulo de Rotação */}
                    <div className="p-2.5 rounded-sm bg-[#09090B] border border-[#27272A]">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-sans text-xs text-[#A1A1AA] flex items-center gap-1.5">
                          <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.5} />
                          Sensor Angle
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-[#FAFAFA]">
                            {config.rotation_deg}°
                          </span>
                          {config.rotation_deg !== 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                applyConfig({ ...config, rotation_deg: 0 })
                              }
                              className="font-mono text-[10px] text-[#A1A1AA] hover:text-[#FAFAFA] underline"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                      </div>
                      <input
                        type="range"
                        min={-180}
                        max={180}
                        step={1}
                        value={config.rotation_deg}
                        onChange={(e) =>
                          applyConfig({
                            ...config,
                            rotation_deg: Number(e.target.value),
                          })
                        }
                        className="w-full noir-slider"
                      />
                    </div>
                  </div>
                </SettingCard>

                {/* Card 3: Playground de Teste (Live Canvas - Ocupa 2 Colunas) */}
                <SettingCard
                  title="Movement Test Area (Live Preview)"
                  description="Move your cursor inside the grid below to test your axis settings in real time."
                  className="col-span-2"
                  headerRight={
                    <div className="flex items-center gap-2 font-mono text-[11px] text-[#A1A1AA] bg-[#09090B] px-2.5 py-1 rounded-sm border border-[#27272A]">
                      <Crosshair className="w-3.5 h-3.5 text-[#FAFAFA]" strokeWidth={1.5} />
                      <span>
                        ΔX: {telemetry.dx >= 0 ? `+${telemetry.dx}` : telemetry.dx}
                      </span>
                      <span className="text-[#52525B]">|</span>
                      <span>
                        ΔY: {telemetry.dy >= 0 ? `+${telemetry.dy}` : telemetry.dy}
                      </span>
                    </div>
                  }
                >
                  <div className="relative rounded-sm border border-[#27272A] noir-dot-matrix overflow-hidden">
                    <canvas
                      ref={canvasRef}
                      width={780}
                      height={155}
                      onMouseMove={handlePlaygroundMouseMove}
                      className="w-full h-[155px] block cursor-crosshair"
                    />
                    <div className="pointer-events-none absolute bottom-2 left-3 right-3 flex items-center justify-between font-mono text-[10px] text-[#52525B]">
                      <span>INTERACTIVE VECTOR SURFACE</span>
                      <span className="text-[#A1A1AA]">
                        {config.invert_y ? "Y: INVERTED" : "Y: NORMAL"} ·{" "}
                        {config.invert_x ? "X: INVERTED" : "X: NORMAL"}
                        {config.swap_axes ? " · SWAP X↔Y" : ""}
                      </span>
                    </div>
                  </div>
                </SettingCard>
              </div>
            </div>
          )}

          {/* ================================================================
              ABA 2: BOTÕES & ATALHOS
          ================================================================ */}
          {activeTab === "buttons" && (
            <div className="max-w-4xl mx-auto">
              <SectionHeader
                title="Buttons & Shortcuts"
                subtitle="Remap your 5 physical mouse buttons and configure your global emergency shortcut."
                badge="HID REMAP"
                rightSlot={
                  Object.keys(config.button_remap).length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        applyConfig({ ...config, button_remap: {} })
                      }
                      className="px-3 py-1.5 rounded-sm border border-[#27272A] bg-[#121215] hover:border-[#FAFAFA] font-sans text-xs text-[#FAFAFA] transition-colors"
                    >
                      Reset to Default
                    </button>
                  )
                }
              />

              <div className="grid grid-cols-12 gap-4">
                {/* Lista dos 5 Botões (8 colunas) */}
                <div className="col-span-8 bg-[#121215] border border-[#27272A] rounded-md divide-y divide-[#1F1F23]">
                  {MOUSE_BUTTON_ROWS.map((btn) => {
                    const currentTarget =
                      config.button_remap[btn.id] || btn.id;
                    const isRemapped = currentTarget !== btn.id;
                    return (
                      <div
                        key={btn.id}
                        className="p-4 flex items-center justify-between gap-4 hover:bg-[#18181C]/50 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={`font-mono text-xs px-2 py-1 rounded-sm border ${
                              isRemapped
                                ? "bg-[#FFFFFF] text-[#09090B] border-[#FFFFFF] font-semibold"
                                : "bg-[#09090B] text-[#A1A1AA] border-[#27272A]"
                            }`}
                          >
                            {btn.code}
                          </span>
                          <div>
                            <div className="font-sans text-xs font-medium text-[#FAFAFA]">
                              {btn.title}
                            </div>
                            <div className="font-sans text-[11px] text-[#A1A1AA]">
                              {btn.desc}
                            </div>
                          </div>
                        </div>

                        <select
                          value={currentTarget}
                          onChange={(e) => {
                            const nextVal = e.target.value as MouseButton;
                            const nextMap = { ...config.button_remap };
                            if (nextVal === btn.id) {
                              delete nextMap[btn.id];
                            } else {
                              nextMap[btn.id] = nextVal;
                            }
                            applyConfig({ ...config, button_remap: nextMap });
                          }}
                          className={`bg-[#09090B] font-mono text-xs px-3 py-1.5 rounded-sm border focus:outline-none ${
                            isRemapped
                              ? "border-[#FAFAFA] text-[#FAFAFA]"
                              : "border-[#27272A] text-[#A1A1AA]"
                          }`}
                        >
                          {REMAP_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>

                {/* Coluna Lateral: Kill Switch & Inversão Rápida Canhoto (4 colunas) */}
                <div className="col-span-4 flex flex-col gap-4">
                  <SettingCard
                    title="Emergency Kill Switch"
                    description="Instantly turns off all axis and button changes anywhere on your PC or in-game."
                    active
                  >
                    <div className="space-y-3 pt-1">
                      <div className="p-3 rounded-sm bg-[#09090B] border border-[#27272A] flex items-center justify-between">
                        <Keyboard className="w-4 h-4 text-[#A1A1AA]" strokeWidth={1.5} />
                        <span className="font-mono text-xs text-[#FAFAFA]">
                          {killSwitchHotkey}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {["Ctrl+Shift+I", "Ctrl+Alt+K"].map((hk) => (
                          <button
                            key={hk}
                            type="button"
                            onClick={() => setKillSwitchHotkey(hk)}
                            className={`py-1.5 px-2 rounded-sm border font-mono text-[11px] transition-colors ${
                              killSwitchHotkey === hk
                                ? "bg-[#FFFFFF] text-[#09090B] border-[#FFFFFF]"
                                : "bg-[#09090B] text-[#A1A1AA] border-[#27272A]"
                            }`}
                          >
                            {hk}
                          </button>
                        ))}
                      </div>
                    </div>
                  </SettingCard>

                  <SettingCard
                    title="Quick Left-Handed Mode"
                    description="Instantly swaps Left Click (M1) and Right Click (M2)."
                    active={config.button_remap["left"] === "right"}
                  >
                    <div className="flex items-center justify-between pt-2">
                      <span className="font-mono text-xs text-[#A1A1AA]">
                        Swap M1 ↔ M2
                      </span>
                      <NoirSwitch
                        checked={config.button_remap["left"] === "right"}
                        onChange={(swap) => {
                          const nextRemap: Record<string, MouseButton> = swap
                            ? {
                                ...config.button_remap,
                                left: "right",
                                right: "left",
                              }
                            : {};
                          applyConfig({ ...config, button_remap: nextRemap });
                        }}
                      />
                    </div>
                  </SettingCard>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              ABA 3: ACÚSTICA (SONS)
          ================================================================ */}
          {activeTab === "acoustics" && (
            <div className="max-w-4xl mx-auto">
              <SectionHeader
                title="Click Sounds & Audio Feedback"
                subtitle="Ultra-low-latency click sounds preloaded in memory for every mouse press."
                badge="WASAPI < 2ms"
                rightSlot={
                  <div className="flex items-center gap-3 bg-[#121215] border border-[#27272A] px-3.5 py-2 rounded-sm">
                    {config.audio_enabled ? (
                      <Volume2 className="w-4 h-4 text-[#FAFAFA]" strokeWidth={1.5} />
                    ) : (
                      <VolumeX className="w-4 h-4 text-[#52525B]" strokeWidth={1.5} />
                    )}
                    <span className="font-sans text-xs text-[#FAFAFA]">
                      Click Sounds
                    </span>
                    <NoirSwitch
                      size="sm"
                      checked={config.audio_enabled}
                      onChange={(enabled) =>
                        applyConfig({ ...config, audio_enabled: enabled })
                      }
                    />
                  </div>
                }
              />

              {/* Grid 2x2 de Timbres Selecionáveis */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                {ACOUSTIC_PRESETS.map((preset) => {
                  const isSelected = config.sound_pack === preset.id;
                  return (
                    <SettingCard
                      key={preset.id}
                      title={preset.title}
                      description={preset.subtitle}
                      active={isSelected}
                      onClick={() => {
                        applyConfig({ ...config, sound_pack: preset.id });
                        triggerAcousticPreview(preset.id, true);
                      }}
                      headerRight={
                        <span
                          className={`h-5 w-5 rounded-sm border flex items-center justify-center ${
                            isSelected
                              ? "bg-[#FFFFFF] border-[#FFFFFF] text-[#09090B]"
                              : "bg-[#09090B] border-[#27272A] text-transparent"
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                        </span>
                      }
                    >
                      <div className="pt-2 flex items-center justify-between border-t border-[#1F1F23]">
                        <span className="font-mono text-[10px] text-[#52525B]">
                          {preset.spec}
                        </span>
                        <span className="font-mono text-[10px] text-[#A1A1AA]">
                          {isSelected ? "SELECTED" : "CLICK TO TEST"}
                        </span>
                      </div>
                    </SettingCard>
                  );
                })}
              </div>

              {/* Card de Volume Master em Preto e Branco */}
              <SettingCard
                title="Master Volume"
                description="Adjust click sound volume with zero audio delay."
              >
                <div className="flex items-center gap-5 pt-1">
                  <Sliders className="w-4 h-4 text-[#A1A1AA] shrink-0" strokeWidth={1.5} />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={volume}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setVolume(v);
                      triggerAcousticPreview(config.sound_pack, true, v);
                    }}
                    className="w-full noir-slider"
                  />
                  <span className="font-mono text-xs text-[#FAFAFA] w-12 text-right">
                    {volume}%
                  </span>
                </div>
              </SettingCard>
            </div>
          )}

          {/* ================================================================
              ABA 4: PERFIS DE JOGOS (.EXE)
          ================================================================ */}
          {activeTab === "profiles" && (
            <div className="max-w-4xl mx-auto">
              <SectionHeader
                title="Game Profiles (.exe)"
                subtitle="Automatically activates your custom mouse settings when a game window is in focus."
                badge="AUTO-SWITCH"
              />

              {/* Barra para Adicionar Novo Executável */}
              <div className="bg-[#121215] border border-[#27272A] rounded-md p-4 mb-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1">
                  <FolderGit2 className="w-4 h-4 text-[#A1A1AA]" strokeWidth={1.5} />
                  <input
                    type="text"
                    placeholder="e.g. quake.exe, ow2.exe, deadlock.exe..."
                    value={newExeInput}
                    onChange={(e) => setNewExeInput(e.target.value)}
                    className="bg-[#09090B] border border-[#27272A] focus:border-[#FAFAFA] rounded-sm px-3 py-1.5 font-mono text-xs text-[#FAFAFA] w-full focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const clean = newExeInput.trim().toLowerCase();
                    if (!clean) return;
                    const exeName = clean.endsWith(".exe")
                      ? clean
                      : `${clean}.exe`;
                    setGameProfiles((prev) => [
                      ...prev,
                      {
                        id: String(Date.now()),
                        name: exeName.replace(".exe", "").toUpperCase(),
                        executable: exeName,
                        invertY: true,
                        invertX: false,
                        mode: "fps_kernel_driver",
                        enabled: true,
                      },
                    ]);
                    setNewExeInput("");
                  }}
                  className="px-4 py-1.5 rounded-sm bg-[#FFFFFF] text-[#09090B] font-sans text-xs font-medium flex items-center gap-1.5 shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" strokeWidth={2} />
                  Add Game (.exe)
                </button>
              </div>

              {/* Lista de Perfis */}
              <div className="space-y-2.5">
                {gameProfiles.map((prof) => (
                  <div
                    key={prof.id}
                    className={`p-4 rounded-md bg-[#121215] border flex items-center justify-between transition-colors ${
                      prof.enabled ? "border-[#FAFAFA]" : "border-[#27272A]"
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <NoirSwitch
                        size="sm"
                        checked={prof.enabled}
                        onChange={(val) => {
                          setGameProfiles((list) =>
                            list.map((item) =>
                              item.id === prof.id
                                ? { ...item, enabled: val }
                                : item
                            )
                          );
                          if (val) {
                            setActiveProfileLabel(
                              `Auto: watching ${prof.executable}`
                            );
                          }
                        }}
                      />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-sans text-xs font-semibold text-[#FAFAFA]">
                            {prof.name}
                          </span>
                          <span className="font-mono text-[11px] px-1.5 py-0.5 rounded-sm bg-[#09090B] border border-[#27272A] text-[#A1A1AA]">
                            {prof.executable}
                          </span>
                        </div>
                        <div className="font-mono text-[10px] text-[#A1A1AA] mt-1">
                          Rule:{" "}
                          {prof.invertY ? "Invert Y" : "Normal Y"} ·{" "}
                          {prof.mode === "fps_kernel_driver"
                            ? "Kernel Raw Input"
                            : "Desktop Hook"}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveProfileLabel(`Active: ${prof.executable}`);
                          applyConfig({
                            ...config,
                            active: true,
                            invert_y: prof.invertY,
                            invert_x: prof.invertX,
                            mode: prof.mode,
                          });
                        }}
                        className="px-2.5 py-1 rounded-sm border border-[#27272A] bg-[#09090B] hover:border-[#FAFAFA] font-mono text-[10px] text-[#A1A1AA] hover:text-[#FAFAFA]"
                      >
                        Test Profile
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setGameProfiles((list) =>
                            list.filter((i) => i.id !== prof.id)
                          )
                        }
                        className="p-1.5 rounded-sm border border-[#27272A] bg-[#09090B] hover:border-[#FAFAFA] text-[#A1A1AA] hover:text-[#FAFAFA]"
                      >
                        <Trash2 className="w-3.5 h-3.5" strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ================================================================
              ABA 5: SISTEMA & BANDEJA
          ================================================================ */}
          {activeTab === "system" && (
            <div className="max-w-4xl mx-auto">
              <SectionHeader
                title="System & Tray"
                subtitle="Choose how mouse input is handled and manage background memory usage."
                badge="KERNEL / WIN32"
              />

              <div className="grid grid-cols-2 gap-4">
                {/* Modo 1: Desktop User-Mode Hook */}
                <SettingCard
                  title="Mode 01 — Standard Desktop Mode (Safe)"
                  description="Uses standard Windows hooks (WH_MOUSE_LL). Best for everyday desktop use and 100% safe with all anti-cheats."
                  active={config.mode === "desktop_safe"}
                  badge="WH_MOUSE_LL"
                  onClick={() =>
                    applyConfig({ ...config, mode: "desktop_safe" })
                  }
                >
                  <div className="pt-2 flex items-center justify-between border-t border-[#1F1F23]">
                    <span className="font-mono text-[10px] text-[#A1A1AA] flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5" strokeWidth={1.5} />
                      100% Anti-Cheat Safe (Vanguard / Faceit)
                    </span>
                    <span className="font-mono text-[10px] text-[#FAFAFA]">
                      {config.mode === "desktop_safe" ? "● ACTIVE" : "SELECT"}
                    </span>
                  </div>
                </SettingCard>

                {/* Modo 2: Raw Input Kernel Bridge */}
                <SettingCard
                  title="Mode 02 — FPS Raw Input Mode (Driver)"
                  description="Uses the Interception driver to invert mouse movement directly at the hardware level for FPS games with Raw Input."
                  active={config.mode === "fps_kernel_driver"}
                  badge="KERNEL HID"
                  onClick={() =>
                    applyConfig({ ...config, mode: "fps_kernel_driver" })
                  }
                >
                  <div className="pt-2 flex items-center justify-between border-t border-[#1F1F23]">
                    <span className="font-mono text-[10px] text-[#A1A1AA] flex items-center gap-1.5">
                      <Cpu className="w-3.5 h-3.5" strokeWidth={1.5} />
                      Works with Raw Input in FPS Games
                    </span>
                    <span className="font-mono text-[10px] text-[#FAFAFA]">
                      {config.mode === "fps_kernel_driver"
                        ? "● ACTIVE"
                        : "SELECT"}
                    </span>
                  </div>
                </SettingCard>

                {/* Comportamento de Memória e Inicialização */}
                <SettingCard
                  title="Low Memory Mode (Zero-RAM Tray)"
                  description="Closes the interface completely when minimized to the system tray, keeping only the lightweight Rust engine (< 8 MB RAM) running in the background."
                  className="col-span-2"
                  badge="TRAY LIFECYCLE"
                >
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="p-3 rounded-sm bg-[#09090B] border border-[#27272A] flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <Layers className="w-4 h-4 text-[#A1A1AA]" strokeWidth={1.5} />
                        <div>
                          <div className="font-sans text-xs font-medium text-[#FAFAFA]">
                            Free Up Memory When Closed to Tray
                          </div>
                          <div className="font-mono text-[10px] text-[#A1A1AA]">
                            In-game usage: ~6.4 MB RAM / 0% CPU
                          </div>
                        </div>
                      </div>
                      <NoirSwitch
                        size="sm"
                        checked={destroyWebviewOnClose}
                        onChange={setDestroyWebviewOnClose}
                      />
                    </div>

                    <div className="p-3 rounded-sm bg-[#09090B] border border-[#27272A] flex items-center justify-between">
                      <div>
                        <div className="font-sans text-xs font-medium text-[#FAFAFA]">
                          Start Minimized with Windows
                        </div>
                        <div className="font-mono text-[10px] text-[#A1A1AA]">
                          Runs at high priority for zero input lag
                        </div>
                      </div>
                      <NoirSwitch
                        size="sm"
                        checked={startWithWindows}
                        onChange={setStartWithWindows}
                      />
                    </div>
                  </div>
                </SettingCard>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default App;
