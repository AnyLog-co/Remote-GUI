import React from 'react';
import './UNSPage.css';

const UNSSidePanel = ({
  isOpen,
  selectedItem,
  sqlData,
  sqlLoading,
  sqlError,
  sqlTab,
  timeRangeValue,
  timeRangeUnit,
  customSqlQuery,
  onClose,
  onTimeRangeValueChange,
  onTimeRangeUnitChange,
  onFetchTimeRange,
  onTabChange,
  onCustomQueryChange,
  onExecuteCustomQuery,
  getItemName,
  getItemType,
  getItemId,
  getItemData,
  renderSqlLineChart,
}) => {
  const itemData = selectedItem ? getItemData(selectedItem) : null;
  const hasTable = itemData && itemData.dbms && itemData.table;

  return (
    <div className={`uns-side-panel ${isOpen ? 'open' : ''}`}>
      <div className="uns-side-panel-header">
        <h3>Item Details</h3>
        <button
          className="uns-side-panel-close"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="uns-side-panel-content">
        {selectedItem && itemData && (
          <>
            <div className="uns-side-panel-info">
              <div className="uns-side-panel-info-row">
                <strong>Name:</strong> {getItemName(selectedItem)}
              </div>
              <div className="uns-side-panel-info-row">
                <strong>Type:</strong> {getItemType(selectedItem)}
              </div>
              <div className="uns-side-panel-info-row">
                <strong>ID:</strong> {getItemId(selectedItem)}
              </div>
              {hasTable && (
                <>
                  <div className="uns-side-panel-info-row">
                    <strong>DBMS:</strong> {itemData.dbms}
                  </div>
                  <div className="uns-side-panel-info-row">
                    <strong>Table:</strong> {itemData.table}
                  </div>
                  <div className="uns-side-panel-time-range">
                    <label htmlFor="time-range-value">Time Range:</label>
                    <div className="uns-time-range-controls">
                      <input
                        id="time-range-value"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={timeRangeValue}
                        onChange={(e) => {
                          const value = parseFloat(e.target.value) || 5;
                          onTimeRangeValueChange(value);
                        }}
                        className="uns-time-range-input"
                      />
                      <select
                        id="time-range-unit"
                        value={timeRangeUnit}
                        onChange={(e) => {
                          onTimeRangeUnitChange(e.target.value);
                        }}
                        className="uns-time-range-unit"
                      >
                        <option value="minute">Minutes</option>
                        <option value="hour">Hours</option>
                        <option value="day">Days</option>
                        <option value="week">Weeks</option>
                      </select>
                      <button
                        onClick={() => {
                          if (hasTable) {
                            onFetchTimeRange(itemData.dbms, itemData.table);
                          }
                        }}
                        disabled={sqlLoading}
                        className="uns-time-range-refresh-btn"
                      >
                        {sqlLoading ? 'Loading...' : '🔄 Refresh'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {hasTable && (
              <div className="uns-side-panel-sql">
                <div className="uns-sql-tabs">
                  <button
                    className={`uns-sql-tab ${sqlTab === 'timeRange' ? 'active' : ''}`}
                    onClick={() => onTabChange('timeRange')}
                  >
                    Time Range Query
                  </button>
                  <button
                    className={`uns-sql-tab ${sqlTab === 'advanced' ? 'active' : ''}`}
                    onClick={() => onTabChange('advanced')}
                  >
                    Advanced Query
                  </button>
                </div>

                {sqlTab === 'timeRange' && (
                  <div className="uns-sql-tab-content">
                    <div className="uns-sql-header">
                      <strong>
                        Table Data (Last {timeRangeValue} {timeRangeUnit}
                        {timeRangeValue !== 1 ? 's' : ''}):
                      </strong>
                      {sqlData && sqlData.length > 0 && (
                        <span className="uns-sql-row-count">
                          ({sqlData.length} row{sqlData.length !== 1 ? 's' : ''})
                        </span>
                      )}
                    </div>
                    {sqlLoading && (
                      <div className="uns-sql-loading">Loading table data...</div>
                    )}
                    {sqlError && (
                      <div className={sqlError.includes('no table/data') ? 'uns-sql-empty' : 'uns-sql-error'}>
                        {sqlError.includes('no table/data') ? (
                          sqlError
                        ) : (
                          <>
                            <strong>Error:</strong> {sqlError}
                          </>
                        )}
                      </div>
                    )}
                    {!sqlLoading && !sqlError && sqlData && (
                      <>
                        <div className="uns-sql-table-container">
                          {sqlData.length === 0 ? (
                            <div className="uns-sql-empty">
                              No data found for the specified time range.
                            </div>
                          ) : (
                            <table className="uns-sql-table">
                              <thead>
                                <tr>
                                  {Object.keys(sqlData[0]).map((key) => (
                                    <th key={key}>{key}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {sqlData.map((row, index) => (
                                  <tr key={index}>
                                    {Object.values(row).map((value, cellIndex) => (
                                      <td key={cellIndex}>
                                        {typeof value === 'object'
                                          ? JSON.stringify(value)
                                          : String(value)}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                        {renderSqlLineChart && renderSqlLineChart()}
                      </>
                    )}
                  </div>
                )}

                {sqlTab === 'advanced' && (
                  <div className="uns-sql-tab-content">
                    <div className="uns-sql-header">
                      <strong>Custom SQL Query:</strong>
                      {sqlData && sqlData.length > 0 && (
                        <span className="uns-sql-row-count">
                          ({sqlData.length} row{sqlData.length !== 1 ? 's' : ''})
                        </span>
                      )}
                    </div>
                    <div className="uns-custom-query-container">
                      <textarea
                        value={customSqlQuery}
                        onChange={(e) => onCustomQueryChange(e.target.value)}
                        placeholder={`Enter your SQL query here...\nExample: SELECT * FROM ${
                          itemData?.table || 'table_name'
                        } WHERE column = 'value'`}
                        className="uns-custom-query-input"
                        rows={6}
                      />
                      <button
                        onClick={() => {
                          if (itemData?.dbms && customSqlQuery.trim()) {
                            onExecuteCustomQuery(itemData.dbms, customSqlQuery);
                          }
                        }}
                        disabled={sqlLoading || !itemData?.dbms || !customSqlQuery.trim()}
                        className="uns-custom-query-execute-btn"
                      >
                        {sqlLoading ? 'Executing...' : '▶ Execute Query'}
                      </button>
                    </div>
                    {sqlLoading && (
                      <div className="uns-sql-loading">Executing query...</div>
                    )}
                    {sqlError && (
                      <div className={sqlError.includes('no table/data') ? 'uns-sql-empty' : 'uns-sql-error'}>
                        {sqlError.includes('no table/data') ? (
                          sqlError
                        ) : (
                          <>
                            <strong>Error:</strong> {sqlError}
                          </>
                        )}
                      </div>
                    )}
                    {!sqlLoading && !sqlError && sqlData && (
                      <>
                        <div className="uns-sql-table-container">
                          {sqlData.length === 0 ? (
                            <div className="uns-sql-empty">No data returned from query.</div>
                          ) : (
                            <table className="uns-sql-table">
                              <thead>
                                <tr>
                                  {Object.keys(sqlData[0]).map((key) => (
                                    <th key={key}>{key}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {sqlData.map((row, index) => (
                                  <tr key={index}>
                                    {Object.values(row).map((value, cellIndex) => (
                                      <td key={cellIndex}>
                                        {typeof value === 'object'
                                          ? JSON.stringify(value)
                                          : String(value)}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                        {renderSqlLineChart && renderSqlLineChart()}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="uns-side-panel-json">
              <strong>JSON Data:</strong>
              <pre>{JSON.stringify(itemData, null, 2)}</pre>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default UNSSidePanel;

