import { useEffect, useState } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { SettingsView } from './components/SettingsView';
import { FloatingHUD } from './components/FloatingHUD';
import './App.css';

export function App() {
  const [isOverlay] = useState<boolean>(() => {
    try {
      const current = getCurrentWebviewWindow();
      if (current && current.label === 'overlay') {
        return true;
      }
    } catch {
      // Running in browser or test
    }
    return typeof window !== 'undefined' && window.location.hash.includes('overlay');
  });

  useEffect(() => {
    if (isOverlay) {
      document.documentElement.style.background = 'transparent';
      document.body.style.background = 'transparent';
      document.body.classList.add('is-overlay');
    }
  }, [isOverlay]);

  if (isOverlay) {
    return <FloatingHUD />;
  }

  return <SettingsView />;
}

export default App;
