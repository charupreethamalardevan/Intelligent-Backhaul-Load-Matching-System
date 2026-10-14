// Drives RoleSignupForm.jsx -- one entry per leaf card in the signup
// carousel (SignupRoleSelect.jsx). backendRole must match a key in
// backend/utils/roles.js SUBTYPES exactly.
export const ROLE_FORMS = {
  business: {
    backendRole: 'business_poster',
    fields: [
      { name: 'name', label: 'Your name', required: true },
      { name: 'company_name', label: 'Company name', required: true },
      { name: 'business_type', label: 'Business type / category', required: true },
    ],
    docs: [],
    note: 'No document upload — you can log in right after signing up.',
  },
  individual: {
    backendRole: 'individual_poster',
    fields: [
      { name: 'name', label: 'Your name', required: true },
      { name: 'purpose', label: 'Purpose — why are you posting loads?', required: true },
    ],
    docs: [],
    note: 'Lightest signup — you can log in right after signing up.',
  },
  fleetOwner: {
    backendRole: 'fleet_owner',
    fields: [
      { name: 'name', label: 'Your name', required: true },
      { name: 'company_name', label: 'Company name', required: true },
    ],
    docs: [{ name: 'ownership_doc', label: 'Ownership / business document' }],
    note: 'Your account stays pending until an admin reviews your document.',
  },
  individualOwner: {
    backendRole: 'owner_driver',
    fields: [{ name: 'name', label: 'Your name', required: true }],
    docs: [{ name: 'license_doc', label: 'Your driving license' }],
    note: 'Your account stays pending until an admin reviews your license.',
  },
  fleetDriver: {
    backendRole: 'driver',
    fields: [
      { name: 'name', label: 'Your name', required: true },
      { name: 'invite_code', label: 'Invite code from your Fleet Owner', required: true },
    ],
    docs: [],
    note: 'No document upload here — your Fleet Owner already uploaded your license when they generated your invite code.',
  },
};
