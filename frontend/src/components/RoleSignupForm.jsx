import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiUpload } from '../lib/api.js';
import { ROLE_FORMS } from '../lib/roleForms.js';
import { IconEye, IconEyeOff, IconSpinner, IconUpload, IconFile } from './icons.jsx';
import '../pages/AuthShared.css';

// Polished drag-and-drop wrapper around the exact same `setFiles` setter
// used by the plain click-to-browse input before this round -- dropping a
// file or clicking to browse both land in the identical state, so none of
// handleSubmit's validation/upload logic below changes. Guidance text
// reflects the backend's real constraint (middleware/upload.js: 10MB/file,
// no server-side file-type filter) rather than inventing one.
function DocDropzone({ doc, file, onFile }) {
  const [isDragOver, setIsDragOver] = useState(false);
  const inputId = `signup-doc-${doc.name}`;

  function handleDrop(e) {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onFile(dropped);
  }

  return (
    <div className="ac-field">
      <label className="ac-field-label" htmlFor={inputId}>{doc.label}</label>
      <label
        className={`ac-dropzone ${isDragOver ? 'is-dragover' : ''} ${file ? 'has-file' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        <span className="ac-dropzone-icon">
          {file ? <IconFile size={18} /> : <IconUpload size={18} />}
        </span>
        <span className="ac-dropzone-text">
          <span className="ac-dropzone-label">{file ? file.name : 'Click to browse or drag a file here'}</span>
          <span className="ac-dropzone-hint">Up to 10MB</span>
        </span>
        <input
          id={inputId}
          type="file"
          required={!file}
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
      </label>
    </div>
  );
}

// The actual, working signup form for one leaf role card -- renders
// whatever fields/documents that role needs (from roleForms.js) and POSTs
// multipart/form-data to /api/auth/register. Premium redesign: refined
// `.ac-field`/`.ac-input`/`.ac-btn-primary` styling, a password
// visibility toggle, and the drop zone above -- all pure UI additions
// around the exact same `values`/`files`/handleSubmit logic as before.
export default function RoleSignupForm({ roleId }) {
  const config = ROLE_FORMS[roleId];
  const navigate = useNavigate();

  const [values, setValues] = useState({});
  const [files, setFiles] = useState({});
  const [showPassword, setShowPassword] = useState(false);
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
      <div className="ac-success ac-enter">
        <span className="ac-success-title">{success}</span>
        <span className="ac-success-sub">Taking you to log in...</span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {config.fields.map((f) => (
        <div className="ac-field" key={f.name}>
          <label className="ac-field-label" htmlFor={`signup-${f.name}`}>{f.label}</label>
          <div className="ac-input-wrap">
            <input
              id={`signup-${f.name}`}
              className="ac-input"
              required={f.required}
              value={values[f.name] || ''}
              onChange={(e) => setField(f.name, e.target.value)}
            />
          </div>
        </div>
      ))}
      <div className="ac-field">
        <label className="ac-field-label" htmlFor="signup-email">Email</label>
        <div className="ac-input-wrap">
          <input
            id="signup-email"
            className="ac-input"
            type="email"
            placeholder="you@example.com"
            required
            value={values.email || ''}
            onChange={(e) => setField('email', e.target.value)}
          />
        </div>
      </div>
      <div className="ac-field">
        <label className="ac-field-label" htmlFor="signup-password">Password</label>
        <div className="ac-input-wrap">
          <input
            id="signup-password"
            className="ac-input has-toggle"
            type={showPassword ? 'text' : 'password'}
            placeholder="Choose a password"
            required
            value={values.password || ''}
            onChange={(e) => setField('password', e.target.value)}
          />
          <button
            type="button"
            className="ac-input-toggle"
            onClick={() => setShowPassword((s) => !s)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            tabIndex={0}
          >
            {showPassword ? <IconEyeOff size={16} /> : <IconEye size={16} />}
          </button>
        </div>
      </div>

      {config.docs.map((d) => (
        <DocDropzone
          key={d.name}
          doc={d}
          file={files[d.name]}
          onFile={(file) => setFiles((fs) => ({ ...fs, [d.name]: file }))}
        />
      ))}

      {error && <p className="ac-error">{error}</p>}
      <button className="ac-btn-primary" type="submit" disabled={loading}>
        {loading && <IconSpinner size={15} className="ac-spin" />}
        {loading ? 'Creating account...' : 'Create account'}
      </button>
      <p style={{ fontSize: 12, color: 'var(--ink-muted)', margin: 0 }}>{config.note}</p>
    </form>
  );
}
