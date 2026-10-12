import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/themes.css';
import './styles/duel.css';
import './styles/app.css';
import './styles/pages.css';
import { App } from './App.tsx';
import { SessionProvider } from './lib/session.tsx';

createRoot(document.getElementById('root')!).render(<StrictMode><SessionProvider><App /></SessionProvider></StrictMode>);
