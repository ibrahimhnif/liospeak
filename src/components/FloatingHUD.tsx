import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Mic, Sparkles, CheckCircle2, AlertCircle } from 'lucide-react';
import { DictationStatusEvent, DictationState } from '../services/shortcutManager';

export const FloatingHUD: React.FC = () => {
  const [status, setStatus] = useState<DictationStatusEvent>({
    state: 'idle',
    volume: 0,
  });

  useEffect(() => {
    // Listen for local and cross-window broadcast events
    const handleLocal = (e: Event) => {
      const custom = e as CustomEvent<DictationStatusEvent>;
      if (custom.detail) {
        setStatus(custom.detail);
      }
    };
    window.addEventListener('liospeak_status', handleLocal);

    let unlistenTauri: (() => void) | undefined;
    listen<DictationStatusEvent>('liospeak_status_event', (event) => {
      setStatus(event.payload);
    }).then((un) => {
      unlistenTauri = un;
    });

    return () => {
      window.removeEventListener('liospeak_status', handleLocal);
      if (unlistenTauri) unlistenTauri();
    };
  }, []);

  const state: DictationState = status.state;
  const volume = status.volume || 0;

  // Don't render anything if idle
  if (state === 'idle') {
    return null;
  }

  return (
    <div className="hud-container">
      <div className={`hud-card hud-state-${state}`}>
        {/* LISTENING STATE */}
        {state === 'listening' && (
          <>
            <div className="hud-icon-wrap listening">
              <span className="hud-pulse-ring" />
              <Mic className="hud-icon" size={20} />
            </div>
            <div className="hud-body">
              <span className="hud-title">Mendengarkan suara...</span>
              <div className="hud-waves">
                <span
                  className="wave-bar"
                  style={{ height: `${Math.max(6, Math.min(26, volume * 35))}px` }}
                />
                <span
                  className="wave-bar"
                  style={{ height: `${Math.max(8, Math.min(30, volume * 45))}px` }}
                />
                <span
                  className="wave-bar"
                  style={{ height: `${Math.max(12, Math.min(32, volume * 55))}px` }}
                />
                <span
                  className="wave-bar"
                  style={{ height: `${Math.max(8, Math.min(30, volume * 45))}px` }}
                />
                <span
                  className="wave-bar"
                  style={{ height: `${Math.max(6, Math.min(26, volume * 35))}px` }}
                />
              </div>
            </div>
          </>
        )}

        {/* TRANSCRIBING STATE */}
        {state === 'transcribing' && (
          <>
            <div className="hud-icon-wrap transcribing">
              <Sparkles className="hud-icon spin" size={20} />
            </div>
            <div className="hud-body">
              <span className="hud-title">Mentranskrip AI...</span>
              <span className="hud-subtitle">Merapikan tanda baca & format</span>
            </div>
          </>
        )}

        {/* DONE STATE */}
        {state === 'done' && (
          <>
            <div className="hud-icon-wrap done">
              <CheckCircle2 className="hud-icon" size={20} />
            </div>
            <div className="hud-body">
              <span className="hud-title">Ditempel ke kursor!</span>
              <span className="hud-preview" title={status.text}>
                {status.text ? `"${status.text}"` : 'Teks siap'}
              </span>
            </div>
          </>
        )}

        {/* ERROR STATE */}
        {state === 'error' && (
          <>
            <div className="hud-icon-wrap error">
              <AlertCircle className="hud-icon" size={20} />
            </div>
            <div className="hud-body">
              <span className="hud-title error">Terjadi Kendala</span>
              <span className="hud-error-msg">{status.error || 'Gagal memproses audio.'}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
