import React, { useState, useEffect, useRef } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import './UNSPage.css';
import UNSSidePanel from './UNSSidePanel';

const API_URL = window._env_?.REACT_APP_API_URL || "http://localhost:8000";

const UNSPage = ({ node }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentPath, setCurrentPath] = useState([]); // Array of {id, name, data}
  const [layers, setLayers] = useState([]); // Array of arrays, each array is a layer of items
  const [expandedItems, setExpandedItems] = useState(new Set()); // Track which items are expanded
  const [itemsWithChildren, setItemsWithChildren] = useState(new Set()); // Cache which items have children
  const [itemsWithoutChildren, setItemsWithoutChildren] = useState(new Set()); // Cache which items don't have children
  const [hoveredItem, setHoveredItem] = useState(null);
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });
  const [hoverTimeout, setHoverTimeout] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null); // Selected item for side panel
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(false); // Side panel visibility
  const [rootQuery, setRootQuery] = useState('blockchain get *'); // Configurable root query
  const [timeRangeValue, setTimeRangeValue] = useState(5); // Time range value (default 5)
  const [timeRangeUnit, setTimeRangeUnit] = useState('minute'); // Time range unit (default: minute)
  const [sqlData, setSqlData] = useState(null); // SQL query results
  const [sqlLoading, setSqlLoading] = useState(false); // SQL query loading state
  const [sqlError, setSqlError] = useState(null); // SQL query error
  const [sqlTab, setSqlTab] = useState('timeRange'); // 'timeRange' or 'advanced'
  const [customSqlQuery, setCustomSqlQuery] = useState(''); // Custom SQL query text
  const [chartYKey, setChartYKey] = useState(null); // Selected value column for line chart
  const [chartViewStart, setChartViewStart] = useState(0); // Zoom/pan: start index (0 = beginning)
  const [chartViewEnd, setChartViewEnd] = useState(null); // Zoom/pan: end index (null = full range)
  const chartContainerRef = useRef(null); // Ref for chart container to attach mouse events
  const isDraggingRef = useRef(false); // Track if user is dragging
  const dragStartXRef = useRef(0); // Mouse X position when drag started
  const dragStartViewRef = useRef({ start: 0, end: 0 }); // View range when drag started
  const chartDataRef = useRef(null); // Ref to current chart data for mouse handlers
  const chartViewRef = useRef({ start: 0, end: 0, range: 0, total: 0 }); // Ref to current view state
  const [itemsWithData, setItemsWithData] = useState(new Map()); // Cache: item key (dbms:table) -> has_data (boolean)
  const [checkingData, setCheckingData] = useState(new Set()); // Track items currently being checked
  const checkTimeoutsRef = useRef([]); // Track all pending timeout IDs for cleanup
  const [checkingChildren, setCheckingChildren] = useState(new Set()); // Track items currently being checked for children
  const childrenCheckTimeoutsRef = useRef([]); // Track all pending timeout IDs for children checks

  // Load root items on mount or when node changes
  useEffect(() => {
    if (node) {
      loadRootItems();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node]); // Only reload when node changes, not when rootQuery changes

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeout) {
        clearTimeout(hoverTimeout);
      }
    };
  }, [hoverTimeout]);

  // Reset chart zoom/pan when data or value column changes
  useEffect(() => {
    setChartViewStart(0);
    setChartViewEnd(null);
  }, [sqlData, chartYKey]);

  // Global mouse handlers for smooth drag-to-pan (attached at component level)
  useEffect(() => {
    const handleMove = (e) => {
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
    };
    
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []); // Empty deps - handlers use refs for current values

  // Background check for table data when layers change
  useEffect(() => {
    // Cancel all pending checks from previous layers
    checkTimeoutsRef.current.forEach(timeoutId => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    });
    checkTimeoutsRef.current = [];
    
    // Clear checking state for items not in current layer
    if (layers.length === 0 || !node) {
      setCheckingData(new Set());
      return;
    }

    // Get the current layer (last one)
    const currentLayer = layers[layers.length - 1];
    if (!currentLayer || currentLayer.length === 0) {
      setCheckingData(new Set());
      return;
    }

    // Build set of cache keys for items in current layer
    const currentLayerCacheKeys = new Set();
    for (const item of currentLayer) {
      const itemData = getItemData(item);
      if (itemData && itemData.dbms && itemData.table) {
        const cacheKey = `${itemData.dbms}:${itemData.table}`;
        currentLayerCacheKeys.add(cacheKey);
      }
    }

    // Clear checking state for items not in current layer
    setCheckingData(prev => {
      const newSet = new Set();
      for (const key of prev) {
        if (currentLayerCacheKeys.has(key)) {
          newSet.add(key);
        }
      }
      return newSet;
    });

    // Find items with dbms and table that haven't been checked yet
    const itemsToCheck = [];
    for (const item of currentLayer) {
      const itemData = getItemData(item);
      if (itemData && itemData.dbms && itemData.table) {
        const cacheKey = `${itemData.dbms}:${itemData.table}`;
        // Only check if not already cached and not currently checking
        if (!itemsWithData.has(cacheKey) && !checkingData.has(cacheKey)) {
          itemsToCheck.push({ dbms: itemData.dbms, table: itemData.table, cacheKey });
        }
      }
    }

    // Process items one at a time with a delay to avoid overwhelming the server
    if (itemsToCheck.length > 0) {
      let index = 0;
      let cancelled = false;
      
      const processNext = () => {
        if (cancelled || index >= itemsToCheck.length) return;
        
        const item = itemsToCheck[index];
        checkTableData(item.dbms, item.table).then(() => {
          if (cancelled) return;
          index++;
          // Add a small delay between checks (200ms) to avoid overwhelming the server
          if (index < itemsToCheck.length) {
            const timeoutId = setTimeout(processNext, 200);
            checkTimeoutsRef.current.push(timeoutId);
          }
        });
      };
      
      // Start processing after a short delay
      const initialTimeoutId = setTimeout(processNext, 100);
      checkTimeoutsRef.current.push(initialTimeoutId);
      
      // Cleanup: cancel pending checks if layers change or component unmounts
      return () => {
        cancelled = true;
        checkTimeoutsRef.current.forEach(timeoutId => {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        });
        checkTimeoutsRef.current = [];
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, node]); // Re-check when layers or node changes

  // Background check for children when layers change
  useEffect(() => {
    // Cancel all pending children checks from previous layers
    childrenCheckTimeoutsRef.current.forEach(timeoutId => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    });
    childrenCheckTimeoutsRef.current = [];
    
    if (layers.length === 0 || !node) {
      setCheckingChildren(new Set());
      return;
    }

    // Get the current layer (last one)
    const currentLayer = layers[layers.length - 1];
    if (!currentLayer || currentLayer.length === 0) {
      setCheckingChildren(new Set());
      return;
    }

    // Build set of item IDs in current layer
    const currentLayerItemIds = new Set();
    for (const item of currentLayer) {
      const itemId = getItemId(item);
      if (itemId) {
        currentLayerItemIds.add(itemId);
      }
    }

    // Clear checking state for items not in current layer
    setCheckingChildren(prev => {
      const newSet = new Set();
      for (const itemId of prev) {
        if (currentLayerItemIds.has(itemId)) {
          newSet.add(itemId);
        }
      }
      return newSet;
    });

    // Find items that haven't been checked for children yet
    const itemsToCheck = [];
    for (const item of currentLayer) {
      const itemId = getItemId(item);
      if (itemId) {
        const itemKey = `${layers.length - 1}-${itemId}`;
        // Only check if not already cached and not currently checking
        if (!itemsWithChildren.has(itemKey) && !itemsWithoutChildren.has(itemKey) && !checkingChildren.has(itemId)) {
          itemsToCheck.push({ itemId, itemKey });
        }
      }
    }

    // Process items one at a time with a delay to avoid overwhelming the server
    if (itemsToCheck.length > 0) {
      let index = 0;
      let cancelled = false;
      
      const processNext = () => {
        if (cancelled || index >= itemsToCheck.length) return;
        
        const item = itemsToCheck[index];
        checkItemChildren(item.itemId, item.itemKey).then(() => {
          if (cancelled) return;
          index++;
          // Add a small delay between checks (200ms) to avoid overwhelming the server
          if (index < itemsToCheck.length) {
            const timeoutId = setTimeout(processNext, 200);
            childrenCheckTimeoutsRef.current.push(timeoutId);
          }
        });
      };
      
      // Start processing after a short delay
      const initialTimeoutId = setTimeout(processNext, 100);
      childrenCheckTimeoutsRef.current.push(initialTimeoutId);
      
      // Cleanup: cancel pending checks if layers change or component unmounts
      return () => {
        cancelled = true;
        childrenCheckTimeoutsRef.current.forEach(timeoutId => {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        });
        childrenCheckTimeoutsRef.current = [];
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, node]); // Re-check when layers or node changes

  const loadRootItems = async () => {
    if (!node) {
      setError('No node selected. Please select a node first.');
      return;
    }

    if (!rootQuery.trim()) {
      setError('Root query cannot be empty.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/uns/get-root`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ conn: node, query: rootQuery.trim() }),
      });

      if (!response.ok) {
        throw new Error(`Server responded with status ${response.status}`);
      }

      const result = await response.json();
      
      if (result.success && result.data) {
        // Log the structure for debugging
        console.log('UNS: Root items received:', result.data);
        if (result.data.length > 0) {
          console.log('UNS: First item structure:', result.data[0]);
        }
        
        // Initialize with root layer
        setLayers([result.data]);
        setCurrentPath([]);
        setExpandedItems(new Set());
      } else {
        setError('Failed to load root items');
      }
    } catch (err) {
      console.error('Error loading root items:', err);
      setError(err.message || 'Failed to load root items');
    } finally {
      setLoading(false);
    }
  };

  const getItemId = (item) => {
    if (!item || typeof item !== 'object') {
      return null;
    }
    
    // Handle structure: {key: {data}} - find the nested object first
    const keys = Object.keys(item);
    if (keys.length === 1 && typeof item[keys[0]] === 'object' && !Array.isArray(item[keys[0]])) {
      // This is the {key: {data}} structure
      const nested = item[keys[0]];
      if (nested.id) return nested.id;
    }
    
    // Also check for legacy structures
    if (item.namespace && item.namespace.id) return item.namespace.id;
    if (item.device && item.device.id) return item.device.id;
    if (item.sensor && item.sensor.id) return item.sensor.id;
    if (item.id) return item.id;
    
    return null;
  };

  const getItemName = (item) => {
    if (!item || typeof item !== 'object') {
      return String(item || 'Unknown');
    }
    
    // Handle structure: {key: {data}} - this is the main structure
    const keys = Object.keys(item);
    if (keys.length === 1 && typeof item[keys[0]] === 'object' && !Array.isArray(item[keys[0]])) {
      // This is the {key: {data}} structure - extract from nested object
      const nested = item[keys[0]];
      // First try 'name' field (preferred)
      if (nested.name) return nested.name;
      // Then try 'id' field
      if (nested.id) return nested.id;
    }
    
    // Legacy structures (namespace, device, sensor)
    if (item.namespace) {
      if (item.namespace.name) return item.namespace.name;
      if (item.namespace.id) return item.namespace.id;
    }
    if (item.device) {
      if (item.device.name) return item.device.name;
      if (item.device.id) return item.device.id;
    }
    if (item.sensor) {
      if (item.sensor.name) return item.sensor.name;
      if (item.sensor.id) return item.sensor.id;
    }
    
    // Check top-level fields
    if (item.name) return item.name;
    if (item.id) return item.id;
    
    // Check all keys for nested objects that might have name/id
    for (const key of keys) {
      if (item[key] && typeof item[key] === 'object' && !Array.isArray(item[key])) {
        const nested = item[key];
        if (nested.name) return nested.name;
        if (nested.id) return nested.id;
      }
    }
    
    // Last resort: use the first meaningful string value
    for (const key of keys) {
      if (typeof item[key] === 'string' && item[key].trim() && key !== 'date' && key !== 'ledger') {
        return item[key];
      }
    }
    
    // If we have a single key, use that as the name
    if (keys.length === 1) {
      return keys[0];
    }
    
    // Final fallback - use a truncated JSON representation
    const jsonStr = JSON.stringify(item);
    if (jsonStr.length > 0) {
      return jsonStr.substring(0, 30) + (jsonStr.length > 30 ? '...' : '');
    }
    
    return 'Unknown';
  };

  const getItemType = (item) => {
    if (!item || typeof item !== 'object') {
      return 'unknown';
    }
    
    // Handle structure: {key: {data}} - use the key as the type
    const keys = Object.keys(item);
    if (keys.length === 1 && typeof item[keys[0]] === 'object' && !Array.isArray(item[keys[0]])) {
      return keys[0]; // Return the key (config, master, license, cluster, operator, table, etc.)
    }
    
    // Legacy structures
    if (item.namespace) return 'namespace';
    if (item.device) return 'device';
    if (item.sensor) return 'sensor';
    
    return 'unknown';
  };

  const getItemData = (item) => {
    if (!item || typeof item !== 'object') {
      return item;
    }
    
    // Handle structure: {key: {data}} - return the nested data object
    const keys = Object.keys(item);
    if (keys.length === 1 && typeof item[keys[0]] === 'object' && !Array.isArray(item[keys[0]])) {
      return item[keys[0]]; // Return the nested data object
    }
    
    // Legacy structures
    if (item.namespace) return item.namespace;
    if (item.device) return item.device;
    if (item.sensor) return item.sensor;
    
    return item;
  };

  const hasChildren = async (itemId) => {
    // Check if item has children by trying to fetch them
    try {
      const response = await fetch(`${API_URL}/uns/get-children`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ conn: node, item_id: itemId }),
      });

      if (!response.ok) return false;

      const result = await response.json();
      return result.success && result.data && result.data.length > 0;
    } catch {
      return false;
    }
  };

  const checkItemChildren = async (itemId, itemKey) => {
    if (!node || !itemId) return false;
    
    // If already cached, return cached value
    if (itemsWithChildren.has(itemKey)) {
      return true;
    }
    if (itemsWithoutChildren.has(itemKey)) {
      return false;
    }
    
    // If currently checking, return null (don't check again)
    if (checkingChildren.has(itemId)) {
      return null;
    }
    
    // Mark as checking
    setCheckingChildren(prev => new Set(prev).add(itemId));
    
    try {
      const response = await fetch(`${API_URL}/uns/check-children`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conn: node,
          item_id: itemId
        }),
      });

      if (!response.ok) {
        throw new Error(`Server responded with status ${response.status}`);
      }

      const result = await response.json();
      
      // Only consider it has_children if success is True AND has_children is True
      const hasChildren = result.success === true && result.has_children === true;
      
      // Cache the result
      if (result.success !== undefined) {
        if (hasChildren) {
          setItemsWithChildren(prev => new Set(prev).add(itemKey));
        } else {
          setItemsWithoutChildren(prev => new Set(prev).add(itemKey));
        }
      }
      
      return hasChildren;
    } catch (err) {
      console.error('Error checking children:', err);
      // On error, assume no children and cache that
      setItemsWithoutChildren(prev => new Set(prev).add(itemKey));
      return false;
    } finally {
      // Remove from checking set
      setCheckingChildren(prev => {
        const newSet = new Set(prev);
        newSet.delete(itemId);
        return newSet;
      });
    }
  };

  const expandItem = async (item, layerIndex) => {
    const itemId = getItemId(item);
    if (!itemId) {
      console.log('UNS: Cannot expand item - no ID found:', item);
      return;
    }

    const expandedKey = `${layerIndex}-${itemId}`;
    
    // If already expanded, collapse it
    if (expandedItems.has(expandedKey)) {
      const newExpanded = new Set(expandedItems);
      newExpanded.delete(expandedKey);
      setExpandedItems(newExpanded);
      
      // Remove layers after this one
      const newLayers = layers.slice(0, layerIndex + 1);
      setLayers(newLayers);
      setCurrentPath(currentPath.slice(0, layerIndex));
      // Scroll to top when collapsing
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setLoading(true);
    setError(null);

    // Log the command being sent
    const command = `blockchain get * where [id] = "${itemId}" bring.children`;
    console.log('UNS: Clicking on item:', {
      itemId: itemId,
      itemName: getItemName(item),
      itemType: getItemType(item),
      command: command,
      connection: node
    });

    try {
      const response = await fetch(`${API_URL}/uns/get-children`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ conn: node, item_id: itemId }),
      });

      if (!response.ok) {
        throw new Error(`Server responded with status ${response.status}`);
      }

      const result = await response.json();
      
      console.log('UNS: Response received:', {
        success: result.success,
        dataLength: result.data ? result.data.length : 0,
        hasChildren: result.data && result.data.length > 0
      });
      
      if (result.success && result.data !== undefined) {
        const children = result.data;
        
        // Cache whether this item has children
        const itemKey = `${layerIndex}-${itemId}`;
        if (children && children.length > 0) {
          console.log(`UNS: Item ${itemId} has ${children.length} children`);
          const newHasChildren = new Set(itemsWithChildren);
          newHasChildren.add(itemKey);
          setItemsWithChildren(newHasChildren);
          
          // Mark as expanded
          const newExpanded = new Set(expandedItems);
          newExpanded.add(expandedKey);
          setExpandedItems(newExpanded);

          // Add new layer
          const newLayers = [...layers.slice(0, layerIndex + 1), children];
          setLayers(newLayers);

          // Update path
          const newPath = [...currentPath.slice(0, layerIndex), {
            id: itemId,
            name: getItemName(item),
            data: getItemData(item)
          }];
          setCurrentPath(newPath);
          
          // Scroll to top when expanding to new layer
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          // No children - mark as leaf node
          console.log(`UNS: Item ${itemId} has no children (empty array or undefined)`);
          const newNoChildren = new Set(itemsWithoutChildren);
          newNoChildren.add(itemKey);
          setItemsWithoutChildren(newNoChildren);
        }
      } else {
        setError('Failed to load children');
      }
    } catch (err) {
      console.error('Error expanding item:', err);
      setError(err.message || 'Failed to expand item');
    } finally {
      setLoading(false);
    }
  };

  const navigateToLayer = (targetLayerIndex) => {
    // Navigate back to a specific layer
    const newLayers = layers.slice(0, targetLayerIndex + 1);
    setLayers(newLayers);
    setCurrentPath(currentPath.slice(0, targetLayerIndex));
    
    // Update expanded items to match - only items in the path up to targetLayerIndex
    const newExpanded = new Set();
    const newHasChildren = new Set();
    
    // Mark items in the path as expanded and having children
    for (let i = 0; i < targetLayerIndex; i++) {
      if (i < currentPath.length) {
        const pathItem = currentPath[i];
        const key = `${i}-${pathItem.id}`;
        newExpanded.add(key);
        newHasChildren.add(key);
      }
    }
    
    setExpandedItems(newExpanded);
    // Merge with existing itemsWithChildren to preserve cache
    const mergedHasChildren = new Set([...itemsWithChildren, ...newHasChildren]);
    setItemsWithChildren(mergedHasChildren);
    // Keep itemsWithoutChildren as is - we don't need to clear it
    
    // Scroll to top when navigating
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleItemHover = (e, item) => {
    // Clear any existing timeout
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
    }
    
    // Set a timeout to show tooltip after 1 second
    const timeout = setTimeout(() => {
      setHoveredItem(item);
      setHoverPosition({ x: e.clientX, y: e.clientY });
    }, 1000);
    
    setHoverTimeout(timeout);
  };

  const handleItemLeave = () => {
    // Clear the timeout if user leaves before 1 second
    if (hoverTimeout) {
      clearTimeout(hoverTimeout);
      setHoverTimeout(null);
    }
    setHoveredItem(null);
  };

  const fetchSqlData = async (dbms, table) => {
    if (!node || !dbms || !table) return;

    setSqlLoading(true);
    setSqlError(null);

    try {
      const response = await fetch(`${API_URL}/uns/query-table`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conn: node,
          dbms: dbms,
          table: table,
          time_value: timeRangeValue,
          time_unit: timeRangeUnit
        }),
      });

      if (!response.ok) {
        throw new Error(`Server responded with status ${response.status}`);
      }

      const result = await response.json();
      
      console.log('UNS: SQL query result:', {
        success: result.success,
        dataLength: result.data ? result.data.length : 0,
        dataType: Array.isArray(result.data) ? 'array' : typeof result.data
      });
      
      if (result.success) {
        console.log(`UNS: Setting ${result.data ? result.data.length : 0} rows in state`);
        setSqlData(result.data);
      } else {
        // Check if it's a "no data" error or a real error
        const errorMsg = result.error || '';
        const isNoDataError = errorMsg.toLowerCase().includes('failed to load table metadata') ||
                             errorMsg.toLowerCase().includes('connection broken') ||
                             errorMsg.toLowerCase().includes('invalidchunklength') ||
                             errorMsg.toLowerCase().includes('invalid literal') ||
                             errorMsg.toLowerCase().includes('err_code') ||
                             !errorMsg; // Empty error usually means no data
        
        if (isNoDataError) {
          setSqlError('There is no table/data at this location');
        } else {
          setSqlError(result.error || 'Failed to fetch table data');
        }
      }
    } catch (err) {
      console.error('Error fetching SQL data:', err);
      // Check if it's a "no data" error
      const errorMsg = err.message || '';
      const isNoDataError = errorMsg.toLowerCase().includes('failed to load table metadata') ||
                           errorMsg.toLowerCase().includes('connection broken') ||
                           errorMsg.toLowerCase().includes('invalidchunklength') ||
                           errorMsg.toLowerCase().includes('invalid literal') ||
                           errorMsg.toLowerCase().includes('err_code');
      
      if (isNoDataError) {
        setSqlError('There is no table/data at this location');
      } else {
        setSqlError(err.message || 'Failed to fetch table data');
      }
    } finally {
      setSqlLoading(false);
    }
  };

  const fetchCustomSqlData = async (dbms, sqlQuery) => {
    if (!node || !dbms || !sqlQuery.trim()) return;

    setSqlLoading(true);
    setSqlError(null);

    try {
      const response = await fetch(`${API_URL}/uns/query-custom`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conn: node,
          dbms: dbms,
          sql_query: sqlQuery.trim()
        }),
      });

      if (!response.ok) {
        throw new Error(`Server responded with status ${response.status}`);
      }

      const result = await response.json();
      
      console.log('UNS: Custom SQL query result:', {
        success: result.success,
        dataLength: result.data ? result.data.length : 0,
        dataType: Array.isArray(result.data) ? 'array' : typeof result.data
      });
      
      if (result.success) {
        console.log(`UNS: Setting ${result.data ? result.data.length : 0} rows in state`);
        setSqlData(result.data);
      } else {
        // Check if it's a "no data" error or a real error
        const errorMsg = result.error || '';
        const isNoDataError = errorMsg.toLowerCase().includes('failed to load table metadata') ||
                             errorMsg.toLowerCase().includes('connection broken') ||
                             errorMsg.toLowerCase().includes('invalidchunklength') ||
                             errorMsg.toLowerCase().includes('invalid literal') ||
                             errorMsg.toLowerCase().includes('err_code') ||
                             !errorMsg; // Empty error usually means no data
        
        if (isNoDataError) {
          setSqlError('There is no table/data at this location');
        } else {
          setSqlError(result.error || 'Failed to execute custom SQL query');
        }
      }
    } catch (err) {
      console.error('Error executing custom SQL query:', err);
      // Check if it's a "no data" error
      const errorMsg = err.message || '';
      const isNoDataError = errorMsg.toLowerCase().includes('failed to load table metadata') ||
                           errorMsg.toLowerCase().includes('connection broken') ||
                           errorMsg.toLowerCase().includes('invalidchunklength') ||
                           errorMsg.toLowerCase().includes('invalid literal') ||
                           errorMsg.toLowerCase().includes('err_code');
      
      if (isNoDataError) {
        setSqlError('There is no table/data at this location');
      } else {
        setSqlError(err.message || 'Failed to execute custom SQL query');
      }
    } finally {
      setSqlLoading(false);
    }
  };

  const checkTableData = async (dbms, table) => {
    if (!node || !dbms || !table) return false;
    
    // Create a cache key
    const cacheKey = `${dbms}:${table}`;
    
    // If already cached, return cached value
    if (itemsWithData.has(cacheKey)) {
      return itemsWithData.get(cacheKey);
    }
    
    // If currently checking, return null (don't check again)
    if (checkingData.has(cacheKey)) {
      return null;
    }
    
    // Mark as checking
    setCheckingData(prev => new Set(prev).add(cacheKey));
    
    try {
      const response = await fetch(`${API_URL}/uns/check-table`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conn: node,
          dbms: dbms,
          table: table
        }),
      });

      if (!response.ok) {
        throw new Error(`Server responded with status ${response.status}`);
      }

      const result = await response.json();
      
      // Only consider it has_data if success is True AND has_data is True
      // If success is False or has_data is False, treat as no data
      const hasData = result.success === true && result.has_data === true;
      
      // Only cache if we got a definitive result (true or false)
      // Don't cache errors or undefined states
      if (result.success !== undefined) {
        setItemsWithData(prev => {
          const newMap = new Map(prev);
          // Only cache true values - false means no data, don't cache false to allow re-checking
          // Actually, let's cache false too so we don't keep re-checking failed tables
          newMap.set(cacheKey, hasData);
          return newMap;
        });
      }
      
      return hasData;
    } catch (err) {
      console.error('Error checking table data:', err);
      // On any error (network, parsing, etc.), assume no data and cache that
      setItemsWithData(prev => {
        const newMap = new Map(prev);
        newMap.set(cacheKey, false);
        return newMap;
      });
      return false;
    } finally {
      // Remove from checking set
      setCheckingData(prev => {
        const newSet = new Set(prev);
        newSet.delete(cacheKey);
        return newSet;
      });
    }
  };

  const toggleSidePanel = (item) => {
    const itemId = getItemId(item);
    const isCurrentlySelected = selectedItem && getItemId(selectedItem) === itemId;
    
    // If clicking on the already selected item and panel is open, close it
    if (isCurrentlySelected && isSidePanelOpen) {
      setIsSidePanelOpen(false);
      setSelectedItem(null);
      setSqlData(null);
      setSqlError(null);
      setCustomSqlQuery('');
      setSqlTab('timeRange');
    } else {
      // Otherwise, open/update the side panel with this item
      setSelectedItem(item);
      setIsSidePanelOpen(true);
      setSqlData(null);
      setSqlError(null);
      setCustomSqlQuery(''); // Clear custom query when opening new item
      setSqlTab('timeRange'); // Reset to time range tab
      
      // Check if item has dbms and table, then fetch SQL data
      const itemData = getItemData(item);
      if (itemData && itemData.dbms && itemData.table) {
        fetchSqlData(itemData.dbms, itemData.table);
        // Note: Data checking happens automatically in background via useEffect
      }
    }
  };

  const renderItem = (item, layerIndex, itemIndex) => {
    const itemId = getItemId(item);
    const itemName = getItemName(item);
    const itemType = getItemType(item);
    const itemData = getItemData(item);
    const expandedKey = `${layerIndex}-${itemId}`;
    const itemKey = `${layerIndex}-${itemId}`;
    const isExpanded = expandedItems.has(expandedKey);
    
    // Check if this item has children
    // If we've already checked and it has no children, it's a leaf
    const hasNoChildren = itemsWithoutChildren.has(itemKey);
    // If we've already checked and it has children, or if it's expanded (meaning we loaded children), it has children
    const hasChildren = itemsWithChildren.has(itemKey) || isExpanded;
    // Check if currently checking for children
    const isCheckingChildren = checkingChildren.has(itemId);
    
    // Check if item has table data (for visual indicator)
    const hasTable = itemData && itemData.dbms && itemData.table;
    const tableCacheKey = hasTable ? `${itemData.dbms}:${itemData.table}` : null;
    const hasData = tableCacheKey ? (itemsWithData.get(tableCacheKey) ?? null) : null;
    const isCheckingData = tableCacheKey ? checkingData.has(tableCacheKey) : false;
    
    // Determine icon based on whether item has children
    let icon = '📄'; // Default file icon
    if (hasChildren) {
      icon = isExpanded ? '📂' : '📁'; // Folder icons (open/closed)
    } else if (hasNoChildren) {
      // Item confirmed to have no children - use file icon
      icon = '📄';
    } else if (isCheckingChildren) {
      // Still checking - show folder icon as placeholder (will update when check completes)
      icon = '📁';
    } else {
      // Not checked yet - show folder icon as default (will be updated when background check completes)
      icon = '📁';
    }

    const handleItemClick = (e) => {
      // Left click: only expand/collapse if item has children or might have children
      // Don't expand if clicking on the info button
      if ((hasChildren || !hasNoChildren) && !e.target.closest('.uns-item-info-btn')) {
        expandItem(item, layerIndex);
      }
    };

    const handleItemRightClick = (e) => {
      // Right click: toggle side panel with item details
      e.preventDefault(); // Prevent default browser context menu
      toggleSidePanel(item);
    };

    const handleInfoButtonClick = (e) => {
      // Info button click: toggle side panel with item details
      e.stopPropagation(); // Prevent triggering the item click
      toggleSidePanel(item);
    };

    const isSelected = selectedItem && getItemId(selectedItem) === itemId;
    
    // Add data indicator class ONLY if item definitively has data (true)
    // Don't add any class if hasData is false or null (no data or not checked)
    const dataIndicatorClass = hasData === true ? 'has-data' : '';
    const checkingClass = isCheckingData ? 'checking-data' : '';

    return (
      <div
        key={`${layerIndex}-${itemIndex}-${itemId}`}
        className={`uns-item ${isExpanded ? 'expanded' : ''} ${isSelected ? 'selected' : ''} ${dataIndicatorClass} ${checkingClass}`}
        onMouseEnter={(e) => handleItemHover(e, item)}
        onMouseLeave={handleItemLeave}
        onClick={handleItemClick}
        onContextMenu={handleItemRightClick}
        style={{ cursor: (hasChildren || !hasNoChildren) ? 'pointer' : 'default' }}
      >
        <div className="uns-item-icon">
          {icon}
        </div>
        <div className="uns-item-name">
          {itemName}
          {/* Only show data indicator if we have a definitive result (true = has data) */}
          {/* Don't show anything if hasData is false or null (no data or not checked yet) */}
          {hasTable && hasData === true && (
            <span className="uns-item-data-indicator" title="Table has data"> 💾</span>
          )}
          {hasTable && isCheckingData && (
            <span className="uns-item-data-indicator checking" title="Checking for data..."> ⏳</span>
          )}
        </div>
        <div className="uns-item-actions">
          <button
            className="uns-item-info-btn"
            onClick={handleInfoButtonClick}
            title="View item details"
            aria-label="View item details"
          >
            ℹ️
          </button>
          {(hasChildren || !hasNoChildren) && (
            <div className="uns-item-expand">
              {isExpanded ? '▼' : '▶'}
            </div>
          )}
        </div>
      </div>
    );
  };

  const navigateToRoot = () => {
    // Reset to root
    if (layers.length > 0) {
      setLayers([layers[0]]);
      setCurrentPath([]);
      setExpandedItems(new Set());
      // Clear children cache when going to root (optional - you might want to keep it)
      // setItemsWithChildren(new Set());
      // setItemsWithoutChildren(new Set());
    }
    // Scroll to top when going to root
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const renderBreadcrumb = () => {
    if (currentPath.length === 0) return null;

    return (
      <div className="uns-breadcrumb">
        <button 
          className="uns-breadcrumb-item" 
          onClick={navigateToRoot}
        >
          🏠 Root
        </button>
        {currentPath.map((pathItem, index) => {
          // The breadcrumb index corresponds to layer index + 1
          // path[0] shows layer 1, path[1] shows layer 2, etc.
          const targetLayerIndex = index + 1;
          const isCurrentLayer = targetLayerIndex === layers.length - 1;
          
          return (
            <React.Fragment key={index}>
              <span className="uns-breadcrumb-separator">/</span>
              <button
                className={`uns-breadcrumb-item ${isCurrentLayer ? 'uns-breadcrumb-current' : ''}`}
                onClick={() => {
                  // If clicking on the current layer, do nothing (or could scroll to top)
                  if (!isCurrentLayer) {
                    navigateToLayer(targetLayerIndex);
                  } else {
                    // Already on this layer, just scroll to top
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }
                }}
                style={{ 
                  cursor: isCurrentLayer ? 'default' : 'pointer',
                  fontWeight: isCurrentLayer ? 'bold' : 'normal'
                }}
              >
                {pathItem.name}
              </button>
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  // Helper to render an interactive line chart from SQL data using insert_timestamp as X and a selectable numeric column as Y
  const renderSqlLineChart = () => {
    if (!sqlData || !Array.isArray(sqlData) || sqlData.length === 0) {
      return null;
    }

    const firstRow = sqlData[0];
    if (!firstRow || !('insert_timestamp' in firstRow)) {
      return null;
    }

    const valueCandidates = Object.keys(firstRow).filter((key) => {
      if (['row_id', 'tsd_name', 'tsd_id', 'insert_timestamp'].includes(key)) return false;
      const v = firstRow[key];
      if (typeof v === 'number') return true;
      return !Number.isNaN(parseFloat(v));
    });

    if (valueCandidates.length === 0) {
      return null;
    }

    const effectiveYKey = chartYKey && valueCandidates.includes(chartYKey)
      ? chartYKey
      : valueCandidates[0];

    // Build chart data for Recharts: [{ time, value, fullTime }] sorted by time
    const chartData = sqlData
      .map((row) => {
        const tsRaw = row.insert_timestamp;
        const t = Date.parse(tsRaw);
        const vRaw = row[effectiveYKey];
        const v = typeof vRaw === 'number' ? vRaw : parseFloat(vRaw);
        if (Number.isNaN(t) || Number.isNaN(v)) return null;
        const d = new Date(t);
        const timeLabel = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return {
          time: timeLabel,
          value: v,
          fullTime: d.toLocaleString(),
        };
      })
      .filter((p) => p !== null)
      .sort((a, b) => new Date(a.fullTime) - new Date(b.fullTime));

    if (chartData.length === 0) {
      return null;
    }

    const ZOOM_THRESHOLD = 50; // Show zoom/pan controls when more than this many points
    const canZoom = chartData.length > ZOOM_THRESHOLD;
    const totalPoints = chartData.length;
    const endIndex = chartViewEnd != null ? Math.min(chartViewEnd, totalPoints - 1) : totalPoints - 1;
    const startIndex = Math.max(0, Math.min(chartViewStart, endIndex - 1));
    const displayedData = canZoom ? chartData.slice(startIndex, endIndex + 1) : chartData;
    const viewRange = endIndex - startIndex + 1;
    
    // Update refs for mouse handlers
    chartDataRef.current = chartData;
    chartViewRef.current = { start: startIndex, end: endIndex, range: viewRange, total: totalPoints };

    const CustomTooltip = ({ active, payload }) => {
      if (!active || !payload || !payload.length) return null;
      const point = payload[0].payload;
      return (
        <div className="uns-chart-tooltip">
          <div className="uns-chart-tooltip-time">{point.fullTime}</div>
          <div className="uns-chart-tooltip-value">
            {effectiveYKey}: <strong>{Number(point.value).toLocaleString()}</strong>
          </div>
        </div>
      );
    };

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




    return (
      <div className="uns-sql-chart">
        <div className="uns-sql-chart-header">
          <span>Line Chart</span>
          <div className="uns-sql-chart-controls">
            <label htmlFor="uns-sql-chart-ykey">Value column:</label>
            <select
              id="uns-sql-chart-ykey"
              value={effectiveYKey}
              onChange={(e) => setChartYKey(e.target.value)}
            >
              {valueCandidates.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
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
                <span className="uns-sql-chart-zoom-hint">Hold and drag to move</span>
              </>
            )}
          </div>
        </div>
        <div 
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
              data={displayedData}
              margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e9ecef" />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 11 }}
                stroke="#6c757d"
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke="#6c757d"
                tickFormatter={(v) => (Number.isInteger(v) ? v : v.toFixed(2))}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#007bff', strokeWidth: 1 }} />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#007bff"
                strokeWidth={2}
                dot={displayedData.length <= 80 ? { r: 3, fill: '#007bff' } : false}
                activeDot={{ r: 5, fill: '#0056b3', stroke: '#fff', strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  return (
    <div className="uns-container">
      <div className="uns-header">
        <h1>Unified Namespace (UNS)</h1>
        <div className="uns-header-controls">
          <div className="uns-query-input-group">
            <label htmlFor="root-query" className="uns-query-label">Root Query:</label>
            <input
              id="root-query"
              type="text"
              value={rootQuery}
              onChange={(e) => setRootQuery(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === 'Enter' && !loading && node) {
                  loadRootItems();
                }
              }}
              placeholder="blockchain get *"
              className="uns-query-input"
              disabled={loading}
            />
          </div>
          <button 
            onClick={loadRootItems} 
            disabled={loading || !node || !rootQuery.trim()}
            className="uns-refresh-btn"
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {!node && (
        <div className="uns-error">
          ⚠️ No node selected. Please select a node first.
        </div>
      )}

      {error && (
        <div className="uns-error">
          ❌ Error: {error}
        </div>
      )}

      <div className={`uns-main-content ${isSidePanelOpen ? 'uns-panel-open' : ''}`}>
        <div className="uns-main-content-wrapper">
          {renderBreadcrumb()}

          <div className="uns-layers">
        {layers.length > 0 && (() => {
          // Only show the current layer (the last one)
          const currentLayerIndex = layers.length - 1;
          const currentLayer = layers[currentLayerIndex];
          const layerName = currentLayerIndex === 0 
            ? 'Root' 
            : (currentPath[currentLayerIndex - 1]?.name || `Layer ${currentLayerIndex}`);
          
          return (
            <div key={currentLayerIndex} className="uns-layer">
              <div className="uns-layer-header">
                {layerName}
              </div>
              <div className="uns-layer-content">
                {loading ? (
                  <div className="uns-loading">Loading...</div>
                ) : currentLayer.length === 0 ? (
                  <div className="uns-empty">No items found</div>
                ) : (
                  currentLayer.map((item, itemIndex) => renderItem(item, currentLayerIndex, itemIndex))
                )}
              </div>
            </div>
          );
        })()}
          </div>
        </div>

        {/* Side Panel for detailed view */}
        <UNSSidePanel
          isOpen={isSidePanelOpen}
          selectedItem={selectedItem}
          sqlData={sqlData}
          sqlLoading={sqlLoading}
          sqlError={sqlError}
          sqlTab={sqlTab}
          timeRangeValue={timeRangeValue}
          timeRangeUnit={timeRangeUnit}
          customSqlQuery={customSqlQuery}
          onClose={() => {
            setIsSidePanelOpen(false);
            setSelectedItem(null);
            setSqlData(null);
            setSqlError(null);
            setCustomSqlQuery('');
            setSqlTab('timeRange');
          }}
          onTimeRangeValueChange={setTimeRangeValue}
          onTimeRangeUnitChange={setTimeRangeUnit}
          onFetchTimeRange={fetchSqlData}
          onTabChange={setSqlTab}
          onCustomQueryChange={setCustomSqlQuery}
          onExecuteCustomQuery={fetchCustomSqlData}
          getItemName={getItemName}
          getItemType={getItemType}
          getItemId={getItemId}
          getItemData={getItemData}
          renderSqlLineChart={renderSqlLineChart}
        />
      </div>

      {hoveredItem && (
        <div
          className="uns-tooltip"
          style={{
            left: `${hoverPosition.x + 10}px`,
            top: `${hoverPosition.y + 10}px`
          }}
        >
          <div className="uns-tooltip-header">
            <strong>{getItemName(hoveredItem)}</strong>
            <span className="uns-tooltip-type">({getItemType(hoveredItem)})</span>
          </div>
          <div className="uns-tooltip-content">
            <pre>{JSON.stringify(getItemData(hoveredItem), null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
};

// Plugin metadata
export const pluginMetadata = {
  name: 'Unified Namespace',
  icon: null
};

export default UNSPage;

