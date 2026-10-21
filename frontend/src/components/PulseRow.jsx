import './dataViews.css';

// Compact, information-dense stat row -- replaces the old 4-up StatCard
// grid for the Fleet Overview. `tiles`: [{ key, label, value, valueSuffix?,
// delta?, tone? }]. Every value is computed by the caller from app data
// already fetched elsewhere on the page (vehicles/trips/drivers/requests);
// this component only lays them out, it fetches and computes nothing.
export default function PulseRow({ tiles }) {
  return (
    <div className="dv-pulse-row dv-section-gap">
      {tiles.map((tile) => (
        <div className="dv-pulse-tile" key={tile.key}>
          <div className="dv-pulse-label">{tile.label}</div>
          <div className="dv-pulse-value">
            {tile.value}
            {tile.valueSuffix && <small> {tile.valueSuffix}</small>}
          </div>
          {tile.delta && <div className={`dv-pulse-delta ${tile.tone || ''}`}>{tile.delta}</div>}
        </div>
      ))}
    </div>
  );
}
