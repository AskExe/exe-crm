import ReactDOM from 'react-dom/client';

import { App } from '@/app/components/App';
import 'react-loading-skeleton/dist/skeleton.css';
import 'twenty-ui/style.css';
import 'twenty-ui/theme-light.css';
import 'twenty-ui/theme-dark.css';
import './index.css';

const root = ReactDOM.createRoot(
  document.getElementById('root') ?? document.body,
);

root.render(<App />);

// Remove the dark preloader overlay after React hydrates
const preloader = document.getElementById('preloader');
if (preloader) {
  preloader.style.opacity = '0';
  setTimeout(() => preloader.remove(), 300);
}
