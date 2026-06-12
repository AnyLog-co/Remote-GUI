import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './EdgeDataFabricTopologyPage.css';
import { fetchEdgeDataFabricColumns, fetchEdgeDataFabricTopology, runEdgeDataFabricQuery } from './edgedatafabrictopology_api';

export const pluginMetadata = {
  name: 'Edge Data Fabric Topology',
  icon: null
};

const RANGE_OPTIONS = [
  { label: '1h', hours: 1 },
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '3d', hours: 72 }
];

const SIZE_OPTIONS = [
  { label: 'S', value: 's' },
  { label: 'M', value: 'm' },
  { label: 'L', value: 'l' },
  { label: 'XL', value: 'xl' }
];
const POLL_PRESET_OPTIONS = [
  { label: '10s', value: '10' },
  { label: '30s', value: '30' },
  { label: '60s', value: '60' },
  { label: '2m', value: '120' },
  { label: '5m', value: '300' },
  { label: 'Custom', value: 'custom' }
];
const POLL_UNIT_OPTIONS = [
  { label: 'Seconds', value: 'seconds', multiplier: 1 },
  { label: 'Minutes', value: 'minutes', multiplier: 60 },
  { label: 'Hours', value: 'hours', multiplier: 3600 },
  { label: 'Days', value: 'days', multiplier: 86400 }
];

const NODE_ID_KEYS = ['node_name', 'node name', 'Node Name', 'Node', 'node', 'host', 'hostname', 'name', 'operator', 'member', 'id', 'ip_port', 'IP:Port', 'Address'];
const CPU_KEYS = ['cpu_percent', 'CPU Percent', 'Cpu Percent', 'cpu percent', 'CPU %', 'cpu', 'CPU'];
const MEM_KEYS = ['mem_percent', 'memory_percent', 'Memory Percent', 'Mem Percent', 'MEM Percent', 'memory percent', 'mem percent', 'Memory %', 'Mem %', 'MEM %'];
const DISK_FREE_KEYS = ['free_space_percent', 'disk_free_percent', 'Free Space Percent', 'free space percent', 'Disk Free Percent', 'Disk Free %'];
const DISK_USAGE_KEYS = ['disk_percent', 'disk_usage_percent', 'disk_used_percent', 'Disk Percent', 'Disk Usage Percent', 'disk usage percent', 'Disk Used Percent', 'Disk Used %', 'Disk %'];
const OPERATIONAL_TIME_KEYS = ['operational time', 'Operational Time', 'processing time', 'Processing Time', 'elapsed time', 'Elapsed time'];
const DEFAULT_QUERY_FORM = {
  label: '',
  dbms: '',
  table: '',
  column: '',
  columnType: '',
  aggregation: 'count'
};
const DEFAULT_NODE_METRICS = new Set(['Status', 'Role', 'CPU', 'Disk', 'Inserts', 'Operational Time']);
const AGGREGATION_OPTIONS = ['count', 'min', 'max', 'avg', 'sum'];

function normalizeFieldName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function statusRank(status) {
  return status === 'crit' ? 0 : status === 'warn' ? 1 : 2;
}

function siteStatus(site) {
  return [...site.nodes].sort((a, b) => statusRank(a.status) - statusRank(b.status))[0]?.status || 'ok';
}

function statusLabel(status) {
  if (status === 'crit') return 'Critical';
  if (status === 'warn') return 'Warning';
  return 'Healthy';
}

function hasMetricValue(value) {
  return value !== null && value !== undefined && value !== '';
}

