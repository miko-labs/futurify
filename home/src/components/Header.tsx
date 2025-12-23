import { ConnectButton } from '@rainbow-me/rainbowkit';
import '../styles/Header.css';

export function Header() {
  return (
    <header className="header">
      <div className="header-container">
        <div className="header-content">
          <div className="brand">
            <div className="brand-mark">F</div>
            <div>
              <p className="brand-title">Futurify</p>
              <p className="brand-subtitle">Encrypted predictions with transparent outcomes</p>
            </div>
          </div>
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
