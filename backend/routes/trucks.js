const express = require('express');

const Truck = require('../models/Truck');
const TruckOwner = require('../models/TruckOwner');
const Driver = require('../models/Driver');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { dimensionsFromVehicleType } = require('../utils/truckTypeMapping');

// ER-diagram migration (full normalization, per the user's explicit
// choice): this file REPLACES the old routes/vehicles.js. The collection
// behind it is now `trucks` (the ER diagram's TRUCK entity, model in
// models/Truck.js), not `vehicles` -- that's the actual, durable change a
// mentor inspecting MongoDB Compass will see. The URL path
// (app.use('/api/vehicles', ...) in server.js) and every JSON field name
// in the responses below are DELIBERATELY left exactly as routes/vehicles.js
// used to return them (ownerId, vehicleType, maxCapacityTonnes, ...) so the
// existing frontend (lib/vehicleApi.js, FleetDashboard.jsx's VehiclesTab,
// and everything downstream that reads a populated vehicleId) keeps working
// completely unmodified -- the schema migration happens underneath a
// stable API contract, per Development Rule 15 ("preserve existing working
// functionality").
const router = express.Router();
router.use(requireAuth);

const OWNER_ROLES = ['fleet_owner', 'owner_driver'];

// A Fleet Driver has no trucks of their own -- they drive their Fleet
// Owner's trucks. Resolves to the TruckOwner._id (== that owner's
// users._id) that owns whatever the caller should see.
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

function requireFleetOwner(req, res, next) {
  if (req.user.role !== 'fleet_owner') {
    return res.status(403).json({ error: 'Only Fleet Owners can assign drivers to vehicles.' });
  }
  next();
}

// Shapes a Truck document into the exact JSON field names the old Vehicle
// collection used to return, so nothing downstream has to change.
function toLegacyVehicleShape(truck) {
  const obj = truck.toObject ? truck.toObject() : truck;
  return {
    _id: obj._id,
    ownerId: obj.truckOwnerId,
    vehicleNumber: obj.vehicleNumber,
    vehicleType: obj.vehicleType,
    capacityClass: obj.capacityClass,
    bodyType: obj.bodyType,
    maxCapacityTonnes: obj.maxCapacityTonnes,
    fuelType: obj.fuelType,
    cargoCompatibility: obj.cargoCompatibility,
    driverName: obj.driverName,
    driverPhone: obj.driverPhone,
    assignedDriverId: obj.assignedDriverId,
    status: obj.status,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt,
  };
}

// POST /api/vehicles -- register a new truck (SRS Section 6).
router.post('/', requireOwnerRole, async (req, res) => {
  try {
    // An Individual Owner (owner_driver) drives one truck -- enforced
    // server-side, not just hidden/disabled in the UI.
    if (req.user.role === 'owner_driver') {
      const existingCount = await Truck.countDocuments({ truckOwnerId: req.user.sub });
      if (existingCount >= 1) {
        return res.status(409).json({ error: 'An Individual Owner account can register only one vehicle. Edit or remove your existing vehicle to replace it.' });
      }
    }
    const { vehicleNumber, vehicleType, maxCapacityTonnes, fuelType, cargoCompatibility, driverName, driverPhone } = req.body;
    if (!vehicleNumber || !vehicleType || !maxCapacityTonnes) {
      return res.status(400).json({ error: 'vehicleNumber, vehicleType and maxCapacityTonnes are required.' });
    }
    const { capacityClass, bodyType } = dimensionsFromVehicleType(vehicleType);
    const truck = await Truck.create({
      truckOwnerId: req.user.sub,
      vehicleNumber,
      vehicleType,
      capacityClass,
      bodyType,
      maxCapacityTonnes,
      fuelType,
      cargoCompatibility: Array.isArray(cargoCompatibility) ? cargoCompatibility : [],
      driverName,
      driverPhone,
    });
    await TruckOwner.findByIdAndUpdate(req.user.sub, { $inc: { fleetSize: 1 } });
    res.status(201).json({ vehicle: toLegacyVehicleShape(truck) });
  } catch (err) {
    console.error('[trucks/create]', err);
    res.status(500).json({ error: 'Could not register the vehicle. Please check the details and try again.' });
  }
});

// GET /api/vehicles -- "my fleet" (or, for a driver, "my Fleet Owner's fleet").
router.get('/', async (req, res) => {
  try {
    const ownerId = await scopeOwnerId(req);
    if (!ownerId) return res.json({ vehicles: [] });
    const trucks = await Truck.find({ truckOwnerId: ownerId }).populate('assignedDriverId', 'name email phone').sort({ createdAt: -1 });
    res.json({ vehicles: trucks.map(toLegacyVehicleShape).map((v, i) => ({ ...v, assignedDriverId: trucks[i].assignedDriverId })) });
  } catch (err) {
    console.error('[trucks/list]', err);
    res.status(500).json({ error: 'Could not load vehicles.' });
  }
});