function formatMetricValue(value) {
  if (!hasMetricValue(value)) return 'N/A';
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(number % 1 === 0 ? 0 : 1)}%` : String(value);
}

function formatScalarValue(value) {
  if (!hasMetricValue(value)) return 'N/A';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : String(value);
}

function statusReasons(node) {
  if (!node) return [];
  const reasons = [];
  const cpu = hasMetricValue(node.cpu) ? Number(node.cpu) : null;
  const mem = hasMetricValue(node.mem) ? Number(node.mem) : null;
  const diskUsage = hasMetricValue(node.diskUsage) ? Number(node.diskUsage) : null;

  if (cpu !== null && cpu >= 90) reasons.push(`CPU is greater than or equal to 90% (current ${formatMetricValue(cpu)}).`);
  else if (cpu !== null && cpu >= 75) reasons.push(`CPU is greater than or equal to 75% (current ${formatMetricValue(cpu)}).`);

  if (mem !== null && mem >= 90) reasons.push(`Memory is greater than or equal to 90% (current ${formatMetricValue(mem)}).`);
  else if (mem !== null && mem >= 80) reasons.push(`Memory is greater than or equal to 80% (current ${formatMetricValue(mem)}).`);

  if (diskUsage !== null && diskUsage >= 90) reasons.push(`Disk usage is greater than or equal to 90% (current ${formatMetricValue(diskUsage)}).`);
  else if (diskUsage !== null && diskUsage >= 75) reasons.push(`Disk usage is greater than or equal to 75% (current ${formatMetricValue(diskUsage)}).`);

  return reasons;
}

function formatNumber(value) {
  if (!hasMetricValue(value)) return 'N/A';
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : String(value);
}

function firstValue(row, keys) {
  if (!row || typeof row !== 'object') return undefined;
  const key = keys.find(item => row[item] !== undefined && row[item] !== null && row[item] !== '');
  if (key) return row[key];

  const normalizedKeys = new Set(keys.map(normalizeFieldName));
  const matchedKey = Object.keys(row).find(item => (
    normalizedKeys.has(normalizeFieldName(item)) &&
    row[item] !== undefined &&
    row[item] !== null &&
    row[item] !== ''
  ));
  return matchedKey ? row[matchedKey] : undefined;
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replace('%', ''));
  return Number.isFinite(number) ? number : null;
}

function cleanMetadataValue(value) {
  const text = String(value || '').trim();
  return /^(n\/a|na|none|null|unknown|-|—)$/i.test(text) ? '' : text;
}

function cleanIdentifier(value) {
  return String(value || '').trim();
}

function catalogKey(dbms, table) {
  return `${cleanIdentifier(dbms)}.${cleanIdentifier(table)}`;
}

function companyScopeKey(company) {
  return cleanIdentifier(company);
}

function pollSecondsFromCustom(value, unit) {
  const numericValue = Math.max(1, Number(value) || 1);
  const multiplier = POLL_UNIT_OPTIONS.find(option => option.value === unit)?.multiplier || 1;
  return Math.round(numericValue * multiplier);
}

function formatPollInterval(seconds) {
  const value = Math.max(1, Number(seconds) || 1);
  const units = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1]
  ];
  const unit = units.find(([, multiplier]) => value >= multiplier && value % multiplier === 0) || units[units.length - 1];
  const amount = value / unit[1];
  return `${amount} ${unit[0]}${amount === 1 ? '' : 's'}`;
}

function buildAggregationSql({ table, column, aggregation }, pollSeconds) {
  const tableName = cleanIdentifier(table);
  const columnName = cleanIdentifier(column);
  const functionName = AGGREGATION_OPTIONS.includes(aggregation) ? aggregation : 'count';
  const seconds = Math.max(1, Number(pollSeconds) || 60);
  if (!tableName || !columnName) return '';
  return `SELECT ${functionName}(${columnName}) as value FROM ${tableName} WHERE timestamp >= NOW() - ${seconds} seconds`;
}

function columnLabel(column) {
  if (!column) return '';
  const name = typeof column === 'string' ? column : column.name;
  const type = typeof column === 'string' ? '' : column.type;
  return type ? `${name} (${type})` : name;
}

function sqlForCatalogCard(card, pollSeconds) {
  if (card?.aggregation && card?.column && card?.table) {
    return buildAggregationSql(card, pollSeconds);
  }
  return card?.sql || '';
}

function hostKey(row) {
  const ip = firstValue(row, ['ip', 'host_ip', 'node_ip']);
  const port = firstValue(row, ['port', 'rest_port', 'api_port']);
  return (
    firstValue(row, NODE_ID_KEYS) ||
    (ip && port ? `${ip}:${port}` : ip)
  );
}

function embeddedIpPort(value) {
  const match = String(value || '').match(/(?:^|@|\s)((?:\d{1,3}\.){3}\d{1,3}:\d{2,5})(?:$|\s)/);
  return match?.[1];
}

function nodeNameBase(value) {
  const text = String(value || '').trim();
  if (!text.includes('@')) return '';
  return text.split('@')[0];
}

function hostAliases(row) {
  const key = hostKey(row);
  const ipPort = firstValue(row, ['ip_port', 'IP:Port', 'address', 'Address']);
  const ip = firstValue(row, ['ip', 'host_ip', 'node_ip']);
  const name = firstValue(row, NODE_ID_KEYS);
  return [
    key,
    ipPort,
    ip,
    name,
    embeddedIpPort(key),
    embeddedIpPort(ipPort),
    embeddedIpPort(name),
    nodeNameBase(key),
    nodeNameBase(name)
  ]
    .filter(Boolean)
    .map(value => String(value).trim().toLowerCase());
}

function nodeCpu(row) {
  return toNumber(firstValue(row, CPU_KEYS));
}

function nodeMem(row) {
  return toNumber(firstValue(row, MEM_KEYS));
}

function nodeDiskFree(row) {
  return toNumber(firstValue(row, DISK_FREE_KEYS));
}

function nodeDiskUsage(row) {
  const usage = toNumber(firstValue(row, DISK_USAGE_KEYS));
  if (usage !== null) return usage;
  const free = nodeDiskFree(row);
  return free !== null ? Math.max(0, Math.min(100, 100 - free)) : null;
}

function operationalTime(row) {
  return firstValue(row, OPERATIONAL_TIME_KEYS);
}

function readableMetricName(key) {
  return String(key || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, char => char.toUpperCase());
}

function rowMetrics(row) {
  if (!row || typeof row !== 'object') return {};
  return Object.entries(row).reduce((acc, [key, value]) => {
    if (value === null || value === undefined || value === '' || typeof value === 'object') return acc;
    acc[readableMetricName(key)] = value;
    return acc;
  }, {});
}

function roleFromName(name, fallback) {
  const text = `${name || ''} ${fallback || ''}`.toLowerCase();
  if (text.includes('operator')) return 'Operator';
  if (text.includes('query')) return 'Query';
  if (text.includes('publisher') || text.includes('pub')) return 'Publisher';
  if (text.includes('storage') || text.includes('store') || text.includes('postgres')) return 'Storage';
  if (text.includes('master')) return 'Master';
  return fallback || 'Node';
}

function siteFromRow(row, fallbackSite) {
  return (
    cleanMetadataValue(firstValue(row, ['company', 'Company', 'site', 'location', 'region', 'cluster', 'namespace'])) ||
    fallbackSite ||
    'AnyLog Network'
  );
}

function deriveContainerRows(dockerRows) {
  return dockerRows
    .map(row => {
      const name = firstValue(row, ['container_name', 'container', 'name', 'service']);
      const node = hostKey(row);
      if (!name && !node) return null;
      return {
        node: node || 'unknown',
        name: name || 'container',
        status: firstValue(row, ['status', 'state', 'health']) || 'unknown',
        cpu: nodeCpu(row),
        mem: nodeMem(row),
        diskUsage: nodeDiskUsage(row)
      };
    })
    .filter(Boolean);
}

function syslogSeverity(row) {
  const priority = toNumber(firstValue(row, ['priority', 'severity']));
  const level = String(firstValue(row, ['level', 'severity_name', 'facility']) || '').toLowerCase();
  if (priority !== null && priority <= 3) return 'critical';
  if (level.includes('crit') || level.includes('fatal') || level.includes('alert') || level.includes('emerg')) return 'critical';
  if (priority !== null && priority <= 4) return 'warning';
  if (level.includes('warn') || level.includes('err')) return 'warning';
  return 'info';
}

function deriveIssues(nodeRows, dockerRows, syslogRows) {
  const issues = [];

  nodeRows.forEach(row => {
    const nodeName = hostKey(row) || 'node';
    const cpu = nodeCpu(row);
    const mem = nodeMem(row);
    const diskUsage = nodeDiskUsage(row);
    if (cpu !== null && cpu >= 90) issues.push({ severity: 'critical', source: nodeName, type: 'Node', message: `CPU ${cpu.toFixed(1)} percent` });
    else if (cpu !== null && cpu >= 75) issues.push({ severity: 'warning', source: nodeName, type: 'Node', message: `CPU ${cpu.toFixed(1)} percent` });
    if (mem !== null && mem >= 90) issues.push({ severity: 'critical', source: nodeName, type: 'Node', message: `Memory ${mem.toFixed(1)} percent` });
    else if (mem !== null && mem >= 80) issues.push({ severity: 'warning', source: nodeName, type: 'Node', message: `Memory ${mem.toFixed(1)} percent` });
    if (diskUsage !== null && diskUsage >= 90) issues.push({ severity: 'critical', source: nodeName, type: 'Node', message: `Disk usage ${diskUsage.toFixed(1)} percent` });
    else if (diskUsage !== null && diskUsage >= 75) issues.push({ severity: 'warning', source: nodeName, type: 'Node', message: `Disk usage ${diskUsage.toFixed(1)} percent` });
  });

  dockerRows.forEach(row => {
    const name = firstValue(row, ['container_name', 'container', 'name', 'service']) || 'container';
    const nodeName = hostKey(row) || 'node';
    const status = String(firstValue(row, ['status', 'state', 'health']) || '').toLowerCase();
    const cpu = nodeCpu(row);
    const mem = nodeMem(row);
    const diskUsage = nodeDiskUsage(row);
    if (status && !status.includes('up') && !status.includes('running') && status !== 'healthy') {
      issues.push({ severity: 'warning', source: `${nodeName}/${name}`, type: 'Container', message: `Container status is ${status}` });
    }
    if (cpu !== null && cpu >= 90) issues.push({ severity: 'critical', source: `${nodeName}/${name}`, type: 'Container', message: `CPU ${cpu.toFixed(1)} percent` });
    if (mem !== null && mem >= 90) issues.push({ severity: 'critical', source: `${nodeName}/${name}`, type: 'Container', message: `Memory ${mem.toFixed(1)} percent` });
    if (diskUsage !== null && diskUsage >= 90) issues.push({ severity: 'critical', source: `${nodeName}/${name}`, type: 'Container', message: `Disk usage ${diskUsage.toFixed(1)} percent` });
  });

  syslogRows.slice(0, 60).forEach(row => {
    const severity = syslogSeverity(row);
    if (severity === 'info') return;
    issues.push({
      severity,
      source: hostKey(row) || firstValue(row, ['program', 'tag']) || 'syslog',
      type: 'Syslog',
      message: String(firstValue(row, ['message', 'msg', 'event', 'text']) || severity).slice(0, 180)
    });
  });

  return issues.slice(0, 100);
}

function deriveSites(raw) {
  const nodeMap = new Map();
  const aliasMap = new Map();
  const containers = deriveContainerRows(raw.dockerRows || []);
  const companyList = raw.activeCompanyFilter
    ? [raw.activeCompanyFilter]
    : (raw.networkCompanies || []);
  const fallbackCompany = raw.activeCompanyFilter || '';
  const fallbackSite = fallbackCompany || 'AnyLog Network';

  const rememberAliases = (nodeKey, source) => {
    hostAliases(source).forEach(alias => aliasMap.set(alias, nodeKey));
  };

  const findNodeKey = source => {
    const key = hostKey(source);
    if (key && nodeMap.has(key)) return key;
    return hostAliases(source).map(alias => aliasMap.get(alias)).find(Boolean);
  };

  const addNode = (source, roleFallback) => {
    const key = hostKey(source);
    if (!key) return;
    const existing = nodeMap.get(key) || {};
    const cpu = nodeCpu(source);
    const mem = nodeMem(source);
    const diskUsage = nodeDiskUsage(source);
    const uptime = operationalTime(source);
    nodeMap.set(key, {
      id: key,
      name: firstValue(source, ['node_name', 'name', 'node', 'host', 'hostname']) || key,
      role: roleFromName(firstValue(source, ['node_name', 'name', 'node', 'host', 'hostname']) || key, roleFallback || existing.role),
      site: siteFromRow(source, fallbackSite),
      company: cleanMetadataValue(firstValue(source, ['company', 'Company'])) || fallbackCompany,
      status: existing.status || 'ok',
      cpu: cpu ?? existing.cpu ?? null,
      mem: mem ?? existing.mem ?? null,
      diskUsage: diskUsage ?? existing.diskUsage ?? null,
      operationalTime: uptime || existing.operationalTime || '',
      tables: existing.tables ?? 0,
      inserts: existing.inserts ?? null,
      containers: existing.containers ?? 0,
      metrics: {
        ...(existing.metrics || {}),
        ...rowMetrics(source),
        CPU: cpu ?? existing.metrics?.CPU,
        Memory: mem ?? existing.metrics?.Memory,
        Disk: diskUsage ?? existing.metrics?.Disk,
        'Operational Time': uptime || existing.metrics?.['Operational Time']
      }
    });
    rememberAliases(key, source);
  };

  const enrichNode = source => {
    const key = findNodeKey(source);
    const existing = key ? nodeMap.get(key) : null;
    if (!existing) return;
    const cpu = nodeCpu(source);
    const mem = nodeMem(source);
    const diskUsage = nodeDiskUsage(source);
    const uptime = operationalTime(source);
    nodeMap.set(key, {
      ...existing,
      cpu: cpu ?? existing.cpu,
      mem: mem ?? existing.mem,
      diskUsage: diskUsage ?? existing.diskUsage,
      operationalTime: uptime || existing.operationalTime,
      metrics: {
        ...(existing.metrics || {}),
        ...rowMetrics(source),
        CPU: cpu ?? existing.metrics?.CPU,
        Memory: mem ?? existing.metrics?.Memory,
        Disk: diskUsage ?? existing.metrics?.Disk,
        'Operational Time': uptime || existing.metrics?.['Operational Time']
      }
    });
    rememberAliases(key, source);
  };

  (raw.operatorPolicies || []).forEach(row => addNode(row, 'Operator'));
  (raw.masterPolicies || []).forEach(row => addNode(row, 'Master'));

  const metadataDefinedTopology = nodeMap.size > 0;
  if (metadataDefinedTopology) {
    (raw.monitorRows || []).forEach(enrichNode);
    (raw.nodeRows || []).forEach(enrichNode);
    (raw.dockerRows || []).forEach(enrichNode);
  } else {
    (raw.monitorRows || []).forEach(row => addNode(row));
    (raw.nodeRows || []).forEach(row => addNode(row));
    (raw.dockerRows || []).forEach(row => addNode(row));
  }

  containers.forEach(container => {
    const containerNodeKey = nodeMap.has(container.node)
      ? container.node
      : aliasMap.get(String(container.node || '').toLowerCase()) || aliasMap.get(String(embeddedIpPort(container.node) || '').toLowerCase());
    const node = containerNodeKey ? nodeMap.get(containerNodeKey) : null;
    if (node) {
      node.containers += 1;
      if (container.cpu !== null) node.cpu = node.cpu === null ? container.cpu : Math.max(node.cpu, container.cpu);
      if (container.mem !== null) node.mem = node.mem === null ? container.mem : Math.max(node.mem, container.mem);
      if (container.diskUsage !== null) node.diskUsage = node.diskUsage === null ? container.diskUsage : Math.max(node.diskUsage, container.diskUsage);
    }
  });

  const catalogByNode = new Map();
  (raw.catalog || []).forEach(table => {
    const nodeCount = table.nodes || 0;
    nodeMap.forEach(node => {
      if (nodeCount === 0 || catalogByNode.size < nodeCount || node.tables === 0) {
        node.tables += 1;
        node.inserts += table.inserts || 0;
      }
    });
  });

  const nodes = [...nodeMap.values()].map(node => {
    const status = (node.cpu !== null && node.cpu >= 90) || (node.mem !== null && node.mem >= 90) || (node.diskUsage !== null && node.diskUsage >= 90)
      ? 'crit'
      : (node.cpu !== null && node.cpu >= 75) || (node.mem !== null && node.mem >= 80) || (node.diskUsage !== null && node.diskUsage >= 75)
        ? 'warn'
        : 'ok';
    return { ...node, status };
  });

  const grouped = new Map();
  companyList.forEach(company => {
    if (company && !grouped.has(company)) grouped.set(company, []);
  });
  nodes.forEach(item => {
    const site = item.site || fallbackSite;
    if (!grouped.has(site)) grouped.set(site, []);
    grouped.get(site).push(item);
  });

  const positions = [
    [18, 42], [40, 48], [58, 35], [78, 58], [28, 64], [66, 68], [47, 25], [82, 34]
  ];

  return [...grouped.entries()].map(([name, siteNodes], index) => ({
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `site-${index + 1}`,
    name,
    region: name,
    company: siteNodes.find(node => node.company)?.company || fallbackCompany || (name !== 'AnyLog Network' ? name : ''),
    x: positions[index % positions.length][0],
    y: positions[index % positions.length][1],
    nodes: siteNodes
  }));
}

function MetricBar({ value }) {
  if (!hasMetricValue(value)) {
    return (
      <div className="edf-mini-bar is-empty" aria-label="No data returned">
        <span>N/A</span>
      </div>
    );
  }
  const status = value >= 90 ? 'crit' : value >= 75 ? 'warn' : 'ok';
  return (
    <div className="edf-mini-bar" aria-label={`${value} percent`}>
      <span className={`edf-mini-bar-fill ${status}`} style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}

function getSectionQueries(apiLog, section) {
  const patterns = {
    map: ['metadata operators', 'metadata masters', 'network databases', 'monitored operators'],
    catalog: ['virtual tables', 'network tables', 'tables ', 'count '],
    kpis: ['metadata operators', 'metadata masters', 'network databases', 'monitored operators', 'docker insight', 'syslog', 'virtual tables', 'network tables', 'count '],
    issues: ['monitored operators', 'docker insight', 'syslog'],
    docker: ['docker insight'],
    resources: ['monitored operators'],
    tables: ['monitored operators']
  }[section] || [];

  const seen = new Set();
  return apiLog
    .filter(entry => patterns.some(pattern => String(entry.detail || '').toLowerCase().includes(pattern)))
    .map(entry => {
      const detail = entry.detail || '';
      const command = detail.includes(': ') ? detail.slice(detail.indexOf(': ') + 2) : detail;
      return { ...entry, command };
    })
    .filter(entry => {
      if (seen.has(entry.command)) return false;
      seen.add(entry.command);
      return true;
    });
}

function QueryButton({ section, apiLog, onOpen }) {
  const queries = getSectionQueries(apiLog, section);
  return (
    <div className="edf-section-query-row">
      <button type="button" className="edf-query-button" onClick={() => onOpen(section, queries)}>
        Query
      </button>
    </div>
  );
}

function makeQueryId() {
  return `query-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function firstQueryValue(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0];
  if (row === null || row === undefined || row === '') return null;
  if (typeof row !== 'object') return row;
  const value = Object.values(row).find(item => item !== null && item !== undefined && item !== '');
  return value ?? null;
}

