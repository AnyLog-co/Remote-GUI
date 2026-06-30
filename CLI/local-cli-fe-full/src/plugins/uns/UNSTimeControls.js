import React from 'react';
import './UNSPage.css';

const UNSTimeControls = ({
  idPrefix,
  className = '',
  timeRangeValue,
  timeRangeUnit,
  timeMode = 'relative',
  startTime = '',
  endTime = '',
  timeColumn,
  loading = false,
  liveMode = false,
  refreshRate = 20,
  onTimeRangeValueChange,
  onTimeRangeUnitChange,
  onTimeModeChange,
  onStartTimeChange,
  onEndTimeChange,
  onTimeColumnChange,
  onRefresh,
  onLiveModeChange,
  onRefreshRateChange,
}) => {
  const prefix = idPrefix || 'uns-time-controls';

  return (
    <div className={`uns-time-controls ${className}`.trim()}>
      {onTimeModeChange && (
        <div className="uns-time-mode-toggle" role="group" aria-label="Time range mode">
          <button
            type="button"
            className={timeMode === 'relative' ? 'active' : ''}
            onClick={() => onTimeModeChange('relative')}
          >
            Relative
          </button>
          <button
            type="button"
            className={timeMode === 'absolute' ? 'active' : ''}
            onClick={() => onTimeModeChange('absolute')}
          >
            Between
          </button>
        </div>
      )}
      <div className="uns-time-range-controls">
        {timeMode === 'absolute' && onStartTimeChange && onEndTimeChange ? (
          <>
            <label className="uns-time-control-field uns-time-control-wide" htmlFor={`${prefix}-start-time`}>
              <span>Start</span>
              <input
                id={`${prefix}-start-time`}
                type="datetime-local"
                value={startTime}
                onChange={(event) => onStartTimeChange(event.target.value)}
                className="uns-time-range-input"
              />
            </label>
            <label className="uns-time-control-field uns-time-control-wide" htmlFor={`${prefix}-end-time`}>
              <span>End</span>
              <input
                id={`${prefix}-end-time`}
                type="datetime-local"
                value={endTime}
                onChange={(event) => onEndTimeChange(event.target.value)}
                className="uns-time-range-input"
              />
            </label>
          </>
        ) : (
          <>
            <label className="uns-time-control-field" htmlFor={`${prefix}-time-range-value`}>
              <span>Time Range</span>
              <input
                id={`${prefix}-time-range-value`}
                type="number"
                min="0.01"
                step="0.01"
                value={timeRangeValue}
                onChange={(event) => onTimeRangeValueChange(parseFloat(event.target.value) || 5)}
                className="uns-time-range-input"
              />
            </label>
            <label className="uns-time-control-field" htmlFor={`${prefix}-time-range-unit`}>
              <span>Unit</span>
              <select
                id={`${prefix}-time-range-unit`}
                value={timeRangeUnit}
                onChange={(event) => onTimeRangeUnitChange(event.target.value)}
                className="uns-time-range-unit"
              >
                <option value="minute">Minutes</option>
                <option value="hour">Hours</option>
                <option value="day">Days</option>
                <option value="week">Weeks</option>
              </select>
            </label>
          </>
        )}
        <label className="uns-time-control-field" htmlFor={`${prefix}-time-column`}>
          <span>Time column</span>
          <select
            id={`${prefix}-time-column`}
            value={timeColumn}
            onChange={(event) => onTimeColumnChange(event.target.value)}
            className="uns-time-column-select"
            title="Time column used for filtering"
          >
            <option value="insert_timestamp">insert_timestamp</option>
            <option value="timestamp">timestamp</option>
          </select>
        </label>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="uns-time-range-refresh-btn"
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>
      <div className="uns-live-controls">
        <button
          type="button"
          onClick={() => onLiveModeChange(!liveMode)}
          className={`uns-live-toggle ${liveMode ? 'active' : ''}`}
          title={liveMode ? 'Stop live refresh' : 'Start live refresh'}
        >
          {liveMode && <span className="uns-live-dot" />}
          {liveMode ? 'Live' : 'Go Live'}
        </button>
        <label className="uns-refresh-rate-label" htmlFor={`${prefix}-refresh-rate`}>
          every
        </label>
        <input
          id={`${prefix}-refresh-rate`}
          type="number"
          min="5"
          step="1"
          value={refreshRate}
          onChange={(event) => onRefreshRateChange(Math.max(5, parseInt(event.target.value, 10) || 20))}
          className="uns-refresh-rate-input"
          disabled={liveMode}
        />
        <span className="uns-refresh-rate-unit">sec</span>
      </div>
    </div>
  );
};

export default UNSTimeControls;
