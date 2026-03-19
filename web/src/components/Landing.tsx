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
          Map health data <br/>
          <span className="text-gradient">seamlessly.</span>
        </h1>
        <p className="landing-subtitle">
          Intelligent parsing, hosting, and mapping for your clinical data. <br/>All in one unified platform.
        </p>
        
        <div className="landing-actions">
          <button className="btn-primary" onClick={() => navigate('/dashboard')}>
            Get Started
          </button>
          <button className="btn-secondary" onClick={() => navigate('/dashboard')}>
            Learn more
          </button>
        </div>
      </main>
    </div>
  );
}
