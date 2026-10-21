// The 5 real signup roles, grouped under the 2 carousel categories on the
// frontend (Post a Load -> business_poster/individual_poster; Move a Load
// -> fleet_owner/owner_driver/driver). SUBTYPES drives what auth.js
// requires at registration for each one.
const ROLE_IDS = ['business_poster', 'individual_poster', 'fleet_owner', 'owner_driver', 'driver'];

const SUBTYPES = {
  business_poster: {
    label: 'Business Poster',
    fields: ['name', 'company_name', 'business_type'],
    docs: [],
    requiresApproval: false,
  },
  individual_poster: {
    label: 'Individual Poster',
    fields: ['name', 'purpose'],
    docs: [],
    requiresApproval: false,
  },
  fleet_owner: {
    label: 'Fleet Owner',
    fields: ['name', 'company_name'],
    docs: ['ownership_doc'],
    // Was true -- admin approval is no longer required before login. The
    // document is still uploaded and still reviewable in the admin
    // Documents tab, it just no longer blocks the account from logging in.
    requiresApproval: false,
  },
  owner_driver: {
    label: 'Individual Owner',
    fields: ['name'],
    docs: ['license_doc'],
    // Was true -- same change as fleet_owner above.
    requiresApproval: false,
  },
  driver: {
    label: 'Fleet Driver',
    fields: ['name', 'invite_code'],
    // No document here on purpose -- the Fleet Owner already uploaded this
    // driver's license when they generated the invite code (see
    // routes/invites.js). The driver just redeems the code.
    docs: [],
    requiresApproval: false,
  },
};

module.exports = { ROLE_IDS, SUBTYPES };
