import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import UNSLineChart, { getUNSEffectiveYKey, getUNSNumericColumns } from './UNSLineChart';
import UNSTimeControls from './UNSTimeControls';
import { formatDateTimeLocalForBackend, getUNSTimeRangeError as getTimeRangeError } from './UNSTimeUtils';
import { queryTable } from './uns_api';
import './UNSPage.css';

const COMPARE_COLORS = [
  '#2563eb',
  '#dc2626',
  '#059669',
  '#7c3aed',
  '#ea580c',
  '#0891b2',
  '#be123c',
  '#4d7c0f',
];

const formatAxisValue = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return value;
  const absoluteValue = Math.abs(numericValue);
  if ((absoluteValue > 0 && absoluteValue < 0.001) || absoluteValue >= 1000000) {
    return numericValue.toExponential(2);
  }
  return numericValue.toLocaleString(undefined, {
    maximumFractionDigits: absoluteValue < 10 ? 4 : 2,
  });
};

const formatTimestamp = (timestamp) => new Date(timestamp).toLocaleTimeString(
  [],
  { hour: '2-digit', minute: '2-digit', second: '2-digit' },
);

const parseTimestampValue = (value) => {
  if (value == null || value === '') return NaN;
  if (typeof value === 'number') {
    return value < 1000000000000 ? value * 1000 : value;
  }
  const trimmed = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    return numeric < 1000000000000 ? numeric * 1000 : numeric;
  }
  return Date.parse(trimmed);
};

const getSourceStats = (source) => {
  const metric = getUNSEffectiveYKey({
    data: source.data,
    chartYKey: source.chartYKey,
    preferredColumn: source.column,
  });
  const values = Array.isArray(source.data)
    ? source.data
      .map((row) => {
        const raw = row?.[metric];
        const value = typeof raw === 'number' ? raw : parseFloat(raw);
        return Number.isFinite(value) ? value : null;
      })
      .filter((value) => value != null)
      .sort((a, b) => a - b)
    : [];

  if (!metric || values.length === 0) {
    return { metric, min: null, max: null, avg: null, median: null };
  }

  const middle = Math.floor(values.length / 2);
  const median = values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) / 2
    : values[middle];
  const total = values.reduce((sum, value) => sum + value, 0);

  return {
    metric,
    min: values[0],
    max: values[values.length - 1],
    avg: total / values.length,
    median,
  };
};

const formatStatValue = (value) => {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, {
    maximumFractionDigits: Math.abs(value) < 10 ? 4 : 2,
  });
};

