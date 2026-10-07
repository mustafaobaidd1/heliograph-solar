import { ArrowLeftIcon, ExternalIcon } from './icons';

export const PORTFOLIO_URL = 'https://mustafaobaidd1.github.io/';
export const SOURCE_URL = 'https://github.com/mustafaobaidd1/heliograph-solar';

export function Masthead() {
  return (
    <header className="masthead">
      <a className="masthead__back" href={PORTFOLIO_URL}>
        <ArrowLeftIcon /> Mustafa Obaid · Portfolio
      </a>
      <div className="masthead__title">
        <svg className="masthead__mark" viewBox="0 0 32 32" aria-hidden="true">
          <path d="M3 24 Q16 0 29 24" />
          <circle cx="21.5" cy="11" r="4" />
          <path d="M2 26h28" />
        </svg>
        <div>
          <h1>Heliograph</h1>
          <p>Sun path &amp; solar panel planner</p>
        </div>
      </div>
      <nav className="masthead__nav" aria-label="Project">
        <a href="#how-it-works">How it works</a>
        <a href={SOURCE_URL}>
          Source code <ExternalIcon />
        </a>
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <p className="footer__brand">
          <strong>Heliograph</strong> — a planning calculator. Clear-sky figures are an upper bound,
          not a yield guarantee.
        </p>
        <p className="footer__credits">
          Sun position after NOAA GML / Meeus · Clear sky: simplified Solis (Ineichen 2008) ·
          Diffuse: Perez 1990, Hay–Davies 1980 · Climate normals: NASA POWER (LaRC) · Map: Natural
          Earth via world-atlas · Type: Instrument Serif &amp; Instrument Sans (OFL).
        </p>
        <nav className="footer__links" aria-label="Elsewhere">
          <a href={PORTFOLIO_URL}>
            <ArrowLeftIcon /> Mustafa Obaid · Portfolio
          </a>
          <a href={SOURCE_URL}>
            Source code <ExternalIcon />
          </a>
        </nav>
      </div>
    </footer>
  );
}
