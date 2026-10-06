import { invoke } from '@tauri-apps/api/core';

export function termLog(message: string, level: 'log' | 'info' | 'warn' | 'error' = 'log') {
  const ts = new Date().toISOString().split('T')[1].replace('Z', '');
  const formatted = `[${ts}] ${message}`;

  if (level === 'error') {
    console.error(formatted);
  } else if (level === 'warn') {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }

  try {
    invoke('log_to_terminal', { level, message: formatted });
  } catch {
    // fallback if not in Tauri context
  }
}
