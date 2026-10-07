import {
  Accessibility,
  Check,
  ExternalLink,
  Mic,
  MousePointerClick,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import type { PermissionKind, PermissionPane, PermissionStatus } from '../services/permissionService';

interface PermissionRow {
  key: 'accessibility' | 'inputMonitoring' | 'microphone';
  icon: React.ReactNode;
  title: string;
  description: string;
  granted: boolean;
  pane: PermissionPane;
  needsRestart: boolean;
  onGrant: () => void;
}

interface PermissionGateProps {
  status: PermissionStatus;
  micBusy: boolean;
  onRequest: (kind: PermissionKind) => void;
  onRequestMicrophone: () => void;
  onOpenSettings: (pane: PermissionPane) => void;
  onRecheck: () => void;
  onRestart: () => void;
}

export const PermissionGate: React.FC<PermissionGateProps> = ({
  status,
  micBusy,
  onRequest,
  onRequestMicrophone,
  onOpenSettings,
  onRecheck,
  onRestart,
}) => {
  const rows: PermissionRow[] = [
    {
      key: 'accessibility',
      icon: <Accessibility size={18} />,
      title: 'Accessibility',
      description: 'Menempelkan hasil dikte (⌘V) ke aplikasi aktif dan mendeteksi kolom teks.',
      granted: status.accessibility,
      pane: 'Accessibility',
      needsRestart: false,
      onGrant: () => onRequest('accessibility'),
    },
    {
      key: 'inputMonitoring',
      icon: <MousePointerClick size={18} />,
      title: 'Input Monitoring',
      description: 'Mendeteksi tombol Fn / Globe dari aplikasi lain.',
      granted: status.inputMonitoring,
      pane: 'ListenEvent',
      needsRestart: true,
      onGrant: () => onRequest('inputMonitoring'),
    },
    {
      key: 'microphone',
      icon: <Mic size={18} />,
      title: 'Microphone',
      description: 'Merekam suara kamu saat mendikte.',
      granted: status.microphone,
      pane: 'Microphone',
      needsRestart: false,
      onGrant: onRequestMicrophone,
    },
  ];

  const remaining = rows.filter((r) => !r.granted).length;

  return (
    <div className="permission-gate-backdrop">
      <div className="permission-gate">
        <div className="permission-gate-header">
          <div className="permission-gate-icon">
            <ShieldCheck size={22} />
          </div>
          <div>
            <h2>Izinkan LioSpeak Bekerja Maksimal</h2>
            <p>
              LioSpeak butuh beberapa izin macOS agar dikte suara langsung bekerja begitu aplikasi
              berjalan. {remaining > 0 ? `${remaining} izin belum aktif.` : 'Semua izin sudah aktif!'}
            </p>
          </div>
        </div>

        <div className="perm-list">
          {rows.map((row) => (
            <div className="perm-row" key={row.key}>
              <div className={`perm-row-icon ${row.granted ? 'granted' : 'missing'}`}>
                {row.granted ? <Check size={18} /> : row.icon}
              </div>

              <div className="perm-row-body">
                <div className="perm-row-title">
                  <span>{row.title}</span>
                  <span className={`perm-pill ${row.granted ? 'granted' : 'missing'}`}>
                    {row.granted ? 'Aktif' : 'Belum'}
                  </span>
                </div>
                <p>{row.description}</p>
                {!row.granted && row.needsRestart && (
                  <p className="perm-row-hint">
                    Setelah diaktifkan, muat ulang LioSpeak agar berlaku.
                  </p>
                )}
              </div>

              <div className="perm-row-actions">
                {row.granted ? (
                  <span className="perm-ok">
                    <Check size={14} /> Siap
                  </span>
                ) : (
                  <>
                    <button
                      className="btn-secondary"
                      onClick={row.onGrant}
                      disabled={row.key === 'microphone' && micBusy}
                    >
                      {row.key === 'microphone' && micBusy ? 'Meminta…' : 'Berikan Izin'}
                    </button>
                    <button className="btn-link" onClick={() => onOpenSettings(row.pane)}>
                      Buka System Settings <ExternalLink size={11} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="permission-gate-footer">
          <span className="permission-gate-note">
            <TriangleAlert size={13} /> Jika dialog izin tidak muncul, pakai tombol &ldquo;Buka System
            Settings&rdquo;.
          </span>
          <div className="permission-gate-buttons">
            <button className="btn-secondary" onClick={onRestart}>
              <RotateCw size={14} /> Muat Ulang
            </button>
            <button className="btn-secondary" onClick={onRecheck}>
              <RefreshCw size={14} /> Cek Ulang
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
