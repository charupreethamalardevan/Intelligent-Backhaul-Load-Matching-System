import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUpload } from '../lib/api.js';
import { ROLE_FORMS } from '../lib/roleForms.js';

// The actual, working signup form for one leaf role card -- renders
// whatever fields/documents that role needs (from roleForms.js) and POSTs
// multipart/form-data to /api/auth/register.
export default function RoleSignupForm({ roleId }) {
  const config = ROLE_FORMS[roleId];
  const navigate = useNavigate();

  const [values, setValues] = useState({});
  const [files, setFiles] = useState({});
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [loading, setLoading] = useState(false);

  function setField(name, value) {
    setValues((v) => ({ ...v, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    const missingDocs = config.docs.filter((d) => !files[d.name]);
    if (missingDocs.length) {
      setError(`Please attach: ${missingDocs.map((d) => d.label).join(', ')}`);
      return;
    }

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('role', config.backendRole);
      fd.append('email', values.email || '');
      fd.append('password', values.password || '');
      config.fields.forEach((f) => fd.append(f.name, values[f.name] || ''));
      config.docs.forEach((d) => fd.append(d.name, files[d.name]));

      const data = await apiUpload('/auth/register', fd);
      setSuccess(data.message);
      setTimeout(() => navigate('/login'), 1800);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div>
        <p style={{ color: 'var(--primary)', fontWeight: 700 }}>{success}</p>
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>Taking you to log in...</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {config.fields.map((f) => (
        <div className="field" key={f.name}>
          <label className="field-label" htmlFor={`signup-${f.name}`}>{f.label}</label>
          <input
            id={`signup-${f.name}`}
            className="input"
            required={f.required}
            value={values[f.name] || ''}
            onChange={(e) => setField(f.name, e.target.value)}
          />
        </div>
      ))}
      <div className="field">
        <label className="field-label" htmlFor="signup-email">Email</label>
        <input
          id="signup-email"
          className="input"
          type="email"
          placeholder="you@example.com"
          required
          value={values.email || ''}
          onChange={(e) => setField('email', e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="signup-password">Password</label>
        <input
          id="signup-password"
          className="input"
          type="password"
          placeholder="Choose a password"
          required
          value={values.password || ''}
          onChange={(e) => setField('password', e.target.value)}
        />
      </div>

      {config.docs.map((d) => (
        <div className="field" key={d.name}>
          <label className="field-label" htmlFor={`signup-doc-${d.name}`}>{d.label}</label>
          <input
            id={`signup-doc-${d.name}`}
            type="file"
            required
            onChange={(e) => setFiles((fs) => ({ ...fs, [d.name]: e.target.files[0] }))}
          />
        </div>
      ))}

      {error && <p style={{ color: '#DC2626', fontSize: 13 }}>{error}</p>}
      <button className="btn btn-primary" type="submit" disabled={loading}>
        {loading ? 'Creating account...' : 'Create account'}
      </button>
      <p style={{ fontSize: 12, color: 'var(--muted)' }}>{config.note}</p>
    </form>
  );
}
