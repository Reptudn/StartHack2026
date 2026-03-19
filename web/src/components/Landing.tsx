import { useNavigate } from 'react-router-dom';
import { Activity } from 'lucide-react';
import './Landing.css';

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="landing-container">
      <div className="landing-glow glow-teal" />
      <div className="landing-glow glow-blue" />

      <nav className="landing-nav">
        <div className="landing-logo">
          <Activity className="logo-icon" size={24} color="#2dd4bf" />
          <span className="logo-text">HealthMap</span>
        </div>
      </nav>

      <main className="landing-main">
        <h1 className="landing-title">
          Map health data <br />
          <span className="text-gradient">seamlessly.</span>
        </h1>
        <p className="landing-subtitle">
          Intelligent parsing, hosting, and mapping for your clinical data. <br />All in one unified platform.
        </p>

        <div className="landing-actions">
          <button className="btn-primary" onClick={() => navigate('/dashboard')}>
            Test Demo
          </button>
          <button className="btn-secondary" onClick={() => {
            document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' });
          }}>
            Learn more
          </button>
        </div>
      </main>

      <section id="how-it-works" className="how-it-works-section">
        <h2 className="section-title">How Data is Processed</h2>
        <div className="steps-container">
          <div className="step-card">
            <div className="step-number text-accent">Step 1</div>
            <h3>Extract</h3>
            <p>Parse raw files (CSV, TSV, XLSX, PDF) into a unified system table.</p>
          </div>
          <div className="step-card">
            <div className="step-number text-accent">Step 2</div>
            <h3>Inspect</h3>
            <p>Filter data and create a lightweight AI-ready fingerprint.</p>
          </div>
          <div className="step-card">
            <div className="step-number text-accent">Step 3</div>
            <h3>Classify (Agent 1)</h3>
            <p>AI automatically decides which structure/table the file belongs to.</p>
          </div>
          <div className="step-card">
            <div className="step-number text-accent">Step 4</div>
            <h3>Map (Agent 2)</h3>
            <p>AI accurately maps each file column to your target database column.</p>
          </div>
          <div className="step-card">
            <div className="step-number text-accent">Step 5</div>
            <h3>Import</h3>
            <p>Normalize and insert the mapped data into PostgreSQL.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
