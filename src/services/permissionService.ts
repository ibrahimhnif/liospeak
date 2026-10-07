import { invoke } from '@tauri-apps/api/core';

export type PermissionKind = 'accessibility' | 'inputMonitoring';
export type PermissionPane = 'Accessibility' | 'ListenEvent' | 'Microphone' | 'ScreenCapture';

export interface NativePermissionReport {
  platform: string;
  accessibility: boolean;
  inputMonitoring: boolean;
}

export interface PermissionStatus extends NativePermissionReport {
  microphone: boolean;
}

export async function checkNativePermissions(): Promise<NativePermissionReport> {
  return invoke<NativePermissionReport>('check_permissions');
}

export async function requestPermission(kind: PermissionKind): Promise<boolean> {
  if (kind === 'accessibility') {
    return invoke<boolean>('request_accessibility_permission');
  }
  return invoke<boolean>('request_input_monitoring_permission');
}

export async function openPermissionSettings(pane: PermissionPane): Promise<void> {
  await invoke('open_permissions_settings', { pane });
}

export async function restartApp(): Promise<void> {
  await invoke('restart_app');
}

/**
 * Determines whether the microphone is already usable.
 * Prefers the Permissions API (never prompts); falls back to a one-shot
 * getUserMedia probe whose own tracks are stopped immediately so it does not
 * interfere with the recorder's pre-warmed stream.
 */
export async function checkMicrophonePermission(): Promise<boolean> {
  try {
    const perms = navigator.permissions;
    if (perms?.query) {
      const result = await perms.query({ name: 'microphone' as PermissionName });
      if (result.state === 'granted') return true;
      if (result.state === 'denied') return false;
    }
  } catch {
    // 'microphone' descriptor unsupported in this WebView -> fall through to probe.
  }

  try {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch {
    return false;
  }
}
