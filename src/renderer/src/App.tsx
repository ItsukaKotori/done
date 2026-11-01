import QuickAddView from './views/QuickAddView';
import MainShell from './views/MainShell';
import StripView from './views/StripView';

export default function App() {
  const win = new URLSearchParams(window.location.search).get('win');
  if (win === 'quickadd') return <QuickAddView />;
  if (win === 'strip') return <StripView />;
  return <MainShell />;
}