function nodeCountFromStatistics(statistics) {
  const stat = Array.isArray(statistics) ? statistics[0] : null;
  if (!stat || typeof stat !== 'object') return null;
  const value = stat.Nodes ?? stat.nodes ?? stat.Count ?? stat.count;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildCatalogOptions(catalog, networkDatabases) {
  const dbmsSet = new Set();
  const tableMap = new Map();

  const addDbms = dbms => {
    const name = cleanIdentifier(dbms);
    if (!name) return;
    dbmsSet.add(name);
    if (!tableMap.has(name)) tableMap.set(name, []);
  };

  const addTable = (dbms, table) => {
    const dbmsName = cleanIdentifier(dbms);
    const tableName = cleanIdentifier(table);
    if (!dbmsName) return;
    addDbms(dbmsName);
    if (!tableName) return;
    const tables = tableMap.get(dbmsName);
    if (!tables.includes(tableName)) tables.push(tableName);
  };

  catalog.forEach(item => addTable(item.dbms, item.table));
  networkDatabases.forEach(item => addDbms(item.dbms || item.DBMS || item.database || item.Database));

  tableMap.forEach(tables => tables.sort((a, b) => a.localeCompare(b)));

  return {
    dbmsOptions: [...dbmsSet].sort((a, b) => a.localeCompare(b)),
    tableMap
  };
}

function Panel({ id, title, tag, children, collapsed, onToggle, querySection, apiLog, onOpenQueries }) {
  return (
    <section className={`edf-panel ${collapsed ? 'is-collapsed' : ''}`} id={id}>
      <button className="edf-panel-header" type="button" onClick={onToggle}>
        <span>{title}</span>
        {tag && <b>{tag}</b>}
        <i aria-hidden="true">v</i>
      </button>
      {!collapsed && (
        <div className="edf-panel-body">
          {children}
          {querySection && (
            <QueryButton section={querySection} apiLog={apiLog} onOpen={onOpenQueries} />
          )}
        </div>
      )}
    </section>
  );
}

function WorldTopology({ sites, selectedSite, labels, onSelectSite, onSelectNode }) {
  if (selectedSite) {
    const nodes = selectedSite.nodes;
    return (
      <svg className="edf-topology-svg" viewBox="0 0 900 430" role="img" aria-label={`${selectedSite.name} topology`}>
        <defs>
          <linearGradient id="edfLocalGradient" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#f8fbff" />
            <stop offset="100%" stopColor="#edf4fb" />
          </linearGradient>
        </defs>
        <rect width="900" height="430" rx="10" fill="url(#edfLocalGradient)" />
        <g stroke="#d8e2ee" strokeWidth="1">
          {[120, 240, 360, 480, 600, 720].map(x => <line key={`v-${x}`} x1={x} y1="38" x2={x} y2="392" />)}
          {[95, 170, 245, 320].map(y => <line key={`h-${y}`} x1="52" y1={y} x2="848" y2={y} />)}
        </g>
        <circle cx="450" cy="215" r="62" fill="#e7f3ff" stroke="#8fc5ff" strokeWidth="2" />
        <text x="450" y="220" textAnchor="middle" className="edf-topology-hub">{selectedSite.name}</text>
        {nodes.map((node, index) => {
          const angle = (-90 + index * (360 / nodes.length)) * (Math.PI / 180);
          const x = 450 + Math.cos(angle) * 230;
          const y = 215 + Math.sin(angle) * 132;
          return (
            <g key={node.id}>
              <line x1="450" y1="215" x2={x} y2={y} stroke="#9db9d6" strokeWidth="2" strokeDasharray="8 7" />
              <g
                className="edf-svg-button"
                role="button"
                tabIndex="0"
                onClick={() => onSelectNode(node, selectedSite)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') onSelectNode(node, selectedSite);
                }}
              >
                <circle cx={x} cy={y} r="28" className={`edf-node-marker ${node.status}`} />
                <text x={x} y={y + 4} textAnchor="middle" className="edf-node-role">{node.role.slice(0, 2).toUpperCase()}</text>
                {labels && (
                  <>
                    <text x={x} y={y + 50} textAnchor="middle" className="edf-node-label">{node.name}</text>
                    <text x={x} y={y + 66} textAnchor="middle" className="edf-node-sub">{statusLabel(node.status)}</text>
                  </>
                )}
              </g>
            </g>
          );
        })}
      </svg>
    );
  }

  return (
    <svg className="edf-topology-svg" viewBox="0 0 900 430" role="img" aria-label="Global edge topology map">
      <defs>
        <linearGradient id="edfMapGradient" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#eef5fc" />
        </linearGradient>
      </defs>
      <rect width="900" height="430" rx="10" fill="url(#edfMapGradient)" />
      <path d="M86 174 C148 86 256 99 322 150 C372 188 406 148 472 140 C584 126 622 205 710 188 C780 174 824 214 840 270 C760 310 670 286 596 316 C494 358 434 315 342 326 C230 338 148 300 86 250 Z" fill="#e5edf5" stroke="#c8d7e6" strokeWidth="2" />
      <path d="M153 210 C226 186 279 214 338 237 C286 281 210 286 147 256 Z" fill="#dbe8f5" />
      <path d="M532 197 C608 174 700 210 746 252 C686 276 590 268 520 242 Z" fill="#dbe8f5" />
      <g stroke="#d7e2ed" strokeWidth="1">
        {[150, 300, 450, 600, 750].map(x => <line key={`v-${x}`} x1={x} y1="48" x2={x} y2="382" />)}
        {[105, 185, 265, 345].map(y => <line key={`h-${y}`} x1="60" y1={y} x2="840" y2={y} />)}
      </g>
      {sites.map(site => (
        <g
          key={site.id}
          className="edf-svg-button"
          role="button"
          tabIndex="0"
          onClick={() => onSelectSite(site)}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') onSelectSite(site);
          }}
        >
          <circle cx={(site.x / 100) * 900} cy={(site.y / 100) * 430} r="26" className={`edf-site-marker ${siteStatus(site)}`} />
          <text x={(site.x / 100) * 900} y={(site.y / 100) * 430 + 5} textAnchor="middle" className="edf-site-count">{site.nodes.length}</text>
          {labels && (
            <>
              <text x={(site.x / 100) * 900} y={(site.y / 100) * 430 + 47} textAnchor="middle" className="edf-node-label">{site.name}</text>
              <text x={(site.x / 100) * 900} y={(site.y / 100) * 430 + 63} textAnchor="middle" className="edf-node-sub">{site.region}</text>
            </>
          )}
        </g>
      ))}
    </svg>
  );
}

