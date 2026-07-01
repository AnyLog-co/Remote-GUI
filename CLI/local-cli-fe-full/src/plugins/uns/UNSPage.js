import React, { useState, useEffect, useRef } from 'react';
import './UNSPage.css';
import UNSSidePanel from './UNSSidePanel';
import UNSCompareGraphs from './UNSCompareGraphs';
import { formatDateTimeLocalForBackend, getUNSTimeRangeError } from './UNSTimeUtils';
import { getRoot, getChildren, checkChildren, queryTable, checkTable } from './uns_api';

const ROOT_QUERY_UNS_DATA = 'blockchain get root policies exclude cluster';
const ROOT_QUERY_UNS_CLUSTERS = 'blockchain get root policies include cluster';
const UNS_NAVIGATION_STORAGE_KEY = 'uns-navigation-state';
const UNS_COMPARE_STORAGE_KEY = 'uns-compare-graphs-state';
const UNS_COMPARE_CACHE_KIND = 'anylog-uns-compare-cache';
const UNS_COMPARE_CACHE_VERSION = 1;

const isRootGroupItem = (item) => item?.__unsRootGroup === true;

const UNSPage = ({ node }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentPath, setCurrentPath] = useState([]); // Array of {id, key, name, data}
  const [layers, setLayers] = useState([]); // Array of arrays, each array is a layer of items
  const [expandedItems, setExpandedItems] = useState(new Set()); // Track which items are expanded
  const [itemsWithChildren, setItemsWithChildren] = useState(new Set()); // Cache which items have children
  const [itemsWithoutChildren, setItemsWithoutChildren] = useState(new Set()); // Cache which items don't have children
  const [hoveredItem, setHoveredItem] = useState(null);
  const [hoverPosition, setHoverPosition] = useState({ x: 0, y: 0 });
  const [hoverTimeout, setHoverTimeout] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null); // Selected item for side panel
  const [isSidePanelOpen, setIsSidePanelOpen] = useState(false); // Side panel visibility
  const [rootQuery, setRootQuery] = useState(ROOT_QUERY_UNS_DATA); // Configurable root query
  const [executedRootQuery, setExecutedRootQuery] = useState(ROOT_QUERY_UNS_DATA);
  const [showingClusters, setShowingClusters] = useState(false);
  const [timeRangeValue, setTimeRangeValue] = useState(5); // Time range value (default 5)
  const [timeRangeUnit, setTimeRangeUnit] = useState('minute'); // Time range unit (default: minute)
  const [timeMode, setTimeMode] = useState('relative');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [timeRangeErrorDismissed, setTimeRangeErrorDismissed] = useState(false);
  const [timeColumn, setTimeColumn] = useState('timestamp'); // Time column: timestamp or insert_timestamp
  const [sqlData, setSqlData] = useState(null); // SQL query results
  const [sqlColumns, setSqlColumns] = useState([]); // SQL table columns
  const [sqlLoading, setSqlLoading] = useState(false); // SQL query loading state
  const [sqlError, setSqlError] = useState(null); // SQL query error
  const [chartYKey, setChartYKey] = useState(null); // Selected value column for line chart
  const [compareGraphs, setCompareGraphs] = useState([]);
  const [activeCompareGraphId, setActiveCompareGraphId] = useState(null);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [compareCacheMessage, setCompareCacheMessage] = useState('');
  const [itemsWithData, setItemsWithData] = useState(new Map()); // Cache: item key (dbms:table) -> has_data (boolean)
  const [checkingData, setCheckingData] = useState(new Set()); // Track items currently being checked
  const checkTimeoutsRef = useRef([]); // Track all pending timeout IDs for cleanup
  const [checkingChildren, setCheckingChildren] = useState(new Set()); // Track items currently being checked for children
  const childrenCheckTimeoutsRef = useRef([]); // Track all pending timeout IDs for children checks
  const autoExpandedItemsRef = useRef(new Set());
  const sidePanelAnchorRef = useRef(null);
  const [compareCacheReady, setCompareCacheReady] = useState(false);

  // Load root items on mount or when node changes
  useEffect(() => {
    setCompareCacheReady(false);
    setCompareCacheMessage('');
    if (node) {
      if (!restoreNavigationState(node)) {
        loadRootItems();
      }
      restoreCompareState(node);
    } else {
      setCompareGraphs([]);
      setActiveCompareGraphId(null);
      setIsCompareOpen(false);
    }
    setCompareCacheReady(true);
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

  useEffect(() => {
    const handleStorageCleared = () => {
      clearCachedNavigationState();
      setCurrentPath([]);
      setLayers([]);
      setExpandedItems(new Set());
      setItemsWithChildren(new Set());
      setItemsWithoutChildren(new Set());
      setSelectedItem(null);
      setIsSidePanelOpen(false);
      setRootQuery(ROOT_QUERY_UNS_DATA);
      setExecutedRootQuery(ROOT_QUERY_UNS_DATA);
      setShowingClusters(false);
      setTimeMode('relative');
      setStartTime('');
      setEndTime('');
      setTimeRangeErrorDismissed(false);
      setCompareGraphs([]);
      setActiveCompareGraphId(null);
      setIsCompareOpen(false);
      setCompareCacheMessage('');
      clearCachedCompareState();
      autoExpandedItemsRef.current = new Set();
    };

    window.addEventListener('uns-storage-cleared', handleStorageCleared);
    return () => {
      window.removeEventListener('uns-storage-cleared', handleStorageCleared);
    };
  }, []);

  useEffect(() => {
    const handleCompareCacheImported = () => {
      if (node) {
        const restored = restoreCompareState(node);
        setCompareCacheMessage(
          restored
            ? 'UNS compare cache imported.'
            : 'UNS compare cache imported for another node.',
        );
      }
    };

    window.addEventListener('uns-compare-cache-imported', handleCompareCacheImported);
    return () => {
      window.removeEventListener('uns-compare-cache-imported', handleCompareCacheImported);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node]);

  useEffect(() => {
    if (!node || layers.length === 0) {
      return;
    }

    cacheNavigationState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, executedRootQuery, showingClusters, layers, currentPath, expandedItems, itemsWithChildren, itemsWithoutChildren]);

  useEffect(() => {
    if (!node || !compareCacheReady) {
      return;
    }

    cacheCompareState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, compareCacheReady, compareGraphs, activeCompareGraphId, isCompareOpen]);

  useEffect(() => {
    if (!isSidePanelOpen || !selectedItem || !sidePanelAnchorRef.current) {
      return undefined;
    }

    const phoneLayout = window.matchMedia('(max-width: 600px)');
    if (!phoneLayout.matches) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      sidePanelAnchorRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isSidePanelOpen, selectedItem]);

  // Background check for table data when layers change
  useEffect(() => {
    // Cancel all pending checks from previous layers
    checkTimeoutsRef.current.forEach((timeoutId) => {
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
      if (isRootGroupItem(item)) {
        continue;
      }

      const itemData = getItemData(item);
      if (itemData && itemData.dbms && itemData.table) {
        const cacheKey = `${itemData.dbms}:${itemData.table}`;
        currentLayerCacheKeys.add(cacheKey);
      }
    }

    // Clear checking state for items not in current layer
    setCheckingData((prev) => {
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
      if (isRootGroupItem(item)) {
        continue;
      }

      const itemData = getItemData(item);
      if (itemData && itemData.dbms && itemData.table) {
        const cacheKey = `${itemData.dbms}:${itemData.table}`;
        // Only check if not already cached and not currently checking
        if (!itemsWithData.has(cacheKey) && !checkingData.has(cacheKey)) {
          itemsToCheck.push({
            dbms: itemData.dbms,
            table: itemData.table,
            cacheKey,
          });
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
        checkTimeoutsRef.current.forEach((timeoutId) => {
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
    childrenCheckTimeoutsRef.current.forEach((timeoutId) => {
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

    // Build set of item keys in current layer
    const currentLayerItemKeys = new Set();
    for (const item of currentLayer) {
      const itemKey = getItemKey(item);
      if (itemKey) {
        currentLayerItemKeys.add(`${layers.length - 1}-${itemKey}`);
      }
    }

    // Clear checking state for items not in current layer
    setCheckingChildren((prev) => {
      const newSet = new Set();
      for (const itemId of prev) {
        if (currentLayerItemKeys.has(itemId)) {
          newSet.add(itemId);
        }
      }
      return newSet;
    });

    // Find items that haven't been checked for children yet
    const itemsToCheck = [];
    for (const item of currentLayer) {
      if (isRootGroupItem(item)) {
        continue;
      }

      const itemId = getItemId(item);
      if (itemId) {
        const itemKey = `${layers.length - 1}-${getItemKey(item)}`;
        // Only check if not already cached and not currently checking
        if (
          !itemsWithChildren.has(itemKey) &&
          !itemsWithoutChildren.has(itemKey) &&
          !checkingChildren.has(itemKey)
        ) {
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
        childrenCheckTimeoutsRef.current.forEach((timeoutId) => {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
        });
        childrenCheckTimeoutsRef.current = [];
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, node]); // Re-check when layers or node changes

  const loadRootItems = async (queryOverride) => {
    if (!node) {
      setError('No node selected. Please select a node first.');
      return;
    }

    const queryToRun = queryOverride ?? rootQuery;

    if (!queryToRun.trim()) {
      setError('Root query cannot be empty.');
      return;
    }

    clearCachedNavigationState();
    autoExpandedItemsRef.current = new Set();
    setLoading(true);
    setError(null);

    try {
      const result = await getRoot(node, queryToRun);

      if (result.success && result.data) {
        // Log the structure for debugging
        console.log('UNS: Root items received:', result.data);
        if (result.data.length > 0) {
          console.log('UNS: First item structure:', result.data[0]);
        }

        // Initialize with one root item per unique policy key returned.
        setLayers([groupRootItems(result.data)]);
        setCurrentPath([]);
        setExpandedItems(new Set());
        setExecutedRootQuery(queryToRun);
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

  const handleToggleRootQuery = () => {
    const nextShowingClusters = !isClusterPath;
    const nextRootQuery = isClusterPath
      ? ROOT_QUERY_UNS_DATA
      : ROOT_QUERY_UNS_CLUSTERS;

    setShowingClusters(nextShowingClusters);
    setRootQuery(nextRootQuery);
    loadRootItems(nextRootQuery);
  };

  const isPathItemCluster = (pathItem) => {
    const values = [
      pathItem?.id,
      pathItem?.key,
      pathItem?.name,
      pathItem?.data?.key,
    ];

    return values.some((value) => {
      const normalized = String(value || '').toLowerCase();
      return normalized === 'cluster' || normalized === 'root:cluster' || normalized.startsWith('cluster:');
    });
  };

  const isClusterPath = currentPath.some(isPathItemCluster);

  const clearCachedNavigationState = () => {
    try {
      window.localStorage.removeItem(UNS_NAVIGATION_STORAGE_KEY);
    } catch {
      // Ignore storage failures; navigation should still work in memory.
    }
  };

  const clearCachedCompareState = () => {
    try {
      window.localStorage.removeItem(UNS_COMPARE_STORAGE_KEY);
    } catch {
      // Ignore storage failures; compare state should still reset in memory.
    }
  };

  const buildCompareCachePayload = (nodes) => ({
    kind: UNS_COMPARE_CACHE_KIND,
    version: UNS_COMPARE_CACHE_VERSION,
    updatedAt: new Date().toISOString(),
    nodes,
  });

  const normalizeCompareCacheNodeEntry = (entry, fallbackNode = '') => {
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.graphs)) {
      return null;
    }

    const graphs = entry.graphs.map(normalizeCompareGraph).filter(Boolean);
    if (graphs.length === 0) {
      return null;
    }

    const activeGraphId = graphs.some((graph) => graph.id === entry.activeGraphId)
      ? entry.activeGraphId
      : graphs[0]?.id || null;

    return {
      node: entry.node || fallbackNode,
      graphs,
      activeGraphId,
      isOpen: Boolean(entry.isOpen && graphs.length > 0),
      updatedAt: entry.updatedAt || new Date().toISOString(),
    };
  };

  const normalizeCompareCachePayload = (payload) => {
    if (!payload || typeof payload !== 'object') {
      return buildCompareCachePayload({});
    }

    // Backward compatibility for the original single-node localStorage shape.
    if (payload.node && Array.isArray(payload.graphs)) {
      const entry = normalizeCompareCacheNodeEntry(payload, payload.node);
      return buildCompareCachePayload(entry ? { [payload.node]: entry } : {});
    }

    const sourceNodes = payload.nodes && typeof payload.nodes === 'object'
      ? payload.nodes
      : {};
    const nodes = {};

    Object.entries(sourceNodes).forEach(([nodeKey, entry]) => {
      const normalizedEntry = normalizeCompareCacheNodeEntry(entry, nodeKey);
      if (normalizedEntry) {
        nodes[nodeKey] = normalizedEntry;
      }
    });

    return buildCompareCachePayload(nodes);
  };

  const readCompareCachePayload = () => {
    try {
      const raw = window.localStorage.getItem(UNS_COMPARE_STORAGE_KEY);
      if (!raw) {
        return buildCompareCachePayload({});
      }

      return normalizeCompareCachePayload(JSON.parse(raw));
    } catch {
      return buildCompareCachePayload({});
    }
  };

  const writeCompareCachePayload = (payload) => {
    const normalizedPayload = normalizeCompareCachePayload(payload);

    try {
      if (Object.keys(normalizedPayload.nodes).length === 0) {
        window.localStorage.removeItem(UNS_COMPARE_STORAGE_KEY);
        return normalizedPayload;
      }

      window.localStorage.setItem(
        UNS_COMPARE_STORAGE_KEY,
        JSON.stringify(normalizedPayload),
      );
      return normalizedPayload;
    } catch {
      // Ignore storage failures; compare state should still work in memory.
      return normalizedPayload;
    }
  };

  const cacheNavigationState = () => {
    try {
      window.localStorage.setItem(
        UNS_NAVIGATION_STORAGE_KEY,
        JSON.stringify({
          node,
          rootQuery: executedRootQuery,
          showingClusters,
          layers,
          currentPath,
          expandedItems: Array.from(expandedItems),
          itemsWithChildren: Array.from(itemsWithChildren),
          itemsWithoutChildren: Array.from(itemsWithoutChildren),
        }),
      );
    } catch {
      // Ignore storage failures; navigation should still work in memory.
    }
  };

  const normalizeCompareGraph = (graph) => {
    if (!graph || typeof graph !== 'object' || !graph.id) {
      return null;
    }

    const sources = Array.isArray(graph.sources)
      ? graph.sources
        .filter((source) => source && source.dbms && source.table)
        .map((source) => ({
          ...source,
          identityKey: source.identityKey || getCompareSourceIdentityFromParts(source),
          data: Array.isArray(source.data) ? source.data : [],
          columns: Array.isArray(source.columns) ? source.columns : [],
          loading: false,
          error: source.error || null,
          needsFetch: source.needsFetch === true && !(Array.isArray(source.data) && source.data.length > 0),
        }))
      : [];

    return {
      ...graph,
      timeRangeValue: graph.timeRangeValue || 5,
      timeRangeUnit: graph.timeRangeUnit || 'minute',
      timeMode: graph.timeMode || 'relative',
      startTime: graph.startTime || '',
      endTime: graph.endTime || '',
      timeColumn: graph.timeColumn || 'timestamp',
      refreshRate: graph.refreshRate || 20,
      liveMode: false,
      timeRangeErrorDismissed: Boolean(graph.timeRangeErrorDismissed),
      sources,
    };
  };

  const cacheCompareState = () => {
    if (!node) {
      return;
    }

    const payload = readCompareCachePayload();
    const nextNodes = { ...payload.nodes };
    const graphs = compareGraphs.map(normalizeCompareGraph).filter(Boolean);

    if (graphs.length === 0) {
      delete nextNodes[node];
      writeCompareCachePayload({ ...payload, nodes: nextNodes });
      return;
    }

    const activeGraphId = graphs.some((graph) => graph.id === activeCompareGraphId)
      ? activeCompareGraphId
      : graphs[0]?.id || null;

    nextNodes[node] = {
      node,
      graphs,
      activeGraphId,
      isOpen: Boolean(isCompareOpen && graphs.length > 0),
      updatedAt: new Date().toISOString(),
    };

    writeCompareCachePayload({ ...payload, nodes: nextNodes });
  };

  const restoreCompareState = (currentNode) => {
    const payload = readCompareCachePayload();
    const saved = payload.nodes[currentNode];

    if (!saved) {
      setCompareGraphs([]);
      setActiveCompareGraphId(null);
      setIsCompareOpen(false);
      return false;
    }

    const savedGraphs = saved.graphs.map(normalizeCompareGraph).filter(Boolean);
    const savedActiveId = savedGraphs.some((graph) => graph.id === saved.activeGraphId)
      ? saved.activeGraphId
      : savedGraphs[0]?.id || null;
    setCompareGraphs(savedGraphs);
    setActiveCompareGraphId(savedActiveId);
    setIsCompareOpen(Boolean(saved.isOpen && savedGraphs.length > 0));

    // Persist any migrated legacy cache into the versioned shape without removing other nodes.
    writeCompareCachePayload(payload);
    return savedGraphs.length > 0;
  };

  const getExportableCompareCachePayload = () => {
    const payload = readCompareCachePayload();
    const nextNodes = { ...payload.nodes };

    if (node) {
      const graphs = compareGraphs.map(normalizeCompareGraph).filter(Boolean);
      if (graphs.length > 0) {
        const activeGraphId = graphs.some((graph) => graph.id === activeCompareGraphId)
          ? activeCompareGraphId
          : graphs[0]?.id || null;

        nextNodes[node] = {
          node,
          graphs,
          activeGraphId,
          isOpen: Boolean(isCompareOpen && graphs.length > 0),
          updatedAt: new Date().toISOString(),
        };
      }
    }

    return {
      ...buildCompareCachePayload(nextNodes),
      exportedAt: new Date().toISOString(),
      activeNode: node || null,
    };
  };

  const appendImportedCompareGraphs = (currentGraphs = [], importedGraphs = []) => {
    const usedIds = new Set(currentGraphs.map((graph) => graph.id).filter(Boolean));
    const idMap = {};
    const appendedGraphs = importedGraphs.map((graph) => {
      const baseId = graph.id || `compare-graph-${Date.now()}`;
      let nextId = baseId;
      let index = 1;

      while (usedIds.has(nextId)) {
        nextId = `${baseId}-import-${index}`;
        index += 1;
      }

      usedIds.add(nextId);
      idMap[graph.id] = nextId;
      return {
        ...graph,
        id: nextId,
      };
    });

    return {
      graphs: [...currentGraphs, ...appendedGraphs],
      idMap,
    };
  };

  const exportCompareCache = () => {
    const payload = getExportableCompareCachePayload();
    const graphCount = Object.values(payload.nodes).reduce((count, entry) => (
      count + (Array.isArray(entry.graphs) ? entry.graphs.length : 0)
    ), 0);

    if (graphCount === 0) {
      setCompareCacheMessage('No compare graph cache to export.');
      return;
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `uns-compare-cache-${date}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setCompareCacheMessage(`Exported ${graphCount} compare graph${graphCount === 1 ? '' : 's'}.`);
  };

  const importCompareCache = async (file) => {
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const importedPayload = normalizeCompareCachePayload(JSON.parse(text));
      const importedNodeEntries = Object.entries(importedPayload.nodes);

      if (importedNodeEntries.length === 0) {
        setCompareCacheMessage('No compare graphs were found in that JSON file.');
        return;
      }

      const currentPayload = readCompareCachePayload();
      const nextNodes = { ...currentPayload.nodes };

      importedNodeEntries.forEach(([nodeKey, entry]) => {
        const currentEntry = nextNodes[nodeKey];
        if (currentEntry?.graphs?.length) {
          const { graphs, idMap } = appendImportedCompareGraphs(
            currentEntry.graphs,
            entry.graphs || [],
          );
          const importedActiveGraphId = idMap[entry.activeGraphId] || entry.activeGraphId;
          nextNodes[nodeKey] = {
            ...currentEntry,
            graphs,
            activeGraphId: currentEntry.activeGraphId || importedActiveGraphId || graphs[0]?.id || null,
            isOpen: Boolean(currentEntry.isOpen || entry.isOpen),
            updatedAt: new Date().toISOString(),
          };
          return;
        }

        nextNodes[nodeKey] = {
          ...entry,
          updatedAt: new Date().toISOString(),
        };
      });

      writeCompareCachePayload({ ...currentPayload, nodes: nextNodes });

      if (node && nextNodes[node]) {
        restoreCompareState(node);
      }

      const graphCount = importedNodeEntries.reduce((count, [, entry]) => (
        count + (Array.isArray(entry.graphs) ? entry.graphs.length : 0)
      ), 0);
      setCompareCacheMessage(
        `Imported ${graphCount} compare graph${graphCount === 1 ? '' : 's'} for ${importedNodeEntries.length} node${importedNodeEntries.length === 1 ? '' : 's'}.`,
      );
      setError(null);
    } catch (importError) {
      setCompareCacheMessage('');
      setError(importError.message || 'Failed to import UNS compare cache JSON.');
    }
  };

  const restoreNavigationState = (currentNode) => {
    try {
      const raw = window.localStorage.getItem(UNS_NAVIGATION_STORAGE_KEY);
      if (!raw) {
        return false;
      }

      const saved = JSON.parse(raw);
      if (!saved || saved.node !== currentNode || !Array.isArray(saved.layers)) {
        clearCachedNavigationState();
        return false;
      }

      const savedRootQuery = saved.rootQuery || ROOT_QUERY_UNS_DATA;
      setRootQuery(savedRootQuery);
      setExecutedRootQuery(savedRootQuery);
      setShowingClusters(Boolean(saved.showingClusters));
      setLayers(saved.layers);
      setCurrentPath(Array.isArray(saved.currentPath) ? saved.currentPath : []);
      setExpandedItems(new Set(Array.isArray(saved.expandedItems) ? saved.expandedItems : []));
      setItemsWithChildren(new Set(Array.isArray(saved.itemsWithChildren) ? saved.itemsWithChildren : []));
      setItemsWithoutChildren(new Set(Array.isArray(saved.itemsWithoutChildren) ? saved.itemsWithoutChildren : []));
      autoExpandedItemsRef.current = new Set(Array.isArray(saved.expandedItems) ? saved.expandedItems : []);
      return true;
    } catch {
      clearCachedNavigationState();
      return false;
    }
  };

  const groupRootItems = (items) => {
    if (!Array.isArray(items)) {
      return [];
    }

    const groups = new Map();

    for (const item of items) {
      const itemType = getItemType(item);
      if (itemType === 'unknown') {
        continue;
      }

      if (!groups.has(itemType)) {
        groups.set(itemType, {
          __unsRootGroup: true,
          key: itemType,
          items: [],
        });
      }

      groups.get(itemType).items.push(item);
    }

    return Array.from(groups.values());
  };

  const getItemId = (item) => {
    if (!item || typeof item !== 'object') {
      return null;
    }

    if (isRootGroupItem(item)) {
      return null;
    }

    // Handle structure: {key: {data}} - find the nested object first
    const keys = Object.keys(item);
    if (
      keys.length === 1 &&
      typeof item[keys[0]] === 'object' &&
      !Array.isArray(item[keys[0]])
    ) {
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

    if (isRootGroupItem(item)) {
      return item.key;
    }

    // Handle structure: {key: {data}} - this is the main structure
    const keys = Object.keys(item);
    if (
      keys.length === 1 &&
      typeof item[keys[0]] === 'object' &&
      !Array.isArray(item[keys[0]])
    ) {
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
      if (
        item[key] &&
        typeof item[key] === 'object' &&
        !Array.isArray(item[key])
      ) {
        const nested = item[key];
        if (nested.name) return nested.name;
        if (nested.id) return nested.id;
      }
    }

    // Last resort: use the first meaningful string value
    for (const key of keys) {
      if (
        typeof item[key] === 'string' &&
        item[key].trim() &&
        key !== 'date' &&
        key !== 'ledger'
      ) {
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

    if (isRootGroupItem(item)) {
      return item.key;
    }

    // Handle structure: {key: {data}} - use the key as the type
    const keys = Object.keys(item);
    if (
      keys.length === 1 &&
      typeof item[keys[0]] === 'object' &&
      !Array.isArray(item[keys[0]])
    ) {
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

    if (isRootGroupItem(item)) {
      return {
        key: item.key,
        count: item.items.length,
      };
    }

    // Handle structure: {key: {data}} - return the nested data object
    const keys = Object.keys(item);
    if (
      keys.length === 1 &&
      typeof item[keys[0]] === 'object' &&
      !Array.isArray(item[keys[0]])
    ) {
      return item[keys[0]]; // Return the nested data object
    }

    // Legacy structures
    if (item.namespace) return item.namespace;
    if (item.device) return item.device;
    if (item.sensor) return item.sensor;

    return item;
  };

  const getItemKey = (item) => {
    if (isRootGroupItem(item)) {
      return `root:${item.key}`;
    }

    const itemType = getItemType(item);
    const itemId = getItemId(item);
    if (itemId) {
      return `${itemType}:${itemId}`;
    }

    return `${itemType}:${getItemName(item)}`;
  };

  const hasChildren = async (itemId) => {
    try {
      const result = await getChildren(node, itemId);
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
    if (checkingChildren.has(itemKey)) {
      return null;
    }

    // Mark as checking
    setCheckingChildren((prev) => new Set(prev).add(itemKey));

    try {
      const result = await checkChildren(node, itemId);

      // Only consider it has_children if success is True AND has_children is True
      const hasChildren =
        result.success === true && result.has_children === true;

      // Cache the result
      if (result.success !== undefined) {
        if (hasChildren) {
          setItemsWithChildren((prev) => new Set(prev).add(itemKey));
        } else {
          setItemsWithoutChildren((prev) => new Set(prev).add(itemKey));
        }
      }

      return hasChildren;
    } catch (err) {
      console.error('Error checking children:', err);
      // On error, assume no children and cache that
      setItemsWithoutChildren((prev) => new Set(prev).add(itemKey));
      return false;
    } finally {
      // Remove from checking set
      setCheckingChildren((prev) => {
        const newSet = new Set(prev);
        newSet.delete(itemKey);
        return newSet;
      });
    }
  };

  const expandItem = async (item, layerIndex) => {
    if (isRootGroupItem(item)) {
      const itemIdentity = getItemKey(item);
      const expandedKey = `${layerIndex}-${itemIdentity}`;

      if (expandedItems.has(expandedKey)) {
        const newExpanded = new Set(expandedItems);
        newExpanded.delete(expandedKey);
        setExpandedItems(newExpanded);
        setLayers(layers.slice(0, layerIndex + 1));
        setCurrentPath(currentPath.slice(0, layerIndex));
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      const itemKey = `${layerIndex}-${itemIdentity}`;
      setItemsWithChildren((prev) => new Set(prev).add(itemKey));
      setExpandedItems((prev) => new Set(prev).add(expandedKey));
      setLayers([...layers.slice(0, layerIndex + 1), item.items]);
      setCurrentPath([
        ...currentPath.slice(0, layerIndex),
        {
          id: item.key,
          key: itemIdentity,
          name: item.key,
          data: getItemData(item),
        },
      ]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const itemId = getItemId(item);
    if (!itemId) {
      console.log('UNS: Cannot expand item - no ID found:', item);
      return;
    }

    const itemIdentity = getItemKey(item);
    const expandedKey = `${layerIndex}-${itemIdentity}`;

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
      connection: node,
    });

    try {
      const result = await getChildren(node, itemId);

      console.log('UNS: Response received:', {
        success: result.success,
        dataLength: result.data ? result.data.length : 0,
        hasChildren: result.data && result.data.length > 0,
      });

      if (result.success && result.data !== undefined) {
        const children = result.data;

        // Cache whether this item has children
        const itemKey = `${layerIndex}-${itemIdentity}`;
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
          const newPath = [
            ...currentPath.slice(0, layerIndex),
            {
              id: itemId,
              key: itemIdentity,
              name: getItemName(item),
              data: getItemData(item),
            },
          ];
          setCurrentPath(newPath);

          // Scroll to top when expanding to new layer
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
          // No children - mark as leaf node
          console.log(
            `UNS: Item ${itemId} has no children (empty array or undefined)`,
          );
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
        const key = `${i}-${pathItem.key || pathItem.id}`;
        newExpanded.add(key);
        newHasChildren.add(key);
      }
    }

    setExpandedItems(newExpanded);
    // Merge with existing itemsWithChildren to preserve cache
    const mergedHasChildren = new Set([
      ...itemsWithChildren,
      ...newHasChildren,
    ]);
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

  const fetchSqlData = async (
    dbms,
    table,
    whereClause,
    column,
    { silent = false } = {},
  ) => {
    if (!node || !dbms || !table) return;

    const timeRangeError = getUNSTimeRangeError({ timeMode, startTime, endTime });
    if (timeRangeError) {
      setTimeRangeErrorDismissed(false);
      if (!silent) {
        setSqlError(null);
      }
      return;
    }

    if (!silent) {
      setSqlLoading(true);
      setSqlError(null);
    }

    try {
      const result = await queryTable(node, {
        dbms,
        table,
        time_value: timeRangeValue,
        time_unit: timeRangeUnit,
        start_time: timeMode === 'absolute' ? formatDateTimeLocalForBackend(startTime) : '',
        end_time: timeMode === 'absolute' ? formatDateTimeLocalForBackend(endTime) : '',
        where: whereClause,
        column,
        time_column: timeColumn,
      });

      console.log('UNS: SQL query result:', {
        success: result.success,
        dataLength: result.data ? result.data.length : 0,
        dataType: Array.isArray(result.data) ? 'array' : typeof result.data,
      });

      if (result.success) {
        console.log(
          `UNS: Setting ${result.data ? result.data.length : 0} rows in state`,
        );
        setSqlData(Array.isArray(result.data) ? result.data : []);
        setSqlColumns(Array.isArray(result.columns) ? result.columns : []);
        if (silent) setSqlError(null);
      } else {
        setSqlData(Array.isArray(result.data) ? result.data : []);
        setSqlColumns(Array.isArray(result.columns) ? result.columns : []);
        setSqlError(result.error || 'Failed to fetch table data');
      }
    } catch (err) {
      console.error('Error fetching SQL data:', err);
      if (!silent) {
        setSqlError(err.message || 'Failed to fetch table data');
      }
    } finally {
      if (!silent) {
        setSqlLoading(false);
      }
    }
  };

  const setSingleChartTimeControl = (setter) => (value) => {
    setter(value);
    setTimeRangeErrorDismissed(false);
  };

  const createCompareGraph = () => {
    const nextIndex = compareGraphs.length + 1;
    const graph = {
      id: `compare-graph-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: `Comparison ${nextIndex}`,
      timeRangeValue,
      timeRangeUnit,
      timeMode: 'relative',
      startTime: '',
      endTime: '',
      timeColumn,
      refreshRate: 20,
      liveMode: false,
      sources: [],
    };

    setCompareGraphs((prev) => [...prev, graph]);
    setActiveCompareGraphId(graph.id);
    setIsCompareOpen(true);
    return graph;
  };

  const getCompareSourceIdentityFromParts = (source) => {
    if (!source?.dbms || !source?.table) return '';
    return [
      source.dbms,
      source.table,
      source.where || '',
      source.column || '',
    ].join('::');
  };

  const getCompareSourceIdentity = (item) => {
    const itemData = getItemData(item);
    return getCompareSourceIdentityFromParts(itemData);
  };

  const isItemInActiveCompareGraph = (item) => {
    const identityKey = getCompareSourceIdentity(item);
    if (!identityKey || !activeCompareGraphId) return false;

    const activeGraph = compareGraphs.find((graph) => graph.id === activeCompareGraphId);
    if (!activeGraph) return false;

    return activeGraph.sources.some((source) => (
      (source.identityKey || getCompareSourceIdentityFromParts(source)) === identityKey
    ));
  };

  const buildCompareSource = (item) => {
    const itemData = getItemData(item);
    if (!itemData?.dbms || !itemData?.table) {
      return null;
    }

    return {
      id: `compare-source-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: getItemName(item),
      type: getItemType(item),
      dbms: itemData.dbms,
      table: itemData.table,
      where: itemData.where || '',
      column: itemData.column || '',
      identityKey: getCompareSourceIdentityFromParts(itemData),
      chartYKey: null,
      data: [],
      columns: [],
      loading: false,
      error: null,
      needsFetch: true,
      lastFetchedAt: null,
    };
  };

  const addItemToCompare = (item) => {
    const source = buildCompareSource(item);
    if (!source) {
      setError('This UNS item does not have table data to compare.');
      return;
    }

    let targetGraphId = activeCompareGraphId;
    let graphToCreate = null;

    if (!targetGraphId || !compareGraphs.some((graph) => graph.id === targetGraphId)) {
      const nextIndex = compareGraphs.length + 1;
      graphToCreate = {
        id: `compare-graph-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: `Comparison ${nextIndex}`,
        timeRangeValue,
        timeRangeUnit,
        timeMode: 'relative',
        startTime: '',
        endTime: '',
        timeColumn,
        refreshRate: 20,
        liveMode: false,
        sources: [],
      };
      targetGraphId = graphToCreate.id;
      setActiveCompareGraphId(targetGraphId);
    }

    setCompareGraphs((prev) => {
      const nextGraphs = graphToCreate && !prev.some((graph) => graph.id === graphToCreate.id)
        ? [...prev, graphToCreate]
        : prev;

      return nextGraphs.map((graph) => {
        if (graph.id !== targetGraphId) return graph;

        const alreadyAdded = graph.sources.some((existing) => (
          (existing.identityKey || getCompareSourceIdentityFromParts(existing)) === source.identityKey
        ));

        if (alreadyAdded) return graph;

        return {
          ...graph,
          sources: [...graph.sources, source],
        };
      });
    });

    setIsCompareOpen(true);
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
    setCheckingData((prev) => new Set(prev).add(cacheKey));

    try {
      const result = await checkTable(node, { dbms, table });

      // Only consider it has_data if success is True AND has_data is True
      // If success is False or has_data is False, treat as no data
      const hasData = result.success === true && result.has_data === true;

      // Only cache if we got a definitive result (true or false)
      // Don't cache errors or undefined states
      if (result.success !== undefined) {
        setItemsWithData((prev) => {
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
      setItemsWithData((prev) => {
        const newMap = new Map(prev);
        newMap.set(cacheKey, false);
        return newMap;
      });
      return false;
    } finally {
      // Remove from checking set
      setCheckingData((prev) => {
        const newSet = new Set(prev);
        newSet.delete(cacheKey);
        return newSet;
      });
    }
  };

  const toggleSidePanel = (item) => {
    const isCurrentlySelected =
      selectedItem && getItemKey(selectedItem) === getItemKey(item);

    // If clicking on the already selected item and panel is open, close it
    if (isCurrentlySelected && isSidePanelOpen) {
      setIsSidePanelOpen(false);
      setSelectedItem(null);
      setSqlData(null);
      setSqlColumns([]);
      setSqlError(null);
    } else {
      // Otherwise, open/update the side panel with this item
      setSelectedItem(item);
      setIsSidePanelOpen(true);
      setSqlData(null);
      setSqlColumns([]);
      setSqlError(null);
      setChartYKey(null); // Reset so chart defaults to policy column for new item
      setTimeColumn('timestamp'); // Reset time column when opening new item

      const itemData = getItemData(item);
      const hasTableMeta = itemData && itemData.dbms && itemData.table;
      if (hasTableMeta) {
        fetchSqlData(
          itemData.dbms,
          itemData.table,
          itemData.where,
          itemData.column,
        );
      }
    }
  };

  const renderItem = (item, layerIndex, itemIndex) => {
    const itemId = getItemId(item);
    const itemName = getItemName(item);
    const itemType = getItemType(item);
    const itemData = getItemData(item);
    const itemIdentity = getItemKey(item);
    const expandedKey = `${layerIndex}-${itemIdentity}`;
    const itemKey = `${layerIndex}-${itemIdentity}`;
    const isExpanded = expandedItems.has(expandedKey);

    // Check if this item has children
    // If we've already checked and it has no children, it's a leaf
    const hasNoChildren = !isRootGroupItem(item) && itemsWithoutChildren.has(itemKey);
    // If we've already checked and it has children, or if it's expanded (meaning we loaded children), it has children
    const hasChildren = isRootGroupItem(item) || itemsWithChildren.has(itemKey) || isExpanded;
    // Check if currently checking for children
    const isCheckingChildren = checkingChildren.has(itemKey);

    // Check if item has table data (for visual indicator)
    const hasTable = itemData && itemData.dbms && itemData.table;
    const tableCacheKey = hasTable
      ? `${itemData.dbms}:${itemData.table}`
      : null;
    const hasData = tableCacheKey
      ? (itemsWithData.get(tableCacheKey) ?? null)
      : null;
    const isCheckingData = tableCacheKey
      ? checkingData.has(tableCacheKey)
      : false;

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
      if (
        (hasChildren || !hasNoChildren) &&
        !e.target.closest('.uns-item-info-btn') &&
        !e.target.closest('.uns-item-compare-btn')
      ) {
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

    const isSelected = selectedItem && getItemKey(selectedItem) === itemIdentity;
    const isComparedInActiveGraph = isItemInActiveCompareGraph(item);

    // Add table indicator class only if the table schema is available.
    // Don't add any class if hasData is false or null (no table or not checked)
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
        style={{
          cursor: hasChildren || !hasNoChildren ? 'pointer' : 'default',
        }}
      >
        <div className="uns-item-icon">{icon}</div>
        <div className="uns-item-name">
          {itemName}
          {/* Only show table indicator if we have a definitive result (true = table available) */}
          {/* Don't show anything if hasData is false or null (no table or not checked yet) */}
          {hasTable && hasData === true && (
            <span className="uns-item-data-indicator" title="Table available">
              {' '}
              💾
            </span>
          )}
          {hasTable && isCheckingData && (
            <span
              className="uns-item-data-indicator checking"
              title="Checking table..."
            >
              {' '}
              ⏳
            </span>
          )}
        </div>
        <div className="uns-item-actions">
          {hasTable && (
            <button
              className={`uns-item-compare-btn ${isComparedInActiveGraph ? 'selected' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                addItemToCompare(item);
              }}
              title={isComparedInActiveGraph ? 'Already in active compare graph' : 'Add to compare graph'}
              aria-label={isComparedInActiveGraph ? 'Already in active compare graph' : 'Add to compare graph'}
              aria-pressed={isComparedInActiveGraph}
            >
              {isComparedInActiveGraph ? 'Compared' : 'Compare'}
            </button>
          )}
          <button
            className="uns-item-info-btn"
            onClick={handleInfoButtonClick}
            title="View item details"
            aria-label="View item details"
          >
            ℹ️
          </button>
          {(hasChildren || !hasNoChildren) && (
            <div className="uns-item-expand">{isExpanded ? '▼' : '▶'}</div>
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

  useEffect(() => {
    if (loading || layers.length === 0) {
      return;
    }

    const currentLayerIndex = layers.length - 1;
    const currentLayer = layers[currentLayerIndex];
    if (!currentLayer || currentLayer.length !== 1) {
      return;
    }

    const item = currentLayer[0];
    const itemKey = `${currentLayerIndex}-${getItemKey(item)}`;
    if (
      autoExpandedItemsRef.current.has(itemKey) ||
      expandedItems.has(itemKey) ||
      itemsWithoutChildren.has(itemKey)
    ) {
      return;
    }

    if (!isRootGroupItem(item) && !getItemId(item)) {
      return;
    }

    autoExpandedItemsRef.current.add(itemKey);
    expandItem(item, currentLayerIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, layers, expandedItems, itemsWithoutChildren]);

  const renderBreadcrumb = () => {
    if (layers.length === 0) return null;

    return (
      <div className="uns-breadcrumb" onClick={() => setIsCompareOpen(false)}>
        <button className="uns-breadcrumb-item" onClick={navigateToRoot}>
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
                  fontWeight: isCurrentLayer ? 'bold' : 'normal',
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

  const singleChartTimeRangeError = getUNSTimeRangeError({ timeMode, startTime, endTime });

  return (
    <div className="uns-container">
      <div className="uns-header">
        <h1>Unified Namespace (UNS)</h1>
        <div className="uns-header-controls">
          <div className="uns-query-input-group">
            <label htmlFor="root-query" className="uns-query-label">
              Root Query:
            </label>
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
              placeholder={ROOT_QUERY_UNS_DATA}
              className="uns-query-input"
              disabled={loading}
            />
            <button
              type="button"
              onClick={() => loadRootItems()}
              disabled={loading || !node || !rootQuery.trim()}
              className="uns-execute-btn"
            >
              Execute
            </button>
          </div>
          <button
            type="button"
            onClick={handleToggleRootQuery}
            disabled={loading || !node}
            className="uns-refresh-btn uns-cluster-toggle-btn"
          >
            {isClusterPath ? 'UNS Data' : 'UNS Cluster'}
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
          <span className="error-dismiss" onClick={() => setError(null)}>
            ×
          </span>
          ❌ Error: {error}
        </div>
      )}

      <div
        className={`uns-main-content ${isSidePanelOpen ? 'uns-panel-open' : ''}`}
      >
        <div className="uns-main-content-wrapper">
          {renderBreadcrumb()}

          <UNSCompareGraphs
            conn={node}
            graphs={compareGraphs}
            setGraphs={setCompareGraphs}
            activeGraphId={activeCompareGraphId}
            setActiveGraphId={setActiveCompareGraphId}
            isOpen={isCompareOpen}
            setIsOpen={setIsCompareOpen}
            onCreateGraph={createCompareGraph}
            onExportCache={exportCompareCache}
            onImportCache={importCompareCache}
            cacheMessage={compareCacheMessage}
            onDismissCacheMessage={() => setCompareCacheMessage('')}
          />

          <div className="uns-layers">
            {layers.length > 0 &&
              (() => {
                // Only show the current layer (the last one)
                const currentLayerIndex = layers.length - 1;
                const currentLayer = layers[currentLayerIndex];
                const layerName =
                  currentLayerIndex === 0
                    ? 'Root'
                    : currentPath[currentLayerIndex - 1]?.name ||
                      `Layer ${currentLayerIndex}`;

                return (
                  <div key={currentLayerIndex} className="uns-layer">
                    <div className="uns-layer-header">{layerName}</div>
                    <div className="uns-layer-content">
                      {loading ? (
                        <div className="uns-loading">Loading...</div>
                      ) : currentLayer.length === 0 ? (
                        <div className="uns-empty">No items found</div>
                      ) : (
                        currentLayer.map((item, itemIndex) =>
                          renderItem(item, currentLayerIndex, itemIndex),
                        )
                      )}
                    </div>
                  </div>
                );
              })()}
          </div>
        </div>

        {/* Side Panel for detailed view */}
        <div ref={sidePanelAnchorRef} className="uns-side-panel-anchor">
          <UNSSidePanel
            isOpen={isSidePanelOpen}
            selectedItem={selectedItem}
            conn={node}
            sqlData={sqlData}
            sqlColumns={sqlColumns}
            sqlLoading={sqlLoading}
            sqlError={sqlError}
            timeRangeValue={timeRangeValue}
            timeRangeUnit={timeRangeUnit}
            timeMode={timeMode}
            startTime={startTime}
            endTime={endTime}
            timeRangeError={singleChartTimeRangeError}
            timeRangeErrorDismissed={timeRangeErrorDismissed}
            timeColumn={timeColumn}
            onTimeColumnChange={setSingleChartTimeControl(setTimeColumn)}
            onClose={() => {
              setIsSidePanelOpen(false);
              setSelectedItem(null);
              setSqlData(null);
              setSqlColumns([]);
              setSqlError(null);
            }}
            onTimeRangeValueChange={setSingleChartTimeControl(setTimeRangeValue)}
            onTimeRangeUnitChange={setSingleChartTimeControl(setTimeRangeUnit)}
            onTimeModeChange={setSingleChartTimeControl(setTimeMode)}
            onStartTimeChange={setSingleChartTimeControl(setStartTime)}
            onEndTimeChange={setSingleChartTimeControl(setEndTime)}
            onTimeRangeErrorDismiss={() => setTimeRangeErrorDismissed(true)}
            onFetchTimeRange={fetchSqlData}
            onCompareItem={addItemToCompare}
            isCompared={selectedItem ? isItemInActiveCompareGraph(selectedItem) : false}
            getItemName={getItemName}
            getItemType={getItemType}
            getItemId={getItemId}
            getItemData={getItemData}
            chartYKey={chartYKey}
            onChartYKeyChange={setChartYKey}
          />
        </div>
      </div>

      {hoveredItem && (
        <div
          className="uns-tooltip"
          style={{
            left: `${hoverPosition.x + 10}px`,
            top: `${hoverPosition.y + 10}px`,
          }}
        >
          <div className="uns-tooltip-header">
            <strong>{getItemName(hoveredItem)}</strong>
            <span className="uns-tooltip-type">
              ({getItemType(hoveredItem)})
            </span>
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
  name: 'Unified Namespace (UNS)',
  icon: null,
};

export default UNSPage;
