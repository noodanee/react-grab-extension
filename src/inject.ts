import { init } from 'react-grab/core';

type GrabWindow = typeof window & {
  __reactGrabExtensionActive__?: boolean;
};

const grabWindow = window as GrabWindow;

if (!grabWindow.__reactGrabExtensionActive__) {
  grabWindow.__reactGrabExtensionActive__ = true;

  const start = () => {
    try {
      init();
    } catch (error) {
      grabWindow.__reactGrabExtensionActive__ = false;
      console.error('react-grab injection failed', error);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
}