function EdgeDataFabricTopologyPage({ node }) {
  const [nodeAddress, setNodeAddress] = useState(node || '');
  const [rangeHours, setRangeHours] = useState(24);
  const [pollPreset, setPollPreset] = useState('60');
  const [customPollValue, setCustomPollValue] = useState(60);
  const [customPollUnit, setCustomPollUnit] = useState('seconds');
  const [paused, setPaused] = useState(false);
  const [labels, setLabels] = useState(true);
  const [mapSize, setMapSize] = useState('m');
  const [selectedSite, setSelectedSite] = useState(null);
  const [companyFilter, setCompanyFilter] = useState('');
  const [selectedNode, setSelectedNode] = useState(null);
  const [selectedNodeMetrics, setSelectedNodeMetrics] = useState([]);
  const [queryDialog, setQueryDialog] = useState(null);
  const [catalogQueryForm, setCatalogQueryForm] = useState(DEFAULT_QUERY_FORM);
  const [editingCatalogQueryId, setEditingCatalogQueryId] = useState(null);
  const [catalogQueryCards, setCatalogQueryCards] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem('edfTopologyQueryCards') || '[]');
    } catch (_) {
      return [];
    }
  });
  const [catalogQueryResults, setCatalogQueryResults] = useState({});
  const [catalogQueryRunning, setCatalogQueryRunning] = useState(false);
  const [catalogQueryFormError, setCatalogQueryFormError] = useState('');
  const [columnsByTable, setColumnsByTable] = useState({});
  const [columnsLoadingKey, setColumnsLoadingKey] = useState('');
  const [draggedQueryId, setDraggedQueryId] = useState(null);
  const catalogQueryCardsRef = useRef([]);
  const refreshSequence = useRef(0);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [loading, setLoading] = useState(false);
  const [apiLogOpen, setApiLogOpen] = useState(false);
  const [topology, setTopology] = useState({
    sites: [],
    catalog: [],
    networkDatabases: [],
    scopedNetworkDatabases: [],
    activeCompanyFilter: '',
    containers: [],
    issues: [],
    apiLog: []
  });
  const [loadError, setLoadError] = useState(null);
  const [collapsed, setCollapsed] = useState({
    catalog: false,
    kpis: true,
    issues: false,
    docker: true,
    resources: true,
    tables: true
  });

  useEffect(() => {
    if (node) setNodeAddress(node);
  }, [node]);

  const sites = topology.sites;
  const catalog = topology.catalog;
  const networkDatabases = topology.scopedNetworkDatabases?.length > 0
    ? topology.scopedNetworkDatabases
    : topology.networkDatabases;
  const containers = topology.containers;
  const issues = topology.issues;
  const apiLog = topology.apiLog;
  const pollSeconds = useMemo(() => (
    pollPreset === 'custom' ? pollSecondsFromCustom(customPollValue, customPollUnit) : Number(pollPreset)
  ), [customPollUnit, customPollValue, pollPreset]);
  const activeCompanyScope = companyScopeKey(companyFilter);
  const catalogOptions = useMemo(() => buildCatalogOptions(catalog, networkDatabases || []), [catalog, networkDatabases]);
  const dbmsOptions = catalogOptions.dbmsOptions;
  const visibleCatalogQueryCards = useMemo(() => (
    catalogQueryCards.filter(card => companyScopeKey(card.company) === activeCompanyScope)
  ), [activeCompanyScope, catalogQueryCards]);
  const tableOptions = useMemo(() => (
    catalogOptions.tableMap.get(catalogQueryForm.dbms) || []
  ), [catalogOptions, catalogQueryForm.dbms]);
  const selectedTableKey = catalogQueryForm.dbms && catalogQueryForm.table
    ? catalogKey(catalogQueryForm.dbms, catalogQueryForm.table)
    : '';
  const columnOptions = selectedTableKey ? (columnsByTable[selectedTableKey] || []) : [];
  const selectedColumn = columnOptions.find(column => column.name === catalogQueryForm.column);
  const selectedColumnType = selectedColumn?.type || '';
  const generatedCatalogQuerySql = useMemo(() => (
    buildAggregationSql(catalogQueryForm, pollSeconds)
  ), [catalogQueryForm, pollSeconds]);
  const currentSelectedSite = selectedSite
    ? sites.find(site => (
      (selectedSite.company && site.company === selectedSite.company) ||
      site.id === selectedSite.id
    )) || null
    : null;

  const allNodes = useMemo(() => sites.flatMap(site => site.nodes.map(item => ({ ...item, site: site.name }))), [sites]);
  const kpis = useMemo(() => {
    const unhealthyContainers = containers.filter(item => !String(item.status).toLowerCase().includes('running')).length;
    return {
      sites: sites.length,
      nodes: allNodes.length,
      containers: containers.length,
      warnings: issues.filter(item => item.severity === 'warning').length,
      critical: issues.filter(item => item.severity === 'critical').length,
      unhealthyContainers
    };
  }, [allNodes.length, containers, issues, sites.length]);

  const activeSelectedNode = useMemo(() => {
    if (!selectedNode) return null;
    const selectedAliases = new Set(hostAliases(selectedNode));
    const current = allNodes.find(item => (
      hostAliases(item).some(alias => selectedAliases.has(alias))
    ));
    return current ? { ...selectedNode, ...current, region: selectedNode.region || current.site } : selectedNode;
  }, [allNodes, selectedNode]);
  const activeStatusReasons = useMemo(() => statusReasons(activeSelectedNode), [activeSelectedNode]);
  const activeNodeMetricOptions = useMemo(() => {
    if (!activeSelectedNode?.metrics) return [];
    return Object.entries(activeSelectedNode.metrics)
      .filter(([label, value]) => !DEFAULT_NODE_METRICS.has(label) && hasMetricValue(value))
      .sort(([left], [right]) => left.localeCompare(right));
  }, [activeSelectedNode]);

  useEffect(() => {
    window.localStorage.setItem('edfTopologyQueryCards', JSON.stringify(catalogQueryCards));
  }, [catalogQueryCards]);

  useEffect(() => {
    catalogQueryCardsRef.current = visibleCatalogQueryCards;
  }, [visibleCatalogQueryCards]);

  useEffect(() => {
    if (dbmsOptions.length === 0) {
      if (catalogQueryForm.dbms) {
        setCatalogQueryForm(prev => ({ ...prev, dbms: '', table: '', column: '', columnType: '' }));
      }
      return;
    }
    if (dbmsOptions.includes(catalogQueryForm.dbms)) return;
    setCatalogQueryForm(prev => ({ ...prev, dbms: dbmsOptions[0] || '', table: '', column: '', columnType: '' }));
  }, [catalogQueryForm.dbms, dbmsOptions]);

  useEffect(() => {
    if (!editingCatalogQueryId) return;
    if (visibleCatalogQueryCards.some(card => card.id === editingCatalogQueryId)) return;
    resetCatalogQueryForm();
  }, [editingCatalogQueryId, visibleCatalogQueryCards]);

  useEffect(() => {
    if (!catalogQueryForm.dbms || catalogQueryForm.table || tableOptions.length === 0) return;
    setCatalogQueryForm(prev => ({ ...prev, table: tableOptions[0] || '', column: '' }));
  }, [catalogQueryForm.dbms, catalogQueryForm.table, tableOptions]);

  useEffect(() => {
    if (!nodeAddress || !catalogQueryForm.dbms || !catalogQueryForm.table || !selectedTableKey || columnsByTable[selectedTableKey]) return undefined;
    let cancelled = false;
    setColumnsLoadingKey(selectedTableKey);
    fetchEdgeDataFabricColumns(nodeAddress, catalogQueryForm.dbms, catalogQueryForm.table)
      .then(columns => {
        if (cancelled) return;
        setColumnsByTable(prev => ({ ...prev, [selectedTableKey]: columns }));
      })
      .catch(error => {
        if (cancelled) return;
        setColumnsByTable(prev => ({ ...prev, [selectedTableKey]: [] }));
        setCatalogQueryFormError(error.message || String(error));
      })
      .finally(() => {
        if (!cancelled) setColumnsLoadingKey('');
      });
    return () => {
      cancelled = true;
    };
  }, [catalogQueryForm.dbms, catalogQueryForm.table, columnsByTable, nodeAddress, selectedTableKey]);

  useEffect(() => {
    if (catalogQueryForm.column || columnOptions.length === 0) return;
    setCatalogQueryForm(prev => ({ ...prev, column: columnOptions[0]?.name || '', columnType: columnOptions[0]?.type || '' }));
  }, [catalogQueryForm.column, columnOptions]);

  useEffect(() => {
    setSelectedNodeMetrics([]);
  }, [activeSelectedNode?.id]);

  const runCatalogQueries = useCallback(async (cards = catalogQueryCardsRef.current) => {
    const runnableCards = cards
      .map(card => ({ ...card, sql: sqlForCatalogCard(card, pollSeconds) }))
      .filter(card => card.dbms && card.sql);
    if (!nodeAddress || runnableCards.length === 0) return;
    setCatalogQueryRunning(true);
    const entries = await Promise.all(runnableCards.map(async card => {
      const result = await runEdgeDataFabricQuery(nodeAddress, card.dbms, card.sql);
      return [
        card.id,
        {
          ok: result.ok,
          value: firstQueryValue(result.rows),
          nodeCount: nodeCountFromStatistics(result.statistics),
          rowCount: result.rowCount ?? result.rows?.length ?? 0,
          durationMs: result.durationMs,
          error: result.error,
          command: result.command,
          loading: false
        }
      ];
    }));
    setCatalogQueryResults(prev => ({ ...prev, ...Object.fromEntries(entries) }));
    setCatalogQueryRunning(false);
  }, [nodeAddress, pollSeconds]);

  const refresh = useCallback(async () => {
    const requestId = refreshSequence.current + 1;
    refreshSequence.current = requestId;
    setLoading(true);
    setLoadError(null);
    try {
      const raw = await fetchEdgeDataFabricTopology(nodeAddress, rangeHours, {
        company: companyFilter,
        refreshSeconds: pollSeconds
      });
      if (requestId !== refreshSequence.current) return;
      const nextSites = deriveSites(raw);
      const nextContainers = deriveContainerRows(raw.dockerRows || []);
      const nextIssues = deriveIssues([...(raw.monitorRows || []), ...(raw.nodeRows || [])], raw.dockerRows || [], raw.syslogRows || []);
      let displaySites = nextSites;
      setTopology(prev => {
        const keepLastFilteredMap = companyFilter && (
          nextSites.length === 0 ||
          nextSites.every(site => site.nodes.length === 0)
        ) && prev.sites.some(site => site.nodes.length > 0);
        displaySites = keepLastFilteredMap ? prev.sites : nextSites;
        return {
          sites: displaySites,
          catalog: raw.catalog || [],
          networkDatabases: raw.networkDatabases || [],
          scopedNetworkDatabases: raw.scopedNetworkDatabases || [],
          activeCompanyFilter: raw.activeCompanyFilter || '',
          containers: nextContainers,
          issues: nextIssues,
          apiLog: raw.apiLog || []
        };
      });
      setLastRefresh(new Date());
      if (raw.error) setLoadError(raw.error);
      setSelectedSite(prev => (
        prev && !displaySites.some(site => (
          (prev.company && site.company === prev.company) ||
          site.id === prev.id
        ))
          ? null
          : prev
      ));
      runCatalogQueries(catalogQueryCardsRef.current);
    } catch (error) {
      if (requestId !== refreshSequence.current) return;
      setLoadError(error.message || String(error));
    } finally {
      if (requestId === refreshSequence.current) {
        setLoading(false);
      }
    }
  }, [nodeAddress, rangeHours, companyFilter, pollSeconds, runCatalogQueries]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (paused) return undefined;
    const id = window.setInterval(refresh, pollSeconds * 1000);
    return () => window.clearInterval(id);
  }, [paused, pollSeconds, refresh]);

  const togglePanel = key => {
    setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const selectSite = site => {
    setSelectedSite(site);
    setSelectedNode(null);
    setCompanyFilter(site?.company || '');
  };

  const backToWorldMap = () => {
    setSelectedSite(null);
    setSelectedNode(null);
    setCompanyFilter('');
  };

  const openNode = (topologyNode, site) => {
    setSelectedNode({ ...topologyNode, site: site.name, region: site.region });
  };

  const openQueries = (section, queries) => {
    const titles = {
      map: 'Global Network Map',
      catalog: 'Network Databases and Tables',
      kpis: 'Summary KPIs',
      issues: 'Availability Issues',
      docker: 'Docker Containers',
      resources: 'Node Resource Usage',
      tables: 'Node Insights'
    };
    setQueryDialog({
      title: titles[section] || 'Section',
      queries
    });
  };

  const updateCatalogQueryForm = (field, value) => {
    setCatalogQueryForm(prev => ({
      ...prev,
      [field]: value,
      ...(field === 'dbms' ? { table: '', column: '', columnType: '' } : {}),
      ...(field === 'table' ? { column: '', columnType: '' } : {}),
      ...(field === 'column' ? { columnType: columnOptions.find(column => column.name === value)?.type || '' } : {})
    }));
    setCatalogQueryFormError('');
  };

  const resetCatalogQueryForm = () => {
    setCatalogQueryForm({
      ...DEFAULT_QUERY_FORM,
      dbms: dbmsOptions[0] || ''
    });
    setEditingCatalogQueryId(null);
    setCatalogQueryFormError('');
  };

  const saveCatalogQueryCard = event => {
    event.preventDefault();
    const label = catalogQueryForm.label.trim();
    const dbms = catalogQueryForm.dbms.trim();
    const table = catalogQueryForm.table.trim();
    const column = catalogQueryForm.column.trim();
    const aggregation = AGGREGATION_OPTIONS.includes(catalogQueryForm.aggregation)
      ? catalogQueryForm.aggregation
      : 'count';
    const sql = buildAggregationSql({ table, column, aggregation }, pollSeconds);
    if (!dbms || !table || !column || !sql) {
      setCatalogQueryFormError('Choose a DBMS, table, column, and aggregation.');
      return;
    }

    const card = {
      id: editingCatalogQueryId || makeQueryId(),
      label: label || `${aggregation.toUpperCase()} ${column}`,
      dbms,
      table,
      column,
      columnType: selectedColumnType || catalogQueryForm.columnType || '',
      aggregation,
      company: activeCompanyScope,
      sql
    };

    setCatalogQueryCards(prev => (
      editingCatalogQueryId
        ? prev.map(item => item.id === editingCatalogQueryId ? card : item)
        : [...prev, card]
    ));
    setCatalogQueryResults(prev => ({
      ...prev,
      [card.id]: {
        ...prev[card.id],
        value: null,
        nodeCount: null,
        error: '',
        loading: true
      }
    }));
    runCatalogQueries([card]);
    resetCatalogQueryForm();
  };

  const editCatalogQueryCard = card => {
    setCatalogQueryForm({
      label: card.label || '',
      dbms: card.dbms || '',
      table: card.table || '',
      column: card.column || '',
      columnType: card.columnType || '',
      aggregation: card.aggregation || 'count'
    });
    setEditingCatalogQueryId(card.id);
    setCatalogQueryFormError('');
  };

  const deleteCatalogQueryCard = (event, id) => {
    event.stopPropagation();
    setCatalogQueryCards(prev => prev.filter(card => card.id !== id));
    setCatalogQueryResults(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (editingCatalogQueryId === id) resetCatalogQueryForm();
  };

  const dropCatalogQueryCard = targetId => {
    if (!draggedQueryId || draggedQueryId === targetId) return;
    setCatalogQueryCards(prev => {
      const scopedCards = prev.filter(card => companyScopeKey(card.company) === activeCompanyScope);
      const draggedIndex = scopedCards.findIndex(card => card.id === draggedQueryId);
      const targetIndex = scopedCards.findIndex(card => card.id === targetId);
      if (draggedIndex < 0 || targetIndex < 0) return prev;
      const nextScopedCards = [...scopedCards];
      const [dragged] = nextScopedCards.splice(draggedIndex, 1);
      nextScopedCards.splice(targetIndex, 0, dragged);
      let scopedIndex = 0;
      return prev.map(card => (
        companyScopeKey(card.company) === activeCompanyScope
          ? nextScopedCards[scopedIndex++]
          : card
      ));
    });
    setDraggedQueryId(null);
  };

  const addSelectedNodeMetric = value => {
    if (!value) return;
    setSelectedNodeMetrics(prev => prev.includes(value) ? prev : [...prev, value]);
  };

  const updatePollPreset = value => {
    if (value === 'custom') {
      setCustomPollValue(Math.max(1, Number(customPollValue) || Number(pollPreset) || 60));
    }
    setPollPreset(value);
  };

  return (
    <div className="edf-page">
      <header className="edf-header">
        <div>
          <p className="edf-eyebrow">Monitoring / topology / fabric health</p>
          <h1>Edge Data Fabric Topology</h1>
        </div>
        <div className="edf-header-controls">
          <label className="edf-field">
            <span>Node</span>
            <input value={nodeAddress} onChange={event => setNodeAddress(event.target.value)} />
          </label>
          <div className="edf-segment" aria-label="Time range">
            {RANGE_OPTIONS.map(option => (
              <button key={option.hours} className={rangeHours === option.hours ? 'active' : ''} type="button" onClick={() => setRangeHours(option.hours)}>
                {option.label}
              </button>
            ))}
          </div>
          <label className="edf-field edf-field-small">
            <span>Poll</span>
            <select value={pollPreset} onChange={event => updatePollPreset(event.target.value)}>
              {POLL_PRESET_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          {pollPreset === 'custom' && (
            <div className="edf-custom-poll">
              <label className="edf-field edf-field-small">
                <span>Every</span>
                <input
                  min="1"
                  type="number"
                  value={customPollValue}
                  onChange={event => setCustomPollValue(event.target.value)}
                />
              </label>
              <div className="edf-segment edf-poll-unit-segment" aria-label="Custom poll unit">
                {POLL_UNIT_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    className={customPollUnit === option.value ? 'active' : ''}
                    type="button"
                    onClick={() => setCustomPollUnit(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <button className={`edf-action ${paused ? 'is-paused' : ''}`} type="button" onClick={() => setPaused(value => !value)}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button className="edf-action primary" type="button" onClick={refresh} disabled={loading}>
            {loading ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </header>

      <main className="edf-main">
        <section className="edf-panel">
          <div className="edf-panel-title-row">
            <h2>Global Network Map</h2>
            <span>{allNodes.length} nodes across {sites.length} sites</span>
          </div>
          {loadError && <div className="edf-error">{loadError}</div>}
          <div className="edf-map-nav">
            {currentSelectedSite && (
              <button type="button" onClick={backToWorldMap}>
                Back to world map
              </button>
            )}
            <span>
              {currentSelectedSite
                ? `Viewing ${currentSelectedSite.name} / ${currentSelectedSite.region}${companyFilter ? ` · company filter: ${companyFilter}` : ''}`
                : 'Click a site to inspect local nodes'}
            </span>
          </div>
          <div className="edf-map-toolbar">
            <button type="button" className={labels ? 'active' : ''} onClick={() => setLabels(value => !value)}>Labels</button>
            <span>Size</span>
            {SIZE_OPTIONS.map(option => (
              <button key={option.value} className={mapSize === option.value ? 'active' : ''} type="button" onClick={() => setMapSize(option.value)}>
                {option.label}
              </button>
            ))}
          </div>
          <div className={`edf-map-wrap size-${mapSize}`}>
            {sites.length > 0 ? (
              <WorldTopology sites={sites} selectedSite={currentSelectedSite} labels={labels} onSelectSite={selectSite} onSelectNode={openNode} />
            ) : (
              <div className="edf-empty">
                {loading ? 'Querying AnyLog metadata and monitoring tables...' : 'No topology nodes returned for the selected AnyLog node.'}
              </div>
            )}
          </div>
          <div className="edf-topology-list">
            {(currentSelectedSite ? currentSelectedSite.nodes : sites).map(item => {
              const isSite = Boolean(item.nodes);
              const status = isSite ? siteStatus(item) : item.status;
              return (
                <button key={item.id} type="button" onClick={() => isSite ? selectSite(item) : openNode(item, currentSelectedSite)}>
                  <span className={`edf-status-dot ${status}`} />
                  <strong>{item.name}</strong>
                  <small>{isSite ? `${item.nodes.length} nodes / ${item.region}` : `${item.role} / CPU ${formatMetricValue(item.cpu)} / Disk ${formatMetricValue(item.diskUsage)}`}</small>
                </button>
              );
            })}
          </div>
          <QueryButton section="map" apiLog={apiLog} onOpen={openQueries} />
        </section>

        <Panel id="catalog" title="Network Databases and Tables" tag={`${visibleCatalogQueryCards.length} queries`} collapsed={collapsed.catalog} onToggle={() => togglePanel('catalog')} querySection="catalog" apiLog={apiLog} onOpenQueries={openQueries}>
          <form className="edf-query-builder" onSubmit={saveCatalogQueryCard}>
            <label className="edf-field">
              <span>DBMS</span>
              <select value={catalogQueryForm.dbms} onChange={event => updateCatalogQueryForm('dbms', event.target.value)} disabled={dbmsOptions.length === 0}>
                {dbmsOptions.length === 0 ? (
                  <option value="">No DBMS returned</option>
                ) : dbmsOptions.map(dbms => (
                  <option key={dbms} value={dbms}>{dbms}</option>
                ))}
              </select>
            </label>
            <label className="edf-field">
              <span>Table</span>
              <select value={catalogQueryForm.table} onChange={event => updateCatalogQueryForm('table', event.target.value)} disabled={tableOptions.length === 0}>
                {tableOptions.length === 0 ? (
                  <option value="">No tables returned</option>
                ) : tableOptions.map(table => (
                  <option key={table} value={table}>{table}</option>
                ))}
              </select>
            </label>
            <label className="edf-field">
              <span>Column</span>
              <select value={catalogQueryForm.column} onChange={event => updateCatalogQueryForm('column', event.target.value)} disabled={!selectedTableKey || columnsLoadingKey === selectedTableKey || columnOptions.length === 0}>
                {selectedTableKey && columnsLoadingKey === selectedTableKey ? (
                  <option value="">Loading columns</option>
                ) : columnOptions.length === 0 ? (
                  <option value="">No columns returned</option>
                ) : columnOptions.map(column => (
                  <option key={column.name} value={column.name}>{columnLabel(column)}</option>
                ))}
              </select>
              {selectedColumnType && <small className="edf-field-hint">Type: {selectedColumnType}</small>}
            </label>
            <label className="edf-field edf-field-small">
              <span>Aggregation</span>
              <select value={catalogQueryForm.aggregation} onChange={event => updateCatalogQueryForm('aggregation', event.target.value)}>
                {AGGREGATION_OPTIONS.map(aggregation => (
                  <option key={aggregation} value={aggregation}>{aggregation.toUpperCase()}</option>
                ))}
              </select>
            </label>
            <label className="edf-field">
              <span>Label</span>
              <input value={catalogQueryForm.label} onChange={event => updateCatalogQueryForm('label', event.target.value)} placeholder="Latest count" />
            </label>
            <div className="edf-query-builder-actions">
              <button className="edf-action primary" type="submit">{editingCatalogQueryId ? 'Update' : 'Add'}</button>
              {editingCatalogQueryId && <button className="edf-action" type="button" onClick={resetCatalogQueryForm}>Cancel</button>}
              <button className="edf-action" type="button" onClick={() => runCatalogQueries(visibleCatalogQueryCards)} disabled={catalogQueryRunning || visibleCatalogQueryCards.length === 0}>
                {catalogQueryRunning ? 'Running' : 'Run All'}
              </button>
            </div>
            <pre className="edf-generated-query">{generatedCatalogQuerySql || 'Select a DBMS, table, column, and aggregation to generate a query.'}</pre>
          </form>
          {catalogQueryFormError && <div className="edf-inline-error">{catalogQueryFormError}</div>}
          {dbmsOptions.length === 0 && <div className="edf-empty">No DBMS/table metadata returned yet.</div>}
          <div className="edf-catalog-grid edf-query-card-grid">
            {visibleCatalogQueryCards.length === 0 && <div className="edf-empty">Add a labeled query to display DBMS values returned by the network.</div>}
            {visibleCatalogQueryCards.map(card => {
              const result = catalogQueryResults[card.id] || {};
              const cardSql = sqlForCatalogCard(card, pollSeconds);
              return (
                <article
                  className={`edf-catalog-card edf-query-result-card ${draggedQueryId === card.id ? 'is-dragging' : ''}`}
                  draggable
                  key={card.id}
                  onClick={() => editCatalogQueryCard(card)}
                  onDragStart={() => setDraggedQueryId(card.id)}
                  onDragEnd={() => setDraggedQueryId(null)}
                  onDragOver={event => event.preventDefault()}
                  onDrop={() => dropCatalogQueryCard(card.id)}
                  title="Click to edit query"
                >
                  <div className="edf-query-card-head">
                    <span>{card.dbms}</span>
                    <button type="button" onClick={event => deleteCatalogQueryCard(event, card.id)} aria-label={`Delete ${card.label}`}>x</button>
                  </div>
                  <strong>{card.label}</strong>
                  <b>{result.loading ? '...' : formatScalarValue(result.value)}</b>
                  <small>{formatNumber(result.nodeCount)} nodes returned values</small>
                  {card.table && <small>{card.table}{card.column ? ` / ${card.aggregation?.toUpperCase() || 'QUERY'}(${card.column}${card.columnType ? `: ${card.columnType}` : ''})` : ''}</small>}
                  {cardSql && <small>{cardSql}</small>}
                  {result.rowCount !== undefined && <small>{formatNumber(result.rowCount)} rows / {result.durationMs ?? 0}ms</small>}
                  {result.error && <p>{result.error}</p>}
                </article>
              );
            })}
          </div>
        </Panel>

        <Panel id="kpis" title="Summary KPIs" tag={`${kpis.critical} critical`} collapsed={collapsed.kpis} onToggle={() => togglePanel('kpis')} querySection="kpis" apiLog={apiLog} onOpenQueries={openQueries}>
          <div className="edf-kpi-grid">
            <article><span>Sites</span><strong>{kpis.sites}</strong><small>active locations</small></article>
            <article><span>Nodes</span><strong>{kpis.nodes}</strong><small>fabric members</small></article>
            <article><span>Containers</span><strong>{kpis.containers}</strong><small>{kpis.unhealthyContainers} require attention</small></article>
            <article><span>Warnings</span><strong>{kpis.warnings}</strong><small>non-critical alerts</small></article>
            <article className="danger"><span>Critical</span><strong>{kpis.critical}</strong><small>immediate review</small></article>
          </div>
        </Panel>

        <Panel id="issues" title="Availability Issues" tag={`${issues.length} issues`} collapsed={collapsed.issues} onToggle={() => togglePanel('issues')} querySection="issues" apiLog={apiLog} onOpenQueries={openQueries}>
          <div className="edf-table-wrap">
            <table className="edf-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Source</th>
                  <th>Type</th>
                  <th>Issue</th>
                </tr>
              </thead>
              <tbody>
                {issues.length === 0 && (
                  <tr><td colSpan="4">No availability issues detected from queried monitoring rows.</td></tr>
                )}
                {issues.map(issue => (
                  <tr key={`${issue.source}-${issue.message}`}>
                    <td><span className={`edf-badge ${issue.severity}`}>{issue.severity}</span></td>
                    <td>{issue.source}</td>
                    <td>{issue.type}</td>
                    <td>{issue.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="edf-two-col">
          <Panel id="docker" title="Docker Containers" tag={`${containers.length} recent`} collapsed={collapsed.docker} onToggle={() => togglePanel('docker')} querySection="docker" apiLog={apiLog} onOpenQueries={openQueries}>
            <div className="edf-container-grid">
              {containers.length === 0 && <div className="edf-empty">No docker_insight rows returned for the selected window.</div>}
              {containers.map(container => (
                <article className={container.status === 'running' ? '' : 'warn'} key={`${container.node}-${container.name}`}>
                  <strong>{container.name}</strong>
                  <span>{container.node}</span>
                  <div><small>CPU {formatMetricValue(container.cpu)}</small><MetricBar value={container.cpu} /></div>
                  <div><small>Disk {formatMetricValue(container.diskUsage)}</small><MetricBar value={container.diskUsage} /></div>
                </article>
              ))}
            </div>
          </Panel>

          <Panel id="resources" title="Node Resource Usage" tag={`${allNodes.length} nodes`} collapsed={collapsed.resources} onToggle={() => togglePanel('resources')} querySection="resources" apiLog={apiLog} onOpenQueries={openQueries}>
            <div className="edf-resource-list">
              {allNodes.map(item => (
                <div className="edf-resource-row" key={item.id}>
                  <span>{item.name}</span>
                  <MetricBar value={item.diskUsage} />
                  <b>{formatMetricValue(item.diskUsage)}</b>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <Panel id="tables" title="Node Insights" tag={`${allNodes.length} rows`} collapsed={collapsed.tables} onToggle={() => togglePanel('tables')} querySection="tables" apiLog={apiLog} onOpenQueries={openQueries}>
          <div className="edf-table-wrap">
            <table className="edf-table">
              <thead>
                <tr>
                  <th>Node</th>
                  <th>Site</th>
                  <th>Role</th>
                  <th>CPU</th>
                  <th>Disk</th>
                  <th>Tables</th>
                </tr>
              </thead>
              <tbody>
                {allNodes.length === 0 && (
                  <tr><td colSpan="6">No node rows returned from metadata or monitored operators.</td></tr>
                )}
                {allNodes.map(item => (
                  <tr key={item.id}>
                    <td>{item.name}</td>
                    <td>{item.site}</td>
                    <td>{item.role}</td>
                    <td>{formatMetricValue(item.cpu)}</td>
                    <td>{formatMetricValue(item.diskUsage)}</td>
                    <td>{item.tables}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <section className={`edf-api-log ${apiLogOpen ? 'open' : ''}`}>
          <button type="button" className="edf-api-log-header" onClick={() => setApiLogOpen(value => !value)}>
            <span>API Call Log</span>
            <b>{apiLog.length} calls</b>
            <i aria-hidden="true">v</i>
          </button>
          {apiLogOpen && (
            <div className="edf-api-log-body">
              {apiLog.length === 0 ? (
                <p>No calls logged yet. Click Refresh to query AnyLog.</p>
              ) : apiLog.map((entry, index) => (
                <div className="edf-api-row" key={`${entry.time}-${index}`}>
                  <span>{entry.time}</span>
                  <b className={entry.kind.toLowerCase()}>{entry.kind}</b>
                  <span>{entry.detail}</span>
                  <small>{entry.rows} rows</small>
                  <small>{entry.duration}</small>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="edf-footer-status">
          <span>{paused ? 'Auto-refresh paused' : `Auto-refresh every ${formatPollInterval(pollSeconds)}`}</span>
          <span>{lastRefresh ? `Last refresh ${lastRefresh.toLocaleTimeString()}` : 'Waiting for first refresh'}</span>
        </div>
      </main>

      {activeSelectedNode && (
        <div className="edf-modal" role="dialog" aria-modal="true" aria-labelledby="edf-node-detail-title">
          <button className="edf-modal-backdrop" type="button" aria-label="Close node detail" onClick={() => setSelectedNode(null)} />
          <section className="edf-modal-shell">
            <header>
              <div>
                <p>{activeSelectedNode.site} / {activeSelectedNode.region}</p>
                <h2 id="edf-node-detail-title">{activeSelectedNode.name}</h2>
              </div>
              <button type="button" onClick={() => setSelectedNode(null)} aria-label="Close">x</button>
            </header>
            <div className="edf-modal-metrics">
              <article
                className={`edf-status-metric ${activeStatusReasons.length > 0 ? 'has-tooltip' : ''}`}
                tabIndex={activeStatusReasons.length > 0 ? 0 : undefined}
              >
                <span>Status</span>
                <strong>{statusLabel(activeSelectedNode.status)}</strong>
                {activeStatusReasons.length > 0 && (
                  <div className="edf-status-tooltip" role="tooltip">
                    {activeStatusReasons.map(reason => <p key={reason}>{reason}</p>)}
                  </div>
                )}
              </article>
              <article><span>Role</span><strong>{activeSelectedNode.role}</strong></article>
              <article><span>CPU</span><strong>{formatMetricValue(activeSelectedNode.cpu)}</strong></article>
              <article><span>Disk</span><strong>{formatMetricValue(activeSelectedNode.diskUsage)}</strong></article>
              <article><span>Inserts</span><strong>{formatNumber(activeSelectedNode.inserts)}</strong></article>
              <article><span>Operational Time</span><strong>{activeSelectedNode.operationalTime || 'N/A'}</strong></article>
              {selectedNodeMetrics.map(label => (
                <article key={label}>
                  <span>{label}</span>
                  <strong>{formatScalarValue(activeSelectedNode.metrics?.[label])}</strong>
                </article>
              ))}
              {activeNodeMetricOptions.length > 0 && (
                <label className="edf-modal-metric-picker">
                  <span>Add metric</span>
                  <select value="" onChange={event => addSelectedNodeMetric(event.target.value)}>
                    <option value="">Select metric</option>
                    {activeNodeMetricOptions
                      .filter(([label]) => !selectedNodeMetrics.includes(label))
                      .map(([label]) => <option key={label} value={label}>{label}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div className="edf-modal-grid">
              <div>
                <h3>Docker insight</h3>
                {containers.filter(container => container.node === activeSelectedNode.name || container.node === activeSelectedNode.id).map(container => (
                  <article className="edf-modal-item" key={container.name}>
                    <strong>{container.name}</strong>
                    <span>{container.status} / CPU {formatMetricValue(container.cpu)} / Disk {formatMetricValue(container.diskUsage)}</span>
                  </article>
                ))}
              </div>
              <div>
                <h3>Recommended actions</h3>
                <article className="edf-modal-item">
                  <strong>{activeSelectedNode.status === 'crit' ? 'Scale query capacity' : 'Continue monitoring'}</strong>
                  <span>{activeSelectedNode.status === 'crit' ? 'Add a query peer or move long-running analytics away from this node.' : 'Node is within expected operating range for the selected window.'}</span>
                </article>
                <article className="edf-modal-item">
                  <strong>Validate table distribution</strong>
                  <span>Confirm partitions for high-write tables are balanced across active peers.</span>
                </article>
              </div>
            </div>
          </section>
        </div>
      )}

      {queryDialog && (
        <div className="edf-modal" role="dialog" aria-modal="true" aria-labelledby="edf-query-detail-title">
          <button className="edf-modal-backdrop" type="button" aria-label="Close query detail" onClick={() => setQueryDialog(null)} />
          <section className="edf-modal-shell edf-query-modal-shell">
            <header>
              <div>
                <p>Latest AnyLog commands</p>
                <h2 id="edf-query-detail-title">{queryDialog.title}</h2>
              </div>
              <button type="button" onClick={() => setQueryDialog(null)} aria-label="Close">x</button>
            </header>
            <div className="edf-query-list">
              {queryDialog.queries.length === 0 ? (
                <div className="edf-empty">No query has been logged for this section yet. Click Refresh to run the latest commands.</div>
              ) : queryDialog.queries.map((entry, index) => (
                <article className="edf-query-item" key={`${entry.command}-${index}`}>
                  <div>
                    <span>{entry.kind}</span>
                    <small>{entry.rows} rows / {entry.duration}</small>
                  </div>
                  <pre>{entry.command}</pre>
                  {entry.error && <p>{entry.error}</p>}
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default EdgeDataFabricTopologyPage;
