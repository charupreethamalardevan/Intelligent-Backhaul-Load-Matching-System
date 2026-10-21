import './dataViews.css';

// Generic reusable data table. columns: [{ key, header, render?(row), align? }],
// rows: plain data objects, rowKey(row): unique key fn. Purely
// presentational -- no data fetching, no filtering, no business logic --
// so it can be reused across Vehicles / Trips / Drivers / Requests without
// knowing anything about what any of them mean. Callers own search,
// filtering, and row actions; this just lays the result out as a table.
//
// `onRowClick(row)` / `isRowClickable(row)` (both optional) let a caller
// make specific rows navigate somewhere -- e.g. TripsTab uses this so a
// trip with a live booking jumps straight to Current Trip when clicked.
// Only rows `isRowClickable` approves (or every row, if that prop is
// omitted while `onRowClick` is given) get the pointer cursor and the
// click handler -- a row nothing would happen for never looks clickable.
export default function DataTable({ columns, rows, rowKey, emptyText = 'Nothing here yet.', onRowClick, isRowClickable }) {
  if (!rows || rows.length === 0) {
    return <div className="dv-empty">{emptyText}</div>;
  }
  return (
    <div className="dv-table-wrap">
      <table className="dv-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={c.align === 'right' ? { textAlign: 'right' } : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const clickable = !!onRowClick && (!isRowClickable || isRowClickable(row));
            return (
              <tr
                key={rowKey(row)}
                className={clickable ? 'dv-table-row-clickable' : undefined}
                onClick={clickable ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} style={c.align === 'right' ? { textAlign: 'right' } : undefined}>
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
