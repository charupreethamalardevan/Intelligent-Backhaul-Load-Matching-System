const mongoose = require('mongoose');

// ER-diagram weak entity: ADMIN_ACTIVITY_LOG -- an audit trail of admin
// actions, keyed by (adminId, loggedAt) (composite PK, same reduction
// rule as the other weak entities above). Populated whenever the existing
// admin dashboard approves/rejects a pending signup (fleet_owner/
// owner_driver) -- see routes/admin.js, which already performs that
// action and just needs one extra insert here. adminId is nullable
// because this app's current admin login (env-var username/password) is
// not itself a User/Admin row -- see Admin.js's own note -- so until that
// migrates, this logs 'env-admin' actions with adminId left null and the
// actor recorded in `actorLabel` instead.
const adminActivityLogSchema = new mongoose.Schema(
  {
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', default: null },
    actorLabel: { type: String, default: 'env-admin' },
    action: { type: String, required: true }, // e.g. 'approve_signup', 'reject_signup'
    targetType: { type: String, required: true }, // e.g. 'User'
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true },
    details: mongoose.Schema.Types.Mixed,
    loggedAt: { type: Date, default: Date.now }, // the weak entity's partial key
  },
  { timestamps: true },
);

adminActivityLogSchema.index({ adminId: 1, loggedAt: -1 });

module.exports = mongoose.models.AdminActivityLog || mongoose.model('AdminActivityLog', adminActivityLogSchema);
