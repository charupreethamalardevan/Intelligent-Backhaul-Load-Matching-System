const express = require('express');

const Vehicle = require('../models/Vehicle');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const OWNER_ROLES = ['fleet_owner', 'owner_driver'];

// A Fleet Driver has no vehicles of their own -- they drive their Fleet
// Owner's trucks. Everywhere we'd otherwise filter "vehicles I own", a
// driver instead sees "vehicles my Fleet Owner owns" (SRS: the driver
// role is an operating role, not an owning role).
async function scopeOwnerId(req) {
  if (req.user.role === 'driver') {
    const me = await User.findById(req.user.sub).select('fleetOwnerId');
    return me?.fleetOwnerId || null;
  }
  return req.user.sub;
}

function requireOwnerRole(req, res, next) {
  if (!OWNER_ROLES.includes(req.user.role)) {
    return res.status(403).json({ error: 'Only Fleet Owners and Individual Owners can manage vehicles.' });
  }
  next();
}

// Driver-vehicle assignment is a Fleet Owner privilege only -- an
// Individual Owner (owner_driver) drives their own vehicle and has no
// fleet of drivers to assign.
function requireFleetOwner(req, res, next) {
  if (req.user.role !== 'fleet_owner') {
    return res.status(403).json({ error: 'Only Fleet Owners can assign drivers to vehicles.' });
  }
  next();
}

// POST /api/vehicles -- register a new vehicle (SRS Section 6: vehicle profile).
router.post('/', requireOwnerRole, async (req, res) => {
  try {
    const { vehicleNumber, vehicleType, maxCapacityTonnes, fuelType, cargoCompatibility, driverName, driverPhone } = req.body;
    if (!vehicleNumber || !vehicleType || !maxCapacityTonnes) {
      return res.status(400).json({ error: 'vehicleNumber, vehicleType and maxCapacityTonnes are required.' });
    }
    const vehicle = await Vehicle.create({
      ownerId: req.user.sub,
      vehicleNumber,
      vehicleType,
      maxCapacityTonnes,
      fuelType,
      cargoCompatibility: Array.isArray(cargoCompatibility) ? cargoCompatibility : [],
      driverName,
      driverPhone,
    });
    res.status(201).json({ vehicle });
  } catch (err) {
    console.error('[vehicles/create]', err);
    res.status(500).json({ error: 'Could not register the vehicle. Please check the details and try again.' });
  }
});

// GET /api/vehicles -- "my fleet" (or, for a driver, "my Fleet Owner's fleet").
router.get('/', async (req, res) => {
  try {
    const ownerId = await scopeOwnerId(req);
    if (!ownerId) return res.json({ vehicles: [] });
    const vehicles = await Vehicle.find({ ownerId }).populate('assignedDriverId', 'name email phone').sort({ createdAt: -1 });
    res.json({ vehicles });
  } catch (err) {
    console.error('[vehicles/list]', err);
    res.status(500).json({ error: 'Could not load vehicles.' });
  }
});