const UNSCompareLineChart = ({ sources, onSourceYKeyChange, timeColumn }) => {
  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState(null);

  const getThemeColor = (name, fallback) => {
    if (typeof window === 'undefined') {
      return fallback;
    }

    const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  };

  const chartTheme = {
    grid: getThemeColor('--chart-grid', '#d8e1ec'),
    axis: getThemeColor('--chart-axis', '#5b6678'),
    tooltipBg: getThemeColor('--chart-tooltip-bg', '#ffffff'),
    tooltipBorder: getThemeColor('--chart-tooltip-border', '#cbd5e1'),
    surface: getThemeColor('--color-surface', '#ffffff'),
    text: getThemeColor('--color-text', '#172033'),
  };

  const plottableSources = useMemo(() => (
    sources
      .map((source, index) => ({
        ...source,
        color: COMPARE_COLORS[index % COMPARE_COLORS.length],
        valueKey: `source_${source.id}`,
        effectiveYKey: getUNSEffectiveYKey({
          data: source.data,
          chartYKey: source.chartYKey,
          preferredColumn: source.column,
        }),
      }))
      .filter((source) => source.effectiveYKey && Array.isArray(source.data) && source.data.length > 0)
  ), [sources]);

  const chartData = useMemo(() => {
    const rowsByTime = new Map();

    plottableSources.forEach((source) => {
      source.data.forEach((row) => {
        const timestamp = parseTimestampValue(row?.[timeColumn]);
        const rawValue = row?.[source.effectiveYKey];
        const value = typeof rawValue === 'number' ? rawValue : parseFloat(rawValue);
        if (Number.isNaN(timestamp) || Number.isNaN(value)) return;

        if (!rowsByTime.has(timestamp)) {
          rowsByTime.set(timestamp, { timestamp });
        }
        rowsByTime.get(timestamp)[source.valueKey] = value;
      });
    });

    return Array.from(rowsByTime.values()).sort((a, b) => a.timestamp - b.timestamp);
  }, [plottableSources, timeColumn]);

  useEffect(() => {
    setViewStart(0);
    setViewEnd(null);
  }, [sources, timeColumn]);

  if (sources.length === 0) {
    return <div className="uns-compare-empty">Add a data source to start comparing.</div>;
  }

  if (sources.length === 1 && Array.isArray(sources[0].data) && sources[0].data.length > 0) {
    return (
      <div className="uns-compare-single-chart">
        <UNSLineChart
          sqlData={sources[0].data}
          chartYKey={sources[0].chartYKey}
          onChartYKeyChange={(value) => onSourceYKeyChange(sources[0].id, value)}
          preferredColumn={sources[0].column}
          timeColumnKey={timeColumn}
        />
      </div>
    );
  }

  if (chartData.length === 0 || plottableSources.length === 0) {
    return <div className="uns-compare-empty">No numeric chart data is available for these sources.</div>;
  }

  const totalPoints = chartData.length;
  const canZoom = totalPoints > 20;
  const endIndex = viewEnd != null ? Math.min(viewEnd, totalPoints - 1) : totalPoints - 1;
  const startIndex = Math.max(0, Math.min(viewStart, Math.max(endIndex - 1, 0)));
  const displayedData = chartData.slice(startIndex, endIndex + 1);
  const displayedValues = displayedData.flatMap((row) => (
    plottableSources
      .map((source) => row[source.valueKey])
      .filter((value) => Number.isFinite(value))
  ));
  if (displayedValues.length === 0) {
    return <div className="uns-compare-empty">No visible numeric chart data is available for this zoom level.</div>;
  }
  const visibleTimeMin = displayedData[0].timestamp;
  const visibleTimeMax = displayedData[displayedData.length - 1].timestamp;
  const xDomain = visibleTimeMin === visibleTimeMax
    ? [visibleTimeMin - 1000, visibleTimeMax + 1000]
    : [visibleTimeMin, visibleTimeMax];
  const xTicks = visibleTimeMin === visibleTimeMax
    ? [visibleTimeMin]
    : Array.from(
      { length: 6 },
      (_, index) => visibleTimeMin + ((visibleTimeMax - visibleTimeMin) * index) / 5,
    );
  const dataMin = Math.min(...displayedValues);
  const dataMax = Math.max(...displayedValues);
  const yDomain = [dataMin - 1, dataMax + 1];
  const buildYAxisTicks = (min, max) => {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
    if (min === max) return [min];

    const tickCount = 5;
    const step = (max - min) / (tickCount - 1);
    return Array.from({ length: tickCount }, (_, index) => (
      index === 0 ? min : index === tickCount - 1 ? max : min + step * index
    ));
  };
  const yTicks = buildYAxisTicks(dataMin, dataMax);
  const viewRange = endIndex - startIndex + 1;
  const isZoomed = canZoom && viewRange < totalPoints;
  const zoomAroundCenter = (factor) => {
    if (!canZoom) return;
    const mid = startIndex + Math.floor(viewRange / 2);
    const newRange = Math.max(10, Math.min(totalPoints, Math.round(viewRange * factor)));
    const newStart = Math.max(0, Math.min(mid - Math.floor(newRange / 2), totalPoints - newRange));
    setViewStart(newStart);
    setViewEnd(Math.min(totalPoints - 1, newStart + newRange - 1));
  };
  const panVisibleRange = (nextStart) => {
    const normalizedStart = Math.max(0, Math.min(nextStart, totalPoints - viewRange));
    setViewStart(normalizedStart);
    setViewEnd(Math.min(totalPoints - 1, normalizedStart + viewRange - 1));
  };
  const renderYAxisTick = ({ x, y, payload }) => {
    const value = Number(payload?.value);
    const isLimit = Number.isFinite(value)
      && (Math.abs(value - dataMin) < 0.000001 || Math.abs(value - dataMax) < 0.000001);

    return (
      <text
        x={x}
        y={y}
        dy={4}
        textAnchor="end"
        fill={chartTheme.axis}
        fontSize={isLimit ? 14 : 11}
        fontWeight={isLimit ? 800 : 500}
      >
        {formatAxisValue(payload?.value)}
      </text>
    );
  };

  return (
    <div className="uns-compare-chart">
      <div className="uns-compare-chart-source-controls">
        {sources.map((source, index) => {
          const candidates = getUNSNumericColumns(source.data);
          const effectiveYKey = getUNSEffectiveYKey({
            data: source.data,
            chartYKey: source.chartYKey,
            preferredColumn: source.column,
          });

          return (
            <label key={source.id} className="uns-compare-source-metric">
              <span
                className="uns-compare-source-swatch"
                style={{ backgroundColor: COMPARE_COLORS[index % COMPARE_COLORS.length] }}
              />
              <span className="uns-compare-source-metric-name">{source.name}</span>
              <select
                value={effectiveYKey || ''}
                onChange={(event) => onSourceYKeyChange(source.id, event.target.value)}
                disabled={candidates.length === 0}
              >
                {candidates.length === 0 ? (
                  <option value="">No numeric columns</option>
                ) : candidates.map((candidate) => (
                  <option key={candidate} value={candidate}>{candidate}</option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
      {canZoom && (
        <div className="uns-compare-chart-zoom">
          <button type="button" onClick={() => zoomAroundCenter(1 / 1.4)} aria-label="Zoom in">
            +
          </button>
          <button type="button" onClick={() => zoomAroundCenter(1.4)} aria-label="Zoom out">
            −
          </button>
          <button
            type="button"
            onClick={() => {
              setViewStart(0);
              setViewEnd(null);
            }}
          >
            Reset
          </button>
        </div>
      )}
      <div className="uns-compare-chart-body">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={displayedData} margin={{ top: 12, right: 18, left: 10, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} />
            <XAxis
              type="number"
              scale="time"
              dataKey="timestamp"
              domain={xDomain}
              ticks={xTicks}
              tick={{ fontSize: 11, fill: chartTheme.axis }}
              stroke={chartTheme.axis}
              tickFormatter={formatTimestamp}
              minTickGap={36}
            />
            <YAxis
              type="number"
              domain={yDomain}
              ticks={yTicks}
              allowDataOverflow
              tick={renderYAxisTick}
              stroke={chartTheme.axis}
            />
            <Tooltip
              isAnimationActive={false}
              labelFormatter={(timestamp) => new Date(timestamp).toLocaleString()}
              formatter={(value, name) => [formatAxisValue(value), name]}
              contentStyle={{
                backgroundColor: chartTheme.tooltipBg,
                borderColor: chartTheme.tooltipBorder,
                color: chartTheme.text,
              }}
              labelStyle={{ color: chartTheme.text }}
              itemStyle={{ color: chartTheme.text }}
            />
            {plottableSources.map((source) => (
              <Line
                key={source.id}
                type="linear"
                dataKey={source.valueKey}
                name={`${source.name} · ${source.effectiveYKey}`}
                stroke={source.color}
                strokeWidth={2}
                dot={chartData.length <= 80 ? { r: 3, fill: source.color } : false}
                activeDot={{ r: 5, fill: source.color, stroke: chartTheme.surface, strokeWidth: 2 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {isZoomed && (
        <div className="uns-compare-chart-scrollbar">
          <input
            type="range"
            min="0"
            max={Math.max(0, totalPoints - viewRange)}
            step="1"
            value={startIndex}
            onChange={(event) => panVisibleRange(Number(event.target.value))}
            aria-label="Pan compared time range"
          />
        </div>
      )}
    </div>
  );
};

const UNSCompareGraphs = ({
  conn,
  graphs,
  setGraphs,
  activeGraphId,
  setActiveGraphId,
  isOpen,
  setIsOpen,
  onCreateGraph,
}) => {
  const liveIntervalRef = useRef(null);
  const activeGraph = graphs.find((graph) => graph.id === activeGraphId) || graphs[0] || null;

  const updateGraph = (graphId, updater) => {
    setGraphs((prev) => prev.map((graph) => (
      graph.id === graphId ? updater(graph) : graph
    )));
  };

  const updateSource = (graphId, sourceId, updater) => {
    updateGraph(graphId, (graph) => ({
      ...graph,
      sources: graph.sources.map((source) => (
        source.id === sourceId ? updater(source) : source
      )),
    }));
  };

  const fetchSource = async (graph, source, { silent = false } = {}) => {
    if (!conn || !graph || !source?.dbms || !source?.table) return;

    if (getTimeRangeError(graph)) {
      if (!silent) {
        updateGraph(graph.id, (currentGraph) => ({
          ...currentGraph,
          timeRangeErrorDismissed: false,
        }));
      }
      return;
    }

    if (!silent) {
      updateSource(graph.id, source.id, (currentSource) => ({
        ...currentSource,
        loading: true,
        error: null,
      }));
    }

    try {
      const result = await queryTable(conn, {
        dbms: source.dbms,
        table: source.table,
        time_value: graph.timeRangeValue,
        time_unit: graph.timeRangeUnit,
        start_time: graph.timeMode === 'absolute' ? formatDateTimeLocalForBackend(graph.startTime) : '',
        end_time: graph.timeMode === 'absolute' ? formatDateTimeLocalForBackend(graph.endTime) : '',
        where: source.where,
        column: source.column,
        time_column: graph.timeColumn,
      });

      updateSource(graph.id, source.id, (currentSource) => ({
        ...currentSource,
        data: result.success && Array.isArray(result.data) ? result.data : [],
        columns: Array.isArray(result.columns) ? result.columns : [],
        loading: false,
        needsFetch: false,
        error: result.success ? null : (result.error || 'Failed to fetch table data'),
        lastFetchedAt: result.success ? new Date().toISOString() : currentSource.lastFetchedAt,
      }));
    } catch (err) {
      updateSource(graph.id, source.id, (currentSource) => ({
        ...currentSource,
        loading: false,
        needsFetch: false,
        error: err.message || 'Failed to fetch table data',
      }));
    }
  };

  const refreshGraph = (graph, options) => {
    if (!graph) return;
    if (getTimeRangeError(graph)) {
      updateGraph(graph.id, (currentGraph) => ({
        ...currentGraph,
        timeRangeErrorDismissed: false,
      }));
      return;
    }
    graph.sources.forEach((source) => fetchSource(graph, source, options));
  };

  useEffect(() => {
    if (!activeGraph) return;
    if (getTimeRangeError(activeGraph)) {
      updateGraph(activeGraph.id, (graph) => ({
        ...graph,
        timeRangeErrorDismissed: false,
      }));
      return;
    }

    activeGraph.sources
      .filter((source) => source.needsFetch && !source.loading)
      .forEach((source) => fetchSource(activeGraph, source));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGraph?.id, activeGraph?.sources, conn]);

  useEffect(() => {
    if (liveIntervalRef.current) {
      clearInterval(liveIntervalRef.current);
      liveIntervalRef.current = null;
    }

    if (!activeGraph?.liveMode || !activeGraph.sources.length || getTimeRangeError(activeGraph)) {
      return undefined;
    }

    const validRate = Math.max(5, activeGraph.refreshRate || 20);
    liveIntervalRef.current = setInterval(() => {
      refreshGraph(activeGraph, { silent: true });
    }, validRate * 1000);

    return () => {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current);
        liveIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeGraph?.id,
    activeGraph?.liveMode,
    activeGraph?.refreshRate,
    activeGraph?.timeRangeValue,
    activeGraph?.timeRangeUnit,
    activeGraph?.timeMode,
    activeGraph?.startTime,
    activeGraph?.endTime,
    activeGraph?.timeColumn,
    activeGraph?.sources,
  ]);

  if (graphs.length === 0) {
    return null;
  }

  const removeGraph = (graphId) => {
    const nextGraphs = graphs.filter((graph) => graph.id !== graphId);
    setGraphs(nextGraphs);
    if (activeGraphId === graphId) {
      setActiveGraphId(nextGraphs[0]?.id || null);
    }
  };

  const removeSource = (graphId, sourceId) => {
    updateGraph(graphId, (graph) => ({
      ...graph,
      sources: graph.sources.filter((source) => source.id !== sourceId),
    }));
  };

  const setGraphControl = (key, value) => {
    if (!activeGraph) return;
    updateGraph(activeGraph.id, (graph) => ({ ...graph, [key]: value }));
  };

  const setTimeGraphControl = (key, value) => {
    if (!activeGraph) return;
    updateGraph(activeGraph.id, (graph) => ({
      ...graph,
      [key]: value,
      timeRangeErrorDismissed: false,
    }));
  };

  const setSourceYKey = (sourceId, value) => {
    if (!activeGraph) return;
    updateSource(activeGraph.id, sourceId, (source) => ({ ...source, chartYKey: value }));
  };

  const activeTimeRangeError = getTimeRangeError(activeGraph);

  return (
    <section className="uns-compare-panel">
      <div className="uns-compare-header">
        <button
          type="button"
          className="uns-compare-collapse-btn"
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
        >
          {isOpen ? 'Hide compare graphs' : 'Show compare graphs'}
        </button>
        <select
          className="uns-compare-graph-select"
          value={activeGraph?.id || ''}
          onChange={(event) => {
            setActiveGraphId(event.target.value);
            setIsOpen(true);
          }}
        >
          {graphs.map((graph) => (
            <option key={graph.id} value={graph.id}>
              {graph.name} ({graph.sources.length})
            </option>
          ))}
        </select>
        <button type="button" className="uns-compare-secondary-btn" onClick={onCreateGraph}>
          New graph
        </button>
      </div>

      {isOpen && activeGraph && (
        <div className="uns-compare-body">
          <div className="uns-compare-graph-meta">
            <label className="uns-compare-name-field">
              <span>Name</span>
              <input
                type="text"
                value={activeGraph.name}
                onChange={(event) => setGraphControl('name', event.target.value)}
              />
            </label>
            <button
              type="button"
              className="uns-compare-danger-btn"
              onClick={() => removeGraph(activeGraph.id)}
            >
              Remove graph
            </button>
          </div>

          <UNSTimeControls
            idPrefix={`uns-compare-${activeGraph.id}`}
            className="uns-compare-controls"
            timeRangeValue={activeGraph.timeRangeValue}
            timeRangeUnit={activeGraph.timeRangeUnit}
            timeMode={activeGraph.timeMode || 'relative'}
            startTime={activeGraph.startTime || ''}
            endTime={activeGraph.endTime || ''}
            timeColumn={activeGraph.timeColumn}
            loading={activeGraph.sources.some((source) => source.loading)}
            liveMode={activeGraph.liveMode}
            refreshRate={activeGraph.refreshRate}
            onTimeRangeValueChange={(value) => setTimeGraphControl('timeRangeValue', value)}
            onTimeRangeUnitChange={(value) => setTimeGraphControl('timeRangeUnit', value)}
            onTimeModeChange={(value) => setTimeGraphControl('timeMode', value)}
            onStartTimeChange={(value) => setTimeGraphControl('startTime', value)}
            onEndTimeChange={(value) => setTimeGraphControl('endTime', value)}
            onTimeColumnChange={(value) => setTimeGraphControl('timeColumn', value)}
            onRefresh={() => refreshGraph(activeGraph)}
            onLiveModeChange={(value) => setGraphControl('liveMode', value)}
            onRefreshRateChange={(value) => setGraphControl('refreshRate', value)}
          />

          {activeTimeRangeError && !activeGraph.timeRangeErrorDismissed && (
            <div className="uns-compare-range-error" role="alert">
              <span>{activeTimeRangeError}</span>
              <button
                type="button"
                onClick={() => setGraphControl('timeRangeErrorDismissed', true)}
                aria-label="Dismiss time range error"
              >
                ×
              </button>
            </div>
          )}

          <UNSCompareLineChart
            sources={activeGraph.sources}
            onSourceYKeyChange={setSourceYKey}
            timeColumn={activeGraph.timeColumn}
          />

          <div className="uns-compare-sources">
            {activeGraph.sources.map((source, index) => {
              const stats = getSourceStats(source);

              return (
                <div key={source.id} className="uns-compare-source">
                  <div className="uns-compare-source-header">
                    <span
                      className="uns-compare-source-swatch"
                      style={{ backgroundColor: COMPARE_COLORS[index % COMPARE_COLORS.length] }}
                    />
                    <div>
                      <strong>{source.name}</strong>
                      <div className="uns-compare-source-meta">
                        {source.dbms}.{source.table}
                        {source.lastFetchedAt ? ` · ${new Date(source.lastFetchedAt).toLocaleTimeString()}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="uns-compare-source-remove"
                      onClick={() => removeSource(activeGraph.id, source.id)}
                      aria-label={`Remove ${source.name}`}
                      title="Remove source"
                    >
                      ×
                    </button>
                  </div>
                  {source.loading && <div className="uns-sql-loading">Loading source data...</div>}
                  {source.error && <div className="uns-sql-error">{source.error}</div>}
                  {!source.loading && !source.error && Array.isArray(source.data) && (
                    <div className="uns-compare-source-count">
                      {source.data.length} row{source.data.length !== 1 ? 's' : ''}
                    </div>
                  )}
                  <div className="uns-compare-source-stats">
                    <div><span>Metric</span><strong>{stats.metric || '—'}</strong></div>
                    <div><span>Min</span><strong>{formatStatValue(stats.min)}</strong></div>
                    <div><span>Max</span><strong>{formatStatValue(stats.max)}</strong></div>
                    <div><span>Avg</span><strong>{formatStatValue(stats.avg)}</strong></div>
                    <div><span>Median</span><strong>{formatStatValue(stats.median)}</strong></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};

export default UNSCompareGraphs;
