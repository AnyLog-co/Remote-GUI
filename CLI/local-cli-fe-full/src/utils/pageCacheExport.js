export const UNS_COMPARE_STORAGE_KEY = 'uns-compare-graphs-state';
export const EDF_TOPOLOGY_CACHE_STORAGE_KEY = 'edf-topology-cache-state';
export const EDF_TOPOLOGY_QUERY_CARDS_STORAGE_KEY = 'edfTopologyQueryCards';
export const REMOTE_GUI_CACHE_KIND = 'anylog-remote-gui-page-cache';
export const REMOTE_GUI_CACHE_VERSION = 1;

export const readJsonStorage = (key, fallback = null) => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.warn(`Failed to read ${key} from localStorage:`, error);
    return fallback;
  }
};

export const writeJsonStorage = (key, value) => {
  window.localStorage.setItem(key, JSON.stringify(value));
};

export const downloadJson = (filename, payload) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const todayStamp = () => new Date().toISOString().slice(0, 10);

export const buildGlobalPageCachePayload = () => {
  const unsCompare = readJsonStorage(UNS_COMPARE_STORAGE_KEY);
  const topology = readJsonStorage(EDF_TOPOLOGY_CACHE_STORAGE_KEY);
  const topologyQueryCards = readJsonStorage(EDF_TOPOLOGY_QUERY_CARDS_STORAGE_KEY, []);

  return {
    kind: REMOTE_GUI_CACHE_KIND,
    version: REMOTE_GUI_CACHE_VERSION,
    exportedAt: new Date().toISOString(),
    caches: {
      unsCompare,
      topology,
      topologyQueryCards: Array.isArray(topologyQueryCards) ? topologyQueryCards : []
    }
  };
};

export const getGlobalPageCacheEntryCount = (payload) => {
  const caches = payload?.caches || {};
  const unsCount = Object.keys(caches.unsCompare?.nodes || {}).length;
  const topologyCount = Object.keys(caches.topology?.nodes || {}).length;
  const queryCardCount = Array.isArray(caches.topologyQueryCards)
    ? caches.topologyQueryCards.length
    : 0;
  return unsCount + topologyCount + queryCardCount;
};

export const downloadGlobalPageCache = () => {
  const payload = buildGlobalPageCachePayload();
  const count = getGlobalPageCacheEntryCount(payload);
  if (count === 0) {
    return { ok: false, count };
  }

  downloadJson(`remote-gui-cache-${todayStamp()}.json`, payload);
  return { ok: true, count };
};

const makeUniqueId = (baseId, usedIds, prefix) => {
  const fallbackBase = `${prefix}-${Date.now()}`;
  const cleanBase = String(baseId || fallbackBase);
  let nextId = cleanBase;
  let index = 1;

  while (usedIds.has(nextId)) {
    nextId = `${cleanBase}-import-${index}`;
    index += 1;
  }

  usedIds.add(nextId);
  return nextId;
};

const appendItemsWithUniqueIds = (currentItems = [], incomingItems = [], prefix = 'item') => {
  const usedIds = new Set(currentItems.map((item) => item?.id).filter(Boolean));
  const idMap = {};
  const appendedItems = incomingItems
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const nextId = makeUniqueId(item.id, usedIds, prefix);
      idMap[item.id] = nextId;
      return {
        ...item,
        id: nextId,
      };
    });

  return {
    items: [...currentItems, ...appendedItems],
    idMap,
  };
};

const mergeUnsCompareCachePayload = (currentPayload, incomingPayload) => {
  const currentNodes = currentPayload?.nodes || {};
  const incomingNodes = incomingPayload?.nodes || {};
  const nextNodes = { ...currentNodes };

  Object.entries(incomingNodes).forEach(([nodeKey, incomingEntry]) => {
    const currentEntry = nextNodes[nodeKey];
    if (!currentEntry || !Array.isArray(currentEntry.graphs)) {
      nextNodes[nodeKey] = incomingEntry;
      return;
    }

    const { items: graphs, idMap } = appendItemsWithUniqueIds(
      currentEntry.graphs,
      Array.isArray(incomingEntry?.graphs) ? incomingEntry.graphs : [],
      'compare-graph',
    );
    const importedActiveGraphId = idMap[incomingEntry?.activeGraphId] || incomingEntry?.activeGraphId;

    nextNodes[nodeKey] = {
      ...currentEntry,
      graphs,
      activeGraphId: currentEntry.activeGraphId || importedActiveGraphId || graphs[0]?.id || null,
      isOpen: Boolean(currentEntry.isOpen || incomingEntry?.isOpen),
      updatedAt: new Date().toISOString(),
    };
  });

  return {
    kind: incomingPayload?.kind || currentPayload?.kind || 'anylog-uns-compare-cache',
    version: incomingPayload?.version || currentPayload?.version || 1,
    updatedAt: new Date().toISOString(),
    nodes: nextNodes,
  };
};

const remapResultsById = (results = {}, idMap = {}) => (
  Object.entries(results || {}).reduce((acc, [id, result]) => {
    acc[idMap[id] || id] = result;
    return acc;
  }, {})
);