// GET /api/vehicles/fleet-drivers -- this Fleet Owner's registered Driver
// accounts, each flagged with the truck they're currently assigned to.
router.get('/fleet-drivers', requireFleetOwner, async (req, res) => {
  try {
    const drivers = await User.find({ role: 'driver', fleetOwnerId: req.user.sub })
      .select('name email phone')
      .sort({ name: 1 });
    const trucks = await Truck.find({ truckOwnerId: req.user.sub, assignedDriverId: { $ne: null } }).select('assignedDriverId vehicleNumber');
    const assignedVehicleByDriver = {};
    for (const v of trucks) assignedVehicleByDriver[String(v.assignedDriverId)] = { id: v._id, vehicleNumber: v.vehicleNumber };

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
    console.error('[trucks/fleet-drivers]', err);
    res.status(500).json({ error: 'Could not load your drivers.' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const truck = await Truck.findById(req.params.id).populate('assignedDriverId', 'name email phone');
    if (!truck) return res.status(404).json({ error: 'Vehicle not found.' });
    const ownerId = await scopeOwnerId(req);
    if (String(truck.truckOwnerId) !== String(ownerId)) {
      return res.status(403).json({ error: 'You do not have access to this vehicle.' });
    }
    res.json({ vehicle: { ...toLegacyVehicleShape(truck), assignedDriverId: truck.assignedDriverId } });
  } catch (err) {
    console.error('[trucks/get]', err);
    res.status(500).json({ error: 'Could not load the vehicle.' });
  }
});

// PATCH /api/vehicles/:id/assign-driver -- Fleet Owner only.
router.patch('/:id/assign-driver', requireFleetOwner, async (req, res) => {
  try {
    const truck = await Truck.findById(req.params.id);
    if (!truck) return res.status(404).json({ error: 'Vehicle not found.' });
    if (String(truck.truckOwnerId) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'You can only assign drivers to your own vehicles.' });
    }

    const { driverId } = req.body;
    if (!driverId) {
      truck.assignedDriverId = null;
      await truck.save();
      return res.json({ vehicle: toLegacyVehicleShape(truck) });
    }

    const driver = await User.findById(driverId);
    if (!driver || driver.role !== 'driver' || String(driver.fleetOwnerId) !== String(req.user.sub)) {
      return res.status(400).json({ error: 'That driver does not belong to your fleet.' });
    }

    await Truck.updateMany(
      { truckOwnerId: req.user.sub, assignedDriverId: driver._id, _id: { $ne: truck._id } },
      { $set: { assignedDriverId: null } },
    );

    truck.assignedDriverId = driver._id;
    await truck.save();
    await truck.populate('assignedDriverId', 'name email phone');
    res.json({ vehicle: { ...toLegacyVehicleShape(truck), assignedDriverId: truck.assignedDriverId } });
  } catch (err) {
    console.error('[trucks/assign-driver]', err);
    res.status(500).json({ error: 'Could not assign the driver to this vehicle.' });
  }
});

// PUT /api/vehicles/:id -- owning Fleet/Individual Owner only.
router.put('/:id', requireOwnerRole, async (req, res) => {
  try {
    const truck = await Truck.findById(req.params.id);
    if (!truck) return res.status(404).json({ error: 'Vehicle not found.' });
    if (String(truck.truckOwnerId) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'You can only edit your own vehicles.' });
    }
    const { vehicleType, maxCapacityTonnes, fuelType, cargoCompatibility, driverName, driverPhone, status } = req.body;
    if (vehicleType !== undefined) {
      truck.vehicleType = vehicleType;
      const { capacityClass, bodyType } = dimensionsFromVehicleType(vehicleType);
      truck.capacityClass = capacityClass;
      truck.bodyType = bodyType;
    }
    if (maxCapacityTonnes !== undefined) truck.maxCapacityTonnes = maxCapacityTonnes;
    if (fuelType !== undefined) truck.fuelType = fuelType;
    if (cargoCompatibility !== undefined) truck.cargoCompatibility = cargoCompatibility;
    if (driverName !== undefined) truck.driverName = driverName;
    if (driverPhone !== undefined) truck.driverPhone = driverPhone;
    if (status !== undefined) truck.status = status;
    await truck.save();
    res.json({ vehicle: toLegacyVehicleShape(truck) });
  } catch (err) {
    console.error('[trucks/update]', err);
    res.status(500).json({ error: 'Could not update the vehicle.' });
  }
});

router.delete('/:id', requireOwnerRole, async (req, res) => {
  try {
    const truck = await Truck.findById(req.params.id);
    if (!truck) return res.status(404).json({ error: 'Vehicle not found.' });
    if (String(truck.truckOwnerId) !== String(req.user.sub)) {
      return res.status(403).json({ error: 'You can only remove your own vehicles.' });
    }
    await truck.deleteOne();
    await TruckOwner.findByIdAndUpdate(truck.truckOwnerId, { $inc: { fleetSize: -1 } });
    res.json({ ok: true });
  } catch (err) {
    console.error('[trucks/delete]', err);
    res.status(500).json({ error: 'Could not remove the vehicle.' });
  }
});

module.exports = router;
module.exports.scopeOwnerId = scopeOwnerId;
