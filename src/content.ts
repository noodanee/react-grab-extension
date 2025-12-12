const marker = 'data-react-grab-extension';
const root = document.documentElement;

if (root && !root.hasAttribute(marker)) {
  root.setAttribute(marker, 'true');
  const script = document.createElement('script');
  script.type = 'module';
  script.src = chrome.runtime.getURL('inject.js');
  script.dataset.source = 'react-grab-extension';
  script.onload = () => script.remove();
  script.onerror = () => root.removeAttribute(marker);
  root.append(script);
}