const mergeTopologyNodeEntry = (currentEntry, incomingEntry) => {
  if (!currentEntry) {
    return incomingEntry;
  }

  const { items: catalogQueryCards, idMap } = appendItemsWithUniqueIds(
    Array.isArray(currentEntry.catalogQueryCards) ? currentEntry.catalogQueryCards : [],
    Array.isArray(incomingEntry?.catalogQueryCards) ? incomingEntry.catalogQueryCards : [],
    'topology-graph',
  );

  return {
    ...currentEntry,
    catalogQueryCards,
    catalogQueryResults: {
      ...(currentEntry.catalogQueryResults || {}),
      ...remapResultsById(incomingEntry?.catalogQueryResults, idMap),
    },
    savedAt: new Date().toISOString(),
  };
};

export const mergeTopologyCachePayload = (currentPayload, incomingPayload) => {
  const currentNodes = currentPayload?.nodes || {};
  const incomingNodes = incomingPayload?.nodes || {};
  const nextNodes = { ...currentNodes };

  Object.entries(incomingNodes).forEach(([nodeKey, incomingEntry]) => {
    nextNodes[nodeKey] = mergeTopologyNodeEntry(nextNodes[nodeKey], incomingEntry);
  });

  const topLevelCards = appendItemsWithUniqueIds(
    Array.isArray(currentPayload?.topologyQueryCards) ? currentPayload.topologyQueryCards : [],
    Array.isArray(incomingPayload?.topologyQueryCards) ? incomingPayload.topologyQueryCards : [],
    'topology-graph',
  ).items;

  return {
    kind: incomingPayload?.kind || currentPayload?.kind || 'anylog-edf-topology-cache',
    version: incomingPayload?.version || currentPayload?.version || 1,
    exportedAt: new Date().toISOString(),
    nodes: nextNodes,
    topologyQueryCards: topLevelCards,
  };
};

const dispatchCacheImportEvents = ({ uns = false, topology = false }) => {
  if (uns) {
    window.dispatchEvent(new Event('uns-compare-cache-imported'));
  }
  if (topology) {
    window.dispatchEvent(new Event('edf-topology-cache-imported'));
  }
};

export const importGlobalPageCache = async (file) => {
  if (!file) {
    return { ok: false, imported: [] };
  }

  const payload = JSON.parse(await file.text());
  const imported = [];
  let importedUns = false;
  let importedTopology = false;

  if (payload?.kind === REMOTE_GUI_CACHE_KIND) {
    const caches = payload.caches || {};
    if (caches.unsCompare) {
      const currentUnsCompare = readJsonStorage(UNS_COMPARE_STORAGE_KEY);
      writeJsonStorage(
        UNS_COMPARE_STORAGE_KEY,
        mergeUnsCompareCachePayload(currentUnsCompare, caches.unsCompare),
      );
      imported.push('UNS compare graphs');
      importedUns = true;
    }
    if (caches.topology) {
      const currentTopology = readJsonStorage(EDF_TOPOLOGY_CACHE_STORAGE_KEY);
      writeJsonStorage(
        EDF_TOPOLOGY_CACHE_STORAGE_KEY,
        mergeTopologyCachePayload(currentTopology, caches.topology),
      );
      imported.push('Topology graphs');
      importedTopology = true;
    }
    if (Array.isArray(caches.topologyQueryCards)) {
      const currentQueryCards = readJsonStorage(EDF_TOPOLOGY_QUERY_CARDS_STORAGE_KEY, []);
      const nextQueryCards = appendItemsWithUniqueIds(
        Array.isArray(currentQueryCards) ? currentQueryCards : [],
        caches.topologyQueryCards,
        'topology-graph',
      ).items;
      writeJsonStorage(EDF_TOPOLOGY_QUERY_CARDS_STORAGE_KEY, nextQueryCards);
      imported.push('Topology query cards');
      importedTopology = true;
    }
  } else if (payload?.kind === 'anylog-uns-compare-cache') {
    const currentUnsCompare = readJsonStorage(UNS_COMPARE_STORAGE_KEY);
    writeJsonStorage(
      UNS_COMPARE_STORAGE_KEY,
      mergeUnsCompareCachePayload(currentUnsCompare, payload),
    );
    imported.push('UNS compare graphs');
    importedUns = true;
  } else if (payload?.kind === 'anylog-edf-topology-cache') {
    const currentTopology = readJsonStorage(EDF_TOPOLOGY_CACHE_STORAGE_KEY);
    writeJsonStorage(
      EDF_TOPOLOGY_CACHE_STORAGE_KEY,
      mergeTopologyCachePayload(currentTopology, payload),
    );
    imported.push('Topology graphs');
    importedTopology = true;
    if (Array.isArray(payload.topologyQueryCards)) {
      const currentQueryCards = readJsonStorage(EDF_TOPOLOGY_QUERY_CARDS_STORAGE_KEY, []);
      const nextQueryCards = appendItemsWithUniqueIds(
        Array.isArray(currentQueryCards) ? currentQueryCards : [],
        payload.topologyQueryCards,
        'topology-graph',
      ).items;
      writeJsonStorage(EDF_TOPOLOGY_QUERY_CARDS_STORAGE_KEY, nextQueryCards);
      imported.push('Topology query cards');
    }
  } else {
    throw new Error('The selected file is not a supported Remote GUI cache export.');
  }

  dispatchCacheImportEvents({ uns: importedUns, topology: importedTopology });
  return { ok: imported.length > 0, imported };
};
