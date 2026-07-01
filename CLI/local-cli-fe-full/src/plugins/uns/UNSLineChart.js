import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
  ResponsiveContainer,
} from 'recharts';
import './UNSPage.css';

const parseUNSTimestamp = (value) => {
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

const UNSLineChart = forwardRef(({ sqlData, chartYKey, onChartYKeyChange, preferredColumn, timeColumnKey = 'timestamp' }, ref) => {
  const [chartViewStart, setChartViewStart] = useState(0);
  const [chartViewEnd, setChartViewEnd] = useState(null);
  const chartContainerRef = useRef(null);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartViewRef = useRef({ start: 0, end: 0 });
  const chartDataRef = useRef(null);
  const chartViewRef = useRef({ start: 0, end: 0, range: 0, total: 0 });
  const scrollbarTrackRef = useRef(null);
  const isScrollbarDraggingRef = useRef(false);
  const scrollbarDragStartXRef = useRef(0);
  const scrollbarDragStartViewRef = useRef({ start: 0, end: 0 });

  const getThemeColor = (name, fallback) => {
    if (typeof window === 'undefined') {
      return fallback;
    }

    const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  };

  const chartTheme = {
    grid: getThemeColor('--chart-grid', '#e9ecef'),
    axis: getThemeColor('--chart-axis', '#6c757d'),
    line: getThemeColor('--chart-line', '#007bff'),
    lineActive: getThemeColor('--chart-line-active', '#0056b3'),
    gapFill: getThemeColor('--chart-gap-fill', '#e9ecef'),
    tooltipBg: getThemeColor('--chart-tooltip-bg', '#ffffff'),
    tooltipBorder: getThemeColor('--chart-tooltip-border', '#ced4da'),
    surface: getThemeColor('--color-surface', '#ffffff'),
    text: getThemeColor('--color-text', '#212529'),
    textMuted: getThemeColor('--color-text-muted', '#6c757d'),
  };

  // Reset chart zoom/pan when data, value column, or time column changes
  useEffect(() => {
    setChartViewStart(0);
    setChartViewEnd(null);
  }, [sqlData, chartYKey, timeColumnKey]);

  // Global mouse handlers for chart drag and scrollbar thumb drag
  useEffect(() => {
    const handleMove = (e) => {
      // Scrollbar thumb drag
      if (isScrollbarDraggingRef.current && scrollbarTrackRef.current) {
        e.preventDefault();
        const view = chartViewRef.current;
        if (!view.total || view.range === 0) return;
        const rect = scrollbarTrackRef.current.getBoundingClientRect();
        const trackWidth = rect.width;
        const deltaX = e.clientX - scrollbarDragStartXRef.current;
        const indexDelta = Math.round((deltaX / trackWidth) * view.total);
        const newStart = Math.max(0, Math.min(view.total - view.range, scrollbarDragStartViewRef.current.start + indexDelta));
        const newEnd = Math.min(view.total - 1, newStart + view.range - 1);
        setChartViewStart(newStart);
        setChartViewEnd(newEnd);
        return;
      }
      // Chart drag
      if (!isDraggingRef.current || !chartContainerRef.current) return;
      e.preventDefault();
      
      const view = chartViewRef.current;
      if (!view.total || view.range === 0) return;
      
      const deltaX = e.clientX - dragStartXRef.current;
      const rect = chartContainerRef.current.getBoundingClientRect();
      const chartWidth = rect.width;
      
      const pointDelta = Math.round((deltaX / chartWidth) * view.range);
      const newStart = Math.max(0, Math.min(view.total - view.range, dragStartViewRef.current.start - pointDelta));
      const newEnd = Math.min(view.total - 1, newStart + view.range - 1);
      
      setChartViewStart(newStart);
      setChartViewEnd(newEnd);
    };
    
    const handleUp = () => {
      if (chartContainerRef.current) {
        chartContainerRef.current.style.cursor = 'grab';
      }
      isDraggingRef.current = false;
      isScrollbarDraggingRef.current = false;
    };
    
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  const getChartAsDataUrl = () => new Promise((resolve, reject) => {
    if (!chartContainerRef.current) {
      reject(new Error('Chart not ready'));
      return;
    }
    const svgEl = chartContainerRef.current.querySelector('.recharts-wrapper svg') || chartContainerRef.current.querySelector('svg');
    if (!svgEl) {
      reject(new Error('Chart SVG not found'));
      return;
    }
    const clone = svgEl.cloneNode(true);
    const width = 800;
    const height = 440;
    clone.setAttribute('width', width);
    clone.setAttribute('height', height);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const svgData = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = chartTheme.surface;
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load chart image'));
    };
    img.src = url;
  });

  useImperativeHandle(ref, () => ({
    getChartAsDataUrl,
  }), [chartTheme.surface]);

  if (!sqlData || !Array.isArray(sqlData) || sqlData.length === 0) {
    return null;
  }

  const firstRow = sqlData[0];
  if (!firstRow || typeof firstRow !== 'object' || Array.isArray(firstRow)) {
    return null;
  }

  const desiredTimeKey = timeColumnKey || 'timestamp';
  const timeKey = desiredTimeKey in firstRow
    ? desiredTimeKey
    : Object.keys(firstRow).find((k) => k.toLowerCase() === (desiredTimeKey || '').toLowerCase());
  if (!timeKey) {
    return null;
  }

  const valueCandidates = Object.keys(firstRow).filter((key) => {
    if (['row_id', 'tsd_name', 'tsd_id', 'insert_timestamp', 'timestamp'].includes(key)) return false;
    const v = firstRow[key];
    if (typeof v === 'number') return true;
    return !Number.isNaN(parseFloat(v));
  });

  if (valueCandidates.length === 0) {
    return null;
  }

  const effectiveYKey = chartYKey && valueCandidates.includes(chartYKey)
    ? chartYKey
    : preferredColumn && valueCandidates.includes(preferredColumn)
      ? preferredColumn
      : valueCandidates[0];

  const formatTimestamp = (timestamp) => new Date(timestamp).toLocaleTimeString(
    [],
    { hour: '2-digit', minute: '2-digit', second: '2-digit' },
  );

  // Each plotted point is an exact { timestamp, value } observation.
  const chartData = sqlData
    .map((row) => {
      const tsRaw = row[timeKey];
      const timestamp = parseUNSTimestamp(tsRaw);
      const vRaw = row[effectiveYKey];
      const value = typeof vRaw === 'number' ? vRaw : parseFloat(vRaw);
      if (Number.isNaN(timestamp) || Number.isNaN(value)) return null;
      return {
        timestamp,
        value,
        fullTime: new Date(timestamp).toLocaleString(),
      };
    })
    .filter((p) => p !== null)
    .sort((a, b) => a.timestamp - b.timestamp);

  if (chartData.length === 0) {
    return null;
  }

  const ZOOM_THRESHOLD = 50;
  const canZoom = chartData.length > ZOOM_THRESHOLD;
  const totalPoints = chartData.length;
  const endIndex = chartViewEnd != null ? Math.min(chartViewEnd, totalPoints - 1) : totalPoints - 1;
  const startIndex = Math.max(0, Math.min(chartViewStart, endIndex - 1));
  const displayedData = canZoom ? chartData.slice(startIndex, endIndex + 1) : chartData;
  const viewRange = endIndex - startIndex + 1;
  const { dataMin, dataMax } = chartData.reduce(
    (bounds, point) => ({
      dataMin: Math.min(bounds.dataMin, point.value),
      dataMax: Math.max(bounds.dataMax, point.value),
    }),
    { dataMin: Infinity, dataMax: -Infinity },
  );
  const displayedMetricName = effectiveYKey;
  const positiveIntervals = chartData
    .slice(1)
    .map((point, index) => point.timestamp - chartData[index].timestamp)
    .filter((interval) => interval > 0)
    .sort((a, b) => a - b);
  const medianInterval = positiveIntervals.length > 0
    ? positiveIntervals[Math.floor(positiveIntervals.length / 2)]
    : null;
  const gapThreshold = medianInterval == null
    ? Infinity
    : Math.max(medianInterval * 3, medianInterval + 1000);
  const gapAreas = [];
  const plottedData = [];

  displayedData.forEach((point, index) => {
    const previousPoint = displayedData[index - 1];
    if (previousPoint) {
      const interval = point.timestamp - previousPoint.timestamp;
      const isGap = interval > gapThreshold;

      if (isGap) {
        gapAreas.push({
          start: previousPoint.timestamp,
          end: point.timestamp,
        });
        plottedData.push({
          timestamp: previousPoint.timestamp + interval / 2,
          value: null,
          isGap: true,
        });
      }
    }

    plottedData.push({
      ...point,
      rawValue: point.value,
      value: point.value,
    });
  });

  const paddedMin = dataMin - 1;
  const paddedMax = dataMax + 1;
  const yDomain = [paddedMin, paddedMax];
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
  
  // Update refs for mouse handlers
  chartDataRef.current = chartData;
  chartViewRef.current = { start: startIndex, end: endIndex, range: viewRange, total: totalPoints };

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

  const formatYAxisValue = (value) => formatAxisValue(value);

  // Zoom in/out centered on current view
  const ZOOM_FACTOR = 1.4;
  const handleZoomIn = () => {
    if (!canZoom) return;
    const mid = startIndex + Math.floor(viewRange / 2);
    const newRange = Math.max(10, Math.round(viewRange / ZOOM_FACTOR));
    const newStart = Math.max(0, Math.min(mid - Math.floor(newRange / 2), totalPoints - newRange));
    const newEnd = Math.min(totalPoints - 1, newStart + newRange - 1);
    setChartViewStart(newStart);
    setChartViewEnd(newEnd);
  };
  const handleZoomOut = () => {
    if (!canZoom) return;
    const mid = startIndex + Math.floor(viewRange / 2);
    const newRange = Math.min(totalPoints, Math.round(viewRange * ZOOM_FACTOR));
    const newStart = Math.max(0, Math.min(mid - Math.floor(newRange / 2), totalPoints - newRange));
    const newEnd = Math.min(totalPoints - 1, newStart + newRange - 1);
    setChartViewStart(newStart);
    setChartViewEnd(newEnd);
  };

  const handleExportImage = () => {
    getChartAsDataUrl().then((pngUrl) => {
      const a = document.createElement('a');
      a.href = pngUrl;
      a.download = `chart-${effectiveYKey || 'export'}-${new Date().toISOString().slice(0, 10)}.png`;
      a.click();
    }).catch(console.error);
  };

  return (
    <div className="uns-sql-chart">
      <div className="uns-sql-chart-header">
        <span>
          Line Chart · {displayedMetricName}
          {gapAreas.length > 0 && (
            <small className="uns-chart-gap-legend">Shaded gaps = no data</small>
          )}
        </span>
        <div className="uns-sql-chart-controls">
          <label htmlFor="uns-sql-chart-ykey">Value column:</label>
          <select
            id="uns-sql-chart-ykey"
            value={effectiveYKey}
            onChange={(e) => onChartYKeyChange && onChartYKeyChange(e.target.value)}
          >
            {valueCandidates.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
          <button type="button" onClick={handleExportImage} className="uns-sql-chart-export-btn" title="Export as image" aria-label="Export chart as image">
            Export image
          </button>
          {canZoom && (
            <>
              <div className="uns-sql-chart-zoom-btns">
                <button type="button" onClick={handleZoomIn} className="uns-sql-chart-zoom-btn" title="Zoom in" aria-label="Zoom in">
                  +
                </button>
                <button type="button" onClick={handleZoomOut} className="uns-sql-chart-zoom-btn" title="Zoom out" aria-label="Zoom out">
                  −
                </button>
              </div>
              {viewRange < totalPoints && (
                <span className="uns-sql-chart-zoom-hint">Drag chart to pan</span>
              )}
            </>
          )}
        </div>
      </div>
      <div 
        id="uns-chart-view"
        className="uns-sql-chart-body"
        ref={chartContainerRef}
        onMouseDown={(e) => {
          if (!canZoom || !chartContainerRef.current) return;
          if (e.button !== 0) return; // Only left mouse button
          e.preventDefault();
          isDraggingRef.current = true;
          dragStartXRef.current = e.clientX;
          dragStartViewRef.current = { start: startIndex, end: endIndex };
          chartContainerRef.current.style.cursor = 'grabbing';
        }}
        style={{ cursor: canZoom ? 'grab' : 'default' }}
      >
        <ResponsiveContainer width="100%" height={220} aspect={undefined}>
          <LineChart
            data={plottedData}
            margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
          >
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
              tick={{ fontSize: 11, fill: chartTheme.axis }}
              stroke={chartTheme.axis}
              tickFormatter={formatYAxisValue}
            />
            {gapAreas.map((gap) => (
              <ReferenceArea
                key={`${gap.start}-${gap.end}`}
                x1={gap.start}
                x2={gap.end}
                fill={chartTheme.gapFill}
                fillOpacity={0.72}
                strokeOpacity={0}
                label={{
                  value: 'No data',
                  position: 'insideTop',
                  fill: chartTheme.textMuted,
                  fontSize: 10,
                }}
              />
            ))}
            <Tooltip
              isAnimationActive={false}
              labelFormatter={(timestamp) => new Date(timestamp).toLocaleString()}
              formatter={(value) => [formatAxisValue(value), displayedMetricName]}
              cursor={{ stroke: chartTheme.line, strokeWidth: 1 }}
              contentStyle={{
                backgroundColor: chartTheme.tooltipBg,
                borderColor: chartTheme.tooltipBorder,
                color: chartTheme.text,
              }}
              labelStyle={{ color: chartTheme.text }}
              itemStyle={{ color: chartTheme.text }}
            />
            <Line
              type="linear"
              dataKey="value"
              name={displayedMetricName}
              stroke={chartTheme.line}
              strokeWidth={2}
              isAnimationActive={false}
              connectNulls={false}
              dot={plottedData.length <= 80 ? { r: 3, fill: chartTheme.line } : false}
              activeDot={{ r: 5, fill: chartTheme.lineActive, stroke: chartTheme.surface, strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
        {canZoom && (
          <div
            className="uns-sql-chart-scrollbar"
            ref={scrollbarTrackRef}
            role="scrollbar"
            aria-controls="uns-chart-view"
            aria-valuenow={startIndex}
            aria-valuemin={0}
            aria-valuemax={totalPoints - viewRange}
            aria-label="Chart time range"
            onMouseDown={(e) => {
              if (!scrollbarTrackRef.current || e.button !== 0) return;
              const rect = scrollbarTrackRef.current.getBoundingClientRect();
              const clickX = e.clientX - rect.left;
              const trackWidth = rect.width;
              const thumbLeftPct = (startIndex / totalPoints) * 100;
              const thumbWidthPct = (viewRange / totalPoints) * 100;
              const clickPct = (clickX / trackWidth) * 100;
              // If click is on the thumb, start drag
              if (clickPct >= thumbLeftPct && clickPct <= thumbLeftPct + thumbWidthPct) {
                e.preventDefault();
                isScrollbarDraggingRef.current = true;
                scrollbarDragStartXRef.current = e.clientX;
                scrollbarDragStartViewRef.current = { start: startIndex, end: endIndex };
              } else {
                // Click on track: center view on clicked position
                const targetStart = Math.round((clickPct / 100) * totalPoints - viewRange / 2);
                const newStart = Math.max(0, Math.min(targetStart, totalPoints - viewRange));
                const newEnd = Math.min(totalPoints - 1, newStart + viewRange - 1);
                setChartViewStart(newStart);
                setChartViewEnd(newEnd);
              }
            }}
          >
            <div
              className="uns-sql-chart-scrollbar-thumb"
              style={{
                left: `${(startIndex / totalPoints) * 100}%`,
                width: `${(viewRange / totalPoints) * 100}%`,
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                if (e.button !== 0) return;
                e.preventDefault();
                isScrollbarDraggingRef.current = true;
                scrollbarDragStartXRef.current = e.clientX;
                scrollbarDragStartViewRef.current = { start: startIndex, end: endIndex };
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
});

UNSLineChart.displayName = 'UNSLineChart';

export const getUNSNumericColumns = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0 || !rows[0] || typeof rows[0] !== 'object') {
    return [];
  }

  return Object.keys(rows[0]).filter((key) => {
    if (['row_id', 'tsd_name', 'tsd_id', 'insert_timestamp', 'timestamp'].includes(key)) return false;
    return rows.some((row) => {
      const value = row?.[key];
      if (value == null || value === '') return false;
      return typeof value === 'number' || !Number.isNaN(parseFloat(value));
    });
  });
};

export const getUNSEffectiveYKey = ({ data, chartYKey, preferredColumn }) => {
  const candidates = getUNSNumericColumns(data);
  if (chartYKey && candidates.includes(chartYKey)) return chartYKey;
  if (preferredColumn && candidates.includes(preferredColumn)) return preferredColumn;
  return candidates[0] || null;
};

export default UNSLineChart;