// GET /api/vehicles/fleet-drivers -- this Fleet Owner's actual registered
// Driver accounts (not invite codes -- see routes/invites.js for those),
// each flagged with the vehicle they're currently assigned to (if any).
// This is what populates the "assign a driver to this vehicle" picker.
// Must be declared before GET /:id so Express doesn't treat
// "fleet-drivers" as an :id.
router.get('/fleet-drivers', requireFleetOwner, async (req, res) => {
  try {
    const drivers = await User.find({ role: 'driver', fleetOwnerId: req.user.sub })
      .select('name email phone')
      .sort({ name: 1 });
    const vehicles = await Vehicle.find({ ownerId: req.user.sub, assignedDriverId: { $ne: null } }).select('assignedDriverId vehicleNumber');
    const assignedVehicleByDriver = {};
    for (const v of vehicles) assignedVehicleByDriver[String(v.assignedDriverId)] = { id: v._id, vehicleNumber: v.vehicleNumber };

    res.json({
      drivers: drivers.map((d) => ({
        id: d._id,
        name: d.name,
        email: d.email,
        phone: d.phone,
        assignedVehicle: assignedVehicleByDriver[String(d._id)] || null,
      })),
    });
  } catch (err) {
    console.error('[vehicles/fleet-drivers]', err);
    res.status(500).json({ error: 'Could not load your drivers.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id).populate('assignedDriverId', 'name email phone');
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found.' });
    const ownerId = await scopeOwnerId(req);
    if (String(vehicle.ownerId) !== String(ownerId)) {
      return res.status(403).json({ error: 'You do not have access to this vehicle.' });
    }
    res.json({ vehicle });
  } catch (err) {
    console.error('[vehicles/get]', err);
    res.status(500).json({ error: 'Could not load the vehicle.' });
  }
});

// PATCH /api/vehicles/:id/assign-driver -- the only way assignedDriverId
// ever changes (SRS-evolution: only the Fleet Owner may assign/reassign a
// vehicle's driver). Body: { driverId } -- pass null/empty to unassign.
// Enforces one vehicle per driver: assigning a driver who already drives
// a different vehicle in this fleet un-assigns them from that one first.
router.patch('/:id/assign-driver', requireFleetOwner, async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found.' });
    if (String(vehicle.ownerId) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'You can only assign drivers to your own vehicles.' });
    }

    const { driverId } = req.body;
    if (!driverId) {
      vehicle.assignedDriverId = null;
      await vehicle.save();
      return res.json({ vehicle });
    }

    const driver = await User.findById(driverId);
    if (!driver || driver.role !== 'driver' || String(driver.fleetOwnerId) !== String(req.user.sub)) {
      return res.status(400).json({ error: 'That driver does not belong to your fleet.' });
    }

    await Vehicle.updateMany(
      { ownerId: req.user.sub, assignedDriverId: driver._id, _id: { $ne: vehicle._id } },
      { $set: { assignedDriverId: null } },
    );

    vehicle.assignedDriverId = driver._id;
    await vehicle.save();
    await vehicle.populate('assignedDriverId', 'name email phone');
    res.json({ vehicle });
  } catch (err) {
    console.error('[vehicles/assign-driver]', err);
    res.status(500).json({ error: 'Could not assign the driver to this vehicle.' });
  }
});

// PUT /api/vehicles/:id -- only the owning Fleet/Individual Owner can edit
// (a driver can view but not edit their Fleet Owner's vehicles).
router.put('/:id', requireOwnerRole, async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found.' });
    if (String(vehicle.ownerId) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'You can only edit your own vehicles.' });
    }
    const { vehicleType, maxCapacityTonnes, fuelType, cargoCompatibility, driverName, driverPhone, status } = req.body;
    if (vehicleType !== undefined) vehicle.vehicleType = vehicleType;
    if (maxCapacityTonnes !== undefined) vehicle.maxCapacityTonnes = maxCapacityTonnes;
    if (fuelType !== undefined) vehicle.fuelType = fuelType;
    if (cargoCompatibility !== undefined) vehicle.cargoCompatibility = cargoCompatibility;
    if (driverName !== undefined) vehicle.driverName = driverName;
    if (driverPhone !== undefined) vehicle.driverPhone = driverPhone;
    if (status !== undefined) vehicle.status = status;
    await vehicle.save();
    res.json({ vehicle });
  } catch (err) {
    console.error('[vehicles/update]', err);
    res.status(500).json({ error: 'Could not update the vehicle.' });
  }
});

router.delete('/:id', requireOwnerRole, async (req, res) => {
  try {
    const vehicle = await Vehicle.findById(req.params.id);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found.' });
    if (String(vehicle.ownerId) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'You can only remove your own vehicles.' });
    }
    await vehicle.deleteOne();
    res.json({ ok: true });
  } catch (err) {
    console.error('[vehicles/delete]', err);
    res.status(500).json({ error: 'Could not remove the vehicle.' });
  }
});

module.exports = router;
module.exports.scopeOwnerId = scopeOwnerId;
