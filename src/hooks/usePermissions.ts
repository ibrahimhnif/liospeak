import { useCallback, useEffect, useState } from 'react';
import {
  checkMicrophonePermission,
  checkNativePermissions,
  openPermissionSettings,
  requestPermission,
  restartApp,
  type PermissionKind,
  type PermissionPane,
  type PermissionStatus,
} from '../services/permissionService';

const INITIAL_STATUS: PermissionStatus = {
  platform: 'unknown',
  accessibility: false,
  inputMonitoring: false,
  microphone: false,
};

export interface UsePermissionsResult {
  status: PermissionStatus;
  isMac: boolean;
  allGranted: boolean;
  loading: boolean;
  micBusy: boolean;
  request: (kind: PermissionKind) => Promise<void>;
  requestMicrophone: () => Promise<void>;
  openSettings: (pane: PermissionPane) => void;
  restart: () => void;
  refresh: () => Promise<void>;
}

export function usePermissions(): UsePermissionsResult {
  const [status, setStatus] = useState<PermissionStatus>(INITIAL_STATUS);
  const [loading, setLoading] = useState(true);
  const [micBusy, setMicBusy] = useState(false);

  const refreshNative = useCallback(async () => {
    try {
      const native = await checkNativePermissions();
      setStatus((prev) => ({ ...prev, ...native }));
    } catch {
      // Native bridge unavailable (e.g. running in a plain browser) - leave as-is.
    }
  }, []);

  const refreshMic = useCallback(async () => {
    const microphone = await checkMicrophonePermission();
    setStatus((prev) => (prev.microphone === microphone ? prev : { ...prev, microphone }));
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([refreshNative(), refreshMic()]);
    setLoading(false);
  }, [refreshNative, refreshMic]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll native status only while something is missing. This is a cheap IPC call
  // that never triggers a permission prompt, so it is safe to run frequently.
  const allGranted = status.accessibility && status.inputMonitoring && status.microphone;
  useEffect(() => {
    if (allGranted) return;
    const id = window.setInterval(refreshNative, 1200);
    return () => window.clearInterval(id);
  }, [allGranted, refreshNative]);

  // Re-check everything when the window regains focus: the user may have just
  // toggled a permission in System Settings and come back.
  useEffect(() => {
    const onFocus = () => {
      refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const request = useCallback(
    async (kind: PermissionKind) => {
      try {
        await requestPermission(kind);
      } catch {
        // ignore - status polling reflects the real result
      } finally {
        await refreshNative();
      }
    },
    [refreshNative]
  );

  const requestMicrophone = useCallback(async () => {
    setMicBusy(true);
    try {
      await refreshMic();
    } finally {
      setMicBusy(false);
    }
  }, [refreshMic]);

  const openSettings = useCallback((pane: PermissionPane) => {
    openPermissionSettings(pane).catch(() => {});
  }, []);

  const restart = useCallback(() => {
    restartApp().catch(() => {});
  }, []);

  return {
    status,
    isMac: status.platform === 'macos',
    allGranted,
    loading,
    micBusy,
    request,
    requestMicrophone,
    openSettings,
    restart,
    refresh,
  };
}
